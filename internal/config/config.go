package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type Audio struct {
	Backend    string `toml:"backend"`
	SampleRate int    `toml:"sample_rate"`
	Channels   int    `toml:"channels"`
}

type Transcription struct {
	Engine   string `toml:"engine"`
	Model    string `toml:"model"`
	Language string `toml:"language"`
	APIKey   string `toml:"api_key"`
	Endpoint string `toml:"endpoint"`
}

type AI struct {
	Provider string  `toml:"provider"`
	Model    string  `toml:"model"`
	APIKey   string  `toml:"api_key"`
	Endpoint string  `toml:"endpoint"`
	Temp     float64 `toml:"temperature"`
}

type CI struct {
	Enabled       bool     `toml:"enabled"`
	PollInterval  string   `toml:"poll_interval"`
	Reminders     bool     `toml:"reminders"`
	WatchedRepos  []string `toml:"watched_repos"`
	NotifyCommand string   `toml:"notify_command"`
}

type Integrations struct {
	CalendarURL string `toml:"calendar_url"`
	SlackToken  string `toml:"slack_token"`
	GitHubToken string `toml:"github_token"`
}

type Config struct {
	DBPath        string        `toml:"db_path"`
	Audio         Audio         `toml:"audio"`
	Transcription Transcription `toml:"transcription"`
	AI            AI            `toml:"ai"`
	CI            CI            `toml:"ci"`
	Integrations  Integrations  `toml:"integrations"`
}

func defaults() Config {
	return Config{
		DBPath: filepath.Join(grnDir(), "db.sqlite"),
		Audio: Audio{
			Backend:    "screencapturekit",
			SampleRate: 16000,
			Channels:   1,
		},
		Transcription: Transcription{
			Engine:   "whisper-local",
			Model:    "base.en",
			Language: "en",
		},
		AI: AI{
			Provider: "ollama",
			Model:    "llama3.1:8b",
			Endpoint: "http://localhost:11434",
			Temp:     0.3,
		},
		CI: CI{
			Enabled:      false,
			PollInterval: "15m",
			Reminders:    true,
		},
	}
}

func Load() (Config, error) {
	cfg := defaults()

	path := filepath.Join(grnDir(), "config.toml")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return cfg, nil
	}

	meta, err := toml.DecodeFile(path, &cfg)
	if err != nil {
		return Config{}, err
	}

	for _, key := range meta.Undecoded() {
		fmt.Fprintf(os.Stderr, "warning: unknown config key %q in %s\n", key, path)
	}

	return cfg, nil
}

func grnDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".grn")
}
