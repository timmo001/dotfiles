# Non-interactive shells, such as the `herdr remote-client-bridge` a remote
# Herdr runs over SSH, read only this file. Put mise's shims and ~/.local/bin
# on PATH so they find the same tools; interactive shells also run
# `mise activate` from .zshrc.
typeset -U path
path=("$HOME/.local/bin" "${XDG_DATA_HOME:-$HOME/.local/share}/mise/shims" $path)
