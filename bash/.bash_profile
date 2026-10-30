# Login shells, such as SSH sessions, read only this, so they get .bashrc's shortcuts from here.
# shellcheck source=.bashrc
[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
