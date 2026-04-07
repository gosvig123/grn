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
		return nil, fmt.Errorf("whisper model not found at %s (download with: grn setup)", modelPath)
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

func savePartial(store *db.DB, meeting *db.Meeting, origErr error) error {
	now := time.Now().UTC().Format(time.RFC3339)
	meeting.EndedAt = &now
	updateErr := store.UpdateMeeting(meeting)
	if updateErr == nil && meeting.AudioPath != nil {
		fmt.Printf("  session saved (audio may be incomplete — check %s)\n", *meeting.AudioPath)
	}
	if updateErr != nil {
		return errors.Join(
			fmt.Errorf("transcription failed: %w", origErr),
			fmt.Errorf("save partial meeting: %w", updateErr),
		)
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
