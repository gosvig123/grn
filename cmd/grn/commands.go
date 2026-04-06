package main

import (
	"fmt"
	"strings"

	"github.com/grn-dev/grn/internal/ai"
	"github.com/grn-dev/grn/internal/db"
	"github.com/spf13/cobra"
)

func enhanceCmd() *cobra.Command {
	var notes string
	cmd := &cobra.Command{
		Use:   "enhance [meeting-id]",
		Short: "Run AI extraction and synthesis on a meeting transcript",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, store, pipeline, err := loadDeps()
			if err != nil {
				return err
			}
			defer store.Close()
			return runEnhance(store, pipeline, args[0], notes)
		},
	}
	cmd.Flags().StringVarP(&notes, "notes", "n", "", "Your rough notes")
	return cmd
}

func runEnhance(store *db.DB, pipeline *ai.Pipeline, id, notes string) error {
	segments, err := store.GetSegments(id)
	if err != nil {
		return fmt.Errorf("get segments: %w", err)
	}
	if len(segments) == 0 {
		return fmt.Errorf("no segments found for meeting %s", id)
	}
	transcript := formatTranscript(segments)

	fmt.Println("Extracting structure...")
	extraction, summary, err := pipeline.Run(cmdContext(), transcript, notes)
	if err != nil {
		return fmt.Errorf("pipeline: %w", err)
	}

	meeting, err := store.GetMeeting(id)
	if err != nil {
		return fmt.Errorf("get meeting: %w", err)
	}
	meeting.Transcript = &transcript
	meeting.Summary = &summary
	if err := store.UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("update meeting: %w", err)
	}

	fmt.Println(summary)
	fmt.Printf("\n%d action items extracted.\n", len(extraction.ActionItems))
	return nil
}

func formatTranscript(segments []db.Segment) string {
	var b strings.Builder
	for _, s := range segments {
		fmt.Fprintf(&b, "[%s] %s\n", s.Speaker, s.Text)
	}
	return b.String()
}

func meetingsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "meetings",
		Short: "List recorded meetings",
		RunE: func(cmd *cobra.Command, args []string) error {
			_, store, _, err := loadDeps()
			if err != nil {
				return err
			}
			defer store.Close()
			return listMeetings(store)
		},
	}
}

func listMeetings(store *db.DB) error {
	meetings, err := store.ListMeetings(20)
	if err != nil {
		return err
	}
	if len(meetings) == 0 {
		fmt.Println("No meetings yet. Run `grn listen` to record one.")
		return nil
	}
	for _, m := range meetings {
		status := "○"
		if m.Summary != nil {
			status = "●"
		}
		fmt.Printf("  %s %s  %s  %s\n", status, m.ID[:8], m.StartedAt[:10], m.Title)
	}
	return nil
}

func showCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show [meeting-id]",
		Short: "Display transcript, summary, and actions for a meeting",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, store, _, err := loadDeps()
			if err != nil {
				return err
			}
			defer store.Close()
			return showMeeting(store, args[0])
		},
	}
}

func showMeeting(store *db.DB, id string) error {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return fmt.Errorf("meeting not found: %w", err)
	}
	fmt.Printf("# %s\n", meeting.Title)
	fmt.Printf("Date: %s\n\n", meeting.StartedAt)
	if meeting.Summary != nil {
		fmt.Println(*meeting.Summary)
	} else {
		fmt.Println("No summary yet. Run `grn enhance " + id + "`")
	}
	return nil
}

func summarizeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "summarize [meeting-id]",
		Short: "Re-generate AI summary (alias for enhance)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, store, pipeline, err := loadDeps()
			if err != nil {
				return err
			}
			defer store.Close()
			return runEnhance(store, pipeline, args[0], "")
		},
	}
}
