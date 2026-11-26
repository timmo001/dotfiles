package xfkey

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

type fakeTransport struct {
	commands   []byte
	replies    [][]byte
	waits      []bool
	deadlines  []time.Time
	failWait   int
	shortWrite bool
	invalid    bool
}

func (f *fakeTransport) Validate() error {
	if f.invalid {
		return fmt.Errorf("identity changed")
	}
	return nil
}

func (f *fakeTransport) Wait(write bool, d time.Time) error {
	f.waits = append(f.waits, write)
	f.deadlines = append(f.deadlines, d)
	if f.failWait == len(f.waits) {
		return os.ErrDeadlineExceeded
	}
	return nil
}

func (f *fakeTransport) StartWrite(b []byte, _ time.Time) (<-chan writeResult, error) {
	n, err := f.Write(b)
	result := make(chan writeResult, 1)
	result <- writeResult{n, err}
	return result, nil
}

func (f *fakeTransport) Write(b []byte) (int, error) {
	if len(b) != 65 || b[0] != 0 || b[1] != 0xaf || !bytes.Equal(b[3:], make([]byte, 62)) {
		return 0, fmt.Errorf("unexpected packet %x", b)
	}
	f.commands = append(f.commands, b[2])
	if f.shortWrite {
		return 64, nil
	}
	return 65, nil
}

func (f *fakeTransport) Read(b []byte) (int, error) {
	if len(f.replies) == 0 {
		return 0, io.EOF
	}
	reply := f.replies[0]
	f.replies = f.replies[1:]
	return copy(b, reply), nil
}

func validReplies() [][]byte {
	identify := syntheticReply(1)
	identify[2], identify[3] = 1, 0x12
	return [][]byte{identify, syntheticReply(6), syntheticReply(7), syntheticReply(8)}
}

func TestQueryCaptureSequence(t *testing.T) {
	f := &fakeTransport{replies: validReplies()}
	q, err := queryCapture(f, true)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.commands, []byte{1, 6, 7, 8}) {
		t.Fatal(f.commands)
	}
	for i := 0; i < 8; i += 2 {
		if !f.waits[i] || f.waits[i+1] || !f.deadlines[i].Equal(f.deadlines[i+1]) {
			t.Fatal("transaction must share one deadline")
		}
	}
	if q.result.Readback == nil || len(q.config) != 128 {
		t.Fatal("missing readback")
	}
	for _, cmd := range []byte{1, 6, 7, 8} {
		if len(q.replies[cmd]) != 64 {
			t.Fatal(cmd, len(q.replies[cmd]))
		}
	}
}

func TestCaptureStopsOnBadReplies(t *testing.T) {
	for index := range 4 {
		for _, kind := range []string{"short", "long", "header", "prefix", "timeout"} {
			t.Run(fmt.Sprintf("%d-%s", index, kind), func(t *testing.T) {
				replies := validReplies()
				f := &fakeTransport{replies: replies}
				switch kind {
				case "short":
					replies[index] = replies[index][:63]
				case "long":
					replies[index] = append(replies[index], 0)
				case "header":
					replies[index][1] = 0xff
				case "prefix":
					replies[index][0] = 0
				case "timeout":
					f.failWait = index*2 + 2
				}
				if _, err := queryCapture(f, true); err == nil {
					t.Fatal("accepted invalid reply")
				}
				if len(f.commands) != index+1 {
					t.Fatal("continued after failure", f.commands)
				}
			})
		}
	}
	f := &fakeTransport{replies: validReplies()}
	f.replies[0][2], f.replies[0][3] = 0x12, 1
	if _, err := queryCapture(f, true); err == nil || len(f.commands) != 1 {
		t.Fatal("model gate failed")
	}
}

func TestQueryFailurePaths(t *testing.T) {
	for name, f := range map[string]*fakeTransport{
		"guard": {invalid: true}, "write timeout": {failWait: 1}, "short write": {shortWrite: true}, "read timeout": {failWait: 2}, "read error": {},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := query(f, 1); err == nil {
				t.Fatal("accepted failure")
			}
			if len(f.commands) > 1 {
				t.Fatal("retried")
			}
		})
	}
	for _, cmd := range []byte{0, 2, 4, 5, 9, 255} {
		f := &fakeTransport{}
		if _, err := query(f, cmd); err == nil || len(f.commands) != 0 || len(f.waits) != 0 {
			t.Fatal("unsafe command", cmd)
		}
	}
	f := &fakeTransport{replies: validReplies()}
	if _, err := queryCapture(f, false); err != nil || !reflect.DeepEqual(f.commands, []byte{1}) {
		t.Fatal(f.commands, err)
	}
}

func TestNonblockingWaitTimeoutOffline(t *testing.T) {
	var pipes [2]int
	if err := syscall.Pipe2(pipes[:], syscall.O_NONBLOCK|syscall.O_CLOEXEC); err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(pipes[0])
	defer syscall.Close(pipes[1])
	transport := &hidrawTransport{fd: pipes[0]}
	start := time.Now()
	if err := transport.Wait(false, start.Add(10*time.Millisecond)); !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatal(err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("wait not bounded")
	}
	if err := transport.Wait(false, time.Now().Add(-time.Second)); !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatal(err)
	}
}

func TestRemovedLiveCLIRejectedOffline(t *testing.T) {
	for _, cmd := range []string{"identify", "readback"} {
		for _, args := range [][]string{{cmd}, {cmd, "--yes"}, {cmd, "--packet", "af04"}, {cmd, "unexpected"}} {
			if err := Run(args, io.Discard, io.Discard); err == nil {
				t.Fatal(args)
			}
		}
	}
}

// startWritePipe keeps the writer blocking and makes only the reader pollable.
// Read deadlines bound failures, and closing the reader releases a blocked write.
func startWritePipe(t *testing.T) (*hidrawTransport, *os.File) {
	t.Helper()
	var pipes [2]int
	if err := syscall.Pipe2(pipes[:], syscall.O_CLOEXEC); err != nil {
		t.Fatal(err)
	}
	transport := &hidrawTransport{fd: pipes[1]}
	t.Cleanup(func() {
		if transport.fd >= 0 {
			transport.Close()
		}
	})
	if err := syscall.SetNonblock(pipes[0], true); err != nil {
		syscall.Close(pipes[0])
		t.Fatal(err)
	}
	reader := os.NewFile(uintptr(pipes[0]), "StartWrite test pipe")
	t.Cleanup(func() { reader.Close() })
	if err := reader.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	return transport, reader
}

// waitForPipeWrite observes the submitted syscall, rather than assuming that
// a goroutine starts within a fixed delay. The pipe remains full throughout.
func waitForPipeWrite(t *testing.T, identity syscall.Stat_t, deadline time.Time) int {
	t.Helper()
	for time.Now().Before(deadline) {
		paths, err := filepath.Glob("/proc/self/task/*/syscall")
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range paths {
			data, err := os.ReadFile(path)
			if errors.Is(err, os.ErrNotExist) || errors.Is(err, syscall.ESRCH) {
				continue // A runtime thread can exit during enumeration.
			}
			if err != nil {
				t.Fatal(err)
			}
			fields := strings.Fields(string(data))
			if len(fields) < 2 || fields[0] != strconv.Itoa(syscall.SYS_WRITE) {
				continue
			}
			fd, err := strconv.ParseInt(fields[1], 0, 32)
			if err != nil {
				t.Fatal(err)
			}
			var stat syscall.Stat_t
			if syscall.Fstat(int(fd), &stat) == nil && stat.Dev == identity.Dev && stat.Ino == identity.Ino {
				return int(fd)
			}
		}
		runtime.Gosched()
	}
	t.Fatal("no submitted write to the full pipe before deadline")
	return -1
}

func TestStartWriteDuplicateSurvivesCloseAndTimeoutOffline(t *testing.T) {
	transport, reader := startWritePipe(t)
	capacity, err := unix.FcntlInt(uintptr(transport.fd), unix.F_GETPIPE_SZ, 0)
	if err != nil {
		t.Fatal(err)
	}
	var identity syscall.Stat_t
	if err := syscall.Fstat(transport.fd, &identity); err != nil {
		t.Fatal(err)
	}
	// A full pipe blocks an atomic report-sized write without partial writes
	// caused by runtime signals. Fill it before starting the asynchronous write.
	filler := bytes.Repeat([]byte{0x5a}, capacity)
	if n, err := syscall.Write(transport.fd, filler); err != nil || n != len(filler) {
		t.Fatalf("fill pipe: n=%d err=%v", n, err)
	}
	payload := bytes.Repeat([]byte{0xa5}, 65)
	deadline := time.Now().Add(time.Second)
	result, err := transport.StartWrite(payload, deadline)
	if err != nil {
		t.Fatal(err)
	}
	// On failure, release and join the writer before its payload leaves scope.
	finished := false
	defer func() {
		reader.Close()
		if !finished {
			select {
			case <-result:
			case <-time.After(5 * time.Second):
				t.Error("submitted write did not finish after reader close")
			}
		}
	}()
	duplicate := waitForPipeWrite(t, identity, deadline)
	if duplicate == transport.fd {
		t.Fatal("write uses the original descriptor, not a private duplicate")
	}
	if err := transport.Close(); err != nil {
		t.Fatal(err)
	}
	transport.fd = -1 // Cleanup must not close a reused descriptor number.

	// Wait for the caller's deadline without draining the blocked syscall.
	timer := time.NewTimer(time.Until(deadline))
	defer timer.Stop()
	select {
	case got := <-result:
		finished = true
		t.Fatalf("write completed before pipe drain: %+v", got)
	case <-timer.C:
	}
	select {
	case got := <-result:
		finished = true
		t.Fatalf("deadline cancelled the submitted write: %+v", got)
	default:
	}

	// Linux can finish a write even after its fd closes. Check the descriptor
	// itself, not only the eventual bytes, to detect premature duplicate closure.
	var stat syscall.Stat_t
	if err := syscall.Fstat(duplicate, &stat); err != nil {
		t.Fatal("private duplicate closed before write completion:", err)
	}
	if stat.Dev != identity.Dev || stat.Ino != identity.Ino {
		t.Fatal("private duplicate was reused before write completion")
	}
	flags, err := unix.FcntlInt(uintptr(duplicate), unix.F_GETFD, 0)
	if err != nil || flags&unix.FD_CLOEXEC == 0 {
		t.Fatalf("private duplicate lacks close-on-exec: flags=%d err=%v", flags, err)
	}

	// EOF also proves that the private duplicate closes after the syscall,
	// even though the caller has not yet received the buffered result.
	got, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal("drain did not reach EOF:", err)
	}
	if want := append(bytes.Clone(filler), payload...); !bytes.Equal(got, want) {
		t.Fatalf("pipe payload differs: got %d bytes, want %d", len(got), len(want))
	}
	select {
	case got := <-result:
		finished = true
		if got.err != nil || got.n != len(payload) {
			t.Fatalf("late write result: %+v", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("missing late write result")
	}
}

func TestStartWriteExpiredDeadlineClosesDuplicateOffline(t *testing.T) {
	transport, reader := startWritePipe(t)
	result, err := transport.StartWrite([]byte{0xa5}, time.Now().Add(-time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := transport.Close(); err != nil {
		t.Fatal(err)
	}
	transport.fd = -1
	select {
	case got := <-result:
		if got.n != 0 || !errors.Is(got.err, os.ErrDeadlineExceeded) {
			t.Fatalf("expired write result: %+v", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("expired write did not finish")
	}
	data, err := io.ReadAll(reader)
	if err != nil || len(data) != 0 {
		t.Fatalf("expired write must close without data: data=%x err=%v", data, err)
	}
}

type stalledWriter struct{ fakeTransport }

func (f *stalledWriter) StartWrite(b []byte, _ time.Time) (<-chan writeResult, error) {
	f.commands = append(f.commands, b[2])
	return make(chan writeResult), nil
}

func TestSubmittedWriteTimeoutStopsSession(t *testing.T) {
	f := &stalledWriter{}
	start := time.Now()
	if _, err := queryWithTimeout(f, 1, 10*time.Millisecond); !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatal(err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("write wait not bounded")
	}
	if !reflect.DeepEqual(f.commands, []byte{1}) || !reflect.DeepEqual(f.waits, []bool{true}) {
		t.Fatal("continued after write timeout")
	}
}
