package transcribe

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseTimestampValid(t *testing.T) {
	got, err := parseTimestamp("01:02:03,456")
	if err != nil {
		t.Fatalf("parseTimestamp returned error: %v", err)
	}

	want := 3723.456
	if got != want {
		t.Fatalf("parseTimestamp = %v, want %v", got, want)
	}
}

func TestParseTimestampMalformed(t *testing.T) {
	_, err := parseTimestamp("1:02:03.456")
	if err == nil {
		t.Fatal("parseTimestamp succeeded for malformed timestamp")
	}
	if !strings.Contains(err.Error(), "invalid timestamp format") {
		t.Fatalf("parseTimestamp error = %q, want invalid format", err)
	}
}

func TestParseWhisperJSONRejectsEndBeforeStart(t *testing.T) {
	data := []byte(`{"transcription":[{"timestamps":{"from":"00:00:02,000","to":"00:00:01,500"},"text":" hello "}]}`)

	_, err := parseWhisperJSON(data)
	if err == nil {
		t.Fatal("parseWhisperJSON succeeded for invalid segment ordering")
	}
	if !strings.Contains(err.Error(), "before start") {
		t.Fatalf("parseWhisperJSON error = %q, want end-before-start message", err)
	}
}

func TestFindWhisperBinaryUsesEnvOverride(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "whisper-bundle")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	t.Setenv("GRN_WHISPER_BIN", bin)
	t.Setenv("PATH", "")

	got, err := findWhisperBinary()
	if err != nil {
		t.Fatalf("findWhisperBinary returned error: %v", err)
	}
	if got != bin {
		t.Fatalf("findWhisperBinary = %q, want %q", got, bin)
	}
}

func TestFindWhisperBinaryRejectsInvalidEnvOverride(t *testing.T) {
	t.Setenv("GRN_WHISPER_BIN", filepath.Join(t.TempDir(), "missing-whisper"))
	t.Setenv("PATH", "")

	_, err := findWhisperBinary()
	if err == nil {
		t.Fatal("findWhisperBinary succeeded for missing override")
	}
	if !strings.Contains(err.Error(), "override not found") {
		t.Fatalf("findWhisperBinary error = %q, want override-not-found message", err)
	}
}

func TestFindWhisperBinaryRejectsNonExecutableEnvOverride(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "whisper-bundle")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	t.Setenv("GRN_WHISPER_BIN", bin)
	t.Setenv("PATH", "")

	_, err := findWhisperBinary()
	if err == nil {
		t.Fatal("findWhisperBinary succeeded for non-executable override")
	}
	if !strings.Contains(err.Error(), "not an executable file") {
		t.Fatalf("findWhisperBinary error = %q, want non-executable message", err)
	}
}

func TestFindWhisperBinaryFallsBackToPath(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "whisper-cli")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	t.Setenv("GRN_WHISPER_BIN", "")
	t.Setenv("PATH", dir)

	got, err := findWhisperBinary()
	if err != nil {
		t.Fatalf("findWhisperBinary returned error: %v", err)
	}
	if got != bin {
		t.Fatalf("findWhisperBinary = %q, want %q", got, bin)
	}
}
