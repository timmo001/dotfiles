package xfkey

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

type consumedReplyTransport struct {
	fakeTransport
	expire bool
}

func (f *consumedReplyTransport) Read(b []byte) (int, error) {
	n, err := f.fakeTransport.Read(b)
	if f.expire {
		time.Sleep(time.Until(f.deadlines[len(f.deadlines)-1]) + time.Millisecond)
		return n, err
	}
	return n, io.ErrUnexpectedEOF
}

type closeRecorder struct {
	closed bool
}

func (c *closeRecorder) Close() error {
	c.closed = true
	return nil
}

func TestPublicQueryInMemoryAndCreatesNothing(t *testing.T) {
	root := filepath.Join(t.TempDir(), "must-not-exist")
	t.Setenv("XDG_STATE_HOME", root)
	transport := newSettingsTransport()
	closer := &closeRecorder{}
	oldDiscover, oldOpen := liveDiscover, liveOpenTarget
	t.Cleanup(func() { liveDiscover, liveOpenTarget = oldDiscover, oldOpen })
	liveDiscover = func(sysfsRoot, devRoot string) ([]Candidate, error) {
		if sysfsRoot != "/sys/bus/usb/devices" || devRoot != "/dev" {
			t.Fatalf("discovery roots = %q, %q", sysfsRoot, devRoot)
		}
		return []Candidate{{PhysicalPath: "1-2.3", Compatible: true}}, nil
	}
	liveOpenTarget = func(target Candidate) (queryTransport, io.Closer, error) {
		if target.PhysicalPath != "1-2.3" {
			t.Fatalf("opened target = %#v", target)
		}
		return transport, closer, nil
	}
	var stdout bytes.Buffer
	if err := Run(nil, &stdout, io.Discard); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual([]byte{1, 6, 7, 8}, packetCommands(transport.packets)) || !closer.closed {
		t.Fatalf("commands=%v closed=%t", packetCommands(transport.packets), closer.closed)
	}
	if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("query created the storage root: %v", err)
	}
}

func packetCommands(packets []vendorPacket) []byte {
	commands := make([]byte, len(packets))
	for i := range packets {
		commands[i] = packets[i][1]
	}
	return commands
}

func TestCapturePreservesConsumedReplyOnFailure(t *testing.T) {
	for _, expire := range []bool{true, false} {
		t.Run(map[bool]string{true: "deadline", false: "read error"}[expire], func(t *testing.T) {
			replies := validReplies()
			want := append([]byte(nil), replies[0]...)
			f := &consumedReplyTransport{fakeTransport: fakeTransport{replies: replies}, expire: expire}
			q, err := queryCapture(f, true)
			wantErr := io.ErrUnexpectedEOF
			if expire {
				wantErr = os.ErrDeadlineExceeded
			}
			if !errors.Is(err, wantErr) {
				t.Fatalf("got %v, want %v", err, wantErr)
			}
			if !bytes.Equal(q.replies[1], want) {
				t.Fatalf("consumed reply not preserved: %x", q.replies[1])
			}
			if !reflect.DeepEqual(f.commands, []byte{1}) {
				t.Fatalf("continued after failure: %x", f.commands)
			}
		})
	}
}
