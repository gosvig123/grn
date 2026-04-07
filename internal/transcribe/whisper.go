package transcribe

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

type Segment struct {
	Start   float64
	End     float64
	Text    string
	Speaker string
}

type whisperOutput struct {
	Transcription []whisperSegment `json:"transcription"`
}

type whisperSegment struct {
	Timestamps struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"timestamps"`
	Text string `json:"text"`
}

var whisperTimestampPattern = regexp.MustCompile(`^\d{2}:\d{2}:\d{2},\d{3}$`)

func TranscribeFile(ctx context.Context, audioPath, modelPath string) ([]Segment, error) {
	bin, err := findWhisperBinary()
	if err != nil {
		return nil, err
	}
	out, err := runWhisper(ctx, bin, audioPath, modelPath)
	if err != nil {
		return nil, err
	}
	return parseWhisperJSON(out)
}

func findWhisperBinary() (string, error) {
	for _, name := range []string{"whisper-cli", "whisper-cpp", "whisper", "main"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("whisper-cpp not found in PATH (brew install whisper-cpp)")
}

func runWhisper(ctx context.Context, bin, audioPath, modelPath string) ([]byte, error) {
	args := []string{
		"-m", modelPath,
		"-f", audioPath,
		"-oj",
		"-of", "-",
		"-np",
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	out, err := cmd.Output()
	if err != nil {
		stderr := ""
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderr = string(exitErr.Stderr)
		}
		return nil, fmt.Errorf("whisper failed: %w\n%s", err, stderr)
	}
	return out, nil
}

func parseWhisperJSON(data []byte) ([]Segment, error) {
	jsonStart := findJSONStart(data)
	if jsonStart == -1 {
		return nil, fmt.Errorf("no JSON found in whisper output")
	}

	var wo whisperOutput
	if err := json.Unmarshal(data[jsonStart:], &wo); err != nil {
		return nil, fmt.Errorf("parse whisper JSON: %w", err)
	}

	segments := make([]Segment, 0, len(wo.Transcription))
	for i, ws := range wo.Transcription {
		start, err := parseTimestamp(ws.Timestamps.From)
		if err != nil {
			return nil, fmt.Errorf("parse whisper segment %d start timestamp: %w", i, err)
		}
		end, err := parseTimestamp(ws.Timestamps.To)
		if err != nil {
			return nil, fmt.Errorf("parse whisper segment %d end timestamp: %w", i, err)
		}
		if end < start {
			return nil, fmt.Errorf("parse whisper segment %d: end timestamp %q before start %q", i, ws.Timestamps.To, ws.Timestamps.From)
		}
		segments = append(segments, Segment{
			Start:   start,
			End:     end,
			Text:    strings.TrimSpace(ws.Text),
			Speaker: "You",
		})
	}
	return segments, nil
}

func findJSONStart(data []byte) int {
	for i, b := range data {
		if b == '{' {
			return i
		}
	}
	return -1
}

func parseTimestamp(ts string) (float64, error) {
	ts = strings.TrimSpace(ts)
	if !whisperTimestampPattern.MatchString(ts) {
		return 0, fmt.Errorf("invalid timestamp format: %q", ts)
	}

	var h, m, s, ms int
	if _, err := fmt.Sscanf(ts, "%02d:%02d:%02d,%03d", &h, &m, &s, &ms); err != nil {
		return 0, fmt.Errorf("parse timestamp %q: %w", ts, err)
	}
	if m > 59 || s > 59 {
		return 0, fmt.Errorf("invalid timestamp value: %q", ts)
	}
	return float64(h)*3600 + float64(m)*60 + float64(s) + float64(ms)/1000, nil
}
