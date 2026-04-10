package main

import (
	"encoding/json"
	"os"

	"github.com/grn-dev/grn/internal/db"
)

type appDevicesResponse struct {
	Devices []captureDevice `json:"devices"`
}

type captureDevice struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
}

type appMeetingsResponse struct {
	Meetings []appMeetingListItem `json:"meetings"`
}

type appMeetingStatus struct {
	State      appMeetingState      `json:"state"`
	UpdatedAt  string               `json:"updatedAt"`
	Capture    appMeetingStatusInfo `json:"capture"`
	Processing appMeetingStatusInfo `json:"processing"`
}

type appMeetingState string

const (
	appMeetingStateRecording  appMeetingState = "recording"
	appMeetingStateCaptured   appMeetingState = "captured"
	appMeetingStateProcessing appMeetingState = "processing"
	appMeetingStateCompleted  appMeetingState = "completed"
	appMeetingStateFailed     appMeetingState = "failed"
)

type appMeetingStatusInfo struct {
	State          string  `json:"state"`
	UpdatedAt      string  `json:"updatedAt"`
	FailureMessage *string `json:"failureMessage,omitempty"`
}

type appMeetingListItem struct {
	ID            string           `json:"id"`
	Title         string           `json:"title"`
	StartedAt     string           `json:"startedAt"`
	EndedAt       *string          `json:"endedAt,omitempty"`
	Status        appMeetingStatus `json:"status"`
	HasTranscript bool             `json:"hasTranscript"`
	HasSummary    bool             `json:"hasSummary"`
}

type appMeetingResponse struct {
	Meeting appMeetingDetail `json:"meeting"`
}

type appMeetingDetail struct {
	ID             string              `json:"id"`
	Title          string              `json:"title"`
	StartedAt      string              `json:"startedAt"`
	EndedAt        *string             `json:"endedAt,omitempty"`
	Status         appMeetingStatus    `json:"status"`
	TranscriptText string              `json:"transcriptText,omitempty"`
	Summary        string              `json:"summary,omitempty"`
	Segments       []appMeetingSegment `json:"segments"`
}

type appMeetingSegment struct {
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
	Speaker  string  `json:"speaker"`
	Text     string  `json:"text"`
}

type appRecordingEventName string

const (
	appRecordingStartedEvent    appRecordingEventName = "recording.started"
	appRecordingStoppingEvent   appRecordingEventName = "recording.stopping"
	appRecordingProcessingEvent appRecordingEventName = "recording.processing"
	appRecordingCompletedEvent  appRecordingEventName = "recording.completed"
	appRecordingFailedEvent     appRecordingEventName = "recording.failed"
)

type appRecordingEvent struct {
	Type      appRecordingEventName `json:"type"`
	MeetingID string                `json:"meetingId"`
	Title     string                `json:"title"`
	Status    appMeetingStatus      `json:"status"`
	Error     *string               `json:"error,omitempty"`
}

type appRecordingEventEmitter struct {
	enc *json.Encoder
}

func newAppRecordingEventEmitter(enabled bool) *appRecordingEventEmitter {
	if !enabled {
		return nil
	}
	return &appRecordingEventEmitter{enc: json.NewEncoder(os.Stdout)}
}

func (e *appRecordingEventEmitter) emit(name appRecordingEventName, meeting db.Meeting, err error) error {
	if e == nil {
		return nil
	}
	event := appRecordingEvent{
		Type:      name,
		MeetingID: meeting.ID,
		Title:     meeting.Title,
		Status:    appMeetingStatusFor(meeting),
	}
	if err != nil {
		message := err.Error()
		event.Error = &message
	}
	return e.enc.Encode(event)
}

func appMeetingStatusFor(meeting db.Meeting) appMeetingStatus {
	state := meetingState(meeting)
	updatedAt := meeting.CaptureStatusUpdatedAt
	if meeting.ProcessingStatus == db.ProcessingStatusFailed || state == appMeetingStateProcessing || state == appMeetingStateCompleted {
		updatedAt = meeting.ProcessingStatusUpdatedAt
	}
	return appMeetingStatus{
		State:     state,
		UpdatedAt: updatedAt,
		Capture: appMeetingStatusInfo{
			State:          string(meeting.CaptureStatus),
			UpdatedAt:      meeting.CaptureStatusUpdatedAt,
			FailureMessage: meeting.CaptureFailureMessage,
		},
		Processing: appMeetingStatusInfo{
			State:          string(meeting.ProcessingStatus),
			UpdatedAt:      meeting.ProcessingStatusUpdatedAt,
			FailureMessage: meeting.ProcessingFailureMessage,
		},
	}
}

func meetingState(meeting db.Meeting) appMeetingState {
	switch {
	case meeting.CaptureStatus == db.CaptureStatusFailed:
		return appMeetingStateFailed
	case meeting.CaptureStatus == db.CaptureStatusRecording:
		return appMeetingStateRecording
	case meeting.ProcessingStatus == db.ProcessingStatusFailed:
		return appMeetingStateFailed
	case meeting.ProcessingStatus == db.ProcessingStatusProcessing:
		return appMeetingStateProcessing
	case meeting.ProcessingStatus == db.ProcessingStatusCompleted:
		return appMeetingStateCompleted
	default:
		return appMeetingStateCaptured
	}
}
