package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/grn-dev/grn/internal/db"
)

func TestFailMeetingCapturePersistsFailureAndEmitsMeetingID(t *testing.T) {
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}

	meeting := &db.Meeting{
		ID:                        "meeting-start-failure",
		Title:                     "Start failure",
		StartedAt:                 "2026-04-10T12:00:00Z",
		CaptureStatus:             db.CaptureStatusRecording,
		CaptureStatusUpdatedAt:    "2026-04-10T12:00:00Z",
		ProcessingStatus:          db.ProcessingStatusNotStarted,
		ProcessingStatusUpdatedAt: "2026-04-10T12:00:00Z",
		Tags:                      "[]",
		Source:                    "listen",
	}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}

	originalStdout := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() error = %v", err)
	}
	os.Stdout = writer
	t.Cleanup(func() {
		os.Stdout = originalStdout
	})

	emitter := newAppRecordingEventEmitter(true)
	startErr := errors.New("start capture: boom")
	if err := failMeetingCapture(store, meeting, startErr, emitter); err != nil {
		t.Fatalf("failMeetingCapture() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close() error = %v", err)
	}

	stored, err := store.GetMeeting(meeting.ID)
	if err != nil {
		t.Fatalf("GetMeeting() error = %v", err)
	}
	if stored.CaptureStatus != db.CaptureStatusFailed {
		t.Fatalf("capture_status = %q, want %q", stored.CaptureStatus, db.CaptureStatusFailed)
	}
	if stored.CaptureFailureMessage == nil || *stored.CaptureFailureMessage != startErr.Error() {
		t.Fatalf("capture_failure_message = %v, want %q", stored.CaptureFailureMessage, startErr.Error())
	}
	if stored.EndedAt == nil || *stored.EndedAt == "" {
		t.Fatal("ended_at = nil or empty, want terminal timestamp")
	}
	if stored.ProcessingStatus != db.ProcessingStatusNotStarted {
		t.Fatalf("processing_status = %q, want %q", stored.ProcessingStatus, db.ProcessingStatusNotStarted)
	}

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(reader); err != nil {
		t.Fatalf("ReadFrom() error = %v", err)
	}

	var event appRecordingEvent
	if err := json.Unmarshal(buf.Bytes(), &event); err != nil {
		t.Fatalf("json.Unmarshal() error = %v\noutput=%s", err, buf.String())
	}
	if event.Type != appRecordingFailedEvent {
		t.Fatalf("event.type = %q, want %q", event.Type, appRecordingFailedEvent)
	}
	if event.MeetingID != meeting.ID {
		t.Fatalf("event.meetingId = %q, want %q", event.MeetingID, meeting.ID)
	}
	if event.Error == nil || *event.Error != startErr.Error() {
		t.Fatalf("event.error = %v, want %q", event.Error, startErr.Error())
	}
	if event.Status.Capture.State != string(db.CaptureStatusFailed) {
		t.Fatalf("event.status.capture.state = %q, want %q", event.Status.Capture.State, db.CaptureStatusFailed)
	}
}
