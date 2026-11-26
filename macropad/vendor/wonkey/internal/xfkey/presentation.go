package xfkey

import (
	"encoding/hex"
	"fmt"
	"strings"
)

var settingOrder = []string{"key", "trigger", "modifiers", "rgb-mode", "red", "green", "blue"}

var (
	keyValues = map[string]int{
		"a": 0x04, "b": 0x05, "c": 0x06, "d": 0x07, "e": 0x08, "f": 0x09,
		"g": 0x0a, "h": 0x0b, "i": 0x0c, "j": 0x0d, "k": 0x0e, "l": 0x0f,
		"m": 0x10, "n": 0x11, "o": 0x12, "p": 0x13, "q": 0x14, "r": 0x15,
		"s": 0x16, "t": 0x17, "u": 0x18, "v": 0x19, "w": 0x1a, "x": 0x1b,
		"y": 0x1c, "z": 0x1d,
		"1": 0x1e, "2": 0x1f, "3": 0x20, "4": 0x21, "5": 0x22,
		"6": 0x23, "7": 0x24, "8": 0x25, "9": 0x26, "0": 0x27,
		"enter": 0x28, "esc": 0x29, "backspace": 0x2a, "tab": 0x2b, "space": 0x2c,
		"minus": 0x2d, "equal": 0x2e, "leftbracket": 0x2f, "rightbracket": 0x30,
		"backslash": 0x31, "nonushash": 0x32, "semicolon": 0x33, "apostrophe": 0x34,
		"grave": 0x35, "comma": 0x36, "period": 0x37, "slash": 0x38, "capslock": 0x39,
		"f1": 0x3a, "f2": 0x3b, "f3": 0x3c, "f4": 0x3d,
		"f5": 0x3e, "f6": 0x3f, "f7": 0x40, "f8": 0x41,
		"f9": 0x42, "f10": 0x43, "f11": 0x44, "f12": 0x45,
		"printscreen": 0x46, "scrolllock": 0x47, "pause": 0x48, "insert": 0x49,
		"home": 0x4a, "pageup": 0x4b, "delete": 0x4c, "end": 0x4d, "pagedown": 0x4e,
		"right": 0x4f, "left": 0x50, "down": 0x51, "up": 0x52,
		"numlock": 0x53, "keypaddivide": 0x54, "keypadmultiply": 0x55,
		"keypadminus": 0x56, "keypadplus": 0x57, "keypadenter": 0x58,
		"keypad1": 0x59, "keypad2": 0x5a, "keypad3": 0x5b, "keypad4": 0x5c,
		"keypad5": 0x5d, "keypad6": 0x5e, "keypad7": 0x5f, "keypad8": 0x60,
		"keypad9": 0x61, "keypad0": 0x62, "keypadperiod": 0x63,
		"nonusbackslash": 0x64, "application": 0x65, "power": 0x66, "keypadequal": 0x67,
		"f13": 0x68, "f14": 0x69, "f15": 0x6a, "f16": 0x6b,
		"f17": 0x6c, "f18": 0x6d, "f19": 0x6e, "f20": 0x6f,
		"f21": 0x70, "f22": 0x71, "f23": 0x72, "f24": 0x73,
		"execute": 0x74, "help": 0x75, "menu": 0x76, "select": 0x77, "stop": 0x78,
		"again": 0x79, "undo": 0x7a, "cut": 0x7b, "copy": 0x7c, "paste": 0x7d,
		"find": 0x7e, "mute": 0x7f, "volumeup": 0x80, "volumedown": 0x81,
		"lockingcapslock": 0x82, "lockingnumlock": 0x83, "lockingscrolllock": 0x84,
		"keypadcomma": 0x85, "keypadequalas400": 0x86,
		"international1": 0x87, "international2": 0x88, "international3": 0x89,
		"international4": 0x8a, "international5": 0x8b, "international6": 0x8c,
		"international7": 0x8d, "international8": 0x8e, "international9": 0x8f,
		"lang1": 0x90, "lang2": 0x91,
	}
	keyAliases = map[string]string{
		"escape": "esc", "pgup": "pageup", "pgdn": "pagedown",
		"arrowright": "right", "arrowleft": "left", "arrowdown": "down", "arrowup": "up",
	}
	mediaValues = map[string]int{
		"play": 0x00b0, "pause": 0x00b1, "record": 0x00b2,
		"fastforward": 0x00b3, "rewind": 0x00b4,
		"next": 0x00b5, "prev": 0x00b6, "previous": 0x00b6,
		"stop": 0x00b7, "eject": 0x00b8, "playpause": 0x00cd,
		"mute": 0x00e2, "volumeup": 0x00e9, "volumedown": 0x00ea,
		"calculator": 0x0192, "mycomputer": 0x0194, "browser": 0x0196, "email": 0x018a,
		"search": 0x0221, "home": 0x0223, "back": 0x0224, "forward": 0x0225,
		"refresh": 0x0227, "bookmarks": 0x022a,
	}
	triggerValues  = map[string]int{"press": 1, "release": 2, "both": 3}
	lightingValues = map[string]int{"static": 1, "breathe": 2, "cycle-slow": 0, "cycle-fast": 4, "flash": 3, "held": 6, "toggle": 7, "off": 5}
)

func canonicalKeyName(key string) string {
	key = strings.ToLower(key)
	if canonical, ok := keyAliases[key]; ok {
		return canonical
	}
	return key
}

func parseSettings(key, trigger, modifiers, lighting, colour string) (Changes, error) {
	changes := Changes{}
	if key != "" {
		value, ok := keyValues[canonicalKeyName(key)]
		if !ok {
			return nil, fmt.Errorf("invalid --key %q; use wonkey key --help for supported names", key)
		}
		changes["key"] = value
	}
	if trigger != "" {
		value, ok := triggerValues[strings.ToLower(trigger)]
		if !ok {
			return nil, fmt.Errorf("invalid --trigger %q; accepted values: press, release, both", trigger)
		}
		changes["trigger"] = value
	}
	if modifiers != "" {
		mask := 0
		seen := map[string]bool{}
		if strings.ToLower(modifiers) != "none" {
			for name := range strings.SplitSeq(strings.ToLower(modifiers), ",") {
				bit, ok := map[string]int{"ctrl": 1, "shift": 2, "alt": 4, "super": 8}[name]
				if !ok || seen[name] {
					return nil, fmt.Errorf("invalid --modifiers %q; accepted values: none or comma-separated ctrl,shift,alt,super", modifiers)
				}
				seen[name] = true
				mask |= bit
			}
		}
		changes["modifiers"] = mask
	}
	if lighting != "" {
		value, ok := lightingValues[strings.ToLower(lighting)]
		if !ok {
			return nil, fmt.Errorf("invalid --lighting %q; accepted values: static, breathe, cycle-slow, cycle-fast, flash, held, toggle, off", lighting)
		}
		changes["rgb-mode"] = value
	}
	if colour != "" {
		value := strings.TrimPrefix(colour, "#")
		if len(value) != 6 {
			return nil, fmt.Errorf("invalid --colour %q; accepted value: RRGGBB or #RRGGBB", colour)
		}
		rgb, err := hex.DecodeString(value)
		if err != nil {
			return nil, fmt.Errorf("invalid --colour %q; accepted value: RRGGBB or #RRGGBB", colour)
		}
		changes["red"], changes["green"], changes["blue"] = int(rgb[0]), int(rgb[1]), int(rgb[2])
	}
	if err := changes.validate(); err != nil {
		return nil, err
	}
	return changes, nil
}

func settingName(values map[string]int, value int) string {
	for name, candidate := range values {
		if candidate == value {
			return name
		}
	}
	return ""
}

func publicActionViews(current, intended configuration) []changeView {
	views := actionSettingViews(current, intended)
	for i := range views {
		if views[i].Setting == "action" {
			before, _ := decodeAction(current)
			after, _ := decodeAction(intended)
			views[i].Before, views[i].After = actionDescription(before), actionDescription(after)
		}
	}
	return views
}

func actionDescription(action Action) string {
	switch a := action.(type) {
	case KeyboardAction:
		key := settingName(keyValues, a.Key)
		if a.Modifiers != 0 {
			key = strings.ReplaceAll(modifierName(byte(a.Modifiers&255)), ",", "+") + "+" + key
		}
		return fmt.Sprintf("keyboard %s (%s)", key, settingName(triggerValues, a.Trigger))
	case MouseAction:
		var buttons []string
		for i, name := range []string{"left", "right", "middle"} {
			if a.Buttons&(1<<i) != 0 {
				buttons = append(buttons, name)
			}
		}
		if len(buttons) == 0 {
			buttons = append(buttons, "none")
		}
		return fmt.Sprintf("mouse %s (x=%d, y=%d, wheel=%d)", strings.Join(buttons, "+"), a.X, a.Y, a.Wheel)
	case MediaAction:
		name := settingName(mediaValues, a.Usage)
		if name == "previous" {
			name = "prev"
		}
		if name == "" {
			return fmt.Sprintf("media 0x%04x", a.Usage)
		}
		return fmt.Sprintf("media %s (0x%04x)", name, a.Usage)
	case MultiAction:
		keys := make([]string, len(a.Keys))
		for i, key := range a.Keys {
			keys[i] = settingName(keyValues, int(key))
		}
		return fmt.Sprintf("multi %s (interval=%d ms, repeat=%d)", strings.Join(keys, ","), a.Interval, a.Repeat)
	default:
		return "unsupported action"
	}
}

func modifierName(v byte) string {
	if v == 0 {
		return "none"
	}
	names := []string{}
	for _, x := range []struct {
		name string
		bit  byte
	}{{"ctrl", 1}, {"shift", 2}, {"alt", 4}, {"super", 8}} {
		if v&x.bit != 0 {
			names = append(names, x.name)
		}
	}
	return strings.Join(names, ",")
}

type changeView struct {
	Setting string `json:"setting"`
	Before  string `json:"before"`
	After   string `json:"after"`
}

func settingViews(current, intended configuration) []changeView {
	views := []changeView{}
	add := func(name, before, after string) {
		if before != after {
			views = append(views, changeView{name, before, after})
		}
	}
	add("key", settingName(keyValues, int(current[4])), settingName(keyValues, int(intended[4])))
	add("trigger", settingName(triggerValues, int(current[1])), settingName(triggerValues, int(intended[1])))
	add("modifiers", modifierName(current[2]), modifierName(intended[2]))
	add("lighting", settingName(lightingValues, int(current[124])-1), settingName(lightingValues, int(intended[124])-1))
	add("colour", fmt.Sprintf("#%02X%02X%02X", current[125], current[126], current[127]), fmt.Sprintf("#%02X%02X%02X", intended[125], intended[126], intended[127]))
	return views
}
