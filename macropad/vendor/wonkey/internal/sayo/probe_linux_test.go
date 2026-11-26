package sayo

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func makeSayoSysfs(t *testing.T, pid uint16, hidrawName string, reportDesc []byte) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "7-1.4.3.4")
	hidrawDir := filepath.Join(dir, "7-1.4.3.4:1.1", "0003:8089:000C.0002", "hidraw", hidrawName)
	if err := os.MkdirAll(hidrawDir, 0o700); err != nil {
		t.Fatal(err)
	}
	usbDesc := []byte(candidateSayo000CUSBDescriptor)
	binary.LittleEndian.PutUint16(usbDesc[10:12], pid)
	for name, data := range map[string][]byte{
		"descriptors": usbDesc,
		"busnum":      []byte("7\n"),
		"devnum":      []byte("12\n"),
		"dev":         []byte("189:779\n"),
	} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	hidDir := filepath.Dir(filepath.Dir(hidrawDir))
	if err := os.WriteFile(filepath.Join(hidDir, "report_descriptor"), reportDesc, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hidrawDir, "dev"), []byte("241:9\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestProbeAndApplyV2WithKnobAndKeys(t *testing.T) {
	root := makeSayoSysfs(t, 0x0009, "hidraw9", []byte(candidateSayoReportDescriptor))
	if err := os.WriteFile(filepath.Join(root, "7-1.4.3.4", "product"), []byte("SayoDevice O3C\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 || candidates[0].VID != 0x8089 || candidates[0].PID != 0x0009 || candidates[0].ProductName != "SayoDevice O3C" {
		t.Fatalf("discover: %+v, %v", candidates, err)
	}
	candidate := candidates[0]
	ops := systemProbeOps()
	node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 4, Ino: 300, Rdev: unix.Mkdev(241, 9)}

	var keyRecords [6]Packet
	keyTypes := [6]byte{0, 0, 0, 0, 1, 2}
	for i := range 6 {
		r := Packet{0x21, 0x12, 0x00, 0x00, 0x3c, 0x00, 0x10, byte(i)}
		r[8] = 0x01
		r[9] = keyTypes[i]
		for g := 10; g < 24; g++ {
			r[g] = byte(0xa0 + i)
		}
		if i < 3 {
			usage := byte(0x1e + i)
			r[24], r[28], r[29] = 0x00, 0x00, usage
			r[32], r[36], r[37] = 0x00, 0x00, usage
		} else {
			muCodes := [6]byte{0, 0, 0, 8, 11, 10}
			r[24], r[28] = 0x03, muCodes[i]
			r[32], r[36] = 0x03, muCodes[i]
		}
		SignPacketV2(&r)
		keyRecords[i] = r
	}
	var lightRecords [6]Packet
	for i := range 6 {
		r := Packet{0x21, 0x12, 0x00, 0x00, 0x3c, 0x00, 0x11, byte(i)}
		for g := 8; g < 24; g++ {
			r[g] = byte(0xb0 + i)
		}
		copy(r[24:32], []byte{0x00, 0x01, 0x64, 0x64, 0x40, 0x40, 0x40, 0x00})
		SignPacketV2(&r)
		lightRecords[i] = r
	}

	var pendingReplies []Packet
	var savedCount int
	ops.lstat = func(_ string, st *unix.Stat_t) error { *st = node; return nil }
	ops.open = func(string, int, uint32) (int, error) { return 99, nil }
	ops.fstat = func(_ int, st *unix.Stat_t) error { *st = node; return nil }
	ops.close = func(int) error { return nil }
	ops.writeHidraw = func(fd int, data []byte) (int, error) {
		if fd != 99 || len(data) != 64 || data[0] != 0x21 {
			t.Fatalf("invalid Sayo v2 hidraw write: fd=%d len=%d", fd, len(data))
		}
		var pkt Packet
		copy(pkt[:], data)
		want := pkt
		SignPacketV2(&want)
		if pkt[2] != want[2] || pkt[3] != want[3] {
			t.Fatalf("invalid v2 checksum in %x", pkt)
		}
		cmdID, index := pkt[6], pkt[7]
		switch {
		case cmdID == 0x00 && pkt[4] == 0x04:
			infoReply := Packet{0x21, 0x12, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x3c, 0x23, 0x9a, 0x08}
			SignPacketV2(&infoReply)
			pendingReplies = append(pendingReplies, infoReply)
		case cmdID == 0x10 && pkt[4] == 0x04:
			if index < 6 {
				pendingReplies = append(pendingReplies, keyRecords[index])
			} else {
				errReply := Packet{0x21, 0x12, 0x00, 0x00, 0x04, 0x40, 0x10, index}
				SignPacketV2(&errReply)
				pendingReplies = append(pendingReplies, errReply)
			}
		case cmdID == 0x10 && pkt[4] == 0x3c:
			keyRecords[index] = pkt
			pendingReplies = append(pendingReplies, pkt)
		case cmdID == 0x11 && pkt[4] == 0x04:
			pendingReplies = append(pendingReplies, lightRecords[index])
		case cmdID == 0x11 && pkt[4] == 0x3c:
			lightRecords[index] = pkt
			pendingReplies = append(pendingReplies, pkt)
		case cmdID == 0x0d:
			savedCount++
			pendingReplies = append(pendingReplies, SavePacketV2())
		default:
			t.Fatalf("unexpected v2 TX packet: %x", pkt)
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
	if err != nil || probed.Status != ProbeRawReport || probed.Layout == nil {
		t.Fatalf("probe v2: %+v, %v", probed, err)
	}
	if probed.Layout.Keys != 3 || probed.Layout.Knobs != 1 || probed.Layout.RGBMode != "held" || probed.Layout.RGBColour != "#404040" ||
		probed.Layout.ModelCode != 0x233c || probed.Layout.FirmwareVersion != 0x089a || probed.Layout.Bootloader {
		t.Fatalf("wrong O3C layout: %+v", probed.Layout)
	}
	if b, ok := probed.Layout.Binding(Knob1Left, 1); !ok || b.MediaUsage != 0x00ea {
		t.Fatalf("O3C knob1-left binding: %+v, %v", b, ok)
	}
	if b, ok := probed.Layout.Binding(Knob1Press, 1); !ok || b.MediaUsage != 0x00e2 {
		t.Fatalf("O3C knob1-press binding: %+v, %v", b, ok)
	}
	if b, ok := probed.Layout.Binding(Knob1Right, 1); !ok || b.MediaUsage != 0x00e9 {
		t.Fatalf("O3C knob1-right binding: %+v, %v", b, ok)
	}

	knobRightIdx, ok := probed.Layout.SlotIndex(KnobRight)
	if !ok || knobRightIdx != 5 {
		t.Fatalf("O3C knob-right index = (%d, %v), want (5, true)", knobRightIdx, ok)
	}
	writeReq, err := PrepareMediaWrite(KnobRight, knobRightIdx, 1, true, MediaCalculator)
	if err != nil {
		t.Fatal(err)
	}
	applied, err := ops.apply(root, "/dev/bus/usb", candidate, writeReq)
	if err != nil || !applied.WriteAttempted || applied.ReportsWritten != 2 || savedCount != 1 {
		t.Fatalf("apply v2 knob-right: %+v, %v, saved=%d", applied, err, savedCount)
	}
	if keyRecords[5][9] != 2 || keyRecords[5][10] != 0xa5 || keyRecords[5][28] != 22 || keyRecords[5][36] != 22 {
		t.Fatalf("slot 5 header or media code 22 not preserved/updated: %x", keyRecords[5])
	}

	rgbReq, err := PrepareRGBWrite(probed.Layout.SlotCount, "breathe", 0, 0, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	appliedRGB, err := ops.apply(root, "/dev/bus/usb", candidate, rgbReq)
	if err != nil || !appliedRGB.WriteAttempted || appliedRGB.ReportsWritten != 7 || savedCount != 2 {
		t.Fatalf("apply v2 RGB: %+v, %v, saved=%d", appliedRGB, err, savedCount)
	}
	for i := range 6 {
		if lightRecords[i][8] != byte(0xb0+i) || lightRecords[i][24] != 0x02 || lightRecords[i][28] != 0x40 {
			t.Fatalf("light record %d header or colour lost: %x", i, lightRecords[i])
		}
	}
}

func TestProbeAndApplyV1Hidraw(t *testing.T) {
	root := makeSayoSysfs(t, 0x0004, "hidraw4", []byte(candidateSayoV1OnlyReportDescriptor))
	candidates, err := DiscoverCandidates(root)
	if err != nil || len(candidates) != 1 || candidates[0].PID != 0x0004 {
		t.Fatalf("discover v1: %+v, %v", candidates, err)
	}
	candidate := candidates[0]
	ops := systemProbeOps()
	node := unix.Stat_t{Mode: unix.S_IFCHR | 0o600, Dev: 4, Ino: 301, Rdev: unix.Mkdev(241, 9)}

	var keyRecords [4]Packet
	for i := range 4 {
		r := Packet{0x02, 0x16, 0x2e, 0x00, byte(i), 0x01, 0x00}
		for g := 7; g < 19; g++ {
			r[g] = byte(0xc0 + i)
		}
		r[19], r[21], r[22] = 0x00, 0x00, byte(0x04+i)
		SignPacketV1(&r)
		keyRecords[i] = r
	}
	var lightRecords [4]Packet
	for i := range 4 {
		r := Packet{0x02, 0x10, 0x35, 0x00, byte(i), 0x00, 0x01, 0x05, 0x00, 0x11, 0x22, 0x33}
		SignPacketV1(&r)
		lightRecords[i] = r
	}

	var pendingReplies []Packet
	var savedV1 int
	ops.lstat = func(_ string, st *unix.Stat_t) error { *st = node; return nil }
	ops.open = func(string, int, uint32) (int, error) { return 88, nil }
	ops.fstat = func(_ int, st *unix.Stat_t) error { *st = node; return nil }
	ops.close = func(int) error { return nil }
	ops.writeHidraw = func(fd int, data []byte) (int, error) {
		if fd != 88 || len(data) != 64 || data[0] != 0x02 {
			t.Fatalf("invalid Sayo v1 hidraw write: fd=%d len=%d", fd, len(data))
		}
		var pkt Packet
		copy(pkt[:], data)
		want := pkt
		SignPacketV1(&want)
		chkPos := int(pkt[2]) + 3
		if pkt[chkPos] != want[chkPos] {
			t.Fatalf("invalid v1 checksum at %d: got %02x, want %02x", chkPos, pkt[chkPos], want[chkPos])
		}
		cmd, pattern, index := pkt[1], pkt[3], pkt[4]
		switch {
		case cmd == 0x00:
			infoReply := Packet{0x02, 0x00, 0x04, 0x01, 0x02, 0x19, 0x64}
			SignPacketV1(&infoReply)
			pendingReplies = append(pendingReplies, infoReply)
		case cmd == 0x16 && pattern == 0x00:
			if index < 4 {
				pendingReplies = append(pendingReplies, keyRecords[index])
			} else {
				endReply := Packet{0x02, 0x16, 0x00, 0x00, index}
				pendingReplies = append(pendingReplies, endReply)
			}
		case cmd == 0x16 && pattern == 0x01:
			keyRecords[index] = pkt
			pendingReplies = append(pendingReplies, pkt)
		case cmd == 0x10 && pattern == 0x00:
			pendingReplies = append(pendingReplies, lightRecords[index])
		case cmd == 0x10 && pattern == 0x01:
			lightRecords[index] = pkt
			pendingReplies = append(pendingReplies, pkt)
		case cmd == 0x04:
			if !bytes.Equal(pkt[:6], []byte{0x02, 0x04, 0x02, 0x72, 0x96, 0x10}) {
				t.Fatalf("unexpected v1 Save packet: %x", pkt[:8])
			}
			savedV1++
			pendingReplies = append(pendingReplies, pkt)
		default:
			t.Fatalf("unexpected v1 TX packet: %x", pkt[:12])
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
	if err != nil || probed.Status != ProbeRawReport || probed.Layout == nil {
		t.Fatalf("probe v1: %+v, %v", probed, err)
	}
	if probed.Layout.Protocol != ProtocolV1 || probed.Layout.Keys != 4 || probed.Layout.Knobs != 0 || probed.Layout.RGBMode != "static" || probed.Layout.RGBColour != "#112233" ||
		probed.Layout.ModelCode != 0x1964 || probed.Layout.FirmwareVersion != 0x0102 || probed.Layout.Bootloader {
		t.Fatalf("wrong v1 layout: %+v", probed.Layout)
	}
	reqKey, err := PrepareKeyboardWrite(Key2, 1, 1, true, []Stroke{{Modifiers: 0x02, Usage: 0x68}})
	if err != nil {
		t.Fatal(err)
	}
	applied, err := ops.apply(root, "/dev/bus/usb", candidate, reqKey)
	if err != nil || !applied.WriteAttempted || applied.ReportsWritten != 2 || savedV1 != 1 {
		t.Fatalf("apply v1 key: %+v, %v, saved=%d", applied, err, savedV1)
	}
	if keyRecords[1][7] != 0xc1 || keyRecords[1][21] != 0x02 || keyRecords[1][22] != 0x68 || keyRecords[1][27] != 0x02 || keyRecords[1][28] != 0x68 {
		t.Fatalf("v1 key2 record not updated or header lost: %x", keyRecords[1][:32])
	}

	reqRGB, err := PrepareRGBWrite(probed.Layout.SlotCount, "flash", 0xff, 0x00, 0x00, true)
	if err != nil {
		t.Fatal(err)
	}
	appliedRGB, err := ops.apply(root, "/dev/bus/usb", candidate, reqRGB)
	if err != nil || !appliedRGB.WriteAttempted || appliedRGB.ReportsWritten != 5 || savedV1 != 2 {
		t.Fatalf("apply v1 RGB: %+v, %v, saved=%d", appliedRGB, err, savedV1)
	}
	for i := range 4 {
		if lightRecords[i][5] != 0x08 || lightRecords[i][8] != 0x01 || lightRecords[i][9] != 0xff {
			t.Fatalf("v1 light record %d not updated: %x", i, lightRecords[i][:16])
		}
	}

	readCalls := 0
	ops.readHidraw = func(_ int, data []byte, _ int) (int, error) {
		readCalls++
		if readCalls == 3 {
			return 0, unix.ETIMEDOUT
		}
		reply := pendingReplies[0]
		pendingReplies = pendingReplies[1:]
		copy(data, reply[:])
		return 64, nil
	}
	if timedOut, err := ops.probe(root, "/dev/bus/usb", candidate); err == nil || timedOut.Status != ProbeTransferFailed {
		t.Fatalf("probe v1 timeout on slot 1 = (%+v, %v), want ProbeTransferFailed error", timedOut, err)
	}
}

func TestApplyRefusesSysfsBootloaderWithApplicationDescriptor(t *testing.T) {
	for name, tc := range map[string]struct {
		pid     uint16
		product string
	}{
		"bootloader-pid":     {0x0006, "SayoDevice 2x3P"},
		"bootloader-product": {0x0009, "Bootloader"},
	} {
		t.Run(name, func(t *testing.T) {
			root := makeSayoSysfs(t, tc.pid, "hidraw9", []byte(candidateSayoReportDescriptor))
			if err := os.WriteFile(filepath.Join(root, "7-1.4.3.4", "product"), []byte(tc.product+"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			candidates, err := DiscoverCandidates(root)
			if err != nil || len(candidates) != 1 || !candidates[0].Bootloader {
				t.Fatalf("discover: %+v, %v", candidates, err)
			}
			ops := systemProbeOps()
			ops.open = func(string, int, uint32) (int, error) {
				t.Fatal("apply opened a bootloader hidraw node")
				return -1, nil
			}
			req, err := PrepareRGBWrite(6, "static", 1, 2, 3, true)
			if err != nil {
				t.Fatal(err)
			}
			res, err := ops.apply(root, "/dev/bus/usb", candidates[0], req)
			if err == nil || !strings.Contains(err.Error(), "bootloader mode") || res.WriteAttempted {
				t.Fatalf("apply = (%+v, %v)", res, err)
			}
		})
	}
}
