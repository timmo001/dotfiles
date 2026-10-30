// Omarchy Pill: Hokum's Pill in the current Omarchy theme's colours, rendered
// by omarchy-theme-set-templates on every theme change. One line per
// notification, icon first, with a close button at the end; buttons and
// progress only show when sent.
name "Omarchy Pill"

tokens {
    width 380
    radius 10
    padding 7 14 7 8
    gap 4
    spacing 8
    badge-radius 6
    icon-size 22
    fill "{{ background }}"
    text "{{ foreground }}"
    muted "{{ mix foreground background 30% }}"
    faint "{{ mix foreground background 55% }}"
    border "none"
    accent "{{ accent }}"
    shadow "deep"
    mark "icon"
    enter "drop"
    motion 0.34 0.2
}

template "card" {
    row gap=10 align="center" {
        if "image" { image width=22 height=22 radius=6 }
        else { badge }
        col gap=1 grow=#true {
            if "summary" { text "{summary}" weight="title" lines=1 }
            else { text "{app}" weight="title" lines=1 }
            if "body" { text "{body}" color="muted" lines=3 }
        }
        if "value" { col width=90 { progress color="accent" } }
        close size=20
    }
    if "actions" { actions indent=#true gap=6 }
}

rule urgency="critical" {
    tokens {
        fill "{{ mix red background 75% }}"
        border "none"
        accent "{{ red }}"
    }
}
