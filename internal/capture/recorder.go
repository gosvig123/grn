package capture

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

type CaptureMode string

const (
	ModeMic    CaptureMode = "mic"
	ModeSystem CaptureMode = "system"
	ModeBoth   CaptureMode = "both"
)

type Recorder struct {
	mode      CaptureMode
	outputDir string
	deviceIdx int
	cmd       *exec.Cmd
	waitCh    chan error
}

func NewRecorder(mode CaptureMode, outputDir string, deviceIdx int) *Recorder {
	return &Recorder{mode: mode, outputDir: outputDir, deviceIdx: deviceIdx}
}

func (r *Recorder) Start(_ context.Context) error {
	bin, err := findCaptureBinary()
	if err != nil {
		return err
	}
	args := []string{
		"--mode", string(r.mode),
		"--output-dir", r.outputDir,
		"--device", fmt.Sprintf("%d", r.deviceIdx),
	}
	r.cmd = exec.Command(bin, args...)
	r.cmd.Stdout = os.Stdout
	r.cmd.Stderr = os.Stderr
	r.cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := r.cmd.Start(); err != nil {
		return fmt.Errorf("start capture: %w", err)
	}
	errCh := make(chan error, 1)
	go func() {
		errCh <- r.cmd.Wait()
	}()
	select {
	case err := <-errCh:
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 126 {
			return fmt.Errorf("permission denied — check System Settings → Privacy & Security")
		}
		return fmt.Errorf("capture process failed to start: %v", err)
	case <-time.After(500 * time.Millisecond):
		r.waitCh = errCh
	}
	return nil
}

func (r *Recorder) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	syscall.Kill(r.cmd.Process.Pid, syscall.SIGINT)
	select {
	case err := <-r.waitCh:
		return err
	case <-time.After(5 * time.Second):
		r.cmd.Process.Kill()
		<-r.waitCh // drain
		return fmt.Errorf("capture process did not exit cleanly")
	}
}

func (r *Recorder) MicPath() string {
	return filepath.Join(r.outputDir, "mic.wav")
}

func (r *Recorder) SystemPath() string {
	return filepath.Join(r.outputDir, "system.wav")
}

func findCaptureBinary() (string, error) {
	home, _ := os.UserHomeDir()
	paths := []string{
		filepath.Join(home, ".grn", "GrnCapture.app", "Contents", "MacOS", "grn-capture"),
		"./build/GrnCapture.app/Contents/MacOS/grn-capture",
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("grn-capture not found (run: make build-capture)")
}
