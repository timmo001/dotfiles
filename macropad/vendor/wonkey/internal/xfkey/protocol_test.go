package xfkey

import (
	"bytes"
	"encoding/hex"
	"testing"
)

// All replies in these tests are synthetic, not device captures.
func syntheticReply(command byte) []byte {
	b := make([]byte, 64)
	b[0], b[1] = 0xaf, command
	return b
}

func TestIdentity(t *testing.T) {
	b := syntheticReply(1)
	copy(b[2:], []byte{1, 0x12, 0x12, 0x34, 0xde, 0xad, 0xbe, 0xef})
	identity, err := parseIdentity(b)
	if err != nil || identity.Model != 0x112 || identity.Version != 0x1234 || identity.Identifier != "deadbeef" || identity.Status != evidenceStatus {
		t.Fatalf("identity=%+v err=%v", identity, err)
	}
	cases := map[string][]byte{
		"missing": nil, "short": b[:63], "long": append(append([]byte{}, b...), 0),
		"wrong header":  syntheticReply(2),
		"wrong prefix":  append([]byte{0, 1}, b[2:]...),
		"little endian": append([]byte{0xaf, 1, 0x12, 1}, b[4:]...),
	}
	for name, reply := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parseIdentity(reply); err == nil {
				t.Fatal("accepted invalid reply")
			}
		})
	}
}

func TestReadbackBoundariesAndRawPreservation(t *testing.T) {
	replies := [3][]byte{syntheticReply(6), syntheticReply(7), syntheticReply(8)}
	for i := range 62 {
		replies[0][i+2] = byte(i)
		replies[1][i+2] = byte(i + 62)
	}
	for i := 2; i < 64; i++ {
		replies[2][i] = byte(i + 122)
	}
	result, err := parseReadback(replies)
	if err != nil {
		t.Fatal(err)
	}
	c, err := hex.DecodeString(result.Configuration)
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range []byte{0, 61, 62, 123, 124, 127} {
		if c[i] != i {
			t.Errorf("boundary %d = %d", i, c[i])
		}
	}
	if result.Raw[2] != hex.EncodeToString(replies[2]) {
		t.Fatal("unused RX8 bytes lost")
	}
	if result.RGB.Label != "unknown" || result.RGB.Stored != 124 {
		t.Fatal("unknown RGB changed or labelled")
	}
	for i := range replies {
		for _, bad := range [][]byte{nil, replies[i][:63], append(append([]byte{}, replies[i]...), 0), syntheticReply(1)} {
			invalid := replies
			invalid[i] = bad
			if _, err := parseReadback(invalid); err == nil {
				t.Errorf("accepted invalid reply %d", i)
			}
		}
	}
}

func TestRGBUnknownValues(t *testing.T) {
	for _, stored := range []byte{0, 9, 255} {
		var c configuration
		c[124] = stored
		result := describeRGB(c)
		if result.Stored != stored || result.Index != int(stored)-1 || result.Label != "unknown" {
			t.Fatalf("%+v", result)
		}
	}
	for i, label := range rgbLabels {
		var c configuration
		c[124] = byte(i + 1)
		if describeRGB(c).Label != label {
			t.Fatal(i)
		}
	}
}

func TestPreview(t *testing.T) {
	var c configuration
	for i := range c {
		c[i] = byte(i)
	}
	packets := preview(c)
	if packets[0] != (vendorPacket{0xaf, 1}) || packets[4] != (vendorPacket{0xaf, 4}) {
		t.Fatal("identify or commit framing")
	}
	for i, offset := range []byte{0, 60, 120} {
		packet := packets[i+1]
		count := min(60, 128-offset)
		if !bytes.Equal(packet[:4], []byte{0xaf, 2, offset, count}) || !bytes.Equal(packet[4:4+count], c[offset:offset+count]) {
			t.Fatalf("packet %d", i)
		}
		if !bytes.Equal(packet[4+count:], make([]byte, 60-count)) {
			t.Fatal("nonzero padding")
		}
	}
	for _, packet := range packets {
		buffer := hidrawOutput(packet)
		if buffer[0] != 0 || !bytes.Equal(buffer[1:], packet[:]) {
			t.Fatal("report-ID placeholder")
		}
	}
}

func TestEchoValidation(t *testing.T) {
	sent := vendorPacket{0xaf, 2, 0, 60}
	if err := validateEcho(sent, sent[:]); err != nil {
		t.Fatal(err)
	}
	different := sent
	different[63] = 1
	for _, reply := range [][]byte{nil, sent[:63], append(sent[:], 0), different[:]} {
		if validateEcho(sent, reply) == nil {
			t.Fatal("accepted mismatched echo")
		}
	}
}
