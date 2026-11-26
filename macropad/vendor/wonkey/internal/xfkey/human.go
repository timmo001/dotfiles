package xfkey

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"unicode"

	"github.com/charmbracelet/x/term"
)

type human struct {
	out         *humanWriter
	tty, colour bool
	trueColour  bool
	width       int
}

type humanWriter struct {
	writer io.Writer
	err    error
}

func (w *humanWriter) Write(p []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	n, err := w.writer.Write(p)
	if err == nil && n != len(p) {
		err = io.ErrShortWrite
	}
	w.err = err
	return n, err
}

func newHuman(out io.Writer) human {
	f, ok := out.(*os.File)
	tty := ok && term.IsTerminal(f.Fd())
	h := humanFor(out, tty, os.Getenv)
	if tty {
		if width, _, err := term.GetSize(f.Fd()); err == nil && width > 0 {
			h.width = width
		}
	}
	return h
}

func humanFor(out io.Writer, tty bool, getenv func(string) string) human {
	colour := tty && getenv("NO_COLOR") == "" && getenv("TERM") != "dumb" && getenv("TERM") != ""
	capability := strings.ToLower(getenv("COLORTERM"))
	return human{&humanWriter{writer: out}, tty, colour, colour && (capability == "truecolor" || capability == "24bit"), 80}
}

func escapeHuman(value string) string {
	var out strings.Builder
	for _, r := range value {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == '\u2028' || r == '\u2029' {
			quoted := strconv.QuoteRune(r)
			out.WriteString(quoted[1 : len(quoted)-1])
		} else {
			out.WriteRune(r)
		}
	}
	return out.String()
}

func (h human) style(code, text string) string {
	if h.colour && code != "" {
		return "\x1b[" + code + "m" + text + "\x1b[0m"
	}
	return text
}

func (h human) line(code, text string) {
	text = escapeHuman(text)
	for h.width > 0 && len([]rune(text)) > h.width {
		runes := []rune(text)
		cut := -1
		for i := 0; i <= h.width; i++ {
			if runes[i] == ' ' {
				cut = i
			}
		}
		if cut <= 0 {
			break
		}
		fmt.Fprintln(h.out, h.style(code, string(runes[:cut])))
		text = string(runes[cut+1:])
	}
	fmt.Fprintln(h.out, h.style(code, text))
}

func (h human) header() {
	fmt.Fprintln(h.out, h.style("34", "1️⃣ WonKey")+"\n")
}

func (h human) heading(text string) {
	h.line("36", text)
}

func (h human) field(label, value string) {
	if h.width > 0 && h.width < 60 {
		fmt.Fprintf(h.out, "  %s\n    %s\n", escapeHuman(label), escapeHuman(value))
		return
	}
	fmt.Fprintf(h.out, "  %-10s %s\n", escapeHuman(label), escapeHuman(value))
}

func (h human) rgb(value string) string {
	text := escapeHuman(value)
	if h.trueColour && len(value) == 7 && value[0] == '#' {
		rgb, err := strconv.ParseUint(value[1:], 16, 24)
		if err == nil {
			return fmt.Sprintf("\x1b[48;2;%d;%d;%dm  \x1b[0m %s", rgb>>16, (rgb>>8)&255, rgb&255, text)
		}
	}
	return text
}

func (h human) changes(views []changeView) {
	if len(views) == 0 {
		h.line("", "No changes needed.")
		return
	}
	h.line("36", "Changes:")
	for _, view := range views {
		before, after := escapeHuman(view.Before), escapeHuman(view.After)
		if view.Setting == "colour" {
			before, after = h.rgb(view.Before), h.rgb(view.After)
		}
		fmt.Fprintf(h.out, "  %s: %s -> %s\n", escapeHuman(view.Setting), before, after)
	}
}

func (h human) progress(label string, current, total int) {
	if total <= 0 {
		return
	}
	clamped := min(max(current, 0), total)
	pct := min(max((clamped*100)/total, 0), 100)
	filled := min(max((clamped*20)/total, 0), 20)
	bar := strings.Repeat("#", filled) + strings.Repeat("-", 20-filled)
	lineText := fmt.Sprintf("  %-10s [%s] %3d%% (%d/%d B)", escapeHuman(label), bar, pct, clamped, total)
	if h.tty {
		if clamped < total {
			_, _ = io.WriteString(h.out, "\r"+lineText)
		} else {
			_, _ = io.WriteString(h.out, "\r"+lineText+"\n")
		}
		return
	}
	if clamped == total {
		_, _ = io.WriteString(h.out, lineText+"\n")
	}
}
