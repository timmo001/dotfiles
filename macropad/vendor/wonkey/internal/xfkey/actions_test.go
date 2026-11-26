package xfkey

import (
	"bytes"
	"reflect"
	"testing"
)

func actionExamples() []Action {
	return []Action{
		KeyboardAction{Trigger: 2, Modifiers: 15, Key: 0x91},
		MouseAction{Buttons: 7, X: -127, Y: 127, Wheel: -1},
		MediaAction{Usage: 0x023c},
		MultiAction{Interval: 0x1234, Repeat: 255, Keys: []byte{4, 0x68, 0x91}},
	}
}

func actionConfiguration(t *testing.T, action Action) configuration {
	t.Helper()
	encoded, err := action.actionBytes()
	if err != nil {
		t.Fatal(err)
	}
	c := syntheticSettings()
	copy(c[:], encoded)
	return c
}

func TestActionWireLayoutsAndRoundTrip(t *testing.T) {
	wants := [][]byte{
		{0, 2, 15, 1, 0x91},
		{1, 7, 0x81, 0x7f, 0xff},
		{2, 0x3c, 2},
		{3, 0x12, 0x34, 255, 3, 4, 0x68, 0x91},
	}
	for i, action := range actionExamples() {
		encoded, err := action.actionBytes()
		if err != nil || !bytes.Equal(encoded, wants[i]) {
			t.Fatalf("%T encoded %x, want %x: %v", action, encoded, wants[i], err)
		}
		decoded, err := decodeAction(actionConfiguration(t, action))
		if err != nil || !reflect.DeepEqual(action, decoded) {
			t.Fatalf("%T round trip: %#v, %v", action, decoded, err)
		}
	}
	for _, usage := range []int{1, 0xe2, 0xe9, 0xea, 0x100, 0x23c} {
		action := MediaAction{Usage: usage}
		decoded, err := decodeAction(actionConfiguration(t, action))
		if err != nil || decoded != action {
			t.Fatalf("media %x: %v, %v", usage, decoded, err)
		}
	}
}

func TestActionTransitionsPreserveUnknownBytes(t *testing.T) {
	for _, old := range actionExamples() {
		for _, next := range actionExamples() {
			current := actionConfiguration(t, old)
			oldBytes, _ := old.actionBytes()
			newBytes, _ := next.actionBytes()
			intended, err := (ActionChanges{Action: next}).configuration(current)
			if err != nil {
				t.Fatalf("%T -> %T: %v", old, next, err)
			}
			want := current
			clear(want[:len(oldBytes)])
			copy(want[:], newBytes)
			if intended != want {
				t.Fatalf("%T -> %T: got %x, want %x", old, next, intended, want)
			}
			if bytes.Equal(oldBytes, newBytes) && intended != current {
				t.Fatal("no-op changed unknown bytes")
			}
		}
	}
}

func TestMultiBoundariesAndRetiredKeys(t *testing.T) {
	for _, length := range []int{1, 55, 56, 57, 114, 115} {
		keys := bytes.Repeat([]byte{0x91}, length)
		action := MultiAction{Interval: 65535, Repeat: 1, Keys: keys}
		current := actionConfiguration(t, action)
		decoded, err := decodeAction(current)
		if err != nil || !reflect.DeepEqual(decoded, action) {
			t.Fatal(length, decoded, err)
		}
		next := MultiAction{Interval: 1, Repeat: 255, Keys: []byte{4}}
		intended, err := (ActionChanges{Action: next}).configuration(current)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(intended[6:5+length], make([]byte, length-1)) {
			t.Fatal("retired keys remain active", length)
		}
		if !bytes.Equal(intended[5+length:], current[5+length:]) || !bytes.Equal(intended[120:], current[120:]) {
			t.Fatal("unknown bytes or RGB changed", length)
		}
		copy(keys, bytes.Repeat([]byte{4}, length))
		if !bytes.Equal(decoded.(MultiAction).Keys, bytes.Repeat([]byte{0x91}, length)) {
			t.Fatal("decoded keys alias input")
		}
	}
}

func TestActionValidation(t *testing.T) {
	invalid := []Action{
		KeyboardAction{Trigger: 0, Key: 4},
		KeyboardAction{Trigger: 4, Key: 4},
		KeyboardAction{Trigger: 1, Modifiers: 16, Key: 4},
		KeyboardAction{Trigger: 1, Key: 3},
		KeyboardAction{Trigger: 1, Key: 0x92},
		MouseAction{Buttons: -1},
		MouseAction{Buttons: 8},
		MouseAction{X: -128},
		MouseAction{X: 128},
		MouseAction{Y: -128},
		MouseAction{Y: 128},
		MouseAction{Wheel: -128},
		MouseAction{Wheel: 128},
		MediaAction{Usage: 0},
		MediaAction{Usage: -1},
		MediaAction{Usage: 0x23d},
		MultiAction{Interval: 0, Repeat: 1, Keys: []byte{4}},
		MultiAction{Interval: 65536, Repeat: 1, Keys: []byte{4}},
		MultiAction{Interval: 1, Repeat: 0, Keys: []byte{4}},
		MultiAction{Interval: 1, Repeat: 256, Keys: []byte{4}},
		MultiAction{Interval: 1, Repeat: 1},
		MultiAction{Interval: 1, Repeat: 1, Keys: bytes.Repeat([]byte{4}, 116)},
		MultiAction{Interval: 1, Repeat: 1, Keys: []byte{0}},
		MultiAction{Interval: 1, Repeat: 1, Keys: []byte{0x92}},
		(*KeyboardAction)(nil),
	}
	current := syntheticSettings()
	for _, action := range invalid {
		intended, err := (ActionChanges{Action: action}).configuration(current)
		if err == nil || intended != current {
			t.Fatalf("accepted invalid %#v: %v", action, err)
		}
	}
	for _, changes := range []ActionChanges{{}, {RGB: Changes{"key": 4}}, {RGB: Changes{"rgb-mode": 8}}, {RGB: Changes{"red": -1}}} {
		if _, err := changes.configuration(current); err == nil {
			t.Fatal("accepted invalid changes", changes)
		}
	}
	for _, mutate := range []func(*configuration){
		func(c *configuration) { c[0] = 4 },
		func(c *configuration) { c[3] = 2 },
		func(c *configuration) { c[0], c[1] = 1, 8 },
		func(c *configuration) { c[0], c[2] = 1, 128 },
		func(c *configuration) { c[0], c[1], c[2] = 2, 0, 0 },
		func(c *configuration) { c[0], c[1], c[2] = 2, 0x3d, 2 },
		func(c *configuration) { c[0], c[4] = 3, 0 },
		func(c *configuration) { c[0], c[4] = 3, 116 },
		func(c *configuration) { c[0], c[4] = 3, 255 },
		func(c *configuration) { c[0], c[1], c[2], c[4] = 3, 0, 0, 1 },
		func(c *configuration) { c[0], c[3], c[4] = 3, 0, 1 },
		func(c *configuration) { c[0], c[4], c[5] = 3, 1, 255 },
		func(c *configuration) { c[124] = 0 },
	} {
		bad := current
		mutate(&bad)
		for _, changes := range []ActionChanges{{Action: MediaAction{Usage: 1}}, {RGB: Changes{"blue": 0}}} {
			intended, err := changes.configuration(bad)
			if err == nil || intended != bad {
				t.Fatalf("accepted unsupported current %x: %v", bad, err)
			}
		}
	}
}

func TestKeyboardBothCompatibilityAndConversionGuard(t *testing.T) {
	current := syntheticSettings()
	current[1] = 3
	for _, release := range [][]byte{{0, 0, 0}, {0, 1, 4}, {15, 1, 0x91}, {255, 255, 255}} {
		copy(current[5:8], release)
		if _, err := decodeAction(current); err != nil {
			t.Fatal("lost existing mode 3 decode", err)
		}
		for _, changes := range []Changes{{"trigger": 3, "key": 0x68}, {"blue": 0}} {
			if _, err := changeConfiguration(current, changes); err != nil {
				t.Fatal("lost legacy mode 3 support", err)
			}
		}
		for _, changes := range []ActionChanges{{Action: KeyboardAction{Trigger: 3, Key: 0x68}}, {RGB: Changes{"blue": 0}}} {
			intended, err := changes.configuration(current)
			if err != nil || !bytes.Equal(current[5:124], intended[5:124]) {
				t.Fatal("changed possible release fields", err)
			}
		}
		for _, action := range actionExamples()[1:] {
			if _, err := (ActionChanges{Action: action}).configuration(current); err == nil {
				t.Fatal("converted ambiguous release fields")
			}
			nonKeyboard := actionConfiguration(t, action)
			if _, err := (ActionChanges{Action: KeyboardAction{Trigger: 3, Key: 4}}).configuration(nonKeyboard); err == nil {
				t.Fatal("created ambiguous release fields")
			}
		}
	}
}

func TestActionRGBOnlyAndCombined(t *testing.T) {
	for _, action := range actionExamples() {
		current := actionConfiguration(t, action)
		intended, err := (ActionChanges{RGB: Changes{"rgb-mode": 7, "red": 0}}).configuration(current)
		if err != nil || !bytes.Equal(current[:124], intended[:124]) || intended[124] != 8 || intended[125] != 0 || intended[126] != current[126] || intended[127] != current[127] {
			t.Fatal("RGB-only did not preserve action", action, err)
		}
		combined, err := (ActionChanges{Action: MediaAction{Usage: 0xe9}, RGB: Changes{"blue": 1}}).configuration(current)
		if err != nil || combined[127] != 1 || !bytes.Equal(combined[:3], []byte{2, 0xe9, 0}) {
			t.Fatal("combined change failed", err)
		}
	}
}
