package db

import (
	"database/sql"
	"fmt"
)

type MeetingStatus string

const (
	MeetingStatusRecording  MeetingStatus = "recording"
	MeetingStatusProcessing MeetingStatus = "processing"
	MeetingStatusCompleted  MeetingStatus = "completed"
	MeetingStatusFailed     MeetingStatus = "failed"
)

type Meeting struct {
	ID              string
	Title           string
	StartedAt       string
	EndedAt         *string
	Status          MeetingStatus
	StatusUpdatedAt string
	FailureMessage  *string
	AudioPath       *string
	Transcript      *string
	Summary         *string
	Tags            string
	Source          string
	CreatedAt       string
}

func (d *DB) CreateMeeting(m *Meeting) error {
	if m.ID == "" {
		id, err := newID()
		if err != nil {
			return err
		}
		m.ID = id
	}
	_, err := d.Conn.Exec(
		`INSERT INTO meetings (
			id, title, started_at, ended_at, status, status_updated_at, failure_message,
			audio_path, transcript, summary, tags, source
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.Title, m.StartedAt, m.EndedAt, m.Status, m.StatusUpdatedAt, m.FailureMessage,
		m.AudioPath, m.Transcript, m.Summary, m.Tags, m.Source,
	)
	if err != nil {
		return fmt.Errorf("create meeting: %w", err)
	}
	return nil
}

func (d *DB) UpdateMeeting(m *Meeting) error {
	_, err := d.Conn.Exec(
		`UPDATE meetings SET title=?, started_at=?, ended_at=?, status=?, status_updated_at=?,
		 failure_message=?, audio_path=?, transcript=?, summary=?, tags=?, source=? WHERE id=?`,
		m.Title, m.StartedAt, m.EndedAt, m.Status, m.StatusUpdatedAt,
		m.FailureMessage, m.AudioPath, m.Transcript, m.Summary, m.Tags, m.Source, m.ID,
	)
	if err != nil {
		return fmt.Errorf("update meeting: %w", err)
	}
	return nil
}

func (d *DB) GetMeeting(id string) (*Meeting, error) {
	row := d.Conn.QueryRow(
		`SELECT id, title, started_at, ended_at, status, status_updated_at, failure_message,
		 audio_path, transcript, summary, tags, source, created_at
		 FROM meetings WHERE id=?`, id,
	)
	m := &Meeting{}
	err := row.Scan(
		&m.ID, &m.Title, &m.StartedAt, &m.EndedAt, &m.Status, &m.StatusUpdatedAt, &m.FailureMessage,
		&m.AudioPath, &m.Transcript, &m.Summary, &m.Tags, &m.Source, &m.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get meeting: %w", err)
	}
	return m, nil
}

func (d *DB) ListMeetings(limit int) ([]Meeting, error) {
	rows, err := d.Conn.Query(
		`SELECT id, title, started_at, ended_at, status, status_updated_at, failure_message,
		 audio_path, transcript, summary, tags, source, created_at
		 FROM meetings ORDER BY started_at DESC LIMIT ?`, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list meetings: %w", err)
	}
	defer rows.Close()
	return scanMeetings(rows)
}

func scanMeetings(rows *sql.Rows) ([]Meeting, error) {
	var meetings []Meeting
	for rows.Next() {
		var m Meeting
		err := rows.Scan(
			&m.ID, &m.Title, &m.StartedAt, &m.EndedAt, &m.Status, &m.StatusUpdatedAt, &m.FailureMessage,
			&m.AudioPath, &m.Transcript, &m.Summary, &m.Tags, &m.Source, &m.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan meeting: %w", err)
		}
		meetings = append(meetings, m)
	}
	return meetings, rows.Err()
}
