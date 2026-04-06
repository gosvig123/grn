package capture

import (
	"fmt"
	"os/exec"
	"strings"
)

type Device struct {
	Index int
	Name  string
}

func ListAudioDevices() ([]Device, error) {
	cmd := exec.Command("ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", "")
	out, _ := cmd.CombinedOutput()

	var devices []Device
	inAudio := false
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "AVFoundation audio devices") {
			inAudio = true
			continue
		}
		if !inAudio {
			continue
		}
		devices = parseDeviceLine(line, devices)
	}
	if len(devices) == 0 {
		return nil, fmt.Errorf("no audio devices found")
	}
	return devices, nil
}

func parseDeviceLine(line string, devices []Device) []Device {
	first := strings.Index(line, "]")
	if first == -1 {
		return devices
	}
	rest := line[first+1:]
	start := strings.Index(rest, "[")
	end := strings.Index(rest, "]")
	if start == -1 || end == -1 || end <= start+1 {
		return devices
	}
	var idx int
	if _, err := fmt.Sscanf(rest[start+1:end], "%d", &idx); err != nil {
		return devices
	}
	name := strings.TrimSpace(rest[end+1:])
	if name == "" {
		return devices
	}
	return append(devices, Device{Index: idx, Name: name})
}
