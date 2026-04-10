package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
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
			return runListen(deviceIdx, title, modelPath, m, false)
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

func runListen(deviceIdx int, title, modelPath string, mode capture.CaptureMode, suppressProcessingFailure bool) error {
	_, store, pipeline, err := loadDeps()
	if err != nil {
		return err
	}
	defer store.Close()
	emitter := newAppRecordingEventEmitter(suppressProcessingFailure)

	if modelPath == "" {
		modelPath, err = defaultModelPath()
		if err != nil {
			return err
		}
	}
	if title == "" {
		title = time.Now().Format("2006-01-02 15:04 recording")
	}

	sessionDir, err := createSessionDir(title)
	if err != nil {
		return err
	}
	meeting, err := startMeeting(store, title, sessionDir)
	if err != nil {
		return err
	}

	if emitter == nil {
		fmt.Printf("● Recording to %s (press Ctrl-C to stop)\n", sessionDir)
		fmt.Printf("  mode: %s, device: [%d]\n\n", mode, deviceIdx)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	recorder := capture.NewRecorder(mode, sessionDir, deviceIdx)
	if err := recorder.Start(ctx); err != nil {
		if failErr := failMeetingCapture(store, meeting, err, emitter); failErr != nil {
			return failErr
		}
		return err
	}
	if err := emitter.emit(appRecordingStartedEvent, *meeting, nil); err != nil {
		return err
	}

	select {
	case <-ctx.Done():
		if emitter == nil {
			fmt.Println("\n● Stopping...")
		}
		if err := emitter.emit(appRecordingStoppingEvent, *meeting, nil); err != nil {
			return err
		}
		if err := recorder.Stop(); err != nil {
			fmt.Fprintf(os.Stderr, "warning: capture did not exit cleanly: %v\n", err)
			fmt.Fprintf(os.Stderr, "  audio files may be incomplete\n")
		}
	case err := <-recorder.Done():
		if err != nil {
			if failErr := failMeetingCapture(store, meeting, fmt.Errorf("capture stopped unexpectedly: %w", err), emitter); failErr != nil {
				return failErr
			}
			return fmt.Errorf("capture stopped unexpectedly: %w", err)
		}
		unexpectedErr := fmt.Errorf("capture stopped unexpectedly")
		if failErr := failMeetingCapture(store, meeting, unexpectedErr, emitter); failErr != nil {
			return failErr
		}
		return unexpectedErr
	}

	startedAt, err := parseTime(meeting.StartedAt)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not parse start time: %v\n", err)
		if emitter == nil {
			fmt.Println("● Recorded")
		}
	} else if emitter == nil {
		duration := time.Since(startedAt)
		fmt.Printf("● Recorded %s\n", duration.Truncate(time.Second))
	}

	endedAt := time.Now().UTC().Format(time.RFC3339)
	meeting.EndedAt = &endedAt
	if !hasCapturedAudio(recorder) {
		captureErr := fmt.Errorf("no audio captured")
		if err := failMeetingCapture(store, meeting, captureErr, emitter); err != nil {
			return err
		}
		return captureErr
	}
	setMeetingCaptureStatus(meeting, db.CaptureStatusCaptured, endedAt, nil)
	setMeetingProcessingStatus(meeting, db.ProcessingStatusProcessing, endedAt, nil)
	if err := store.UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("mark meeting captured: %w", err)
	}
	if err := emitter.emit(appRecordingProcessingEvent, *meeting, nil); err != nil {
		return err
	}

	postCtx, postCancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer postCancel()

	err = postProcess(postCtx, store, pipeline, meeting, recorder, modelPath, emitter)
	if err != nil && suppressProcessingFailure {
		fmt.Fprintf(os.Stderr, "warning: post-processing failed after capture: %v\n", err)
		return nil
	}
	return err
}

func failMeetingCapture(store *db.DB, meeting *db.Meeting, captureErr error, emitter *appRecordingEventEmitter) error {
	now := time.Now().UTC().Format(time.RFC3339)
	meeting.EndedAt = &now
	setMeetingCaptureStatus(meeting, db.CaptureStatusFailed, now, captureErr)
	if err := store.UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("mark meeting capture failed: %w", err)
	}
	if err := emitter.emit(appRecordingFailedEvent, *meeting, captureErr); err != nil {
		return err
	}
	return nil
}

func createSessionDir(title string) (string, error) {
	ts := time.Now().Format("2006-01-02T1504")
	dirName := fmt.Sprintf("%s-%s", ts, sanitize(title))
	baseDir, err := grnDir()
	if err != nil {
		return "", fmt.Errorf("resolve grn dir for session path: %w", err)
	}
	dir := filepath.Join(baseDir, "sessions", dirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create session dir: %w", err)
	}
	return dir, nil
}

func startMeeting(store *db.DB, title, sessionDir string) (*db.Meeting, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	meeting := &db.Meeting{
		Title:                     title,
		StartedAt:                 now,
		CaptureStatus:             db.CaptureStatusRecording,
		CaptureStatusUpdatedAt:    now,
		ProcessingStatus:          db.ProcessingStatusNotStarted,
		ProcessingStatusUpdatedAt: now,
		AudioPath:                 &sessionDir,
		Source:                    "listen",
	}
	if err := store.CreateMeeting(meeting); err != nil {
		return nil, fmt.Errorf("create meeting: %w", err)
	}
	return meeting, nil
}

func postProcess(ctx context.Context, store *db.DB, pipeline *ai.Pipeline, meeting *db.Meeting, recorder *capture.Recorder, modelPath string, emitter *appRecordingEventEmitter) error {
	allSegments, transcribeErr := transcribeStreams(ctx, recorder, meeting.ID, modelPath, emitter)
	if transcribeErr != nil {
		return saveProcessingFailure(store, meeting, transcribeErr, emitter)
	}
	if len(allSegments) == 0 {
		return saveProcessingFailure(store, meeting, fmt.Errorf("no audio to transcribe"), emitter)
	}

	if emitter == nil {
		fmt.Printf("● Got %d segments\n", len(allSegments))
	}
	if err := store.InsertSegments(allSegments); err != nil {
		return fmt.Errorf("save segments: %w", err)
	}

	transcript := formatTranscript(allSegments)
	if emitter == nil {
		fmt.Println("\n── Transcript ──────────────────────────")
		fmt.Println(transcript)
	}

	return enhanceAndSave(store, pipeline, meeting, transcript, emitter)
}

func transcribeStreams(ctx context.Context, recorder *capture.Recorder, meetingID, modelPath string, emitter *appRecordingEventEmitter) ([]db.Segment, error) {
	var all []db.Segment
	var errs []string
	for _, src := range []struct{ path, speaker string }{
		{recorder.MicPath(), "You"},
		{recorder.SystemPath(), "Other"},
	} {
		if !fileExists(src.path) {
			if emitter == nil {
				fmt.Printf("  skipping %s: file missing or empty (no audio captured)\n", filepath.Base(src.path))
			}
			continue
		}
		if emitter == nil {
			fmt.Printf("● Transcribing %s audio...\n", src.speaker)
		}
		segs, err := transcribeAs(ctx, src.path, modelPath, src.speaker)
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
	sortSegmentsChronologically(all)
	return all, nil
}

func sortSegmentsChronologically(segments []db.Segment) {
	indexed := make([]struct {
		segment db.Segment
		index   int
	}, len(segments))
	for i, segment := range segments {
		indexed[i] = struct {
			segment db.Segment
			index   int
		}{segment: segment, index: i}
	}
	sort.Slice(indexed, func(i, j int) bool {
		a, b := indexed[i], indexed[j]
		switch {
		case a.segment.Start != b.segment.Start:
			return a.segment.Start < b.segment.Start
		case a.segment.End != b.segment.End:
			return a.segment.End < b.segment.End
		case a.segment.Speaker != b.segment.Speaker:
			return a.segment.Speaker < b.segment.Speaker
		case a.segment.Text != b.segment.Text:
			return a.segment.Text < b.segment.Text
		default:
			return a.index < b.index
		}
	})
	for i, segment := range indexed {
		segments[i] = segment.segment
	}
}

func enhanceAndSave(store *db.DB, pipeline *ai.Pipeline, meeting *db.Meeting, transcript string, emitter *appRecordingEventEmitter) error {
	if emitter == nil {
		fmt.Println("── Enhancing with AI... ─────────────────")
	}
	extraction, summary, err := pipeline.Run(cmdContext(), transcript, "")
	if err != nil {
		meeting.Transcript = &transcript
		now := time.Now().UTC().Format(time.RFC3339)
		setMeetingProcessingStatus(meeting, db.ProcessingStatusFailed, now, err)
		if updateErr := store.UpdateMeeting(meeting); updateErr != nil {
			return errors.Join(
				fmt.Errorf("enhance failed: %w", err),
				fmt.Errorf("save transcript: %w", updateErr),
			)
		}
		if emitErr := emitter.emit(appRecordingFailedEvent, *meeting, err); emitErr != nil {
			return emitErr
		}
		return fmt.Errorf("enhance failed (transcript saved): %w", err)
	}

	meeting.Transcript = &transcript
	meeting.Summary = &summary
	now := time.Now().UTC().Format(time.RFC3339)
	setMeetingProcessingStatus(meeting, db.ProcessingStatusCompleted, now, nil)
	if err := store.UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("update meeting: %w", err)
	}
	if err := emitter.emit(appRecordingCompletedEvent, *meeting, nil); err != nil {
		return err
	}

	if emitter == nil {
		fmt.Println("\n── Notes ───────────────────────────────")
		fmt.Println(summary)
		if len(extraction.ActionItems) > 0 {
			fmt.Printf("\n● %d action items extracted.\n", len(extraction.ActionItems))
		}
		fmt.Printf("● Saved: %s\n", meeting.ID)
	}
	return nil
}
