package main

import "github.com/grn-dev/grn/internal/db"

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
	State          db.MeetingStatus `json:"state"`
	UpdatedAt      string           `json:"updatedAt"`
	FailureMessage *string          `json:"failureMessage,omitempty"`
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

func appMeetingStatusFor(meeting db.Meeting) appMeetingStatus {
	return appMeetingStatus{
		State:          meeting.Status,
		UpdatedAt:      meeting.StatusUpdatedAt,
		FailureMessage: meeting.FailureMessage,
	}
}
