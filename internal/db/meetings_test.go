package db

import (
	"testing"
)

func TestMeetingLifecycleRoundTrip(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()

	meeting := &Meeting{
		Title:           "Sprint planning",
		StartedAt:       "2026-04-10T12:00:00Z",
		Status:          MeetingStatusRecording,
		StatusUpdatedAt: "2026-04-10T12:00:00Z",
		Tags:            "[]",
		Source:          "listen",
	}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}

	endedAt := "2026-04-10T12:30:00Z"
	failure := "enhance failed"
	transcript := "[You] hello"
	meeting.EndedAt = &endedAt
	meeting.Transcript = &transcript
	meeting.Status = MeetingStatusFailed
	meeting.StatusUpdatedAt = endedAt
	meeting.FailureMessage = &failure
	if err := store.UpdateMeeting(meeting); err != nil {
		t.Fatalf("UpdateMeeting() error = %v", err)
	}

	got, err := store.GetMeeting(meeting.ID)
	if err != nil {
		t.Fatalf("GetMeeting() error = %v", err)
	}
	if got.Status != MeetingStatusFailed {
		t.Fatalf("status = %q, want %q", got.Status, MeetingStatusFailed)
	}
	if got.StatusUpdatedAt != endedAt {
		t.Fatalf("status_updated_at = %q, want %q", got.StatusUpdatedAt, endedAt)
	}
	if got.FailureMessage == nil || *got.FailureMessage != failure {
		t.Fatalf("failure_message = %v, want %q", got.FailureMessage, failure)
	}

	meetings, err := store.ListMeetings(10)
	if err != nil {
		t.Fatalf("ListMeetings() error = %v", err)
	}
	if len(meetings) != 1 {
		t.Fatalf("len(ListMeetings()) = %d, want 1", len(meetings))
	}
	if meetings[0].Status != MeetingStatusFailed {
		t.Fatalf("list status = %q, want %q", meetings[0].Status, MeetingStatusFailed)
	}
}

func TestInitUpgradesExistingMeetingsLifecycle(t *testing.T) {
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	_, err = store.Conn.Exec(`CREATE TABLE meetings (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		started_at TEXT NOT NULL,
		ended_at TEXT,
		audio_path TEXT,
		transcript TEXT,
		summary TEXT,
		tags TEXT NOT NULL DEFAULT '[]',
		source TEXT NOT NULL DEFAULT 'manual',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	)`)
	if err != nil {
		t.Fatalf("create old meetings table: %v", err)
	}
	_, err = store.Conn.Exec(`INSERT INTO meetings (id, title, started_at, ended_at, transcript, summary, tags, source) VALUES
		('completed-1', 'Done', '2026-04-10T09:00:00Z', '2026-04-10T10:00:00Z', 'Transcript', 'Summary', '[]', 'listen'),
		('failed-1', 'Partial', '2026-04-10T11:00:00Z', '2026-04-10T12:00:00Z', 'Transcript', NULL, '[]', 'listen'),
		('recording-1', 'Live', '2026-04-10T13:00:00Z', NULL, NULL, NULL, '[]', 'listen')`)
	if err != nil {
		t.Fatalf("insert old meetings: %v", err)
	}

	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}

	completed, err := store.GetMeeting("completed-1")
	if err != nil {
		t.Fatalf("GetMeeting(completed-1) error = %v", err)
	}
	if completed.Status != MeetingStatusCompleted {
		t.Fatalf("completed status = %q, want %q", completed.Status, MeetingStatusCompleted)
	}

	failed, err := store.GetMeeting("failed-1")
	if err != nil {
		t.Fatalf("GetMeeting(failed-1) error = %v", err)
	}
	if failed.Status != MeetingStatusFailed {
		t.Fatalf("failed status = %q, want %q", failed.Status, MeetingStatusFailed)
	}

	recording, err := store.GetMeeting("recording-1")
	if err != nil {
		t.Fatalf("GetMeeting(recording-1) error = %v", err)
	}
	if recording.Status != MeetingStatusRecording {
		t.Fatalf("recording status = %q, want %q", recording.Status, MeetingStatusRecording)
	}
	if recording.StatusUpdatedAt != recording.StartedAt {
		t.Fatalf("recording status_updated_at = %q, want %q", recording.StatusUpdatedAt, recording.StartedAt)
	}
}


func TestInitPreservesExistingStatusWhenOnlyTimestampNeedsBackfill(t *testing.T) {
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	_, err = store.Conn.Exec(`CREATE TABLE meetings (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		started_at TEXT NOT NULL,
		ended_at TEXT,
		status TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'processing', 'completed', 'failed')),
		status_updated_at TEXT NOT NULL DEFAULT '',
		failure_message TEXT,
		audio_path TEXT,
		transcript TEXT,
		summary TEXT,
		tags TEXT NOT NULL DEFAULT '[]',
		source TEXT NOT NULL DEFAULT 'manual',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	)`)
	if err != nil {
		t.Fatalf("create partially upgraded meetings table: %v", err)
	}
	_, err = store.Conn.Exec(`INSERT INTO meetings (id, title, started_at, ended_at, status, status_updated_at, transcript, summary, tags, source) VALUES
		('processing-1', 'Queued', '2026-04-10T14:00:00Z', '2026-04-10T14:15:00Z', 'processing', '', 'Transcript', NULL, '[]', 'listen')`)
	if err != nil {
		t.Fatalf("insert partially upgraded meeting: %v", err)
	}

	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}

	meeting, err := store.GetMeeting("processing-1")
	if err != nil {
		t.Fatalf("GetMeeting(processing-1) error = %v", err)
	}
	if meeting.Status != MeetingStatusProcessing {
		t.Fatalf("status = %q, want %q", meeting.Status, MeetingStatusProcessing)
	}
	if meeting.StatusUpdatedAt != "2026-04-10T14:15:00Z" {
		t.Fatalf("status_updated_at = %q, want %q", meeting.StatusUpdatedAt, "2026-04-10T14:15:00Z")
	}
}

func openTestDB(t *testing.T) *DB {
	t.Helper()
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err := store.Init(); err != nil {
		store.Close()
		t.Fatalf("Init() error = %v", err)
	}
	return store
}
