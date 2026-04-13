package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/grn-dev/grn/internal/capture"
	"github.com/grn-dev/grn/internal/db"
	"github.com/grn-dev/grn/internal/transcribe"
)

func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r):
			b.WriteRune(unicode.ToLower(r))
		case r == ' ', r == '_':
			b.WriteRune('-')
		case r == '-':
			b.WriteRune(r)
		}
	}
	return b.String()
}

func defaultModelPath() (string, error) {
	dir, err := grnDir()
	if err != nil {
		return "", fmt.Errorf("resolve grn dir for model path: %w", err)
	}
	return filepath.Join(dir, "models", "ggml-base.en.bin"), nil
}

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse time %q: %w", s, err)
	}
	return t, nil
}

func transcribeAs(ctx context.Context, audioPath, modelPath, speaker string) ([]transcribe.Segment, error) {
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		return nil, whisperModelNotFoundError(modelPath)
	}
	segs, err := transcribe.TranscribeFile(ctx, audioPath, modelPath)
	if err != nil {
		return nil, err
	}
	for i := range segs {
		segs[i].Speaker = speaker
	}
	return segs, nil
}

func whisperModelNotFoundError(modelPath string) error {
	defaultPath, err := defaultModelPath()
	if err == nil && modelPath == defaultPath {
		return fmt.Errorf("whisper model not found at %s (run: grn setup or pass --model)", modelPath)
	}
	return fmt.Errorf("whisper model not found at %s", modelPath)
}

func setMeetingCaptureStatus(meeting *db.Meeting, status db.CaptureStatus, updatedAt string, err error) {
	meeting.CaptureStatus = status
	meeting.CaptureStatusUpdatedAt = updatedAt
	meeting.CaptureFailureMessage = nil
	if err != nil {
		message := err.Error()
		meeting.CaptureFailureMessage = &message
	}
}

func setMeetingProcessingStatus(meeting *db.Meeting, status db.ProcessingStatus, updatedAt string, err error) {
	meeting.ProcessingStatus = status
	meeting.ProcessingStatusUpdatedAt = updatedAt
	meeting.ProcessingFailureMessage = nil
	if err != nil {
		message := err.Error()
		meeting.ProcessingFailureMessage = &message
	}
}

func saveProcessingFailure(store *db.DB, meeting *db.Meeting, origErr error, emitter *appRecordingEventEmitter) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if meeting.EndedAt == nil {
		meeting.EndedAt = &now
	}
	setMeetingProcessingStatus(meeting, db.ProcessingStatusFailed, now, origErr)
	updateErr := store.UpdateMeeting(meeting)
	if updateErr == nil && meeting.AudioPath != nil && emitter == nil {
		fmt.Printf("  session saved (audio may be incomplete — check %s)\n", *meeting.AudioPath)
	}
	if updateErr != nil {
		return errors.Join(
			fmt.Errorf("transcription failed: %w", origErr),
			fmt.Errorf("save partial meeting: %w", updateErr),
		)
	}
	if err := emitter.emit(appRecordingFailedEvent, *meeting, origErr); err != nil {
		return err
	}
	return fmt.Errorf("transcription failed: %w", origErr)
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

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Size() > 44
}

func hasCapturedAudio(recorder *capture.Recorder) bool {
	return fileExists(recorder.MicPath()) || fileExists(recorder.SystemPath())
}
