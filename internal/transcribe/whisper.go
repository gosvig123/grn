package transcribe

import (
	"encoding/json"
	"fmt"
	"os/exec"
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

func TranscribeFile(audioPath, modelPath string) ([]Segment, error) {
	bin, err := findWhisperBinary()
	if err != nil {
		return nil, err
	}
	out, err := runWhisper(bin, audioPath, modelPath)
	if err != nil {
		return nil, err
	}
	return parseWhisperJSON(out)
}

func findWhisperBinary() (string, error) {
	for _, name := range []string{"whisper-cpp", "whisper", "main"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("whisper-cpp not found in PATH (brew install whisper-cpp)")
}

func runWhisper(bin, audioPath, modelPath string) ([]byte, error) {
	args := []string{
		"-m", modelPath,
		"-f", audioPath,
		"-oj",
		"-of", "-",
		"-np",
	}
	cmd := exec.Command(bin, args...)
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
	for _, ws := range wo.Transcription {
		segments = append(segments, Segment{
			Start:   parseTimestamp(ws.Timestamps.From),
			End:     parseTimestamp(ws.Timestamps.To),
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

func parseTimestamp(ts string) float64 {
	ts = strings.TrimSpace(ts)
	var h, m, s, ms int
	fmt.Sscanf(ts, "%d:%d:%d,%d", &h, &m, &s, &ms)
	return float64(h)*3600 + float64(m)*60 + float64(s) + float64(ms)/1000
}
