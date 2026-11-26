package xfkey

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// Synthetic device state machine. No hardware handles are used.
type settingsTransport struct {
	current, staged configuration
	identity        []byte
	packets         []vendorPacket
	reply           []byte
	failAt          int
	failure         string
	mismatch        bool
	waits           []bool
	deadlines       []time.Time
}

func syntheticSettings() configuration {
	c := configuration{0, 1, 0, 1, 0x28}
	for i := 5; i < 124; i++ {
		c[i] = byte((i * 7) & 0xff)
	}
	copy(c[124:], []byte{1, 255, 255, 255})
	return c
}

func newSettingsTransport() *settingsTransport {
	id := make([]byte, 64)
	copy(id, []byte{0xaf, 1, 1, 0x12, 0x10, 0x14, 0xbe, 7, 0x7b, 0xa2})
	return &settingsTransport{current: syntheticSettings(), identity: id}
}

func (f *settingsTransport) Validate() error {
	if f.failAt == len(f.packets)+1 && f.failure == "guard" {
		return fmt.Errorf("target changed")
	}
	return nil
}

func (f *settingsTransport) Wait(write bool, deadline time.Time) error {
	f.waits = append(f.waits, write)
	f.deadlines = append(f.deadlines, deadline)
	index := len(f.packets)
	if write {
		index++
	}
	if index == f.failAt && ((write && f.failure == "write-deadline") || (!write && f.failure == "read-deadline")) {
		return os.ErrDeadlineExceeded
	}
	return nil
}

func (f *settingsTransport) StartWrite(b []byte, _ time.Time) (<-chan writeResult, error) {
	if len(b) != 65 || b[0] != 0 {
		return nil, fmt.Errorf("invalid hidraw output")
	}
	var p vendorPacket
	copy(p[:], b[1:])
	f.packets = append(f.packets, p)
	fail := f.failAt == len(f.packets)
	if fail && f.failure == "start" {
		return nil, io.ErrClosedPipe
	}
	if fail && f.failure == "stall" {
		return make(chan writeResult), nil
	}
	ch := make(chan writeResult, 1)
	if fail && f.failure == "write-error" {
		ch <- writeResult{0, io.ErrClosedPipe}
		return ch, nil
	}
	if fail && f.failure == "short-write" {
		ch <- writeResult{64, nil}
		return ch, nil
	}
	f.reply = append([]byte(nil), p[:]...)
	switch p[1] {
	case 1:
		f.reply = append([]byte(nil), f.identity...)
	case 6:
		copy(f.reply[2:], f.current[:62])
	case 7:
		copy(f.reply[2:], f.current[62:124])
	case 8:
		copy(f.reply[2:6], f.current[124:])
	case 2:
		index := len(f.packets) - 5
		offsets := []int{0, 60, 120}
		lengths := []int{60, 60, 8}
		if index < 0 || index > 2 || int(p[2]) != offsets[index] || int(p[3]) != lengths[index] {
			return nil, fmt.Errorf("bad upload sequence")
		}
		copy(f.staged[offsets[index]:offsets[index]+lengths[index]], p[4:4+lengths[index]])
	case 4:
		if len(f.packets) != 8 {
			return nil, fmt.Errorf("early commit")
		}
		f.current = f.staged
		if f.mismatch {
			f.current[63] ^= 1
		}
	default:
		return nil, fmt.Errorf("unexpected command")
	}
	if fail && f.failure == "echo" {
		f.reply[63] ^= 1
	}
	if fail && f.failure == "header" {
		f.reply[1] ^= 1
	}
	if fail && f.failure == "short-reply" {
		f.reply = f.reply[:63]
	}
	if fail && f.failure == "long-reply" {
		f.reply = append(f.reply, 0)
	}
	ch <- writeResult{65, nil}
	return ch, nil
}

func (f *settingsTransport) Read(b []byte) (int, error) {
	if len(f.packets) == f.failAt && f.failure == "read-error" {
		return copy(b, f.reply), io.ErrUnexpectedEOF
	}
	return copy(b, f.reply), nil
}

func settingsTarget() ApplyTarget { return ApplyTarget{"be077ba2", "1014"} }

func checkNoUpload(t *testing.T, f *settingsTransport) {
	t.Helper()
	for _, p := range f.packets {
		if p[1] == 2 || p[1] == 4 {
			t.Fatal("unexpected configuration write", f.packets)
		}
	}
}

func TestApplyCancellationSendsNoWrite(t *testing.T) {
	transport := newSettingsTransport()
	result, err := applySettingsConfirmed(transport, settingsTarget(), Changes{"key": 0x68}, true, time.Second, func(configuration, configuration) (bool, error) {
		return false, nil
	})
	if err != nil || result.Outcome != "cancelled" || result.WriteAttempted {
		t.Fatalf("result = %#v, error = %v", result, err)
	}
	if len(result.Changes) != 1 || result.Changes[0].Setting != "key" {
		t.Fatalf("missing semantic changes: %#v", result.Changes)
	}
	checkNoUpload(t, transport)
	if len(transport.packets) != 4 {
		t.Fatalf("queries = %d, want 4", len(transport.packets))
	}
}

func TestApplySuccessAndNoOp(t *testing.T) {
	for name, changes := range map[string]Changes{
		"RGB-only":          {"rgb-mode": 1, "red": 0, "green": 0, "blue": 255},
		"key-only":          {"key": 0x68},
		"modifiers-trigger": {"modifiers": 3, "trigger": 2},
		"no-op":             {"key": 0x28},
	} {
		t.Run(name, func(t *testing.T) {
			f := newSettingsTransport()
			original := f.current
			wanted, err := changeConfiguration(original, changes)
			if err != nil {
				t.Fatal(err)
			}
			result, err := applySettings(f, settingsTarget(), changes, true, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			if result.PersistenceVerified {
				t.Fatal("claimed reconnect persistence")
			}
			if len(result.Changes) != len(settingViews(original, wanted)) {
				t.Fatalf("changes = %#v", result.Changes)
			}
			if name == "no-op" {
				if result.Outcome != "no-op" || len(f.packets) != 4 || result.CommitEcho {
					t.Fatal(result, f.packets)
				}
				checkNoUpload(t, f)
			} else {
				if result.Outcome != "readback-verified" || !result.ReadbackVerified || !result.CommitEcho || len(f.packets) != 11 || f.current != wanted {
					t.Fatal(result, f.packets)
				}
				packets := preview(wanted)
				for i, p := range packets[1:] {
					if f.packets[i+4] != p {
						t.Fatal("wrong framing")
					}
				}
			}
			for i := 0; i < len(f.deadlines); i += 2 {
				if !f.waits[i] || f.waits[i+1] || f.deadlines[i] != f.deadlines[i+1] {
					t.Fatal("deadline not shared")
				}
			}
		})
	}
}

func TestApplyEveryUploadAndCommitFailure(t *testing.T) {
	for at := 5; at <= 8; at++ {
		for _, failure := range []string{"guard", "write-deadline", "read-deadline", "start", "stall", "write-error", "short-write", "echo", "header", "short-reply", "long-reply", "read-error"} {
			t.Run(fmt.Sprintf("%d/%s", at, failure), func(t *testing.T) {
				f := newSettingsTransport()
				f.failAt, f.failure = at, failure
				result, err := applySettings(f, settingsTarget(), Changes{"key": 0x68}, true, 5*time.Millisecond)
				if err == nil {
					t.Fatal("accepted failure")
				}
				expected := at
				if failure == "guard" || failure == "write-deadline" {
					expected--
				}
				if len(f.packets) != expected || result.CommitEcho || result.ReadbackVerified {
					t.Fatal("continued after failure", result, len(f.packets), expected)
				}
				if at < 8 {
					for _, p := range f.packets {
						if p[1] == 4 {
							t.Fatal("commit after failed chunk")
						}
					}
				}
			})
		}
	}
}

func TestApplyUnsupportedAndExplicitGuard(t *testing.T) {
	for name, mutate := range map[string]func(*settingsTransport){
		"model":             func(f *settingsTransport) { f.identity[2], f.identity[3] = 0x12, 1 },
		"identifier":        func(f *settingsTransport) { f.identity[6] ^= 1 },
		"version":           func(f *settingsTransport) { f.identity[5] ^= 1 },
		"layout":            func(f *settingsTransport) { f.current[0] = 1 },
		"multi-key":         func(f *settingsTransport) { f.current[3] = 2 },
		"unknown-key":       func(f *settingsTransport) { f.current[4] = 0xff },
		"unknown-trigger":   func(f *settingsTransport) { f.current[1] = 0 },
		"unknown-modifiers": func(f *settingsTransport) { f.current[2] = 0x80 },
		"unknown-rgb":       func(f *settingsTransport) { f.current[124] = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			f := newSettingsTransport()
			mutate(f)
			if _, err := applySettings(f, settingsTarget(), Changes{"blue": 0}, true, time.Second); err == nil {
				t.Fatal("accepted unsupported current state")
			}
			checkNoUpload(t, f)
		})
	}
	f := newSettingsTransport()
	if _, err := applySettings(f, settingsTarget(), Changes{"key": 0x68}, false, time.Second); !errors.Is(err, errWriteRequired) || len(f.packets) != 0 {
		t.Fatal(err)
	}
	for _, changes := range []Changes{nil, {}, {"key": 0}, {"blue": -1}, {"rgb-mode": 8}, {"trigger": 4}, {"modifiers": 16}, {"raw": 2}} {
		if _, err := applySettings(f, settingsTarget(), changes, true, time.Second); err == nil || len(f.packets) != 0 {
			t.Fatal(changes, err)
		}
	}
	for _, target := range []ApplyTarget{{}, {"be077ba2", ""}, {"zz077ba2", "1014"}} {
		if _, err := applySettings(f, target, Changes{"key": 0x68}, true, time.Second); err == nil || len(f.packets) != 0 {
			t.Fatal(target, err)
		}
	}
}

func TestApplyPostWriteComparisonAndFailures(t *testing.T) {
	f := newSettingsTransport()
	f.mismatch = true
	result, err := applySettings(f, settingsTarget(), Changes{"key": 0x68}, true, time.Second)
	if err == nil || result.Outcome != "readback-mismatch" || !result.CommitEcho || result.ReadbackVerified || len(f.packets) != 11 {
		t.Fatal(result, err)
	}
	for at := 9; at <= 11; at++ {
		for _, failure := range []string{"read-deadline", "short-reply", "header", "read-error", "stall"} {
			t.Run(fmt.Sprintf("%d/%s", at, failure), func(t *testing.T) {
				f := newSettingsTransport()
				f.failAt, f.failure = at, failure
				result, err := applySettings(f, settingsTarget(), Changes{"key": 0x68}, true, 5*time.Millisecond)
				if err == nil || !result.CommitEcho || result.ReadbackVerified || len(f.packets) != at {
					t.Fatal(result, err, len(f.packets))
				}
			})
		}
	}
}

func TestPartialPlanPreservesEveryUnspecifiedByte(t *testing.T) {
	current := syntheticSettings()
	for name, value := range map[string]int{"key": 0x68, "modifiers": 15, "trigger": 3, "rgb-mode": 7, "red": 0, "green": 1, "blue": 2} {
		next, err := changeConfiguration(current, Changes{name: value})
		if err != nil {
			t.Fatal(err)
		}
		for i := range current {
			if i != settingsFields[name].offset && current[i] != next[i] {
				t.Fatal(name, "changed unspecified byte", i)
			}
		}
		plan := settingsPlan(current, next)
		if !reflect.DeepEqual(plan.ChangedOffsets, []int{settingsFields[name].offset}) {
			t.Fatal(plan)
		}
	}
}

func TestAuthenticCaptureFixtureRemainsIncomplete(t *testing.T) {
	if _, _, err := loadCapture("testdata/hardware-20260911"); err == nil || !os.IsNotExist(err) {
		t.Fatalf("fixture without authentic completion marker was accepted: %v", err)
	}
	readFixture := func(name string) []byte {
		t.Helper()
		raw, err := os.ReadFile(filepath.Join("testdata/hardware-20260911", name))
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	identityBytes := readFixture("reply-01.bin")
	identity, err := parseIdentity(identityBytes)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Model != 0x0112 || identity.Version != 0x1014 || identity.Identifier != "be077ba2" || identity.Status != evidenceStatus {
		t.Fatalf("authentic identity = %+v", identity)
	}
	if identity.Raw != hex.EncodeToString(identityBytes) {
		t.Fatal("authentic identity reply bytes lost")
	}
	replies := [3][]byte{readFixture("reply-06.bin"), readFixture("reply-07.bin"), readFixture("reply-08.bin")}
	readback, err := parseReadback(replies)
	if err != nil {
		t.Fatal(err)
	}
	for i, reply := range replies {
		if readback.Raw[i] != hex.EncodeToString(reply) {
			t.Fatalf("authentic AF%02x reply bytes lost", 6+i)
		}
	}
	configBytes := readFixture("configuration.bin")
	if len(configBytes) != 128 {
		t.Fatalf("authentic configuration length = %d, want 128", len(configBytes))
	}
	reconstructed, err := hex.DecodeString(readback.Configuration)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reconstructed, configBytes) {
		t.Fatalf("reconstructed configuration = %x, want %x", reconstructed, configBytes)
	}
	var config configuration
	copy(config[:], configBytes)
	if hex.EncodeToString(config[:5]) != "0001000128" || hex.EncodeToString(config[124:]) != "01ffffff" {
		t.Fatal("authentic fixture bytes changed")
	}
	next, err := changeConfiguration(config, Changes{"rgb-mode": 1, "red": 0, "green": 0, "blue": 255})
	if err != nil || !bytes.Equal(config[:124], next[:124]) || hex.EncodeToString(next[124:]) != "020000ff" {
		t.Fatal(next, err)
	}
}
