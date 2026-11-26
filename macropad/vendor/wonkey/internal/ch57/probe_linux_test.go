package ch57

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"unsafe"

	"golang.org/x/sys/unix"
)

func syntheticProbeReportDescriptor() []byte {
	return []byte{
		0x06, 0x00, 0xff, 0x09, 0x01, 0xa1, 0x01, 0x85, 0x03,
		0x09, 0x02, 0x15, 0x00, 0x26, 0x00, 0xff,
		0x75, 0x08, 0x95, 0x40, 0x81, 0x06,
		0x09, 0x02, 0x15, 0x00, 0x26, 0x00, 0xff,
		0x75, 0x08, 0x95, 0x40, 0x91, 0x06, 0xc0,
	}
}

func makeProbeSysfs(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "1-2.3")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{
		"descriptors": syntheticCandidateDescriptors(),
		"busnum":      []byte("1\n"),
		"devnum":      []byte("19\n"),
		"dev":         []byte("189:18\n"),
	} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func discoveredProbeCandidate(t *testing.T, root string) DiscoveredCandidate {
	t.Helper()
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover: %v, %v", candidates, err)
	}
	return candidates[0]
}

func TestDiscoverCandidates(t *testing.T) {
	root := makeProbeSysfs(t)
	for _, name := range []string{"usb1", "1-2.3:1.1", "hidraw0", "2-1"} {
		if err := os.Mkdir(filepath.Join(root, name), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	candidate := discoveredProbeCandidate(t, root)
	if candidate.PhysicalPath != "1-2.3" || candidate.BusNumber != 1 || candidate.DeviceNumber != 19 ||
		candidate.SysfsPath != filepath.Join(root, "1-2.3") || candidate.identity == ([2]uint64{}) {
		t.Fatalf("wrong candidate: %+v", candidate)
	}
	if _, err := DiscoverCandidates("relative"); err == nil {
		t.Fatal("accepted relative sysfs root")
	}
	if _, err := DiscoverCandidates(filepath.Join(root, "absent")); err == nil {
		t.Fatal("accepted missing sysfs root")
	}
}

func TestDiscoverCandidatesRejectsAttributes(t *testing.T) {
	for _, tt := range []struct {
		name, value string
	}{
		{"busnum", "2\n"},
		{"busnum", "0\n"},
		{"busnum", "+1\n"},
		{"busnum", "65536\n"},
		{"busnum", "\n"},
		{"busnum", " 1\n"},
		{"busnum", "9999999999999999"},
		{"busnum", strings.Repeat("1", 17)},
		{"devnum", "0\n"},
		{"devnum", "128\n"},
		{"devnum", "-1\n"},
		{"dev", "189:19\n"},
		{"dev", "1:18\n"},
		{"descriptors", ""},
		{"descriptors", candidateUSBDescriptor + "x"},
		{"descriptors", candidateUSBDescriptor[:8] + "\x00" + candidateUSBDescriptor[9:]},
	} {
		t.Run(tt.name+"="+tt.value, func(t *testing.T) {
			root := makeProbeSysfs(t)
			if err := os.WriteFile(filepath.Join(root, "1-2.3", tt.name), []byte(tt.value), 0o600); err != nil {
				t.Fatal(err)
			}
			candidates, err := DiscoverCandidates(root)
			wantError := tt.name != "descriptors"
			if (err != nil) != wantError || len(candidates) != 0 {
				t.Fatalf("invalid attribute: candidates=%v, error=%v, wantError=%v", candidates, err, wantError)
			}
			if wantError && !strings.Contains(err.Error(), "1-2.3") {
				t.Fatalf("missing candidate path: %v", err)
			}
		})
	}
}

func TestDiscoverCandidatesInspectionFailures(t *testing.T) {
	for _, operation := range []string{"descriptors", "busnum", "devnum", "dev", "second stat", "identity"} {
		t.Run(operation, func(t *testing.T) {
			fake := newFakeProbe(t)
			if operation == "second stat" || operation == "identity" {
				stat := fake.ops.stat
				calls := 0
				fake.ops.stat = func(path string) (os.FileInfo, error) {
					calls++
					if calls == 2 {
						if operation == "identity" {
							return os.Stat(t.TempDir())
						}
						return nil, unix.EACCES
					}
					return stat(path)
				}
			} else {
				readFile := fake.ops.readFile
				fake.ops.readFile = func(path string, limit int) ([]byte, error) {
					if filepath.Base(path) == operation {
						return nil, unix.EACCES
					}
					return readFile(path, limit)
				}
			}
			candidates, err := fake.ops.discover(fake.root)
			wantError := operation != "descriptors"
			if (err != nil) != wantError || len(candidates) != 0 {
				t.Fatalf("inspection failure: candidates=%v, error=%v, wantError=%v", candidates, err, wantError)
			}
			if wantError && (!strings.Contains(err.Error(), "1-2.3") || (operation != "identity" && !errors.Is(err, unix.EACCES))) {
				t.Fatalf("lost candidate path or cause: %v", err)
			}
			if fake.opened != 0 || len(fake.calls) != 0 {
				t.Fatal("discovery accessed a USB device node")
			}
		})
	}
}

func TestDiscoverCandidatesSysfsLinks(t *testing.T) {
	root := makeProbeSysfs(t)
	links := t.TempDir()
	if err := os.Symlink(filepath.Join(root, "1-2.3"), filepath.Join(links, "1-2.3")); err != nil {
		t.Fatal(err)
	}
	candidate := discoveredProbeCandidate(t, links)
	if candidate.SysfsPath != filepath.Join(root, "1-2.3") {
		t.Fatal("did not resolve the physical path")
	}
	if err := os.Symlink(filepath.Join(root, "1-2.3"), filepath.Join(links, "1-4")); err != nil {
		t.Fatal(err)
	}
	if found, err := DiscoverCandidates(links); err != nil || len(found) != 1 {
		t.Fatalf("accepted a physical path alias: %v, %v", found, err)
	}
}

func TestReadProbeFileBounds(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "attribute")
	if err := os.WriteFile(path, []byte("12345"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := readProbeFile(path, 5); err != nil || string(got) != "12345" {
		t.Fatalf("exact bound: %q, %v", got, err)
	}
	if _, err := readProbeFile(path, 4); err == nil {
		t.Fatal("accepted oversized attribute")
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{link, root, filepath.Join(root, "absent")} {
		if _, err := readProbeFile(name, 16); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	fifo := filepath.Join(root, "fifo")
	if err := unix.Mkfifo(fifo, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readProbeFile(fifo, 16); err == nil {
		t.Fatal("accepted FIFO")
	}
}

type fakeProbe struct {
	ops          probeOps
	root         string
	target       DiscoveredCandidate
	opened       int
	closed       int
	detached     int
	claimed      int
	released     int
	attached     int
	calls        []usbControlTransfer
	written      []Report
	node         unix.Stat_t
	openErr      error
	closeErr     error
	outputReport bool
}

func newFakeProbe(t *testing.T) *fakeProbe {
	t.Helper()
	root := makeProbeSysfs(t)
	fake := &fakeProbe{
		ops: systemProbeOps(), root: root, target: discoveredProbeCandidate(t, root),
		node: unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 2, Ino: 100, Rdev: unix.Mkdev(189, 18)},
	}
	fake.ops.open = func(path string, flags int, mode uint32) (int, error) {
		fake.opened++
		if path != "/synthetic-usb/001/019" || flags != unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC || mode != 0 {
			t.Fatalf("unsafe open: %s, %#x, %#x", path, flags, mode)
		}
		return 77, fake.openErr
	}
	fake.ops.lstat = func(path string, st *unix.Stat_t) error {
		if path != "/synthetic-usb/001/019" {
			t.Fatalf("unexpected node stat: %s", path)
		}
		*st = fake.node
		return nil
	}
	fake.ops.fstat = func(fd int, st *unix.Stat_t) error {
		if fd != 77 {
			t.Fatalf("unexpected fd: %d", fd)
		}
		*st = fake.node
		return nil
	}
	fake.ops.close = func(fd int) error {
		if fd != 77 {
			t.Fatalf("unexpected close fd: %d", fd)
		}
		fake.closed++
		return fake.closeErr
	}
	fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
		if fd != 77 || request != usbdevfsControl || transfer.Index != 1 || transfer.Timeout != 1000 || transfer.Data == nil {
			t.Fatalf("unsafe ioctl: fd=%d request=%x transfer=%+v", fd, request, transfer)
		}
		fake.calls = append(fake.calls, *transfer)
		data := unsafe.Slice((*byte)(transfer.Data), transfer.Length)
		switch len(fake.calls) {
		case 1:
			if transfer.RequestType != 0x81 || transfer.Request != 6 || transfer.Value != 0x2200 || transfer.Length != 36 {
				t.Fatalf("wrong descriptor request: %+v", transfer)
			}
			copy(data, syntheticProbeReportDescriptor())
		case 2:
			value := uint16(0x0103)
			if fake.outputReport {
				value = 0x0203
			}
			if transfer.RequestType != 0xa1 || transfer.Request != 1 || transfer.Value != value || transfer.Length != 65 {
				t.Fatalf("wrong report request: %+v", transfer)
			}
			data[0] = 3
			for i := 1; i < len(data); i++ {
				data[i] = byte(i)
			}
		default:
			t.Fatal("unexpected retry or additional ioctl")
		}
		return len(data), nil
	}
	fake.ops.detachDriver = func(fd int, ifno int32) error {
		if fd != 77 || ifno != 1 || fake.closed != 0 {
			t.Fatalf("unsafe detachDriver: fd=%d ifno=%d closed=%d", fd, ifno, fake.closed)
		}
		fake.detached++
		return nil
	}
	fake.ops.claimInterface = func(fd int, ifno uint32) error {
		if fd != 77 || ifno != 1 || fake.detached != 1 || fake.closed != 0 {
			t.Fatalf("unsafe claimInterface: fd=%d ifno=%d detached=%d closed=%d", fd, ifno, fake.detached, fake.closed)
		}
		fake.claimed++
		return nil
	}
	fake.ops.releaseInterface = func(fd int, ifno uint32) error {
		if fd != 77 || ifno != 1 || fake.claimed != 1 || fake.closed != 0 {
			t.Fatalf("unsafe releaseInterface: fd=%d ifno=%d claimed=%d closed=%d", fd, ifno, fake.claimed, fake.closed)
		}
		fake.released++
		return nil
	}
	fake.ops.attachDriver = func(fd int, ifno int32) error {
		if fd != 77 || ifno != 1 || fake.closed != 0 {
			t.Fatalf("unsafe attachDriver: fd=%d ifno=%d closed=%d", fd, ifno, fake.closed)
		}
		fake.attached++
		return nil
	}
	fake.ops.bulkOut = func(fd int, transfer *usbBulkTransfer) (int, error) {
		if fd != 77 || fake.claimed != 1 || fake.released != 0 || fake.closed != 0 ||
			transfer == nil || transfer.Ep != 0x02 || transfer.Len != 64 || transfer.Timeout != 1000 || transfer.Data == nil {
			t.Fatalf("unsafe bulkOut: fd=%d claimed=%d released=%d closed=%d transfer=%+v", fd, fake.claimed, fake.released, fake.closed, transfer)
		}
		var report Report
		copy(report[:], unsafe.Slice((*byte)(transfer.Data), transfer.Len))
		fake.written = append(fake.written, report)
		return int(transfer.Len), nil
	}
	return fake
}

func (fake *fakeProbe) apply(reports []Report) (ApplyResult, error) {
	return fake.ops.apply(fake.root, "/synthetic-usb", fake.target, reports)
}

func (fake *fakeProbe) run() (ProbeResult, error) {
	if fake.outputReport {
		return fake.ops.probeReport(fake.root, "/synthetic-usb", fake.target, true)
	}
	return fake.ops.probe(fake.root, "/synthetic-usb", fake.target)
}

func TestProbeOutputCandidateReplies(t *testing.T) {
	for _, tc := range []struct {
		name   string
		count  int
		err    error
		first  byte
		status ProbeStatus
	}{
		{"raw", 65, nil, 3, ProbeRawReport},
		{"observed-short", 1, nil, 0xaa, ProbeRawReport},
		{"short-one-other", 1, nil, 0xab, ProbeInvalidReport},
		{"short", 64, nil, 3, ProbeInvalidReport},
		{"empty", 0, nil, 0, ProbeInvalidReport},
		{"wrong-id", 65, nil, 0xaa, ProbeInvalidReport},
		{"long", 66, nil, 3, ProbeInvalidReport},
		{"negative", -1, nil, 3, ProbeInvalidReport},
		{"partial-error", 2, unix.EIO, 0xaa, ProbeTransferFailed},
		{"stall", 0, unix.EPIPE, 0, ProbeTransferFailed},
		{"timeout", 0, unix.ETIMEDOUT, 0, ProbeTransferFailed},
		{"busy", 0, unix.EBUSY, 0, ProbeTransferFailed},
		{"permission", 0, unix.EACCES, 0, ProbeTransferFailed},
		{"disconnect", 0, unix.ENODEV, 0, ProbeTransferFailed},
		{"interrupt", 0, unix.EINTR, 0, ProbeTransferFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeProbe(t)
			fake.outputReport = true
			ioctl := fake.ops.ioctl
			fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
				n, err := ioctl(fd, request, transfer)
				if len(fake.calls) == 2 {
					*(*byte)(transfer.Data) = tc.first
					return tc.count, tc.err
				}
				return n, err
			}
			result, err := fake.run()
			if (err != nil) != (tc.status != ProbeRawReport) || (tc.err != nil && !errors.Is(err, tc.err)) || result.Status != tc.status {
				t.Fatalf("result=%+v error=%v", result, err)
			}
			if result.Count != tc.count || fake.opened != 1 || fake.closed != 1 || len(fake.calls) != 2 {
				t.Fatalf("lost count or unexpected operations: %+v, %+v", result, fake)
			}
			if !result.ReportDescriptorVerified || result.ReportDescriptorCount != 36 || !bytes.Equal(result.ReportDescriptor, syntheticProbeReportDescriptor()) {
				t.Fatalf("lost descriptor: %+v", result)
			}
			var want []byte
			if tc.count >= 0 && tc.count <= 65 {
				want = make([]byte, tc.count)
				for i := range want {
					want[i] = byte(i)
				}
				if len(want) > 0 {
					want[0] = tc.first
				}
			}
			if !bytes.Equal(result.Raw, want) || !strings.Contains(result.Warning, "Raw output is not decoded settings") {
				t.Fatalf("lost raw evidence or warning: %+v", result)
			}
			if err != nil && !strings.Contains(err.Error(), "output GET_REPORT") {
				t.Fatal("missing Output request diagnostic", err)
			}
		})
	}
}

func TestProbeInputObservedShortReply(t *testing.T) {
	fake := newFakeProbe(t)
	ioctl := fake.ops.ioctl
	fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
		n, err := ioctl(fd, request, transfer)
		if len(fake.calls) == 2 {
			*(*byte)(transfer.Data) = 0xaa
			return 1, nil
		}
		return n, err
	}
	result, err := fake.run()
	if err != nil || result.Status != ProbeRawReport || result.Count != 1 || !bytes.Equal(result.Raw, []byte{0xaa}) || len(fake.calls) != 2 {
		t.Fatalf("Input 0xaa reply rejected: %+v, %v", result, err)
	}

	fake = newFakeProbe(t)
	ioctl = fake.ops.ioctl
	fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
		n, err := ioctl(fd, request, transfer)
		if len(fake.calls) == 2 {
			*(*byte)(transfer.Data) = 0xab
			return 1, nil
		}
		return n, err
	}
	result, err = fake.run()
	if err == nil || err.Error() != "input GET_REPORT returned 1 bytes, want 65 including report ID" || result.Status != ProbeInvalidReport || result.Count != 1 || !bytes.Equal(result.Raw, []byte{0xab}) || len(fake.calls) != 2 {
		t.Fatalf("Input invalid short reply accepted: %+v, %v", result, err)
	}
}

func TestProbeOutputCandidateGuards(t *testing.T) {
	for _, change := range []string{"identity", "node", "descriptor"} {
		t.Run(change, func(t *testing.T) {
			fake := newFakeProbe(t)
			fake.outputReport = true
			ioctl := fake.ops.ioctl
			fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
				n, err := ioctl(fd, request, transfer)
				switch change {
				case "identity":
					if err := os.WriteFile(filepath.Join(fake.root, "1-2.3", "devnum"), []byte("20\n"), 0o600); err != nil {
						t.Fatal(err)
					}
				case "node":
					fake.node.Ino++
				case "descriptor":
					*(*byte)(transfer.Data) ^= 1
				}
				return n, err
			}
			result, err := fake.run()
			if err == nil || len(fake.calls) != 1 || fake.closed != 1 || result.Status == ProbeRawReport {
				t.Fatalf("guard failed: %+v, %v, %+v", result, err, fake)
			}
		})
	}
	if result, err := ProbeOutputCandidate("relative", "relative", DiscoveredCandidate{}); err == nil || result.Status != ProbeRefused {
		t.Fatalf("accepted relative roots: %+v, %v", result, err)
	}
}

func TestControlINAllowsOutputRequest(t *testing.T) {
	data := make([]byte, 65)
	transfer := usbControlTransfer{RequestType: 0xa1, Request: 1, Value: 0x0203, Index: 1, Length: 65, Timeout: 1000, Data: unsafe.Pointer(&data[0])}
	if _, err := controlIN(-1, usbdevfsControl, &transfer); !errors.Is(err, syscall.EBADF) {
		t.Fatalf("Output GET_REPORT refused: %v", err)
	}
}

func TestProbeCandidateRawReport(t *testing.T) {
	fake := newFakeProbe(t)
	result, err := fake.run()
	if err != nil || result.Status != ProbeRawReport || !result.ReportDescriptorVerified || result.Count != 65 || len(result.Raw) != 65 {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	if result.ReportDescriptorCount != 36 || !bytes.Equal(result.ReportDescriptor, syntheticProbeReportDescriptor()) {
		t.Fatalf("lost report descriptor: %+v", result)
	}
	if result.Raw[0] != 3 || result.Raw[64] != 64 || result.Warning == "" || fake.opened != 1 || fake.closed != 1 || len(fake.calls) != 2 {
		t.Fatalf("wrong data or operation counts: %+v, %+v", result, fake)
	}
}

func TestProbeCandidateRefusesDrift(t *testing.T) {
	for _, phase := range []string{"before open", "after open", "after descriptor"} {
		for _, attribute := range []string{"descriptors", "busnum", "devnum", "dev"} {
			t.Run(phase+"/"+attribute, func(t *testing.T) {
				fake := newFakeProbe(t)
				change := func() {
					if err := os.WriteFile(filepath.Join(fake.root, "1-2.3", attribute), []byte("changed"), 0o600); err != nil {
						t.Fatal(err)
					}
				}
				switch phase {
				case "before open":
					change()
				case "after open":
					open := fake.ops.open
					fake.ops.open = func(path string, flags int, mode uint32) (int, error) {
						fd, err := open(path, flags, mode)
						change()
						return fd, err
					}
				case "after descriptor":
					ioctl := fake.ops.ioctl
					fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
						n, err := ioctl(fd, request, transfer)
						change()
						return n, err
					}
				}
				result, err := fake.run()
				wantOpened, wantCalls := 1, 0
				if phase == "before open" {
					wantOpened = 0
				}
				if phase == "after descriptor" {
					wantCalls = 1
				}
				if err == nil || result.Status != ProbeRefused || fake.opened != wantOpened || fake.closed != wantOpened || len(fake.calls) != wantCalls {
					t.Fatalf("result=%+v err=%v opens=%d closes=%d calls=%d", result, err, fake.opened, fake.closed, len(fake.calls))
				}
			})
		}
	}
}

func TestProbeCandidateNodeGuards(t *testing.T) {
	for _, tt := range []struct {
		name   string
		change func(*unix.Stat_t)
	}{
		{"regular", func(st *unix.Stat_t) { st.Mode = unix.S_IFREG | 0o600 }},
		{"symlink", func(st *unix.Stat_t) { st.Mode = unix.S_IFLNK | 0o777 }},
		{"block", func(st *unix.Stat_t) { st.Mode = unix.S_IFBLK | 0o600 }},
		{"major", func(st *unix.Stat_t) { st.Rdev = unix.Mkdev(1, 18) }},
		{"minor", func(st *unix.Stat_t) { st.Rdev = unix.Mkdev(189, 19) }},
		{"inode", func(st *unix.Stat_t) { st.Ino++ }},
		{"filesystem", func(st *unix.Stat_t) { st.Dev++ }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakeProbe(t)
			fstat := fake.ops.fstat
			fake.ops.fstat = func(fd int, st *unix.Stat_t) error {
				err := fstat(fd, st)
				tt.change(st)
				return err
			}
			result, err := fake.run()
			if err == nil || result.Status != ProbeRefused || fake.closed != 1 || len(fake.calls) != 0 {
				t.Fatalf("result=%+v, err=%v, closes=%d calls=%d", result, err, fake.closed, len(fake.calls))
			}
		})
	}
	for _, mode := range []uint32{unix.S_IFREG, unix.S_IFLNK, unix.S_IFBLK} {
		fake := newFakeProbe(t)
		fake.node.Mode = mode
		if _, err := fake.run(); err == nil || fake.opened != 0 {
			t.Fatalf("opened non-character node: mode=%x, err=%v", mode, err)
		}
	}
}

func TestProbeCandidateTransferFailures(t *testing.T) {
	for _, stage := range []int{1, 2} {
		for _, failure := range []string{"stall", "timeout", "busy", "permission", "disconnect", "interrupt", "zero", "short", "long", "negative", "wrong bytes"} {
			t.Run(probeStageName(stage)+"/"+failure, func(t *testing.T) {
				fake := newFakeProbe(t)
				ioctl := fake.ops.ioctl
				fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
					n, err := ioctl(fd, request, transfer)
					if len(fake.calls) != stage {
						return n, err
					}
					switch failure {
					case "stall":
						return 0, unix.EPIPE
					case "timeout":
						return 0, unix.ETIMEDOUT
					case "busy":
						return 0, unix.EBUSY
					case "permission":
						return 0, unix.EACCES
					case "disconnect":
						return 0, unix.ENODEV
					case "interrupt":
						return 0, unix.EINTR
					case "zero":
						return 0, nil
					case "short":
						return n - 1, nil
					case "long":
						return n + 1, nil
					case "negative":
						return -1, nil
					case "wrong bytes":
						*(*byte)(transfer.Data) = 0
					}
					return n, nil
				}
				result, err := fake.run()
				if err == nil || fake.closed != 1 || len(fake.calls) != stage || result.Status == ProbeRawReport {
					t.Fatalf("result=%+v, err=%v, closes=%d calls=%d", result, err, fake.closed, len(fake.calls))
				}
				if stage == 1 && (result.Status != ProbeDescriptorFailed || result.ReportDescriptorVerified) {
					t.Fatalf("accepted wrong descriptor: %+v", result)
				}
				if stage == 1 {
					wantCount := 0
					switch failure {
					case "short":
						wantCount = 35
					case "long":
						wantCount = 37
					case "negative":
						wantCount = -1
					case "wrong bytes":
						wantCount = 36
					}
					wantRaw := []byte(nil)
					if wantCount >= 0 && wantCount <= 36 {
						wantRaw = syntheticProbeReportDescriptor()[:wantCount]
						if failure == "wrong bytes" {
							wantRaw[0] = 0
						}
					}
					if result.ReportDescriptorCount != wantCount || !bytes.Equal(result.ReportDescriptor, wantRaw) {
						t.Fatalf("lost descriptor diagnostic: %+v", result)
					}
				}
				if stage == 2 && failure == "short" && (result.Count != 64 || len(result.Raw) != 64 || result.Raw[0] != 3) {
					t.Fatalf("lost short reply: %+v", result)
				}
			})
		}
	}
}

func probeStageName(stage int) string {
	if stage == 1 {
		return "descriptor"
	}
	return "report"
}

func TestProbeCandidateOpenAndCloseFailures(t *testing.T) {
	fake := newFakeProbe(t)
	fake.openErr = unix.EACCES
	if result, err := fake.run(); !errors.Is(err, unix.EACCES) || result.Status != ProbeRefused || fake.closed != 0 || len(fake.calls) != 0 {
		t.Fatalf("open failure: %+v, %v", result, err)
	}
	fake = newFakeProbe(t)
	fake.closeErr = unix.EIO
	if result, err := fake.run(); !errors.Is(err, unix.EIO) || result.Status != ProbeCloseFailed || result.Count != 65 || fake.closed != 1 {
		t.Fatalf("close failure: %+v, %v", result, err)
	}
}

func TestProbeCandidateSysfsIdentityAndSelection(t *testing.T) {
	for _, field := range []string{"inode", "resolved path", "candidate", "physical path"} {
		t.Run(field, func(t *testing.T) {
			fake := newFakeProbe(t)
			switch field {
			case "inode":
				fake.target.identity[1]++
			case "resolved path":
				fake.target.SysfsPath += "-changed"
			case "candidate":
				fake.target.PID++
			case "physical path":
				fake.target.PhysicalPath = "../1-2.3"
			}
			if result, err := fake.run(); err == nil || result.Status != ProbeRefused || fake.opened != 0 {
				t.Fatalf("selection change accepted: %+v, %v", result, err)
			}
		})
	}
	if result, err := ProbeCandidate("relative", "relative", DiscoveredCandidate{}); err == nil || result.Status != ProbeRefused {
		t.Fatalf("accepted relative roots: %+v, %v", result, err)
	}
}

func TestProbeCandidateFilesystemFailures(t *testing.T) {
	for _, operation := range []string{"resolve", "stat", "descriptors", "busnum", "devnum", "dev", "lstat", "fstat", "second lstat"} {
		t.Run(operation, func(t *testing.T) {
			fake := newFakeProbe(t)
			sentinel := errors.New("synthetic filesystem failure")
			switch operation {
			case "resolve":
				fake.ops.evalSymlinks = func(string) (string, error) { return "", sentinel }
			case "stat":
				fake.ops.stat = func(string) (os.FileInfo, error) { return nil, sentinel }
			case "lstat":
				fake.ops.lstat = func(string, *unix.Stat_t) error { return sentinel }
			case "fstat":
				fake.ops.fstat = func(int, *unix.Stat_t) error { return sentinel }
			case "second lstat":
				lstat := fake.ops.lstat
				calls := 0
				fake.ops.lstat = func(path string, st *unix.Stat_t) error {
					calls++
					if calls == 2 {
						return sentinel
					}
					return lstat(path, st)
				}
			default:
				readFile := fake.ops.readFile
				fake.ops.readFile = func(path string, limit int) ([]byte, error) {
					if filepath.Base(path) == operation {
						return nil, sentinel
					}
					return readFile(path, limit)
				}
			}
			result, err := fake.run()
			if !errors.Is(err, sentinel) || result.Status != ProbeRefused || len(fake.calls) != 0 || fake.closed != fake.opened {
				t.Fatalf("result=%+v, err=%v, opens=%d closes=%d calls=%d", result, err, fake.opened, fake.closed, len(fake.calls))
			}
		})
	}
}

func TestProbeCandidateRejectsEveryReportDescriptorByteChange(t *testing.T) {
	for offset := range syntheticProbeReportDescriptor() {
		fake := newFakeProbe(t)
		ioctl := fake.ops.ioctl
		fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
			n, err := ioctl(fd, request, transfer)
			unsafe.Slice((*byte)(transfer.Data), transfer.Length)[offset] ^= 1
			return n, err
		}
		if result, err := fake.run(); err == nil || result.Status != ProbeDescriptorFailed || len(fake.calls) != 1 || fake.closed != 1 {
			t.Fatalf("accepted descriptor change at %d: %+v, %v", offset, result, err)
		}
	}
}

func TestProbeCandidateDetectsDirectoryReplacement(t *testing.T) {
	fake := newFakeProbe(t)
	stat := fake.ops.stat
	calls := 0
	fake.ops.stat = func(path string) (os.FileInfo, error) {
		calls++
		if calls == 2 {
			return os.Stat(t.TempDir())
		}
		return stat(path)
	}
	if result, err := fake.run(); err == nil || result.Status != ProbeRefused || fake.opened != 0 {
		t.Fatalf("accepted directory replacement: %+v, %v", result, err)
	}
}

func TestReadControlRejectsUnboundedBuffers(t *testing.T) {
	ops := probeOps{ioctl: func(int, uintptr, *usbControlTransfer) (int, error) {
		t.Fatal("invalid buffer reached ioctl")
		return 0, nil
	}}
	for _, size := range []int{0, 66, 65536} {
		if _, err := ops.readControl(-1, 0xa1, 1, 0x0103, make([]byte, size)); err == nil {
			t.Fatalf("accepted buffer size %d", size)
		}
	}
}

func TestUSBControlABI(t *testing.T) {
	var transfer usbControlTransfer
	pointerSize := unsafe.Sizeof(transfer.Data)
	wantSize, wantOffset, wantRequest := uintptr(24), uintptr(16), uintptr(0xc0185500)
	if pointerSize == 4 {
		wantSize, wantOffset, wantRequest = 16, 12, 0xc0105500
	}
	if unsafe.Sizeof(transfer) != wantSize || unsafe.Offsetof(transfer.Data) != wantOffset || usbdevfsControl != wantRequest ||
		unsafe.Offsetof(transfer.RequestType) != 0 || unsafe.Offsetof(transfer.Request) != 1 || unsafe.Offsetof(transfer.Value) != 2 ||
		unsafe.Offsetof(transfer.Index) != 4 || unsafe.Offsetof(transfer.Length) != 6 || unsafe.Offsetof(transfer.Timeout) != 8 {
		t.Fatalf("wrong Linux control ABI: size=%d data=%d request=%x", unsafe.Sizeof(transfer), unsafe.Offsetof(transfer.Data), usbdevfsControl)
	}
}

func TestControlINRejectsOtherRequestsWithoutSyscall(t *testing.T) {
	data := make([]byte, 65)
	base := usbControlTransfer{RequestType: 0xa1, Request: 1, Value: 0x0103, Index: 1, Length: 65, Timeout: 1000, Data: unsafe.Pointer(&data[0])}
	for _, change := range []func(*usbControlTransfer){
		func(c *usbControlTransfer) { c.RequestType = 0x21 },
		func(c *usbControlTransfer) { c.Request = 9 },
		func(c *usbControlTransfer) { c.Value = 0x0303 },
		func(c *usbControlTransfer) { c.Value = 0x0202 },
		func(c *usbControlTransfer) { c.Index = 0 },
		func(c *usbControlTransfer) { c.Length = 66 },
		func(c *usbControlTransfer) { c.Timeout = 0 },
		func(c *usbControlTransfer) { c.Data = nil },
	} {
		transfer := base
		change(&transfer)
		if _, err := controlIN(-1, usbdevfsControl, &transfer); err == nil || errors.Is(err, syscall.EBADF) {
			t.Fatalf("request reached syscall: %+v, %v", transfer, err)
		}
	}
	if _, err := controlIN(-1, 0, &base); err == nil || errors.Is(err, syscall.EBADF) {
		t.Fatalf("wrong ioctl reached syscall: %v", err)
	}
	if _, err := controlIN(-1, usbdevfsControl, nil); err == nil {
		t.Fatal("accepted nil transfer")
	}
	if !bytes.Equal(data, make([]byte, 65)) {
		t.Fatal("refused request changed its data")
	}
}

func TestApplyCandidateWritesInitAndReports(t *testing.T) {
	fake := newFakeProbe(t)
	reports, err := EncodeKeyboard(TwelveKeyThreeKnob(2), Key3, []Stroke{
		{Modifiers: 0x01, Usage: 0x06},
		{Modifiers: 0x01, Usage: 0x19},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := fake.apply(reports)
	if err != nil || !result.WriteAttempted || result.ReportsWritten != len(reports) {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if fake.opened != 1 || fake.closed != 1 || len(fake.calls) != 1 ||
		fake.detached != 1 || fake.claimed != 1 || fake.released != 1 || fake.attached != 1 {
		t.Fatalf("unexpected operation counts: %+v", fake)
	}
	want := append([]Report{{}}, reports...)
	if len(fake.written) != len(want) {
		t.Fatalf("got %d written packets, want %d", len(fake.written), len(want))
	}
	for i := range want {
		if fake.written[i] != want[i] {
			t.Fatalf("packet %d: got %x, want %x", i, fake.written[i], want[i])
		}
	}
}

func TestApplyCandidateRefusesBeforeWrite(t *testing.T) {
	validReports, err := EncodeLED(TwelveKeyThreeKnob(1), 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name    string
		reports []Report
	}{
		{"empty-reports", nil},
		{"too-many-reports", make([]Report, 17)},
		{"wrong-report-id", []Report{{0x02, 0xfe, 0x01}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeProbe(t)
			result, err := fake.apply(tc.reports)
			if err == nil || result.WriteAttempted || fake.opened != 0 || len(fake.written) != 0 {
				t.Fatalf("result=%+v err=%v fake=%+v", result, err, fake)
			}
		})
	}
	if result, err := ApplyCandidate("relative", "relative", DiscoveredCandidate{}, validReports); err == nil || result.WriteAttempted {
		t.Fatalf("accepted relative roots: %+v, %v", result, err)
	}
	for _, stage := range []string{"descriptor-mismatch", "drift-after-descriptor", "detach-error", "claim-error"} {
		t.Run(stage, func(t *testing.T) {
			fake := newFakeProbe(t)
			switch stage {
			case "descriptor-mismatch":
				ioctl := fake.ops.ioctl
				fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
					n, err := ioctl(fd, request, transfer)
					*(*byte)(transfer.Data) ^= 1
					return n, err
				}
			case "drift-after-descriptor":
				ioctl := fake.ops.ioctl
				fake.ops.ioctl = func(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
					n, err := ioctl(fd, request, transfer)
					fake.node.Ino++
					return n, err
				}
			case "detach-error":
				fake.ops.detachDriver = func(int, int32) error { return unix.EPERM }
			case "claim-error":
				fake.ops.claimInterface = func(int, uint32) error { return unix.EBUSY }
			}
			result, err := fake.apply(validReports)
			if err == nil || result.WriteAttempted || result.ReportsWritten != 0 || len(fake.written) != 0 || fake.closed != 1 {
				t.Fatalf("stage=%s result=%+v err=%v fake=%+v", stage, result, err, fake)
			}
			if stage == "claim-error" && fake.attached != 1 {
				t.Fatalf("claim failure did not reattach driver: %+v", fake)
			}
		})
	}
}

func TestApplyCandidateWriteFailures(t *testing.T) {
	reports, err := EncodeLED(TwelveKeyThreeKnob(1), 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name           string
		failCall       int
		count          int
		err            error
		wantWritten    int
		wantErrContain string
	}{
		{"init-error", 1, 0, unix.EIO, 0, "write initialisation packet"},
		{"init-short", 1, 63, nil, 0, "wrote 63 bytes, want 64"},
		{"report-1-error", 2, 0, unix.ETIMEDOUT, 0, "write report 1"},
		{"report-2-short", 3, 32, nil, 1, "write report 2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeProbe(t)
			calls := 0
			bulkOut := fake.ops.bulkOut
			fake.ops.bulkOut = func(fd int, transfer *usbBulkTransfer) (int, error) {
				calls++
				if calls == tc.failCall {
					return tc.count, tc.err
				}
				return bulkOut(fd, transfer)
			}
			result, err := fake.apply(reports)
			if err == nil || !strings.Contains(err.Error(), tc.wantErrContain) || !result.WriteAttempted || result.ReportsWritten != tc.wantWritten {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if fake.released != 1 || fake.attached != 1 || fake.closed != 1 {
				t.Fatalf("cleanup missed on write failure: %+v", fake)
			}
		})
	}
}

func TestUSBBulkAndIoctlGuards(t *testing.T) {
	var bulk usbBulkTransfer
	pointerSize := unsafe.Sizeof(bulk.Data)
	wantBulkSize := uintptr(24)
	if pointerSize == 4 {
		wantBulkSize = 16
	}
	if unsafe.Sizeof(bulk) != wantBulkSize || unsafe.Offsetof(bulk.Ep) != 0 || unsafe.Offsetof(bulk.Len) != 4 || unsafe.Offsetof(bulk.Timeout) != 8 {
		t.Fatalf("unexpected usbBulkTransfer ABI: size=%d", unsafe.Sizeof(bulk))
	}
	var report Report
	valid := usbBulkTransfer{Ep: 0x02, Len: 64, Timeout: 1000, Data: unsafe.Pointer(&report[0])}
	if _, err := writeBulkOut(-1, &valid); !errors.Is(err, syscall.EBADF) {
		t.Fatalf("valid bulk transfer did not reach syscall: %v", err)
	}
	for _, change := range []func(*usbBulkTransfer){
		func(b *usbBulkTransfer) { b.Ep = 0x01 },
		func(b *usbBulkTransfer) { b.Ep = 0x82 },
		func(b *usbBulkTransfer) { b.Len = 63 },
		func(b *usbBulkTransfer) { b.Len = 65 },
		func(b *usbBulkTransfer) { b.Timeout = 0 },
		func(b *usbBulkTransfer) { b.Data = nil },
	} {
		invalid := valid
		change(&invalid)
		if _, err := writeBulkOut(-1, &invalid); err == nil || errors.Is(err, syscall.EBADF) {
			t.Fatalf("invalid bulk transfer reached syscall: %+v, %v", invalid, err)
		}
	}
	if _, err := writeBulkOut(-1, nil); err == nil {
		t.Fatal("accepted nil bulk transfer")
	}
	if err := claimUSBInterface(-1, 0); err == nil || errors.Is(err, syscall.EBADF) {
		t.Fatalf("interface 0 claim reached syscall: %v", err)
	}
	if err := releaseUSBInterface(-1, 0); err == nil || errors.Is(err, syscall.EBADF) {
		t.Fatalf("interface 0 release reached syscall: %v", err)
	}
	if err := detachUSBDriver(-1, 0); err == nil || errors.Is(err, syscall.EBADF) {
		t.Fatalf("interface 0 detach reached syscall: %v", err)
	}
	if err := attachUSBDriver(-1, 0); err == nil || errors.Is(err, syscall.EBADF) {
		t.Fatalf("interface 0 attach reached syscall: %v", err)
	}
}

func make514CSysfs(t *testing.T, pid uint16, hidrawName string) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "1-4.1")
	hidrawDir := filepath.Join(dir, "1-4.1:1.0", "0003:514C:8851.0001", "hidraw", hidrawName)
	if err := os.MkdirAll(hidrawDir, 0o700); err != nil {
		t.Fatal(err)
	}
	desc := []byte(candidate8851USBDescriptor)
	if pid == 0x8850 {
		desc = []byte(candidate8850USBDescriptor)
	}
	for name, data := range map[string][]byte{
		"descriptors": desc,
		"busnum":      []byte("1\n"),
		"devnum":      []byte("25\n"),
		"dev":         []byte("189:24\n"),
	} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	hidDir := filepath.Dir(filepath.Dir(hidrawDir))
	if err := os.WriteFile(filepath.Join(hidDir, "report_descriptor"), syntheticProbeReportDescriptor(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hidrawDir, "dev"), []byte("241:7\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestProbeAndApply514CHidraw(t *testing.T) {
	for _, tc := range []struct {
		name              string
		pid               uint16
		keys, knobs, kind int
		reportCount       int
		wantFA            [5]byte
	}{
		{"514c:8851-kind0", 0x8851, 4, 1, 0, 24, [5]byte{0x03, 0xfa, 0x0f, 0x03, 0x01}},
		{"514c:8850-kind11", 0x8850, 12, 4, 11, 25, [5]byte{0x03, 0xfa, 0x19, 0x00, 0x01}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := make514CSysfs(t, tc.pid, "hidraw7")
			candidates, err := DiscoverCandidates(root)
			if err != nil || len(candidates) != 1 || candidates[0].VID != 0x514c || candidates[0].PID != tc.pid {
				t.Fatalf("discover: %+v, %v", candidates, err)
			}
			candidate := candidates[0]
			ops := systemProbeOps()
			node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 3, Ino: 200, Rdev: unix.Mkdev(241, 7)}
			opened, closed := 0, 0
			var txReports [][65]byte
			readIndex := 0
			ops.lstat = func(path string, st *unix.Stat_t) error {
				if path != "/dev/hidraw7" {
					t.Fatalf("unexpected hidraw lstat path: %s", path)
				}
				*st = node
				return nil
			}
			ops.open = func(path string, flags int, mode uint32) (int, error) {
				opened++
				if path != "/dev/hidraw7" || flags != unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC || mode != 0 {
					t.Fatalf("unsafe hidraw open: %s %#x %#x", path, flags, mode)
				}
				return 88, nil
			}
			ops.fstat = func(fd int, st *unix.Stat_t) error {
				if fd != 88 {
					t.Fatalf("unexpected fd: %d", fd)
				}
				*st = node
				return nil
			}
			ops.close = func(fd int) error {
				if fd != 88 {
					t.Fatalf("unexpected close fd: %d", fd)
				}
				closed++
				return nil
			}
			ops.writeHidraw = func(fd int, data []byte) (int, error) {
				if fd != 88 || len(data) != 65 || data[0] != 0x03 {
					t.Fatalf("invalid hidraw write: fd=%d len=%d", fd, len(data))
				}
				var buf [65]byte
				copy(buf[:], data)
				txReports = append(txReports, buf)
				return 65, nil
			}
			ops.readHidraw = func(fd int, data []byte, timeoutMs int) (int, error) {
				if fd != 88 || len(data) != 65 || timeoutMs != 1000 {
					t.Fatalf("invalid hidraw read: fd=%d len=%d timeout=%d", fd, len(data), timeoutMs)
				}
				clear(data)
				readIndex++
				if readIndex == 1 {
					data[0] = 0x03
					data[1] = 0xfb
					data[2] = byte(tc.keys & 255)
					data[3] = byte(tc.knobs & 255)
					data[4] = byte(tc.kind & 255)
					return 65, nil
				}
				slot := byte((readIndex - 1) & 255)
				data[0] = 0x03
				data[1] = 0xfa
				data[2] = slot
				data[3] = 1
				data[4] = 1
				if tc.kind < 10 {
					data[10] = 1
					data[11] = 0
					data[12] = 0x04
				} else {
					data[6] = 1
					data[9] = 0x04
				}
				return 65, nil
			}
			probed, err := ops.probe(root, "/dev/bus/usb", candidate)
			if err != nil || probed.Status != ProbeRawReport || probed.Layout == nil {
				t.Fatalf("probe514C: %+v, %v", probed, err)
			}
			if probed.Layout.Keys != tc.keys || probed.Layout.Knobs != tc.knobs || probed.Layout.Kind != tc.kind {
				t.Fatalf("wrong layout: %+v", probed.Layout)
			}
			if len(txReports) != 2 || txReports[0][1] != 0xfb || !bytes.Equal(txReports[1][:5], tc.wantFA[:]) {
				t.Fatalf("unexpected probe TX: %x", txReports)
			}
			if readIndex != tc.reportCount+1 {
				t.Fatalf("unexpected probe RX count: got %d, want %d", readIndex, tc.reportCount+1)
			}
			b1 := probed.Layout.Bindings[1]
			if b1.ActionType != SlotActionKeyboard || len(b1.Strokes) != 1 || b1.Strokes[0] != (Stroke{Modifiers: 0, Usage: 0x04}) {
				t.Fatalf("wrong slot 1 binding: %+v", b1)
			}

			txReports = nil
			profile := K884xProfile(tc.pid, tc.kind, 1)
			reports, err := EncodeKeyboard(profile, Key1, []Stroke{{Modifiers: 0x01, Usage: 0x06}})
			if err != nil {
				t.Fatal(err)
			}
			applied, err := ops.apply(root, "/dev/bus/usb", candidate, reports)
			if err != nil || !applied.WriteAttempted || applied.ReportsWritten != len(reports) || len(txReports) != len(reports) {
				t.Fatalf("apply514C: %+v, %v, tx=%d", applied, err, len(txReports))
			}
			if opened != 2 || closed != 2 {
				t.Fatalf("opens=%d closes=%d", opened, closed)
			}
		})
	}
}

func TestDecodeFASlotKindLt10AndGe10(t *testing.T) {
	var rLtMod [65]byte
	rLtMod[0], rLtMod[1], rLtMod[2], rLtMod[3], rLtMod[4] = 0x03, 0xfa, 1, 1, 1
	rLtMod[10], rLtMod[11], rLtMod[12] = 0, 0x05, 0x00
	if b := DecodeFASlotKindLt10(rLtMod[:]); len(b.Strokes) != 1 || b.Strokes[0] != (Stroke{Modifiers: 0x05, Usage: 0}) {
		t.Fatalf("lt10 mod-only: %+v", b)
	}

	var rLtMedia [65]byte
	rLtMedia[0], rLtMedia[1], rLtMedia[2], rLtMedia[3], rLtMedia[4] = 0x03, 0xfa, 16, 1, 2
	rLtMedia[11], rLtMedia[12] = 0xe9, 0x00
	if b := DecodeFASlotKindLt10(rLtMedia[:]); b.MediaUsage != 0x00e9 {
		t.Fatalf("lt10 media: %+v", b)
	}

	var rLtMouse [65]byte
	rLtMouse[0], rLtMouse[1], rLtMouse[2], rLtMouse[3], rLtMouse[4] = 0x03, 0xfa, 17, 1, 3
	rLtMouse[11], rLtMouse[12], rLtMouse[13], rLtMouse[14], rLtMouse[15] = 0x01, 0x02, 0xfe, 0x03, 0x00
	if b := DecodeFASlotKindLt10(rLtMouse[:]); b.Mouse.Action != MouseDrag || b.Mouse.Buttons != MouseRight || b.Mouse.DX != -2 || b.Mouse.DY != 3 || b.Mouse.Modifier != MouseCtrl {
		t.Fatalf("lt10 mouse: %+v", b)
	}

	var rGeKey [65]byte
	rGeKey[0], rGeKey[1], rGeKey[2], rGeKey[3], rGeKey[4], rGeKey[6] = 0x03, 0xfa, 13, 1, 1, 4
	rGeKey[9], rGeKey[12], rGeKey[15], rGeKey[18] = 0xf1, 0xf2, 0x06, 0xf1
	bGe := DecodeFASlotKindGe10(rGeKey[:])
	wantStrokes := []Stroke{{Modifiers: 0x03, Usage: 0x06}, {Modifiers: 0x01, Usage: 0}}
	if !bytes.Equal(rGeKey[:2], []byte{0x03, 0xfa}) || len(bGe.Strokes) != 2 || bGe.Strokes[0] != wantStrokes[0] || bGe.Strokes[1] != wantStrokes[1] {
		t.Fatalf("ge10 strokes: %+v", bGe)
	}

	var rGeMedia [65]byte
	rGeMedia[0], rGeMedia[1], rGeMedia[2], rGeMedia[3], rGeMedia[4] = 0x03, 0xfa, 14, 1, 2
	rGeMedia[9], rGeMedia[12] = 0x92, 0x01
	if b := DecodeFASlotKindGe10(rGeMedia[:]); b.MediaUsage != 0x0192 {
		t.Fatalf("ge10 media: %+v", b)
	}

	var rGeMouse [65]byte
	rGeMouse[0], rGeMouse[1], rGeMouse[2], rGeMouse[3], rGeMouse[4] = 0x03, 0xfa, 15, 1, 3
	rGeMouse[9], rGeMouse[12], rGeMouse[15], rGeMouse[18], rGeMouse[21] = 0xf3, 0x00, 0x00, 0x00, 0xff
	if b := DecodeFASlotKindGe10(rGeMouse[:]); b.Mouse.Action != MouseWheel || b.Mouse.Wheel != -1 || b.Mouse.Modifier != MouseAlt {
		t.Fatalf("ge10 mouse: %+v", b)
	}
}

func TestDiscoverCandidatesRejectsLCKEY(t *testing.T) {
	for _, product := range []string{"LCKEY\n", "lckey\n", "  LcKeY \n"} {
		root := makeProbeSysfs(t)
		if err := os.WriteFile(filepath.Join(root, "1-2.3", "product"), []byte(product), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := systemProbeOps().inspect(root, "1-2.3"); err == nil {
			t.Fatalf("inspect accepted %q", product)
		}
		candidates, err := DiscoverCandidates(root)
		if err != nil || len(candidates) != 0 {
			t.Fatalf("DiscoverCandidates(%q): got %+v, %v", product, candidates, err)
		}
	}
}

func TestProbe514CWriteOnlyKindGe10FATimeout(t *testing.T) {
	root := make514CSysfs(t, 0x8850, "hidraw7")
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	candidate := candidates[0]
	ops := systemProbeOps()
	node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 3, Ino: 200, Rdev: unix.Mkdev(241, 7)}
	ops.lstat = func(_ string, st *unix.Stat_t) error { *st = node; return nil }
	ops.open = func(string, int, uint32) (int, error) { return 88, nil }
	ops.fstat = func(_ int, st *unix.Stat_t) error { *st = node; return nil }
	ops.close = func(int) error { return nil }
	ops.writeHidraw = func(_ int, data []byte) (int, error) { return len(data), nil }

	readCall := 0
	ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
		readCall++
		if readCall == 1 {
			clear(data)
			data[0], data[1], data[2], data[3], data[4] = 0x03, 0xfb, 12, 4, 11
			return 65, nil
		}
		return 0, unix.ETIMEDOUT
	}
	probed, err := ops.probe(root, "/dev/bus/usb", candidate)
	if err != nil || probed.Status != ProbeRawReport || probed.Layout == nil {
		t.Fatalf("expected fallback layout on first 0xFA timeout: %+v, %v", probed, err)
	}
	if probed.Layout.Keys != 12 || probed.Layout.Knobs != 4 || probed.Layout.Kind != 11 || len(probed.Layout.Bindings) != 0 {
		t.Fatalf("unexpected fallback layout: %+v", probed.Layout)
	}
	if len(probed.Raw) != 65 || probed.Raw[0] != 0x03 || probed.Raw[1] != 0xfb {
		t.Fatalf("expected rawFB preserved, got %x", probed.Raw)
	}
}
