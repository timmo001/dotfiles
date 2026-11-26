package xfkey

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"
	"wonkey/internal/ch57"
	"wonkey/internal/sayo"
)

func TestPublicVersionFlagAvoidsDeviceAccess(t *testing.T) {
	orig := buildVersion
	SetVersion("0.2.0")
	t.Cleanup(func() { buildVersion = orig })

	access := publicAccess{
		discover: func() ([]Candidate, error) {
			t.Fatal("--version accessed devices")
			return nil, nil
		},
	}

	var out, errOut bytes.Buffer
	if err := runPublic([]string{"--version"}, &cliRuntime{strings.NewReader(""), &out, &errOut}, access); err != nil {
		t.Fatalf("--version failed: %v", err)
	}
	if out.String() != "wonkey 0.2.0\n" || errOut.Len() != 0 {
		t.Fatalf("out=%q err=%q, want wonkey 0.2.0", out.String(), errOut.String())
	}

	out.Reset()
	errOut.Reset()
	err := runPublic([]string{"--version", "key"}, &cliRuntime{strings.NewReader(""), &out, &errOut}, access)
	if err == nil || ExitCode(err) != 2 {
		t.Fatalf("expected exit 2 for --version with extra args, got err=%v code=%d", err, ExitCode(err))
	}
}

func checkPublicHeader(t *testing.T, text string) {
	t.Helper()
	if !strings.HasPrefix(text, "1️⃣ WonKey\n\n") || strings.Count(text, "WonKey\n") != 1 {
		t.Fatalf("expected one header on the first line: %q", text)
	}
}

func TestPublicHeaderOutputFailure(t *testing.T) {
	for _, args := range [][]string{nil, {"--help"}, {"key", "--help"}, {"key"}, {"key", "f13"}, {"invalid"}} {
		for _, short := range []bool{false, true} {
			t.Run(fmt.Sprintf("%v/short=%v", args, short), func(t *testing.T) {
				failed := &failingHumanOutput{short: short}
				var other bytes.Buffer
				var out, diagnostic io.Writer = failed, &other
				code := 1
				if len(args) == 1 && (args[0] == "invalid" || args[0] == "key") {
					out, diagnostic, code = &other, failed, 2
				}
				access := publicAccess{
					discover: func() ([]Candidate, error) { t.Fatal("header failure accessed devices"); return nil, nil },
				}
				err := runPublic(args, &cliRuntime{strings.NewReader(""), out, diagnostic}, access)
				want := io.ErrClosedPipe
				if short {
					want = io.ErrShortWrite
				}
				if !errors.Is(err, want) || ExitCode(err) != code || failed.calls != 1 || other.Len() != 0 {
					t.Fatalf("error=%v writes=%d other=%q", err, failed.calls, other.String())
				}
			})
		}
	}
}

func checkPublicOutputFailure(t *testing.T, args []string, needle string, multiple, short bool) {
	t.Helper()
	first, fresh := newSettingsTransport(), newSettingsTransport()
	queried, applied := false, false
	out := &failingHumanOutput{needle: needle, short: short}
	access := publicAccess{
		discover: func() ([]Candidate, error) {
			candidates := []Candidate{{PhysicalPath: "1-2", Compatible: true}}
			if multiple {
				candidates = append(candidates, Candidate{PhysicalPath: "1-3", Compatible: true})
			}
			return candidates, nil
		},
		query: func(c Candidate) (CaptureResult, error) {
			queried = true
			q, err := queryCapture(first, true)
			q.result.PhysicalPath = c.PhysicalPath
			return q.result, err
		},
		apply: func(_ Candidate, target ApplyTarget, changes configurationChanges, guard func(configuration, configuration) (bool, error)) (ApplyResult, error) {
			applied = true
			return applySettingsConfirmed(fresh, target, changes, true, time.Second, guard, true)
		},
	}
	err := runPublic(args, &cliRuntime{strings.NewReader(""), out, io.Discard}, access)
	want := io.ErrClosedPipe
	if short {
		want = io.ErrShortWrite
	}
	if !out.failed || !errors.Is(err, want) || applied || queried != (needle != "") {
		t.Fatalf("output failed=%v error=%v applied=%v queried=%v", out.failed, err, applied, queried)
	}
	checkNoUpload(t, first)
	checkNoUpload(t, fresh)
}

func TestPublicOutputFailure(t *testing.T) {
	for _, short := range []bool{false, true} {
		for _, tc := range []struct {
			name, needle string
			args         []string
			multiple     bool
		}{
			{"all-output", "", []string{"key", "f13"}, false},
			{"second-device-heading", "[2] XFKEY One Key Max (0112)", []string{"key", "f13", "--device", "2"}, true},
			{"second-device-path", "1-3", []string{"key", "f13", "--device=2"}, true},
			{"preview-heading", "[1] XFKEY One Key Max (0112)", []string{"key", "f13"}, false},
			{"preview-field", "USB path", []string{"key", "f13"}, false},
			{"preview-colour", "Colour", []string{"rgb", "off"}, false},
			{"changes-heading", "Changes:", []string{"key", "f13"}, false},
			{"changes-row", " -> ", []string{"key", "f13"}, false},
		} {
			t.Run(fmt.Sprintf("%s/short=%v", tc.name, short), func(t *testing.T) {
				checkPublicOutputFailure(t, tc.args, tc.needle, tc.multiple, short)
			})
		}
	}
}

func TestPublicParser(t *testing.T) {
	for _, tc := range []struct {
		args       []string
		want       Changes
		wantDevice int
	}{
		{nil, nil, 0},
		{[]string{}, nil, 0},
		{[]string{"key", "f13"}, Changes{"key": 0x68, "modifiers": 0}, 0},
		{[]string{"key", "ctrl+shift+f13", "--device", "1"}, Changes{"key": 0x68, "modifiers": 3}, 1},
		{[]string{"key", "--device=2", "alt+super+enter"}, Changes{"key": 0x28, "modifiers": 12}, 2},
		{[]string{"key", "SUPER+f13"}, Changes{"key": 0x68, "modifiers": 8}, 0},
		{[]string{"trigger", "release", "--device=2"}, Changes{"trigger": 2}, 2},
		{[]string{"trigger", "BOTH"}, Changes{"trigger": 3}, 0},
		{[]string{"trigger", "press"}, Changes{"trigger": 1}, 0},
		{[]string{"rgb", "static", "0000ff", "--device", "3"}, Changes{"rgb-mode": 1, "red": 0, "green": 0, "blue": 255}, 3},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got, err := parsePublic(tc.args)
			if err != nil || !reflect.DeepEqual(got.changes, tc.want) || got.device != tc.wantDevice || got.control != ch57.Key1 || got.seenControl || got.layer != 1 || got.seenLayer {
				t.Fatal(got, err)
			}
		})
	}
	for _, control := range []ch57.Control{
		ch57.Key1, ch57.Key2, ch57.Key3, ch57.Key4, ch57.Key5, ch57.Key6,
		ch57.Key7, ch57.Key8, ch57.Key9, ch57.Key10, ch57.Key11, ch57.Key12,
		ch57.KnobLeft, ch57.KnobPress, ch57.KnobRight,
		ch57.Knob1Left, ch57.Knob1Press, ch57.Knob1Right,
		ch57.Knob2Left, ch57.Knob2Press, ch57.Knob2Right,
		ch57.Knob3Left, ch57.Knob3Press, ch57.Knob3Right,
		ch57.Knob4Left, ch57.Knob4Press, ch57.Knob4Right,
	} {
		for _, rawControl := range []string{string(control), strings.ToUpper(string(control))} {
			got, err := parsePublic([]string{"key", rawControl, "ctrl+shift+f13", "--layer", "15", "--device=2"})
			want := Changes{"key": 0x68, "modifiers": 3}
			if err != nil || !reflect.DeepEqual(got.changes, want) || got.control != control || !got.seenControl || got.layer != 15 || !got.seenLayer || got.device != 2 {
				t.Fatalf("control=%q got=%+v err=%v", rawControl, got, err)
			}
		}
	}
	for layer := 1; layer <= 15; layer++ {
		for _, args := range [][]string{
			{"key", "f13", "--layer", fmt.Sprintf("%d", layer)},
			{"key", "key2", "f13", fmt.Sprintf("--layer=%d", layer)},
		} {
			got, err := parsePublic(args)
			if err != nil || got.layer != layer || !got.seenLayer {
				t.Fatalf("args=%v got=%+v err=%v", args, got, err)
			}
		}
	}
	for _, tc := range []struct {
		args       []string
		wantMode   int
		wantDevice int
	}{
		{[]string{"led", "off"}, 0, 0},
		{[]string{"led", "OFF"}, 0, 0},
		{[]string{"led", "reactive"}, 1, 0},
		{[]string{"led", "REACTIVE", "--device", "1"}, 1, 1},
		{[]string{"led", "cycle"}, 2, 0},
		{[]string{"led", "CYCLE", "--device=2"}, 2, 2},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got, err := parsePublic(tc.args)
			if err != nil || !got.hasLED || got.ledMode != tc.wantMode || got.device != tc.wantDevice || got.isReadOnly() {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	for name, mode := range lightingValues {
		c, err := parsePublic([]string{"rgb", strings.ToUpper(name)})
		if err != nil || !reflect.DeepEqual(c.changes, Changes{"rgb-mode": mode}) {
			t.Fatal(c, err)
		}
		original := newSettingsTransport().current
		changed, err := changeConfiguration(original, c.changes)
		if err != nil {
			t.Fatal(err)
		}
		for i := range original {
			if i != 124 && original[i] != changed[i] {
				t.Fatalf("%s changed byte %d", name, i)
			}
		}
	}
	for _, expression := range []string{"f13", "shift+f13", "super+f13", "ctrl+shift+alt+super+enter"} {
		c, err := parsePublic([]string{"key", expression})
		if err != nil {
			t.Fatal(err)
		}
		original := newSettingsTransport().current
		original[2], original[1] = 15, 2
		changed, err := changeConfiguration(original, c.changes)
		if err != nil || int(changed[2]) != c.changes["modifiers"] || changed[1] != 2 {
			t.Fatal(changed, err)
		}
		for i := range original {
			if i != 2 && i != 4 && original[i] != changed[i] {
				t.Fatal("unrelated byte changed", i)
			}
		}
	}
}

func TestPublicRGBColourArguments(t *testing.T) {
	for _, mode := range []string{"cycle-slow", "cycle-fast", "off"} {
		for _, spelling := range []string{mode, strings.ToUpper(mode)} {
			for _, colour := range []string{"1234ab", "", "#1234ab", "12345", "gggggg"} {
				t.Run(spelling+"/"+colour, func(t *testing.T) {
					access := publicAccess{
						discover: func() ([]Candidate, error) { t.Fatal("invalid colour accessed devices"); return nil, nil },
					}
					var diagnostic bytes.Buffer
					err := runPublic([]string{"rgb", spelling, colour}, &cliRuntime{strings.NewReader(""), io.Discard, &diagnostic}, access)
					want := fmt.Sprintf("RGB mode %q does not use a colour; omit RGB", mode)
					if err == nil || ExitCode(err) != 2 || !strings.Contains(diagnostic.String(), want) {
						t.Fatalf("error=%v output=%q", err, diagnostic.String())
					}
				})
			}
		}
	}
	for _, mode := range []string{"static", "breathe", "flash", "held", "toggle"} {
		for _, spelling := range []string{mode, strings.ToUpper(mode)} {
			t.Run(spelling, func(t *testing.T) {
				c, err := parsePublic([]string{"rgb", spelling, "12AbEF"})
				want := Changes{"rgb-mode": lightingValues[mode], "red": 0x12, "green": 0xab, "blue": 0xef}
				if err != nil || !reflect.DeepEqual(c.changes, want) {
					t.Fatal(c, err)
				}
			})
		}
	}
}

func TestPublicRGBHelpArguments(t *testing.T) {
	for _, mode := range []string{"cycle-slow", "cycle-fast", "off"} {
		if !strings.Contains(rgbHelp, "  "+mode+" ") || strings.Contains(rgbHelp, mode+" [RGB]") {
			t.Fatal("unexpected colour argument for", mode)
		}
	}
	for _, mode := range []string{"static", "breathe", "flash", "held", "toggle"} {
		if !strings.Contains(rgbHelp, mode+" [RGB]") {
			t.Fatal("missing optional colour for", mode)
		}
	}
	for _, text := range []string{"six hexadecimal digits without #", "Omit RGB to preserve the current colour"} {
		if !strings.Contains(rgbHelp, text) {
			t.Fatal("missing colour guidance", text)
		}
	}
}

func TestPublicRefusesInvalidBeforeAccess(t *testing.T) {
	cases := [][]string{
		{"key"},
		{"trigger"},
		{"macro"},
		{"mouse"},
		{"media"},
		{"multi"},
		{"rgb"},
		{"led"},
		{"trigger", ""},
		{"trigger", "click"},
		{"trigger", "press", "release"},
		{"led", ""},
		{"led", "on"},
		{"led", "pulse"},
		{"led", "static"},
		{"led", "0"},
		{"led", "1"},
		{"led", "2"},
		{"led", "-1"},
		{"led", "+1"},
		{"led", "01"},
		{"led", "256"},
		{"led", "0000ff"},
		{"led", "reactive", "0000ff"},
		{"rgb", "steady"},
		{"rgb", "flowing"},
		{"rgb", "gradient"},
		{"rgb", "neon"},
		{"rgb", "STEADY", "0000ff"},
		{"rgb", "FLOWING", "0000ff"},
		{"rgb", "GRADIENT", "gggggg"},
		{"rgb", "NEON", "#0000ff"},
		{"key", "gui+f13"},
		{"key", "GUI+enter"},
		{"key", "super+super+f13"},
		{"restore"},
		{"restore", "one"},
		{"restore", "one", "two"},
		{"restore", "--yes"},
		{"restore", "--capture-root", "/tmp"},
		{"restore", "--write"},
		{"restore", "--help"},
		{"restore", "--help", "--yes"},
		{"rollback"},
		{"help"},
		{"advanced"},
		{"show"},
		{"set", "key=f13"},
		{"plan"},
		{"apply"},
		{"devices"},
		{"inspect"},
		{"identify"},
		{"readback"},
		{"preview"},
		{"protocol"},
		{"parse-identify"},
		{"parse-readback"},
		{"key", "--on", "release"},
		{"key", "f13", "--on", "release"},
		{"key", "f13", "--on=press"},
		{"key", "f13", "--on=press", "--on=release"},
		{"key", "f13", "--on="},
		{"key", "f13", "--on", "click"},
		{"key", "f13", "--on"},
		{"rgb", "off", "--on", "press"},
		{"key", "!"},
		{"key", "rightctrl+left"},
		{"key", "0x04"},
		{"key", "a+b"},
		{"key", ""},
		{"key", "f13+"},
		{"key", "+f13"},
		{"key", "ctrl+ctrl+f13"},
		{"key", "none+f13"},
		{"key", "f13+ctrl"},
		{"key", "f13", "enter"},
		{"rgb", ""},
		{"rgb", "blue"},
		{"rgb", "static", "#0000ff"},
		{"rgb", "static", "00000"},
		{"rgb", "static", "gggggg"},
		{"rgb", "off", "000000", "extra"},
		{"--help", "--yes"},
		{"key", "--report"},
		{"key", "--report="},
		{"key", "--report=output"},
		{"key", "--report", "output"},
		{"key", "--report=output", "--help"},
		{"trigger", "--report=output"},
		{"macro", "--report=output"},
		{"mouse", "--report=output"},
		{"media", "--report=output"},
		{"multi", "--report=output"},
		{"rgb", "--report=output"},
		{"led", "--report=output"},
		{"key", "--device"},
		{"key", "--device="},
		{"--device", "1"},
		{"--device=1"},
		{"key", "f13", "--device", "0"},
		{"key", "f13", "--device=0"},
		{"key", "f13", "--device", "-1"},
		{"key", "f13", "--device", "+1"},
		{"key", "f13", "--device", "01"},
		{"key", "f13", "--device", "abc"},
		{"key", "f13", "--device", "1", "--device", "2"},
		{"key", "f13", "--device=1", "--device=1"},
		{"key", "--device", "1"},
		{"trigger", "--device", "1"},
		{"macro", "--device", "1"},
		{"mouse", "--device", "1"},
		{"media", "--device", "1"},
		{"multi", "--device", "1"},
		{"rgb", "--device", "1"},
		{"led", "--device", "1"},
		{"key", "--device", "1189:8891"},
		{"key", "--device=0x1189:0x8890"},
		{"key", "--device", "1189:8890", "--device=1189:8890"},
		{"key", "--device=1189:8890", "--device", "1189:8890"},
		{"key", "--device=1189:8890", "f13"},
		{"key", "f13", "--device", "1189:8890"},
		{"key", "--device=1189:8890", "--on", "press"},
		{"key", "--on=press", "--device=1189:8890"},
		{"key", "--device=1189:8890", "--help", "f13"},
		{"key", "--device=1189:8890", "--write"},
		{"key", "--device=1189:8890", "--x=1"},
		{"trigger", "--device=1189:8890"},
		{"macro", "--device=1189:8890"},
		{"mouse", "--device=1189:8890"},
		{"media", "--device=1189:8890"},
		{"multi", "--device=1189:8890"},
		{"rgb", "--device=1189:8890"},
		{"led", "--device=1189:8890"},
		{"restore", "--device=1189:8890"},
		{"key", "key1"},
		{"key", "key2"},
		{"key", "knob-right"},
		{"key", "key2", "f13", "extra"},
		{"key", "key13", "f13"},
		{"key", "knob5-left", "f13"},
		{"--layer", "1"},
		{"--layer=1"},
		{"key", "--layer"},
		{"key", "--layer="},
		{"key", "--layer", "1"},
		{"key", "--layer=1"},
		{"key", "f13", "--layer"},
		{"key", "f13", "--layer="},
		{"key", "f13", "--layer", "0"},
		{"key", "f13", "--layer=0"},
		{"key", "f13", "--layer", "16"},
		{"key", "f13", "--layer=16"},
		{"key", "f13", "--layer", "-1"},
		{"key", "f13", "--layer", "+1"},
		{"key", "f13", "--layer", "01"},
		{"key", "f13", "--layer", "abc"},
		{"key", "f13", "--layer", "1", "--layer", "2"},
		{"key", "f13", "--layer=1", "--layer=1"},
		{"trigger", "release", "--layer", "1"},
		{"trigger", "release", "--layer=1"},
		{"rgb", "off", "--layer", "1"},
		{"rgb", "off", "--layer=1"},
		{"led", "reactive", "--layer", "1"},
		{"led", "reactive", "--layer=1"},
		{"key", "--help", "--layer=1"},
	}
	for _, flag := range []string{"--device", "--report", "--capture-root", "--json", "--yes", "--dry-run", "--write", "--target", "--path", "--key", "--modifiers", "--trigger", "--lighting", "--colour", "--rgb-mode", "--red", "--expect-identifier", "--expect-version", "--json=false", "--yes=false"} {
		cases = append(cases, []string{"key", "f13", flag}, []string{"trigger", "release", flag}, []string{"rgb", "off", flag}, []string{"led", "off", flag}, []string{"key", "--help", flag})
	}
	access := publicAccess{discover: func() ([]Candidate, error) { t.Fatal("discovery on invalid input"); return nil, nil }}
	for _, args := range cases {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			var out, diagnostic bytes.Buffer
			err := runPublic(args, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
			checkPublicHeader(t, diagnostic.String())
			if err == nil || ExitCode(err) != 2 || out.Len() != 0 || diagnostic.Len() == 0 {
				t.Fatal(err, out.String(), diagnostic.String())
			}
		})
	}
	for command, want := range map[string]string{
		"key":     `key requires a key combination, for example "wonkey key f13"; run "wonkey key --help" for supported keys`,
		"trigger": `trigger requires press, release or both, for example "wonkey trigger release"; run "wonkey trigger --help" for values`,
		"macro":   `macro requires a comma-separated key list, for example "wonkey macro ctrl+c,ctrl+v" or "wonkey macro a,b,c"; run "wonkey macro --help" for options`,
		"mouse":   `mouse requires buttons or wheel direction, for example "wonkey mouse left"; run "wonkey mouse --help" for options`,
		"media":   `media requires a media action, for example "wonkey media volumeup"; run "wonkey media --help" for actions`,
		"rgb":     `rgb requires a lighting mode, for example "wonkey rgb static 0000ff" or "wonkey rgb off"; run "wonkey rgb --help" for modes`,
		"led":     `led requires a mode, for example "wonkey led reactive" or "wonkey led off"; run "wonkey led --help" for modes`,
	} {
		var out, diagnostic bytes.Buffer
		err := runPublic([]string{command}, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
		if err == nil || ExitCode(err) != 2 || out.Len() != 0 || err.Error() != want || !strings.Contains(strings.ReplaceAll(diagnostic.String(), "\n", " "), want) {
			t.Fatalf("%s: err=%v diagnostic=%q", command, err, diagnostic.String())
		}
	}
	for _, badLED := range []string{"on", "pulse", "static", "2", "256"} {
		want := fmt.Sprintf("invalid led mode %q; use off, reactive or cycle", badLED)
		var out, diagnostic bytes.Buffer
		err := runPublic([]string{"led", badLED}, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
		if err == nil || ExitCode(err) != 2 || out.Len() != 0 || err.Error() != want || !strings.Contains(strings.ReplaceAll(diagnostic.String(), "\n", " "), want) {
			t.Fatalf("led %s: err=%v diagnostic=%q", badLED, err, diagnostic.String())
		}
	}
}

func TestPublicHelpNoAccess(t *testing.T) {
	access := publicAccess{discover: func() ([]Candidate, error) { t.Fatal("help accessed devices"); return nil, nil }}
	for _, args := range [][]string{{"--help"}, {"-h"}, {"key", "--help"}, {"trigger", "--help"}, {"macro", "--help"}, {"mouse", "--help"}, {"media", "--help"}, {"rgb", "--help"}, {"led", "--help"}, {"key", "f13", "--help"}, {"key", "key2", "f13", "--help"}, {"trigger", "release", "--help"}, {"rgb", "off", "-h"}, {"led", "reactive", "-h"}} {
		var out bytes.Buffer
		if err := runPublic(args, &cliRuntime{strings.NewReader(""), &out, io.Discard}, access); err != nil {
			t.Fatal(err)
		}
		checkPublicHeader(t, out.String())
		if strings.Contains(out.String(), "One key, to rule them all.") {
			t.Fatal(out.String())
		}
		if (args[0] == "--help" || args[0] == "-h") && (!strings.HasPrefix(out.String(), "1️⃣ WonKey\n\nInspect and configure supported macropads.\n") || !strings.Contains(out.String(), "[CONTROL]") || !strings.Contains(out.String(), "--layer N")) {
			t.Fatal(out.String())
		}
		if (args[0] == "key" || args[0] == "macro" || args[0] == "mouse" || args[0] == "media") && (!strings.Contains(out.String(), "[CONTROL]") || !strings.Contains(out.String(), "[--layer N]") || !strings.Contains(out.String(), "Controls (multi-control devices, default: key1):")) {
			t.Fatal(out.String())
		}
		for _, removed := range []string{"--on", "--report", "--json", "--yes", "--dry-run", "advanced", "wonkey set", "Apply result", "restore", "wonkey multi", "At [Y/n]"} {
			if strings.Contains(out.String(), removed) {
				t.Fatal(removed, out.String())
			}
		}
		if !strings.Contains(out.String(), "Usage:") || !strings.Contains(out.String(), "--device N") || strings.Contains(out.String(), "\x1b") {
			t.Fatal(out.String())
		}
	}
}

func TestPublicWorkflow(t *testing.T) {
	for _, name := range []string{"key-write", "trigger-write", "rgb-write", "rgb-mode-cycle-slow", "rgb-mode-cycle-fast", "rgb-mode-off", "clear-modifiers", "first-device", "second-device", "multiple-missing-device", "query", "query-multiple", "zero", "incompatible", "out-of-range", "no-op", "identity-changed", "version-changed", "settings-changed", "became-no-op", "mismatch", "echo", "deadline", "unsupported", "query-failed", "discover-failed", "wrong-path", "wrong-model", "missing-settings", "short-settings", "bad-settings"} {
		t.Run(name, func(t *testing.T) {
			args := []string{"key", "f13"}
			if name == "trigger-write" {
				args = []string{"trigger", "release"}
			}
			if name == "rgb-write" {
				args = []string{"rgb", "static", "0000ff"}
			}
			if mode, ok := strings.CutPrefix(name, "rgb-mode-"); ok {
				args = []string{"rgb", strings.ToUpper(mode)}
			}
			if (name == "query" || name == "query-multiple") && name != "query-failed" {
				args = nil
			}
			if name == "no-op" {
				args = []string{"key", "enter"}
			}
			multiple := name == "first-device" || name == "second-device" || name == "multiple-missing-device" || name == "query-multiple" || name == "out-of-range"
			switch name {
			case "first-device":
				args = append(args, "--device", "1")
			case "second-device":
				args = append(args, "--device=2")
			case "out-of-range":
				args = append(args, "--device", "3")
			}
			first := newSettingsTransport()
			if strings.HasPrefix(name, "rgb-mode-") {
				first.current[124] = 2
			}
			if name == "unsupported" {
				first.current[3] = 2
			}
			fresh := &backupCheckingTransport{settingsTransport: newSettingsTransport()}
			if strings.HasPrefix(name, "rgb-mode-") {
				fresh.current = first.current
			}
			if name == "clear-modifiers" {
				first.current[2], fresh.current[2] = 15, 15
			}
			var out, diagnostic bytes.Buffer
			queried, applied := false, false
			var queriedPaths []string
			wantPath := "1-1.2"
			if name == "second-device" {
				wantPath = "1-1.3"
			}
			access := publicAccess{
				discover: func() ([]Candidate, error) {
					if name == "discover-failed" {
						return nil, fmt.Errorf("discovery failed")
					}
					if name == "zero" {
						return nil, nil
					}
					cs := []Candidate{{PhysicalPath: "1-1.2", Compatible: name != "incompatible"}}
					if multiple {
						cs = append(cs, Candidate{PhysicalPath: "1-1.3", Compatible: true})
					}
					return cs, nil
				},
				query: func(c Candidate) (CaptureResult, error) {
					queried = true
					queriedPaths = append(queriedPaths, c.PhysicalPath)
					if name != "query-multiple" && c.PhysicalPath != wantPath {
						t.Fatal(c)
					}
					if name == "query-failed" {
						return CaptureResult{}, fmt.Errorf("query failed")
					}
					q, err := queryCapture(first, true)
					q.result.PhysicalPath = c.PhysicalPath
					switch name {
					case "wrong-path":
						q.result.PhysicalPath = "1-9"
					case "wrong-model":
						q.result.Identity.Model = 0
					case "missing-settings":
						q.result.Readback = nil
					case "short-settings":
						q.result.Readback.Configuration = "00"
					case "bad-settings":
						q.result.Readback.Configuration = "zz"
					}
					return q.result, err
				},
				apply: func(c Candidate, target ApplyTarget, changes configurationChanges, guard func(configuration, configuration) (bool, error)) (ApplyResult, error) {
					applied = true
					if c.PhysicalPath != wantPath || target != settingsTarget() || !strings.Contains(out.String(), " -> ") {
						t.Fatal(c, target, out.String())
					}
					switch name {
					case "identity-changed":
						fresh.identity[6] ^= 1
					case "version-changed":
						fresh.identity[4] ^= 1
					case "settings-changed":
						fresh.current[63] ^= 1
					case "became-no-op":
						fresh.current, _ = changes.configuration(fresh.current)
					case "mismatch":
						fresh.mismatch = true
					case "echo":
						fresh.failAt, fresh.failure = 5, "echo"
					case "deadline":
						fresh.failAt, fresh.failure = 5, "read-deadline"
					}
					return applySettingsConfirmed(fresh, target, changes, true, time.Second, guard, true)
				},
			}
			err := runPublic(args, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
			checkPublicHeader(t, out.String())
			if strings.Contains(diagnostic.String(), "WonKey") {
				t.Fatal("runtime error repeated the header", diagnostic.String())
			}
			failure := name == "zero" || name == "incompatible" || name == "multiple-missing-device" || name == "out-of-range" || strings.HasSuffix(name, "changed") || name == "became-no-op" || name == "mismatch" || name == "echo" || name == "deadline" || name == "unsupported" || strings.HasSuffix(name, "failed") || strings.HasPrefix(name, "wrong-") || strings.HasSuffix(name, "settings")
			if (err != nil) != failure {
				t.Fatal(err, out.String(), diagnostic.String())
			}
			success := name == "key-write" || name == "trigger-write" || name == "rgb-write" || strings.HasPrefix(name, "rgb-mode-") || name == "clear-modifiers" || name == "first-device" || name == "second-device"
			wantApply := success || strings.HasSuffix(name, "changed") || name == "became-no-op" || name == "mismatch" || name == "echo" || name == "deadline"
			if applied != wantApply {
				t.Fatal("apply", applied, err)
			}
			noQuery := name == "zero" || name == "incompatible" || name == "multiple-missing-device" || name == "out-of-range" || name == "discover-failed"
			if queried == noQuery {
				t.Fatal("query", queried, err)
			}
			if name == "multiple-missing-device" {
				for _, want := range []string{"multiple compatible devices connected; specify --device <N>:", "--device 1  XFKEY One Key Max (0112) (USB path 1-1.2)", "--device 2  XFKEY One Key Max (0112) (USB path 1-1.3)"} {
					if !strings.Contains(diagnostic.String(), want) {
						t.Fatalf("missing %q in %q", want, diagnostic.String())
					}
				}
			}
			if name == "out-of-range" && !strings.Contains(diagnostic.String(), "device 3 not found (2 compatible device(s) connected)") {
				t.Fatalf("unexpected out-of-range diagnostic: %q", diagnostic.String())
			}
			if name == "second-device" && !strings.Contains(out.String(), "[2] XFKEY One Key Max (0112)\n") {
				t.Fatalf("missing [2] heading in %q", out.String())
			}
			if name == "query-multiple" {
				if !reflect.DeepEqual(queriedPaths, []string{"1-1.2", "1-1.3"}) || !strings.Contains(out.String(), "[1] XFKEY One Key Max (0112)\n") || !strings.Contains(out.String(), "[2] XFKEY One Key Max (0112)\n") {
					t.Fatal("query-multiple did not enumerate all compatible devices", queriedPaths, out.String())
				}
			}
			checkNoUpload(t, first)
			if !wantApply || strings.HasSuffix(name, "changed") || name == "became-no-op" {
				checkNoUpload(t, fresh.settingsTransport)
			}
			if success {
				if !fresh.checked || len(fresh.packets) != 11 {
					t.Fatal("fresh query/write missing")
				}
				if !strings.HasSuffix(out.String(), "Settings saved. All 128 readback bytes match.\n") || strings.Contains(out.String(), "Records") || strings.Contains(out.String(), "Save settings?") {
					t.Fatal(out.String())
				}
			}
			if name == "trigger-write" {
				want := first.current
				want[1] = 2
				if fresh.current != want {
					t.Fatal("trigger-write changed key, modifiers, RGB, or unrelated bytes")
				}
			}
			if name == "clear-modifiers" && fresh.current[2] != 0 {
				t.Fatal("modifiers were not cleared")
			}
			if name == "rgb-write" {
				for i := range 124 {
					if first.current[i] != fresh.current[i] {
						t.Fatal("RGB changed key/unrelated byte", i)
					}
				}
			}
			if mode, ok := strings.CutPrefix(name, "rgb-mode-"); ok {
				want := first.current
				want[124] = map[string]byte{"cycle-slow": 1, "cycle-fast": 5, "off": 6}[mode]
				if fresh.current != want {
					t.Fatal("mode-only command changed colour or unrelated bytes")
				}
			}
			if name == "query" || name == "query-multiple" {
				for _, field := range []string{"\n  Key ", "\n  On ", "\n  Mode ", "\n  Colour "} {
					if !strings.Contains(out.String(), field) {
						t.Fatal("missing field", field, out.String())
					}
				}
			}
			for _, token := range []string{"wonkey-target-v1:", "Apply result", "Target", "Warning: this changes stored settings.", "Persistence after reconnect"} {
				if strings.Contains(out.String(), token) {
					t.Fatal(out.String())
				}
			}
		})
	}
}

func ch57TestAccess(t *testing.T) publicAccess {
	t.Helper()
	return publicAccess{
		discover: func() ([]Candidate, error) { return nil, nil },
		query: func(Candidate) (CaptureResult, error) {
			t.Fatal("CH57 probe reached XFKEY query")
			return CaptureResult{}, nil
		},
		apply: func(Candidate, ApplyTarget, configurationChanges, func(configuration, configuration) (bool, error)) (ApplyResult, error) {
			t.Fatal("CH57 probe reached apply")
			return ApplyResult{}, nil
		},
		applyCH57: func(string, string, ch57.DiscoveredCandidate, []ch57.Report) (ch57.ApplyResult, error) {
			t.Fatal("unexpected CH57 apply")
			return ch57.ApplyResult{}, nil
		},
		waitSayoRestart: func(string, string, sayo.DiscoveredCandidate) sayo.RestartResult {
			t.Fatal("unexpected SayoDevice restart wait")
			return sayo.RestartResult{}
		},
		querySayoVersion: func(string, string, sayo.DiscoveredCandidate) (sayo.FirmwareInfo, error) {
			t.Fatal("unexpected SayoDevice version query")
			return sayo.FirmwareInfo{}, nil
		},
	}
}

func TestPublicCH57Selection(t *testing.T) {
	for _, tc := range []struct {
		name       string
		count      int
		shortReply bool
		failure    bool
	}{
		{"single", 1, false, false},
		{"single-short-aa", 1, true, false},
		{"multiple", 2, false, false},
		{"multiple-short-aa", 2, true, false},
		{"none", 0, false, true},
		{"discovery-error", 0, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "absent")
			t.Setenv("XDG_STATE_HOME", root)
			access := ch57TestAccess(t)
			candidates := []ch57.DiscoveredCandidate{
				{Candidate: ch57.Candidate{PhysicalPath: "1-2"}, BusNumber: 1, DeviceNumber: 19},
				{Candidate: ch57.Candidate{PhysicalPath: "1-3"}, BusNumber: 1, DeviceNumber: 20},
			}
			discovered := 0
			var probedPaths []string
			access.discoverCH57 = func(sysRoot string) ([]ch57.DiscoveredCandidate, error) {
				discovered++
				if sysRoot != "/sys/bus/usb/devices" {
					t.Fatal(sysRoot)
				}
				if tc.name == "discovery-error" {
					return nil, errors.New("synthetic discovery failure")
				}
				return candidates[:tc.count], nil
			}
			access.probeCH57 = func(sysRoot, devRoot string, selected ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
				probedPaths = append(probedPaths, selected.PhysicalPath)
				if sysRoot != "/sys/bus/usb/devices" || devRoot != "/dev/bus/usb" {
					t.Fatal("wrong probe roots", selected, sysRoot, devRoot)
				}
				for _, candidate := range candidates {
					if candidate.PhysicalPath == selected.PhysicalPath && candidate != selected {
						t.Fatal("candidate binding changed")
					}
				}
				raw := append([]byte{3}, bytes.Repeat([]byte{0xab}, 64)...)
				if tc.shortReply {
					raw = []byte{0xaa}
				}
				return ch57.ProbeResult{Status: ch57.ProbeRawReport, Raw: raw, Count: len(raw), ReportDescriptorVerified: true}, nil
			}
			command, err := parsePublic(nil)
			if err != nil || len(command.changes) != 0 || command.action != nil || command.help || command.name != "" {
				t.Fatal(command, err)
			}
			var out, diagnostic bytes.Buffer
			err = runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
			if (err != nil) != tc.failure || discovered != 1 || len(probedPaths) != tc.count {
				t.Fatalf("error=%v discovered=%d probed=%v output=%q", err, discovered, probedPaths, out.String())
			}
			if tc.count > 0 {
				for i, candidate := range candidates[:tc.count] {
					wantTexts := []string{
						fmt.Sprintf("[%d] CH57x Macropad (1189:8890)", i+1),
						candidate.PhysicalPath,
						"Supports   key, mouse, media, macro, led\n  Settings   Write-only (not readable over USB)",
					}
					if !tc.shortReply {
						wantTexts = append(wantTexts, "03"+strings.Repeat("ab", 64))
					}
					for _, text := range wantTexts {
						if !strings.Contains(out.String(), text) {
							t.Fatal("missing output", text, out.String())
						}
					}
				}
				for _, unwanted := range []string{"Layout", "Controls", "Status", "Connected"} {
					if strings.Contains(out.String(), unwanted) {
						t.Fatal("unexpected CH57 card field", unwanted, out.String())
					}
				}
				if tc.shortReply {
					for _, unwanted := range []string{"Descriptor bytes", "Descriptor hex", "Input bytes", "Input hex", "Raw input is not decoded settings"} {
						if strings.Contains(out.String(), unwanted) {
							t.Fatal("unexpected raw probe diagnostic on short 0xaa reply", unwanted, out.String())
						}
					}
				}
				if strings.Count(out.String(), "CH57x Macropad (1189:8890)\n") != tc.count {
					t.Fatal("unexpected probe section count", out.String())
				}
			}
			for _, text := range []string{"Select a device", "Device number [cancel]: ", "Settings saved", "Save settings?"} {
				if strings.Contains(out.String(), text) {
					t.Fatal("unexpected prompt or write claim", text, out.String())
				}
			}
			if _, err := os.Stat(root); !os.IsNotExist(err) {
				t.Fatal("probe created backup storage", err)
			}
		})
	}
}

func TestPublicUnifiedDiscoveryAndGuards(t *testing.T) {
	t.Run("mixed-read-enumerates-all", func(t *testing.T) {
		queried, probed := 0, 0
		transport := newSettingsTransport()
		access := publicAccess{
			discover: func() ([]Candidate, error) {
				return []Candidate{{PhysicalPath: "1-1", Compatible: true, VendorNode: NodeMetadata{Path: "/dev/hidraw0"}}}, nil
			},
			discoverCH57: func(string) ([]ch57.DiscoveredCandidate, error) {
				return []ch57.DiscoveredCandidate{{Candidate: ch57.Candidate{PhysicalPath: "1-2"}, BusNumber: 1, DeviceNumber: 19}}, nil
			},
			query: func(c Candidate) (CaptureResult, error) {
				queried++
				if c.PhysicalPath != "1-1" {
					t.Fatal(c)
				}
				q, err := queryCapture(transport, true)
				q.result.PhysicalPath = c.PhysicalPath
				return q.result, err
			},
			probeCH57: func(_ string, _ string, selected ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
				probed++
				if selected.PhysicalPath != "1-2" {
					t.Fatal(selected)
				}
				return ch57.ProbeResult{Status: ch57.ProbeRawReport, Raw: []byte{0xaa}, Count: 1}, nil
			},
		}
		var out bytes.Buffer
		err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, io.Discard}, access)
		if err != nil || queried != 1 || probed != 1 {
			t.Fatalf("err=%v queried=%d probed=%d out=%q", err, queried, probed, out.String())
		}
		checkPublicHeader(t, out.String())
		for _, text := range []string{"[1] XFKEY One Key Max (0112)", "1-1", "Supports   key, trigger, mouse, media, macro, rgb", "Key        enter", "On         press", "Mode       cycle-slow", "Colour     #FFFFFF", "[2] CH57x Macropad (1189:8890)", "1-2", "Supports   key, mouse, media, macro, led\n  Settings   Write-only (not readable over USB)"} {
			if !strings.Contains(out.String(), text) {
				t.Fatal("missing mixed read entry", text, out.String())
			}
		}
		for _, unwanted := range []string{"Identifier", "Version", "Layout", "Controls", "Status", "Connected"} {
			if strings.Contains(out.String(), unwanted) {
				t.Fatal("unexpected field in mixed read", unwanted, out.String())
			}
		}
		if strings.Contains(out.String(), "Select a device") {
			t.Fatal("unexpected selection prompt on bare read", out.String())
		}
	})
	t.Run("mixed-write-selection", func(t *testing.T) {
		for _, tc := range []struct {
			args          []string
			wantXFKEY     bool
			wantCH57      bool
			wantErr       bool
			wantDiag      string
			wantOutSubstr string
		}{
			{[]string{"key", "f13", "--device", "1"}, true, false, false, "", "[1] XFKEY One Key Max (0112)"},
			{[]string{"key", "f13", "--device", "2"}, false, true, false, "", "[2] CH57x Macropad (1189:8890)"},
			{[]string{"key", "f13"}, false, false, true, "--device 1  XFKEY One Key Max (0112) (USB path 1-1)\n  --device 2  CH57x Macropad (1189:8890) (USB path 1-2)", ""},
			{[]string{"key", "f13", "--device", "3"}, false, false, true, "device 3 not found (2 compatible device(s) connected)", ""},
		} {
			queried, applied, probedCH57, appliedCH57 := false, false, false, false
			first := newSettingsTransport()
			fresh := &backupCheckingTransport{settingsTransport: newSettingsTransport()}
			access := publicAccess{
				discover: func() ([]Candidate, error) {
					return []Candidate{{PhysicalPath: "1-1", Compatible: true, VendorNode: NodeMetadata{Path: "/dev/hidraw0"}}}, nil
				},
				discoverCH57: func(string) ([]ch57.DiscoveredCandidate, error) {
					return []ch57.DiscoveredCandidate{{Candidate: ch57.Candidate{PhysicalPath: "1-2"}, BusNumber: 1, DeviceNumber: 19}}, nil
				},
				query: func(c Candidate) (CaptureResult, error) {
					queried = true
					q, err := queryCapture(first, true)
					q.result.PhysicalPath = c.PhysicalPath
					return q.result, err
				},
				apply: func(_ Candidate, target ApplyTarget, changes configurationChanges, guard func(configuration, configuration) (bool, error)) (ApplyResult, error) {
					applied = true
					return applySettingsConfirmed(fresh, target, changes, true, time.Second, guard, true)
				},
				probeCH57: func(_ string, _ string, _ ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
					probedCH57 = true
					return ch57.ProbeResult{Status: ch57.ProbeRawReport, Raw: []byte{0xaa}, Count: 1}, nil
				},
				applyCH57: func(_ string, _ string, _ ch57.DiscoveredCandidate, _ []ch57.Report) (ch57.ApplyResult, error) {
					appliedCH57 = true
					return ch57.ApplyResult{WriteAttempted: true, ReportsWritten: 4}, nil
				},
			}
			var out, diagnostic bytes.Buffer
			err := runPublic(tc.args, &cliRuntime{strings.NewReader("y\n"), &out, &diagnostic}, access)
			if (err != nil) != tc.wantErr || queried != tc.wantXFKEY || applied != tc.wantXFKEY || probedCH57 != tc.wantCH57 || appliedCH57 != tc.wantCH57 {
				t.Fatalf("args=%v err=%v queried=%v applied=%v probedCH57=%v appliedCH57=%v out=%q diag=%q", tc.args, err, queried, applied, probedCH57, appliedCH57, out.String(), diagnostic.String())
			}
			if tc.wantDiag != "" && !strings.Contains(diagnostic.String(), tc.wantDiag) {
				t.Fatalf("args=%v missing %q in diagnostic %q", tc.args, tc.wantDiag, diagnostic.String())
			}
			if tc.wantOutSubstr != "" && !strings.Contains(out.String(), tc.wantOutSubstr) {
				t.Fatalf("args=%v missing %q in output %q", tc.args, tc.wantOutSubstr, out.String())
			}
		}
	})
	t.Run("physical-path-sorting", func(t *testing.T) {
		var queriedPaths []string
		transport := newSettingsTransport()
		access := publicAccess{
			discover: func() ([]Candidate, error) {
				return []Candidate{
					{PhysicalPath: "7-1.4.3.1", Compatible: true},
					{PhysicalPath: "1-1.10", Compatible: true},
					{PhysicalPath: "1-1.2", Compatible: true},
				}, nil
			},
			discoverCH57: func(string) ([]ch57.DiscoveredCandidate, error) {
				return []ch57.DiscoveredCandidate{
					{Candidate: ch57.Candidate{PhysicalPath: "2-1"}, BusNumber: 2, DeviceNumber: 3},
				}, nil
			},
			query: func(c Candidate) (CaptureResult, error) {
				queriedPaths = append(queriedPaths, c.PhysicalPath)
				q, err := queryCapture(transport, true)
				q.result.PhysicalPath = c.PhysicalPath
				return q.result, err
			},
			probeCH57: func(_ string, _ string, selected ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
				queriedPaths = append(queriedPaths, selected.PhysicalPath)
				return ch57.ProbeResult{Status: ch57.ProbeRawReport, Raw: []byte{0xaa}, Count: 1}, nil
			},
		}
		var out, diagnostic bytes.Buffer
		if err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access); err != nil {
			t.Fatal(err)
		}
		wantOrder := []string{"1-1.2", "1-1.10", "2-1", "7-1.4.3.1"}
		if !reflect.DeepEqual(queriedPaths, wantOrder) {
			t.Fatalf("got order %v, want %v", queriedPaths, wantOrder)
		}
		for _, heading := range []string{
			"[1] XFKEY One Key Max (0112)\n  USB path   1-1.2\n",
			"[2] XFKEY One Key Max (0112)\n  USB path   1-1.10\n",
			"[3] CH57x Macropad (1189:8890)\n  USB path   2-1\n",
			"[4] XFKEY One Key Max (0112)\n  USB path   7-1.4.3.1\n",
		} {
			if !strings.Contains(out.String(), heading) {
				t.Fatalf("missing %q in %q", heading, out.String())
			}
		}
		out.Reset()
		diagnostic.Reset()
		err := runPublic([]string{"key", "f13"}, &cliRuntime{strings.NewReader("y\n"), &out, &diagnostic}, access)
		wantErr := "Error: multiple compatible devices connected; specify --device <N>:\n" +
			"  --device 1  XFKEY One Key Max (0112) (USB path 1-1.2)\n" +
			"  --device 2  XFKEY One Key Max (0112) (USB path 1-1.10)\n" +
			"  --device 3  CH57x Macropad (1189:8890) (USB path 2-1)\n" +
			"  --device 4  XFKEY One Key Max (0112) (USB path 7-1.4.3.1)\n" +
			"Run \"wonkey --help\" for commands.\n"
		if err == nil || diagnostic.String() != wantErr {
			t.Fatalf("err=%v diagnostic=%q want=%q", err, diagnostic.String(), wantErr)
		}
	})
	t.Run("ch57-live-writes", func(t *testing.T) {
		for _, tc := range []struct {
			args       []string
			wantChange string
			wantCount  int
		}{
			{[]string{"key", "f13"}, "  key1: write-only -> f13\n", 4},
			{[]string{"key", "key2", "ctrl+shift+f13", "--layer", "2"}, "  key2 (layer 2): write-only -> ctrl+shift+f13\n", 4},
			{[]string{"mouse", "left"}, "  key1: write-only -> mouse left (x=0, y=0, wheel=0)\n", 3},
			{[]string{"mouse", "knob1-press", "middle", "--layer=15"}, "  knob1-press (layer 15): write-only -> mouse middle (x=0, y=0, wheel=0)\n", 3},
			{[]string{"media", "volumeup"}, "  key1: write-only -> media volumeup (0x00e9)\n", 3},
			{[]string{"media", "knob-right", "volumeup", "--layer", "3"}, "  knob-right (layer 3): write-only -> media volumeup (0x00e9)\n", 3},
			{[]string{"macro", "a,b,c,d,e"}, "  key1: write-only -> a,b,c,d,e\n", 8},
			{[]string{"macro", "key3", "ctrl+c,ctrl+v", "--layer=4"}, "  key3 (layer 4): write-only -> ctrl+c,ctrl+v\n", 5},
			{[]string{"led", "off"}, "  led: write-only -> off\n", 3},
			{[]string{"led", "reactive"}, "  led: write-only -> reactive\n", 3},
			{[]string{"led", "cycle"}, "  led: write-only -> cycle\n", 3},
		} {
			for _, mode := range []string{"save", "refused", "uncertain"} {
				t.Run(strings.Join(tc.args, " ")+"/"+mode, func(t *testing.T) {
					access := ch57TestAccess(t)
					target := ch57.DiscoveredCandidate{Candidate: ch57.Candidate{PhysicalPath: "7-1.4.3.1"}, BusNumber: 7, DeviceNumber: 8}
					access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
						return []ch57.DiscoveredCandidate{target}, nil
					}
					probed, applied := false, false
					access.probeCH57 = func(sysRoot, devRoot string, selected ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
						probed = true
						if sysRoot != "/sys/bus/usb/devices" || devRoot != "/dev/bus/usb" || selected != target {
							t.Fatal(sysRoot, devRoot, selected)
						}
						return ch57.ProbeResult{Status: ch57.ProbeRawReport, Raw: []byte{0xaa}, Count: 1}, nil
					}
					access.applyCH57 = func(sysRoot, devRoot string, selected ch57.DiscoveredCandidate, reports []ch57.Report) (ch57.ApplyResult, error) {
						applied = true
						if sysRoot != "/sys/bus/usb/devices" || devRoot != "/dev/bus/usb" || selected != target || len(reports) != tc.wantCount {
							t.Fatalf("sys=%s dev=%s selected=%+v reports=%d want=%d", sysRoot, devRoot, selected, len(reports), tc.wantCount)
						}
						switch mode {
						case "refused":
							return ch57.ApplyResult{WriteAttempted: false}, errors.New("synthetic refused error")
						case "uncertain":
							return ch57.ApplyResult{WriteAttempted: true, ReportsWritten: 1}, errors.New("synthetic write error")
						default:
							return ch57.ApplyResult{WriteAttempted: true, ReportsWritten: len(reports)}, nil
						}
					}
					var out, diagnostic bytes.Buffer
					err := runPublic(tc.args, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
					wantErr := mode == "refused" || mode == "uncertain"
					if (err != nil) != wantErr || !probed || !applied {
						t.Fatalf("mode=%s err=%v probed=%v applied=%v out=%q diag=%q", mode, err, probed, applied, out.String(), diagnostic.String())
					}
					if !strings.Contains(out.String(), tc.wantChange) || strings.Contains(out.String(), "Save settings?") {
						t.Fatalf("missing preview or unexpected prompt in %q", out.String())
					}
					switch mode {
					case "save":
						if !strings.Contains(out.String(), "Settings saved to CH57x Macropad.\n") {
							t.Fatalf("missing save confirmation in %q", out.String())
						}
					case "refused":
						if !strings.Contains(out.String(), "Stopped before settings upload.\nStop. No automatic retry or rollback.\n") {
							t.Fatalf("missing refused stop message in %q", out.String())
						}
					case "uncertain":
						if !strings.Contains(out.String(), "Device state uncertain. A submitted write can still complete.\nStop. No automatic retry or rollback.\n") {
							t.Fatalf("missing uncertain state message in %q", out.String())
						}
					}
				})
			}
		}
	})
	t.Run("ch57-capability-gating", func(t *testing.T) {
		for _, tc := range []struct {
			args []string
			want string
		}{
			{[]string{"trigger", "release"}, "CH57x Macropad (1189:8890) does not support trigger (key release triggers)"},
			{[]string{"trigger", "press"}, "CH57x Macropad (1189:8890) does not support trigger (key release triggers)"},
			{[]string{"trigger", "both"}, "CH57x Macropad (1189:8890) does not support trigger (key release triggers)"},
			{[]string{"key", "mute"}, "CH57x Macropad (1189:8890) supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only"},
			{[]string{"key", "lang2"}, "CH57x Macropad (1189:8890) supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only"},
			{[]string{"key", "execute"}, "CH57x Macropad (1189:8890) supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only"},
			{[]string{"macro", "a,b", "--interval", "50"}, "CH57x Macropad (1189:8890) does not support --interval or --repeat"},
			{[]string{"macro", "a,b", "--repeat", "2"}, "CH57x Macropad (1189:8890) does not support --interval or --repeat"},
			{[]string{"macro", "a,b,c,d,e,f"}, "CH57x Macropad (1189:8890) supports up to 5 strokes per macro"},
			{[]string{"macro", "ctrl+a,ctrl+b,ctrl+c,ctrl+d,ctrl+e,ctrl+f"}, "CH57x Macropad (1189:8890) supports up to 5 strokes per macro"},
			{[]string{"macro", "a,lang2"}, "CH57x Macropad (1189:8890) supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only"},
			{[]string{"macro", "ctrl+lang2"}, "CH57x Macropad (1189:8890) supports keys a-z, 0-9, and f1-f24 (usages 0x04..0x73) only"},
			{[]string{"rgb", "static", "0000ff"}, `CH57x Macropad (1189:8890) does not support rgb; use "wonkey led" instead`},
			{[]string{"rgb", "static"}, `CH57x Macropad (1189:8890) does not support rgb; use "wonkey led" instead`},
			{[]string{"rgb", "breathe"}, `CH57x Macropad (1189:8890) does not support rgb; use "wonkey led" instead`},
			{[]string{"rgb", "off"}, `CH57x Macropad (1189:8890) does not support rgb; use "wonkey led" instead`},
			{[]string{"media", "play"}, "CH57x Macropad (1189:8890) does not support that media action"},
			{[]string{"media", "eject"}, "CH57x Macropad (1189:8890) does not support that media action"},
			{[]string{"media", "bookmarks"}, "CH57x Macropad (1189:8890) does not support that media action"},
			{[]string{"media", "0x0001"}, "CH57x Macropad (1189:8890) does not support that media action"},
			{[]string{"mouse", "none"}, "CH57x Macropad (1189:8890) mouse action requires buttons, movement or wheel"},
			{[]string{"mouse", "left", "--wheel", "1"}, "CH57x Macropad (1189:8890) does not combine mouse wheel with buttons or movement"},
			{[]string{"mouse", "wheelup", "--x", "5"}, "CH57x Macropad (1189:8890) does not combine mouse wheel with buttons or movement"},
		} {
			access := ch57TestAccess(t)
			access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
				return []ch57.DiscoveredCandidate{{Candidate: ch57.Candidate{PhysicalPath: "1-2"}, BusNumber: 1, DeviceNumber: 19}}, nil
			}
			access.probeCH57 = func(string, string, ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
				t.Fatal("unsupported CH57 capability probed device")
				return ch57.ProbeResult{}, nil
			}
			var diagnostic bytes.Buffer
			err := runPublic(tc.args, &cliRuntime{strings.NewReader("y\n"), io.Discard, &diagnostic}, access)
			if err == nil || ExitCode(err) != 1 || err.Error() != tc.want || !strings.Contains(strings.ReplaceAll(diagnostic.String(), "\n", " "), tc.want) {
				t.Fatalf("args=%v err=%v diagnostic=%q want=%q", tc.args, err, diagnostic.String(), tc.want)
			}
		}
		for _, control := range []ch57.Control{
			ch57.Key1, ch57.Key2, ch57.Key3, ch57.Key4, ch57.Key5, ch57.Key6,
			ch57.Key7, ch57.Key8, ch57.Key9, ch57.Key10, ch57.Key11, ch57.Key12,
			ch57.KnobLeft, ch57.KnobPress, ch57.KnobRight,
			ch57.Knob1Left, ch57.Knob1Press, ch57.Knob1Right,
			ch57.Knob2Left, ch57.Knob2Press, ch57.Knob2Right,
			ch57.Knob3Left, ch57.Knob3Press, ch57.Knob3Right,
		} {
			c, err := parsePublic([]string{"key", string(control), "f13", "--layer", "15"})
			if err != nil {
				t.Fatal(control, err)
			}
			if err := c.checkCH57Capabilities(); err != nil {
				t.Fatal(control, err)
			}
		}
	})
	t.Run("xfkey-capability-gating", func(t *testing.T) {
		c, err := parsePublic([]string{"key", "key1", "f13"})
		if err != nil {
			t.Fatal(err)
		}
		if err := c.checkXFKEYCapabilities(); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			args []string
			want string
		}{
			{[]string{"led", "off"}, `XFKEY One Key Max (0112) does not support led; use "wonkey rgb" instead`},
			{[]string{"led", "reactive"}, `XFKEY One Key Max (0112) does not support led; use "wonkey rgb" instead`},
			{[]string{"led", "cycle"}, `XFKEY One Key Max (0112) does not support led; use "wonkey rgb" instead`},
			{[]string{"macro", "ctrl+c,ctrl+v"}, "XFKEY One Key Max (0112) does not support modifiers in macro sequences; use base key names only"},
			{[]string{"macro", "ctrl+a"}, "XFKEY One Key Max (0112) does not support modifiers in macro sequences; use base key names only"},
			{[]string{"macro", "ctrl,shift"}, "XFKEY One Key Max (0112) does not support modifiers in macro sequences; use base key names only"},
			{[]string{"key", "key2", "f13"}, "XFKEY One Key Max (0112) has a single key and does not support key2"},
			{[]string{"key", "KEY12", "f13"}, "XFKEY One Key Max (0112) has a single key and does not support key12"},
			{[]string{"media", "knob-right", "volumeup"}, "XFKEY One Key Max (0112) has a single key and does not support knob-right"},
			{[]string{"mouse", "knob1-press", "middle"}, "XFKEY One Key Max (0112) has a single key and does not support knob1-press"},
			{[]string{"macro", "knob3-left", "a,b"}, "XFKEY One Key Max (0112) has a single key and does not support knob3-left"},
			{[]string{"key", "f13", "--layer", "1"}, "XFKEY One Key Max (0112) does not support --layer"},
			{[]string{"key", "f13", "--layer=2"}, "XFKEY One Key Max (0112) does not support --layer"},
			{[]string{"macro", "a,b", "--layer", "3"}, "XFKEY One Key Max (0112) does not support --layer"},
			{[]string{"mouse", "left", "--layer=4"}, "XFKEY One Key Max (0112) does not support --layer"},
			{[]string{"media", "volumeup", "--layer", "15"}, "XFKEY One Key Max (0112) does not support --layer"},
		} {
			access := publicAccess{
				discover: func() ([]Candidate, error) {
					return []Candidate{{PhysicalPath: "1-1", Compatible: true}}, nil
				},
				query: func(Candidate) (CaptureResult, error) {
					t.Fatal("unsupported XFKEY capability queried device")
					return CaptureResult{}, nil
				},
				apply: func(Candidate, ApplyTarget, configurationChanges, func(configuration, configuration) (bool, error)) (ApplyResult, error) {
					t.Fatal("unsupported XFKEY capability reached apply")
					return ApplyResult{}, nil
				},
			}
			var diagnostic bytes.Buffer
			err := runPublic(tc.args, &cliRuntime{strings.NewReader("y\n"), io.Discard, &diagnostic}, access)
			if err == nil || ExitCode(err) != 1 || err.Error() != tc.want || !strings.Contains(strings.ReplaceAll(diagnostic.String(), "\n", " "), tc.want) {
				t.Fatalf("args=%v err=%v diagnostic=%q want=%q", tc.args, err, diagnostic.String(), tc.want)
			}
		}
	})
}

func TestPublicCH57ProbeFailures(t *testing.T) {
	for _, result := range []ch57.ProbeResult{
		{Status: ch57.ProbeRefused},
		{Status: ch57.ProbeDescriptorFailed, ReportDescriptor: []byte{6, 0, 0xfe}, ReportDescriptorCount: 3},
		{Status: ch57.ProbeTransferFailed, Count: 0, ReportDescriptorVerified: true},
		{Status: ch57.ProbeInvalidReport, Raw: []byte{3, 0xaa}, Count: 2, ReportDescriptorVerified: true},
		{Status: ch57.ProbeCloseFailed, Raw: []byte{3, 0xbb}, Count: 2, ReportDescriptorVerified: true},
	} {
		t.Run(string(result.Status), func(t *testing.T) {
			access := ch57TestAccess(t)
			access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
				return []ch57.DiscoveredCandidate{{Candidate: ch57.Candidate{PhysicalPath: "1-2"}}}, nil
			}
			failure := errors.New("synthetic probe failure")
			probes := 0
			access.probeCH57 = func(string, string, ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
				probes++
				return result, failure
			}
			var out, diagnostic bytes.Buffer
			err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
			if !errors.Is(err, failure) || ExitCode(err) != 1 || probes != 1 || !strings.Contains(diagnostic.String(), failure.Error()) {
				t.Fatal(err, probes, diagnostic.String())
			}
			for _, text := range []string{"[1] CH57x Macropad (1189:8890)", "1-2", "Supports   key, mouse, media, macro, led", string(result.Status)} {
				if !strings.Contains(out.String(), text) {
					t.Fatal("missing failure output", text, out.String())
				}
			}
			if result.ReportDescriptor != nil && (!strings.Contains(out.String(), "Descriptor bytes 3") || !strings.Contains(out.String(), fmt.Sprintf("%x", result.ReportDescriptor))) {
				t.Fatal("missing descriptor diagnostic", out.String())
			}
			if result.Raw != nil && (!strings.Contains(out.String(), "Input bytes 2") || !strings.Contains(out.String(), fmt.Sprintf("%x", result.Raw))) {
				t.Fatal("missing input diagnostic", out.String())
			}
		})
	}
	t.Run("continues-after-failure", func(t *testing.T) {
		access := ch57TestAccess(t)
		access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
			return []ch57.DiscoveredCandidate{
				{Candidate: ch57.Candidate{PhysicalPath: "1-2"}},
				{Candidate: ch57.Candidate{PhysicalPath: "1-3"}},
			}, nil
		}
		failure := errors.New("synthetic probe failure")
		probes := 0
		access.probeCH57 = func(_ string, _ string, selected ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
			probes++
			if selected.PhysicalPath == "1-2" {
				return ch57.ProbeResult{Status: ch57.ProbeRefused}, failure
			}
			return ch57.ProbeResult{Status: ch57.ProbeRawReport, Raw: []byte{0xaa}, Count: 1}, nil
		}
		var out, diagnostic bytes.Buffer
		err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
		if !errors.Is(err, failure) || ExitCode(err) != 1 || probes != 2 {
			t.Fatalf("err=%v probes=%d diag=%q", err, probes, diagnostic.String())
		}
		for _, text := range []string{"[1] CH57x Macropad (1189:8890)", "1-2", string(ch57.ProbeRefused), "[2] CH57x Macropad (1189:8890)", "1-3", "Settings   Write-only (not readable over USB)"} {
			if !strings.Contains(out.String(), text) {
				t.Fatalf("missing %q in %q", text, out.String())
			}
		}
	})
}

func TestPublicCH57OutputFailure(t *testing.T) {
	for _, needle := range []string{"[1] CH57x Macropad (1189:8890)", "USB path", "Supports", "Settings", "Input hex"} {
		for _, short := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/short=%v", needle, short), func(t *testing.T) {
				access := ch57TestAccess(t)
				access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
					return []ch57.DiscoveredCandidate{{Candidate: ch57.Candidate{PhysicalPath: "1-2"}}}, nil
				}
				probes := 0
				access.probeCH57 = func(string, string, ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
					probes++
					return ch57.ProbeResult{Status: ch57.ProbeRawReport, Raw: []byte{3}, Count: 1}, nil
				}
				input := strings.NewReader("1\n")
				out := &failingHumanOutput{needle: needle, short: short}
				err := runPublic(nil, &cliRuntime{input, out, io.Discard}, access)
				want := io.ErrClosedPipe
				if short {
					want = io.ErrShortWrite
				}
				wantProbes := 0
				if needle == "Settings" || needle == "Input hex" {
					wantProbes = 1
				}
				if !errors.Is(err, want) || probes != wantProbes || input.Len() != len("1\n") {
					t.Fatal(err, probes, input.Len())
				}
			})
		}
	}
}

func TestSelectedCandidatePin(t *testing.T) {
	original := Candidate{PhysicalPath: "1-1.2", SysfsPath: "/synthetic", Revision: "0100", Compatible: true, USBDescriptor: usbDescriptorHex, Reports: reportDescriptorHex, VendorNode: NodeMetadata{Path: "/synthetic/hidraw4", identity: [3]uint64{1, 2, 3}}}
	if !sameCandidate(original, original) {
		t.Fatal("self mismatch")
	}
	for _, mutate := range []func(*Candidate){
		func(c *Candidate) { c.PhysicalPath = "1-1.3" }, func(c *Candidate) { c.SysfsPath = "/other" }, func(c *Candidate) { c.Revision = "0200" }, func(c *Candidate) { c.Compatible = false }, func(c *Candidate) { c.USBDescriptor = "bad" }, func(c *Candidate) { c.Reports[3] = "bad" }, func(c *Candidate) { c.VendorNode.Path = "/synthetic/hidraw5" }, func(c *Candidate) { c.VendorNode.identity[1]++ },
	} {
		changed := original
		mutate(&changed)
		if sameCandidate(original, changed) {
			t.Fatal("accepted changed candidate")
		}
	}
}

func TestPublicRGBReadDoesNotCreateBackupRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "absent")
	t.Setenv("XDG_STATE_HOME", root)
	access := publicAccess{discover: func() ([]Candidate, error) { return []Candidate{{PhysicalPath: "1-1.2", Compatible: true}}, nil }, query: func(c Candidate) (CaptureResult, error) {
		q, err := queryCapture(newSettingsTransport(), true)
		q.result.PhysicalPath = c.PhysicalPath
		return q.result, err
	}}
	if err := runPublic(nil, &cliRuntime{strings.NewReader(""), io.Discard, io.Discard}, access); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("query created root", err)
	}
}

func TestPublicUnknownConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name   string
		offset int
		value  byte
	}{
		{"type-ff", 0, 0xff},
		{"key-count", 3, 2},
		{"key", 4, 0xff},
		{"trigger", 1, 0xff},
		{"modifiers", 2, 0xff},
		{"rgb-mode", 124, 0xff},
	} {
		for _, args := range [][]string{nil, {"key", "f13"}, {"key", "enter"}, {"rgb", "off"}, {"rgb", "cycle-slow"}} {
			t.Run(tc.name+"/"+strings.Join(args, " "), func(t *testing.T) {
				root := filepath.Join(t.TempDir(), "absent-state")
				t.Setenv("XDG_STATE_HOME", root)
				transport := newSettingsTransport()
				transport.current[tc.offset] = tc.value
				original := transport.current
				query := len(args) == 0
				access := publicAccess{
					discover: func() ([]Candidate, error) {
						return []Candidate{{PhysicalPath: "synthetic", Compatible: true}}, nil
					},
					query: func(c Candidate) (CaptureResult, error) {
						q, err := queryCapture(transport, true)
						q.result.PhysicalPath = c.PhysicalPath
						return q.result, err
					},
					apply: func(Candidate, ApplyTarget, configurationChanges, func(configuration, configuration) (bool, error)) (ApplyResult, error) {
						t.Fatal("unsupported configuration reached apply")
						return ApplyResult{}, nil
					},
				}
				var out, diagnostic bytes.Buffer
				input := strings.NewReader("yes\n")
				err := runPublic(args, &cliRuntime{input, &out, &diagnostic}, access)
				if query {
					want := fmt.Sprintf("1️⃣ WonKey\n\n[1] XFKEY One Key Max (0112)\n"+
						"  USB path   synthetic\n"+
						"  Supports   key, trigger, mouse, media, macro, rgb\n"+
						"  Layout     Unknown (unsupported configuration)\n"+
						"  Raw type   0x%02x (byte 0)\n  Raw 0-15   %x\n"+
						"Fields are not decoded. Changes are blocked.\n", original[0], original[:16])
					if err != nil || diagnostic.Len() != 0 || out.String() != want {
						t.Fatalf("error=%v diagnostic=%q output=%q want=%q", err, diagnostic.String(), out.String(), want)
					}
				} else if err == nil || ExitCode(err) != 1 || !strings.Contains(err.Error(), "unsupported current") || out.String() != "1️⃣ WonKey\n\n" {
					t.Fatalf("error=%v output=%q", err, out.String())
				}
				if input.Len() != len("yes\n") || transport.current != original {
					t.Fatal("read confirmation or changed settings")
				}
				checkNoUpload(t, transport)
				if len(transport.packets) != 4 {
					t.Fatal("unexpected query count", len(transport.packets))
				}
				for i, opcode := range []byte{1, 6, 7, 8} {
					want := vendorPacket{0xaf, opcode}
					if transport.packets[i] != want {
						t.Fatalf("unexpected query packet %x", transport.packets[i])
					}
				}
				if _, err := os.Stat(root); !os.IsNotExist(err) {
					t.Fatal("created backup storage", err)
				}
			})
		}
	}
}

func TestPublicSupportedQueryOutput(t *testing.T) {
	root := filepath.Join(t.TempDir(), "absent-state")
	t.Setenv("XDG_STATE_HOME", root)
	transport := newSettingsTransport()
	transport.current[2] = 3
	access := publicAccess{
		discover: func() ([]Candidate, error) {
			return []Candidate{{PhysicalPath: "synthetic", Compatible: true}}, nil
		},
		query: func(c Candidate) (CaptureResult, error) {
			q, err := queryCapture(transport, true)
			q.result.PhysicalPath = c.PhysicalPath
			return q.result, err
		},
	}
	var out, diagnostic bytes.Buffer
	err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diagnostic}, access)
	want := "1️⃣ WonKey\n\n[1] XFKEY One Key Max (0112)\n" +
		"  USB path   synthetic\n" +
		"  Supports   key, trigger, mouse, media, macro, rgb\n" +
		"  Key        ctrl+shift+enter\n" +
		"  On         press\n" +
		"  Mode       cycle-slow\n" +
		"  Colour     #FFFFFF\n"
	if err != nil || diagnostic.Len() != 0 || out.String() != want {
		t.Fatalf("error=%v diagnostic=%q output=%q want=%q", err, diagnostic.String(), out.String(), want)
	}
	checkNoUpload(t, transport)
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("created backup storage", err)
	}
}

func TestPublicLiveBoundaryOffline(t *testing.T) {
	for _, name := range []string{"write", "reordered", "descriptor", "node", "inode", "path", "missing", "open-failed"} {
		t.Run(name, func(t *testing.T) {
			oldDiscover, oldOpen := liveDiscover, liveOpenTarget
			t.Cleanup(func() { liveDiscover, liveOpenTarget = oldDiscover, oldOpen })
			selected := Candidate{PhysicalPath: "1-1.2", Compatible: true, VendorNode: NodeMetadata{Path: "/synthetic/hidraw4", identity: [3]uint64{1, 2, 3}}}
			other := Candidate{PhysicalPath: "1-1.3", Compatible: true}
			discoveries, opens := 0, 0
			liveDiscover = func(string, string) ([]Candidate, error) {
				discoveries++
				if discoveries == 1 {
					return []Candidate{selected, other}, nil
				}
				fresh := selected
				switch name {
				case "descriptor":
					fresh.Reports[3] = "changed"
				case "node":
					fresh.VendorNode.Path = "/synthetic/hidraw5"
				case "inode":
					fresh.VendorNode.identity[1]++
				case "path":
					fresh.PhysicalPath = "1-9"
				case "missing":
					return nil, nil
				}
				if name == "write" {
					return []Candidate{fresh, other}, nil
				}
				return []Candidate{other, fresh}, nil
			}
			first := newSettingsTransport()
			fresh := &backupCheckingTransport{settingsTransport: newSettingsTransport()}
			liveOpenTarget = func(c Candidate) (queryTransport, io.Closer, error) {
				opens++
				if !sameCandidate(c, selected) {
					t.Fatal("opened a different selection", c)
				}
				if opens == 1 {
					return first, &closeRecorder{}, nil
				}
				if name == "open-failed" {
					return nil, nil, fmt.Errorf("open failed")
				}
				return fresh, &closeRecorder{}, nil
			}
			access := publicDeviceAccess()
			var out bytes.Buffer
			err := runPublic([]string{"key", "f13", "--device", "1"}, &cliRuntime{strings.NewReader(""), &out, io.Discard}, access)
			success := name == "write" || name == "reordered"
			if (err == nil) != success {
				t.Fatal(err, out.String())
			}
			if discoveries != 2 {
				t.Fatal("selection was not revalidated", discoveries)
			}
			wantOpens := 1
			if success || name == "open-failed" {
				wantOpens = 2
			}
			if opens != wantOpens {
				t.Fatal("unexpected HID opens", opens)
			}
			checkNoUpload(t, first)
			if success {
				if !fresh.checked || !strings.Contains(out.String(), "All 128 readback bytes match") {
					t.Fatal("fresh query or verification missing", out.String())
				}
			} else {
				checkNoUpload(t, fresh.settingsTransport)
			}
		})
	}
}

func TestPublic514CReadValidationAndWrite(t *testing.T) {
	c8851 := ch57.DiscoveredCandidate{
		Candidate:    ch57.Candidate{PhysicalPath: "1-4.1", VID: 0x514c, PID: 0x8851},
		BusNumber:    1,
		DeviceNumber: 23,
	}
	c8850 := ch57.DiscoveredCandidate{
		Candidate:    ch57.Candidate{PhysicalPath: "1-4.2", VID: 0x514c, PID: 0x8850},
		BusNumber:    1,
		DeviceNumber: 18,
	}
	probe514C := func(_ string, _ string, selected ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
		if selected.PID == 0x8851 {
			return ch57.ProbeResult{
				Status: ch57.ProbeRawReport,
				Layout: &ch57.LayoutInfo{
					Keys: 4, Knobs: 1, Kind: 0,
					Bindings: map[byte]ch57.SlotBinding{
						1:  {Slot: 1, Layer: 1, ActionType: ch57.SlotActionKeyboard, Strokes: []ch57.Stroke{{Usage: 0x04}}},
						2:  {Slot: 2, Layer: 1, ActionType: ch57.SlotActionKeyboard, Strokes: []ch57.Stroke{{Usage: 0x05}}},
						3:  {Slot: 3, Layer: 1, ActionType: ch57.SlotActionKeyboard, Strokes: []ch57.Stroke{{Usage: 0x06}}},
						4:  {Slot: 4, Layer: 1, ActionType: ch57.SlotActionKeyboard, Strokes: []ch57.Stroke{{Usage: 0x07}}},
						16: {Slot: 16, Layer: 1, ActionType: ch57.SlotActionKeyboard, Strokes: []ch57.Stroke{{Usage: 0x20}}},
						17: {Slot: 17, Layer: 1, ActionType: ch57.SlotActionKeyboard, Strokes: []ch57.Stroke{{Usage: 0x1f}}},
						18: {Slot: 18, Layer: 1, ActionType: ch57.SlotActionKeyboard, Strokes: []ch57.Stroke{{Usage: 0x1e}}},
					},
				},
			}, nil
		}
		bindings := map[byte]ch57.SlotBinding{
			1:  {Slot: 1, Layer: 1, ActionType: ch57.SlotActionKeyboard, Strokes: []ch57.Stroke{{Usage: 0x04}}},
			13: {Slot: 13, Layer: 1, ActionType: ch57.SlotActionMedia, MediaUsage: 0x00ea},
			14: {Slot: 14, Layer: 1, ActionType: ch57.SlotActionMedia, MediaUsage: 0x00e2},
			15: {Slot: 15, Layer: 1, ActionType: ch57.SlotActionMedia, MediaUsage: 0x00e9},
		}
		return ch57.ProbeResult{
			Status: ch57.ProbeRawReport,
			Layout: &ch57.LayoutInfo{Keys: 12, Knobs: 4, Kind: 11, Bindings: bindings},
		}, nil
	}

	t.Run("bare-read-cards", func(t *testing.T) {
		access := ch57TestAccess(t)
		access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
			return []ch57.DiscoveredCandidate{c8851, c8850}, nil
		}
		access.probeCH57 = probe514C
		var out, diag bytes.Buffer
		if err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
			t.Fatalf("err=%v diag=%q", err, diag.String())
		}
		for _, want := range []string{
			"[1] CH57x Macropad (514c:8851)\n  USB path   1-4.1\n  Layout     4 keys, 1 knob\n  Supports   key, mouse, media, macro, led\n",
			"  key1       a\n  key2       b\n  key3       c\n  key4       d\n  knob1      left: 3, press: 2, right: 1\n",
			"[2] CH57x Macropad (514c:8850)\n  USB path   1-4.2\n  Layout     12 keys, 4 knobs\n  Supports   key, mouse, media, macro, led\n",
			"  knob4      left: media volumedown (0x00ea), press: media mute (0x00e2), right: media volumeup (0x00e9)\n",
		} {
			if !strings.Contains(out.String(), want) {
				t.Fatalf("missing %q in:\n%s", want, out.String())
			}
		}
	})

	t.Run("per-device-control-validation", func(t *testing.T) {
		for _, tc := range []struct {
			candidate ch57.DiscoveredCandidate
			args      []string
			want      string
		}{
			{c8851, []string{"key", "key5", "f13"}, "CH57x Macropad (514c:8851) has 4 keys; key5 is not available"},
			{c8851, []string{"key", "key12", "f13"}, "CH57x Macropad (514c:8851) has 4 keys; key12 is not available"},
			{c8851, []string{"media", "knob2-left", "volumeup"}, "CH57x Macropad (514c:8851) has 1 knob(s); knob2-left is not available"},
			{c8851, []string{"mouse", "knob4-press", "left"}, "CH57x Macropad (514c:8851) has 1 knob(s); knob4-press is not available"},
		} {
			access := ch57TestAccess(t)
			access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
				return []ch57.DiscoveredCandidate{tc.candidate}, nil
			}
			access.probeCH57 = probe514C
			var out, diag bytes.Buffer
			err := runPublic(tc.args, &cliRuntime{strings.NewReader(""), &out, &diag}, access)
			if err == nil || err.Error() != tc.want || !strings.Contains(strings.ReplaceAll(diag.String(), "\n", " "), tc.want) {
				t.Fatalf("args=%v err=%v diag=%q want=%q", tc.args, err, diag.String(), tc.want)
			}
		}
	})

	t.Run("live-programming-fe-and-fd", func(t *testing.T) {
		for _, tc := range []struct {
			candidate  ch57.DiscoveredCandidate
			args       []string
			wantChange string
			wantFirst  [7]byte
			wantCount  int
		}{
			{c8851, []string{"key", "key1", "f13"}, "  key1: a -> f13\n", [7]byte{0x03, 0xfe, 1, 1, 0x01, 0, 0}, 4},
			{c8851, []string{"media", "knob-right", "volumeup"}, "  knob-right: 1 -> media volumeup (0x00e9)\n", [7]byte{0x03, 0xfe, 18, 1, 0x02, 0, 0}, 4},
			{c8851, []string{"led", "reactive"}, "  led: write-only -> reactive\n", [7]byte{0x03, 0xfe, 0xb0, 1, 0x08, 0, 0}, 2},
			{c8850, []string{"key", "knob4-left", "ctrl+f13"}, "  knob4-left: media volumedown (0x00ea) -> ctrl+f13\n", [7]byte{0x03, 0xfd, 13, 1, 0x01, 0, 2}, 2},
			{c8850, []string{"led", "cycle"}, "  led: write-only -> cycle\n", [7]byte{0x03, 0xfe, 0xb0, 0, 0x01, 0, 0}, 2},
		} {
			access := ch57TestAccess(t)
			access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
				return []ch57.DiscoveredCandidate{tc.candidate}, nil
			}
			access.probeCH57 = probe514C
			var written []ch57.Report
			access.applyCH57 = func(_ string, _ string, _ ch57.DiscoveredCandidate, reports []ch57.Report) (ch57.ApplyResult, error) {
				written = reports
				return ch57.ApplyResult{WriteAttempted: true, ReportsWritten: len(reports)}, nil
			}
			var out, diag bytes.Buffer
			if err := runPublic(tc.args, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
				t.Fatalf("args=%v err=%v diag=%q", tc.args, err, diag.String())
			}
			if !strings.Contains(out.String(), tc.wantChange) || len(written) != tc.wantCount || !bytes.Equal(written[0][:7], tc.wantFirst[:]) {
				t.Fatalf("args=%v out=%q written=%x", tc.args, out.String(), written)
			}
		}
	})
}

func TestPublicSayo000CReadValidationAndWrite(t *testing.T) {
	cSayo := sayo.DiscoveredCandidate{
		Candidate:    sayo.Candidate{PhysicalPath: "7-1.4.3.4", VID: 0x8089, PID: 0x000c},
		BusNumber:    7,
		DeviceNumber: 12,
	}
	probeSayo := func(_ string, _ string, _ sayo.DiscoveredCandidate) (sayo.ProbeResult, error) {
		var rawRecords []sayo.RawSlotRecord
		for i := range 6 {
			var r sayo.RawSlotRecord
			r.KeyType = 0
			r.Layers[0] = sayo.SlotBinding{ActionType: sayo.SlotActionKeyboard, Strokes: []sayo.Stroke{{Usage: 0x1e + i}}}
			r.Layers[1] = r.Layers[0]
			rawRecords = append(rawRecords, r)
		}
		layout, err := sayo.BuildDeviceLayout(sayo.ProtocolV2, rawRecords, "held", "#404040")
		return sayo.ProbeResult{
			Status: sayo.ProbeRawReport,
			Layout: layout,
		}, err
	}

	t.Run("bare-read-card", func(t *testing.T) {
		access := ch57TestAccess(t)
		access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) {
			return []sayo.DiscoveredCandidate{cSayo}, nil
		}
		access.probeSayo = probeSayo
		var out, diag bytes.Buffer
		if err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
			t.Fatalf("err=%v diag=%q", err, diag.String())
		}
		want := "1️⃣ WonKey\n\n" +
			"[1] SayoDevice 2x3P (8089:000c)\n" +
			"  USB path   7-1.4.3.4\n" +
			"  Layout     6 keys\n" +
			"  Supports   key, mouse, media, macro, rgb, firmware\n" +
			"  key1       1\n" +
			"  key2       2\n" +
			"  key3       3\n" +
			"  key4       4\n" +
			"  key5       5\n" +
			"  key6       6\n" +
			"  Mode       held\n" +
			"  Colour     #404040\n"
		if out.String() != want {
			t.Fatalf("got:\n%s\nwant:\n%s", out.String(), want)
		}
	})

	t.Run("capability-and-control-gating", func(t *testing.T) {
		for _, tc := range []struct {
			args []string
			want string
		}{
			{[]string{"key", "key7", "f13"}, "SayoDevice 2x3P (8089:000c) has 6 keys; key7 is not available"},
			{[]string{"key", "key12", "f13"}, "SayoDevice 2x3P (8089:000c) has 6 keys; key12 is not available"},
			{[]string{"media", "knob1-left", "volumeup"}, "SayoDevice 2x3P (8089:000c) has 0 knobs; knob1-left is not available"},
			{[]string{"mouse", "knob-press", "left"}, "SayoDevice 2x3P (8089:000c) has 0 knobs; knob-press is not available"},
			{[]string{"key", "key1", "f13", "--layer", "6"}, "SayoDevice 2x3P (8089:000c) supports layers 1..5 only"},
			{[]string{"led", "reactive"}, `SayoDevice 2x3P (8089:000c) does not support led; use "wonkey rgb" instead`},
			{[]string{"trigger", "release"}, "SayoDevice 2x3P (8089:000c) does not support trigger (key release triggers)"},
			{[]string{"macro", "a,b,c,d"}, "SayoDevice 2x3P (8089:000c) supports up to 3 strokes per macro"},
			{[]string{"macro", "ctrl+a,ctrl+b,c"}, "SayoDevice 2x3P (8089:000c) does not support modifiers on strokes 2..3 of a 3-stroke macro"},
			{[]string{"macro", "a,b", "--interval", "50"}, "SayoDevice 2x3P (8089:000c) does not support --interval or --repeat"},
			{[]string{"rgb", "toggle"}, `SayoDevice 2x3P (8089:000c) does not support RGB mode "toggle"`},
		} {
			access := ch57TestAccess(t)
			access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) {
				return []sayo.DiscoveredCandidate{cSayo}, nil
			}
			access.probeSayo = probeSayo
			var out, diag bytes.Buffer
			err := runPublic(tc.args, &cliRuntime{strings.NewReader(""), &out, &diag}, access)
			if err == nil || err.Error() != tc.want || !strings.Contains(strings.ReplaceAll(diag.String(), "\n", " "), tc.want) {
				t.Fatalf("args=%v err=%v diag=%q want=%q", tc.args, err, diag.String(), tc.want)
			}
		}
	})

	t.Run("live-programming", func(t *testing.T) {
		for _, tc := range []struct {
			args       []string
			wantChange string
			wantIsRGB  bool
			wantBoth   bool
		}{
			{[]string{"key", "key1", "f13"}, "  key1: 1 -> f13\n", false, true},
			{[]string{"key", "key2", "ctrl+f13", "--layer", "2"}, "  key2 (layer 2): 2 -> ctrl+f13\n", false, false},
			{[]string{"macro", "key3", "ctrl+c,ctrl+v"}, "  key3: 3 -> ctrl+c,ctrl+v\n", false, true},
			{[]string{"mouse", "key4", "left"}, "  key4: 4 -> mouse left (x=0, y=0, wheel=0)\n", false, true},
			{[]string{"media", "key5", "volumeup"}, "  key5: 5 -> media volumeup (0x00e9)\n", false, true},
			{[]string{"rgb", "static", "0000ff"}, "  lighting: held -> static\n  colour: #404040 -> #0000FF\n", true, false},
			{[]string{"rgb", "breathe"}, "  lighting: held -> breathe\n", true, false},
			{[]string{"rgb", "off"}, "  lighting: held -> off\n  colour: #404040 -> #000000\n", true, false},
		} {
			access := ch57TestAccess(t)
			access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) {
				return []sayo.DiscoveredCandidate{cSayo}, nil
			}
			access.probeSayo = probeSayo
			var gotReq sayo.WriteRequest
			access.applySayo = func(_ string, _ string, _ sayo.DiscoveredCandidate, req sayo.WriteRequest) (sayo.ApplyResult, error) {
				gotReq = req
				return sayo.ApplyResult{WriteAttempted: true, ReportsWritten: 2}, nil
			}
			var out, diag bytes.Buffer
			if err := runPublic(tc.args, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
				t.Fatalf("args=%v err=%v diag=%q", tc.args, err, diag.String())
			}
			if !strings.Contains(out.String(), tc.wantChange) || !strings.Contains(out.String(), "Settings saved to SayoDevice 2x3P.\n") ||
				gotReq.IsRGB != tc.wantIsRGB || gotReq.BothDefaultLayers != tc.wantBoth {
				t.Fatalf("args=%v out=%q gotReq=%+v", tc.args, out.String(), gotReq)
			}
		}
	})
}

func TestPublicExpandedCH57AndSayoFamilies(t *testing.T) {
	t.Run("k8890-514c", func(t *testing.T) {
		c := ch57.DiscoveredCandidate{
			Candidate:    ch57.Candidate{PhysicalPath: "1-2", VID: 0x514c, PID: 0x8890},
			BusNumber:    1,
			DeviceNumber: 10,
		}
		access := ch57TestAccess(t)
		access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) { return []ch57.DiscoveredCandidate{c}, nil }
		access.probeCH57 = func(string, string, ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
			return ch57.ProbeResult{Status: ch57.ProbeRawReport, Raw: []byte{0xaa}, Count: 1}, nil
		}
		var out, diag bytes.Buffer
		if err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
			t.Fatalf("err=%v diag=%q", err, diag.String())
		}
		if !strings.Contains(out.String(), "[1] CH57x Macropad (514c:8890)\n") {
			t.Fatalf("missing 514c:8890 heading in:\n%s", out.String())
		}
	})

	t.Run("k884x-16-vid-pid-pairs-and-write-only-kind-ge10", func(t *testing.T) {
		for _, vid := range []uint16{0x1189, 0x514c} {
			for _, pid := range []uint16{0x8830, 0x8831, 0x8832, 0x8833, 0x8840, 0x8842, 0x8850, 0x8851} {
				c := ch57.DiscoveredCandidate{
					Candidate:    ch57.Candidate{PhysicalPath: "1-4.1", VID: vid, PID: pid},
					BusNumber:    1,
					DeviceNumber: 11,
				}
				access := ch57TestAccess(t)
				access.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) { return []ch57.DiscoveredCandidate{c}, nil }
				access.probeCH57 = func(string, string, ch57.DiscoveredCandidate) (ch57.ProbeResult, error) {
					return ch57.ProbeResult{
						Status: ch57.ProbeRawReport,
						Layout: &ch57.LayoutInfo{Keys: 3, Knobs: 1, Kind: 10},
					}, nil
				}
				var out, diag bytes.Buffer
				if err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
					t.Fatalf("%04x:%04x err=%v diag=%q", vid, pid, err, diag.String())
				}
				want := fmt.Sprintf("[1] CH57x Macropad (%04x:%04x)\n  USB path   1-4.1\n  Layout     3 keys, 1 knob\n  Supports   key, mouse, media, macro, led\n  Settings   Write-only (not readable over USB)\n", vid, pid)
				if !strings.Contains(out.String(), want) {
					t.Fatalf("%04x:%04x got:\n%s\nwant:\n%s", vid, pid, out.String(), want)
				}
			}
		}
	})

	t.Run("sayo-dynamic-product-names-and-knobs", func(t *testing.T) {
		for _, tc := range []struct {
			pid         uint16
			productName string
			wantHeading string
			wantSaved   string
		}{
			{0x0002, "SayoDevice O2", "[1] SayoDevice O2 (8089:0002)\n", "Settings saved to SayoDevice O2.\n"},
			{0x0003, "SayoDevice O2L", "[1] SayoDevice O2L (8089:0003)\n", "Settings saved to SayoDevice O2L.\n"},
			{0x0004, "SayoDevice 6x4F", "[1] SayoDevice 6x4F (8089:0004)\n", "Settings saved to SayoDevice 6x4F.\n"},
			{0x0009, "SayoDevice O3C", "[1] SayoDevice O3C (8089:0009)\n", "Settings saved to SayoDevice O3C.\n"},
			{0x000b, "SayoDevice 2x4V", "[1] SayoDevice 2x4V (8089:000b)\n", "Settings saved to SayoDevice 2x4V.\n"},
			{0x000c, "SayoDevice 2x3P", "[1] SayoDevice 2x3P (8089:000c)\n", "Settings saved to SayoDevice 2x3P.\n"},
		} {
			c := sayo.DiscoveredCandidate{
				Candidate:    sayo.Candidate{PhysicalPath: "7-1.4", VID: 0x8089, PID: tc.pid},
				ProductName:  tc.productName,
				BusNumber:    7,
				DeviceNumber: 12,
			}
			access := ch57TestAccess(t)
			access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{c}, nil }
			access.probeSayo = func(string, string, sayo.DiscoveredCandidate) (sayo.ProbeResult, error) {
				layout, err := sayo.BuildDeviceLayout(sayo.ProtocolV2, []sayo.RawSlotRecord{
					{KeyType: 0, Layers: [5]sayo.SlotBinding{{ActionType: sayo.SlotActionKeyboard, Strokes: []sayo.Stroke{{Usage: 0x04}}}}},
					{KeyType: 0, Layers: [5]sayo.SlotBinding{{ActionType: sayo.SlotActionKeyboard, Strokes: []sayo.Stroke{{Usage: 0x05}}}}},
					{KeyType: 0, Layers: [5]sayo.SlotBinding{{ActionType: sayo.SlotActionKeyboard, Strokes: []sayo.Stroke{{Usage: 0x06}}}}},
					{KeyType: 0, Layers: [5]sayo.SlotBinding{{ActionType: sayo.SlotActionMedia, MediaUsage: 0x00e2}}},
					{KeyType: 1, Layers: [5]sayo.SlotBinding{{ActionType: sayo.SlotActionMedia, MediaUsage: 0x00ea}}},
					{KeyType: 2, Layers: [5]sayo.SlotBinding{{ActionType: sayo.SlotActionMedia, MediaUsage: 0x00e9}}},
				}, "static", "#0000FF")
				if err != nil {
					t.Fatal(err)
				}
				return sayo.ProbeResult{Status: sayo.ProbeRawReport, Layout: layout}, nil
			}
			var gotReq sayo.WriteRequest
			access.applySayo = func(_ string, _ string, _ sayo.DiscoveredCandidate, req sayo.WriteRequest) (sayo.ApplyResult, error) {
				gotReq = req
				return sayo.ApplyResult{WriteAttempted: true, ReportsWritten: 2}, nil
			}
			var out, diag bytes.Buffer
			if err := runPublic([]string{"media", "knob-right", "calculator"}, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
				t.Fatalf("pid=%04x err=%v diag=%q", tc.pid, err, diag.String())
			}
			if !strings.Contains(out.String(), tc.wantHeading) || !strings.Contains(out.String(), "  knob1      left: media volumedown (0x00ea), press: media mute (0x00e2), right: media volumeup (0x00e9)\n") ||
				!strings.Contains(out.String(), "  knob-right: media volumeup (0x00e9) -> media calculator (0x0192)\n") ||
				!strings.Contains(out.String(), tc.wantSaved) || gotReq.SlotIndex != 5 || gotReq.SlotPayload[4] != 22 {
				t.Fatalf("pid=%04x got:\n%s\nreq=%+v", tc.pid, out.String(), gotReq)
			}
		}
	})
}

func TestPublicFirmwareCheckAndUpdate(t *testing.T) {
	cSayo := sayo.DiscoveredCandidate{
		Candidate:    sayo.Candidate{PhysicalPath: "7-1.4.3.4", VID: 0x8089, PID: 0x000c},
		ProductName:  "SayoDevice 2x3P",
		BusNumber:    7,
		DeviceNumber: 12,
	}
	// Directory 12 values from the live https://a.sayobot.cn/firmware/update/12/config.json (model_code 6 entry).
	checksum := 1
	manifest := sayo.FirmwareManifest{
		VID: 0x8089, PID: 12, PID2: 12, AddrLen: 4, BootInfoAddr: 6080, EraseFlash: 1, HIDChecksum: &checksum,
		Data: []sayo.FirmwareManifestEntry{
			{Model: "2X3_RGB_V2", ModelCode: 6, Version: 2214, FilePath: "firmware/app_2X3_RGB_V2.bin"},
		},
	}

	t.Run("help-and-syntax", func(t *testing.T) {
		access := publicAccess{discover: func() ([]Candidate, error) { t.Fatal("help accessed devices"); return nil, nil }}
		for _, args := range [][]string{{"firmware", "--help"}, {"firmware", "-h"}, {"firmware", "check", "--help"}, {"firmware", "update", "--help"}} {
			var out bytes.Buffer
			if err := runPublic(args, &cliRuntime{strings.NewReader(""), &out, io.Discard}, access); err != nil {
				t.Fatalf("args=%v err=%v", args, err)
			}
			if !strings.Contains(out.String(), "Usage: wonkey firmware [check|update] [--device N]") {
				t.Fatalf("unexpected help output: %q", out.String())
			}
		}
		for _, badArgs := range [][]string{
			{"firmware", "invalid"},
			{"firmware", "check", "update"},
			{"firmware", "--layer", "1"},
			{"firmware", "--help", "--device", "1"},
		} {
			var out, diag bytes.Buffer
			err := runPublic(badArgs, &cliRuntime{strings.NewReader(""), &out, &diag}, access)
			if err == nil || ExitCode(err) != 2 {
				t.Fatalf("badArgs=%v err=%v diag=%q", badArgs, err, diag.String())
			}
		}
	})

	t.Run("capability-gating-non-sayo", func(t *testing.T) {
		accessXFKEY := publicAccess{
			discover: func() ([]Candidate, error) { return []Candidate{{PhysicalPath: "1-1", Compatible: true}}, nil },
		}
		var diag bytes.Buffer
		err := runPublic([]string{"firmware"}, &cliRuntime{strings.NewReader(""), io.Discard, &diag}, accessXFKEY)
		wantXFKEY := "XFKEY One Key Max (0112) does not support firmware updates"
		if err == nil || err.Error() != wantXFKEY {
			t.Fatalf("xfkey firmware err=%v, want %q", err, wantXFKEY)
		}

		accessCH57 := ch57TestAccess(t)
		accessCH57.discoverCH57 = func(string) ([]ch57.DiscoveredCandidate, error) {
			return []ch57.DiscoveredCandidate{{Candidate: ch57.Candidate{PhysicalPath: "1-2", VID: 0x514c, PID: 0x8851}, BusNumber: 1, DeviceNumber: 2}}, nil
		}
		diag.Reset()
		err = runPublic([]string{"firmware", "update"}, &cliRuntime{strings.NewReader(""), io.Discard, &diag}, accessCH57)
		wantCH57 := "CH57x Macropad (514c:8851) does not support firmware updates"
		if err == nil || err.Error() != wantCH57 {
			t.Fatalf("ch57 firmware err=%v, want %q", err, wantCH57)
		}
	})

	t.Run("check-up-to-date-and-update-available-and-bootloader", func(t *testing.T) {
		for _, tc := range []struct {
			name       string
			args       []string
			fwVer      uint16
			bootloader bool
			wantStatus string
		}{
			{"bare-firmware-up-to-date", []string{"firmware"}, 2214, false, "  Status     Up to date\n"},
			{"check-update-available", []string{"firmware", "check"}, 2202, false, "  Status     Update available - run \"wonkey firmware update --device 1\" to install\n"},
			{"check-bootloader", []string{"firmware", "check"}, 2214, true, "  Status     Bootloader mode - run \"wonkey firmware update --device 1\" to recover\n"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				access := ch57TestAccess(t)
				access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{cSayo}, nil }
				access.probeSayo = func(string, string, sayo.DiscoveredCandidate) (sayo.ProbeResult, error) {
					return sayo.ProbeResult{
						Status: sayo.ProbeRawReport,
						Layout: &sayo.DeviceLayout{
							Protocol:        sayo.ProtocolV2,
							ModelCode:       6,
							FirmwareVersion: tc.fwVer,
							Bootloader:      tc.bootloader,
						},
					}, nil
				}
				access.fetchSayoManifest = func(pid uint16) (sayo.FirmwareManifest, error) {
					if pid != 0x000c {
						t.Fatalf("unexpected pid %#04x", pid)
					}
					return manifest, nil
				}
				access.flashSayoFirmware = func(string, string, sayo.DiscoveredCandidate, sayo.ProtocolVersion, bool, sayo.FirmwareManifest, sayo.FirmwareManifestEntry, []byte, sayo.FirmwareProgressFunc) (sayo.ApplyResult, error) {
					t.Fatal("check should not flash firmware")
					return sayo.ApplyResult{}, nil
				}
				var out, diag bytes.Buffer
				if err := runPublic(tc.args, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
					t.Fatalf("err=%v diag=%q", err, diag.String())
				}
				for _, want := range []string{
					"[1] SayoDevice 2x3P (8089:000c)\n",
					"  Model      2X3_RGB_V2 (0x0006)\n",
					fmt.Sprintf("  Current    %d (0x%04x)\n", tc.fwVer, tc.fwVer),
					"  Latest     2214 (0x08a6)\n",
					"  Firmware   firmware/app_2X3_RGB_V2.bin\n",
					tc.wantStatus,
				} {
					if !strings.Contains(out.String(), want) {
						t.Fatalf("missing %q in:\n%s", want, out.String())
					}
				}
			})
		}
	})

	t.Run("update-noop-and-live-and-bootloader-recovery", func(t *testing.T) {
		for _, tc := range []struct {
			name       string
			fwVer      uint16
			bootloader bool
			wantFlash  bool
			wantOut    string
		}{
			{"already-up-to-date", 2214, false, false, "Firmware is already up to date. No firmware write sent.\n"},
			{"app-mode-update", 2202, false, true, "  firmware: 2202 (0x089a) -> 2214 (0x08a6) (2X3_RGB_V2)\n  Flashing   [####################] 100% (80/80 B)\nWaiting for the device to restart...\nFirmware updated: 2202 (0x089a) -> 2214 (0x08a6), confirmed.\n  Restart    0.3s\n"},
			{"bootloader-recovery-even-at-latest-ver", 2214, true, true, "  firmware: bootloader (2214 / 0x08a6) -> 2214 (0x08a6) (2X3_RGB_V2)\n  Flashing   [####################] 100% (80/80 B)\nWaiting for the device to restart...\nFirmware updated: bootloader (2214 / 0x08a6) -> 2214 (0x08a6), confirmed.\n  Restart    0.3s\n"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				access := ch57TestAccess(t)
				access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{cSayo}, nil }
				restarted := cSayo
				restarted.DeviceNumber = 14
				access.querySayoVersion = func(_ string, _ string, c sayo.DiscoveredCandidate) (sayo.FirmwareInfo, error) {
					if c != restarted {
						t.Fatalf("version query for %+v, want the restarted device", c)
					}
					return sayo.FirmwareInfo{ModelCode: 6, FirmwareVersion: 2214}, nil
				}
				access.probeSayo = func(_ string, _ string, c sayo.DiscoveredCandidate) (sayo.ProbeResult, error) {
					if c != cSayo {
						t.Fatalf("settings probe for %+v, want only the selected device", c)
					}
					return sayo.ProbeResult{
						Status: sayo.ProbeRawReport,
						Layout: &sayo.DeviceLayout{
							Protocol:        sayo.ProtocolV2,
							ModelCode:       6,
							FirmwareVersion: tc.fwVer,
							Bootloader:      tc.bootloader,
						},
					}, nil
				}
				access.waitSayoRestart = func(_ string, _ string, prev sayo.DiscoveredCandidate) sayo.RestartResult {
					if prev != cSayo {
						t.Fatalf("restart wait for %+v, want the selected device", prev)
					}
					return sayo.RestartResult{Restarted: true, Candidate: restarted, Elapsed: 300 * time.Millisecond}
				}
				access.fetchSayoManifest = func(uint16) (sayo.FirmwareManifest, error) { return manifest, nil }
				access.fetchSayoBinary = func(uint16, string) ([]byte, error) {
					if !tc.wantFlash {
						t.Fatal("already up to date should not fetch firmware binary")
					}
					return make([]byte, 80), nil
				}
				flashed := false
				access.flashSayoFirmware = func(_ string, _ string, _ sayo.DiscoveredCandidate, _ sayo.ProtocolVersion, inBoot bool, _ sayo.FirmwareManifest, _ sayo.FirmwareManifestEntry, fw []byte, onProgress sayo.FirmwareProgressFunc) (sayo.ApplyResult, error) {
					flashed = true
					if inBoot != tc.bootloader || len(fw) != 80 {
						t.Fatalf("inBoot=%v len=%d", inBoot, len(fw))
					}
					if onProgress != nil {
						onProgress(0, len(fw))
						onProgress(32, len(fw))
						onProgress(64, len(fw))
						onProgress(len(fw), len(fw))
					}
					return sayo.ApplyResult{WriteAttempted: true, ReportsWritten: 10}, nil
				}
				var out, diag bytes.Buffer
				if err := runPublic([]string{"firmware", "update"}, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
					t.Fatalf("err=%v diag=%q", err, diag.String())
				}
				if flashed != tc.wantFlash || !strings.Contains(out.String(), tc.wantOut) {
					t.Fatalf("flashed=%v wantFlash=%v out=\n%s\nwantOut=\n%s", flashed, tc.wantFlash, out.String(), tc.wantOut)
				}
			})
		}
	})

	// The authentic 2x3P bootloader keeps 8089:000c and reports the product string "Bootloader".
	cBoot := sayo.DiscoveredCandidate{
		Candidate:    sayo.Candidate{PhysicalPath: "7-1.4.3.4", VID: 0x8089, PID: 0x000c},
		ProductName:  "Bootloader",
		BusNumber:    7,
		DeviceNumber: 36,
	}
	bootProbe := func(string, string, sayo.DiscoveredCandidate) (sayo.ProbeResult, error) {
		return sayo.ProbeResult{
			Status: sayo.ProbeRawReport,
			Count:  64,
			// Synthetic CHECK_FW reply: status 00, length 04, version 0x08a6, model code 0x0006.
			Raw:    append([]byte{0x02, 0x00, 0x04, 0x08, 0xa6, 0x00, 0x06, 0x00, 0x5a}, make([]byte, 55)...),
			Layout: &sayo.DeviceLayout{Protocol: sayo.ProtocolV1, ModelCode: 6, FirmwareVersion: 2214, Bootloader: true},
		}, nil
	}

	t.Run("bare-wonkey-lists-bootloader-without-network", func(t *testing.T) {
		access := ch57TestAccess(t)
		access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{cBoot}, nil }
		access.probeSayo = bootProbe
		access.fetchSayoManifest = func(uint16) (sayo.FirmwareManifest, error) {
			t.Fatal("bare wonkey fetched a firmware manifest")
			return sayo.FirmwareManifest{}, nil
		}
		var out, diag bytes.Buffer
		if err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err != nil {
			t.Fatalf("err=%v diag=%q", err, diag.String())
		}
		for _, want := range []string{
			"[1] Bootloader (8089:000c)\n",
			"  Layout     Bootloader recovery mode\n",
			"  Model      0x0006, version 2214 (0x08a6), CHECK_FW reply 02 00 04 08 a6 00 06 00\n",
			"  Settings   Bootloader mode - run \"wonkey firmware update --device 1\" to recover\n",
		} {
			if !strings.Contains(out.String(), want) {
				t.Fatalf("missing %q in:\n%s", want, out.String())
			}
		}
	})

	t.Run("update-from-bootloader-mode", func(t *testing.T) {
		access := ch57TestAccess(t)
		access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{cBoot}, nil }
		access.probeSayo = bootProbe
		access.fetchSayoManifest = func(pid uint16) (sayo.FirmwareManifest, error) {
			if pid != 0x000c {
				t.Fatalf("unexpected manifest pid %#04x", pid)
			}
			return manifest, nil
		}
		access.fetchSayoBinary = func(pid uint16, path string) ([]byte, error) {
			if pid != 0x000c || path != "firmware/app_2X3_RGB_V2.bin" {
				t.Fatalf("unexpected binary fetch pid=%#04x path=%q", pid, path)
			}
			return make([]byte, 80), nil
		}
		access.flashSayoFirmware = func(_ string, _ string, c sayo.DiscoveredCandidate, proto sayo.ProtocolVersion, inBoot bool, m sayo.FirmwareManifest, e sayo.FirmwareManifestEntry, _ []byte, _ sayo.FirmwareProgressFunc) (sayo.ApplyResult, error) {
			if c != cBoot || proto != sayo.ProtocolV1 || !inBoot || m.PID2 != 12 || e.ModelCode != 6 {
				t.Fatalf("flash args: candidate=%+v proto=%v inBoot=%v manifest=%+v entry=%+v", c, proto, inBoot, m, e)
			}
			return sayo.ApplyResult{WriteAttempted: true}, nil
		}
		access.waitSayoRestart = func(string, string, sayo.DiscoveredCandidate) sayo.RestartResult {
			return sayo.RestartResult{LastSeen: `bootloader mode (8089:000c "Bootloader" devnum 36)`, Elapsed: 60 * time.Second}
		}
		var out, diag bytes.Buffer
		if err := runPublic([]string{"firmware", "update"}, &cliRuntime{strings.NewReader(""), &out, &diag}, access); err == nil || ExitCode(err) != 1 {
			t.Fatalf("err=%v diag=%q, want exit 1 for an unconfirmed restart", err, diag.String())
		}
		if !strings.Contains(out.String(), "  firmware: bootloader (2214 / 0x08a6) -> 2214 (0x08a6) (2X3_RGB_V2)\n") || !strings.Contains(out.String(), "Firmware written and verified") {
			t.Fatalf("unexpected output:\n%s", out.String())
		}
	})

	t.Run("failed-update-gives-recovery-advice", func(t *testing.T) {
		access := ch57TestAccess(t)
		access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{cSayo}, nil }
		access.probeSayo = func(string, string, sayo.DiscoveredCandidate) (sayo.ProbeResult, error) {
			return sayo.ProbeResult{Status: sayo.ProbeRawReport, Layout: &sayo.DeviceLayout{Protocol: sayo.ProtocolV2, ModelCode: 6, FirmwareVersion: 2202}}, nil
		}
		access.fetchSayoManifest = func(uint16) (sayo.FirmwareManifest, error) { return manifest, nil }
		access.fetchSayoBinary = func(uint16, string) ([]byte, error) { return make([]byte, 80), nil }
		flashErr := errors.New("timed out waiting for SayoDevice bootloader at USB path 7-1.4.3.4 after 30s")
		access.flashSayoFirmware = func(string, string, sayo.DiscoveredCandidate, sayo.ProtocolVersion, bool, sayo.FirmwareManifest, sayo.FirmwareManifestEntry, []byte, sayo.FirmwareProgressFunc) (sayo.ApplyResult, error) {
			return sayo.ApplyResult{WriteAttempted: true}, flashErr
		}
		var out, diag bytes.Buffer
		err := runPublic([]string{"firmware", "update"}, &cliRuntime{strings.NewReader(""), &out, &diag}, access)
		if !errors.Is(err, flashErr) {
			t.Fatalf("err=%v, want %v", err, flashErr)
		}
		want := "Device state uncertain. Run \"wonkey\" to check USB path 7-1.4.3.4.\nIn bootloader mode, run \"wonkey firmware update --device 1\" to recover.\nStop. No automatic retry or rollback.\n"
		if !strings.Contains(out.String(), want) {
			t.Fatalf("missing %q in:\n%s", want, out.String())
		}
	})

	t.Run("progress-tty-and-non-tty", func(t *testing.T) {
		var nonTTYOut bytes.Buffer
		hNonTTY := humanFor(&nonTTYOut, false, func(string) string { return "" })
		hNonTTY.progress("Flashing", 0, 80)
		hNonTTY.progress("Flashing", 32, 80)
		hNonTTY.progress("Flashing", 64, 80)
		hNonTTY.progress("Flashing", 80, 80)
		wantNonTTY := "  Flashing   [####################] 100% (80/80 B)\n"
		if nonTTYOut.String() != wantNonTTY {
			t.Fatalf("non-tty progress = %q, want %q", nonTTYOut.String(), wantNonTTY)
		}

		var ttyOut bytes.Buffer
		hTTY := humanFor(&ttyOut, true, func(string) string { return "" })
		hTTY.progress("Flashing", 0, 80)
		hTTY.progress("Flashing", 40, 80)
		hTTY.progress("Flashing", 80, 80)
		hTTY.progress("Writing", 64, 64)
		wantTTY := "\r  Flashing   [--------------------]   0% (0/80 B)" +
			"\r  Flashing   [##########----------]  50% (40/80 B)" +
			"\r  Flashing   [####################] 100% (80/80 B)\n" +
			"\r  Writing    [####################] 100% (64/64 B)\n"
		if ttyOut.String() != wantTTY {
			t.Fatalf("tty progress = %q, want %q", ttyOut.String(), wantTTY)
		}
	})
}

func TestPublicFirmwareUpdateRestart(t *testing.T) {
	cSayo := sayo.DiscoveredCandidate{
		Candidate:    sayo.Candidate{PhysicalPath: "7-1.4.3.4", VID: 0x8089, PID: 0x000c},
		ProductName:  "SayoDevice 2x3P",
		BusNumber:    7,
		DeviceNumber: 35,
	}
	restarted := cSayo
	restarted.DeviceNumber = 37
	checksum := 1
	manifest := sayo.FirmwareManifest{
		VID: 0x8089, PID: 12, PID2: 12, AddrLen: 4, EraseFlash: 1, HIDChecksum: &checksum,
		Data: []sayo.FirmwareManifestEntry{{Model: "2X3_RGB_V2", ModelCode: 6, Version: 2214, FilePath: "firmware/app_2X3_RGB_V2.bin"}},
	}
	layout := func(version uint16) *sayo.DeviceLayout {
		return &sayo.DeviceLayout{Protocol: sayo.ProtocolV2, ModelCode: 6, FirmwareVersion: version}
	}
	const card = "1️⃣ WonKey\n\n" +
		"[1] SayoDevice 2x3P (8089:000c)\n" +
		"  USB path   7-1.4.3.4\n" +
		"  Model      2X3_RGB_V2 (0x0006)\n" +
		"  Current    2202 (0x089a)\n" +
		"  Latest     2214 (0x08a6)\n" +
		"  Firmware   firmware/app_2X3_RGB_V2.bin\n" +
		"Changes:\n" +
		"  firmware: 2202 (0x089a) -> 2214 (0x08a6) (2X3_RGB_V2)\n" +
		"  Flashing   [####################] 100% (80/80 B)\n" +
		"Waiting for the device to restart...\n"
	run := func(t *testing.T, restart sayo.RestartResult, after sayo.FirmwareInfo, afterErr error) (string, string, error) {
		t.Helper()
		access := ch57TestAccess(t)
		access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{cSayo}, nil }
		probes, queries := 0, 0
		access.probeSayo = func(_ string, _ string, c sayo.DiscoveredCandidate) (sayo.ProbeResult, error) {
			probes++
			if probes != 1 || c != cSayo {
				t.Fatalf("unexpected settings probe %d of %+v", probes, c)
			}
			return sayo.ProbeResult{Status: sayo.ProbeRawReport, Layout: layout(2202)}, nil
		}
		access.querySayoVersion = func(_ string, _ string, c sayo.DiscoveredCandidate) (sayo.FirmwareInfo, error) {
			queries++
			if queries != 1 || !restart.Restarted || c != restarted {
				t.Fatalf("unexpected version query %d of %+v", queries, c)
			}
			return after, afterErr
		}
		access.fetchSayoManifest = func(uint16) (sayo.FirmwareManifest, error) { return manifest, nil }
		access.fetchSayoBinary = func(uint16, string) ([]byte, error) { return make([]byte, 80), nil }
		flashes := 0
		access.flashSayoFirmware = func(_ string, _ string, _ sayo.DiscoveredCandidate, _ sayo.ProtocolVersion, _ bool, _ sayo.FirmwareManifest, _ sayo.FirmwareManifestEntry, fw []byte, onProgress sayo.FirmwareProgressFunc) (sayo.ApplyResult, error) {
			flashes++
			onProgress(len(fw), len(fw))
			return sayo.ApplyResult{WriteAttempted: true, ReportsWritten: 7}, nil
		}
		waits := 0
		access.waitSayoRestart = func(_ string, _ string, prev sayo.DiscoveredCandidate) sayo.RestartResult {
			waits++
			if prev != cSayo || flashes != 1 {
				t.Fatalf("restart wait for %+v after %d flashes", prev, flashes)
			}
			return restart
		}
		var out, diag bytes.Buffer
		err := runPublic([]string{"firmware", "update"}, &cliRuntime{strings.NewReader(""), &out, &diag}, access)
		if flashes != 1 || waits != 1 {
			t.Fatalf("flashes=%d waits=%d, want one each and no retry", flashes, waits)
		}
		if err != nil && ExitCode(err) != 1 {
			t.Fatalf("exit code %d, want 1", ExitCode(err))
		}
		return out.String(), diag.String(), err
	}
	confirmed := sayo.RestartResult{Restarted: true, Candidate: restarted, Elapsed: time.Second}

	t.Run("restart-confirms-version", func(t *testing.T) {
		got, _, err := run(t, sayo.RestartResult{Restarted: true, Candidate: restarted, Elapsed: 280 * time.Millisecond},
			sayo.FirmwareInfo{ModelCode: 6, FirmwareVersion: 2214}, nil)
		want := card + "Firmware updated: 2202 (0x089a) -> 2214 (0x08a6), confirmed.\n  Restart    0.3s\n"
		if err != nil || got != want {
			t.Fatalf("err=%v\ngot:\n%s\nwant:\n%s", err, got, want)
		}
	})

	t.Run("restart-with-wrong-version-or-model-is-an-error", func(t *testing.T) {
		for _, tc := range []struct {
			info     sayo.FirmwareInfo
			reported string
		}{
			{sayo.FirmwareInfo{ModelCode: 6, FirmwareVersion: 2202}, "model 0x0006, version 2202 (0x089a)"},
			{sayo.FirmwareInfo{ModelCode: 7, FirmwareVersion: 2214}, "model 0x0007, version 2214 (0x08a6)"},
		} {
			got, _, err := run(t, confirmed, tc.info, nil)
			want := card +
				"Firmware written and verified. The model or version differs.\n" +
				"  Expected   model 0x0006, version 2214 (0x08a6)\n" +
				"  Reported   " + tc.reported + "\n" +
				"Stop. No automatic retry or rollback.\n" +
				"Run \"wonkey firmware check --device 1\" to check the device.\n"
			wantErr := "restarted device reports " + tc.reported + ", expected model 0x0006, version 2214 (0x08a6)"
			if err == nil || err.Error() != wantErr || got != want {
				t.Fatalf("err=%v\ngot:\n%s\nwant:\n%s", err, got, want)
			}
		}
	})

	t.Run("failed-or-zero-version-query-is-a-failed-confirmation", func(t *testing.T) {
		queryErr := errors.New("read 0x00 info reply: connection timed out")
		for _, tc := range []struct {
			info    sayo.FirmwareInfo
			err     error
			wantErr string
		}{
			{sayo.FirmwareInfo{}, queryErr, "query firmware version after restart: read 0x00 info reply: connection timed out"},
			{sayo.FirmwareInfo{ModelCode: 6}, nil, "query firmware version after restart: the 0x00 info reply reports firmware version 0"},
		} {
			got, _, err := run(t, confirmed, tc.info, tc.err)
			want := card +
				"Firmware written and verified. The version query after restart failed.\n" +
				"Run \"wonkey firmware check --device 1\".\n"
			if err == nil || err.Error() != tc.wantErr || (tc.err != nil && !errors.Is(err, tc.err)) || got != want || strings.Contains(got, "different") {
				t.Fatalf("err=%v\ngot:\n%s\nwant:\n%s", err, got, want)
			}
		}
	})

	t.Run("bootloader-reply-after-restart-is-not-success", func(t *testing.T) {
		got, _, err := run(t, confirmed, sayo.FirmwareInfo{Bootloader: true}, nil)
		want := card +
			"Firmware written and verified. The device is still in bootloader mode.\n" +
			"Unplug and replug the device to start the new firmware.\n" +
			"Then run \"wonkey firmware check --device 1\".\n"
		if err == nil || err.Error() != "device is still in bootloader mode after restart" || got != want {
			t.Fatalf("err=%v\ngot:\n%s\nwant:\n%s", err, got, want)
		}
	})

	t.Run("deadline-with-device-in-bootloader-warns-and-fails", func(t *testing.T) {
		got, diag, err := run(t, sayo.RestartResult{Elapsed: 60 * time.Second, LastSeen: `bootloader mode (8089:000c "Bootloader" devnum 36)`}, sayo.FirmwareInfo{}, nil)
		want := card +
			"Firmware written and verified. The device did not restart within 60.0s.\n" +
			"  Last seen  bootloader mode (8089:000c \"Bootloader\" devnum 36)\n" +
			"Unplug and replug the device to start the new firmware.\n" +
			"Then run \"wonkey firmware check --device 1\".\n"
		wantDiag := "Error: firmware restart not confirmed within 60.0s.\nRun \"wonkey --help\" for commands.\n"
		if err == nil || got != want || diag != wantDiag {
			t.Fatalf("err=%v\ngot:\n%s\nwant:\n%s\ndiag:\n%s", err, got, want, diag)
		}
	})

	t.Run("deadline-with-device-absent-warns-and-fails", func(t *testing.T) {
		got, _, err := run(t, sayo.RestartResult{Elapsed: 60 * time.Second, LastSeen: "no device"}, sayo.FirmwareInfo{}, nil)
		if err == nil || !strings.Contains(got, "  Last seen  no device\n") || !strings.Contains(got, "Unplug and replug") {
			t.Fatalf("err=%v out:\n%s", err, got)
		}
	})
}

func TestPublicBareListingOfBootloader(t *testing.T) {
	cBoot := sayo.DiscoveredCandidate{
		Candidate:    sayo.Candidate{PhysicalPath: "7-1.4.3.4", VID: 0x8089, PID: 0x000c},
		ProductName:  "Bootloader",
		BusNumber:    7,
		DeviceNumber: 36,
	}
	descriptor, err := os.ReadFile(filepath.Join("..", "sayo", "testdata", "bootloader-2x3p-20261109", "report_descriptor"))
	if err != nil {
		t.Fatal(err)
	}
	run := func(t *testing.T, probed sayo.ProbeResult, probeErr error) (string, error) {
		t.Helper()
		access := ch57TestAccess(t)
		access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{cBoot}, nil }
		access.probeSayo = func(string, string, sayo.DiscoveredCandidate) (sayo.ProbeResult, error) { return probed, probeErr }
		var out, diag bytes.Buffer
		err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, &diag}, access)
		return out.String(), err
	}
	failed := sayo.ProbeResult{Status: sayo.ProbeTransferFailed, ReportDescriptor: descriptor, ReportDescriptorCount: len(descriptor), ReportDescriptorVerified: true}

	t.Run("bootloader-reply-supports-firmware-only", func(t *testing.T) {
		got, err := run(t, sayo.ProbeResult{
			Status: sayo.ProbeRawReport, Count: 64, Raw: make([]byte, 64),
			Layout: &sayo.DeviceLayout{Protocol: sayo.ProtocolV1, ModelCode: 6, FirmwareVersion: 2214, Bootloader: true},
		}, nil)
		if err != nil || strings.Count(got, "  Supports") != 1 || !strings.Contains(got, "  Supports   firmware\n") {
			t.Fatalf("err=%v out:\n%s", err, got)
		}
	})

	t.Run("restart-errors-give-plain-message-and-fail", func(t *testing.T) {
		for _, errno := range []syscall.Errno{syscall.EPROTO, syscall.ENODEV, syscall.EIO, syscall.ESHUTDOWN, syscall.ENOENT} {
			raw := fmt.Errorf("write 0x00 info query: %w", errno)
			got, err := run(t, failed, raw)
			for _, want := range []string{
				"[1] Bootloader (8089:000c)\n",
				"  Supports   firmware\n",
				"  Status     get-report-failed\n",
				"  Detail     " + raw.Error() + "\n" +
					"Device is restarting. Wait a few seconds and run wonkey again.\n" +
					"If it stays in bootloader mode, run wonkey firmware update --device 1 to\nrecover.\n",
			} {
				if err == nil || ExitCode(err) != 1 || err.Error() != "SayoDevice at USB path 7-1.4.3.4 did not answer in bootloader mode" || !strings.Contains(got, want) {
					t.Fatalf("%v: err=%v, missing %q in:\n%s", errno, err, want, got)
				}
			}
			if strings.Count(got, "  Supports") != 1 {
				t.Fatalf("%v: more than one Supports line:\n%s", errno, got)
			}
		}
	})

	t.Run("bootloader-from-discovery-without-descriptor", func(t *testing.T) {
		access := ch57TestAccess(t)
		known := cBoot
		known.Bootloader = true
		access.discoverSayo = func(string) ([]sayo.DiscoveredCandidate, error) { return []sayo.DiscoveredCandidate{known}, nil }
		access.probeSayo = func(string, string, sayo.DiscoveredCandidate) (sayo.ProbeResult, error) {
			return sayo.ProbeResult{Status: sayo.ProbeRefused}, fmt.Errorf("lstat /sys/bus/usb/devices/7-1.4.3.4: %w", syscall.ENOENT)
		}
		var out bytes.Buffer
		err := runPublic(nil, &cliRuntime{strings.NewReader(""), &out, io.Discard}, access)
		got := out.String()
		if err == nil || !strings.Contains(got, "  Supports   firmware\n") || strings.Contains(got, "key, mouse") || !strings.Contains(got, "Device is restarting.") {
			t.Fatalf("err=%v out:\n%s", err, got)
		}
	})

	t.Run("other-errors-are-returned", func(t *testing.T) {
		raw := fmt.Errorf("open /dev/hidraw5: %w", syscall.EACCES)
		got, err := run(t, failed, raw)
		if !errors.Is(err, syscall.EACCES) || !strings.Contains(got, "  Supports   firmware\n") || strings.Contains(got, "restarting") {
			t.Fatalf("err=%v out:\n%s", err, got)
		}
	})
}
