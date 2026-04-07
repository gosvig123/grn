package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/grn-dev/grn/internal/db"
	"github.com/grn-dev/grn/internal/transcribe"
)

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

func transcribeAs(audioPath, modelPath, speaker string) ([]transcribe.Segment, error) {
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("whisper model not found at %s (download with: grn setup)", modelPath)
	}
	segs, err := transcribe.TranscribeFile(audioPath, modelPath)
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
	store.UpdateMeeting(meeting)
	if meeting.AudioPath != nil {
		fmt.Printf("  session saved (audio may be incomplete — check %s)\n", *meeting.AudioPath)
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
