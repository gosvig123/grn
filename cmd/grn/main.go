package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/grn-dev/grn/internal/ai"
	"github.com/grn-dev/grn/internal/config"
	"github.com/grn-dev/grn/internal/db"
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
	}
	root.AddCommand(
		listenCmd(), devicesCmd(), meetingsCmd(), showCmd(),
		searchCmd(), actionsCmd(), ciCmd(),
		summarizeCmd(), setupCmd(), enhanceCmd(), appCmd(),
	)
	return root
}

func loadDeps() (config.Config, *db.DB, *ai.Pipeline, error) {
	cfg, store, err := loadStore()
	if err != nil {
		return cfg, nil, nil, err
	}
	provider, err := ai.NewProvider(cfg.AI)
	if err != nil {
		store.Close()
		return cfg, nil, nil, err
	}
	pipeline := ai.NewPipeline(provider, cfg.AI.Temp)
	return cfg, store, pipeline, nil
}

func loadStore() (config.Config, *db.DB, error) {
	cfg, err := config.Load()
	if err != nil {
		return cfg, nil, fmt.Errorf("load config: %w", err)
	}
	store, err := openDB(cfg)
	if err != nil {
		return cfg, nil, err
	}
	return cfg, store, nil
}

func openDB(cfg config.Config) (*db.DB, error) {
	if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	store, err := db.Open(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	if err := store.Init(); err != nil {
		store.Close()
		return nil, err
	}
	return store, nil
}

func grnDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".grn"), nil
}

func cmdContext() context.Context {
	return context.Background()
}

func writeJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func setupCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "setup",
		Short: "Check dependencies and initialize grn",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			fmt.Printf("Checking AI provider (%s)... ", cfg.AI.Provider)
			provider, err := ai.NewProvider(cfg.AI)
			if err != nil {
				fmt.Println("✗")
				return err
			}
			if err := provider.Available(); err != nil {
				fmt.Println("✗")
				return fmt.Errorf("%s not reachable: %w", cfg.AI.Provider, err)
			}
			fmt.Println("✓ connected to", cfg.AI.Endpoint)
			fmt.Println("  model:", cfg.AI.Model)

			fmt.Print("Initializing database... ")
			store, err := openDB(cfg)
			if err != nil {
				fmt.Println("✗")
				return err
			}
			store.Close()
			fmt.Println("✓", cfg.DBPath)
			fmt.Println("\nReady. Run `grn listen` to start.")
			return nil
		},
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
	cmd := &cobra.Command{Use: "actions", Short: "Manage action items"}
	cmd.AddCommand(
		&cobra.Command{Use: "list", Short: "List open action items"},
		&cobra.Command{Use: "done [id]", Short: "Mark complete", Args: cobra.ExactArgs(1)},
	)
	return cmd
}

func ciCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "ci", Short: "CI pipeline for action tracking"}
	cmd.AddCommand(
		&cobra.Command{Use: "status", Short: "Show CI pipeline status"},
		&cobra.Command{Use: "run", Short: "Trigger a CI check cycle now"},
	)
	return cmd
}
