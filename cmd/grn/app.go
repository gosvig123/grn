package main

import (
	"fmt"

	"github.com/grn-dev/grn/internal/capture"
	"github.com/grn-dev/grn/internal/db"
	"github.com/spf13/cobra"
)

func appCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "app",
		Short: "Machine-readable commands for the desktop app",
	}
	cmd.AddCommand(appDevicesCmd(), appMeetingsCmd(), appRecordCmd())
	return cmd
}

func appDevicesCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "devices",
		Short: "List available audio input devices as JSON",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app devices requires --json")
			}
			devices, err := capture.ListAudioDevices()
			if err != nil {
				return err
			}
			out := make([]captureDevice, 0, len(devices))
			for _, device := range devices {
				out = append(out, captureDevice{Index: device.Index, Name: device.Name})
			}
			return writeJSON(appDevicesResponse{Devices: out})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appMeetingsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "meetings",
		Short: "Machine-readable meeting access",
	}
	cmd.AddCommand(appMeetingsListCmd(), appMeetingsShowCmd())
	return cmd
}

func appRecordCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "record",
		Short: "Machine-readable recording entrypoints",
	}
	cmd.AddCommand(appRecordStartCmd())
	return cmd
}

func appRecordStartCmd() *cobra.Command {
	var deviceIdx int
	var title string
	var modelPath string
	var mode string

	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start a recording for the desktop app",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runListen(deviceIdx, title, modelPath, capture.CaptureMode(mode))
		},
	}
	cmd.Flags().IntVar(&deviceIdx, "device", 0, "Audio device index")
	cmd.Flags().StringVar(&title, "title", "", "Session title")
	cmd.Flags().StringVar(&modelPath, "model", "", "Whisper model path")
	cmd.Flags().StringVar(&mode, "mode", string(capture.ModeBoth), "Capture mode: mic, system, or both")
	return cmd
}

func appMeetingsListCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List saved meetings as JSON",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app meetings list requires --json")
			}
			_, store, err := loadStore()
			if err != nil {
				return err
			}
			defer store.Close()
			meetings, err := store.ListMeetings(50)
			if err != nil {
				return err
			}
			items := make([]appMeetingListItem, 0, len(meetings))
			for _, meeting := range meetings {
				items = append(items, appMeetingListItem{
					ID:            meeting.ID,
					Title:         meeting.Title,
					StartedAt:     meeting.StartedAt,
					EndedAt:       meeting.EndedAt,
					Status:        appMeetingStatusFor(meeting),
					HasTranscript: meeting.Transcript != nil,
					HasSummary:    meeting.Summary != nil,
				})
			}
			return writeJSON(appMeetingsResponse{Meetings: items})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appMeetingsShowCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "show [meeting-id]",
		Short: "Show a meeting with transcript and summary as JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app meetings show requires --json")
			}
			_, store, err := loadStore()
			if err != nil {
				return err
			}
			defer store.Close()
			detail, err := appMeetingDetailFor(store, args[0])
			if err != nil {
				return err
			}
			return writeJSON(appMeetingResponse{Meeting: detail})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appMeetingDetailFor(store *db.DB, id string) (appMeetingDetail, error) {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return appMeetingDetail{}, err
	}
	segments, err := store.GetSegments(id)
	if err != nil {
		return appMeetingDetail{}, err
	}
	transcriptText := ""
	if meeting.Transcript != nil {
		transcriptText = *meeting.Transcript
	} else if len(segments) > 0 {
		transcriptText = formatTranscript(segments)
	}
	summary := ""
	if meeting.Summary != nil {
		summary = *meeting.Summary
	}
	outSegments := make([]appMeetingSegment, 0, len(segments))
	for _, segment := range segments {
		outSegments = append(outSegments, appMeetingSegment{
			StartSec: segment.Start,
			EndSec:   segment.End,
			Speaker:  segment.Speaker,
			Text:     segment.Text,
		})
	}
	return appMeetingDetail{
		ID:             meeting.ID,
		Title:          meeting.Title,
		StartedAt:      meeting.StartedAt,
		EndedAt:        meeting.EndedAt,
		Status:         appMeetingStatusFor(*meeting),
		TranscriptText: transcriptText,
		Summary:        summary,
		Segments:       outSegments,
	}, nil
}
