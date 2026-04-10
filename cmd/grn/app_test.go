package main

import (
	"testing"

	"github.com/grn-dev/grn/internal/db"
)

func TestAppMeetingDetailForIncludesStructuredStatus(t *testing.T) {
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}

	meeting := &db.Meeting{
		ID:              "meeting-1",
		Title:           "Customer call",
		StartedAt:       "2026-04-10T12:00:00Z",
		Status:          db.MeetingStatusFailed,
		StatusUpdatedAt: "2026-04-10T12:45:00Z",
		Tags:            "[]",
		Source:          "listen",
	}
	failure := "summary generation failed"
	meeting.FailureMessage = &failure
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	if err := store.InsertSegment(&db.Segment{MeetingID: meeting.ID, Start: 0, End: 1, Speaker: "You", Text: "hello"}); err != nil {
		t.Fatalf("InsertSegment() error = %v", err)
	}

	detail, err := appMeetingDetailFor(store, meeting.ID)
	if err != nil {
		t.Fatalf("appMeetingDetailFor() error = %v", err)
	}
	if detail.Status.State != db.MeetingStatusFailed {
		t.Fatalf("status.state = %q, want %q", detail.Status.State, db.MeetingStatusFailed)
	}
	if detail.Status.UpdatedAt != meeting.StatusUpdatedAt {
		t.Fatalf("status.updatedAt = %q, want %q", detail.Status.UpdatedAt, meeting.StatusUpdatedAt)
	}
	if detail.Status.FailureMessage == nil || *detail.Status.FailureMessage != failure {
		t.Fatalf("status.failureMessage = %v, want %q", detail.Status.FailureMessage, failure)
	}
	if detail.TranscriptText == "" {
		t.Fatal("transcriptText = empty, want fallback transcript from segments")
	}
}
