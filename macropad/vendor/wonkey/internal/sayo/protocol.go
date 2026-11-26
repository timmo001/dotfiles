package sayo

import (
	"bytes"
	"fmt"
)

// Packet is a 64-byte SayoDevice HID v1 (`0x02`) or HID v2 (`0x21`) report.
type Packet [64]byte

// ProtocolVersion identifies whether a SayoDevice uses HID v1 (`Report ID 0x02`) or HID v2 (`Report ID 0x21`).
type ProtocolVersion int

const (
	ProtocolV2 ProtocolVersion = 2
	ProtocolV1 ProtocolVersion = 1
)

const (
	v2ReportSignature = "\x06\x11\xff\x09\x02\xa1\x01\x85\x21"
	v1ReportSignature = "\x06\x00\xff\x09\x01\xa1\x01\x85\x02"
	// bootloaderReportSignature is the vendor usage page 0xFFA0 collection with report ID 0x02,
	// captured from the 2x3P (manifest directory 12) bootloader in testdata/bootloader-2x3p-20261109.
	bootloaderReportSignature = "\x06\xa0\xff\x09\x01\xa1\x01\x85\x02"
)

// DetectProtocolVersion inspects a vendor HID report descriptor for the HID v2 (`0x21`) or HID v1 (`0x02`) signature.
// The SayoDevice bootloader descriptor uses HID v1 framing and reports ProtocolV1.
func DetectProtocolVersion(descriptor []byte) (ProtocolVersion, bool) {
	if bytes.Contains(descriptor, []byte(v2ReportSignature)) {
		return ProtocolV2, true
	}
	if bytes.Contains(descriptor, []byte(v1ReportSignature)) || IsBootloaderReportDescriptor(descriptor) {
		return ProtocolV1, true
	}
	return 0, false
}

// IsBootloaderReportDescriptor reports whether descriptor has the SayoDevice bootloader signature and no HID v2 signature.
func IsBootloaderReportDescriptor(descriptor []byte) bool {
	return bytes.Contains(descriptor, []byte(bootloaderReportSignature)) && !bytes.Contains(descriptor, []byte(v2ReportSignature))
}

// Control names a configurable SayoDevice key or rotary knob direction.
type Control string

const (
	Key1       Control = "key1"
	Key2       Control = "key2"
	Key3       Control = "key3"
	Key4       Control = "key4"
	Key5       Control = "key5"
	Key6       Control = "key6"
	Key7       Control = "key7"
	Key8       Control = "key8"
	Key9       Control = "key9"
	Key10      Control = "key10"
	Key11      Control = "key11"
	Key12      Control = "key12"
	KnobLeft   Control = "knob-left"
	KnobPress  Control = "knob-press"
	KnobRight  Control = "knob-right"
	Knob1Left  Control = "knob1-left"
	Knob1Press Control = "knob1-press"
	Knob1Right Control = "knob1-right"
	Knob2Left  Control = "knob2-left"
	Knob2Press Control = "knob2-press"
	Knob2Right Control = "knob2-right"
	Knob3Left  Control = "knob3-left"
	Knob3Press Control = "knob3-press"
	Knob3Right Control = "knob3-right"
	Knob4Left  Control = "knob4-left"
	Knob4Press Control = "knob4-press"
	Knob4Right Control = "knob4-right"
)

var allKeyControls = [...]Control{
	Key1, Key2, Key3, Key4, Key5, Key6,
	Key7, Key8, Key9, Key10, Key11, Key12,
}

var allKnobControls = [4][3]Control{
	{Knob1Left, Knob1Press, Knob1Right},
	{Knob2Left, Knob2Press, Knob2Right},
	{Knob3Left, Knob3Press, Knob3Right},
	{Knob4Left, Knob4Press, Knob4Right},
}

// CanonicalControl normalises knob aliases (`knob-left` -> `knob1-left`).
func CanonicalControl(control Control) Control {
	switch control {
	case KnobLeft:
		return Knob1Left
	case KnobPress:
		return Knob1Press
	case KnobRight:
		return Knob1Right
	default:
		return control
	}
}

// Stroke uses the eight standard keyboard modifier bits and a keyboard HID usage.
type Stroke struct {
	Modifiers int
	Usage     int
}

// MediaUsage lists supported HID Consumer usages (`0x0C`).
type MediaUsage uint16

const (
	MediaScreenBrightnessUp   MediaUsage = 0x006f
	MediaScreenBrightnessDown MediaUsage = 0x0070
	MediaPlayOnly             MediaUsage = 0x00b0
	MediaNext                 MediaUsage = 0x00b5
	MediaPrevious             MediaUsage = 0x00b6
	MediaStop                 MediaUsage = 0x00b7
	MediaPlay                 MediaUsage = 0x00cd
	MediaMute                 MediaUsage = 0x00e2
	MediaVolumeUp             MediaUsage = 0x00e9
	MediaVolumeDown           MediaUsage = 0x00ea
	MediaFavorites            MediaUsage = 0x0182
	MediaCalculator           MediaUsage = 0x0192
	MediaWebPageHome          MediaUsage = 0x0223
	MediaWebPageBack          MediaUsage = 0x0224
	MediaWebPageForward       MediaUsage = 0x0225
)

// MediaCode maps a HID Consumer usage to the official SayoDevice `mu_keys.json` / `isa.py` code (`1..30`).
func MediaCode(usage MediaUsage) (byte, bool) {
	switch usage {
	case MediaScreenBrightnessUp:
		return 1, true
	case MediaScreenBrightnessDown:
		return 2, true
	case MediaMute:
		return 8, true
	case MediaVolumeUp:
		return 10, true
	case MediaVolumeDown:
		return 11, true
	case MediaPlay, MediaPlayOnly:
		return 12, true
	case MediaStop:
		return 13, true
	case MediaPrevious:
		return 14, true
	case MediaNext:
		return 15, true
	case MediaCalculator:
		return 22, true
	case MediaWebPageHome:
		return 25, true
	case MediaWebPageBack:
		return 26, true
	case MediaWebPageForward:
		return 27, true
	case MediaFavorites:
		return 30, true
	default:
		return 0, false
	}
}

// MediaUsageFromCode maps a SayoDevice multimedia code (`1..30`) to a HID Consumer usage.
func MediaUsageFromCode(code byte) uint16 {
	switch code {
	case 1:
		return uint16(MediaScreenBrightnessUp)
	case 2:
		return uint16(MediaScreenBrightnessDown)
	case 8:
		return uint16(MediaMute)
	case 10:
		return uint16(MediaVolumeUp)
	case 11:
		return uint16(MediaVolumeDown)
	case 12:
		return uint16(MediaPlay)
	case 13:
		return uint16(MediaStop)
	case 14:
		return uint16(MediaPrevious)
	case 15:
		return uint16(MediaNext)
	case 22:
		return uint16(MediaCalculator)
	case 25:
		return uint16(MediaWebPageHome)
	case 26:
		return uint16(MediaWebPageBack)
	case 27:
		return uint16(MediaWebPageForward)
	case 30:
		return uint16(MediaFavorites)
	default:
		return uint16(code)
	}
}

type MouseAction string

const (
	MouseMove      MouseAction = "move"
	MouseDrag      MouseAction = "drag"
	MouseClick     MouseAction = "click"
	MouseWheel     MouseAction = "wheel"
	MouseWheelUp   MouseAction = "wheel-up"
	MouseWheelDown MouseAction = "wheel-down"
)

type MouseButtons int

const (
	MouseLeft   MouseButtons = 0x01
	MouseRight  MouseButtons = 0x02
	MouseMiddle MouseButtons = 0x04
)

type MouseEvent struct {
	Action  MouseAction
	Buttons MouseButtons
	DX      int
	DY      int
	Wheel   int
}

type SlotActionType byte

const (
	SlotActionNone     SlotActionType = 0
	SlotActionKeyboard SlotActionType = 1
	SlotActionMedia    SlotActionType = 2
	SlotActionMouse    SlotActionType = 3
	SlotActionMacro    SlotActionType = 5
)

type SlotBinding struct {
	Slot       byte
	Layer      byte
	ActionType SlotActionType
	Strokes    []Stroke
	MediaUsage uint16
	Mouse      MouseEvent
}

// DeviceLayout stores the probed key/knob counts, control-to-slot-index mapping, and per-layer bindings.
type DeviceLayout struct {
	Protocol        ProtocolVersion
	ModelCode       uint16
	FirmwareVersion uint16
	Bootloader      bool
	Keys            int
	Knobs           int
	SlotCount       int
	ControlIndices  map[Control]byte
	Bindings        map[Control]SlotBinding
	LayerBindings   [5]map[Control]SlotBinding
	RGBMode         string
	RGBColour       string
}

// SlotIndex returns the 0-based hardware slot index for a control.
func (l *DeviceLayout) SlotIndex(control Control) (byte, bool) {
	if l != nil && l.ControlIndices != nil {
		if idx, ok := l.ControlIndices[control]; ok {
			return idx, true
		}
		if idx, ok := l.ControlIndices[CanonicalControl(control)]; ok {
			return idx, true
		}
	}
	for i, k := range allKeyControls {
		if control == k {
			return byte(i), true
		}
	}
	return 0, false
}

// Binding returns the decoded SlotBinding for a control on layer 1..5.
func (l *DeviceLayout) Binding(control Control, layer int) (SlotBinding, bool) {
	if l == nil {
		return SlotBinding{}, false
	}
	canonical := CanonicalControl(control)
	if layer >= 1 && layer <= len(l.LayerBindings) && l.LayerBindings[layer-1] != nil {
		if b, ok := l.LayerBindings[layer-1][canonical]; ok {
			return b, true
		}
		if b, ok := l.LayerBindings[layer-1][control]; ok {
			return b, true
		}
	}
	if layer == 1 && l.Bindings != nil {
		if b, ok := l.Bindings[canonical]; ok {
			return b, true
		}
		if b, ok := l.Bindings[control]; ok {
			return b, true
		}
	}
	return SlotBinding{}, false
}

// RawSlotRecord holds one slot's `key_type` (`opt`) and 5 layer bindings.
type RawSlotRecord struct {
	KeyType byte
	Layers  [5]SlotBinding
}

// BuildDeviceLayout classifies sequential slot records into `key1..keyN` and `knob1..knobM`
// using the `key_type` byte (`0` = key or knob press, `1` = knob left/CCW, `2` = knob right/CW).
func BuildDeviceLayout(proto ProtocolVersion, records []RawSlotRecord, rgbMode, rgbColour string) (*DeviceLayout, error) {
	layout := &DeviceLayout{
		Protocol:       proto,
		SlotCount:      len(records),
		ControlIndices: make(map[Control]byte, len(records)+3),
		Bindings:       make(map[Control]SlotBinding, len(records)+3),
		RGBMode:        rgbMode,
		RGBColour:      rgbColour,
	}
	for fn := range layout.LayerBindings {
		layout.LayerBindings[fn] = make(map[Control]SlotBinding, len(records)+3)
	}
	assign := func(ctrl Control, idx int) {
		bIdx := byte(idx & 255)
		layout.ControlIndices[ctrl] = bIdx
		for fn := range 5 {
			b := records[idx].Layers[fn]
			b.Slot = bIdx + 1
			b.Layer = byte(fn + 1)
			layout.LayerBindings[fn][ctrl] = b
		}
		layout.Bindings[ctrl] = layout.LayerBindings[0][ctrl]
	}

	for i := 0; i < len(records); {
		if i+2 < len(records) {
			t0, t1, t2 := records[i].KeyType, records[i+1].KeyType, records[i+2].KeyType
			if (t0 == 0 && t1 == 1 && t2 == 2) || (t0 == 1 && t1 == 2 && t2 == 0) {
				if layout.Knobs >= len(allKnobControls) {
					return nil, fmt.Errorf("unsupported SayoDevice layout (more than %d knobs)", len(allKnobControls))
				}
				knob := allKnobControls[layout.Knobs]
				layout.Knobs++
				var leftIdx, pressIdx, rightIdx int
				if t0 == 0 {
					pressIdx, leftIdx, rightIdx = i, i+1, i+2
				} else {
					leftIdx, rightIdx, pressIdx = i, i+1, i+2
				}
				assign(knob[0], leftIdx)
				assign(knob[1], pressIdx)
				assign(knob[2], rightIdx)
				if layout.Knobs == 1 {
					assign(KnobLeft, leftIdx)
					assign(KnobPress, pressIdx)
					assign(KnobRight, rightIdx)
				}
				i += 3
				continue
			}
		}
		if records[i].KeyType != 0 {
			return nil, fmt.Errorf("unexpected SayoDevice key_type %d at slot index %d", records[i].KeyType, i)
		}
		if layout.Keys >= len(allKeyControls) {
			return nil, fmt.Errorf("unsupported SayoDevice layout (more than %d keys)", len(allKeyControls))
		}
		ctrl := allKeyControls[layout.Keys]
		layout.Keys++
		assign(ctrl, i)
		i++
	}
	if layout.Keys < 1 && layout.Knobs < 1 {
		return nil, fmt.Errorf("unsupported SayoDevice layout (0 keys, 0 knobs)")
	}
	return layout, nil
}

// WriteRequest describes a validated key, macro, mouse, media, or RGB write operation.
type WriteRequest struct {
	Control           Control
	SlotIndex         byte
	Layer             int
	BothDefaultLayers bool
	IsRGB             bool
	SlotPayload       [8]byte
	RGBMode           string
	R, G, B           byte
	HasColour         bool
	SlotCount         int
}

// PrepareKeyboardWrite validates and encodes a 1..3 stroke keyboard or macro write request.
func PrepareKeyboardWrite(control Control, slotIndex byte, layer int, bothDefaultLayers bool, strokes []Stroke) (WriteRequest, error) {
	if layer < 1 || layer > 5 {
		return WriteRequest{}, fmt.Errorf("SayoDevice supports layers 1..5 only")
	}
	count := len(strokes)
	if count < 1 || count > 3 {
		return WriteRequest{}, fmt.Errorf("SayoDevice keyboard binding requires 1..3 strokes")
	}
	for i, s := range strokes {
		if s.Modifiers < 0 || s.Modifiers > 255 {
			return WriteRequest{}, fmt.Errorf("stroke %d requires modifiers 0..255", i+1)
		}
		if s.Usage == 0 {
			if s.Modifiers == 0 {
				return WriteRequest{}, fmt.Errorf("stroke %d requires modifiers 1..255 when usage is 0x00", i+1)
			}
			continue
		}
		if s.Usage < 0x04 || s.Usage > 0x73 {
			return WriteRequest{}, fmt.Errorf("stroke %d requires usage 0x00 or 0x04..0x73", i+1)
		}
	}
	if count == 3 && (strokes[1].Modifiers != 0 || strokes[2].Modifiers != 0) {
		return WriteRequest{}, fmt.Errorf("SayoDevice 3-stroke binding does not support modifiers on strokes 2..3")
	}
	var payload [8]byte
	switch count {
	case 1:
		payload = [8]byte{0x00, 0x00, 0x00, 0x00, byte(strokes[0].Modifiers & 255), byte(strokes[0].Usage & 255), 0x00, 0x00}
	case 2:
		payload = [8]byte{0x04, 0x00, 0x00, 0x00, byte(strokes[0].Modifiers & 255), byte(strokes[0].Usage & 255), byte(strokes[1].Modifiers & 255), byte(strokes[1].Usage & 255)}
	case 3:
		payload = [8]byte{0x01, 0x00, 0x00, 0x00, byte(strokes[0].Modifiers & 255), byte(strokes[0].Usage & 255), byte(strokes[1].Usage & 255), byte(strokes[2].Usage & 255)}
	}
	return WriteRequest{
		Control:           control,
		SlotIndex:         slotIndex,
		Layer:             layer,
		BothDefaultLayers: bothDefaultLayers,
		SlotPayload:       payload,
	}, nil
}

// PrepareMediaWrite validates and encodes a consumer media write request.
func PrepareMediaWrite(control Control, slotIndex byte, layer int, bothDefaultLayers bool, usage MediaUsage) (WriteRequest, error) {
	if layer < 1 || layer > 5 {
		return WriteRequest{}, fmt.Errorf("SayoDevice supports layers 1..5 only")
	}
	code, ok := MediaCode(usage)
	if !ok {
		return WriteRequest{}, fmt.Errorf("unsupported SayoDevice media usage %#x", usage)
	}
	return WriteRequest{
		Control:           control,
		SlotIndex:         slotIndex,
		Layer:             layer,
		BothDefaultLayers: bothDefaultLayers,
		SlotPayload:       [8]byte{0x03, 0x00, 0x00, 0x00, code, 0x00, 0x00, 0x00},
	}, nil
}

// PrepareMouseWrite validates and encodes a relative mouse write request.
func PrepareMouseWrite(control Control, slotIndex byte, layer int, bothDefaultLayers bool, event MouseEvent) (WriteRequest, error) {
	if layer < 1 || layer > 5 {
		return WriteRequest{}, fmt.Errorf("SayoDevice supports layers 1..5 only")
	}
	buttons, dx, dy, wheel, err := encodeMousePayload(event)
	if err != nil {
		return WriteRequest{}, err
	}
	return WriteRequest{
		Control:           control,
		SlotIndex:         slotIndex,
		Layer:             layer,
		BothDefaultLayers: bothDefaultLayers,
		SlotPayload:       [8]byte{0x02, 0x00, 0x00, 0x00, buttons, dx, dy, wheel},
	}, nil
}

// PrepareRGBWrite validates an RGB lighting write request.
func PrepareRGBWrite(slotCount int, mode string, r, g, b byte, hasColour bool) (WriteRequest, error) {
	if _, _, err := encodeRGBMode(mode); err != nil {
		return WriteRequest{}, err
	}
	if slotCount < 1 || slotCount > 24 {
		slotCount = 6
	}
	return WriteRequest{
		IsRGB:     true,
		RGBMode:   mode,
		R:         r,
		G:         g,
		B:         b,
		HasColour: hasColour,
		SlotCount: slotCount,
	}, nil
}

func encodeRGBMode(mode string) (byte, byte, error) {
	switch mode {
	case "static":
		return 0x00, 0x00, nil
	case "held":
		return 0x00, 0x01, nil
	case "breathe":
		return 0x02, 0x00, nil
	case "cycle-slow", "cycle-fast":
		return 0x04, 0x00, nil
	case "flash":
		return 0x08, 0x01, nil
	case "off":
		return 0x00, 0x00, nil
	default:
		return 0, 0, fmt.Errorf("unsupported SayoDevice RGB mode %q", mode)
	}
}

func encodeMousePayload(event MouseEvent) (byte, byte, byte, byte, error) {
	switch event.Action {
	case MouseClick:
		if !validMouseClick(event) {
			return 0, 0, 0, 0, fmt.Errorf("mouse click requires button bits 0x01..0x07 and zero deltas")
		}
		return byte(event.Buttons & 255), 0, 0, 0, nil
	case MouseMove:
		if !validMouseMove(event) {
			return 0, 0, 0, 0, fmt.Errorf("mouse move requires non-zero DX/DY in -128..127 and no buttons or wheel")
		}
		return 0, byte(event.DX & 255), byte(event.DY & 255), 0, nil
	case MouseDrag:
		if !validMouseDrag(event) {
			return 0, 0, 0, 0, fmt.Errorf("mouse drag requires button bits 0x01..0x07, non-zero DX/DY in -128..127, and no wheel")
		}
		return byte(event.Buttons & 255), byte(event.DX & 255), byte(event.DY & 255), 0, nil
	case MouseWheel:
		if !validMouseWheel(event) {
			return 0, 0, 0, 0, fmt.Errorf("mouse wheel requires non-zero wheel delta in -128..127 and no buttons or movement")
		}
		return 0, 0, 0, byte(event.Wheel & 255), nil
	case MouseWheelUp, MouseWheelDown:
		if !validMouseWheelDirection(event) {
			return 0, 0, 0, 0, fmt.Errorf("mouse wheel direction binding cannot include buttons, movement, or wheel delta")
		}
		if event.Action == MouseWheelDown {
			return 0, 0, 0, 0xff, nil
		}
		return 0, 0, 0, 0x01, nil
	default:
		return 0, 0, 0, 0, fmt.Errorf("unsupported SayoDevice mouse action %q", event.Action)
	}
}

func validMouseClick(event MouseEvent) bool {
	return validMouseButtons(event.Buttons) && event.DX == 0 && event.DY == 0 && event.Wheel == 0
}

func validMouseMove(event MouseEvent) bool {
	return event.Buttons == 0 && event.Wheel == 0 && validMouseDeltaPair(event.DX, event.DY)
}

func validMouseDrag(event MouseEvent) bool {
	return validMouseButtons(event.Buttons) && event.Wheel == 0 && validMouseDeltaPair(event.DX, event.DY)
}

func validMouseWheel(event MouseEvent) bool {
	return event.Buttons == 0 && event.DX == 0 && event.DY == 0 && validSignedByte(event.Wheel) && event.Wheel != 0
}

func validMouseWheelDirection(event MouseEvent) bool {
	return event.Buttons == 0 && event.DX == 0 && event.DY == 0 && event.Wheel == 0
}

func validMouseButtons(buttons MouseButtons) bool {
	return buttons >= 1 && buttons <= MouseLeft|MouseRight|MouseMiddle
}

func validMouseDeltaPair(dx, dy int) bool {
	return validSignedByte(dx) && validSignedByte(dy) && (dx != 0 || dy != 0)
}

func validSignedByte(value int) bool {
	return value >= -128 && value <= 127
}

// SignPacketV2 computes and writes the 16-bit little-endian word checksum at pkt[2..3].
func SignPacketV2(pkt *Packet) {
	pkt[2] = 0
	pkt[3] = 0
	var sum uint16
	for i := 0; i < 64; i += 2 {
		sum += uint16(pkt[i]) | (uint16(pkt[i+1]) << 8)
	}
	pkt[2] = byte(sum)
	pkt[3] = byte(sum >> 8)
}

// SignPacketV1 computes and writes the 8-bit sum checksum at pkt[data_len+3].
func SignPacketV1(pkt *Packet) {
	dataLen := int(pkt[2])
	chkPos := dataLen + 3
	if chkPos < 3 || chkPos >= 64 {
		return
	}
	var sum byte
	for i := range chkPos {
		sum += pkt[i]
	}
	pkt[chkPos] = sum
}

// SavePacketV2 returns the signed 64-byte SayoDevice HID v2 Save (`0x0D`) packet.
func SavePacketV2() Packet {
	pkt := Packet{0x21, 0x12, 0x00, 0x00, 0x04, 0x00, 0x0d, 0x00}
	SignPacketV2(&pkt)
	return pkt
}

// SavePacketV1 returns the signed 64-byte SayoDevice HID v1 Save (`0x04`) packet.
func SavePacketV1() Packet {
	pkt := Packet{0x02, 0x04, 0x02, 0x72, 0x96}
	SignPacketV1(&pkt)
	return pkt
}

// QueryKeyPacketV2 returns the signed 64-byte HID v2 Key (`0x10`) read query for `index`.
func QueryKeyPacketV2(index byte) Packet {
	pkt := Packet{0x21, 0x12, 0x00, 0x00, 0x04, 0x00, 0x10, index}
	SignPacketV2(&pkt)
	return pkt
}

// QueryLightPacketV2 returns the signed 64-byte HID v2 Light (`0x11`) read query for `index`.
func QueryLightPacketV2(index byte) Packet {
	pkt := Packet{0x21, 0x12, 0x00, 0x00, 0x04, 0x00, 0x11, index}
	SignPacketV2(&pkt)
	return pkt
}

// QueryKeyPacketV1 returns the signed 64-byte HID v1 Key_map (`0x16`) read query for `index`.
func QueryKeyPacketV1(index byte) Packet {
	pkt := Packet{0x02, 0x16, 0x2e, 0x00, index}
	SignPacketV1(&pkt)
	return pkt
}

// QueryLightPacketV1 returns the signed 64-byte HID v1 Light (`0x10`) read query for `index`.
func QueryLightPacketV1(index byte) Packet {
	pkt := Packet{0x02, 0x10, 0x35, 0x00, index}
	SignPacketV1(&pkt)
	return pkt
}

// MergeKeyRecordV2 updates the requested layer(s) in a 64-byte HID v2 `0x10` record,
// preserving the 16-byte geometry/calibration header at `cur[8..23]` and untouched layers.
func MergeKeyRecordV2(cur *Packet, req WriteRequest) {
	fn := req.Layer - 1
	off := 24 + fn*8
	copy(cur[off:off+8], req.SlotPayload[:])
	if req.BothDefaultLayers && fn == 0 {
		copy(cur[32:40], req.SlotPayload[:])
	}
	cur[0] = 0x21
	cur[1] = 0x12
	cur[4] = 0x3c
	cur[5] = 0x00
	cur[6] = 0x10
	cur[7] = req.SlotIndex
	SignPacketV2(cur)
}

// MergeLightRecordV2 updates a 64-byte HID v2 `0x11` light record, preserving `cur[8..23]`
// and existing RGB bytes when `req.HasColour` is false (and mode is not `"off"`).
func MergeLightRecordV2(cur *Packet, index byte, req WriteRequest) error {
	ledMode, ledEvent, err := encodeRGBMode(req.RGBMode)
	if err != nil {
		return err
	}
	r, g, b := req.R, req.G, req.B
	if req.RGBMode == "off" {
		r, g, b = 0, 0, 0
	} else if !req.HasColour {
		r, g, b = cur[28], cur[29], cur[30]
	}
	cur[0] = 0x21
	cur[1] = 0x12
	cur[4] = 0x3c
	cur[5] = 0x00
	cur[6] = 0x11
	cur[7] = index
	cur[24] = ledMode
	cur[25] = ledEvent
	cur[26] = 0x64
	cur[27] = 0x64
	cur[28] = r
	cur[29] = g
	cur[30] = b
	cur[31] = 0x00
	SignPacketV2(cur)
	return nil
}

// MergeKeyRecordV1 updates the requested layer(s) in a 64-byte HID v1 `0x16` record,
// preserving the 14-byte geometry header at `cur[5..18]` and untouched layers.
func MergeKeyRecordV1(cur *Packet, req WriteRequest) {
	v1Slot := [6]byte{req.SlotPayload[0], 0x00, req.SlotPayload[4], req.SlotPayload[5], req.SlotPayload[6], req.SlotPayload[7]}
	fn := req.Layer - 1
	off := 19 + fn*6
	copy(cur[off:off+6], v1Slot[:])
	if req.BothDefaultLayers && fn == 0 {
		copy(cur[25:31], v1Slot[:])
	}
	cur[0] = 0x02
	cur[1] = 0x16
	cur[2] = 0x2e
	cur[3] = 0x01
	cur[4] = req.SlotIndex
	SignPacketV1(cur)
}

// MergeLightRecordV1 updates a 64-byte HID v1 `0x10` light record, preserving existing RGB bytes
// when `req.HasColour` is false (and mode is not `"off"`).
func MergeLightRecordV1(cur *Packet, index byte, req WriteRequest) error {
	ledMode, ledEvent, err := encodeRGBMode(req.RGBMode)
	if err != nil {
		return err
	}
	r, g, b := req.R, req.G, req.B
	if req.RGBMode == "off" {
		r, g, b = 0, 0, 0
	} else if !req.HasColour {
		r, g, b = cur[9], cur[10], cur[11]
	}
	cur[0] = 0x02
	cur[1] = 0x10
	cur[2] = 0x35
	cur[3] = 0x01
	cur[4] = index
	cur[5] = ledMode
	if cur[6] == 0 {
		cur[6] = 0x01
	}
	if cur[7] == 0 {
		cur[7] = 0x05
	}
	cur[8] = ledEvent
	cur[9] = r
	cur[10] = g
	cur[11] = b
	SignPacketV1(cur)
	return nil
}

// DecodeSlotV2 decodes an 8-byte SayoDevice HID v2 layer slot record (`rx[24+fn*8 : 32+fn*8]`).
func DecodeSlotV2(slot, layer byte, s []byte) SlotBinding {
	if len(s) < 8 {
		return SlotBinding{Slot: slot, Layer: layer}
	}
	return decodeSlotValues(slot, layer, s[0], s[4], s[5], s[6], s[7])
}

// DecodeSlotV1 decodes a 6-byte SayoDevice HID v1 layer slot record (`rx[19+fn*6 : 25+fn*6]`).
func DecodeSlotV1(slot, layer byte, s []byte) SlotBinding {
	if len(s) < 6 {
		return SlotBinding{Slot: slot, Layer: layer}
	}
	return decodeSlotValues(slot, layer, s[0], s[2], s[3], s[4], s[5])
}

func decodeSlotValues(slot, layer, mode, v0, v1, v2, v3 byte) SlotBinding {
	b := SlotBinding{Slot: slot, Layer: layer}
	switch mode {
	case 0x00, 0x0a:
		mod, usage := int(v0), int(v1)
		if mod != 0 || usage != 0 {
			b.ActionType = SlotActionKeyboard
			b.Strokes = []Stroke{{Modifiers: mod, Usage: usage}}
		}
	case 0x01:
		mod := int(v0)
		for _, code := range [3]byte{v1, v2, v3} {
			if code != 0 {
				strokeMod := 0
				if len(b.Strokes) == 0 {
					strokeMod = mod
				}
				b.Strokes = append(b.Strokes, Stroke{Modifiers: strokeMod, Usage: int(code)})
			}
		}
		if len(b.Strokes) == 0 && mod != 0 {
			b.Strokes = append(b.Strokes, Stroke{Modifiers: mod, Usage: 0})
		}
		if len(b.Strokes) > 0 {
			b.ActionType = SlotActionMacro
		}
	case 0x04, 0x21:
		if v0 != 0 || v1 != 0 {
			b.Strokes = append(b.Strokes, Stroke{Modifiers: int(v0), Usage: int(v1)})
		}
		if v2 != 0 || v3 != 0 {
			b.Strokes = append(b.Strokes, Stroke{Modifiers: int(v2), Usage: int(v3)})
		}
		if len(b.Strokes) > 0 {
			b.ActionType = SlotActionMacro
		}
	case 0x02:
		b.ActionType = SlotActionMouse
		b.Mouse = decodeMouseEvent(MouseButtons(v0), signedReportByte(v1), signedReportByte(v2), signedReportByte(v3))
	case 0x03:
		b.ActionType = SlotActionMedia
		if v1 != 0 {
			b.MediaUsage = uint16(v0) | (uint16(v1) << 8)
		} else {
			b.MediaUsage = MediaUsageFromCode(v0)
		}
	}
	return b
}

// DecodeLightV2 decodes an 8-byte SayoDevice HID v2 light record (`rx[24:32]`).
func DecodeLightV2(s []byte) (string, string) {
	if len(s) < 8 {
		return "off", "#000000"
	}
	return decodeLightValues(s[0], s[1], s[4], s[5], s[6])
}

// DecodeLightV1 decodes a SayoDevice HID v1 light record (`rx[5:12]`).
func DecodeLightV1(s []byte) (string, string) {
	if len(s) < 7 {
		return "off", "#000000"
	}
	return decodeLightValues(s[0], s[3], s[4], s[5], s[6])
}

func decodeLightValues(ledMode, ledEvent, r, g, b byte) (string, string) {
	if r == 0 && g == 0 && b == 0 {
		return "off", "#000000"
	}
	mode := "static"
	switch {
	case ledMode == 0x08:
		mode = "flash"
	case ledEvent == 0x01:
		mode = "held"
	case ledMode == 0x02:
		mode = "breathe"
	case ledMode == 0x04:
		mode = "cycle-slow"
	}
	return mode, fmt.Sprintf("#%02X%02X%02X", r, g, b)
}

func signedReportByte(value byte) int {
	if value > 127 {
		return int(value) - 256
	}
	return int(value)
}

func decodeMouseEvent(buttons MouseButtons, dx, dy, wheel int) MouseEvent {
	var action MouseAction
	switch {
	case wheel != 0:
		action = MouseWheel
	case buttons != 0 && (dx != 0 || dy != 0):
		action = MouseDrag
	case buttons != 0:
		action = MouseClick
	case dx != 0 || dy != 0:
		action = MouseMove
	}
	return MouseEvent{Action: action, Buttons: buttons, DX: dx, DY: dy, Wheel: wheel}
}
