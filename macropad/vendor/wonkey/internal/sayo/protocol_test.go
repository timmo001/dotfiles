package sayo

import (
	"slices"
	"testing"
)

func TestMediaCodeAndMediaUsageFromCode(t *testing.T) {
	table := []struct {
		code  byte
		usage MediaUsage
	}{
		{1, MediaScreenBrightnessUp},
		{2, MediaScreenBrightnessDown},
		{8, MediaMute},
		{10, MediaVolumeUp},
		{11, MediaVolumeDown},
		{12, MediaPlay},
		{13, MediaStop},
		{14, MediaPrevious},
		{15, MediaNext},
		{22, MediaCalculator},
		{25, MediaWebPageHome},
		{26, MediaWebPageBack},
		{27, MediaWebPageForward},
		{30, MediaFavorites},
	}
	for _, entry := range table {
		gotCode, ok := MediaCode(entry.usage)
		if !ok || gotCode != entry.code {
			t.Fatalf("MediaCode(%#04x) = (%d, %v), want (%d, true)", entry.usage, gotCode, ok, entry.code)
		}
		gotUsage := MediaUsageFromCode(entry.code)
		if gotUsage != uint16(entry.usage) {
			t.Fatalf("MediaUsageFromCode(%d) = %#04x, want %#04x", entry.code, gotUsage, entry.usage)
		}
	}
	if code, ok := MediaCode(MediaPlayOnly); !ok || code != 12 {
		t.Fatalf("MediaCode(0x00b0) = (%d, %v), want (12, true)", code, ok)
	}
	for _, unmapped := range []MediaUsage{0x0001, 0x00b1, 0x019e, 0x022a} {
		if code, ok := MediaCode(unmapped); ok || code != 0 {
			t.Fatalf("accepted unmapped media usage %#04x: code=%d", unmapped, code)
		}
	}
}

func TestBuildDeviceLayoutKeysAndKnobs(t *testing.T) {
	var sixKeyRecords []RawSlotRecord
	for i := range 6 {
		var r RawSlotRecord
		r.KeyType = 0
		r.Layers[0] = SlotBinding{ActionType: SlotActionKeyboard, Strokes: []Stroke{{Usage: 0x1e + i}}}
		sixKeyRecords = append(sixKeyRecords, r)
	}
	layout6, err := BuildDeviceLayout(ProtocolV2, sixKeyRecords, "held", "#404040")
	if err != nil {
		t.Fatal(err)
	}
	if layout6.Keys != 6 || layout6.Knobs != 0 || layout6.SlotCount != 6 {
		t.Fatalf("2x3P layout: got %d keys, %d knobs", layout6.Keys, layout6.Knobs)
	}
	for i, ctrl := range []Control{Key1, Key2, Key3, Key4, Key5, Key6} {
		if idx, ok := layout6.SlotIndex(ctrl); !ok || idx != byte(i) {
			t.Fatalf("2x3P %s index = (%d, %v), want (%d, true)", ctrl, idx, ok, i)
		}
	}

	o3cRecords := []RawSlotRecord{
		{KeyType: 0, Layers: [5]SlotBinding{{ActionType: SlotActionKeyboard, Strokes: []Stroke{{Usage: 0x1d}}}}},
		{KeyType: 0, Layers: [5]SlotBinding{{ActionType: SlotActionKeyboard, Strokes: []Stroke{{Usage: 0x1b}}}}},
		{KeyType: 0, Layers: [5]SlotBinding{{ActionType: SlotActionKeyboard, Strokes: []Stroke{{Usage: 0x06}}}}},
		{KeyType: 0, Layers: [5]SlotBinding{{ActionType: SlotActionMedia, MediaUsage: 0x00e2}}},
		{KeyType: 1, Layers: [5]SlotBinding{{ActionType: SlotActionMedia, MediaUsage: 0x00ea}}},
		{KeyType: 2, Layers: [5]SlotBinding{{ActionType: SlotActionMedia, MediaUsage: 0x00e9}}},
	}
	layoutO3C, err := BuildDeviceLayout(ProtocolV2, o3cRecords, "static", "#0000FF")
	if err != nil {
		t.Fatal(err)
	}
	if layoutO3C.Keys != 3 || layoutO3C.Knobs != 1 || layoutO3C.SlotCount != 6 {
		t.Fatalf("O3C layout: got %d keys, %d knobs", layoutO3C.Keys, layoutO3C.Knobs)
	}
	for ctrl, wantIdx := range map[Control]byte{
		Key1:       0,
		Key2:       1,
		Key3:       2,
		KnobPress:  3,
		Knob1Press: 3,
		KnobLeft:   4,
		Knob1Left:  4,
		KnobRight:  5,
		Knob1Right: 5,
	} {
		if idx, ok := layoutO3C.SlotIndex(ctrl); !ok || idx != wantIdx {
			t.Fatalf("O3C %s index = (%d, %v), want (%d, true)", ctrl, idx, ok, wantIdx)
		}
	}
	if b, ok := layoutO3C.Binding(KnobLeft, 1); !ok || b.MediaUsage != 0x00ea {
		t.Fatalf("O3C knob-left binding: %+v, %v", b, ok)
	}
	if b, ok := layoutO3C.Binding(Knob1Right, 1); !ok || b.MediaUsage != 0x00e9 {
		t.Fatalf("O3C knob1-right binding: %+v, %v", b, ok)
	}
	if b, ok := layoutO3C.Binding(KnobPress, 1); !ok || b.MediaUsage != 0x00e2 {
		t.Fatalf("O3C knob-press binding: %+v, %v", b, ok)
	}

	altKnobRecords := []RawSlotRecord{
		{KeyType: 1, Layers: [5]SlotBinding{{ActionType: SlotActionMedia, MediaUsage: 0x00ea}}},
		{KeyType: 2, Layers: [5]SlotBinding{{ActionType: SlotActionMedia, MediaUsage: 0x00e9}}},
		{KeyType: 0, Layers: [5]SlotBinding{{ActionType: SlotActionMedia, MediaUsage: 0x00e2}}},
		{KeyType: 0, Layers: [5]SlotBinding{{ActionType: SlotActionKeyboard, Strokes: []Stroke{{Usage: 0x04}}}}},
	}
	layoutAlt, err := BuildDeviceLayout(ProtocolV1, altKnobRecords, "off", "#000000")
	if err != nil {
		t.Fatal(err)
	}
	if layoutAlt.Keys != 1 || layoutAlt.Knobs != 1 {
		t.Fatalf("alt knob layout: got %d keys, %d knobs", layoutAlt.Keys, layoutAlt.Knobs)
	}
	for ctrl, wantIdx := range map[Control]byte{
		Knob1Left:  0,
		Knob1Right: 1,
		Knob1Press: 2,
		Key1:       3,
	} {
		if idx, ok := layoutAlt.SlotIndex(ctrl); !ok || idx != wantIdx {
			t.Fatalf("alt %s index = (%d, %v), want (%d, true)", ctrl, idx, ok, wantIdx)
		}
	}
}

func TestPrepareAndMergeV2AndV1Records(t *testing.T) {
	reqKey, err := PrepareKeyboardWrite(Key2, 1, 1, true, []Stroke{{Modifiers: 0x01, Usage: 0x68}})
	if err != nil {
		t.Fatal(err)
	}
	curV2 := Packet{0x21, 0x12, 0x00, 0x00, 0x3c, 0x00, 0x10, 0x01}
	for i := 8; i < 24; i++ {
		curV2[i] = byte(0xa0 + i)
	}
	MergeKeyRecordV2(&curV2, reqKey)
	for i := 8; i < 24; i++ {
		if curV2[i] != byte(0xa0+i) {
			t.Fatalf("MergeKeyRecordV2 overwrote header at %d", i)
		}
	}
	if curV2[28] != 0x01 || curV2[29] != 0x68 || curV2[36] != 0x01 || curV2[37] != 0x68 {
		t.Fatalf("MergeKeyRecordV2 did not update FN0 and FN1: %x", curV2)
	}

	curV1 := Packet{0x02, 0x16, 0x2e, 0x00, 0x01, 0x01, 0x00}
	for i := 5; i < 19; i++ {
		curV1[i] = byte(0xb0 + i)
	}
	MergeKeyRecordV1(&curV1, reqKey)
	for i := 5; i < 19; i++ {
		if curV1[i] != byte(0xb0+i) {
			t.Fatalf("MergeKeyRecordV1 overwrote header at %d", i)
		}
	}
	if curV1[3] != 0x01 || curV1[4] != 0x01 || curV1[19] != 0x00 || curV1[21] != 0x01 || curV1[22] != 0x68 || curV1[27] != 0x01 || curV1[28] != 0x68 {
		t.Fatalf("MergeKeyRecordV1 did not update FN0 and FN1: %x", curV1)
	}
	wantV1 := curV1
	SignPacketV1(&wantV1)
	if curV1[49] != wantV1[49] {
		t.Fatalf("MergeKeyRecordV1 checksum mismatch: got %02x, want %02x", curV1[49], wantV1[49])
	}

	saveV1 := SavePacketV1()
	if saveV1[0] != 0x02 || saveV1[1] != 0x04 || saveV1[2] != 0x02 || saveV1[3] != 0x72 || saveV1[4] != 0x96 || saveV1[5] != 0x10 {
		t.Fatalf("SavePacketV1 = %x", saveV1[:8])
	}

	if b := DecodeSlotV2(1, 1, []byte{0x21, 0, 0, 0, 0x01, 0x06, 0x01, 0x19}); b.ActionType != SlotActionMacro || !slices.Equal(b.Strokes, []Stroke{{Modifiers: 1, Usage: 0x06}, {Modifiers: 1, Usage: 0x19}}) {
		t.Fatalf("DecodeSlotV2 mode 0x21: %+v", b)
	}
	if b := DecodeSlotV1(1, 1, []byte{0x04, 0, 0x01, 0x06, 0x01, 0x19}); b.ActionType != SlotActionMacro || !slices.Equal(b.Strokes, []Stroke{{Modifiers: 1, Usage: 0x06}, {Modifiers: 1, Usage: 0x19}}) {
		t.Fatalf("DecodeSlotV1 mode 0x04: %+v", b)
	}
	if b := DecodeSlotV2(1, 1, []byte{0x01, 0, 0, 0, 0x02, 0x04, 0x05, 0x06}); b.ActionType != SlotActionMacro || len(b.Strokes) != 3 {
		t.Fatalf("DecodeSlotV2 mode 0x01: %+v", b)
	}
	if b := DecodeSlotV2(1, 1, []byte{0x02, 0, 0, 0, 0x01, 0xfe, 0x03, 0x00}); b.ActionType != SlotActionMouse || b.Mouse.Action != MouseDrag {
		t.Fatalf("DecodeSlotV2 mode 0x02: %+v", b)
	}
	for _, event := range []MouseEvent{
		{Action: MouseClick, Buttons: MouseLeft},
		{Action: MouseMove, DX: -5, DY: 7},
		{Action: MouseDrag, Buttons: MouseRight, DX: 2, DY: -3},
		{Action: MouseWheel, Wheel: -1},
		{Action: MouseWheelUp},
		{Action: MouseWheelDown},
	} {
		if _, err := PrepareMouseWrite(Key1, 0, 1, true, event); err != nil {
			t.Fatalf("PrepareMouseWrite(%+v): %v", event, err)
		}
	}
	for _, badEvent := range []MouseEvent{
		{Action: "unknown"},
		{Action: MouseClick},
		{Action: MouseMove},
		{Action: MouseDrag, Buttons: MouseLeft},
		{Action: MouseWheel},
		{Action: MouseWheelUp, Buttons: MouseLeft},
	} {
		if _, err := PrepareMouseWrite(Key1, 0, 1, true, badEvent); err == nil {
			t.Fatalf("accepted invalid mouse event %+v", badEvent)
		}
	}
	for _, strokes := range [][]Stroke{
		{{Modifiers: 0x01, Usage: 0x04}, {Modifiers: 0x02, Usage: 0x05}},
		{{Modifiers: 0x01, Usage: 0x04}, {Usage: 0x05}, {Usage: 0x06}},
		{{Modifiers: 0x03, Usage: 0x00}},
	} {
		if _, err := PrepareKeyboardWrite(Key1, 0, 1, false, strokes); err != nil {
			t.Fatalf("PrepareKeyboardWrite(%+v): %v", strokes, err)
		}
	}
	for _, badStrokes := range [][]Stroke{
		nil,
		{{Usage: 0x04}, {Usage: 0x05}, {Usage: 0x06}, {Usage: 0x07}},
		{{Modifiers: -1, Usage: 0x04}},
		{{Modifiers: 0, Usage: 0}},
		{{Usage: 0x91}},
		{{Modifiers: 1, Usage: 0x04}, {Modifiers: 1, Usage: 0x05}, {Usage: 0x06}},
	} {
		if _, err := PrepareKeyboardWrite(Key1, 0, 1, false, badStrokes); err == nil {
			t.Fatalf("accepted invalid strokes %+v", badStrokes)
		}
	}
	for _, mode := range []string{"static", "held", "breathe", "cycle-slow", "cycle-fast", "flash", "off"} {
		reqRGB, err := PrepareRGBWrite(6, mode, 0x10, 0x20, 0x30, true)
		if err != nil {
			t.Fatalf("PrepareRGBWrite(%q): %v", mode, err)
		}
		var p2, p1 Packet
		if err := MergeLightRecordV2(&p2, 0, reqRGB); err != nil {
			t.Fatal(err)
		}
		if err := MergeLightRecordV1(&p1, 0, reqRGB); err != nil {
			t.Fatal(err)
		}
		wantMode, wantColour := mode, "#102030"
		switch mode {
		case "cycle-fast":
			wantMode = "cycle-slow"
		case "off":
			wantColour = "#000000"
		}
		if gotMode, gotColour := DecodeLightV2(p2[24:32]); gotMode != wantMode || gotColour != wantColour {
			t.Fatalf("DecodeLightV2(%q) = (%q, %q), want (%q, %q)", mode, gotMode, gotColour, wantMode, wantColour)
		}
		if gotMode, gotColour := DecodeLightV1(p1[5:12]); gotMode != wantMode || gotColour != wantColour {
			t.Fatalf("DecodeLightV1(%q) = (%q, %q), want (%q, %q)", mode, gotMode, gotColour, wantMode, wantColour)
		}
	}
	if _, ok := DetectProtocolVersion([]byte{0x05, 0x01}); ok {
		t.Fatal("unexpected protocol match on non-vendor descriptor")
	}
}
