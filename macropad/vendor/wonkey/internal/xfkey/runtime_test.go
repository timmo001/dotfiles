package xfkey

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

type backupCheckingTransport struct {
	*settingsTransport
	checked bool
}

func (f *backupCheckingTransport) StartWrite(b []byte, deadline time.Time) (<-chan writeResult, error) {
	if b[2] == 2 && b[3] == 0 {
		if len(f.packets) != 4 || f.packets[0][1] != 1 || f.packets[1][1] != 6 || f.packets[2][1] != 7 || f.packets[3][1] != 8 {
			return nil, fmt.Errorf("upload started without fresh identity and readback queries")
		}
		f.checked = true
	}
	return f.settingsTransport.StartWrite(b, deadline)
}

func TestExitCode(t *testing.T) {
	plainErr := errors.New("failure")
	cliErr := &CLIError{Err: plainErr, Code: 2}
	for _, tt := range []struct {
		name string
		err  error
		want int
	}{
		{"nil", nil, 1},
		{"plain", plainErr, 1},
		{"wrapped plain", fmt.Errorf("context: %w", plainErr), 1},
		{"CLI", cliErr, 2},
		{"wrapped CLI", fmt.Errorf("context: %w", cliErr), 2},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExitCode(tt.err); got != tt.want {
				t.Fatalf("ExitCode(%v) = %d, want %d", tt.err, got, tt.want)
			}
		})
	}
}
