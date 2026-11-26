package ch57

import (
	"fmt"
	"maps"
	"slices"
	"testing"
)

func bindingEncoders() map[string]func(Profile, Control) ([]Report, error) {
	return map[string]func(Profile, Control) ([]Report, error){
		"keyboard": func(p Profile, c Control) ([]Report, error) {
			return EncodeKeyboard(p, c, []Stroke{{Usage: 0x04}})
		},
		"media": func(p Profile, c Control) ([]Report, error) { return EncodeMedia(p, c, MediaCalculator) },
		"move": func(p Profile, c Control) ([]Report, error) {
			return EncodeMouse(p, c, MouseEvent{Action: MouseMove, DX: -12, DY: 34, Modifier: MouseCtrl})
		},
		"drag": func(p Profile, c Control) ([]Report, error) {
			return EncodeMouse(p, c, MouseEvent{Action: MouseDrag, Buttons: MouseLeft | MouseRight, DX: 15, DY: -20, Modifier: MouseShift})
		},
		"click": func(p Profile, c Control) ([]Report, error) {
			return EncodeMouse(p, c, MouseEvent{Action: MouseClick, Buttons: MouseLeft, Modifier: MouseCtrl})
		},
		"wheel": func(p Profile, c Control) ([]Report, error) {
			return EncodeMouse(p, c, MouseEvent{Action: MouseWheel, Wheel: -3, Modifier: MouseAlt})
		},
		"wheel up": func(p Profile, c Control) ([]Report, error) {
			return EncodeMouse(p, c, MouseEvent{Action: MouseWheelUp, Modifier: MouseShift})
		},
		"wheel down": func(p Profile, c Control) ([]Report, error) {
			return EncodeMouse(p, c, MouseEvent{Action: MouseWheelDown, Modifier: MouseAlt})
		},
	}
}

func TestMediaGoldenAllControls(t *testing.T) {
	for _, control := range []struct {
		name Control
		slot byte
	}{{Key1, 1}, {Key2, 2}, {Key3, 3}, {KnobLeft, 13}, {KnobPress, 14}, {KnobRight, 15}} {
		for _, usage := range []struct {
			value MediaUsage
			low   byte
			high  byte
		}{
			{MediaScreenBrightnessUp, 0x6f, 0x00},
			{MediaScreenBrightnessDown, 0x70, 0x00},
			{MediaNext, 0xb5, 0x00},
			{MediaPrevious, 0xb6, 0x00},
			{MediaStop, 0xb7, 0x00},
			{MediaPlay, 0xcd, 0x00},
			{MediaMute, 0xe2, 0x00},
			{MediaVolumeUp, 0xe9, 0x00},
			{MediaVolumeDown, 0xea, 0x00},
			{MediaFavorites, 0x82, 0x01},
			{MediaCalculator, 0x92, 0x01},
			{MediaScreenLock, 0x9e, 0x01},
			{MediaWebPageHome, 0x23, 0x02},
			{MediaWebPageBack, 0x24, 0x02},
			{MediaWebPageForward, 0x25, 0x02},
		} {
			t.Run(fmt.Sprintf("%s/%x", control.name, usage.value), func(t *testing.T) {
				got, err := EncodeMedia(ThreeKeyOneKnob(), control.name, usage.value)
				if err != nil {
					t.Fatal(err)
				}
				assertReports(t, got, []Report{
					{0x03, 0xfe, 0x01, 0x01, 0x01},
					{0x03, control.slot, 0x12, usage.low, usage.high},
					{0x03, 0xaa, 0xaa},
				})
			})
		}
	}
}

func TestMouseGoldenAllControls(t *testing.T) {
	for _, control := range []struct {
		name Control
		slot byte
	}{{Key1, 1}, {Key2, 2}, {Key3, 3}, {KnobLeft, 13}, {KnobPress, 14}, {KnobRight, 15}} {
		for _, action := range []struct {
			event  MouseEvent
			button byte
			dx     byte
			dy     byte
			wheel  byte
		}{
			{MouseEvent{Action: MouseMove, DX: -128, DY: 127}, 0x00, 0x80, 0x7f, 0x00},
			{MouseEvent{Action: MouseMove, DX: -1, DY: 1}, 0x00, 0xff, 0x01, 0x00},
			{MouseEvent{Action: MouseMove, DX: 127, DY: -128}, 0x00, 0x7f, 0x80, 0x00},
			{MouseEvent{Action: MouseMove, DX: 1, DY: 0}, 0x00, 0x01, 0x00, 0x00},
			{MouseEvent{Action: MouseMove, DX: 0, DY: -1}, 0x00, 0x00, 0xff, 0x00},
			{MouseEvent{Action: MouseDrag, Buttons: MouseLeft, DX: -128, DY: 127}, 0x01, 0x80, 0x7f, 0x00},
			{MouseEvent{Action: MouseDrag, Buttons: MouseRight, DX: -1, DY: 1}, 0x02, 0xff, 0x01, 0x00},
			{MouseEvent{Action: MouseDrag, Buttons: MouseLeft | MouseRight, DX: 1, DY: 0}, 0x03, 0x01, 0x00, 0x00},
			{MouseEvent{Action: MouseDrag, Buttons: MouseMiddle, DX: 0, DY: -1}, 0x04, 0x00, 0xff, 0x00},
			{MouseEvent{Action: MouseDrag, Buttons: MouseLeft | MouseMiddle, DX: 127, DY: 127}, 0x05, 0x7f, 0x7f, 0x00},
			{MouseEvent{Action: MouseDrag, Buttons: MouseRight | MouseMiddle, DX: -128, DY: -128}, 0x06, 0x80, 0x80, 0x00},
			{MouseEvent{Action: MouseDrag, Buttons: MouseLeft | MouseRight | MouseMiddle, DX: 127, DY: -128}, 0x07, 0x7f, 0x80, 0x00},
			{MouseEvent{Action: MouseClick, Buttons: MouseLeft}, 0x01, 0x00, 0x00, 0x00},
			{MouseEvent{Action: MouseClick, Buttons: MouseRight}, 0x02, 0x00, 0x00, 0x00},
			{MouseEvent{Action: MouseClick, Buttons: MouseLeft | MouseRight}, 0x03, 0x00, 0x00, 0x00},
			{MouseEvent{Action: MouseClick, Buttons: MouseMiddle}, 0x04, 0x00, 0x00, 0x00},
			{MouseEvent{Action: MouseClick, Buttons: MouseLeft | MouseMiddle}, 0x05, 0x00, 0x00, 0x00},
			{MouseEvent{Action: MouseClick, Buttons: MouseRight | MouseMiddle}, 0x06, 0x00, 0x00, 0x00},
			{MouseEvent{Action: MouseClick, Buttons: MouseLeft | MouseRight | MouseMiddle}, 0x07, 0x00, 0x00, 0x00},
			{MouseEvent{Action: MouseWheel, Wheel: -128}, 0x00, 0x00, 0x00, 0x80},
			{MouseEvent{Action: MouseWheel, Wheel: -1}, 0x00, 0x00, 0x00, 0xff},
			{MouseEvent{Action: MouseWheel, Wheel: 1}, 0x00, 0x00, 0x00, 0x01},
			{MouseEvent{Action: MouseWheel, Wheel: 127}, 0x00, 0x00, 0x00, 0x7f},
			{MouseEvent{Action: MouseWheelUp}, 0x00, 0x00, 0x00, 0x01},
			{MouseEvent{Action: MouseWheelDown}, 0x00, 0x00, 0x00, 0xff},
		} {
			for _, modifier := range []struct {
				value MouseModifier
				wire  byte
			}{{MouseNoModifier, 0x00}, {MouseCtrl, 0x01}, {MouseShift, 0x02}, {MouseAlt, 0x04}} {
				t.Run(fmt.Sprintf("%s/%s/%x/%x/%x/%x/%x", control.name, action.event.Action, action.button, action.dx, action.dy, action.wheel, modifier.wire), func(t *testing.T) {
					event := action.event
					event.Modifier = modifier.value
					got, err := EncodeMouse(ThreeKeyOneKnob(), control.name, event)
					if err != nil {
						t.Fatal(err)
					}
					assertReports(t, got, []Report{
						{0x03, 0xfe, 0x01, 0x01, 0x01},
						{0x03, control.slot, 0x13, action.button, action.dx, action.dy, action.wheel, modifier.wire},
						{0x03, 0xaa, 0xaa},
					})
				})
			}
		}
	}
}

func TestLEDGolden(t *testing.T) {
	for _, tt := range []struct {
		mode int
		wire byte
	}{{0, 0x00}, {1, 0x01}, {127, 0x7f}, {255, 0xff}} {
		got, err := EncodeLED(ThreeKeyOneKnob(), tt.mode)
		if err != nil {
			t.Fatal(err)
		}
		assertReports(t, got, []Report{
			{0x03, 0xa1, 0x01},
			{0x03, 0xb0, 0x18, tt.wire},
			{0x03, 0xaa, 0xa1},
		})
	}
}

func TestMediaAndMouseFullK8890Controls(t *testing.T) {
	for _, useKnob1Names := range []bool{false, true} {
		profile := twelveKeyThreeKnobProfile(useKnob1Names)
		for _, tt := range allK8890ControlSlots() {
			t.Run(string(tt.control), func(t *testing.T) {
				mediaGot, err := EncodeMedia(profile, tt.control, MediaVolumeUp)
				if err != nil {
					t.Fatal(err)
				}
				assertReports(t, mediaGot, []Report{
					{0x03, 0xfe, 0x01, 0x01, 0x01},
					{0x03, tt.slot, 0x12, 0xe9, 0x00},
					{0x03, 0xaa, 0xaa},
				})

				mouseGot, err := EncodeMouse(profile, tt.control, MouseEvent{
					Action:   MouseClick,
					Buttons:  MouseLeft,
					Modifier: MouseCtrl,
				})
				if err != nil {
					t.Fatal(err)
				}
				assertReports(t, mouseGot, []Report{
					{0x03, 0xfe, 0x01, 0x01, 0x01},
					{0x03, tt.slot, 0x13, 0x01, 0x00, 0x00, 0x00, 0x01},
					{0x03, 0xaa, 0xaa},
				})
			})
		}
	}
}

func TestMediaAndMouseLayers(t *testing.T) {
	for layer := 0; layer <= 15; layer++ {
		profile := ThreeKeyOneKnob()
		profile.Layer = layer
		wantLayer := byte(layer)
		if wantLayer == 0 {
			wantLayer = 1
		}

		mediaGot, err := EncodeMedia(profile, Key3, MediaCalculator)
		if err != nil {
			t.Fatal(layer, err)
		}
		assertReports(t, mediaGot, []Report{
			{0x03, 0xfe, wantLayer, 0x01, 0x01},
			{0x03, 0x03, (wantLayer << 4) | 0x02, 0x92, 0x01},
			{0x03, 0xaa, 0xaa},
		})

		mouseGot, err := EncodeMouse(profile, KnobLeft, MouseEvent{
			Action:   MouseWheel,
			Wheel:    -3,
			Modifier: MouseAlt,
		})
		if err != nil {
			t.Fatal(layer, err)
		}
		assertReports(t, mouseGot, []Report{
			{0x03, 0xfe, wantLayer, 0x01, 0x01},
			{0x03, 0x0d, (wantLayer << 4) | 0x03, 0x00, 0x00, 0x00, 0xfd, 0x04},
			{0x03, 0xaa, 0xaa},
		})
	}
}

func TestRejectInvalidActions(t *testing.T) {
	for _, usage := range []MediaUsage{-1, 0, 0x04, 0x6e, 0x71, 0xb4, 0xb8, 0x100, 0x181, 0x183, 0x222, 0x226, 0xffff, 0x10000, 0x100b5} {
		got, err := EncodeMedia(ThreeKeyOneKnob(), Key1, usage)
		if err == nil || got != nil {
			t.Fatalf("media %#x: got %x, %v", usage, got, err)
		}
	}
	for _, mode := range []int{-1, 256, 65536} {
		got, err := EncodeLED(ThreeKeyOneKnob(), mode)
		if err == nil || got != nil {
			t.Fatalf("LED %d: got %x, %v", mode, got, err)
		}
	}
	for _, event := range []MouseEvent{
		{},
		{Action: "unknown"},
		{Action: MouseMove},
		{Action: MouseMove, DX: -129},
		{Action: MouseMove, DX: 128},
		{Action: MouseMove, DY: -129},
		{Action: MouseMove, DY: 128},
		{Action: MouseMove, DX: 1, Buttons: MouseLeft},
		{Action: MouseMove, DX: 1, Buttons: -1},
		{Action: MouseMove, DX: 1, Wheel: 1},
		{Action: MouseDrag, DX: 1},
		{Action: MouseDrag, Buttons: -1, DX: 1},
		{Action: MouseDrag, Buttons: 8, DX: 1},
		{Action: MouseDrag, Buttons: 255, DX: 1},
		{Action: MouseDrag, Buttons: 257, DX: 1},
		{Action: MouseDrag, Buttons: MouseLeft},
		{Action: MouseDrag, Buttons: MouseLeft, DX: -129},
		{Action: MouseDrag, Buttons: MouseLeft, DX: 128},
		{Action: MouseDrag, Buttons: MouseLeft, DY: -129},
		{Action: MouseDrag, Buttons: MouseLeft, DY: 128},
		{Action: MouseDrag, Buttons: MouseLeft, DX: 1, Wheel: 1},
		{Action: MouseClick},
		{Action: MouseClick, Buttons: -1},
		{Action: MouseClick, Buttons: 8},
		{Action: MouseClick, Buttons: 255},
		{Action: MouseClick, Buttons: 257},
		{Action: MouseClick, Buttons: MouseLeft, DX: 1},
		{Action: MouseClick, Buttons: MouseLeft, DY: -1},
		{Action: MouseClick, Buttons: MouseLeft, Wheel: 1},
		{Action: MouseWheel},
		{Action: MouseWheel, Wheel: -129},
		{Action: MouseWheel, Wheel: 128},
		{Action: MouseWheel, Wheel: 1, Buttons: MouseLeft},
		{Action: MouseWheel, Wheel: 1, DX: 1},
		{Action: MouseWheel, Wheel: 1, DY: -1},
		{Action: MouseWheelUp, Buttons: MouseLeft},
		{Action: MouseWheelDown, Buttons: MouseRight},
		{Action: MouseWheelDown, Buttons: -1},
		{Action: MouseWheelUp, DX: 1},
		{Action: MouseWheelDown, DY: -1},
		{Action: MouseWheelUp, Wheel: 1},
		{Action: MouseWheelDown, Wheel: -1},
		{Action: MouseWheelUp, Modifier: -1},
		{Action: MouseClick, Buttons: MouseLeft, Modifier: 3},
		{Action: MouseMove, DX: 1, Modifier: 3},
		{Action: MouseDrag, Buttons: MouseLeft, DX: 1, Modifier: 5},
		{Action: MouseWheel, Wheel: 1, Modifier: 6},
		{Action: MouseWheelUp, Modifier: 5},
		{Action: MouseWheelDown, Modifier: 6},
		{Action: MouseWheelDown, Modifier: 7},
		{Action: MouseWheelUp, Modifier: 8},
		{Action: MouseWheelUp, Modifier: 256},
		{Action: MouseWheelUp, Modifier: 257},
	} {
		got, err := EncodeMouse(ThreeKeyOneKnob(), Key1, event)
		if err == nil || got != nil {
			t.Fatalf("mouse %+v: got %x, %v", event, got, err)
		}
	}
}

func TestActionsHaveNoSharedState(t *testing.T) {
	encoders := bindingEncoders()
	encoders["LED"] = func(p Profile, _ Control) ([]Report, error) { return EncodeLED(p, 127) }
	for name, encode := range encoders {
		t.Run(name, func(t *testing.T) {
			profile := ThreeKeyOneKnob()
			slots := maps.Clone(profile.ControlSlots)
			first, err := encode(profile, KnobRight)
			if err != nil {
				t.Fatal(err)
			}
			if !maps.Equal(profile.ControlSlots, slots) {
				t.Fatal("encoder changed the control map")
			}
			want := slices.Clone(first)
			for i := range first {
				for j := range first[i] {
					first[i][j] ^= 0xff
				}
			}
			second, err := encode(profile, KnobRight)
			if err != nil {
				t.Fatal(err)
			}
			assertReports(t, second, want)
			profile.ControlSlots[KnobRight] = 4
			assertReports(t, second, want)
		})
	}
}

func TestActionsK884xFEAndFD(t *testing.T) {
	feProfile := K884xProfile(0x8851, 0, 1)
	feMedia, err := EncodeMedia(feProfile, KnobLeft, MediaVolumeUp)
	if err != nil {
		t.Fatal(err)
	}
	wantFEMedia := []Report{
		{0x03, 0xfe, 16, 1, 0x02, 0, 0, 0, 0, 0, 0x00, 0xe9, 0x00},
		{0x03, 0xaa, 0xaa},
		{0x03, 0xfd, 0xfe, 0xff},
		{0x03, 0xaa, 0xaa},
	}
	if !slices.Equal(feMedia, wantFEMedia) {
		t.Fatalf("K884xFE media:\n got %x\nwant %x", feMedia, wantFEMedia)
	}

	feMouse, err := EncodeMouse(feProfile, Key4, MouseEvent{Action: MouseWheel, Wheel: -1, Modifier: MouseCtrl})
	if err != nil {
		t.Fatal(err)
	}
	wantFEMouse := []Report{
		{0x03, 0xfe, 4, 1, 0x03, 0, 0, 0, 0, 0, 0x03, 0x01, 0x00, 0x00, 0x00, 0xff},
		{0x03, 0xaa, 0xaa},
		{0x03, 0xfd, 0xfe, 0xff},
		{0x03, 0xaa, 0xaa},
	}
	if !slices.Equal(feMouse, wantFEMouse) {
		t.Fatalf("K884xFE mouse:\n got %x\nwant %x", feMouse, wantFEMouse)
	}

	feLED, err := EncodeLED(feProfile, 4)
	if err != nil {
		t.Fatal(err)
	}
	wantFELED := []Report{
		{0x03, 0xfe, 0xb0, 0x01, 0x08, 0, 0, 0, 0, 0, 0x01, 0x00, 0x04},
		{0x03, 0xfd, 0xfe, 0xff},
	}
	if !slices.Equal(feLED, wantFELED) {
		t.Fatalf("K884xFE LED:\n got %x\nwant %x", feLED, wantFELED)
	}

	fdProfile := K884xProfile(0x8850, 11, 1)
	fdMedia, err := EncodeMedia(fdProfile, Knob4Right, MediaPlay)
	if err != nil {
		t.Fatal(err)
	}
	wantFDMedia := []Report{
		{0x03, 0xfd, 15, 1, 0x02, 0x00, 0x02, 0x00, 0x00, 0xcd, 0x00, 0x00, 0x00},
		{0x03, 0xfd, 0xfe, 0xff},
	}
	if !slices.Equal(fdMedia, wantFDMedia) {
		t.Fatalf("K884xFD media:\n got %x\nwant %x", fdMedia, wantFDMedia)
	}

	fdMouse, err := EncodeMouse(fdProfile, Knob4Press, MouseEvent{Action: MouseDrag, Buttons: MouseLeft, DX: 5, DY: -3, Modifier: MouseShift})
	if err != nil {
		t.Fatal(err)
	}
	wantFDMouse := []Report{
		{0x03, 0xfd, 14, 1, 0x03, 0x01, 0x04, 0x00, 0x00, 0xf2, 0x00, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x00, 0xfd, 0x00, 0x00, 0x00},
		{0x03, 0xfd, 0xfe, 0xff},
	}
	if !slices.Equal(fdMouse, wantFDMouse) {
		t.Fatalf("K884xFD mouse:\n got %x\nwant %x", fdMouse, wantFDMouse)
	}

	fdLED, err := EncodeLED(fdProfile, 1)
	if err != nil {
		t.Fatal(err)
	}
	wantFDLED := []Report{
		{0x03, 0xfe, 0xb0, 0x00, 0x01},
		{0x03, 0xfd, 0xfe, 0xff},
	}
	if !slices.Equal(fdLED, wantFDLED) {
		t.Fatalf("K884xFD LED:\n got %x\nwant %x", fdLED, wantFDLED)
	}
}
