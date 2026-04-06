package capture

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
)

type Recorder struct {
	deviceIndex int
	outPath     string
	cmd         *exec.Cmd
}

func NewRecorder(deviceIndex int, outPath string) *Recorder {
	return &Recorder{deviceIndex: deviceIndex, outPath: outPath}
}

func (r *Recorder) Start(ctx context.Context) error {
	r.cmd = exec.CommandContext(ctx, "ffmpeg",
		"-f", "avfoundation",
		"-i", fmt.Sprintf(":%d", r.deviceIndex),
		"-ar", "16000",
		"-ac", "1",
		"-y",
		r.outPath,
	)
	r.cmd.Stderr = io.Discard
	if err := r.cmd.Start(); err != nil {
		return fmt.Errorf("start ffmpeg: %w", err)
	}
	return nil
}

func (r *Recorder) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	r.cmd.Process.Signal(os.Interrupt)
	return r.cmd.Wait()
}

func (r *Recorder) FilePath() string {
	return r.outPath
}
