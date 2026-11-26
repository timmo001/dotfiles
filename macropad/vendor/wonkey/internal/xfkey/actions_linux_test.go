package xfkey

import (
	"bytes"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestApplyTypedActions(t *testing.T) {
	for _, action := range actionExamples() {
		for _, noOp := range []bool{false, true} {
			t.Run(fmt.Sprintf("%T/no-op=%v", action, noOp), func(t *testing.T) {
				f := newSettingsTransport()
				if noOp {
					f.current = actionConfiguration(t, action)
				}
				original := f.current
				changes := ActionChanges{Action: action}
				wanted, err := changes.configuration(original)
				if err != nil {
					t.Fatal(err)
				}
				result, err := applySettings(f, settingsTarget(), changes, true, time.Second)
				if err != nil || result.PersistenceVerified || f.current != wanted {
					t.Fatal(result, err)
				}
				if noOp {
					checkNoUpload(t, f)
					if result.Outcome != "no-op" || len(f.packets) != 4 {
						t.Fatal(result, len(f.packets))
					}
					return
				}
				if result.Outcome != "readback-verified" || !result.ReadbackVerified || !result.CommitEcho || !result.WriteAttempted || len(f.packets) != 11 {
					t.Fatal(result, len(f.packets))
				}
				packets := preview(wanted)
				for i, p := range packets[1:] {
					if p != f.packets[4+i] {
						t.Fatal("incorrect upload framing")
					}
				}
				for i := 0; i < len(f.deadlines); i += 2 {
					if f.deadlines[i] != f.deadlines[i+1] {
						t.Fatal("write and read did not share a deadline")
					}
				}
				if original[0] != wanted[0] && (len(result.Changes) != 1 || result.Changes[0].Setting != "action") {
					t.Fatal("reported keyboard fields for a non-keyboard action", result.Changes)
				}
			})
		}
	}
}

func TestApplyMultiSpansAllUploadChunks(t *testing.T) {
	f := newSettingsTransport()
	original := f.current
	action := MultiAction{Interval: 65535, Repeat: 255, Keys: bytes.Repeat([]byte{0x91}, 115)}
	result, err := applySettings(f, settingsTarget(), ActionChanges{Action: action}, true, time.Second)
	if err != nil || !result.ReadbackVerified || !bytes.Equal(f.current[5:120], action.Keys) || !bytes.Equal(f.current[120:], original[120:]) {
		t.Fatal(result, err)
	}
}

func TestApplyTypedActionFailures(t *testing.T) {
	changes := ActionChanges{Action: MediaAction{Usage: 0xe9}}
	for at := 5; at <= 11; at++ {
		for _, failure := range []string{"guard", "write-deadline", "read-deadline", "start", "stall", "write-error", "short-write", "echo", "header", "short-reply", "long-reply", "read-error"} {
			if at > 8 && failure == "echo" {
				continue
			}
			t.Run(fmt.Sprintf("%d/%s", at, failure), func(t *testing.T) {
				f := newSettingsTransport()
				f.failAt, f.failure = at, failure
				result, err := applySettings(f, settingsTarget(), changes, true, 5*time.Millisecond)
				if err == nil || result.ReadbackVerified {
					t.Fatal("accepted failure", result, err)
				}
				want := at
				if failure == "guard" || failure == "write-deadline" {
					want--
				}
				if len(f.packets) != want {
					t.Fatal("continued after failure", len(f.packets), want)
				}
			})
		}
	}
	f := newSettingsTransport()
	f.mismatch = true
	result, err := applySettings(f, settingsTarget(), changes, true, time.Second)
	if err == nil || result.Outcome != "readback-mismatch" || !result.CommitEcho || result.ReadbackVerified {
		t.Fatal("accepted changed unknown byte", result, err)
	}
}

func TestApplyTypedActionGuards(t *testing.T) {
	changes := ActionChanges{Action: MouseAction{X: 1}}
	for _, test := range []string{"write-disabled", "bad-target", "wrong-target", "bad-action", "unknown-current", "ambiguous-current", "cancel", "confirm-error"} {
		t.Run(test, func(t *testing.T) {
			f := newSettingsTransport()
			target := settingsTarget()
			request := changes
			if test == "bad-target" {
				target = ApplyTarget{}
			}
			if test == "wrong-target" {
				target.Version = "1015"
			}
			if test == "bad-action" {
				request.Action = MouseAction{X: -128}
			}
			if test == "unknown-current" {
				f.current[0] = 255
			}
			if test == "ambiguous-current" {
				f.current[1] = 3
			}
			result, err := applySettingsConfirmed(f, target, request, test != "write-disabled", time.Second, func(configuration, configuration) (bool, error) {
				if test == "confirm-error" {
					return false, errors.New("settings drift")
				}
				return false, nil
			})
			if test == "cancel" {
				if err != nil || result.Outcome != "cancelled" {
					t.Fatal(result, err)
				}
			} else if err == nil {
				t.Fatal("accepted failed guard", result)
			}
			if (test == "write-disabled" || test == "bad-target" || test == "bad-action") && len(f.packets) != 0 {
				t.Fatal("queried before input validation")
			}
			checkNoUpload(t, f)
		})
	}
}
