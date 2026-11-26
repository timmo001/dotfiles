package xfkey

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
)

// Action is a complete action, without RGB settings or unknown configuration bytes.
type Action interface {
	actionBytes() ([]byte, error)
}

type KeyboardAction struct {
	Trigger   int
	Modifiers int
	Key       int
}

type MouseAction struct {
	Buttons int
	X       int
	Y       int
	Wheel   int
}

type MediaAction struct {
	Usage int
}

type MultiAction struct {
	Interval int
	Repeat   int
	Keys     []byte
}

func (a KeyboardAction) actionBytes() ([]byte, error) {
	if err := (Changes{"trigger": a.Trigger, "modifiers": a.Modifiers, "key": a.Key}).validate(); err != nil {
		return nil, err
	}
	return []byte{0, byte(a.Trigger & 255), byte(a.Modifiers & 255), 1, byte(a.Key & 255)}, nil
}

func (a MouseAction) actionBytes() ([]byte, error) {
	if a.Buttons < 0 || a.Buttons > 7 || a.X < -127 || a.X > 127 || a.Y < -127 || a.Y > 127 || a.Wheel < -127 || a.Wheel > 127 {
		return nil, fmt.Errorf("mouse requires buttons 0..7 and X, Y, wheel -127..127")
	}
	return []byte{1, byte(a.Buttons), byte(a.X & 255), byte(a.Y & 255), byte(a.Wheel & 255)}, nil
}

func (a MediaAction) actionBytes() ([]byte, error) {
	if a.Usage < 1 || a.Usage > 0x023c {
		return nil, fmt.Errorf("media usage must be 0x0001..0x023c")
	}
	return []byte{2, byte(a.Usage & 255), byte(a.Usage >> 8)}, nil
}

func (a MultiAction) actionBytes() ([]byte, error) {
	if a.Interval < 1 || a.Interval > 65535 || a.Repeat < 1 || a.Repeat > 255 || len(a.Keys) < 1 || len(a.Keys) > 115 {
		return nil, fmt.Errorf("multi requires interval 1..65535, repeat 1..255 and 1..115 keys")
	}
	for _, key := range a.Keys {
		if settingName(keyValues, int(key)) == "" {
			return nil, fmt.Errorf("unsupported multi key %02x", key)
		}
	}
	encoded := []byte{3, byte(a.Interval >> 8), byte(a.Interval & 255), byte(a.Repeat), byte(len(a.Keys) & 255)}
	return append(encoded, a.Keys...), nil
}

func decodeAction(c configuration) (Action, error) {
	var action Action
	switch c[0] {
	case 0:
		if c[3] != 1 {
			return nil, fmt.Errorf("unsupported keyboard count %d", c[3])
		}
		action = KeyboardAction{Trigger: int(c[1]), Modifiers: int(c[2]), Key: int(c[4])}
	case 1:
		action = MouseAction{Buttons: int(c[1]), X: signedActionByte(c[2]), Y: signedActionByte(c[3]), Wheel: signedActionByte(c[4])}
	case 2:
		action = MediaAction{Usage: int(binary.LittleEndian.Uint16(c[1:3]))}
	case 3:
		count := int(c[4])
		if count < 1 || count > 115 {
			return nil, fmt.Errorf("unsupported multi count %d", count)
		}
		action = MultiAction{Interval: int(binary.BigEndian.Uint16(c[1:3])), Repeat: int(c[3]), Keys: append([]byte(nil), c[5:5+count]...)}
	default:
		return nil, fmt.Errorf("unsupported action type %02x", c[0])
	}
	if _, err := action.actionBytes(); err != nil {
		return nil, err
	}
	return action, nil
}

func signedActionByte(value byte) int {
	if value > 127 {
		return int(value) - 256
	}
	return int(value)
}

// ActionChanges replaces the complete action and changes only explicit RGB fields.
// A nil Action preserves the current action. RGB uses the existing API mode indices.
type ActionChanges struct {
	Action Action
	RGB    Changes
}

func (changes ActionChanges) validate() error {
	if changes.Action == nil && len(changes.RGB) == 0 {
		return fmt.Errorf("at least one action or RGB field is required")
	}
	if changes.Action != nil {
		switch changes.Action.(type) {
		case KeyboardAction, MouseAction, MediaAction, MultiAction:
		default:
			return fmt.Errorf("action must be a KeyboardAction, MouseAction, MediaAction or MultiAction value")
		}
		if _, err := changes.Action.actionBytes(); err != nil {
			return err
		}
	}
	if len(changes.RGB) != 0 {
		if err := changes.RGB.validate(); err != nil {
			return err
		}
		for name := range changes.RGB {
			if settingsFields[name].offset < 124 {
				return fmt.Errorf("action RGB fields cannot contain %s", name)
			}
		}
	}
	return nil
}

func (changes ActionChanges) configuration(current configuration) (configuration, error) {
	if err := changes.validate(); err != nil {
		return current, err
	}
	old, err := decodeAction(current)
	if err != nil {
		return current, err
	}
	if current[124] < 1 || current[124] > 8 {
		return current, fmt.Errorf("unsupported current RGB mode %02x", current[124])
	}
	intended := current
	if changes.Action != nil {
		encoded, err := changes.Action.actionBytes()
		if err != nil {
			return current, err
		}
		previous, err := old.actionBytes()
		if err != nil {
			return current, err
		}
		if current[0] != encoded[0] {
			// Mode 3 can include separate release fields. Its full active span is not established.
			if (current[0] == 0 && current[1] == 3) || (encoded[0] == 0 && encoded[1] == 3) {
				return current, fmt.Errorf("cannot convert keyboard mode 3: ambiguous release layout")
			}
			clear(intended[:len(previous)])
		} else if len(encoded) < len(previous) {
			clear(intended[len(encoded):len(previous)])
		}
		copy(intended[:], encoded)
	}
	for name, value := range changes.RGB {
		spec := settingsFields[name]
		stored := value + spec.shift
		if stored < 0 || stored > 255 {
			return current, fmt.Errorf("unsupported stored setting %s=%d", name, stored)
		}
		intended[spec.offset] = byte(stored)
	}
	return intended, nil
}

func actionSettingViews(current, intended configuration) []changeView {
	if current[0] == 0 && intended[0] == 0 {
		return settingViews(current, intended)
	}
	views := []changeView{}
	before, _ := decodeAction(current)
	after, _ := decodeAction(intended)
	oldBytes, _ := before.actionBytes()
	newBytes, _ := after.actionBytes()
	oldHex, newHex := hex.EncodeToString(oldBytes), hex.EncodeToString(newBytes)
	if oldHex != newHex {
		views = append(views, changeView{Setting: "action", Before: oldHex, After: newHex})
	}
	for _, view := range settingViews(current, intended) {
		if view.Setting == "lighting" || view.Setting == "colour" {
			views = append(views, view)
		}
	}
	return views
}
