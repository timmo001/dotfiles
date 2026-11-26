package sayo

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

const candidateSayo000CUSBDescriptor = "\x12\x01\x10\x01\x00\x00\x00\x40\x89\x80\x0c\x00\x9a\x08\x01\x02\x03\x01" +
	"\x09\x02\x42\x00\x02\x01\x00\xe0\x32" +
	"\x09\x04\x00\x00\x01\x03\x01\x01\x00\x09\x21\x10\x01\x00\x01\x22\x41\x00\x07\x05\x81\x03\x08\x00\x01" +
	"\x09\x04\x01\x00\x02\x03\x00\x00\x00\x09\x21\x11\x01\x00\x01\x22\x9a\x00\x07\x05\x82\x03\x40\x00\x01\x07\x05\x03\x03\x40\x00\x01"

// candidateSayoSingleInterfaceBootloaderUSBDescriptor is a synthetic HID v1 family bootloader (PID 0x0006).
// No capture of a 0x0006..0x0008 bootloader exists. The authentic 2x3P bootloader capture is in
// testdata/bootloader-2x3p-20261109.
const candidateSayoSingleInterfaceBootloaderUSBDescriptor = "\x12\x01\x10\x01\x00\x00\x00\x40\x89\x80\x06\x00\x00\x01\x01\x02\x03\x01" +
	"\x09\x02\x29\x00\x01\x01\x00\xe0\x32" +
	"\x09\x04\x00\x00\x02\x03\x00\x00\x00\x09\x21\x11\x01\x00\x01\x22\x14\x00\x07\x05\x81\x03\x40\x00\x01\x07\x05\x01\x03\x40\x00\x01"

func TestMatchCandidate000C(t *testing.T) {
	descriptors := []byte(candidateSayo000CUSBDescriptor)
	original := bytes.Clone(descriptors)
	got, err := MatchCandidate("7-1.4.3.4", descriptors)
	if err != nil {
		t.Fatal(err)
	}
	want := Candidate{
		PhysicalPath:    "7-1.4.3.4",
		VID:             0x8089,
		PID:             0x000c,
		Revision:        0x089a,
		Configuration:   1,
		VendorInterface: 1,
		Interfaces: [4]CandidateInterface{
			{0, 0, 3, 1, 1, 0x0110, 65, CandidateEndpoint{0x81, 3, 8, 1}},
			{1, 0, 3, 0, 0, 0x0111, 154, CandidateEndpoint{0x82, 3, 64, 1}},
		},
	}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if !bytes.Equal(descriptors, original) {
		t.Fatal("matcher changed the input")
	}
}

func TestMatchCandidateApplicationAndBootloaderPIDs(t *testing.T) {
	appPIDs := []uint16{0x0002, 0x0003, 0x0004, 0x0005, 0x0009, 0x000a, 0x000b, 0x000c, 0x000e}
	for _, pid := range appPIDs {
		d := []byte(candidateSayo000CUSBDescriptor)
		binary.LittleEndian.PutUint16(d[10:12], pid)
		got, err := MatchCandidate("7-1.4.3.4", d)
		if err != nil || got.VID != 0x8089 || got.PID != pid || !IsSupportedPID(got.VID, got.PID) || IsBootloaderPID(got.VID, got.PID) {
			t.Fatalf("app PID 8089:%04x: got %+v, %v", pid, got, err)
		}
	}

	bootloaderPIDs := []uint16{0x0006, 0x0007, 0x0008}
	for _, pid := range bootloaderPIDs {
		d := []byte(candidateSayo000CUSBDescriptor)
		binary.LittleEndian.PutUint16(d[10:12], pid)
		if !IsBootloaderPID(0x8089, pid) || IsSupportedPID(0x8089, pid) || !IsSayoCandidatePID(0x8089, pid) {
			t.Fatalf("bootloader PID 8089:%04x classification wrong", pid)
		}
		got, err := MatchCandidate("7-1.4.3.4", d)
		if err != nil || got.VID != 0x8089 || got.PID != pid {
			t.Fatalf("bootloader PID 8089:%04x: got %+v, %v", pid, got, err)
		}

		single := []byte(candidateSayoSingleInterfaceBootloaderUSBDescriptor)
		binary.LittleEndian.PutUint16(single[10:12], pid)
		gotSingle, err := MatchCandidate("7-1.4.3.4", single)
		if err != nil || gotSingle.VID != 0x8089 || gotSingle.PID != pid || gotSingle.VendorInterface != 0 {
			t.Fatalf("single-interface bootloader PID 8089:%04x: got %+v, %v", pid, gotSingle, err)
		}
	}

	unknownPIDs := []uint16{0x0000, 0x0001, 0x000d, 0x000f, 0x0010, 0x8890}
	for _, pid := range unknownPIDs {
		d := []byte(candidateSayo000CUSBDescriptor)
		binary.LittleEndian.PutUint16(d[10:12], pid)
		if got, err := MatchCandidate("7-1.4.3.4", d); err == nil || got != (Candidate{}) {
			t.Fatalf("accepted unknown PID 8089:%04x: %+v", pid, got)
		}
	}
}

func TestMatchCandidateRejectsInvalidDescriptors(t *testing.T) {
	base := []byte(candidateSayo000CUSBDescriptor)
	for length := range len(base) {
		if got, err := MatchCandidate("7-1.4", base[:length]); err == nil || got != (Candidate{}) {
			t.Fatalf("accepted truncation to %d bytes", length)
		}
	}
	for _, tt := range []struct {
		name   string
		change func([]byte) []byte
	}{
		{"wrong vendor", func(d []byte) []byte { d[8] = 0x89; d[9] = 0x11; return d }},
		{"multiple configurations", func(d []byte) []byte { d[17] = 2; return d }},
		{"wrong total length", func(d []byte) []byte { d[20]--; return d }},
		{"zero configuration value", func(d []byte) []byte { d[23] = 0; return d }},
		{"boot subclass on vendor iface", func(d []byte) []byte { d[58] = 1; return d }},
		{"single endpoint on vendor iface", func(d []byte) []byte { d[56] = 1; return d }},
		{"two IN endpoints on vendor iface", func(d []byte) []byte { d[79] = 0x83; return d }},
		{"two OUT endpoints on vendor iface", func(d []byte) []byte { d[72] = 0x02; return d }},
		{"bulk endpoint on vendor iface", func(d []byte) []byte { d[73] = 0x02; return d }},
		{"short packet size on vendor iface", func(d []byte) []byte { d[74] = 32; return d }},
		{"short report descriptor on vendor iface", func(d []byte) []byte { d[68] = 10; return d }},
		{"trailing byte", func(d []byte) []byte { return append(d, 0) }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			d := bytes.Clone(base)
			if got, err := MatchCandidate("7-1.4", tt.change(d)); err == nil || got != (Candidate{}) {
				t.Fatalf("accepted %s: %+v, %v", tt.name, got, err)
			}
		})
	}
	for _, path := range []string{"", "0-1", "1-0", "../1-2", "hidraw0", strings.Repeat("1", 254) + "-2"} {
		if got, err := MatchCandidate(path, base); err == nil || got != (Candidate{}) {
			t.Fatalf("accepted invalid path %q: %+v", path, got)
		}
	}
}
