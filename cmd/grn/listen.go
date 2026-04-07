package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"github.com/grn-dev/grn/internal/ai"
	"github.com/grn-dev/grn/internal/capture"
	"github.com/grn-dev/grn/internal/db"
	"github.com/spf13/cobra"
)

func listenCmd() *cobra.Command {
	var deviceIdx int
	var title string
	var modelPath string
	var mode string

	cmd := &cobra.Command{
		Use:   "listen",
		Short: "Record audio and transcribe on stop",
		RunE: func(cmd *cobra.Command, args []string) error {
			m := capture.CaptureMode(mode)
			return runListen(deviceIdx, title, modelPath, m)
		},
	}
	cmd.Flags().IntVarP(&deviceIdx, "device", "d", 0, "Audio device index")
	cmd.Flags().StringVarP(&title, "title", "t", "", "Session title")
	cmd.Flags().StringVarP(&modelPath, "model", "m", "", "Whisper model path")
	cmd.Flags().StringVar(&mode, "mode", "both", "Capture mode: mic, system, or both (default); \"both\" captures mic + system audio for meetings")
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

func runListen(deviceIdx int, title, modelPath string, mode capture.CaptureMode) error {
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

	sessionDir := createSessionDir(title)
	meeting, err := startMeeting(store, title, sessionDir)
	if err != nil {
		return err
	}

	fmt.Printf("● Recording to %s (press Ctrl-C to stop)\n", sessionDir)
	fmt.Printf("  mode: %s, device: [%d]\n\n", mode, deviceIdx)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	recorder := capture.NewRecorder(mode, sessionDir, deviceIdx)
	if err := recorder.Start(ctx); err != nil {
		return err
	}

	<-ctx.Done()
	fmt.Println("\n● Stopping...")
	if err := recorder.Stop(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: capture did not exit cleanly: %v\n", err)
		fmt.Fprintf(os.Stderr, "  audio files may be incomplete\n")
	}

	duration := time.Since(parseTime(meeting.StartedAt))
	fmt.Printf("● Recorded %s\n", duration.Truncate(time.Second))

	return postProcess(store, pipeline, meeting, recorder, modelPath)
}

func createSessionDir(title string) string {
	ts := time.Now().Format("2006-01-02T1504")
	dirName := fmt.Sprintf("%s-%s", ts, sanitize(title))
	dir := filepath.Join(grnDir(), "sessions", dirName)
	os.MkdirAll(dir, 0o755)
	return dir
}

func startMeeting(store *db.DB, title, sessionDir string) (*db.Meeting, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	meeting := &db.Meeting{
		Title:     title,
		StartedAt: now,
		AudioPath: &sessionDir,
		Source:    "listen",
	}
	if err := store.CreateMeeting(meeting); err != nil {
		return nil, fmt.Errorf("create meeting: %w", err)
	}
	return meeting, nil
}

func postProcess(store *db.DB, pipeline *ai.Pipeline, meeting *db.Meeting, recorder *capture.Recorder, modelPath string) error {
	allSegments, transcribeErr := transcribeStreams(recorder, meeting.ID, modelPath)
	if transcribeErr != nil {
		return savePartial(store, meeting, transcribeErr)
	}
	if len(allSegments) == 0 {
		return savePartial(store, meeting, fmt.Errorf("no audio to transcribe"))
	}

	fmt.Printf("● Got %d segments\n", len(allSegments))
	if err := store.InsertSegments(allSegments); err != nil {
		return fmt.Errorf("save segments: %w", err)
	}

	transcript := formatTranscript(allSegments)
	fmt.Println("\n── Transcript ──────────────────────────")
	fmt.Println(transcript)

	return enhanceAndSave(store, pipeline, meeting, transcript)
}

func transcribeStreams(recorder *capture.Recorder, meetingID, modelPath string) ([]db.Segment, error) {
	var all []db.Segment
	var errs []string
	for _, src := range []struct{ path, speaker string }{
		{recorder.MicPath(), "You"},
		{recorder.SystemPath(), "Other"},
	} {
		if !fileExists(src.path) {
			fmt.Printf("  skipping %s: file missing or empty (no audio captured)\n", filepath.Base(src.path))
			continue
		}
		fmt.Printf("● Transcribing %s audio...\n", src.speaker)
		segs, err := transcribeAs(src.path, modelPath, src.speaker)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  error: %s transcription failed: %v\n", src.speaker, err)
			errs = append(errs, fmt.Sprintf("%s: %v", src.speaker, err))
			continue
		}
		all = append(all, toDBSegments(meetingID, segs)...)
	}
	if len(all) == 0 && len(errs) > 0 {
		return nil, fmt.Errorf("transcription failed: %s", strings.Join(errs, "; "))
	}
	return all, nil
}

func enhanceAndSave(store *db.DB, pipeline *ai.Pipeline, meeting *db.Meeting, transcript string) error {
	fmt.Println("── Enhancing with AI... ─────────────────")
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

	fmt.Println("\n── Notes ───────────────────────────────")
	fmt.Println(summary)
	if len(extraction.ActionItems) > 0 {
		fmt.Printf("\n● %d action items extracted.\n", len(extraction.ActionItems))
	}
	fmt.Printf("● Saved: %s\n", meeting.ID)
	return nil
}


