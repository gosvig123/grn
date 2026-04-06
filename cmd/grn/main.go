package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func main() {
	if err := rootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "grn",
		Short: "Terminal-based meeting intelligence",
		Long:  "Capture, transcribe, summarize meetings and track action items to completion.",
	}

	root.AddCommand(
		listenCmd(),
		meetingsCmd(),
		showCmd(),
		searchCmd(),
		actionsCmd(),
		ciCmd(),
		summarizeCmd(),
	)

	return root
}

func listenCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "listen",
		Short: "Capture and transcribe system audio in real time",
	}
}

func meetingsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "meetings",
		Short: "List recorded meetings",
	}
}

func showCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show [meeting-id]",
		Short: "Display transcript, summary, and actions for a meeting",
		Args:  cobra.ExactArgs(1),
	}
}

func searchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "search [query]",
		Short: "Full-text search across transcripts and summaries",
		Args:  cobra.MinimumNArgs(1),
	}
}

func actionsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "actions",
		Short: "Manage action items extracted from meetings",
	}

	cmd.AddCommand(
		&cobra.Command{Use: "list", Short: "List open action items"},
		&cobra.Command{Use: "done [id]", Short: "Mark an action item complete", Args: cobra.ExactArgs(1)},
	)

	return cmd
}

func ciCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ci",
		Short: "Continuous integration pipeline for action tracking",
	}

	cmd.AddCommand(
		&cobra.Command{Use: "status", Short: "Show CI pipeline status"},
		&cobra.Command{Use: "run", Short: "Trigger a CI check cycle now"},
	)

	return cmd
}

func summarizeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "summarize [meeting-id]",
		Short: "Re-generate AI summary for a meeting",
		Args:  cobra.ExactArgs(1),
	}
}
