#!/bin/sh
# Plasma sources this at login, so apps started from the desktop, the app menu
# and the taskbar find dot in ~/.local/bin and mise's tools. environment.d
# covers systemd user services, but the Plasma session takes its PATH from the
# login instead, where the On-Screen Keyboard launcher couldn't find dot.
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
