package capture

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

func (r *Recorder) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
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
	case <-ctx.Done():
		_ = r.stopProcessGroup(syscall.SIGINT)
		<-errCh
		return ctx.Err()
	case <-time.After(500 * time.Millisecond):
		r.waitCh = errCh
	}
	return nil
}

func (r *Recorder) Done() <-chan error {
	return r.waitCh
}

func (r *Recorder) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil || r.waitCh == nil {
		return nil
	}
	select {
	case err := <-r.waitCh:
		return err
	default:
	}
	if err := r.stopProcessGroup(syscall.SIGINT); err != nil && err != syscall.ESRCH {
		return fmt.Errorf("signal capture process group: %w", err)
	}
	select {
	case err := <-r.waitCh:
		return err
	case <-time.After(5 * time.Second):
		_ = r.stopProcessGroup(syscall.SIGKILL)
		<-r.waitCh
		return fmt.Errorf("capture process did not exit cleanly")
	}
}

func (r *Recorder) stopProcessGroup(sig syscall.Signal) error {
	return syscall.Kill(-r.cmd.Process.Pid, sig)
}

func (r *Recorder) MicPath() string {
	return filepath.Join(r.outputDir, "mic.wav")
}

func (r *Recorder) SystemPath() string {
	return filepath.Join(r.outputDir, "system.wav")
}

func findCaptureBinary() (string, error) {
	if override := strings.TrimSpace(os.Getenv("GRN_CAPTURE_HELPER_PATH")); override != "" {
		if _, err := os.Stat(override); err == nil {
			return override, nil
		}
		return "", fmt.Errorf("capture helper override not found: %s", override)
	}

	home, _ := os.UserHomeDir()
	paths := bundleCaptureCandidates()
	paths = append(paths,
		filepath.Join(home, ".grn", "GrnCapture.app", "Contents", "MacOS", "grn-capture"),
		"./build/GrnCapture.app/Contents/MacOS/grn-capture",
	)
	for _, p := range paths {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("grn-capture not found (set GRN_CAPTURE_HELPER_PATH or run: make build-capture)")
}

func bundleCaptureCandidates() []string {
	exePath, err := os.Executable()
	if err != nil {
		return nil
	}
	resolvedPath, err := filepath.EvalSymlinks(exePath)
	if err == nil {
		exePath = resolvedPath
	}
	exeDir := filepath.Dir(exePath)
	return []string{
		filepath.Clean(filepath.Join(exeDir, "..", "GrnCapture.app", "Contents", "MacOS", "grn-capture")),
		filepath.Clean(filepath.Join(exeDir, "..", "Resources", "GrnCapture.app", "Contents", "MacOS", "grn-capture")),
	}
}
