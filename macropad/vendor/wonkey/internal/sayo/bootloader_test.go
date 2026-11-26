package sayo

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const bootloaderFixtureDir = "testdata/bootloader-2x3p-20261109"

// liveDir12ConfigJSON copies the live https://a.sayobot.cn/firmware/update/12/config.json header
// (fetched 2026-11-09), trimmed to the model_code 6 (2x3P) entry.
const liveDir12ConfigJSON = `{
	"vid": 32905,
	"pid": 12,
	"pid2": 12,
	"addr_len": 4,
	"boot_info_addr": 6080,
	"addr_byte_order_be": 0,
	"encrypt_flag": 0,
	"erase_flash": 1,
	"hid_checksum": 1,
	"hid_err_for_size": 0,
	"cmd": {
		"GET_BOOT_VERSION": 0,
		"CHECK_FW": 1,
		"WRITE_DATA": 2,
		"EXECUTE_APP": 3,
		"ERASE_FLASH": 4,
		"VERIFY": 5
	},
	"data": [
		{
			"model": "2X3_RGB_V2",
			"model_code": 6,
			"version": 2214,
			"file_path": "firmware/app_2X3_RGB_V2.bin"
		}
	]
}`

func liveDir12Manifest(t *testing.T) (FirmwareManifest, FirmwareManifestEntry) {
	t.Helper()
	manifest, err := FetchFirmwareManifestFrom(FirmwareCDNBaseURL, 0x000c, func(string, int) ([]byte, error) {
		return []byte(liveDir12ConfigJSON), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	entry, ok := manifest.FindEntry(6)
	if !ok {
		t.Fatal("live directory 12 manifest has no model_code 6 entry")
	}
	return manifest, entry
}

func readBootloaderFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(bootloaderFixtureDir, name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func writeSysfsFiles(t *testing.T, dir string, files map[string][]byte) {
	t.Helper()
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// writeAuthenticBootloaderSysfs replaces root/7-1.4.3.4 with the captured bootloader layout.
// The hidraw dev number 241:5 is synthetic because the capture did not record it.
func writeAuthenticBootloaderSysfs(t *testing.T, root string) {
	t.Helper()
	dir := filepath.Join(root, "7-1.4.3.4")
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	iface := filepath.Join(dir, "7-1.4.3.4:1.0")
	hid := filepath.Join(iface, "0003:8089:000C.0031")
	hidraw := filepath.Join(hid, "hidraw", "hidraw5")
	for _, sub := range []string{hidraw, filepath.Join(iface, "ep_03"), filepath.Join(iface, "ep_82"), filepath.Join(iface, "power"), filepath.Join(iface, "usbmisc")} {
		if err := os.MkdirAll(sub, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for _, link := range []string{"driver", "subsystem"} {
		if err := os.Symlink(root, filepath.Join(iface, link)); err != nil {
			t.Fatal(err)
		}
	}
	ifaceFiles := map[string][]byte{}
	for _, name := range []string{"authorized", "bAlternateSetting", "bInterfaceClass", "bInterfaceNumber", "bInterfaceProtocol", "bInterfaceSubClass", "bNumEndpoints", "modalias", "supports_autosuspend", "uevent"} {
		ifaceFiles[name] = nil
	}
	writeSysfsFiles(t, iface, ifaceFiles)
	writeSysfsFiles(t, dir, map[string][]byte{
		"descriptors": readBootloaderFixture(t, "descriptors"),
		"product":     []byte("Bootloader\n"),
		"busnum":      []byte("7\n"),
		"devnum":      []byte("36\n"),
		"dev":         []byte("189:803\n"),
	})
	writeSysfsFiles(t, hid, map[string][]byte{
		"report_descriptor": readBootloaderFixture(t, "report_descriptor"),
		"uevent":            readBootloaderFixture(t, "uevent"),
	})
	writeSysfsFiles(t, hidraw, map[string][]byte{"dev": []byte("241:5\n")})
}

// writeApplicationSysfs replaces root/7-1.4.3.4 with the synthetic two-interface 2x3P application layout.
func writeApplicationSysfs(t *testing.T, root string, devnum int) {
	t.Helper()
	dir := filepath.Join(root, "7-1.4.3.4")
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	hid := filepath.Join(dir, "7-1.4.3.4:1.1", "0003:8089:000C.0030")
	hidraw := filepath.Join(hid, "hidraw", "hidraw17")
	if err := os.MkdirAll(hidraw, 0o700); err != nil {
		t.Fatal(err)
	}
	writeSysfsFiles(t, dir, map[string][]byte{
		"descriptors": []byte(candidateSayo000CUSBDescriptor),
		"product":     []byte("SayoDevice 2x3P\n"),
		"busnum":      []byte("7\n"),
		"devnum":      fmt.Appendf(nil, "%d\n", devnum),
		"dev":         fmt.Appendf(nil, "189:%d\n", 6*128+devnum-1),
	})
	writeSysfsFiles(t, hid, map[string][]byte{"report_descriptor": []byte(candidateSayoReportDescriptor)})
	writeSysfsFiles(t, hidraw, map[string][]byte{"dev": []byte("241:17\n")})
}

type fakeHidraw struct {
	opened  []string
	closed  []int
	openErr func(path string) error
}

// stubHidrawNodes maps /dev/hidrawN to a character device 241:N opened as fd 100+N.
func stubHidrawNodes(ops *probeOps) *fakeHidraw {
	fake := &fakeHidraw{}
	node := func(minor uint32) unix.Stat_t {
		return unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 4, Ino: uint64(400 + minor), Rdev: unix.Mkdev(241, minor)}
	}
	minorOf := func(path string) (uint32, bool) {
		n, err := strconv.ParseUint(strings.TrimPrefix(path, "/dev/hidraw"), 10, 8)
		return uint32(n), err == nil && strings.HasPrefix(path, "/dev/hidraw")
	}
	ops.lstat = func(path string, st *unix.Stat_t) error {
		minor, ok := minorOf(path)
		if !ok {
			return unix.ENOENT
		}
		*st = node(minor)
		return nil
	}
	ops.open = func(path string, _ int, _ uint32) (int, error) {
		if fake.openErr != nil {
			if err := fake.openErr(path); err != nil {
				return -1, err
			}
		}
		minor, ok := minorOf(path)
		if !ok {
			return -1, unix.ENOENT
		}
		fake.opened = append(fake.opened, path)
		return 100 + int(minor), nil
	}
	ops.fstat = func(fd int, st *unix.Stat_t) error {
		minor, ok := minorOf(fmt.Sprintf("/dev/hidraw%d", fd-100))
		if !ok {
			return unix.EBADF
		}
		*st = node(minor)
		return nil
	}
	ops.access = func(path string, _ uint32) error {
		if _, ok := minorOf(path); !ok {
			return unix.ENOENT
		}
		return nil
	}
	ops.flock = func(int, int) error { return nil }
	ops.close = func(fd int) error {
		fake.closed = append(fake.closed, fd)
		return nil
	}
	return fake
}

// fakeBootClock makes sleep advance a fake clock and returns the elapsed fake time.
func fakeBootClock(ops *probeOps, wait time.Duration, onSleep func(elapsed time.Duration)) func() time.Duration {
	start := time.Unix(1_800_000_000, 0)
	now := start
	ops.bootWait = wait
	ops.now = func() time.Time { return now }
	ops.sleep = func(d time.Duration) {
		now = now.Add(d)
		if onSleep != nil {
			onSleep(now.Sub(start))
		}
	}
	return func() time.Duration { return now.Sub(start) }
}

// Synthetic replies: the capture holds no GET_BOOT_VERSION or CHECK_FW reply. The layouts follow the
// official tool: GET_BOOT_VERSION byte 1 is 0x02 with an ASCII string from byte 3, and CHECK_FW
// carries the firmware version in bytes 3..4 and the model code in bytes 5..6, big-endian.
func syntheticBootVersionReply() Packet {
	reply := Packet{0x02, 0x02, 0x0a}
	copy(reply[3:], "Bootloader")
	return reply
}

func syntheticCheckFWReply(modelCode, version uint16) Packet {
	reply := Packet{0x02, 0x00, 0x04}
	binary.BigEndian.PutUint16(reply[3:5], version)
	binary.BigEndian.PutUint16(reply[5:7], modelCode)
	return reply
}

func signedBootPacket(prefix ...byte) Packet {
	var pkt Packet
	copy(pkt[:], prefix)
	SignPacketV1(&pkt)
	return pkt
}

func TestAuthenticBootloaderCaptureMatchesAndOpens(t *testing.T) {
	descriptors := readBootloaderFixture(t, "descriptors")
	report := readBootloaderFixture(t, "report_descriptor")
	if len(descriptors) != 59 || len(report) != 54 {
		t.Fatalf("fixture lengths = %d, %d, want 59, 54", len(descriptors), len(report))
	}
	got, err := MatchCandidate("7-1.4.3.4", descriptors)
	if err != nil {
		t.Fatal(err)
	}
	want := Candidate{
		PhysicalPath: "7-1.4.3.4", VID: 0x8089, PID: 0x000c, Revision: 0x089a, Configuration: 1, VendorInterface: 0,
		Interfaces: [4]CandidateInterface{{0, 0, 3, 0, 0, 0x0110, 54, CandidateEndpoint{0x82, 3, 64, 1}}},
	}
	if got != want || IsBootloaderPID(got.VID, got.PID) {
		t.Fatalf("got %+v, want %+v (application PID, not a dedicated bootloader PID)", got, want)
	}
	if proto, ok := DetectProtocolVersion(report); !ok || proto != ProtocolV1 || !IsBootloaderReportDescriptor(report) {
		t.Fatalf("DetectProtocolVersion = (%v, %v), bootloader = %v", proto, ok, IsBootloaderReportDescriptor(report))
	}
	for _, app := range []string{candidateSayoReportDescriptor, candidateSayoV1OnlyReportDescriptor} {
		if IsBootloaderReportDescriptor([]byte(app)) {
			t.Fatalf("application descriptor %x detected as bootloader", app[:9])
		}
	}

	root := t.TempDir()
	writeAuthenticBootloaderSysfs(t, root)
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	c := candidates[0]
	if c.ProductName != "Bootloader" || !c.Bootloader || c.BusNumber != 7 || c.DeviceNumber != 36 || c.Candidate != want {
		t.Fatalf("candidate = %+v", c)
	}
	ops := systemProbeOps()
	fake := stubHidrawNodes(&ops)
	fd, err := ops.openBootloaderHidraw(root, "/dev/bus/usb", c)
	if err != nil || fd != 105 || len(fake.opened) != 1 || fake.opened[0] != "/dev/hidraw5" {
		t.Fatalf("openBootloaderHidraw = (%d, %v), opened %v", fd, err, fake.opened)
	}
}

func TestProbeAuthenticBootloaderIsQueryOnly(t *testing.T) {
	root := t.TempDir()
	writeAuthenticBootloaderSysfs(t, root)
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	c := candidates[0]

	t.Run("bootloader-reply", func(t *testing.T) {
		ops := systemProbeOps()
		stubHidrawNodes(&ops)
		var sent []Packet
		var pending []Packet
		ops.writeHidraw = func(fd int, data []byte) (int, error) {
			var pkt Packet
			copy(pkt[:], data)
			if fd != 105 {
				t.Fatalf("write on fd %d, want 105", fd)
			}
			sent = append(sent, pkt)
			switch pkt[1] {
			case 0x00:
				pending = append(pending, syntheticBootVersionReply())
			case 0x01:
				pending = append(pending, syntheticCheckFWReply(6, 2214))
			default:
				t.Fatalf("bare probe sent non-query packet %x", pkt[:8])
			}
			return 64, nil
		}
		var timeouts []int
		ops.readHidraw = func(_ int, data []byte, timeoutMs int) (int, error) {
			timeouts = append(timeouts, timeoutMs)
			copy(data, pending[0][:])
			pending = pending[1:]
			return 64, nil
		}
		probed, err := ops.probe(root, "/dev/bus/usb", c)
		if len(timeouts) != 2 || timeouts[1] != 2000 {
			t.Fatalf("reply timeouts = %v ms, want CHECK_FW at 2000 ms", timeouts)
		}
		if err != nil || probed.Status != ProbeRawReport || probed.Layout == nil {
			t.Fatalf("probe = (%+v, %v)", probed, err)
		}
		if l := probed.Layout; !l.Bootloader || l.Protocol != ProtocolV1 || l.ModelCode != 6 || l.FirmwareVersion != 2214 {
			t.Fatalf("layout = %+v", l)
		}
		wantSent := []Packet{signedBootPacket(0x02, 0x00, 0x00), signedBootPacket(0x02, 0x01, 0x00)}
		if len(sent) != len(wantSent) || sent[0] != wantSent[0] || sent[1] != wantSent[1] {
			t.Fatalf("sent %d packets, want GET_BOOT_VERSION 02 00 00 02 and CHECK_FW 02 01 00 03", len(sent))
		}
	})

	t.Run("application-reply-on-bootloader-descriptor", func(t *testing.T) {
		ops := systemProbeOps()
		stubHidrawNodes(&ops)
		writes := 0
		ops.writeHidraw = func(_ int, data []byte) (int, error) {
			writes++
			if data[1] != 0x00 {
				t.Fatalf("sent settings query to a bootloader descriptor: %x", data[:8])
			}
			return 64, nil
		}
		ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
			reply := Packet{0x02, 0x00, 0x04, 0x08, 0xa6, 0x00, 0x06}
			copy(data, reply[:])
			return 64, nil
		}
		probed, err := ops.probe(root, "/dev/bus/usb", c)
		if err == nil || probed.Status != ProbeInvalidReport || writes != 1 {
			t.Fatalf("probe = (%+v, %v), writes=%d", probed, err, writes)
		}
	})

	t.Run("apply-refused", func(t *testing.T) {
		ops := systemProbeOps()
		fake := stubHidrawNodes(&ops)
		ops.writeHidraw = func(int, []byte) (int, error) {
			t.Fatal("apply wrote to a bootloader")
			return 0, nil
		}
		req, err := PrepareRGBWrite(6, "static", 1, 2, 3, true)
		if err != nil {
			t.Fatal(err)
		}
		res, err := ops.apply(root, "/dev/bus/usb", c, req)
		if err == nil || res.WriteAttempted || len(fake.opened) != 0 {
			t.Fatalf("apply = (%+v, %v), opened %v", res, err, fake.opened)
		}
	})
}

func TestProbeBootloaderErrForSizeMatchesLiveManifests(t *testing.T) {
	// Directory values from the live manifests fetched 2026-11-09: only directory 2 (and its copy 6)
	// sets hid_err_for_size 1. hid_checksum applies only to WRITE_DATA, which bare probing never sends.
	for pid, want := range map[uint16]int{
		0x0002: 1, 0x0006: 1,
		0x0003: 0, 0x0004: 0, 0x0005: 0, 0x0007: 0, 0x0008: 0,
		0x0009: 0, 0x000b: 0, 0x000c: 0, 0x000e: 0,
	} {
		if got := probeBootloaderErrForSize(pid); got != want {
			t.Fatalf("probeBootloaderErrForSize(%#04x) = %d, want %d", pid, got, want)
		}
	}
	manifest, _ := liveDir12Manifest(t)
	if got := probeBootloaderErrForSize(0x000c); got != manifest.HIDErrForSize {
		t.Fatalf("probe hid_err_for_size %d differs from live directory 12 manifest %d", got, manifest.HIDErrForSize)
	}
}

// liveDir2ConfigJSON holds the framing fields of the live directory 2 manifest fetched 2026-11-09.
// No directory 2 hardware exists for testing, so these tests prove packet bytes only.
const liveDir2ConfigJSON = `{
	"vid": 32905,
	"pid": 2,
	"pid2": 6,
	"addr_len": 4,
	"addr_byte_order_be": 1,
	"encrypt_flag": 1,
	"erase_flash": 1,
	"hid_checksum": 0,
	"hid_err_for_size": 1,
	"cmd": {
		"GET_BOOT_VERSION": 0,
		"CHECK_FW": 1,
		"WRITE_DATA": 2,
		"EXECUTE_APP": 3,
		"ERASE_FLASH": 4,
		"VERIFY": 6
	},
	"data": [
		{
			"model": "O2",
			"model_code": 1,
			"version": 2192,
			"file_path": "STM32_firmware/O2.bin"
		}
	]
}`

func bootPacket(prefix []byte, data ...byte) Packet {
	var pkt Packet
	copy(pkt[:], append(append([]byte{}, prefix...), data...))
	return pkt
}

// TestFlashBootloaderPacketsByManifest pins every bootloader packet byte for byte. The expected
// bytes follow the official builders: GET_BOOT_VERSION 02 00 00 02, CHECK_FW 02 01 00 03, and
// ERASE_FLASH, VERIFY, and EXECUTE_APP with an appended 8-bit sum, whatever hid_checksum says.
// Only WRITE_DATA follows hid_checksum.
func TestFlashBootloaderPacketsByManifest(t *testing.T) {
	fw := make([]byte, 80)
	for i := range fw {
		fw[i] = byte(0x40 + i)
	}
	for _, tc := range []struct {
		name   string
		config string
		model  uint16
		want   []Packet
	}{
		{"directory-12", liveDir12ConfigJSON, 6, []Packet{
			bootPacket([]byte{0x02, 0x01, 0x00, 0x03}),
			bootPacket([]byte{0x02, 0x04, 0x04, 0x50, 0x00, 0x00, 0x00, 0x5a}),
			bootPacket([]byte{0x02, 0x02, 0x24, 0x00, 0x00, 0x00, 0x00}, append(append([]byte{}, fw[0:32]...), 0x18)...),
			bootPacket([]byte{0x02, 0x02, 0x24, 0x20, 0x00, 0x00, 0x00}, append(append([]byte{}, fw[32:64]...), 0x38)...),
			bootPacket([]byte{0x02, 0x02, 0x14, 0x40, 0x00, 0x00, 0x00}, append(append([]byte{}, fw[64:80]...), 0xd0)...),
			bootPacket([]byte{0x02, 0x05, 0x04, 0x40, 0x00, 0x00, 0x00, 0x4b}),
			bootPacket([]byte{0x02, 0x03, 0x00, 0x05}),
		}},
		{"directory-2", liveDir2ConfigJSON, 1, []Packet{
			bootPacket([]byte{0x02, 0x01, 0x00, 0x03}),
			bootPacket([]byte{0x02, 0x04, 0x04, 0x00, 0x00, 0x00, 0x50, 0x5a}),
			bootPacket([]byte{0x02, 0x02, 0x25, 0x00, 0x00, 0x00, 0x00, 0x01}, fw[0:32]...),
			bootPacket([]byte{0x02, 0x02, 0x25, 0x00, 0x00, 0x00, 0x20, 0x01}, fw[32:64]...),
			bootPacket([]byte{0x02, 0x02, 0x15, 0x00, 0x00, 0x00, 0x40, 0x01}, fw[64:80]...),
			bootPacket([]byte{0x02, 0x06, 0x04, 0x00, 0x00, 0x00, 0x40, 0x4c}),
			bootPacket([]byte{0x02, 0x03, 0x00, 0x05}),
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			manifest, err := FetchFirmwareManifestFrom(FirmwareCDNBaseURL, 0x000c, func(string, int) ([]byte, error) {
				return []byte(tc.config), nil
			})
			if err != nil {
				t.Fatal(err)
			}
			entry, ok := manifest.FindEntry(tc.model)
			if !ok {
				t.Fatalf("manifest has no model_code %d entry", tc.model)
			}
			if got, want := BootGetVersionPacket(), bootPacket([]byte{0x02, 0x00, 0x00, 0x02}); got != want {
				t.Fatalf("GET_BOOT_VERSION = %x, want %x", got[:8], want[:8])
			}
			ops := systemProbeOps()
			var sent []Packet
			var pending []Packet
			status := func(s byte) Packet {
				r := Packet{0x02}
				r[1+manifest.HIDErrForSize] = s
				return r
			}
			ops.writeHidraw = func(_ int, data []byte) (int, error) {
				var pkt Packet
				copy(pkt[:], data)
				sent = append(sent, pkt)
				switch pkt[1] {
				case 0x01:
					pending = append(pending, syntheticCheckFWReply(tc.model, 2214))
				case 0x02, 0x04:
					pending = append(pending, status(0x00))
				case 0x05, 0x06:
					pending = append(pending, status(0x01))
				}
				return 64, nil
			}
			ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
				copy(data, pending[0][:])
				pending = pending[1:]
				return 64, nil
			}
			if _, err := ops.flashBootloader(7, manifest, entry, fw, ApplyResult{}, nil, nil); err != nil {
				t.Fatalf("flashBootloader: %v", err)
			}
			if len(sent) != len(tc.want) {
				t.Fatalf("sent %d packets, want %d", len(sent), len(tc.want))
			}
			for i := range tc.want {
				if sent[i] != tc.want[i] {
					t.Fatalf("packet %d = %x, want %x", i, sent[i][:48], tc.want[i][:48])
				}
			}
		})
	}
}

func TestBareProbeDirectory2BootloaderSendsSignedQueries(t *testing.T) {
	ops := systemProbeOps()
	var sent []Packet
	var pending []Packet
	ops.writeHidraw = func(_ int, data []byte) (int, error) {
		var pkt Packet
		copy(pkt[:], data)
		sent = append(sent, pkt)
		if pkt[1] == 0x00 {
			pending = append(pending, syntheticBootVersionReply())
		} else {
			pending = append(pending, syntheticCheckFWReply(1, 2192))
		}
		return 64, nil
	}
	ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
		copy(data, pending[0][:])
		pending = pending[1:]
		return 64, nil
	}
	model, version, boot, _, err := ops.readV1InfoOrBootloader(7, 0x0006)
	if err != nil || !boot || model != 1 || version != 2192 {
		t.Fatalf("readV1InfoOrBootloader = (%d, %d, %v, %v)", model, version, boot, err)
	}
	want := []Packet{bootPacket([]byte{0x02, 0x00, 0x00, 0x02}), bootPacket([]byte{0x02, 0x01, 0x00, 0x03})}
	if len(sent) != len(want) || sent[0] != want[0] || sent[1] != want[1] {
		t.Fatalf("sent %d packets, want GET_BOOT_VERSION 02 00 00 02 and CHECK_FW 02 01 00 03", len(sent))
	}
}

func TestFlashFirmwareFromBootloaderWithLiveDir12Manifest(t *testing.T) {
	root := t.TempDir()
	writeAuthenticBootloaderSysfs(t, root)
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	manifest, entry := liveDir12Manifest(t)
	if entry.Model != "2X3_RGB_V2" || entry.Version != 2214 || entry.FilePath != "firmware/app_2X3_RGB_V2.bin" || entry.ROMSize != 0 {
		t.Fatalf("entry = %+v", entry)
	}
	fw := make([]byte, 80)
	for i := range fw {
		fw[i] = byte(0x40 + i)
	}
	ops := systemProbeOps()
	stubHidrawNodes(&ops)
	var sent []Packet
	var pending []Packet
	var timeouts []int
	ops.writeHidraw = func(fd int, data []byte) (int, error) {
		if fd != 105 {
			t.Fatalf("write on fd %d, want 105 (/dev/hidraw5)", fd)
		}
		var pkt Packet
		copy(pkt[:], data)
		sent = append(sent, pkt)
		switch pkt[1] {
		case 0x00:
			pending = append(pending, syntheticBootVersionReply())
		case 0x01:
			pending = append(pending, syntheticCheckFWReply(6, 2214))
		case 0x02, 0x04:
			pending = append(pending, Packet{0x02, 0x00})
		case 0x05:
			pending = append(pending, Packet{0x02, 0x01})
		case 0x03:
			return 0, unix.ENODEV
		}
		return 64, nil
	}
	ops.readHidraw = func(_ int, data []byte, timeoutMs int) (int, error) {
		timeouts = append(timeouts, timeoutMs)
		copy(data, pending[0][:])
		pending = pending[1:]
		return 64, nil
	}
	res, err := ops.flashFirmware(root, "/dev/bus/usb", candidates[0], ProtocolV1, true, manifest, entry, fw, nil)
	if err != nil || !res.WriteAttempted {
		t.Fatalf("flashFirmware = (%+v, %v)", res, err)
	}
	// GET_BOOT_VERSION, CHECK_FW, ERASE_FLASH, three WRITE_DATA chunks, and VERIFY.
	if want := []int{2000, 2000, 5000, 2000, 2000, 2000, 2000}; fmt.Sprint(timeouts) != fmt.Sprint(want) {
		t.Fatalf("reply timeouts = %v ms, want %v ms", timeouts, want)
	}
	write := func(addr, size byte, chunk []byte) Packet {
		pkt := Packet{0x02, 0x02, size, addr}
		copy(pkt[7:], chunk)
		SignPacketV1(&pkt)
		return pkt
	}
	want := []Packet{
		signedBootPacket(0x02, 0x00, 0x00),
		signedBootPacket(0x02, 0x01, 0x00),
		signedBootPacket(0x02, 0x04, 0x04, 80),
		write(0x00, 0x24, fw[0:32]),
		write(0x20, 0x24, fw[32:64]),
		write(0x40, 0x14, fw[64:80]),
		signedBootPacket(0x02, 0x05, 0x04, 64),
		signedBootPacket(0x02, 0x03, 0x00),
	}
	if len(sent) != len(want) {
		t.Fatalf("sent %d packets, want %d", len(sent), len(want))
	}
	for i := range want {
		if sent[i] != want[i] {
			t.Fatalf("packet %d = %x, want %x", i, sent[i][:40], want[i][:40])
		}
	}
}

func newBootloaderWaitFixture(t *testing.T) (string, DiscoveredCandidate, probeOps, *fakeHidraw) {
	t.Helper()
	root := t.TempDir()
	writeApplicationSysfs(t, root, 35)
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 || candidates[0].DeviceNumber != 35 {
		t.Fatalf("discover application: %+v, %v", candidates, err)
	}
	ops := systemProbeOps()
	fake := stubHidrawNodes(&ops)
	ops.writeHidraw = func(fd int, data []byte) (int, error) {
		if fd != 105 || data[0] != 0x02 || data[1] != 0x00 {
			t.Fatalf("unexpected write on fd %d during wait: %x", fd, data[:8])
		}
		return 64, nil
	}
	ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
		reply := syntheticBootVersionReply()
		copy(data, reply[:])
		return 64, nil
	}
	return root, candidates[0], ops, fake
}

func TestWaitForAuthenticBootloader(t *testing.T) {
	manifest, _ := liveDir12Manifest(t)

	t.Run("slow-enumeration-within-deadline", func(t *testing.T) {
		root, prev, ops, _ := newBootloaderWaitFixture(t)
		removed, added := false, false
		elapsed := fakeBootClock(&ops, 0, func(e time.Duration) {
			if e >= 2*time.Second && !removed {
				removed = true
				if err := os.RemoveAll(filepath.Join(root, "7-1.4.3.4")); err != nil {
					t.Fatal(err)
				}
			}
			if e >= 12*time.Second && !added {
				added = true
				writeAuthenticBootloaderSysfs(t, root)
			}
		})
		var result ApplyResult
		fd, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result)
		if err != nil || fd != 105 || elapsed() != 12*time.Second {
			t.Fatalf("wait = (%d, %v) after %s, want fd 105 after 12s", fd, err, elapsed())
		}
	})

	t.Run("timeout-reports-last-rejection", func(t *testing.T) {
		root, prev, ops, fake := newBootloaderWaitFixture(t)
		elapsed := fakeBootClock(&ops, 0, func(e time.Duration) {
			if e == time.Second {
				writeAuthenticBootloaderSysfs(t, root)
			}
		})
		ops.readHidraw = func(int, []byte, int) (int, error) { return 0, unix.ETIMEDOUT }
		var result ApplyResult
		_, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result)
		for _, want := range []string{
			"timed out waiting for SayoDevice bootloader at USB path 7-1.4.3.4 after 30s",
			`last seen: 8089:000c "Bootloader" devnum 36`,
			"rejected at GET_BOOT_VERSION",
		} {
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("err = %v, want %q", err, want)
			}
		}
		if !errors.Is(err, unix.ETIMEDOUT) || elapsed() != 30*time.Second || len(fake.opened) != len(fake.closed) {
			t.Fatalf("err=%v elapsed=%s opened=%d closed=%d", err, elapsed(), len(fake.opened), len(fake.closed))
		}
	})

	t.Run("etimedout-handshake-is-retried", func(t *testing.T) {
		root, prev, ops, fake := newBootloaderWaitFixture(t)
		fakeBootClock(&ops, 0, func(e time.Duration) {
			if e == time.Second {
				writeAuthenticBootloaderSysfs(t, root)
			}
		})
		reads := 0
		ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
			reads++
			if reads == 1 {
				return 0, unix.ETIMEDOUT
			}
			reply := syntheticBootVersionReply()
			copy(data, reply[:])
			return 64, nil
		}
		var result ApplyResult
		fd, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result)
		if err != nil || fd != 105 || reads != 2 || len(fake.opened) != 2 || len(fake.closed) != 1 {
			t.Fatalf("wait = (%d, %v), reads=%d opened=%v closed=%v", fd, err, reads, fake.opened, fake.closed)
		}
	})

	t.Run("wrong-handshake-reply-is-terminal", func(t *testing.T) {
		root, prev, ops, fake := newBootloaderWaitFixture(t)
		elapsed := fakeBootClock(&ops, 0, func(e time.Duration) {
			if e == time.Second {
				writeAuthenticBootloaderSysfs(t, root)
			}
		})
		writes := 0
		ops.writeHidraw = func(int, []byte) (int, error) {
			writes++
			return 64, nil
		}
		ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
			reply := Packet{0x02, 0x00, 0x04, 0x08, 0xa6, 0x00, 0x06, 0x00, 0x5a}
			copy(data, reply[:])
			return 64, nil
		}
		var result ApplyResult
		_, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result)
		for _, want := range []string{
			`SayoDevice at USB path 7-1.4.3.4 (8089:000c "Bootloader" devnum 36) failed the bootloader handshake`,
			"device is not in bootloader mode (GET_BOOT_VERSION reply 02 00 04 08 a6 00 06 00)",
		} {
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("err = %v, want %q", err, want)
			}
		}
		if writes != 1 || elapsed() != time.Second || len(fake.opened) != 1 || len(fake.closed) != 1 {
			t.Fatalf("writes=%d elapsed=%s opened=%v closed=%v, want one handshake and an immediate stop", writes, elapsed(), fake.opened, fake.closed)
		}
	})

	t.Run("eacces-on-new-node-is-reported", func(t *testing.T) {
		root, prev, ops, fake := newBootloaderWaitFixture(t)
		fakeBootClock(&ops, 0, func(e time.Duration) {
			if e == time.Second {
				writeAuthenticBootloaderSysfs(t, root)
			}
		})
		fake.openErr = func(string) error { return unix.EACCES }
		var result ApplyResult
		_, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result)
		if !errors.Is(err, unix.EACCES) {
			t.Fatalf("err = %v, want EACCES", err)
		}
		for _, want := range []string{"rejected at hidraw: open /dev/hidraw5: permission denied", "udev rule"} {
			if !strings.Contains(err.Error(), want) {
				t.Fatalf("err = %v, want %q", err, want)
			}
		}
	})

	t.Run("transient-eacces-then-success", func(t *testing.T) {
		root, prev, ops, fake := newBootloaderWaitFixture(t)
		fakeBootClock(&ops, 0, func(e time.Duration) {
			if e == time.Second {
				writeAuthenticBootloaderSysfs(t, root)
			}
		})
		denied := 0
		fake.openErr = func(string) error {
			if denied < 3 {
				denied++
				return unix.EACCES
			}
			return nil
		}
		var result ApplyResult
		if fd, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result); err != nil || fd != 105 {
			t.Fatalf("wait = (%d, %v)", fd, err)
		}
	})

	t.Run("returned-to-application-mode-stops-early", func(t *testing.T) {
		root, prev, ops, _ := newBootloaderWaitFixture(t)
		elapsed := fakeBootClock(&ops, 0, func(e time.Duration) {
			switch e {
			case 500 * time.Millisecond:
				if err := os.RemoveAll(filepath.Join(root, "7-1.4.3.4")); err != nil {
					t.Fatal(err)
				}
			case time.Second:
				writeApplicationSysfs(t, root, 37)
			}
		})
		ops.writeHidraw = func(int, []byte) (int, error) {
			t.Fatal("wrote to a device in application mode")
			return 0, nil
		}
		var result ApplyResult
		_, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result)
		if err == nil || !strings.Contains(err.Error(), "returned to application mode") || !strings.Contains(err.Error(), "devnum 37") || elapsed() != time.Second {
			t.Fatalf("err = %v after %s, want early application-mode error", err, elapsed())
		}
	})

	t.Run("never-left-application-mode", func(t *testing.T) {
		root, prev, ops, fake := newBootloaderWaitFixture(t)
		fakeBootClock(&ops, time.Second, nil)
		var result ApplyResult
		_, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result)
		if err == nil || !strings.Contains(err.Error(), "rejected at report descriptor: device has not left application mode") || len(fake.opened) != 0 {
			t.Fatalf("err = %v, opened %v", err, fake.opened)
		}
	})

	t.Run("unrelated-broken-device-does-not-abort", func(t *testing.T) {
		root, prev, ops, _ := newBootloaderWaitFixture(t)
		broken := filepath.Join(root, "7-1.4.3.1")
		if err := os.MkdirAll(broken, 0o700); err != nil {
			t.Fatal(err)
		}
		writeSysfsFiles(t, broken, map[string][]byte{"descriptors": []byte(candidateSayo000CUSBDescriptor)})
		if _, err := DiscoverCandidates(root); err == nil {
			t.Fatal("discover over all devices should fail on the half-populated device")
		}
		fakeBootClock(&ops, 0, func(e time.Duration) {
			if e == time.Second {
				writeAuthenticBootloaderSysfs(t, root)
			}
		})
		var result ApplyResult
		if fd, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", prev, manifest, &result); err != nil || fd != 105 {
			t.Fatalf("wait = (%d, %v)", fd, err)
		}
	})
}

func TestFlashFirmwareApplicationToAuthenticBootloader(t *testing.T) {
	root, prev, ops, fake := newBootloaderWaitFixture(t)
	manifest, entry := liveDir12Manifest(t)
	fakeBootClock(&ops, 0, nil)
	fw := make([]byte, 64)
	for i := range fw {
		fw[i] = byte(0x80 + i)
	}
	var written []byte
	var pending []Packet
	execSeen := false
	ops.writeHidraw = func(fd int, data []byte) (int, error) {
		var pkt Packet
		copy(pkt[:], data)
		if pkt[0] == 0x21 {
			if fd != 117 || pkt != BootloaderEntryPacketV2() {
				t.Fatalf("unexpected v2 packet on fd %d: %x", fd, pkt[:16])
			}
			writeAuthenticBootloaderSysfs(t, root)
			return 0, unix.EPROTO
		}
		if fd != 105 {
			t.Fatalf("bootloader write on fd %d, want 105", fd)
		}
		switch pkt[1] {
		case 0x00:
			pending = append(pending, syntheticBootVersionReply())
		case 0x01:
			pending = append(pending, syntheticCheckFWReply(entry.ModelCode, 2214))
		case 0x04:
			pending = append(pending, Packet{0x02, 0x00})
		case 0x02:
			written = append(written, pkt[7:7+int(pkt[2])-4]...)
			pending = append(pending, Packet{0x02, 0x00})
		case 0x05:
			pending = append(pending, Packet{0x02, 0x01})
		case 0x03:
			execSeen = true
			return 0, unix.EPROTO
		default:
			t.Fatalf("unexpected bootloader cmd %#02x", pkt[1])
		}
		return 64, nil
	}
	ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
		copy(data, pending[0][:])
		pending = pending[1:]
		return 64, nil
	}
	res, err := ops.flashFirmware(root, "/dev/bus/usb", prev, ProtocolV2, false, manifest, entry, fw, nil)
	if err != nil || !res.WriteAttempted || !execSeen || !bytes.Equal(written, fw) {
		t.Fatalf("flashFirmware = (%+v, %v), exec=%v written=%d", res, err, execSeen, len(written))
	}
	if len(fake.opened) != 2 || fake.opened[0] != "/dev/hidraw17" || fake.opened[1] != "/dev/hidraw5" {
		t.Fatalf("opened = %v, want [/dev/hidraw17 /dev/hidraw5]", fake.opened)
	}
}

func newApplicationWaitFixture(t *testing.T) (string, DiscoveredCandidate, probeOps) {
	t.Helper()
	root := t.TempDir()
	writeAuthenticBootloaderSysfs(t, root)
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 || candidates[0].DeviceNumber != 36 {
		t.Fatalf("discover bootloader: %+v, %v", candidates, err)
	}
	ops := systemProbeOps()
	stubHidrawNodes(&ops)
	ops.open = func(path string, _ int, _ uint32) (int, error) {
		t.Fatalf("restart wait opened %s", path)
		return -1, nil
	}
	ops.writeHidraw = func(int, []byte) (int, error) {
		t.Fatal("restart wait wrote to the device")
		return 0, nil
	}
	return root, candidates[0], ops
}

func TestWaitForApplicationAfterExecuteApp(t *testing.T) {
	t.Run("bootloader-then-application", func(t *testing.T) {
		root, prev, ops := newApplicationWaitFixture(t)
		elapsed := fakeBootClock(&ops, 0, func(e time.Duration) {
			switch e {
			case 2 * time.Second:
				if err := os.RemoveAll(filepath.Join(root, "7-1.4.3.4")); err != nil {
					t.Fatal(err)
				}
			case 2300 * time.Millisecond:
				writeApplicationSysfs(t, root, 37)
			}
		})
		got := ops.waitForApplication(root, "/dev/bus/usb", prev)
		if !got.Restarted || got.Elapsed != 2300*time.Millisecond || got.Candidate.DeviceNumber != 37 || got.Candidate.ProductName != "SayoDevice 2x3P" {
			t.Fatalf("wait = %+v", got)
		}
		if elapsed() != got.Elapsed+applicationSettle {
			t.Fatalf("elapsed %s, want restart time plus %s settle", elapsed(), applicationSettle)
		}
	})

	t.Run("deadline-with-device-still-in-bootloader", func(t *testing.T) {
		root, prev, ops := newApplicationWaitFixture(t)
		fakeBootClock(&ops, 0, nil)
		got := ops.waitForApplication(root, "/dev/bus/usb", prev)
		if got.Restarted || got.Elapsed != applicationWait || got.LastSeen != `bootloader mode (8089:000c "Bootloader" devnum 36)` {
			t.Fatalf("wait = %+v", got)
		}
	})

	t.Run("deadline-with-device-absent", func(t *testing.T) {
		root, prev, ops := newApplicationWaitFixture(t)
		if err := os.RemoveAll(filepath.Join(root, "7-1.4.3.4")); err != nil {
			t.Fatal(err)
		}
		fakeBootClock(&ops, 0, nil)
		got := ops.waitForApplication(root, "/dev/bus/usb", prev)
		if got.Restarted || got.Elapsed != applicationWait || got.LastSeen != "no device" {
			t.Fatalf("wait = %+v", got)
		}
	})

	t.Run("unchanged-application-is-not-a-restart", func(t *testing.T) {
		root := t.TempDir()
		writeApplicationSysfs(t, root, 35)
		candidates, err := DiscoverCandidates(root)
		if err != nil || len(candidates) != 1 || candidates[0].Bootloader {
			t.Fatalf("discover application: %+v, %v", candidates, err)
		}
		_, _, ops := newApplicationWaitFixture(t)
		fakeBootClock(&ops, 0, nil)
		got := ops.waitForApplication(root, "/dev/bus/usb", candidates[0])
		if got.Restarted || got.Elapsed != applicationWait || !strings.HasPrefix(got.LastSeen, "unchanged device (") {
			t.Fatalf("wait = %+v", got)
		}
	})

	t.Run("bootloader-product-string-is-not-an-application", func(t *testing.T) {
		root, prev, ops := newApplicationWaitFixture(t)
		writeApplicationSysfs(t, root, 37)
		writeSysfsFiles(t, filepath.Join(root, "7-1.4.3.4"), map[string][]byte{"product": []byte("Bootloader\n")})
		fakeBootClock(&ops, 0, nil)
		got := ops.waitForApplication(root, "/dev/bus/usb", prev)
		if got.Restarted || got.LastSeen != `bootloader mode (8089:000c "Bootloader" devnum 37)` {
			t.Fatalf("wait = %+v", got)
		}
	})

	t.Run("node-without-access-waits-for-udev", func(t *testing.T) {
		root, prev, ops := newApplicationWaitFixture(t)
		writeApplicationSysfs(t, root, 37)
		denied := 0
		ops.access = func(path string, mode uint32) error {
			if path != "/dev/hidraw17" || mode != unix.R_OK|unix.W_OK {
				t.Fatalf("access(%s, %#o)", path, mode)
			}
			if denied < 5 {
				denied++
				return unix.EACCES
			}
			return nil
		}
		elapsed := fakeBootClock(&ops, 0, nil)
		got := ops.waitForApplication(root, "/dev/bus/usb", prev)
		if !got.Restarted || denied != 5 || got.Elapsed != 600*time.Millisecond || elapsed() != got.Elapsed+applicationSettle {
			t.Fatalf("wait = %+v, denied %d, elapsed %s", got, denied, elapsed())
		}
	})

	t.Run("node-without-access-until-deadline", func(t *testing.T) {
		root, prev, ops := newApplicationWaitFixture(t)
		writeApplicationSysfs(t, root, 37)
		ops.access = func(string, uint32) error { return unix.EACCES }
		fakeBootClock(&ops, 0, nil)
		got := ops.waitForApplication(root, "/dev/bus/usb", prev)
		if got.Restarted || got.Elapsed != applicationWait || !strings.Contains(got.LastSeen, "not ready (access /dev/hidraw17: permission denied)") {
			t.Fatalf("wait = %+v", got)
		}
	})

	t.Run("application-hidraw-node-not-ready", func(t *testing.T) {
		root, prev, ops := newApplicationWaitFixture(t)
		writeApplicationSysfs(t, root, 37)
		ops.lstat = func(string, *unix.Stat_t) error { return unix.ENOENT }
		fakeBootClock(&ops, 0, nil)
		got := ops.waitForApplication(root, "/dev/bus/usb", prev)
		if got.Restarted || !strings.Contains(got.LastSeen, `8089:000c "SayoDevice 2x3P" devnum 37, not ready`) {
			t.Fatalf("wait = %+v", got)
		}
	})
}

func TestIsDeviceRestartErr(t *testing.T) {
	for _, errno := range []unix.Errno{unix.EPROTO, unix.ENODEV, unix.EIO, unix.ESHUTDOWN, unix.ENOENT} {
		if !IsDeviceRestartErr(fmt.Errorf("write 0x00 info query: %w", errno)) {
			t.Fatalf("%v is not a restart error", errno)
		}
	}
	for _, err := range []error{unix.EACCES, unix.ETIMEDOUT, errors.New("invalid 0x00 info reply")} {
		if IsDeviceRestartErr(err) {
			t.Fatalf("%v is a restart error", err)
		}
	}
}

func TestQueryFirmwareVersionAfterRestart(t *testing.T) {
	v2Info := func(modelCode, version uint16) Packet {
		reply := Packet{0x21, 0x12, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00}
		binary.LittleEndian.PutUint16(reply[8:10], modelCode)
		binary.LittleEndian.PutUint16(reply[10:12], version)
		SignPacketV2(&reply)
		return reply
	}
	application := func(t *testing.T, descriptor string) (string, DiscoveredCandidate, probeOps, *fakeHidraw, *[]Packet) {
		t.Helper()
		root := t.TempDir()
		writeApplicationSysfs(t, root, 37)
		hid := filepath.Join(root, "7-1.4.3.4", "7-1.4.3.4:1.1", "0003:8089:000C.0030")
		writeSysfsFiles(t, hid, map[string][]byte{"report_descriptor": []byte(descriptor)})
		candidates, err := DiscoverCandidates(root)
		if err != nil || len(candidates) != 1 {
			t.Fatalf("discover application: %+v, %v", candidates, err)
		}
		ops := systemProbeOps()
		fake := stubHidrawNodes(&ops)
		var sent []Packet
		ops.writeHidraw = func(fd int, data []byte) (int, error) {
			var pkt Packet
			copy(pkt[:], data)
			if fd != 117 {
				t.Fatalf("write on fd %d, want 117", fd)
			}
			sent = append(sent, pkt)
			return 64, nil
		}
		return root, candidates[0], ops, fake, &sent
	}
	reply := func(ops *probeOps, rx Packet, err error) {
		ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
			if err != nil {
				return 0, err
			}
			copy(data, rx[:])
			return 64, nil
		}
	}

	t.Run("v2-info-only", func(t *testing.T) {
		root, c, ops, fake, sent := application(t, candidateSayoReportDescriptor)
		reply(&ops, v2Info(6, 2214), nil)
		info, err := ops.queryFirmwareVersion(root, "/dev/bus/usb", c)
		if err != nil || info != (FirmwareInfo{ModelCode: 6, FirmwareVersion: 2214}) {
			t.Fatalf("query = (%+v, %v)", info, err)
		}
		if len(*sent) != 1 || (*sent)[0] != QueryInfoPacketV2() || len(fake.opened) != 1 || len(fake.closed) != 1 {
			t.Fatalf("sent %d packets, opened %v, closed %v, want one Info query", len(*sent), fake.opened, fake.closed)
		}
	})

	t.Run("v2-info-failure-is-an-error", func(t *testing.T) {
		root, c, ops, fake, sent := application(t, candidateSayoReportDescriptor)
		reply(&ops, Packet{}, unix.ETIMEDOUT)
		_, err := ops.queryFirmwareVersion(root, "/dev/bus/usb", c)
		if !errors.Is(err, unix.ETIMEDOUT) || len(*sent) != 1 || len(fake.closed) != 1 {
			t.Fatalf("err = %v, sent %d, closed %v", err, len(*sent), fake.closed)
		}
	})

	t.Run("v1-info-only", func(t *testing.T) {
		root, c, ops, _, sent := application(t, candidateSayoV1OnlyReportDescriptor)
		reply(&ops, Packet{0x02, 0x00, 0x04, 0x08, 0xa6, 0x00, 0x06}, nil)
		info, err := ops.queryFirmwareVersion(root, "/dev/bus/usb", c)
		if err != nil || info != (FirmwareInfo{ModelCode: 6, FirmwareVersion: 2214}) || len(*sent) != 1 || (*sent)[0] != QueryInfoPacketV1() {
			t.Fatalf("query = (%+v, %v), sent %d", info, err, len(*sent))
		}
	})

	t.Run("v1-bootloader-reply-sends-no-check-fw", func(t *testing.T) {
		root, c, ops, _, sent := application(t, candidateSayoV1OnlyReportDescriptor)
		reply(&ops, syntheticBootVersionReply(), nil)
		info, err := ops.queryFirmwareVersion(root, "/dev/bus/usb", c)
		if err != nil || !info.Bootloader || len(*sent) != 1 {
			t.Fatalf("query = (%+v, %v), sent %d, want bootloader after one Info query", info, err, len(*sent))
		}
	})

	t.Run("authentic-bootloader-is-not-opened", func(t *testing.T) {
		root := t.TempDir()
		writeAuthenticBootloaderSysfs(t, root)
		candidates, err := DiscoverCandidates(root)
		if err != nil || len(candidates) != 1 {
			t.Fatalf("discover bootloader: %+v, %v", candidates, err)
		}
		ops := systemProbeOps()
		fake := stubHidrawNodes(&ops)
		info, err := ops.queryFirmwareVersion(root, "/dev/bus/usb", candidates[0])
		if err != nil || !info.Bootloader || len(fake.opened) != 0 {
			t.Fatalf("query = (%+v, %v), opened %v", info, err, fake.opened)
		}
	})
}
