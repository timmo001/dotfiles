package ch57

import "fmt"

// MediaUsage lists the consumer usages named in the pinned source.
// Source: https://github.com/kriomant/ch57x-keyboard-tool/blob/bdbffca3/src/keyboard/mod.rs
type MediaUsage int

const (
	MediaScreenBrightnessUp   MediaUsage = 0x6f
	MediaScreenBrightnessDown MediaUsage = 0x70
	MediaNext                 MediaUsage = 0xb5
	MediaPrevious             MediaUsage = 0xb6
	MediaStop                 MediaUsage = 0xb7
	MediaPlay                 MediaUsage = 0xcd
	MediaMute                 MediaUsage = 0xe2
	MediaVolumeUp             MediaUsage = 0xe9
	MediaVolumeDown           MediaUsage = 0xea
	MediaFavorites            MediaUsage = 0x182
	MediaCalculator           MediaUsage = 0x192
	MediaScreenLock           MediaUsage = 0x19e
	MediaWebPageHome          MediaUsage = 0x223
	MediaWebPageBack          MediaUsage = 0x224
	MediaWebPageForward       MediaUsage = 0x225
)

// EncodeMedia returns a layer binding with a 16-bit little-endian usage.
// Encoding source: https://github.com/kriomant/ch57x-keyboard-tool/blob/bdbffca3/src/keyboard/k8890.rs
func EncodeMedia(profile Profile, control Control, usage MediaUsage) ([]Report, error) {
	slot, layer, err := profile.slotAndLayer(control)
	if err != nil {
		return nil, err
	}
	switch usage {
	case MediaScreenBrightnessUp, MediaScreenBrightnessDown,
		MediaNext, MediaPrevious, MediaStop, MediaPlay, MediaMute,
		MediaVolumeUp, MediaVolumeDown, MediaFavorites, MediaCalculator, MediaScreenLock,
		MediaWebPageHome, MediaWebPageBack, MediaWebPageForward:
	default:
		return nil, fmt.Errorf("unsupported CH57 media usage %#x", usage)
	}
	switch profile.Variant {
	case K884xFE:
		return k884xFEReports(Report{0x03, 0xfe, slot, layer, 0x02, 0, 0, 0, 0, 0, 0x00, byte(usage & 255), byte((usage >> 8) & 255)}), nil
	case K884xFD:
		return k884xFDReports(Report{0x03, 0xfd, slot, layer, 0x02, 0x00, 0x02, 0x00, 0x00, byte(usage & 255), 0x00, 0x00, byte((usage >> 8) & 255)}), nil
	}
	return bindingReports(layer, Report{0x03, slot, (layer << 4) | 0x02, byte(usage & 255), byte((usage >> 8) & 255)}), nil
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

// MouseModifier is a single modifier, not a bitmask of combined modifiers.
type MouseModifier int

const (
	MouseNoModifier MouseModifier = 0
	MouseCtrl       MouseModifier = 0x01
	MouseShift      MouseModifier = 0x02
	MouseAlt        MouseModifier = 0x04
)

type MouseEvent struct {
	Action   MouseAction
	Buttons  MouseButtons
	DX       int
	DY       int
	Wheel    int
	Modifier MouseModifier
}

// EncodeMouse returns a layer move, drag, click, or wheel binding.
// Clicks and drags accept non-empty combinations of left, right, and middle buttons.
// Source: https://github.com/kriomant/ch57x-keyboard-tool/blob/bdbffca3/src/keyboard/k8890.rs
func EncodeMouse(profile Profile, control Control, event MouseEvent) ([]Report, error) {
	slot, layer, err := profile.slotAndLayer(control)
	if err != nil {
		return nil, err
	}
	switch event.Modifier {
	case MouseNoModifier, MouseCtrl, MouseShift, MouseAlt:
	default:
		return nil, fmt.Errorf("unsupported CH57 mouse modifier %#x", event.Modifier)
	}
	buttons, dx, dy, wheel, err := encodeMousePayload(event)
	if err != nil {
		return nil, err
	}
	switch profile.Variant {
	case K884xFE:
		sub := byte(0x01)
		if wheel != 0 {
			sub = 0x03
		} else if dx != 0 || dy != 0 {
			sub = 0x05
		}
		return k884xFEReports(Report{0x03, 0xfe, slot, layer, 0x03, 0, 0, 0, 0, 0, sub, byte(event.Modifier & 255), buttons, dx, dy, wheel}), nil
	case K884xFD:
		var modByte byte
		switch event.Modifier {
		case MouseCtrl:
			modByte = 0xf1
		case MouseShift:
			modByte = 0xf2
		case MouseAlt:
			modByte = 0xf3
		}
		return k884xFDReports(Report{0x03, 0xfd, slot, layer, 0x03, 0x01, 0x04, 0x00, 0x00, modByte, 0x00, 0x00, buttons, 0x00, 0x00, dx, 0x00, 0x00, dy, 0x00, 0x00, wheel}), nil
	}
	return bindingReports(layer, Report{0x03, slot, (layer << 4) | 0x03, buttons, dx, dy, wheel, byte(event.Modifier & 255)}), nil
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
		return 0, 0, 0, 0, fmt.Errorf("unsupported CH57 mouse action %q", event.Action)
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

// EncodeLED returns the separate LED sequence, not an A1 key-binding variant.
// Mode is a zero-based byte index. Named effects and hardware support are unverified.
// Sources: https://github.com/kriomant/ch57x-keyboard-tool/blob/88aaa564/src/keyboard/k8890.rs
// and https://github.com/kriomant/ch57x-keyboard-tool/blob/88aaa564/src/options.rs
func EncodeLED(profile Profile, mode int) ([]Report, error) {
	if err := profile.validate(); err != nil {
		return nil, err
	}
	if mode < 0 || mode > 255 {
		return nil, fmt.Errorf("LED mode requires an index 0..255")
	}
	switch profile.Variant {
	case K884xFE:
		return k884xFDReports(Report{0x03, 0xfe, 0xb0, 0x01, 0x08, 0, 0, 0, 0, 0, 0x01, 0x00, byte(mode & 255)}), nil
	case K884xFD:
		return k884xFDReports(Report{0x03, 0xfe, 0xb0, 0x00, byte(mode & 255)}), nil
	}
	return []Report{
		{0x03, 0xa1, 0x01},
		{0x03, 0xb0, 0x18, byte(mode & 255)},
		{0x03, 0xaa, 0xa1},
	}, nil
}
