package xfkey

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
)

type failingHumanOutput struct {
	needle string
	short  bool
	failed bool
	calls  int
}

func (w *failingHumanOutput) Write(p []byte) (int, error) {
	w.calls++
	if !w.failed && strings.Contains(string(p), w.needle) {
		w.failed = true
		if w.short {
			return len(p) - 1, nil
		}
		return 0, io.ErrClosedPipe
	}
	return len(p), nil
}

func TestSettingNamesAndViews(t *testing.T) {
	for _, tc := range []struct {
		setting string
		offset  int
		values  map[string]int
		shift   int
		names   map[byte]string
	}{
		{"key", 4, keyValues, 0, supportedKeyNames()},
		{"trigger", 1, triggerValues, 0, map[byte]string{1: "press", 2: "release", 3: "both"}},
		{"lighting", 124, lightingValues, 1, map[byte]string{1: "cycle-slow", 2: "static", 3: "breathe", 4: "flash", 5: "cycle-fast", 6: "off", 7: "held", 8: "toggle"}},
	} {
		t.Run(tc.setting, func(t *testing.T) {
			for value := range 256 {
				want := tc.names[byte(value)]
				if got := settingName(tc.values, value-tc.shift); got != want {
					t.Fatalf("value %d: got %q, want %q", value, got, want)
				}
				if want == "" {
					continue
				}
				current := syntheticSettings()
				intended := current
				intended[tc.offset] = byte(value)
				views := settingViews(current, intended)
				if current == intended {
					if len(views) != 0 {
						t.Fatal(views)
					}
					continue
				}
				expected := changeView{tc.setting, tc.names[current[tc.offset]], want}
				if len(views) != 1 || views[0] != expected {
					t.Fatalf("value %d: got %v, want %v", value, views, expected)
				}
			}
		})
	}
}

func TestHumanRetainsOutputFailure(t *testing.T) {
	for _, short := range []bool{false, true} {
		out := &failingHumanOutput{short: short}
		h := newHuman(out)
		h.width = 12
		h.line("", "A wrapped line stops after its first failed write.")
		copy := h
		copy.heading("Heading")
		copy.field("Field", "value")
		copy.changes([]changeView{{"key", "enter", "f13"}})
		want := io.ErrClosedPipe
		if short {
			want = io.ErrShortWrite
		}
		if !errors.Is(h.out.err, want) || !errors.Is(copy.out.err, want) || out.calls != 1 {
			t.Fatalf("error=%v copied error=%v writes=%d", h.out.err, copy.out.err, out.calls)
		}
	}
}

func TestHumanColourPolicyAndSwatch(t *testing.T) {
	for _, tc := range []struct {
		name, term, noColour, capability string
		tty, colour, rgb                 bool
	}{
		{"truecolour", "xterm-256color", "", "truecolor", true, true, true},
		{"24bit", "xterm", "", "24bit", true, true, true},
		{"ansi", "xterm", "", "", true, true, false},
		{"redirected", "xterm", "", "truecolor", false, false, false},
		{"no-colour", "xterm", "1", "truecolor", true, false, false},
		{"dumb", "dumb", "", "truecolor", true, false, false},
		{"unset-term", "", "", "truecolor", true, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			env := map[string]string{"TERM": tc.term, "NO_COLOR": tc.noColour, "COLORTERM": tc.capability}
			h := humanFor(&out, tc.tty, func(k string) string { return env[k] })
			h.width = 1
			h.header()
			want := "1️⃣ WonKey\n\n"
			if tc.colour {
				want = "\x1b[34m1️⃣ WonKey\x1b[0m\n\n"
			}
			if out.String() != want {
				t.Fatalf("header=%q, want %q", out.String(), want)
			}
			h.heading("Current settings")
			out.WriteString(h.rgb("#1234EF"))
			got := out.String()
			if strings.Contains(got, "\x1b[") != tc.colour || strings.Contains(got, "\x1b[48;2;18;52;239m") != tc.rgb || !strings.Contains(got, "#1234EF") {
				t.Fatal(got)
			}
		})
	}
	t.Setenv("TERM", "xterm")
	t.Setenv("COLORTERM", "truecolor")
	var out bytes.Buffer
	if newHuman(&out).colour {
		t.Fatal("redirected stream has colour")
	}
}

func TestHumanEscaping(t *testing.T) {
	var out bytes.Buffer
	h := newHuman(&out)
	attack := "path\x1b[31m\nforged\r\t\u202e"
	h.field("Records", attack)
	h.changes([]changeView{{attack, attack, attack}})
	got := out.String()
	if strings.ContainsAny(got, "\x1b\r\t\u202e") || strings.Contains(got, "\nforged") || !strings.Contains(got, `\x1b`) {
		t.Fatal(got)
	}
}

func TestHumanNarrowOutputRetainsCopyableValues(t *testing.T) {
	var out bytes.Buffer
	h := newHuman(&out)
	h.width = 24
	h.line("", "Descriptions wrap at spaces on narrow terminals.")
	for line := range strings.SplitSeq(strings.TrimSpace(out.String()), "\n") {
		if len(line) > 24 {
			t.Fatal(out.String())
		}
	}
	out.Reset()
	directory := "/home/user/.local/state/wonkey/captures/20260912"
	h.field("Backup", directory)
	if !strings.Contains(out.String(), "Backup\n    "+directory+"\n") {
		t.Fatal(out.String())
	}
}
