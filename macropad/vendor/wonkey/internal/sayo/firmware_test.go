package sayo

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestManifestPIDAndManifestHelpers(t *testing.T) {
	wantPIDs := map[uint16]int{
		0x0002: 2,
		0x0003: 3,
		0x0004: 4,
		0x0005: 5,
		0x0006: 2,
		0x0007: 3,
		0x0008: 4,
		0x0009: 9,
		0x000a: 10,
		0x000b: 11,
		0x000c: 12,
		0x000e: 14,
	}
	for pid, want := range wantPIDs {
		if got := ManifestPID(pid); got != want {
			t.Fatalf("ManifestPID(%#04x) = %d, want %d", pid, got, want)
		}
	}

	manifest, err := FetchFirmwareManifestFrom(FirmwareCDNBaseURL, 0x000c, func(url string, maxBytes int) ([]byte, error) {
		if url != "https://a.sayobot.cn/firmware/update/12/config.json" || maxBytes != 1<<20 {
			t.Fatalf("unexpected manifest fetch: url=%q maxBytes=%d", url, maxBytes)
		}
		return []byte(liveDir12ConfigJSON), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if manifest.PID2 != 12 || manifest.BootInfoAddr != 6080 || manifest.EncryptFlag != 0 || manifest.HIDErrForSize != 0 ||
		!manifest.UseChecksum() || manifest.VerifyCmd() != 0x05 {
		t.Fatalf("live directory 12 manifest decoded wrongly: %+v", manifest)
	}
	if omitted := (FirmwareManifest{}); !omitted.UseChecksum() || omitted.VerifyCmd() != 0x05 {
		t.Fatal("omitted hid_checksum should default to checksum=true and verify=0x05")
	}
	zero, one := 0, 1
	if m := (FirmwareManifest{HIDChecksum: &zero}); m.UseChecksum() || m.VerifyCmd() != 0x05 {
		t.Fatalf("hid_checksum=0 should give checksum=false and verify=0x05 (official VERIFY ?? 5)")
	}
	if m := (FirmwareManifest{HIDChecksum: &zero, Cmd: FirmwareManifestCmds{Verify: 0x06}}); m.VerifyCmd() != 0x06 {
		t.Fatalf("an explicit manifest VERIFY opcode should be used")
	}
	if m := (FirmwareManifest{HIDChecksum: &one}); !m.UseChecksum() || m.VerifyCmd() != 0x05 {
		t.Fatalf("hid_checksum=1 should give checksum=true and verify=0x05")
	}
	entry, ok := manifest.FindEntry(6)
	if !ok || entry.Model != "2X3_RGB_V2" || entry.Version != 2214 || entry.FilePath != "firmware/app_2X3_RGB_V2.bin" {
		t.Fatalf("FindEntry(6) = (%+v, %v)", entry, ok)
	}
	if _, ok := manifest.FindEntry(0x9999); ok {
		t.Fatal("unexpected match for unknown model_code")
	}

	fwBin := make([]byte, 80)
	gotBin, err := FetchFirmwareBinaryFrom(FirmwareCDNBaseURL, 0x000c, entry.FilePath, func(url string, maxBytes int) ([]byte, error) {
		if url != "https://a.sayobot.cn/firmware/update/12/firmware/app_2X3_RGB_V2.bin" || maxBytes != 4<<20 {
			t.Fatalf("unexpected binary fetch: url=%q maxBytes=%d", url, maxBytes)
		}
		return fwBin, nil
	})
	if err != nil || !bytes.Equal(gotBin, fwBin) {
		t.Fatalf("FetchFirmwareBinaryFrom: %v", err)
	}
	if url, err := FirmwareBinaryURL(FirmwareCDNBaseURL, 0x0006, "fw.bin"); err != nil || url != "https://a.sayobot.cn/firmware/update/2/fw.bin" {
		t.Fatalf("FirmwareBinaryURL(0x0006) = (%q, %v)", url, err)
	}
	for _, badPath := range []string{"", "../secret.bin", "/abs.bin", "https://evil.example/fw.bin", "a\\b.bin", "a?b.bin"} {
		if _, err := FirmwareBinaryURL(FirmwareCDNBaseURL, 0x000c, badPath); err == nil {
			t.Fatalf("accepted invalid firmware path %q", badPath)
		}
	}
	if err := ValidateFirmwareBinary(make([]byte, 80), entry, manifest); err != nil {
		t.Fatalf("ValidateFirmwareBinary(80): %v", err)
	}
	if err := ValidateFirmwareBinary(make([]byte, 49152), entry, manifest); err != nil {
		t.Fatalf("ValidateFirmwareBinary(49152): %v", err)
	}
	romEntry := FirmwareManifestEntry{ROMSize: 61280}
	for _, badLen := range []int{0, 16, 48, 63, 65, 95, 61280 + 48} {
		if err := ValidateFirmwareBinary(make([]byte, badLen), romEntry, manifest); err == nil {
			t.Fatalf("accepted invalid firmware binary length %d", badLen)
		}
	}
	largeEntry := FirmwareManifestEntry{ROMSize: 131072}
	if err := ValidateFirmwareBinary(make([]byte, 0x10010), largeEntry, FirmwareManifest{AddrLen: 2}); err == nil {
		t.Fatal("accepted firmware binary > 0xFFFF with 16-bit AddrLen")
	}
	if err := ValidateFirmwareBinary(make([]byte, 0x10010), largeEntry, FirmwareManifest{AddrLen: 4}); err != nil {
		t.Fatalf("rejected firmware binary > 0xFFFF with 32-bit AddrLen: %v", err)
	}
	for _, badCmd := range []FirmwareManifestCmds{
		{GetBootVersion: 1},
		{CheckFW: 2},
		{WriteData: 1},
		{ExecuteApp: 4},
		{EraseFlash: 5},
	} {
		if err := ValidateFirmwareBinary(make([]byte, 80), entry, FirmwareManifest{Cmd: badCmd}); err == nil {
			t.Fatalf("accepted non-standard Cmd opcodes %+v", badCmd)
		}
	}
	badURLBytes, err := defaultHTTPGet("http://a.sayobot.cn/firmware/update/12/config.json", 1024)
	if err == nil || badURLBytes != nil {
		t.Fatal("accepted non-HTTPS URL in defaultHTTPGet")
	}
}

func TestBootloaderPacketsAndProbeBootloaderMode(t *testing.T) {
	qV2 := QueryInfoPacketV2()
	if qV2[0] != 0x21 || qV2[1] != 0x12 || qV2[4] != 0x04 || qV2[6] != 0x00 || qV2[7] != 0x00 {
		t.Fatalf("QueryInfoPacketV2 = %x", qV2[:12])
	}
	qV1 := QueryInfoPacketV1()
	if !bytes.Equal(qV1[:4], []byte{0x02, 0x00, 0x00, 0x02}) {
		t.Fatalf("QueryInfoPacketV1 = %x", qV1[:8])
	}
	bootV2 := BootloaderEntryPacketV2()
	if bootV2[0] != 0x21 || bootV2[4] != 0x08 || bootV2[6] != 0x0e || bootV2[8] != 0x96 || bootV2[9] != 0x72 || bootV2[10] != 0xff {
		t.Fatalf("BootloaderEntryPacketV2 = %x", bootV2[:16])
	}
	bootV1 := BootloaderEntryPacketV1()
	if !bytes.Equal(bootV1[:6], []byte{0x02, 0xff, 0x02, 0x72, 0x96, 0x0b}) {
		t.Fatalf("BootloaderEntryPacketV1 = %x", bootV1[:8])
	}

	// Synthetic HID v1 family bootloader (PID 0x0006, manifest directory 2). No capture of this layout
	// or of its replies exists. The authentic 2x3P bootloader is tested in bootloader_test.go.
	root := makeSayoSysfs(t, 0x0006, "hidraw6", []byte(candidateSayoV1OnlyReportDescriptor))
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 || candidates[0].PID != 0x0006 {
		t.Fatalf("discover bootloader PID 0x0006: %+v, %v", candidates, err)
	}
	candidate := candidates[0]
	ops := systemProbeOps()
	node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 4, Ino: 306, Rdev: unix.Mkdev(241, 9)}
	var pendingReplies []Packet
	ops.lstat = func(_ string, st *unix.Stat_t) error { *st = node; return nil }
	ops.open = func(string, int, uint32) (int, error) { return 77, nil }
	ops.fstat = func(_ int, st *unix.Stat_t) error { *st = node; return nil }
	ops.close = func(int) error { return nil }
	ops.writeHidraw = func(_ int, data []byte) (int, error) {
		switch data[1] {
		case 0x00:
			pendingReplies = append(pendingReplies, Packet{0x02, 0x02, 0x02, 0x01, 0x00})
		case 0x01:
			pendingReplies = append(pendingReplies, Packet{0x02, 0x00, 0x04, 0x01, 0x05, 0x19, 0x64})
		default:
			t.Fatalf("unexpected packet in bootloader probe: %x", data[:8])
		}
		return 64, nil
	}
	ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
		reply := pendingReplies[0]
		pendingReplies = pendingReplies[1:]
		copy(data, reply[:])
		return 64, nil
	}

	probed, err := ops.probe(root, "/dev/bus/usb", candidate)
	if err != nil || probed.Layout == nil || !probed.Layout.Bootloader || probed.Layout.ModelCode != 0x1964 || probed.Layout.FirmwareVersion != 0x0105 {
		t.Fatalf("bootloader probe = (%+v, %v), layout=%+v", probed, err, probed.Layout)
	}
}

func TestFlashFirmwareV2AndBootloaderRecovery(t *testing.T) {
	for _, tc := range []struct {
		name           string
		inBootloader   bool
		proto          ProtocolVersion
		addrLen        int
		be             int
		encryptFlag    int
		eraseFlash     int
		useChecksum    int
		errForSize     int
		wantBootWrites int
	}{
		// Synthetic manifest parameter combinations that exercise every packet option. The live
		// directory 12 values are tested in TestFlashFirmwareFromBootloaderWithLiveDir12Manifest.
		// The v2 case re-enumerates into the authentic 2x3P bootloader capture. The v1 case keeps a
		// synthetic v1 descriptor because no HID v1 family bootloader capture exists.
		{"v2-app-to-boot-le-4byte-enc-chk", false, ProtocolV2, 4, 0, 1, 1, 1, 0, 1},
		{"v1-app-to-boot-be-2byte-noenc-nochk", false, ProtocolV1, 2, 1, 0, 0, 0, 1, 2},
		// Synthetic direct recovery from the authentic bootloader sysfs tree with non-default framing.
		{"bootloader-recovery-direct-be-2byte-enc-nochk", true, ProtocolV1, 2, 1, 1, 1, 0, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			initDesc := []byte(candidateSayoReportDescriptor)
			if tc.proto == ProtocolV1 {
				initDesc = []byte(candidateSayoV1OnlyReportDescriptor)
			}
			root := makeSayoSysfs(t, 0x000c, "hidraw9", initDesc)
			if tc.inBootloader {
				writeAuthenticBootloaderSysfs(t, root)
			}
			candidates, err := DiscoverCandidates(root)
			if err != nil || len(candidates) != 1 {
				t.Fatalf("discover: %+v, %v", candidates, err)
			}
			candidate := candidates[0]
			ops := systemProbeOps()
			fakeBootClock(&ops, 200*time.Millisecond, nil)
			fake := stubHidrawNodes(&ops)

			fwBytes := make([]byte, 80)
			for i := range fwBytes {
				fwBytes[i] = byte(i + 1)
			}
			chk := tc.useChecksum
			manifest := FirmwareManifest{
				VID:             0x8089,
				PID:             12,
				PID2:            12,
				AddrLen:         tc.addrLen,
				AddrByteOrderBE: tc.be,
				EncryptFlag:     tc.encryptFlag,
				EraseFlash:      tc.eraseFlash,
				HIDChecksum:     &chk,
				HIDErrForSize:   tc.errForSize,
			}
			entry := FirmwareManifestEntry{Model: "2X3_RGB_V2", ModelCode: 6, Version: 2214, FilePath: "firmware/app_2X3_RGB_V2.bin"}

			var bootEntryCount int
			var writtenChunks []byte
			var eraseSeen, verifySeen, execSeen bool
			var pendingReplies []Packet

			okReply := func(status byte) Packet {
				var r Packet
				r[0] = 0x02
				if tc.errForSize != 0 {
					r[2] = status
				} else {
					r[1] = status
				}
				return r
			}

			ops.writeHidraw = func(_ int, data []byte) (int, error) {
				var pkt Packet
				copy(pkt[:], data)
				if pkt[0] == 0x21 {
					if pkt != BootloaderEntryPacketV2() {
						t.Fatalf("unexpected v2 packet during flash: %x", pkt[:16])
					}
					writeAuthenticBootloaderSysfs(t, root)
					bootEntryCount++
					return 64, nil
				}
				if pkt[0] != 0x02 {
					t.Fatalf("unexpected report ID %#02x", pkt[0])
				}
				if pkt[1] == 0xff {
					if pkt != BootloaderEntryPacketV1() {
						t.Fatalf("unexpected v1 bootloader entry packet: %x", pkt[:8])
					}
					bootEntryCount++
					return 64, nil
				}
				// Only WRITE_DATA follows hid_checksum. Every other bootloader packet is always signed.
				want := pkt
				if pkt[1] != 0x02 || tc.useChecksum != 0 {
					SignPacketV1(&want)
				} else {
					want[int(pkt[2])+3] = 0
				}
				if chkPos := int(pkt[2]) + 3; pkt[chkPos] != want[chkPos] {
					t.Fatalf("bootloader cmd %#02x checksum byte at %d: got %02x, want %02x", pkt[1], chkPos, pkt[chkPos], want[chkPos])
				}
				switch pkt[1] {
				case 0x00:
					pendingReplies = append(pendingReplies, Packet{0x02, 0x02, 0x02, 0x01, 0x00})
				case 0x01:
					r := okReply(0x01)
					binary.BigEndian.PutUint16(r[5:7], entry.ModelCode)
					pendingReplies = append(pendingReplies, r)
				case 0x04:
					eraseSeen = true
					var gotLen uint32
					if tc.be != 0 {
						gotLen = binary.BigEndian.Uint32(pkt[3:7])
					} else {
						gotLen = binary.LittleEndian.Uint32(pkt[3:7])
					}
					if int(gotLen) != len(fwBytes) {
						t.Fatalf("ERASE_FLASH length = %d, want %d", gotLen, len(fwBytes))
					}
					pendingReplies = append(pendingReplies, okReply(0x00))
				case 0x02:
					var gotAddr uint32
					switch {
					case tc.addrLen == 2 && tc.be != 0:
						gotAddr = uint32(binary.BigEndian.Uint16(pkt[3:5]))
					case tc.addrLen == 2:
						gotAddr = uint32(binary.LittleEndian.Uint16(pkt[3:5]))
					case tc.be != 0:
						gotAddr = binary.BigEndian.Uint32(pkt[3:7])
					default:
						gotAddr = binary.LittleEndian.Uint32(pkt[3:7])
					}
					if int(gotAddr) != len(writtenChunks) {
						t.Fatalf("WRITE_DATA address = %#x, want %#x", gotAddr, len(writtenChunks))
					}
					pos := 3 + tc.addrLen
					if tc.encryptFlag == 1 {
						if pkt[pos] != 0x01 {
							t.Fatalf("missing encrypt byte 0x01 at %d", pos)
						}
						pos++
					}
					chunkLen := int(pkt[2]) - (pos - 3)
					writtenChunks = append(writtenChunks, pkt[pos:pos+chunkLen]...)
					pendingReplies = append(pendingReplies, okReply(0x00))
				case 0x05, 0x06:
					verifySeen = true
					const wantVerifyCmd = byte(0x05) // the manifest omits VERIFY, so the official fallback applies
					if pkt[1] != wantVerifyCmd {
						t.Fatalf("VERIFY cmd = %#02x, want %#02x", pkt[1], wantVerifyCmd)
					}
					var gotVerifyLen uint32
					if tc.be != 0 {
						gotVerifyLen = binary.BigEndian.Uint32(pkt[3:7])
					} else {
						gotVerifyLen = binary.LittleEndian.Uint32(pkt[3:7])
					}
					if int(gotVerifyLen) != len(fwBytes)-16 {
						t.Fatalf("VERIFY length = %d, want %d", gotVerifyLen, len(fwBytes)-16)
					}
					pendingReplies = append(pendingReplies, okReply(0x01))
				case 0x03:
					execSeen = true
				default:
					return 0, fmt.Errorf("unexpected bootloader cmd %#02x", pkt[1])
				}
				return 64, nil
			}
			ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
				reply := pendingReplies[0]
				pendingReplies = pendingReplies[1:]
				copy(data, reply[:])
				return 64, nil
			}

			var progressSteps [][2]int
			res, err := ops.flashFirmware(root, "/dev/bus/usb", candidate, tc.proto, tc.inBootloader, manifest, entry, fwBytes, func(written, total int) {
				progressSteps = append(progressSteps, [2]int{written, total})
			})
			if err != nil {
				t.Fatalf("flashFirmware error: %v", err)
			}
			if !res.WriteAttempted || bootEntryCount != tc.wantBootWrites || eraseSeen != (tc.eraseFlash != 0) || !verifySeen || !execSeen || !bytes.Equal(writtenChunks, fwBytes) {
				t.Fatalf("flashFirmware result=%+v bootEntry=%d erase=%v verify=%v exec=%v written=%d", res, bootEntryCount, eraseSeen, verifySeen, execSeen, len(writtenChunks))
			}
			if tc.inBootloader && (len(fake.opened) != 1 || fake.opened[0] != "/dev/hidraw5") {
				t.Fatalf("opened = %v, want only the bootloader node /dev/hidraw5", fake.opened)
			}
			wantProgress := [][2]int{{0, 80}, {32, 80}, {64, 80}, {80, 80}}
			if len(progressSteps) != len(wantProgress) {
				t.Fatalf("progressSteps = %v, want %v", progressSteps, wantProgress)
			}
			for i, step := range wantProgress {
				if progressSteps[i] != step {
					t.Fatalf("progressSteps[%d] = %v, want %v", i, progressSteps[i], step)
				}
			}
		})
	}
}

func TestWaitForBootloaderHidrawRetriesAndMatchesPhysicalPath(t *testing.T) {
	// Synthetic in-place descriptor swap that exercises retries on one sysfs identity.
	root := makeSayoSysfs(t, 0x000c, "hidraw9", []byte(candidateSayoReportDescriptor))
	reportDescPath := filepath.Join(root, "7-1.4.3.4", "7-1.4.3.4:1.1", "0003:8089:000C.0002", "report_descriptor")

	otherDir := filepath.Join(root, "7-1.4.3.1")
	otherHidrawDir := filepath.Join(otherDir, "7-1.4.3.1:1.1", "0003:8089:0006.0001", "hidraw", "hidraw1")
	if err := os.MkdirAll(otherHidrawDir, 0o700); err != nil {
		t.Fatal(err)
	}
	otherUSBDesc := []byte(candidateSayo000CUSBDescriptor)
	binary.LittleEndian.PutUint16(otherUSBDesc[10:12], 0x0006)
	for name, data := range map[string][]byte{
		"descriptors": otherUSBDesc,
		"busnum":      []byte("7\n"),
		"devnum":      []byte("11\n"),
		"dev":         []byte("189:778\n"),
	} {
		if err := os.WriteFile(filepath.Join(otherDir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	otherHidDir := filepath.Dir(filepath.Dir(otherHidrawDir))
	if err := os.WriteFile(filepath.Join(otherHidDir, "report_descriptor"), []byte(candidateSayoV1OnlyReportDescriptor), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(otherHidrawDir, "dev"), []byte("241:1\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 2 {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	var target DiscoveredCandidate
	for _, c := range candidates {
		if c.PhysicalPath == "7-1.4.3.4" {
			target = c
		}
	}
	if target.PhysicalPath != "7-1.4.3.4" {
		t.Fatalf("missing target candidate 7-1.4.3.4 in %+v", candidates)
	}

	ops := systemProbeOps()
	node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 4, Ino: 310, Rdev: unix.Mkdev(241, 9)}
	var pollAttempt int
	var openedNodes []string
	var closedFDs []int

	fakeBootClock(&ops, 500*time.Millisecond, func(time.Duration) {
		pollAttempt++
		if pollAttempt == 2 {
			if err := os.WriteFile(reportDescPath, []byte(candidateSayoV1OnlyReportDescriptor), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	})
	ops.lstat = func(path string, st *unix.Stat_t) error {
		if path != "/dev/hidraw9" {
			t.Fatalf("unexpected lstat on %q (should ignore other physical paths)", path)
		}
		*st = node
		return nil
	}
	ops.open = func(path string, _ int, _ uint32) (int, error) {
		openedNodes = append(openedNodes, path)
		return 60 + pollAttempt, nil
	}
	ops.fstat = func(_ int, st *unix.Stat_t) error { *st = node; return nil }
	ops.close = func(fd int) error {
		closedFDs = append(closedFDs, fd)
		return nil
	}
	ops.writeHidraw = func(_ int, data []byte) (int, error) {
		if len(data) != 64 || data[0] != 0x02 || data[1] != 0x00 {
			t.Fatalf("unexpected packet during waitForBootloaderHidraw: %x", data[:8])
		}
		return 64, nil
	}
	ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
		switch pollAttempt {
		case 2:
			return 0, unix.ETIMEDOUT
		case 3:
			reply := Packet{0x02, 0x02, 0x02, 0x01, 0x00}
			copy(data, reply[:])
			return 64, nil
		default:
			t.Fatalf("unexpected readHidraw on pollAttempt %d", pollAttempt)
			return 0, nil
		}
	}

	var result ApplyResult
	fd, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", target, FirmwareManifest{PID2: 0x000c}, &result)
	if err != nil {
		t.Fatalf("waitForBootloaderHidraw error: %v", err)
	}
	if fd != 63 || pollAttempt != 3 {
		t.Fatalf("fd=%d pollAttempt=%d, want fd=63 pollAttempt=3", fd, pollAttempt)
	}
	for _, p := range openedNodes {
		if p != "/dev/hidraw9" {
			t.Fatalf("opened unexpected node %q", p)
		}
	}
	if len(closedFDs) != 1 || closedFDs[0] != 62 {
		t.Fatalf("closedFDs = %v, want [62] (the HID v2 descriptor on poll 1 is never opened)", closedFDs)
	}

	// Verify that a mismatched PID2 is rejected even on the matching physical path.
	fakeBootClock(&ops, 100*time.Millisecond, nil)
	if _, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", target, FirmwareManifest{PID2: 0x0006}, &result); err == nil ||
		!strings.Contains(err.Error(), "rejected at PID check: PID 0x000c differs from manifest pid2 0x0006") {
		t.Fatalf("err = %v, want PID2 mismatch reason", err)
	}

	// Verify that if the target physical path never enters bootloader mode, the other
	// bootloader device on 7-1.4.3.1 is still ignored and waitForBootloaderHidraw times out.
	if err := os.WriteFile(reportDescPath, []byte(candidateSayoReportDescriptor), 0o600); err != nil {
		t.Fatal(err)
	}
	fakeBootClock(&ops, 200*time.Millisecond, func(time.Duration) { pollAttempt++ })
	if _, err := ops.waitForBootloaderHidraw(root, "/dev/bus/usb", target, FirmwareManifest{PID2: 0x000c}, &result); err == nil {
		t.Fatal("expected timeout when target physical path stays in ProtocolV2 app mode")
	}
}

func TestFlashFirmwareHandlesUSBRebootWriteErrorsAndCheckFWStatus0004(t *testing.T) {
	root := makeSayoSysfs(t, 0x000c, "hidraw9", []byte(candidateSayoReportDescriptor))
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	candidate := candidates[0]
	ops := systemProbeOps()
	fakeBootClock(&ops, 200*time.Millisecond, nil)
	stubHidrawNodes(&ops)
	ops.close = func(fd int) error {
		if fd == 109 || fd == 105 {
			return unix.ENODEV
		}
		return nil
	}

	fwBytes := make([]byte, 64)
	for i := range fwBytes {
		fwBytes[i] = byte(i + 1)
	}
	// Synthetic hid_err_for_size 1 with encrypt_flag 1 exercises the CHECK_FW 00 04 status form.
	chk := 1
	manifest := FirmwareManifest{
		VID:           0x8089,
		PID:           12,
		PID2:          12,
		AddrLen:       4,
		EncryptFlag:   1,
		EraseFlash:    1,
		HIDChecksum:   &chk,
		HIDErrForSize: 1,
	}
	entry := FirmwareManifestEntry{Model: "2X3_RGB_V2", ModelCode: 6, Version: 2214, FilePath: "firmware/app_2X3_RGB_V2.bin"}

	var bootEntrySeen, execSeen bool
	var pendingReplies []Packet

	ops.writeHidraw = func(_ int, data []byte) (int, error) {
		var pkt Packet
		copy(pkt[:], data)
		if pkt[0] == 0x21 {
			if pkt != BootloaderEntryPacketV2() {
				t.Fatalf("unexpected v2 packet during flash: %x", pkt[:16])
			}
			writeAuthenticBootloaderSysfs(t, root)
			bootEntrySeen = true
			return 0, unix.EPROTO
		}
		switch pkt[1] {
		case 0x00:
			pendingReplies = append(pendingReplies, Packet{0x02, 0x02, 0x02, 0x01, 0x00})
		case 0x01:
			var r Packet
			r[0] = 0x02
			r[1] = 0x00
			r[2] = 0x04
			binary.BigEndian.PutUint16(r[5:7], entry.ModelCode)
			pendingReplies = append(pendingReplies, r)
		case 0x04, 0x02:
			pendingReplies = append(pendingReplies, Packet{0x02, 0x00, 0x00})
		case 0x05:
			pendingReplies = append(pendingReplies, Packet{0x02, 0x00, 0x01})
		case 0x03:
			execSeen = true
			return 0, unix.EPROTO
		default:
			return 0, fmt.Errorf("unexpected bootloader cmd %#02x", pkt[1])
		}
		return 64, nil
	}
	ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
		reply := pendingReplies[0]
		pendingReplies = pendingReplies[1:]
		copy(data, reply[:])
		return 64, nil
	}

	res, err := ops.flashFirmware(root, "/dev/bus/usb", candidate, ProtocolV2, false, manifest, entry, fwBytes, nil)
	if err != nil {
		t.Fatalf("flashFirmware error on EPROTO reboot writes: %v", err)
	}
	if !res.WriteAttempted || !bootEntrySeen || !execSeen {
		t.Fatalf("unexpected result=%+v bootEntrySeen=%v execSeen=%v", res, bootEntrySeen, execSeen)
	}
}

func TestEnterBootloaderV1RebootAndNonUSBErrors(t *testing.T) {
	root := makeSayoSysfs(t, 0x000c, "hidraw9", []byte(candidateSayoV1OnlyReportDescriptor))
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	candidate := candidates[0]
	node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 4, Ino: 310, Rdev: unix.Mkdev(241, 9)}

	for _, tc := range []struct {
		name       string
		errs       []error
		closeErr   error
		wantWrites int
		wantReport int
		wantErr    bool
	}{
		{
			name:       "packet1-enodev-stops-and-succeeds",
			errs:       []error{unix.ENODEV, nil},
			closeErr:   unix.ENODEV,
			wantWrites: 1,
			wantReport: 0,
			wantErr:    false,
		},
		{
			name:       "packet2-eproto-stops-and-succeeds",
			errs:       []error{nil, unix.EPROTO},
			closeErr:   unix.EPROTO,
			wantWrites: 2,
			wantReport: 1,
			wantErr:    false,
		},
		{
			name:       "non-usb-eacces-fails",
			errs:       []error{unix.EACCES},
			wantWrites: 1,
			wantReport: 0,
			wantErr:    true,
		},
		{
			name:       "non-usb-einval-on-packet2-fails",
			errs:       []error{nil, unix.EINVAL},
			wantWrites: 2,
			wantReport: 1,
			wantErr:    true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ops := systemProbeOps()
			ops.lstat = func(_ string, st *unix.Stat_t) error { *st = node; return nil }
			ops.open = func(string, int, uint32) (int, error) { return 88, nil }
			ops.fstat = func(_ int, st *unix.Stat_t) error { *st = node; return nil }
			ops.close = func(int) error { return tc.closeErr }

			var writes int
			ops.writeHidraw = func(_ int, data []byte) (int, error) {
				var pkt Packet
				copy(pkt[:], data)
				if pkt != BootloaderEntryPacketV1() {
					t.Fatalf("unexpected v1 bootloader entry packet: %x", pkt[:8])
				}
				wErr := tc.errs[writes]
				writes++
				if wErr != nil {
					return 0, wErr
				}
				return 64, nil
			}

			var res ApplyResult
			err := ops.enterBootloader(root, "/dev/bus/usb", candidate, ProtocolV1, &res)
			if (err != nil) != tc.wantErr {
				t.Fatalf("enterBootloader err = %v, wantErr = %v", err, tc.wantErr)
			}
			if writes != tc.wantWrites || res.ReportsWritten != tc.wantReport {
				t.Fatalf("writes=%d reportsWritten=%d, want writes=%d reportsWritten=%d", writes, res.ReportsWritten, tc.wantWrites, tc.wantReport)
			}
		})
	}
}

func TestFlashFirmwareMidStepFailures(t *testing.T) {
	fwBytes := make([]byte, 64)
	for i := range fwBytes {
		fwBytes[i] = byte(i + 1)
	}
	manifest, entry := liveDir12Manifest(t)

	t.Run("wait-for-bootloader-timeout-after-eproto", func(t *testing.T) {
		root := makeSayoSysfs(t, 0x000c, "hidraw9", []byte(candidateSayoReportDescriptor))
		candidates, err := DiscoverCandidates(root)
		if err != nil || len(candidates) != 1 {
			t.Fatalf("discover: %+v, %v", candidates, err)
		}
		ops := systemProbeOps()
		fakeBootClock(&ops, 200*time.Millisecond, nil)
		ops.flock = func(int, int) error { return nil }
		node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 4, Ino: 310, Rdev: unix.Mkdev(241, 9)}
		ops.lstat = func(_ string, st *unix.Stat_t) error { *st = node; return nil }
		ops.open = func(string, int, uint32) (int, error) { return 77, nil }
		ops.fstat = func(_ int, st *unix.Stat_t) error { *st = node; return nil }
		ops.close = func(int) error { return nil }
		ops.writeHidraw = func(_ int, data []byte) (int, error) {
			if data[0] == 0x21 {
				return 0, unix.EPROTO
			}
			t.Fatalf("unexpected bootloader write before re-enumeration: %x", data[:8])
			return 0, nil
		}

		res, err := ops.flashFirmware(root, "/dev/bus/usb", candidates[0], ProtocolV2, false, manifest, entry, fwBytes, nil)
		if err == nil || !strings.Contains(err.Error(), "timed out waiting for SayoDevice bootloader at USB path 7-1.4.3.4 after 200ms") ||
			!strings.Contains(err.Error(), "device has not left application mode") {
			t.Fatalf("err = %v, want bootloader timeout with the last rejection", err)
		}
		if !res.WriteAttempted {
			t.Fatalf("expected WriteAttempted=true after 0x0E EPROTO, got %+v", res)
		}
	})

	for _, tc := range []struct {
		name          string
		failStep      string
		wantSubstring string
		forbidCmd     byte
	}{
		// Each failing reply carries 0xa7 at byte 7 and 0xa8 at byte 8, so the error must show exactly 8 bytes.
		{
			name:          "get-boot-version-wrong-reply",
			failStep:      "get-boot-version",
			wantSubstring: "device is not in bootloader mode (GET_BOOT_VERSION reply 02 00 04 08 a6 00 06 a7)",
			forbidCmd:     0x01,
		},
		{
			name:          "check-fw-wrong-report-id",
			failStep:      "check-fw-report-id",
			wantSubstring: "invalid CHECK_FW reply (64 bytes, reply 21 01 00 00 00 00 06 a7)",
			forbidCmd:     0x04,
		},
		{
			name:          "check-fw-model-code-mismatch",
			failStep:      "check-fw-model",
			wantSubstring: "bootloader model_code 0x0099 does not match expected 0x0006 (reply 02 01 00 00 00 00 99 a7)",
			forbidCmd:     0x04,
		},
		{
			name:          "check-fw-error-status",
			failStep:      "check-fw-status",
			wantSubstring: "invalid bootloader CHECK_FW reply (reply 02 02 00 00 00 00 06 a7)",
			forbidCmd:     0x04,
		},
		{
			name:          "erase-flash-error-status",
			failStep:      "erase-flash",
			wantSubstring: "bootloader ERASE_FLASH failed (reply 02 02 00 00 00 00 00 a7)",
			forbidCmd:     0x02,
		},
		{
			name:          "write-data-chunk2-error-status",
			failStep:      "write-data-chunk2",
			wantSubstring: "bootloader WRITE_DATA failed at offset 0x20 (reply 02 02 00 00 00 00 00 a7)",
			forbidCmd:     0x05,
		},
		{
			name:          "verify-error-status",
			failStep:      "verify",
			wantSubstring: "bootloader VERIFY failed (reply 02 02 00 00 00 00 00 a7)",
			forbidCmd:     0x03,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			writeAuthenticBootloaderSysfs(t, root)
			candidates, err := DiscoverCandidates(root)
			if err != nil || len(candidates) != 1 {
				t.Fatalf("discover: %+v, %v", candidates, err)
			}
			ops := systemProbeOps()
			stubHidrawNodes(&ops)

			var writeChunks int
			var pendingReplies []Packet
			failing := func(r Packet) Packet {
				r[7], r[8] = 0xa7, 0xa8
				return r
			}

			ops.writeHidraw = func(_ int, data []byte) (int, error) {
				cmd := data[1]
				if cmd == tc.forbidCmd {
					t.Fatalf("command %#02x should not be sent after %s failure", cmd, tc.failStep)
				}
				switch cmd {
				case 0x00:
					if tc.failStep == "get-boot-version" {
						pendingReplies = append(pendingReplies, failing(Packet{0x02, 0x00, 0x04, 0x08, 0xa6, 0x00, 0x06}))
						break
					}
					pendingReplies = append(pendingReplies, Packet{0x02, 0x02, 0x02, 0x01, 0x00})
				case 0x01:
					var r Packet
					r[0] = 0x02
					switch tc.failStep {
					case "check-fw-report-id":
						r[0], r[1] = 0x21, 0x01
						binary.BigEndian.PutUint16(r[5:7], entry.ModelCode)
						r = failing(r)
					case "check-fw-model":
						r[1] = 0x01
						binary.BigEndian.PutUint16(r[5:7], 0x0099)
						r = failing(r)
					case "check-fw-status":
						r[1] = 0x02
						binary.BigEndian.PutUint16(r[5:7], entry.ModelCode)
						r = failing(r)
					default:
						r[1] = 0x01
						binary.BigEndian.PutUint16(r[5:7], entry.ModelCode)
					}
					pendingReplies = append(pendingReplies, r)
				case 0x04:
					reply := Packet{0x02, 0x00}
					if tc.failStep == "erase-flash" {
						reply = failing(Packet{0x02, 0x02})
					}
					pendingReplies = append(pendingReplies, reply)
				case 0x02:
					writeChunks++
					reply := Packet{0x02, 0x00}
					if tc.failStep == "write-data-chunk2" && writeChunks == 2 {
						reply = failing(Packet{0x02, 0x02})
					}
					pendingReplies = append(pendingReplies, reply)
				case 0x05:
					reply := Packet{0x02, 0x01}
					if tc.failStep == "verify" {
						reply = failing(Packet{0x02, 0x02})
					}
					pendingReplies = append(pendingReplies, reply)
				default:
					t.Fatalf("unexpected bootloader cmd %#02x", cmd)
				}
				return 64, nil
			}
			ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
				reply := pendingReplies[0]
				pendingReplies = pendingReplies[1:]
				copy(data, reply[:])
				return 64, nil
			}

			res, err := ops.flashFirmware(root, "/dev/bus/usb", candidates[0], ProtocolV1, true, manifest, entry, fwBytes, nil)
			if err == nil || !strings.Contains(err.Error(), tc.wantSubstring) {
				t.Fatalf("err = %v, want substring %q", err, tc.wantSubstring)
			}
			if !res.WriteAttempted {
				t.Fatalf("expected WriteAttempted=true, got %+v", res)
			}
		})
	}
}

func TestDecodePID12ManifestWithoutROMSize(t *testing.T) {
	manifest, entry := liveDir12Manifest(t)
	if entry.Model != "2X3_RGB_V2" || entry.ROMSize != 0 || entry.Version != 2214 || entry.FilePath != "firmware/app_2X3_RGB_V2.bin" {
		t.Fatalf("FindEntry(6) = %+v", entry)
	}
	if manifest.VerifyCmd() != 0x05 {
		t.Fatalf("VerifyCmd() = %#02x, want 0x05", manifest.VerifyCmd())
	}
	if err := ValidateFirmwareBinary(make([]byte, 49152), entry, manifest); err != nil {
		t.Fatalf("ValidateFirmwareBinary(49152) failed: %v", err)
	}
}

func TestSayoHidrawFlockRefusesConcurrentAccess(t *testing.T) {
	root := makeSayoSysfs(t, 0x000c, "hidraw9", []byte(candidateSayoReportDescriptor))
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	candidate := candidates[0]
	node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 4, Ino: 310, Rdev: unix.Mkdev(241, 9)}

	var writes, closes int
	ops := systemProbeOps()
	ops.lstat = func(_ string, st *unix.Stat_t) error { *st = node; return nil }
	ops.open = func(string, int, uint32) (int, error) { return 91, nil }
	ops.fstat = func(_ int, st *unix.Stat_t) error { *st = node; return nil }
	ops.flock = func(fd int, how int) error {
		if fd != 91 || how != unix.LOCK_EX|unix.LOCK_NB {
			t.Fatalf("unexpected flock(%d, %#x)", fd, how)
		}
		return unix.EWOULDBLOCK
	}
	ops.close = func(fd int) error {
		if fd != 91 {
			t.Fatalf("unexpected close(%d)", fd)
		}
		closes++
		return nil
	}
	ops.writeHidraw = func(_ int, _ []byte) (int, error) {
		writes++
		return 64, nil
	}

	probed, err := ops.probe(root, "/dev/bus/usb", candidate)
	if !errors.Is(err, unix.EWOULDBLOCK) || probed.Status != ProbeRefused {
		t.Fatalf("probe under flock contention = (%+v, %v), want ProbeRefused + EWOULDBLOCK", probed, err)
	}

	fwBytes := make([]byte, 64)
	manifest, entry := liveDir12Manifest(t)
	res, err := ops.flashFirmware(root, "/dev/bus/usb", candidate, ProtocolV2, false, manifest, entry, fwBytes, nil)
	if !errors.Is(err, unix.EWOULDBLOCK) || res.WriteAttempted {
		t.Fatalf("flashFirmware under flock contention = (%+v, %v), want WriteAttempted=false + EWOULDBLOCK", res, err)
	}
	if writes != 0 || closes != 2 {
		t.Fatalf("writes=%d closes=%d, want writes=0 closes=2", writes, closes)
	}
}
