package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/grn-dev/grn/internal/ai"
	"github.com/grn-dev/grn/internal/capture"
	"github.com/grn-dev/grn/internal/db"
	"github.com/grn-dev/grn/internal/transcribe"
	"github.com/spf13/cobra"
)

func listenCmd() *cobra.Command {
	var deviceIdx int
	var title string
	var modelPath string

	cmd := &cobra.Command{
		Use:   "listen",
		Short: "Record audio and transcribe on stop",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runListen(deviceIdx, title, modelPath)
		},
	}
	cmd.Flags().IntVarP(&deviceIdx, "device", "d", 0, "Audio device index (see grn devices)")
	cmd.Flags().StringVarP(&title, "title", "t", "", "Session title")
	cmd.Flags().StringVarP(&modelPath, "model", "m", "", "Whisper model path")
	return cmd
}

func devicesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "devices",
		Short: "List available audio input devices",
		RunE: func(cmd *cobra.Command, args []string) error {
			devices, err := capture.ListAudioDevices()
			if err != nil {
				return err
			}
			for _, d := range devices {
				fmt.Printf("  [%d] %s\n", d.Index, d.Name)
			}
			return nil
		},
	}
}

func runListen(deviceIdx int, title, modelPath string) error {
	_, store, pipeline, err := loadDeps()
	if err != nil {
		return err
	}
	defer store.Close()

	if modelPath == "" {
		modelPath = defaultModelPath()
	}
	if title == "" {
		title = time.Now().Format("2006-01-02 15:04 recording")
	}

	sessionDir, audioPath, err := createSession(title)
	if err != nil {
		return err
	}

	meeting, err := startMeeting(store, title, audioPath)
	if err != nil {
		return err
	}

	fmt.Printf("● Recording to %s (press Ctrl-C to stop)\n", sessionDir)
	fmt.Printf("  device: [%d], model: %s\n\n", deviceIdx, modelPath)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	recorder := capture.NewRecorder(deviceIdx, audioPath)
	if err := recorder.Start(ctx); err != nil {
		return err
	}

	<-ctx.Done()
	fmt.Println("\n● Stopping...")
	recorder.Stop()

	duration := time.Since(parseTime(meeting.StartedAt))
	fmt.Printf("● Recorded %s\n", duration.Truncate(time.Second))

	return postProcess(store, pipeline, meeting, audioPath, modelPath)
}

func createSession(title string) (string, string, error) {
	ts := time.Now().Format("2006-01-02T1504")
	dirName := fmt.Sprintf("%s-%s", ts, sanitize(title))
	sessionDir := filepath.Join(grnDir(), "sessions", dirName)
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return "", "", fmt.Errorf("create session dir: %w", err)
	}
	audioPath := filepath.Join(sessionDir, "audio.wav")
	return sessionDir, audioPath, nil
}

func startMeeting(store *db.DB, title, audioPath string) (*db.Meeting, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	meeting := &db.Meeting{
		Title:     title,
		StartedAt: now,
		AudioPath: &audioPath,
		Source:    "listen",
	}
	if err := store.CreateMeeting(meeting); err != nil {
		return nil, fmt.Errorf("create meeting: %w", err)
	}
	return meeting, nil
}

func postProcess(store *db.DB, pipeline *ai.Pipeline, meeting *db.Meeting, audioPath, modelPath string) error {
	fmt.Println("● Transcribing...")
	segments, err := transcribe.TranscribeFile(audioPath, modelPath)
	if err != nil {
		return savePartial(store, meeting, err)
	}
	fmt.Printf("● Got %d segments\n", len(segments))

	dbSegments := toDBSegments(meeting.ID, segments)
	if err := store.InsertSegments(dbSegments); err != nil {
		return fmt.Errorf("save segments: %w", err)
	}

	transcript := formatTranscript(dbSegments)
	fmt.Println("● Enhancing with AI...")
	extraction, summary, err := pipeline.Run(cmdContext(), transcript, "")
	if err != nil {
		meeting.Transcript = &transcript
		store.UpdateMeeting(meeting)
		return fmt.Errorf("enhance failed (transcript saved): %w", err)
	}

	meeting.Transcript = &transcript
	meeting.Summary = &summary
	now := time.Now().UTC().Format(time.RFC3339)
	meeting.EndedAt = &now
	store.UpdateMeeting(meeting)

	fmt.Println("\n" + summary)
	fmt.Printf("\n● %d action items. Meeting saved: %s\n", len(extraction.ActionItems), meeting.ID)
	return nil
}

func savePartial(store *db.DB, meeting *db.Meeting, origErr error) error {
	now := time.Now().UTC().Format(time.RFC3339)
	meeting.EndedAt = &now
	store.UpdateMeeting(meeting)
	return fmt.Errorf("transcription failed (audio saved): %w", origErr)
}

func toDBSegments(meetingID string, segs []transcribe.Segment) []db.Segment {
	out := make([]db.Segment, len(segs))
	for i, s := range segs {
		out[i] = db.Segment{
			MeetingID: meetingID,
			Start:     s.Start,
			End:       s.End,
			Text:      s.Text,
			Speaker:   s.Speaker,
		}
	}
	return out
}

func sanitize(s string) string {
	out := make([]byte, 0, len(s))
	for _, b := range []byte(s) {
		if (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') || b == '-' {
			out = append(out, b)
		} else if b >= 'A' && b <= 'Z' {
			out = append(out, b+32)
		} else if b == ' ' {
			out = append(out, '-')
		}
	}
	return string(out)
}

func defaultModelPath() string {
	return filepath.Join(grnDir(), "models", "ggml-base.en.bin")
}

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}
