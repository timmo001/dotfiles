package xfkey

import (
	"cmp"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"
	"wonkey/internal/ch57"
	"wonkey/internal/sayo"
)

const publicHelp = `Inspect and configure supported macropads.

Usage: wonkey [command] [options]

Without a command, inspect all connected supported devices.

Commands:
  key [CONTROL] <COMBINATION>   Change the key.
  trigger <WHEN>                Change when the key fires.
  macro [CONTROL] <STROKE,...>  Change the macro key sequence.
  mouse [CONTROL] <BUTTONS>     Change the mouse action.
  media [CONTROL] <ACTION>      Change the media action.
  rgb <MODE> [RGB]              Change the RGB lighting.
  led <MODE>                    Change the LED backlight mode.
  firmware [check|update]       Check or update device firmware.

Options:
  --layer N                     Select layer 1..15 on multi-layer devices (default: 1).
  --device N                    Select device N when multiple devices are connected.
  --version                     Show version without device access.
  -h, --help                    Show help without device access.

Examples:
  wonkey
` + `  wonkey key f13
  wonkey key key2 ctrl+shift+f13
  wonkey trigger release
  wonkey macro ctrl+c,ctrl+v
  wonkey media knob-right volumeup
  wonkey rgb static 0000ff
  wonkey led reactive
  wonkey firmware check

Run "wonkey <command> --help" for values and options.
`

const keyHelp = `Usage: wonkey key [CONTROL] <COMBINATION> [--layer N] [--device N]

Run "wonkey" without arguments to inspect connected devices.
Controls (multi-control devices, default: key1): key1-key12, knob-left, knob-press, knob-right, knob1-left..knob4-right
A combination contains exactly one base key from the names below.
Optional modifiers precede the key: ctrl+, shift+, alt+ or super+, each at most once.
Key names ignore case. Uppercase letters do not add Shift.
Unspecified modifiers are cleared. An existing keyboard trigger is preserved.
When replacing another action, the default trigger is press.

Base keys:
  a-z, 0-9, f1-f24, enter, esc, backspace, tab, space
  minus, equal, leftbracket, rightbracket, backslash, nonushash
  semicolon, apostrophe, grave, comma, period, slash, capslock
  printscreen, scrolllock, pause, insert, home, pageup, delete, end, pagedown
  right, left, down, up, numlock
  keypad0-keypad9, keypaddivide, keypadmultiply, keypadminus, keypadplus
  keypadenter, keypadperiod, keypadequal, keypadcomma, keypadequalas400
  nonusbackslash, application, power, execute, help, menu, select, stop
  again, undo, cut, copy, paste, find, mute, volumeup, volumedown
  lockingcapslock, lockingnumlock, lockingscrolllock
  international1-international9, lang1, lang2

Aliases:
  escape=esc, pgup=pageup, pgdn=pagedown
  arrowright=right, arrowleft=left, arrowdown=down, arrowup=up

Names select HID keyboard usages, not text or consumer media commands.
Raw usage numbers, punctuation symbols and right modifiers are unsupported.
Added keys fit the captured descriptor but remain hardware-unverified.

Options:
  --layer N     Layer 1..15 on multi-layer devices (default: 1).
  --device N    Select device N when multiple devices are connected.
  -h, --help    Show help without device access.

Examples:
  wonkey key f13
  wonkey key key2 ctrl+shift+f13
`

const triggerHelp = `Usage: wonkey trigger <press|release|both> [--device N]

Run "wonkey" without arguments to inspect connected devices.
Set when the configured key fires on devices that support key triggers.
Requires the device to have a keyboard key configured.

Values:
  press      Fire when the key is pressed
  release    Fire when the key is released
  both       Fire on both press and release

Options:
  --device N   Select device N when multiple devices are connected.
  -h, --help   Show help without device access.

Examples:
  wonkey trigger press
  wonkey trigger release
`

const rgbHelp = `Usage: wonkey rgb <MODE> [RGB] [--device N]

Run "wonkey" without arguments to inspect connected devices.
RGB is six hexadecimal digits without #, for example 0000ff for blue.
Omit RGB to preserve the current colour. Key settings stay unchanged.

Modes:
  static [RGB]   Single static colour
  breathe [RGB]  Single breathing colour
  cycle-slow     Full-colour slow cycle
  cycle-fast     Full-colour fast cycle
  flash [RGB]    Flash on click
  held [RGB]     On while pressed, off on release
  toggle [RGB]   Toggle on click
  off            Lights off

Options:
  --device N    Select device N when multiple devices are connected.
  -h, --help    Show help without device access.

Examples:
  wonkey rgb static 0000ff
  wonkey rgb static
  wonkey rgb off
`

const mouseHelp = `Usage: wonkey mouse [CONTROL] <BUTTONS> [--x N] [--y N] [--wheel N] [--layer N] [--device N]

Run "wonkey" without arguments to inspect connected devices.
Controls (multi-control devices, default: key1): key1-key12, knob-left, knob-press, knob-right, knob1-left..knob4-right
Buttons: left, right, middle, none. Join buttons with +, for example left+right.
Use none alone for movement without a button, or a zero action.
Use wheelup or wheeldown alone for one wheel tick. Do not combine with --wheel.
X, Y and wheel accept -127..127. Omitted values are zero.

Options:
  --layer N     Layer 1..15 on multi-layer devices (default: 1).
  --device N    Select device N when multiple devices are connected.
  -h, --help    Show help without device access.

Examples:
  wonkey mouse left
  wonkey mouse knob1-press middle
`

const mediaHelp = `Usage: wonkey media [CONTROL] <ACTION|0xHHHH> [--layer N] [--device N]

Run "wonkey" without arguments to inspect connected devices.
Controls (multi-control devices, default: key1): key1-key12, knob-left, knob-press, knob-right, knob1-left..knob4-right
Names ignore case:
  play, pause, record, fastforward, rewind, next, prev, previous, stop, eject
  playpause, mute, volumeup, volumedown, calculator, mycomputer, browser, email
  search, home, back, forward, refresh, bookmarks
Raw usages need exactly four hexadecimal digits and must be 0x0001..0x023c.

Options:
  --layer N     Layer 1..15 on multi-layer devices (default: 1).
  --device N    Select device N when multiple devices are connected.
  -h, --help    Show help without device access.

Examples:
  wonkey media volumeup
  wonkey media knob-right volumeup
`

const macroHelp = `Usage: wonkey macro [CONTROL] <STROKE[,STROKE...]> [--interval MS] [--repeat COUNT] [--layer N] [--device N]

Run "wonkey" without arguments to inspect connected devices.
Controls (multi-control devices, default: key1): key1-key12, knob-left, knob-press, knob-right, knob1-left..knob4-right
Use 1..115 comma-separated key strokes using base key names from "wonkey key --help".
On devices that support per-stroke modifiers, prefix strokes with ctrl+, shift+, alt+ or super+.
--interval accepts 1..65535 milliseconds (default: 50).
--repeat accepts 1..255 repetitions (default: 1).

Options:
  --layer N     Layer 1..15 on multi-layer devices (default: 1).
  --device N    Select device N when multiple devices are connected.
  -h, --help    Show help without device access.

Examples:
  wonkey macro a,b,c
  wonkey macro key3 ctrl+c,ctrl+v
`

const ledHelp = `Usage: wonkey led <MODE> [--device N]

Run "wonkey" without arguments to inspect connected devices.
Configure the LED backlight mode on devices that support LED modes.

Modes:
  off        Backlight off
  reactive   Pulse the last pressed key
  cycle      Cycle all key LEDs

Options:
  --device N   Select device N when multiple devices are connected.
  -h, --help   Show help without device access.

Examples:
  wonkey led reactive
  wonkey led cycle
  wonkey led off
`

const firmwareHelp = `Usage: wonkey firmware [check|update] [--device N]

Run "wonkey" without arguments to inspect connected devices.
Check or update official vendor firmware on supported SayoDevice macropads.
Without an action, "wonkey firmware" checks for updates without modifying the device.

Actions:
  check      Query current firmware and check the vendor CDN (default)
  update     Download and install the latest official vendor firmware

Options:
  --device N   Select device N when multiple devices are connected.
  -h, --help   Show help without device access.

Examples:
  wonkey firmware
  wonkey firmware check
  wonkey firmware update
`

type publicCommand struct {
	name                       string
	control                    ch57.Control
	seenControl                bool
	layer                      int
	seenLayer                  bool
	changes                    Changes
	action                     Action
	device                     int
	ledMode                    int
	hasLED                     bool
	firmwareAction             string
	hasMultiOptions            bool
	hasMacroModifiers          bool
	hasUnsupportedCH57MacroKey bool
	macroCount                 int
	macroStrokes               []ch57.Stroke
	help                       bool
	version                    bool
}

var buildVersion = "dev"

// SetVersion records the build version injected into main.version.
func SetVersion(v string) {
	if v != "" {
		buildVersion = v
	}
}

func parseControlName(raw string) (ch57.Control, bool) {
	c := ch57.Control(strings.ToLower(raw))
	switch c {
	case ch57.Key1, ch57.Key2, ch57.Key3, ch57.Key4, ch57.Key5, ch57.Key6,
		ch57.Key7, ch57.Key8, ch57.Key9, ch57.Key10, ch57.Key11, ch57.Key12,
		ch57.KnobLeft, ch57.KnobPress, ch57.KnobRight,
		ch57.Knob1Left, ch57.Knob1Press, ch57.Knob1Right,
		ch57.Knob2Left, ch57.Knob2Press, ch57.Knob2Right,
		ch57.Knob3Left, ch57.Knob3Press, ch57.Knob3Right,
		ch57.Knob4Left, ch57.Knob4Press, ch57.Knob4Right:
		return c, true
	default:
		return "", false
	}
}

func parsePublic(args []string) (publicCommand, error) {
	c := publicCommand{control: ch57.Key1, layer: 1}
	if len(args) == 0 {
		return c, nil
	}
	if args[0] == "--help" || args[0] == "-h" {
		if len(args) != 1 {
			return c, fmt.Errorf("help accepts no other arguments")
		}
		c.help = true
		return c, nil
	}
	if args[0] == "--version" {
		if len(args) != 1 {
			return c, fmt.Errorf("version accepts no other arguments")
		}
		c.version = true
		return c, nil
	}
	if args[0] == "--layer" || strings.HasPrefix(args[0], "--layer=") {
		return c, fmt.Errorf("--layer is supported on key, macro, mouse and media only")
	}
	c.name = args[0]
	switch c.name {
	case "key", "trigger", "macro", "mouse", "media", "rgb", "led", "firmware":
	default:
		return c, fmt.Errorf("unknown command %q; use key, trigger, macro, mouse, media, rgb, led or firmware", c.name)
	}
	var positional []string
	options := map[string]int{}
	args = args[1:]
	for len(args) > 0 {
		arg := args[0]
		args = args[1:]
		switch {
		case arg == "--help" || arg == "-h":
			c.help = true
		case arg == "--layer" || strings.HasPrefix(arg, "--layer="):
			if c.name != "key" && c.name != "macro" && c.name != "mouse" && c.name != "media" {
				return c, fmt.Errorf("--layer is supported on key, macro, mouse and media only")
			}
			if c.seenLayer {
				return c, fmt.Errorf("--layer is accepted once")
			}
			var value string
			if arg == "--layer" {
				if len(args) == 0 {
					return c, fmt.Errorf("--layer needs 1..15")
				}
				value, args = args[0], args[1:]
			} else {
				value = strings.TrimPrefix(arg, "--layer=")
			}
			layer, ok := parseBoundedInt(value, 1, 15)
			if !ok {
				return c, fmt.Errorf("--layer needs 1..15")
			}
			c.layer = layer
			c.seenLayer = true
		case arg == "--device" || strings.HasPrefix(arg, "--device="):
			if c.device != 0 {
				return c, fmt.Errorf("--device is accepted once")
			}
			var value string
			if arg == "--device" {
				if len(args) == 0 {
					return c, fmt.Errorf("--device needs a positive device number")
				}
				value, args = args[0], args[1:]
			} else {
				value = strings.TrimPrefix(arg, "--device=")
			}
			device, err := parseDeviceNumber(value)
			if err != nil {
				return c, err
			}
			c.device = device
		case strings.HasPrefix(arg, "-"):
			var err error
			args, err = parseActionOption(c.name, arg, args, options)
			if err != nil {
				return c, err
			}
		default:
			positional = append(positional, arg)
		}
	}
	return c.parsePositionals(positional, options)
}

func parseDeviceNumber(value string) (int, error) {
	if len(value) == 0 || value[0] < '1' || value[0] > '9' {
		return 0, fmt.Errorf("--device needs a positive device number")
	}
	for i := 1; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			return 0, fmt.Errorf("--device needs a positive device number")
		}
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("--device needs a positive device number")
	}
	return n, nil
}

func parseBoundedInt(value string, min, max int) (int, bool) {
	if len(value) == 0 || (len(value) > 1 && value[0] == '0') {
		return 0, false
	}
	for i := 0; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < min || n > max {
		return 0, false
	}
	return n, true
}

func missingCommandValueError(name string) error {
	switch name {
	case "key":
		return fmt.Errorf("key requires a key combination, for example \"wonkey key f13\"; run \"wonkey key --help\" for supported keys")
	case "trigger":
		return fmt.Errorf("trigger requires press, release or both, for example \"wonkey trigger release\"; run \"wonkey trigger --help\" for values")
	case "macro":
		return fmt.Errorf("macro requires a comma-separated key list, for example \"wonkey macro ctrl+c,ctrl+v\" or \"wonkey macro a,b,c\"; run \"wonkey macro --help\" for options")
	case "mouse":
		return fmt.Errorf("mouse requires buttons or wheel direction, for example \"wonkey mouse left\"; run \"wonkey mouse --help\" for options")
	case "media":
		return fmt.Errorf("media requires a media action, for example \"wonkey media volumeup\"; run \"wonkey media --help\" for actions")
	case "led":
		return fmt.Errorf("led requires a mode, for example \"wonkey led reactive\" or \"wonkey led off\"; run \"wonkey led --help\" for modes")
	default:
		return fmt.Errorf("rgb requires a lighting mode, for example \"wonkey rgb static 0000ff\" or \"wonkey rgb off\"; run \"wonkey rgb --help\" for modes")
	}
}

func (c publicCommand) parsePositionals(positional []string, options map[string]int) (publicCommand, error) {
	if c.name == "firmware" {
		return c.parseFirmware(positional, options)
	}
	if (c.name == "key" || c.name == "macro" || c.name == "mouse" || c.name == "media") && len(positional) > 0 {
		if control, ok := parseControlName(positional[0]); ok {
			c.control = control
			c.seenControl = true
			positional = positional[1:]
			if len(positional) == 0 {
				return c, missingCommandValueError(c.name)
			}
		}
	}
	if len(positional) == 0 {
		if c.device > 0 {
			return c, fmt.Errorf("--device requires a command value")
		}
		if c.seenLayer {
			return c, fmt.Errorf("--layer requires a command value")
		}
		if len(options) > 0 {
			return c, fmt.Errorf("%s options require an action", c.name)
		}
		if c.help {
			return c, nil
		}
		return c, missingCommandValueError(c.name)
	}
	if c.name == "mouse" || c.name == "media" || c.name == "macro" {
		return c.parseAction(positional, options)
	}
	return c.parseValues(positional, options)
}

func (c publicCommand) parseFirmware(positional []string, options map[string]int) (publicCommand, error) {
	if len(options) > 0 {
		return c, fmt.Errorf("firmware accepts no action options")
	}
	if len(positional) == 0 {
		if c.help && c.device > 0 {
			return c, fmt.Errorf("--device requires a command value")
		}
		c.firmwareAction = "check"
		return c, nil
	}
	if len(positional) > 1 {
		return c, fmt.Errorf("firmware accepts at most one action: check or update")
	}
	action := strings.ToLower(positional[0])
	switch action {
	case "check", "update":
		c.firmwareAction = action
		return c, nil
	default:
		return c, fmt.Errorf("invalid firmware action %q; use check or update", positional[0])
	}
}

func parseActionOption(command, arg string, args []string, options map[string]int) ([]string, error) {
	option, value, equals := strings.Cut(arg, "=")
	min, max := -127, 127
	switch {
	case command == "mouse" && (option == "--x" || option == "--y" || option == "--wheel"):
	case command == "macro" && option == "--interval":
		min, max = 1, 65535
	case command == "macro" && option == "--repeat":
		min, max = 1, 255
	default:
		return args, fmt.Errorf("unknown option %q", arg)
	}
	if _, seen := options[option]; seen {
		return args, fmt.Errorf("%s is accepted once", option)
	}
	if !equals && len(args) > 0 {
		value, args = args[0], args[1:]
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < min || n > max {
		return args, fmt.Errorf("%s needs an integer from %d to %d", option, min, max)
	}
	options[option] = n
	return args, nil
}

func parseMacroStroke(stroke string) (ch57.Stroke, error) {
	if stroke == "" {
		return ch57.Stroke{}, fmt.Errorf("unsupported macro key %q; use wonkey key --help", stroke)
	}
	parts := strings.Split(stroke, "+")
	seen := map[string]bool{}
	modifiers := 0
	for i, part := range parts {
		bit, isMod := map[string]int{"ctrl": 1, "shift": 2, "alt": 4, "super": 8}[part]
		if isMod {
			if seen[part] {
				return ch57.Stroke{}, fmt.Errorf("invalid modifier %q", part)
			}
			seen[part] = true
			modifiers |= bit
			continue
		}
		if i != len(parts)-1 {
			return ch57.Stroke{}, fmt.Errorf("invalid modifier %q", part)
		}
		code, ok := keyValues[canonicalKeyName(part)]
		if !ok {
			return ch57.Stroke{}, fmt.Errorf("unsupported macro key %q; use wonkey key --help", stroke)
		}
		return ch57.Stroke{Modifiers: modifiers, Usage: code}, nil
	}
	return ch57.Stroke{Modifiers: modifiers, Usage: 0}, nil
}

func (c publicCommand) parseAction(positional []string, options map[string]int) (publicCommand, error) {
	if len(positional) != 1 {
		return c, fmt.Errorf("%s accepts one action", c.name)
	}
	value := strings.ToLower(positional[0])
	switch c.name {
	case "mouse":
		a := MouseAction{X: options["--x"], Y: options["--y"], Wheel: options["--wheel"]}
		switch value {
		case "wheelup", "wheeldown":
			if _, present := options["--wheel"]; present {
				return c, fmt.Errorf("%s cannot be combined with --wheel", value)
			}
			a.Wheel = 1
			if value == "wheeldown" {
				a.Wheel = -1
			}
		case "none":
		default:
			for button := range strings.SplitSeq(value, "+") {
				bit := map[string]int{"left": 1, "right": 2, "middle": 4}[button]
				if bit == 0 || a.Buttons&bit != 0 {
					return c, fmt.Errorf("invalid or repeated mouse button %q; use left, right, middle or none", button)
				}
				a.Buttons |= bit
			}
		}
		c.action = a
	case "media":
		usage, ok := mediaValues[value]
		if !ok && len(value) == 6 && strings.HasPrefix(value, "0x") {
			b, err := hex.DecodeString(value[2:])
			if err == nil {
				usage, ok = int(b[0])<<8|int(b[1]), true
			}
		}
		if !ok {
			return c, fmt.Errorf("unsupported media action %q; use wonkey media --help", value)
		}
		c.action = MediaAction{Usage: usage}
	case "macro":
		c.hasMultiOptions = len(options) > 0
		a := MultiAction{Interval: 50, Repeat: 1}
		if n, present := options["--interval"]; present {
			a.Interval = n
		}
		if n, present := options["--repeat"]; present {
			a.Repeat = n
		}
		strokes := strings.Split(value, ",")
		if len(strokes) > 115 {
			return c, fmt.Errorf("macro accepts 1..115 comma-separated keys")
		}
		c.macroCount = len(strokes)
		for _, raw := range strokes {
			stroke, err := parseMacroStroke(raw)
			if err != nil {
				return c, err
			}
			c.macroStrokes = append(c.macroStrokes, stroke)
			if stroke.Modifiers != 0 || stroke.Usage == 0 {
				c.hasMacroModifiers = true
			}
			if stroke.Usage != 0 && (stroke.Usage < 0x04 || stroke.Usage > 0x73) {
				c.hasUnsupportedCH57MacroKey = true
			}
			if !c.hasMacroModifiers {
				a.Keys = append(a.Keys, byte(stroke.Usage&255))
			}
		}
		if c.hasMacroModifiers {
			return c, nil
		}
		c.action = a
	}
	_, err := c.action.actionBytes()
	return c, err
}

func (c publicCommand) parseValues(positional []string, options map[string]int) (publicCommand, error) {
	var err error
	switch c.name {
	case "key":
		if len(options) > 0 {
			return c, fmt.Errorf("key accepts no action options")
		}
		if len(positional) != 1 {
			return c, fmt.Errorf("key accepts one complete combination")
		}
		parts := strings.Split(strings.ToLower(positional[0]), "+")
		parts[len(parts)-1] = canonicalKeyName(parts[len(parts)-1])
		if _, ok := keyValues[parts[len(parts)-1]]; !ok {
			return c, fmt.Errorf("unsupported key %q; use wonkey key --help for supported names", parts[len(parts)-1])
		}
		modifiers := "none"
		if len(parts) > 1 {
			for _, p := range parts[:len(parts)-1] {
				if p != "ctrl" && p != "shift" && p != "alt" && p != "super" {
					return c, fmt.Errorf("invalid modifier %q", p)
				}
			}
			modifiers = strings.Join(parts[:len(parts)-1], ",")
		}
		c.changes, err = parseSettings(parts[len(parts)-1], "", modifiers, "", "")
	case "trigger":
		if len(options) > 0 {
			return c, fmt.Errorf("trigger accepts no action options")
		}
		if len(positional) != 1 {
			return c, fmt.Errorf("trigger requires exactly one value: press, release or both")
		}
		value, ok := triggerValues[strings.ToLower(positional[0])]
		if !ok {
			return c, fmt.Errorf("trigger needs press, release or both")
		}
		c.changes = Changes{"trigger": value}
		return c, nil
	case "led":
		if len(options) > 0 {
			return c, fmt.Errorf("led accepts no action options")
		}
		if len(positional) != 1 {
			return c, fmt.Errorf("led accepts one mode argument, not RGB colours; use \"wonkey rgb\" on RGB devices")
		}
		switch strings.ToLower(positional[0]) {
		case "off":
			c.ledMode = 0
		case "reactive":
			c.ledMode = 1
		case "cycle":
			c.ledMode = 2
		default:
			return c, fmt.Errorf("invalid led mode %q; use off, reactive or cycle", positional[0])
		}
		c.hasLED = true
		return c, nil
	default:
		if len(positional) > 2 {
			return c, fmt.Errorf("rgb accepts a mode and optional six-digit colour")
		}
		mode := strings.ToLower(positional[0])
		if _, ok := lightingValues[mode]; !ok {
			return c, fmt.Errorf("unknown RGB mode %q", positional[0])
		}
		colour := ""
		if len(positional) == 2 {
			if mode == "cycle-slow" || mode == "cycle-fast" || mode == "off" {
				return c, fmt.Errorf("RGB mode %q does not use a colour; omit RGB", mode)
			}
			colour = positional[1]
			if len(colour) != 6 {
				return c, fmt.Errorf("RGB needs exactly six hexadecimal digits")
			}
		}
		c.changes, err = parseSettings("", "", "", positional[0], colour)
	}
	if err != nil {
		return c, fmt.Errorf("invalid %s value: %s", c.name, strings.ReplaceAll(err.Error(), "--", ""))
	}
	return c, nil
}

type publicAccess struct {
	discoverCH57      func(string) ([]ch57.DiscoveredCandidate, error)
	probeCH57         func(string, string, ch57.DiscoveredCandidate) (ch57.ProbeResult, error)
	applyCH57         func(string, string, ch57.DiscoveredCandidate, []ch57.Report) (ch57.ApplyResult, error)
	discoverSayo      func(string) ([]sayo.DiscoveredCandidate, error)
	probeSayo         func(string, string, sayo.DiscoveredCandidate) (sayo.ProbeResult, error)
	applySayo         func(string, string, sayo.DiscoveredCandidate, sayo.WriteRequest) (sayo.ApplyResult, error)
	fetchSayoManifest func(uint16) (sayo.FirmwareManifest, error)
	fetchSayoBinary   func(uint16, string) ([]byte, error)
	flashSayoFirmware func(string, string, sayo.DiscoveredCandidate, sayo.ProtocolVersion, bool, sayo.FirmwareManifest, sayo.FirmwareManifestEntry, []byte, sayo.FirmwareProgressFunc) (sayo.ApplyResult, error)
	waitSayoRestart   func(string, string, sayo.DiscoveredCandidate) sayo.RestartResult
	querySayoVersion  func(string, string, sayo.DiscoveredCandidate) (sayo.FirmwareInfo, error)
	discover          func() ([]Candidate, error)
	query             func(Candidate) (CaptureResult, error)
	apply             func(Candidate, ApplyTarget, configurationChanges, func(configuration, configuration) (bool, error)) (ApplyResult, error)
}

func publicDeviceAccess() publicAccess {
	return publicAccess{
		discoverCH57: func(sysRoot string) ([]ch57.DiscoveredCandidate, error) {
			if reflect.ValueOf(liveDiscover).Pointer() != reflect.ValueOf(discover).Pointer() {
				return nil, nil
			}
			return ch57.DiscoverCandidates(sysRoot)
		},
		probeCH57: ch57.ProbeCandidate,
		applyCH57: ch57.ApplyCandidate,
		discoverSayo: func(sysRoot string) ([]sayo.DiscoveredCandidate, error) {
			if reflect.ValueOf(liveDiscover).Pointer() != reflect.ValueOf(discover).Pointer() {
				return nil, nil
			}
			return sayo.DiscoverCandidates(sysRoot)
		},
		probeSayo:         sayo.ProbeCandidate,
		applySayo:         sayo.ApplyCandidate,
		fetchSayoManifest: sayo.FetchFirmwareManifest,
		fetchSayoBinary:   sayo.FetchFirmwareBinary,
		flashSayoFirmware: sayo.FlashFirmware,
		waitSayoRestart:   sayo.WaitForApplication,
		querySayoVersion:  sayo.QueryFirmwareVersion,
		discover:          func() ([]Candidate, error) { return liveDiscover("/sys/bus/usb/devices", "/dev") },
		query:             func(selected Candidate) (CaptureResult, error) { return querySelected(selected, true) },
		apply: func(selected Candidate, target ApplyTarget, changes configurationChanges, guard func(configuration, configuration) (bool, error)) (ApplyResult, error) {
			return liveApplyBound(selected.PhysicalPath, target, changes, true, guard, &selected, true)
		},
	}
}

func Run(args []string, stdout, stderr io.Writer) error {
	return RunIO(args, strings.NewReader(""), stdout, stderr)
}

func RunIO(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	return runPublic(args, &cliRuntime{stdin, stdout, stderr}, publicDeviceAccess())
}

func runPublic(args []string, rt *cliRuntime, access publicAccess) error {
	c, err := parsePublic(args)
	if err == nil && c.version {
		if _, writeErr := fmt.Fprintf(rt.out, "wonkey %s\n", buildVersion); writeErr != nil {
			return &CLIError{Err: writeErr, Code: 1}
		}
		return nil
	}
	code := 2
	out := rt.errOut
	if err == nil {
		code = 1
		out = rt.out
	}
	h := newHuman(out)
	h.header()
	if h.out.err != nil {
		return &CLIError{Err: h.out.err, Code: code}
	}
	if err == nil {
		if c.help {
			text := publicHelp
			switch c.name {
			case "key":
				text = keyHelp
			case "trigger":
				text = triggerHelp
			case "macro":
				text = macroHelp
			case "mouse":
				text = mouseHelp
			case "media":
				text = mediaHelp
			case "rgb":
				text = rgbHelp
			case "led":
				text = ledHelp
			case "firmware":
				text = firmwareHelp
			}
			return printHumanHelp(rt.out, text)
		}
		err = c.run(rt, access)
	}
	if err != nil {
		errH := newHuman(rt.errOut)
		lines := strings.Split(err.Error(), "\n")
		if len(lines) == 1 {
			errH.line("31", "Error: "+lines[0]+".")
		} else {
			errH.line("31", "Error: "+lines[0])
			for _, line := range lines[1:] {
				fmt.Fprintln(errH.out, escapeHuman(line))
			}
		}
		fmt.Fprintln(rt.errOut, `Run "wonkey --help" for commands.`)
		return &CLIError{Err: err, Code: code}
	}
	return nil
}

func comparePhysicalPath(a, b string) int {
	split := func(r rune) bool { return r == '-' || r == '.' }
	sa, sb := strings.FieldsFunc(a, split), strings.FieldsFunc(b, split)
	for i := range min(len(sa), len(sb)) {
		na, errA := strconv.Atoi(sa[i])
		nb, errB := strconv.Atoi(sb[i])
		switch {
		case errA == nil && errB == nil:
			if c := cmp.Compare(na, nb); c != 0 {
				return c
			}
			if c := strings.Compare(sa[i], sb[i]); c != 0 {
				return c
			}
		case errA == nil:
			return -1
		case errB == nil:
			return 1
		default:
			if c := strings.Compare(sa[i], sb[i]); c != 0 {
				return c
			}
		}
	}
	if c := cmp.Compare(len(sa), len(sb)); c != 0 {
		return c
	}
	return strings.Compare(a, b)
}

func compatibleCandidates(candidates []Candidate) []Candidate {
	var matches []Candidate
	for _, candidate := range candidates {
		if candidate.Compatible {
			matches = append(matches, candidate)
		}
	}
	slices.SortFunc(matches, func(a, b Candidate) int {
		return comparePhysicalPath(a.PhysicalPath, b.PhysicalPath)
	})
	return matches
}

func (c publicCommand) selectWriteDevice(matches []Candidate) (Candidate, int, error) {
	if c.device == 0 {
		if len(matches) == 1 {
			return matches[0], 1, nil
		}
		var b strings.Builder
		b.WriteString("multiple compatible devices connected; specify --device <N>:")
		for i, m := range matches {
			product := m.Product
			if product == "" {
				product = "XFKEY One Key Max (0112)"
			}
			fmt.Fprintf(&b, "\n  --device %d  %s (USB path %s)", i+1, product, m.PhysicalPath)
		}
		return Candidate{}, 0, errors.New(b.String())
	}
	if c.device > len(matches) {
		return Candidate{}, 0, fmt.Errorf("device %d not found (%d compatible device(s) connected)", c.device, len(matches))
	}
	return matches[c.device-1], c.device, nil
}

func (c publicCommand) isReadOnly() bool {
	return c.name == "" && len(c.changes) == 0 && c.action == nil && !c.hasLED && !c.hasMacroModifiers
}

func (c publicCommand) run(rt *cliRuntime, access publicAccess) error {
	h := newHuman(rt.out)
	const sysRoot, devRoot = "/sys/bus/usb/devices", "/dev/bus/usb"
	var candidates []Candidate
	if access.discover != nil {
		var err error
		candidates, err = access.discover()
		if err != nil {
			return err
		}
	}
	var chCandidates []ch57.DiscoveredCandidate
	if access.discoverCH57 != nil {
		var err error
		chCandidates, err = access.discoverCH57(sysRoot)
		if err != nil {
			return err
		}
	}
	byCH57Path := make(map[string]ch57.DiscoveredCandidate, len(chCandidates))
	for _, candidate := range chCandidates {
		candidates = append(candidates, Candidate{
			PhysicalPath: candidate.PhysicalPath, Product: ch57ProductName(candidate), Compatible: true,
			VendorNode: NodeMetadata{Path: fmt.Sprintf("%s/%03d/%03d", devRoot, candidate.BusNumber, candidate.DeviceNumber)},
		})
		byCH57Path[candidate.PhysicalPath] = candidate
	}
	var sayoCandidates []sayo.DiscoveredCandidate
	if access.discoverSayo != nil {
		var err error
		sayoCandidates, err = access.discoverSayo(sysRoot)
		if err != nil {
			return err
		}
	}
	bySayoPath := make(map[string]sayo.DiscoveredCandidate, len(sayoCandidates))
	for _, candidate := range sayoCandidates {
		candidates = append(candidates, Candidate{
			PhysicalPath: candidate.PhysicalPath, Product: sayoProductName(candidate), Compatible: true,
			VendorNode: NodeMetadata{Path: fmt.Sprintf("%s/%03d/%03d", devRoot, candidate.BusNumber, candidate.DeviceNumber)},
		})
		bySayoPath[candidate.PhysicalPath] = candidate
	}
	matches := compatibleCandidates(candidates)
	if len(matches) == 0 {
		return fmt.Errorf("no compatible device found")
	}
	if c.isReadOnly() {
		return c.runReadAll(matches, byCH57Path, bySayoPath, h, access)
	}
	selected, deviceID, err := c.selectWriteDevice(matches)
	if err != nil {
		return err
	}
	if sayoSelected, ok := bySayoPath[selected.PhysicalPath]; ok {
		if err := c.checkSayoCapabilitiesFor(sayoSelected); err != nil {
			return err
		}
		if c.name == "firmware" {
			return c.runSayoFirmware(sayoSelected, deviceID, h, access)
		}
		return c.runSayoWrite(sayoSelected, deviceID, h, access)
	}
	if chSelected, ok := byCH57Path[selected.PhysicalPath]; ok {
		if err := c.checkCH57CapabilitiesFor(chSelected); err != nil {
			return err
		}
		return c.runCH57Write(chSelected, deviceID, h, access)
	}
	if err := c.checkXFKEYCapabilities(); err != nil {
		return err
	}
	return c.runXFKEYSelected(selected, deviceID, h, access)
}

func (c publicCommand) checkXFKEYCapabilities() error {
	if c.seenLayer {
		return fmt.Errorf("XFKEY One Key Max (0112) does not support --layer")
	}
	if c.seenControl && c.control != ch57.Key1 {
		return fmt.Errorf("XFKEY One Key Max (0112) has a single key and does not support %s", c.control)
	}
	switch c.name {
	case "firmware":
		return fmt.Errorf("XFKEY One Key Max (0112) does not support firmware updates")
	case "led":
		return fmt.Errorf("XFKEY One Key Max (0112) does not support led; use \"wonkey rgb\" instead")
	case "macro":
		if c.hasMacroModifiers {
			return fmt.Errorf("XFKEY One Key Max (0112) does not support modifiers in macro sequences; use base key names only")
		}
	}
	return nil
}

func ch57VIDPID(candidate ch57.DiscoveredCandidate) (uint16, uint16) {
	if candidate.VID == 0 && candidate.PID == 0 {
		return 0x1189, 0x8890
	}
	return candidate.VID, candidate.PID
}

func sayoVIDPID(candidate sayo.DiscoveredCandidate) (uint16, uint16) {
	if candidate.VID == 0 && candidate.PID == 0 {
		return 0x8089, 0x000c
	}
	return candidate.VID, candidate.PID
}

func sayoBaseProductName(candidate sayo.DiscoveredCandidate) string {
	if candidate.ProductName != "" {
		return candidate.ProductName
	}
	if candidate.PID == 0x000c || (candidate.VID == 0 && candidate.PID == 0) {
		return "SayoDevice 2x3P"
	}
	return "SayoDevice"
}

func sayoProductName(candidate sayo.DiscoveredCandidate) string {
	vid, pid := sayoVIDPID(candidate)
	return fmt.Sprintf("%s (%04x:%04x)", sayoBaseProductName(candidate), vid, pid)
}

func ch57ProductName(candidate ch57.DiscoveredCandidate) string {
	vid, pid := ch57VIDPID(candidate)
	return fmt.Sprintf("CH57x Macropad (%04x:%04x)", vid, pid)
}

func ch57SupportsSummary(_ ch57.DiscoveredCandidate) string {
	return "key, mouse, media, macro, led"
}

func sayoSupportsSummary() string {
	return "key, mouse, media, macro, rgb, firmware"
}

func controlKeyAndKnobIndex(control ch57.Control) (int, int) {
	switch control {
	case ch57.Key1:
		return 1, 0
	case ch57.Key2:
		return 2, 0
	case ch57.Key3:
		return 3, 0
	case ch57.Key4:
		return 4, 0
	case ch57.Key5:
		return 5, 0
	case ch57.Key6:
		return 6, 0
	case ch57.Key7:
		return 7, 0
	case ch57.Key8:
		return 8, 0
	case ch57.Key9:
		return 9, 0
	case ch57.Key10:
		return 10, 0
	case ch57.Key11:
		return 11, 0
	case ch57.Key12:
		return 12, 0
	case ch57.KnobLeft, ch57.KnobPress, ch57.KnobRight, ch57.Knob1Left, ch57.Knob1Press, ch57.Knob1Right:
		return 0, 1
	case ch57.Knob2Left, ch57.Knob2Press, ch57.Knob2Right:
		return 0, 2
	case ch57.Knob3Left, ch57.Knob3Press, ch57.Knob3Right:
		return 0, 3
	case ch57.Knob4Left, ch57.Knob4Press, ch57.Knob4Right:
		return 0, 4
	default:
		return 0, 0
	}
}

func validateCH57Control(product string, keys, knobs int, control ch57.Control) error {
	k, m := controlKeyAndKnobIndex(control)
	if k > keys {
		return fmt.Errorf("%s has %d keys; %s is not available", product, keys, control)
	}
	if m > knobs {
		if knobs == 0 {
			return fmt.Errorf("%s has 0 knobs; %s is not available", product, control)
		}
		return fmt.Errorf("%s has %d knob(s); %s is not available", product, knobs, control)
	}
	return nil
}

func (c publicCommand) checkCH57Capabilities() error {
	return c.checkCH57CapabilitiesFor(ch57.DiscoveredCandidate{})
}

func (c publicCommand) checkCH57CapabilitiesFor(selected ch57.DiscoveredCandidate) error {
	vid, pid := ch57VIDPID(selected)
	product := ch57ProductName(selected)
	switch c.name {
	case "key", "macro", "mouse", "media":
		if _, ok := parseControlName(string(c.control)); !ok {
			return fmt.Errorf("%s does not support control %q", product, c.control)
		}
		if ch57.IsK8890Family(vid, pid) {
			if err := validateCH57Control(product, 12, 3, c.control); err != nil {
				return err
			}
		}
		if c.layer < 1 || c.layer > 15 {
			return fmt.Errorf("%s supports layers 1..15 only", product)
		}
	}
	switch c.name {
	case "firmware":
		return fmt.Errorf("%s does not support firmware updates", product)
	case "trigger":
		return fmt.Errorf("%s does not support trigger (key release triggers)", product)
	case "rgb":
		return fmt.Errorf("%s does not support rgb; use \"wonkey led\" instead", product)
	case "key":
		if c.changes["key"] < 0x04 || c.changes["key"] > 0x73 {
			return fmt.Errorf("%s supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only", product)
		}
	case "macro":
		if c.hasMultiOptions {
			return fmt.Errorf("%s does not support --interval or --repeat", product)
		}
		if c.macroCount > 5 {
			return fmt.Errorf("%s supports up to 5 strokes per macro", product)
		}
		if c.hasUnsupportedCH57MacroKey {
			return fmt.Errorf("%s supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only", product)
		}
	case "mouse":
		if mouse, ok := c.action.(MouseAction); ok {
			if _, err := ch57MouseEventFor(product, mouse); err != nil {
				return err
			}
		}
	case "media":
		if media, ok := c.action.(MediaAction); ok {
			switch ch57.MediaUsage(media.Usage) {
			case ch57.MediaScreenBrightnessUp, ch57.MediaScreenBrightnessDown,
				ch57.MediaNext, ch57.MediaPrevious, ch57.MediaStop, ch57.MediaPlay, ch57.MediaMute,
				ch57.MediaVolumeUp, ch57.MediaVolumeDown, ch57.MediaFavorites, ch57.MediaCalculator, ch57.MediaScreenLock,
				ch57.MediaWebPageHome, ch57.MediaWebPageBack, ch57.MediaWebPageForward:
			default:
				return fmt.Errorf("%s does not support that media action", product)
			}
		}
	}
	return nil
}

func (c publicCommand) checkSayoCapabilitiesFor(selected sayo.DiscoveredCandidate) error {
	product := sayoProductName(selected)
	switch c.name {
	case "key", "macro", "mouse", "media":
		if _, ok := parseControlName(string(c.control)); !ok {
			return fmt.Errorf("%s does not support control %q", product, c.control)
		}
		if c.layer < 1 || c.layer > 5 {
			return fmt.Errorf("%s supports layers 1..5 only", product)
		}
	}
	switch c.name {
	case "trigger":
		return fmt.Errorf("%s does not support trigger (key release triggers)", product)
	case "led":
		return fmt.Errorf("%s does not support led; use \"wonkey rgb\" instead", product)
	case "rgb":
		mode := settingName(lightingValues, c.changes["rgb-mode"])
		if mode == "toggle" {
			return fmt.Errorf("%s does not support RGB mode %q", product, mode)
		}
	case "key":
		if c.changes["key"] < 0x04 || c.changes["key"] > 0x73 {
			return fmt.Errorf("%s supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only", product)
		}
	case "macro":
		if c.hasMultiOptions {
			return fmt.Errorf("%s does not support --interval or --repeat", product)
		}
		if c.macroCount > 3 {
			return fmt.Errorf("%s supports up to 3 strokes per macro", product)
		}
		if c.macroCount == 3 && (c.macroStrokes[1].Modifiers != 0 || c.macroStrokes[2].Modifiers != 0) {
			return fmt.Errorf("%s does not support modifiers on strokes 2..3 of a 3-stroke macro", product)
		}
		if c.hasUnsupportedCH57MacroKey {
			return fmt.Errorf("%s supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only", product)
		}
	case "mouse":
		if mouse, ok := c.action.(MouseAction); ok {
			if _, err := ch57MouseEventFor(product, mouse); err != nil {
				return err
			}
		}
	case "media":
		if media, ok := c.action.(MediaAction); ok {
			if _, ok := sayo.MediaCode(sayo.MediaUsage(media.Usage & 0xffff)); !ok {
				return fmt.Errorf("%s does not support that media action", product)
			}
		}
	}
	return nil
}

func ch57MouseEvent(a MouseAction) (ch57.MouseEvent, error) {
	return ch57MouseEventFor("CH57x Macropad (1189:8890)", a)
}

func ch57MouseEventFor(product string, a MouseAction) (ch57.MouseEvent, error) {
	switch {
	case a.Wheel != 0 && a.Buttons == 0 && a.X == 0 && a.Y == 0:
		return ch57.MouseEvent{Action: ch57.MouseWheel, Wheel: a.Wheel}, nil
	case a.Wheel != 0:
		return ch57.MouseEvent{}, fmt.Errorf("%s does not combine mouse wheel with buttons or movement", product)
	case a.Buttons != 0 && (a.X != 0 || a.Y != 0):
		return ch57.MouseEvent{Action: ch57.MouseDrag, Buttons: ch57.MouseButtons(a.Buttons), DX: a.X, DY: a.Y}, nil
	case a.Buttons != 0:
		return ch57.MouseEvent{Action: ch57.MouseClick, Buttons: ch57.MouseButtons(a.Buttons)}, nil
	case a.X != 0 || a.Y != 0:
		return ch57.MouseEvent{Action: ch57.MouseMove, DX: a.X, DY: a.Y}, nil
	default:
		return ch57.MouseEvent{}, fmt.Errorf("%s mouse action requires buttons, movement or wheel", product)
	}
}

func formatCH57Stroke(stroke ch57.Stroke) string {
	mods := strings.ReplaceAll(modifierName(byte(stroke.Modifiers&255)), ",", "+")
	if stroke.Usage == 0 {
		return mods
	}
	key := settingName(keyValues, stroke.Usage)
	if key == "" {
		key = fmt.Sprintf("0x%02x", stroke.Usage)
	}
	if stroke.Modifiers != 0 {
		return mods + "+" + key
	}
	return key
}

func formatCH57SlotBinding(b ch57.SlotBinding) string {
	switch b.ActionType {
	case ch57.SlotActionKeyboard, ch57.SlotActionMacro:
		if len(b.Strokes) == 0 {
			return "none"
		}
		parts := make([]string, len(b.Strokes))
		for i, stroke := range b.Strokes {
			parts[i] = formatCH57Stroke(stroke)
		}
		return strings.Join(parts, ",")
	case ch57.SlotActionMedia:
		if b.MediaUsage == 0 {
			return "none"
		}
		return actionDescription(MediaAction{Usage: int(b.MediaUsage)})
	case ch57.SlotActionMouse:
		return actionDescription(MouseAction{
			Buttons: int(b.Mouse.Buttons),
			X:       b.Mouse.DX,
			Y:       b.Mouse.DY,
			Wheel:   b.Mouse.Wheel,
		})
	default:
		return "none"
	}
}

func formatSayoSlotBinding(b sayo.SlotBinding) string {
	switch b.ActionType {
	case sayo.SlotActionKeyboard, sayo.SlotActionMacro:
		if len(b.Strokes) == 0 {
			return "none"
		}
		parts := make([]string, len(b.Strokes))
		for i, stroke := range b.Strokes {
			parts[i] = formatCH57Stroke(ch57.Stroke{Modifiers: stroke.Modifiers, Usage: stroke.Usage})
		}
		return strings.Join(parts, ",")
	case sayo.SlotActionMedia:
		if b.MediaUsage == 0 {
			return "none"
		}
		return actionDescription(MediaAction{Usage: int(b.MediaUsage)})
	case sayo.SlotActionMouse:
		return actionDescription(MouseAction{
			Buttons: int(b.Mouse.Buttons),
			X:       b.Mouse.DX,
			Y:       b.Mouse.DY,
			Wheel:   b.Mouse.Wheel,
		})
	default:
		return "none"
	}
}

func formatLayoutSummary(keys, knobs int) string {
	keyWord := "keys"
	if keys == 1 {
		keyWord = "key"
	}
	if knobs == 0 {
		return fmt.Sprintf("%d %s", keys, keyWord)
	}
	knobWord := "knobs"
	if knobs == 1 {
		knobWord = "knob"
	}
	return fmt.Sprintf("%d %s, %d %s", keys, keyWord, knobs, knobWord)
}

func k884xLEDModeByte(ledMode int) int {
	switch ledMode {
	case 1:
		return 4
	case 2:
		return 1
	default:
		return 0
	}
}

func (c publicCommand) encodeCH57ReportsWithProfile(profile ch57.Profile, before string) ([]ch57.Report, []changeView, error) {
	setting := string(c.control)
	if c.layer > 1 {
		setting = fmt.Sprintf("%s (layer %d)", c.control, c.layer)
	}
	switch c.name {
	case "key":
		stroke := ch57.Stroke{Modifiers: c.changes["modifiers"], Usage: c.changes["key"]}
		reports, err := ch57.EncodeKeyboard(profile, c.control, []ch57.Stroke{stroke})
		if err != nil {
			return nil, nil, err
		}
		return reports, []changeView{{Setting: setting, Before: before, After: formatCH57Stroke(stroke)}}, nil
	case "macro":
		reports, err := ch57.EncodeKeyboard(profile, c.control, c.macroStrokes)
		if err != nil {
			return nil, nil, err
		}
		formatted := make([]string, len(c.macroStrokes))
		for i, stroke := range c.macroStrokes {
			formatted[i] = formatCH57Stroke(stroke)
		}
		return reports, []changeView{{Setting: setting, Before: before, After: strings.Join(formatted, ",")}}, nil
	case "mouse":
		mouse, ok := c.action.(MouseAction)
		if !ok {
			return nil, nil, fmt.Errorf("invalid mouse action")
		}
		event, err := ch57MouseEvent(mouse)
		if err != nil {
			return nil, nil, err
		}
		reports, err := ch57.EncodeMouse(profile, c.control, event)
		if err != nil {
			return nil, nil, err
		}
		return reports, []changeView{{Setting: setting, Before: before, After: actionDescription(c.action)}}, nil
	case "media":
		media, ok := c.action.(MediaAction)
		if !ok {
			return nil, nil, fmt.Errorf("invalid media action")
		}
		reports, err := ch57.EncodeMedia(profile, c.control, ch57.MediaUsage(media.Usage))
		if err != nil {
			return nil, nil, err
		}
		return reports, []changeView{{Setting: setting, Before: before, After: actionDescription(c.action)}}, nil
	case "led":
		wireMode := c.ledMode
		if ch57.IsK884xFamily(profile.VID, profile.PID) {
			wireMode = k884xLEDModeByte(c.ledMode)
		}
		reports, err := ch57.EncodeLED(profile, wireMode)
		if err != nil {
			return nil, nil, err
		}
		after := "off"
		switch c.ledMode {
		case 1:
			after = "reactive"
		case 2:
			after = "cycle"
		}
		return reports, []changeView{{Setting: "led", Before: "write-only", After: after}}, nil
	default:
		return nil, nil, fmt.Errorf("unsupported CH57 command %q", c.name)
	}
}

func default514CLayout(pid uint16) (int, int, int) {
	if pid == 0x8850 {
		return 12, 4, 11
	}
	return 4, 1, 0
}

func (c publicCommand) runCH57Write(selected ch57.DiscoveredCandidate, deviceID int, h human, access publicAccess) error {
	const sysRoot, devRoot = "/sys/bus/usb/devices", "/dev/bus/usb"
	vid, pid := ch57VIDPID(selected)
	var reports []ch57.Report
	var views []changeView
	var err error
	if ch57.IsK884xFamily(vid, pid) {
		reports, views, err = c.prepare514CWrite(sysRoot, devRoot, selected, deviceID, h, access)
	} else {
		profile := ch57.TwelveKeyThreeKnob(c.layer)
		profile.VID, profile.PID = vid, pid
		reports, views, err = c.encodeCH57ReportsWithProfile(profile, "write-only")
		if err == nil {
			err = c.runCH57Selected(selected, deviceID, h, access)
		}
	}
	if err != nil {
		return err
	}
	h.changes(views)
	if h.out.err != nil {
		return h.out.err
	}
	applied, err := access.applyCH57(sysRoot, devRoot, selected, reports)
	if err != nil {
		if applied.WriteAttempted {
			h.line("31", "Device state uncertain. A submitted write can still complete.")
		} else {
			h.line("", "Stopped before settings upload.")
		}
		h.line("33", "Stop. No automatic retry or rollback.")
		return err
	}
	h.line("32", "Settings saved to CH57x Macropad.")
	return h.out.err
}

func (c publicCommand) runSayoWrite(selected sayo.DiscoveredCandidate, deviceID int, h human, access publicAccess) error {
	const sysRoot, devRoot = "/sys/bus/usb/devices", "/dev/bus/usb"
	req, views, err := c.prepareSayoWrite(sysRoot, devRoot, selected, deviceID, h, access)
	if err != nil {
		return err
	}
	h.changes(views)
	if h.out.err != nil {
		return h.out.err
	}
	applied, err := access.applySayo(sysRoot, devRoot, selected, req)
	if err != nil {
		if applied.WriteAttempted {
			h.line("31", "Device state uncertain. A submitted write can still complete.")
		} else {
			h.line("", "Stopped before settings upload.")
		}
		h.line("33", "Stop. No automatic retry or rollback.")
		return err
	}
	h.line("32", fmt.Sprintf("Settings saved to %s.", sayoBaseProductName(selected)))
	return h.out.err
}

func (c publicCommand) runSayoFirmware(selected sayo.DiscoveredCandidate, deviceID int, h human, access publicAccess) error {
	const sysRoot, devRoot = "/sys/bus/usb/devices", "/dev/bus/usb"
	probed, probeErr := access.probeSayo(sysRoot, devRoot, selected)
	if probeErr != nil {
		c.renderSayoCardHeading(selected, deviceID, h)
		renderSayoProbeOutcome(probed, deviceID, h)
		return errors.Join(probeErr, h.out.err)
	}
	if probed.Layout == nil {
		return fmt.Errorf("device firmware information is unavailable")
	}
	_, pid := sayoVIDPID(selected)
	fetchManifest := access.fetchSayoManifest
	if fetchManifest == nil {
		fetchManifest = sayo.FetchFirmwareManifest
	}
	manifest, err := fetchManifest(pid)
	if err != nil {
		return err
	}
	entry, ok := manifest.FindEntry(probed.Layout.ModelCode)
	if !ok {
		return fmt.Errorf("model code 0x%04x not found in vendor firmware manifest for %s", probed.Layout.ModelCode, sayoProductName(selected))
	}
	if c.firmwareAction == "check" {
		c.renderSayoFirmwareHeader(selected, deviceID, probed.Layout, entry, h)
		status := fmt.Sprintf(`Update available - run "wonkey firmware update --device %d" to install`, deviceID)
		if probed.Layout.Bootloader {
			status = fmt.Sprintf(`Bootloader mode - run "wonkey firmware update --device %d" to recover`, deviceID)
		} else if probed.Layout.FirmwareVersion >= entry.Version {
			status = "Up to date"
		}
		h.field("Status", status)
		return h.out.err
	}
	return c.runSayoFirmwareUpdate(sysRoot, devRoot, selected, deviceID, pid, probed.Layout, manifest, entry, h, access)
}

func (c publicCommand) renderSayoFirmwareHeader(selected sayo.DiscoveredCandidate, deviceID int, layout *sayo.DeviceLayout, entry sayo.FirmwareManifestEntry, h human) {
	c.renderSayoCardHeading(selected, deviceID, h)
	h.field("Model", fmt.Sprintf("%s (0x%04x)", entry.Model, layout.ModelCode))
	h.field("Current", fmt.Sprintf("%d (0x%04x)", layout.FirmwareVersion, layout.FirmwareVersion))
	h.field("Latest", fmt.Sprintf("%d (0x%04x)", entry.Version, entry.Version))
	h.field("Firmware", entry.FilePath)
}

func (c publicCommand) runSayoFirmwareUpdate(sysRoot, devRoot string, selected sayo.DiscoveredCandidate, deviceID int, pid uint16, layout *sayo.DeviceLayout, manifest sayo.FirmwareManifest, entry sayo.FirmwareManifestEntry, h human, access publicAccess) error {
	if !layout.Bootloader && layout.FirmwareVersion >= entry.Version {
		c.renderSayoFirmwareHeader(selected, deviceID, layout, entry, h)
		h.line("", "Firmware is already up to date. No firmware write sent.")
		return h.out.err
	}
	fetchBin := access.fetchSayoBinary
	if fetchBin == nil {
		fetchBin = sayo.FetchFirmwareBinary
	}
	fwBytes, err := fetchBin(pid, entry.FilePath)
	if err != nil {
		return err
	}
	if err := sayo.ValidateFirmwareBinary(fwBytes, entry); err != nil {
		return err
	}
	c.renderSayoFirmwareHeader(selected, deviceID, layout, entry, h)
	before := fmt.Sprintf("%d (0x%04x)", layout.FirmwareVersion, layout.FirmwareVersion)
	if layout.Bootloader {
		before = fmt.Sprintf("bootloader (%d / 0x%04x)", layout.FirmwareVersion, layout.FirmwareVersion)
	}
	after := fmt.Sprintf("%d (0x%04x) (%s)", entry.Version, entry.Version, entry.Model)
	h.changes([]changeView{{Setting: "firmware", Before: before, After: after}})
	if h.out.err != nil {
		return h.out.err
	}
	flashFn := access.flashSayoFirmware
	if flashFn == nil {
		flashFn = sayo.FlashFirmware
	}
	progressOpen := false
	applied, err := flashFn(sysRoot, devRoot, selected, layout.Protocol, layout.Bootloader, manifest, entry, fwBytes, func(written, total int) {
		h.progress("Flashing", written, total)
		if h.tty {
			progressOpen = written < total
		}
	})
	if err != nil {
		if progressOpen {
			_, _ = io.WriteString(h.out, "\n")
		}
		if applied.WriteAttempted {
			h.line("31", fmt.Sprintf("Device state uncertain. Run \"wonkey\" to check USB path %s.", selected.PhysicalPath))
			h.line("31", fmt.Sprintf("In bootloader mode, run \"wonkey firmware update --device %d\" to recover.", deviceID))
		} else {
			h.line("", "Stopped before firmware update.")
		}
		h.line("33", "Stop. No automatic retry or rollback.")
		return err
	}
	return c.confirmSayoFirmware(sysRoot, devRoot, selected, deviceID, before, entry, h, access)
}

// confirmSayoFirmware waits for the application after EXECUTE_APP and confirms the model and version
// with one Info (0x00) query. It sends no other packet.
func (c publicCommand) confirmSayoFirmware(sysRoot, devRoot string, selected sayo.DiscoveredCandidate, deviceID int, before string, entry sayo.FirmwareManifestEntry, h human, access publicAccess) error {
	h.line("", "Waiting for the device to restart...")
	waitFn := access.waitSayoRestart
	if waitFn == nil {
		waitFn = sayo.WaitForApplication
	}
	check := fmt.Sprintf(`"wonkey firmware check --device %d"`, deviceID)
	restart := waitFn(sysRoot, devRoot, selected)
	if !restart.Restarted {
		h.line("33", fmt.Sprintf("Firmware written and verified. The device did not restart within %s.", formatSeconds(restart.Elapsed)))
		h.field("Last seen", restart.LastSeen)
		h.line("33", "Unplug and replug the device to start the new firmware.")
		h.line("33", "Then run "+check+".")
		return errors.Join(fmt.Errorf("firmware restart not confirmed within %s", formatSeconds(restart.Elapsed)), h.out.err)
	}
	if access.querySayoVersion == nil {
		return fmt.Errorf("firmware version query is unavailable")
	}
	info, err := access.querySayoVersion(sysRoot, devRoot, restart.Candidate)
	if err == nil && !info.Bootloader && info.FirmwareVersion == 0 {
		err = fmt.Errorf("the 0x00 info reply reports firmware version 0")
	}
	if err != nil {
		h.line("31", "Firmware written and verified. The version query after restart failed.")
		h.line("31", "Run "+check+".")
		return errors.Join(fmt.Errorf("query firmware version after restart: %w", err), h.out.err)
	}
	if info.Bootloader {
		h.line("33", "Firmware written and verified. The device is still in bootloader mode.")
		h.line("33", "Unplug and replug the device to start the new firmware.")
		h.line("33", "Then run "+check+".")
		return errors.Join(fmt.Errorf("device is still in bootloader mode after restart"), h.out.err)
	}
	want := fmt.Sprintf("model 0x%04x, version %d (0x%04x)", entry.ModelCode, entry.Version, entry.Version)
	got := fmt.Sprintf("model 0x%04x, version %d (0x%04x)", info.ModelCode, info.FirmwareVersion, info.FirmwareVersion)
	if info.ModelCode != entry.ModelCode || info.FirmwareVersion != entry.Version {
		h.line("31", "Firmware written and verified. The model or version differs.")
		h.field("Expected", want)
		h.field("Reported", got)
		h.line("33", "Stop. No automatic retry or rollback.")
		h.line("33", "Run "+check+" to check the device.")
		return errors.Join(fmt.Errorf("restarted device reports %s, expected %s", got, want), h.out.err)
	}
	h.line("32", fmt.Sprintf("Firmware updated: %s -> %d (0x%04x), confirmed.", before, entry.Version, entry.Version))
	h.field("Restart", formatSeconds(restart.Elapsed))
	return h.out.err
}

func formatSeconds(d time.Duration) string {
	return fmt.Sprintf("%.1fs", d.Seconds())
}

func (c publicCommand) prepareSayoWrite(sysRoot, devRoot string, selected sayo.DiscoveredCandidate, deviceID int, h human, access publicAccess) (sayo.WriteRequest, []changeView, error) {
	product := sayoProductName(selected)
	probed, probeErr := access.probeSayo(sysRoot, devRoot, selected)
	if probeErr != nil {
		c.renderSayoCardHeading(selected, deviceID, h)
		renderSayoProbeOutcome(probed, deviceID, h)
		return sayo.WriteRequest{}, nil, errors.Join(probeErr, h.out.err)
	}
	if probed.Layout != nil && probed.Layout.Bootloader {
		return sayo.WriteRequest{}, nil, fmt.Errorf("%s is in bootloader mode, run \"wonkey firmware update --device %d\" to recover", product, deviceID)
	}
	keys, knobs, slotCount := 6, 0, 6
	if probed.Layout != nil {
		keys, knobs = probed.Layout.Keys, probed.Layout.Knobs
		if probed.Layout.SlotCount > 0 {
			slotCount = probed.Layout.SlotCount
		} else {
			slotCount = keys + knobs*3
		}
	}
	var req sayo.WriteRequest
	var views []changeView
	if c.name == "rgb" {
		var err error
		req, views, err = c.encodeSayoRGBWrite(slotCount, probed.Layout)
		if err != nil {
			return sayo.WriteRequest{}, nil, err
		}
	} else {
		if err := validateCH57Control(product, keys, knobs, c.control); err != nil {
			return sayo.WriteRequest{}, nil, err
		}
		sayoCtrl := sayo.Control(c.control)
		slotIdx, ok := probed.Layout.SlotIndex(sayoCtrl)
		if !ok {
			return sayo.WriteRequest{}, nil, fmt.Errorf("%s does not support control %q", product, c.control)
		}
		before := sayoBeforeBinding(probed.Layout, sayoCtrl, c.layer)
		var err error
		req, views, err = c.encodeSayoActionWrite(sayoCtrl, slotIdx, before)
		if err != nil {
			return sayo.WriteRequest{}, nil, err
		}
	}
	c.renderSayoCardHeading(selected, deviceID, h)
	renderSayoProbeOutcome(probed, deviceID, h)
	return req, views, h.out.err
}

func (c publicCommand) encodeSayoActionWrite(control sayo.Control, slotIdx byte, before string) (sayo.WriteRequest, []changeView, error) {
	setting := string(c.control)
	if c.layer > 1 {
		setting = fmt.Sprintf("%s (layer %d)", c.control, c.layer)
	}
	bothDefault := !c.seenLayer
	switch c.name {
	case "key":
		stroke := sayo.Stroke{Modifiers: c.changes["modifiers"], Usage: c.changes["key"]}
		req, err := sayo.PrepareKeyboardWrite(control, slotIdx, c.layer, bothDefault, []sayo.Stroke{stroke})
		if err != nil {
			return sayo.WriteRequest{}, nil, err
		}
		after := formatCH57Stroke(ch57.Stroke{Modifiers: stroke.Modifiers, Usage: stroke.Usage})
		return req, []changeView{{Setting: setting, Before: before, After: after}}, nil
	case "macro":
		strokes := make([]sayo.Stroke, len(c.macroStrokes))
		formatted := make([]string, len(c.macroStrokes))
		for i, s := range c.macroStrokes {
			strokes[i] = sayo.Stroke{Modifiers: s.Modifiers, Usage: s.Usage}
			formatted[i] = formatCH57Stroke(s)
		}
		req, err := sayo.PrepareKeyboardWrite(control, slotIdx, c.layer, bothDefault, strokes)
		if err != nil {
			return sayo.WriteRequest{}, nil, err
		}
		return req, []changeView{{Setting: setting, Before: before, After: strings.Join(formatted, ",")}}, nil
	case "mouse":
		mouse, ok := c.action.(MouseAction)
		if !ok {
			return sayo.WriteRequest{}, nil, fmt.Errorf("invalid mouse action")
		}
		chEvent, err := ch57MouseEvent(mouse)
		if err != nil {
			return sayo.WriteRequest{}, nil, err
		}
		sayoEvent := sayo.MouseEvent{
			Action:  sayo.MouseAction(chEvent.Action),
			Buttons: sayo.MouseButtons(chEvent.Buttons),
			DX:      chEvent.DX,
			DY:      chEvent.DY,
			Wheel:   chEvent.Wheel,
		}
		req, err := sayo.PrepareMouseWrite(control, slotIdx, c.layer, bothDefault, sayoEvent)
		if err != nil {
			return sayo.WriteRequest{}, nil, err
		}
		return req, []changeView{{Setting: setting, Before: before, After: actionDescription(c.action)}}, nil
	case "media":
		media, ok := c.action.(MediaAction)
		if !ok {
			return sayo.WriteRequest{}, nil, fmt.Errorf("invalid media action")
		}
		req, err := sayo.PrepareMediaWrite(control, slotIdx, c.layer, bothDefault, sayo.MediaUsage(media.Usage&0xffff))
		if err != nil {
			return sayo.WriteRequest{}, nil, err
		}
		return req, []changeView{{Setting: setting, Before: before, After: actionDescription(c.action)}}, nil
	default:
		return sayo.WriteRequest{}, nil, fmt.Errorf("unsupported SayoDevice command %q", c.name)
	}
}

func (c publicCommand) encodeSayoRGBWrite(slotCount int, layout *sayo.DeviceLayout) (sayo.WriteRequest, []changeView, error) {
	beforeMode, beforeColour := "write-only", "#404040"
	if layout != nil && layout.RGBMode != "" {
		beforeMode, beforeColour = layout.RGBMode, layout.RGBColour
	}
	afterMode := settingName(lightingValues, c.changes["rgb-mode"])
	_, hasColour := c.changes["red"]
	var r, g, b byte
	if hasColour {
		r = byte(c.changes["red"] & 255)
		g = byte(c.changes["green"] & 255)
		b = byte(c.changes["blue"] & 255)
	}
	req, err := sayo.PrepareRGBWrite(slotCount, afterMode, r, g, b, hasColour)
	if err != nil {
		return sayo.WriteRequest{}, nil, err
	}
	afterColour := beforeColour
	if afterMode == "off" {
		afterColour = "#000000"
	} else if hasColour {
		afterColour = fmt.Sprintf("#%02X%02X%02X", r, g, b)
	}
	var views []changeView
	if beforeMode != afterMode || !hasColour {
		views = append(views, changeView{Setting: "lighting", Before: beforeMode, After: afterMode})
	}
	if (hasColour || afterMode == "off") && (beforeColour != afterColour || len(views) == 0) {
		views = append(views, changeView{Setting: "colour", Before: beforeColour, After: afterColour})
	}
	return req, views, nil
}

func sayoBeforeBinding(layout *sayo.DeviceLayout, control sayo.Control, layer int) string {
	if b, ok := layout.Binding(control, layer); ok && b.ActionType != sayo.SlotActionNone {
		return formatSayoSlotBinding(b)
	}
	return "write-only"
}

func (c publicCommand) prepare514CWrite(sysRoot, devRoot string, selected ch57.DiscoveredCandidate, deviceID int, h human, access publicAccess) ([]ch57.Report, []changeView, error) {
	product := ch57ProductName(selected)
	probed, probeErr := access.probeCH57(sysRoot, devRoot, selected)
	if probeErr != nil {
		c.renderCH57CardHeading(selected, deviceID, h)
		renderCH57ProbeOutcome(selected, probed, h)
		return nil, nil, errors.Join(probeErr, h.out.err)
	}
	keys, knobs, kind := default514CLayout(selected.PID)
	if probed.Layout != nil {
		keys, knobs, kind = probed.Layout.Keys, probed.Layout.Knobs, probed.Layout.Kind
	}
	switch c.name {
	case "key", "macro", "mouse", "media":
		if err := validateCH57Control(product, keys, knobs, c.control); err != nil {
			return nil, nil, err
		}
	}
	before := "write-only"
	if probed.Layout != nil && c.layer == 1 && c.name != "led" {
		if slot, ok := ch57.K884xSlot(c.control); ok {
			if b, has := probed.Layout.Bindings[slot]; has && b.ActionType != ch57.SlotActionNone {
				before = formatCH57SlotBinding(b)
			}
		}
	}
	profile := ch57.K884xProfile(selected.PID, kind, c.layer)
	profile.VID = selected.VID
	reports, views, err := c.encodeCH57ReportsWithProfile(profile, before)
	if err != nil {
		return nil, nil, err
	}
	c.renderCH57CardHeading(selected, deviceID, h)
	renderCH57ProbeOutcome(selected, probed, h)
	return reports, views, h.out.err
}

func (c publicCommand) renderCH57CardHeading(selected ch57.DiscoveredCandidate, deviceID int, h human) {
	vid, pid := ch57VIDPID(selected)
	h.heading(fmt.Sprintf("[%d] %s", deviceID, ch57ProductName(selected)))
	h.field("USB path", selected.PhysicalPath)
	if !ch57.IsK884xFamily(vid, pid) {
		h.field("Supports", ch57SupportsSummary(selected))
	}
}

func (c publicCommand) renderSayoCardHeading(selected sayo.DiscoveredCandidate, deviceID int, h human) {
	h.heading(fmt.Sprintf("[%d] %s", deviceID, sayoProductName(selected)))
	h.field("USB path", selected.PhysicalPath)
}

func renderCH57ProbeOutcome(selected ch57.DiscoveredCandidate, probed ch57.ProbeResult, h human) {
	if probed.Layout != nil {
		h.field("Layout", formatLayoutSummary(probed.Layout.Keys, probed.Layout.Knobs))
		h.field("Supports", ch57SupportsSummary(selected))
		if len(probed.Layout.Bindings) == 0 {
			h.field("Settings", "Write-only (not readable over USB)")
			return
		}
		for k := 1; k <= probed.Layout.Keys; k++ {
			h.field(fmt.Sprintf("key%d", k), formatCH57SlotBinding(probed.Layout.Bindings[byte(k)]))
		}
		for m := 1; m <= probed.Layout.Knobs; m++ {
			leftSlot, pressSlot, rightSlot, ok := ch57.K884xKnobSlots(m)
			if !ok {
				continue
			}
			val := fmt.Sprintf("left: %s, press: %s, right: %s",
				formatCH57SlotBinding(probed.Layout.Bindings[leftSlot]),
				formatCH57SlotBinding(probed.Layout.Bindings[pressSlot]),
				formatCH57SlotBinding(probed.Layout.Bindings[rightSlot]))
			h.field(fmt.Sprintf("knob%d", m), val)
		}
		return
	}
	if probed.Status == ch57.ProbeRawReport {
		if probed.Count == 1 && len(probed.Raw) == 1 && probed.Raw[0] == 0xaa {
			h.field("Settings", "Write-only (not readable over USB)")
			return
		}
		h.field("Settings", "Write-only (not readable over USB)")
		h.field("Input hex", hex.EncodeToString(probed.Raw))
		return
	}
	h.field("Status", string(probed.Status))
	if probed.ReportDescriptor != nil || probed.ReportDescriptorCount != 0 {
		h.field("Descriptor bytes", strconv.Itoa(probed.ReportDescriptorCount))
		h.field("Descriptor hex", hex.EncodeToString(probed.ReportDescriptor))
	}
	if probed.Raw != nil || probed.Count != 0 || probed.Status == ch57.ProbeTransferFailed {
		h.field("Input bytes", strconv.Itoa(probed.Count))
		h.field("Input hex", hex.EncodeToString(probed.Raw))
	}
}

func renderSayoProbeOutcome(probed sayo.ProbeResult, deviceID int, h human) {
	if probed.Layout != nil {
		if probed.Layout.Bootloader {
			h.field("Layout", "Bootloader recovery mode")
			l := probed.Layout
			h.field("Model", fmt.Sprintf("0x%04x, version %d (0x%04x), CHECK_FW reply %s", l.ModelCode, l.FirmwareVersion, l.FirmwareVersion, sayo.ReplyPrefixHex(probed.Raw)))
			h.field("Supports", "firmware")
			h.field("Settings", fmt.Sprintf(`Bootloader mode - run "wonkey firmware update --device %d" to recover`, deviceID))
			return
		}
		h.field("Layout", formatLayoutSummary(probed.Layout.Keys, probed.Layout.Knobs))
		h.field("Supports", sayoSupportsSummary())
		for k := 1; k <= probed.Layout.Keys; k++ {
			ctrl := sayo.Control(fmt.Sprintf("key%d", k))
			b, _ := probed.Layout.Binding(ctrl, 1)
			h.field(string(ctrl), formatSayoSlotBinding(b))
		}
		for m := 1; m <= probed.Layout.Knobs; m++ {
			leftCtrl := sayo.Control(fmt.Sprintf("knob%d-left", m))
			pressCtrl := sayo.Control(fmt.Sprintf("knob%d-press", m))
			rightCtrl := sayo.Control(fmt.Sprintf("knob%d-right", m))
			bLeft, _ := probed.Layout.Binding(leftCtrl, 1)
			bPress, _ := probed.Layout.Binding(pressCtrl, 1)
			bRight, _ := probed.Layout.Binding(rightCtrl, 1)
			val := fmt.Sprintf("left: %s, press: %s, right: %s",
				formatSayoSlotBinding(bLeft),
				formatSayoSlotBinding(bPress),
				formatSayoSlotBinding(bRight))
			h.field(fmt.Sprintf("knob%d", m), val)
		}
		if probed.Layout.RGBMode != "" {
			h.field("Mode", probed.Layout.RGBMode)
			fmt.Fprintf(h.out, "  %-10s %s\n", "Colour", h.rgb(probed.Layout.RGBColour))
		}
		return
	}
	h.field("Status", string(probed.Status))
	if probed.ReportDescriptor != nil || probed.ReportDescriptorCount != 0 {
		h.field("Descriptor bytes", strconv.Itoa(probed.ReportDescriptorCount))
		h.field("Descriptor hex", hex.EncodeToString(probed.ReportDescriptor))
	}
	if probed.Raw != nil || probed.Count != 0 || probed.Status == sayo.ProbeTransferFailed {
		h.field("Input bytes", strconv.Itoa(probed.Count))
		h.field("Input hex", hex.EncodeToString(probed.Raw))
	}
}

func (c publicCommand) runReadAll(matches []Candidate, byCH57Path map[string]ch57.DiscoveredCandidate, bySayoPath map[string]sayo.DiscoveredCandidate, h human, access publicAccess) error {
	var runErr error
	for i, selected := range matches {
		deviceID := i + 1
		if i > 0 {
			_, _ = io.WriteString(h.out, "\n")
		}
		if sayoCandidate, ok := bySayoPath[selected.PhysicalPath]; ok {
			runErr = errors.Join(runErr, c.runSayoSelected(sayoCandidate, deviceID, h, access))
			continue
		}
		if chCandidate, ok := byCH57Path[selected.PhysicalPath]; ok {
			runErr = errors.Join(runErr, c.runCH57Selected(chCandidate, deviceID, h, access))
			continue
		}
		runErr = errors.Join(runErr, c.runXFKEYSelected(selected, deviceID, h, access))
	}
	return errors.Join(runErr, h.out.err)
}

func (c publicCommand) runXFKEYSelected(selected Candidate, deviceID int, h human, access publicAccess) error {
	observed, err := access.query(selected)
	if err != nil {
		return err
	}
	target := ApplyTarget{observed.Identity.Identifier, fmt.Sprintf("%04x", observed.Identity.Version)}
	if err := target.validate(); err != nil {
		return err
	}
	if !target.matches(observed.Identity) || observed.PhysicalPath != selected.PhysicalPath {
		return fmt.Errorf("unsupported or changed device identity/path")
	}
	if observed.Readback == nil {
		return fmt.Errorf("device settings are missing")
	}
	return c.runObserved(observed, selected, deviceID, target, h, access)
}

func (c publicCommand) runCH57Selected(selected ch57.DiscoveredCandidate, deviceID int, h human, access publicAccess) error {
	const sysRoot, devRoot = "/sys/bus/usb/devices", "/dev/bus/usb"
	vid, pid := ch57VIDPID(selected)
	c.renderCH57CardHeading(selected, deviceID, h)
	if h.out.err != nil {
		return h.out.err
	}
	probed, err := access.probeCH57(sysRoot, devRoot, selected)
	if err != nil && ch57.IsK884xFamily(vid, pid) {
		h.field("Supports", ch57SupportsSummary(selected))
	}
	if err == nil && probed.Status != ch57.ProbeRawReport && probed.Count == 1 && len(probed.Raw) == 1 && probed.Raw[0] == 0xaa {
		probed.Status = ch57.ProbeRawReport
	}
	if err != nil && probed.Status == ch57.ProbeRawReport {
		h.field("Status", string(probed.Status))
		if probed.ReportDescriptor != nil || probed.ReportDescriptorCount != 0 {
			h.field("Descriptor bytes", strconv.Itoa(probed.ReportDescriptorCount))
			h.field("Descriptor hex", hex.EncodeToString(probed.ReportDescriptor))
		}
		if probed.Raw != nil || probed.Count != 0 {
			h.field("Input bytes", strconv.Itoa(probed.Count))
			h.field("Input hex", hex.EncodeToString(probed.Raw))
		}
		return errors.Join(err, h.out.err)
	}
	renderCH57ProbeOutcome(selected, probed, h)
	return errors.Join(err, h.out.err)
}

func (c publicCommand) runSayoSelected(selected sayo.DiscoveredCandidate, deviceID int, h human, access publicAccess) error {
	const sysRoot, devRoot = "/sys/bus/usb/devices", "/dev/bus/usb"
	c.renderSayoCardHeading(selected, deviceID, h)
	if h.out.err != nil {
		return h.out.err
	}
	probed, err := access.probeSayo(sysRoot, devRoot, selected)
	if err == nil {
		renderSayoProbeOutcome(probed, deviceID, h)
		return h.out.err
	}
	vid, pid := sayoVIDPID(selected)
	bootloader := selected.Bootloader || sayo.IsBootloaderPID(vid, pid) || sayo.IsBootloaderReportDescriptor(probed.ReportDescriptor)
	if !bootloader {
		h.field("Supports", sayoSupportsSummary())
		renderSayoProbeOutcome(probed, deviceID, h)
		return errors.Join(err, h.out.err)
	}
	h.field("Supports", "firmware")
	renderSayoProbeOutcome(probed, deviceID, h)
	if !sayo.IsDeviceRestartErr(err) {
		return errors.Join(err, h.out.err)
	}
	h.field("Detail", err.Error())
	h.line("33", "Device is restarting. Wait a few seconds and run wonkey again.")
	h.line("33", fmt.Sprintf("If it stays in bootloader mode, run wonkey firmware update --device %d to recover.", deviceID))
	return errors.Join(fmt.Errorf("SayoDevice at USB path %s did not answer in bootloader mode", selected.PhysicalPath), h.out.err)
}

func (c publicCommand) showCurrentSettings(current configuration, selected Candidate, deviceID int, h human) {
	h.heading(fmt.Sprintf("[%d] XFKEY One Key Max (0112)", deviceID))
	h.field("USB path", selected.PhysicalPath)
	h.field("Supports", "key, trigger, mouse, media, macro, rgb")
	if c.supportedConfiguration(current) != nil {
		h.field("Layout", "Unknown (unsupported configuration)")
		h.field("Raw type", fmt.Sprintf("0x%02x (byte 0)", current[0]))
		h.field("Raw 0-15", hex.EncodeToString(current[:16]))
		h.line("33", "Fields are not decoded. Changes are blocked.")
		return
	}
	if c.name != "rgb" {
		action, _ := decodeAction(current)
		if keyboard, ok := action.(KeyboardAction); ok {
			key := settingName(keyValues, keyboard.Key)
			if keyboard.Modifiers != 0 {
				key = strings.ReplaceAll(modifierName(current[2]), ",", "+") + "+" + key
			}
			h.field("Key", key)
			h.field("On", settingName(triggerValues, keyboard.Trigger))
		} else {
			h.field("Action", actionDescription(action))
		}
	}
	if c.name == "rgb" || c.name == "" {
		h.field("Mode", settingName(lightingValues, int(current[124])-1))
		fmt.Fprintf(h.out, "  %-10s %s\n", "Colour", h.rgb(fmt.Sprintf("#%02X%02X%02X", current[125], current[126], current[127])))
	}
}

func (c publicCommand) supportedConfiguration(current configuration) error {
	if _, err := decodeAction(current); err != nil {
		return fmt.Errorf("unsupported current action layout: %w", err)
	}
	if current[124] < 1 || current[124] > 8 {
		return fmt.Errorf("unsupported current RGB mode %02x", current[124])
	}
	return nil
}

func (c publicCommand) configurationChanges(current configuration) configurationChanges {
	if c.action != nil {
		return ActionChanges{Action: c.action}
	}
	if current[0] == 0 {
		return c.changes
	}
	if c.name == "key" {
		trigger, present := c.changes["trigger"]
		if !present {
			trigger = triggerValues["press"]
		}
		return ActionChanges{Action: KeyboardAction{Trigger: trigger, Modifiers: c.changes["modifiers"], Key: c.changes["key"]}}
	}
	return ActionChanges{RGB: c.changes}
}

func (c publicCommand) runObserved(observed CaptureResult, selected Candidate, deviceID int, target ApplyTarget, h human, access publicAccess) error {
	raw, err := hex.DecodeString(observed.Readback.Configuration)
	if err != nil {
		return err
	}
	var current configuration
	if len(raw) != len(current) {
		return fmt.Errorf("device settings need exactly 128 bytes")
	}
	copy(current[:], raw)
	if c.isReadOnly() {
		c.showCurrentSettings(current, selected, deviceID, h)
		return h.out.err
	}
	if err := c.supportedConfiguration(current); err != nil {
		return err
	}
	if c.name == "trigger" && current[0] != 0 {
		return fmt.Errorf("trigger requires a configured keyboard key; set one with \"wonkey key\" first")
	}
	c.showCurrentSettings(current, selected, deviceID, h)
	if h.out.err != nil {
		return h.out.err
	}
	changes := c.configurationChanges(current)
	intended, err := changes.configuration(current)
	if err != nil {
		return err
	}
	views := publicActionViews(current, intended)
	h.changes(views)
	if h.out.err != nil {
		return h.out.err
	}
	if len(views) == 0 {
		h.line("", "No settings write sent.")
		return h.out.err
	}
	guard := func(fresh, proposed configuration) (bool, error) {
		if fresh != current || proposed != intended {
			return false, fmt.Errorf("settings changed after preview; no settings write sent")
		}
		return true, nil
	}
	result, err := access.apply(selected, target, changes, guard)
	if err != nil {
		if result.WriteAttempted {
			h.line("31", "Device state uncertain. A submitted write can still complete.")
		} else {
			h.line("", "Stopped before settings upload.")
		}
		h.line("33", "Stop. No automatic retry or rollback.")
		return err
	}
	if result.ReadbackVerified {
		h.line("32", "Settings saved. All 128 readback bytes match.")
	} else {
		h.line("", "No settings write sent.")
	}
	return h.out.err
}
