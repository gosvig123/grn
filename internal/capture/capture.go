package capture

import (
	"fmt"
	"os/exec"
	"strings"
)

type Device struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
}

func ListAudioDevices() ([]Device, error) {
	bin, err := findCaptureBinary()
	if err != nil {
		return nil, err
	}
	out, err := exec.Command(bin, "--list-devices").CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	var devices []Device
	for _, line := range strings.Split(string(out), "\n") {
		if d := parseDeviceLine(line); d != nil {
			devices = append(devices, *d)
		}
	}
	if len(devices) == 0 {
		return nil, fmt.Errorf("no audio devices found")
	}
	return devices, nil
}

func parseDeviceLine(line string) *Device {
	trimmed := strings.TrimSpace(line)
	if len(trimmed) < 3 || trimmed[0] != '[' {
		return nil
	}
	end := strings.Index(trimmed, "]")
	if end == -1 {
		return nil
	}
	var idx int
	if _, err := fmt.Sscanf(trimmed[1:end], "%d", &idx); err != nil {
		return nil
	}
	name := strings.TrimSpace(trimmed[end+1:])
	name = strings.TrimSuffix(name, " (default)")
	if name == "" {
		return nil
	}
	return &Device{Index: idx, Name: name}
}
