package xfkey

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

func TestPublicSuccessfulWriteOutputFailure(t *testing.T) {
	for _, short := range []bool{false, true} {
		t.Run(fmt.Sprintf("short=%t", short), func(t *testing.T) {
			first := newSettingsTransport()
			fresh := &backupCheckingTransport{settingsTransport: newSettingsTransport()}
			args := []string{"media", "playpause"}
			out := &failingHumanOutput{needle: "Settings saved.", short: short}
			var result ApplyResult
			applies := 0
			access := publicActionTestAccess(t, first, func(_ Candidate, target ApplyTarget, changes configurationChanges, guard func(configuration, configuration) (bool, error)) (ApplyResult, error) {
				applies++
				if out.failed {
					t.Fatal("output failed before apply")
				}
				var err error
				result, err = applySettingsConfirmed(fresh, target, changes, true, time.Second, guard, true)
				if err != nil || !result.ReadbackVerified {
					t.Fatal("synthetic write failed", result, err)
				}
				return result, nil
			})
			err := runPublic(args, &cliRuntime{strings.NewReader("yes\n"), out, io.Discard}, access)
			want := io.ErrClosedPipe
			if short {
				want = io.ErrShortWrite
			}
			if !errors.Is(err, want) || ExitCode(err) != 1 || !out.failed || applies != 1 {
				t.Fatal("post-write output failure lost or write repeated", err, applies)
			}
			if !fresh.checked || !result.WriteAttempted || !result.ReadbackVerified || len(fresh.packets) != 11 {
				t.Fatal("write did not complete before output failure", result)
			}
			action, err := decodeAction(fresh.current)
			if err != nil || action != (MediaAction{Usage: 0xcd}) {
				t.Fatal("saved action changed after output failure", action, err)
			}
		})
	}
}
