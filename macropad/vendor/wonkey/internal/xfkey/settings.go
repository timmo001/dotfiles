package xfkey

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

type Changes map[string]int

type configurationChanges interface {
	validate() error
	configuration(configuration) (configuration, error)
}

func (changes Changes) configuration(current configuration) (configuration, error) {
	return changeConfiguration(current, changes)
}

type fieldSpec struct{ offset, min, max, shift int }

var settingsFields = map[string]fieldSpec{
	"key":       {4, 0x04, 0x91, 0},
	"trigger":   {1, 1, 3, 0},
	"modifiers": {2, 0, 15, 0},
	"rgb-mode":  {124, 0, 7, 1},
	"red":       {125, 0, 255, 0},
	"green":     {126, 0, 255, 0},
	"blue":      {127, 0, 255, 0},
}

func (changes Changes) validate() error {
	if len(changes) == 0 {
		return fmt.Errorf("at least one explicit settings field is required")
	}
	for _, name := range settingOrder {
		value, present := changes[name]
		if !present {
			continue
		}
		spec := settingsFields[name]
		if value < spec.min || value > spec.max || (name == "key" && settingName(keyValues, value) == "") {
			return fmt.Errorf("unsupported setting %s=%d", name, value)
		}
	}
	for name, value := range changes {
		if _, ok := settingsFields[name]; !ok {
			return fmt.Errorf("unsupported setting %s=%d", name, value)
		}
	}
	return nil
}

func supportedConfiguration(c configuration) error {
	if c[0] != 0 || c[3] != 1 || settingName(keyValues, int(c[4])) == "" || c[1] < 1 || c[1] > 3 || c[2] > 15 {
		return fmt.Errorf("unsupported current single-key layout %x; no conversion attempted", c[:5])
	}
	if c[124] < 1 || c[124] > 8 {
		return fmt.Errorf("unsupported current RGB mode %02x", c[124])
	}
	return nil
}

func changeConfiguration(current configuration, changes Changes) (configuration, error) {
	if err := changes.validate(); err != nil {
		return current, err
	}
	if err := supportedConfiguration(current); err != nil {
		return current, err
	}
	intended := current
	for name, value := range changes {
		spec := settingsFields[name]
		stored := value + spec.shift
		if stored < 0 || stored > 255 {
			return current, fmt.Errorf("unsupported stored setting %s=%d", name, stored)
		}
		intended[spec.offset] = byte(stored)
	}
	return intended, nil
}

// Only regular, bounded files are accepted, never device nodes or symbolic links.
func captureFile(dir, name string, limit int64) ([]byte, error) {
	path := filepath.Join(dir, name)
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		return nil, fmt.Errorf("not a bounded regular capture file: %s", path)
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !opened.Mode().IsRegular() || !os.SameFile(info, opened) {
		return nil, fmt.Errorf("capture file identity changed: %s", path)
	}
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("capture file exceeds size limit: %s", path)
	}
	return b, nil
}

func loadCapture(dir string) (CaptureResult, configuration, error) {
	var result CaptureResult
	var config configuration
	b, err := captureFile(dir, "result.json", 65536)
	if err != nil {
		return result, config, err
	}
	if err := json.Unmarshal(b, &result); err != nil {
		return result, config, err
	}
	raw, err := captureFile(dir, "reply-01.bin", 64)
	if err != nil {
		return result, config, err
	}
	identity, err := parseIdentity(raw)
	if err != nil {
		return result, config, err
	}
	if result.Identity != identity {
		return result, config, fmt.Errorf("capture identity does not match raw reply")
	}
	var replies [3][]byte
	for i := range replies {
		replies[i], err = captureFile(dir, fmt.Sprintf("reply-%02x.bin", i+6), 64)
		if err != nil {
			return result, config, err
		}
	}
	parsed, err := parseReadback(replies)
	if err != nil {
		return result, config, err
	}
	if result.Readback == nil || *result.Readback != parsed {
		return result, config, fmt.Errorf("capture readback does not match raw replies")
	}
	b, err = captureFile(dir, "configuration.bin", 128)
	if err != nil {
		return result, config, err
	}
	if len(b) != 128 || hex.EncodeToString(b) != parsed.Configuration {
		return result, config, fmt.Errorf("capture configuration does not match raw replies")
	}
	copy(config[:], b)
	return result, config, nil
}

type SettingsPlan struct {
	Current        string   `json:"current_configuration_hex"`
	Intended       string   `json:"intended_configuration_hex"`
	ChangedOffsets []int    `json:"changed_offsets"`
	Payloads       []string `json:"upload_and_commit_payloads_hex"`
	Warning        string   `json:"warning"`
}

func settingsPlan(current, intended configuration) SettingsPlan {
	plan := SettingsPlan{Current: hex.EncodeToString(current[:]), Intended: hex.EncodeToString(intended[:]), ChangedOffsets: []int{}, Payloads: []string{}, Warning: "Offline plan only. Unspecified bytes preserved. Matching live readback does not prove persistence after reconnect."}
	for i := range current {
		if current[i] != intended[i] {
			plan.ChangedOffsets = append(plan.ChangedOffsets, i)
		}
	}
	if !bytes.Equal(current[:], intended[:]) {
		packets := preview(intended)
		for _, p := range packets[1:] {
			plan.Payloads = append(plan.Payloads, hex.EncodeToString(p[:]))
		}
	}
	return plan
}
