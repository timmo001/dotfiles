# ------------------------------
# Source profile
# ------------------------------
if [ -f $HOME/.zsh_profile ]; then
    source $HOME/.zsh_profile
fi

# ------------------------------
# Basic path
# ------------------------------
export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH

# ------------------------------
# History
# ------------------------------
export HISTFILE=$HOME/.zsh_history
export HISTSIZE=10000
export SAVEHIST=10000

# ------------------------------
# Oh my zsh
# ------------------------------
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git zsh-autosuggestions zsh-syntax-highlighting fast-syntax-highlighting zsh-autocomplete)
source $ZSH/oh-my-zsh.sh

# ------------------------------
# Starship
# ------------------------------
eval "$(starship init zsh)"
export STARSHIP_CONFIG=~/.config/starship/starship.toml

# ------------------------------
# Language
# ------------------------------
export LANGUAGE=en_GB.UTF-8
export LANG=en_GB.UTF-8
export LC_ALL=en_GB.UTF-8
export KEYMAP=uk

# ------------------------------
# Editor
# ------------------------------
export EDITOR=nvim
export VISUAL=nvim

# ------------------------------
# Go
# ------------------------------
export GOPATH=$HOME/go
export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin

# ------------------------------
# Node
# ------------------------------
export PATH=$HOME/.local/share/fnm:$PATH
eval "$(fnm env --use-on-cd --shell zsh)"

# ------------------------------
# Bun
# ------------------------------
[ -s "/home/aidan/.bun/_bun" ] && source "/home/aidan/.bun/_bun"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# ------------------------------
# Rust
# ------------------------------
# source $HOME/.cargo/env
# export PATH=$HOME/.cargo/bin:$PATH

# ------------------------------
# Brew for Linux
# ------------------------------
# eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

# ------------------------------
# Snaps
# ------------------------------
export PATH=$PATH:/snap/bin

# ------------------------------
# HDR / Gamescope
# ------------------------------
export ENABLE_HDR_WSI=1
export DXVK_HDR=1

# ------------------------------
# Aliases
# ------------------------------
alias cat=bat
alias la="tree"

alias ff="fastfetch"

## Git
alias lg="lazygit"

alias gc="git commit -m"
alias gca="git commit -a -m"
alias gp="git push origin HEAD"
alias gpu="git pull origin"
alias gst="git status"
alias glog="git log --graph --topo-order --pretty='%w(100,0,6)%C(yellow)%h%C(bold)%C(black)%d %C(cyan)%ar %C(green)%an%n%C(bold)%C(white)%s %N' --abbrev-commit"
alias gdiff="git diff"
alias gco="git checkout"
alias gb='git branch'
alias gba='git branch -a'
alias gadd='git add'
alias ga='git add -p'
alias gcoall='git checkout -- .'
alias gr='git remote'
alias gre='git reset'

## Docker
alias ld="lazydocker"

alias dco="docker compose"
alias dps="docker ps"
alias dpa="docker ps -a"
alias dl="docker ps -l -q"
alias dx="docker exec -it"

## Dirs
alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."
alias .....="cd ../../../.."
alias ......="cd ../../../../.."

# Flush DNS
alias flushdns="sudo resolvectl flush-caches"
alias fc="sudo resolvectl flush-caches"

# Bootstrap
alias bootstrap="cwd=$(pwd) && cd $HOME/.config/bootstrap && go run app/bootstrap.go && cd $cwd"

# Update dotfiles
alias update-dotfiles="cwd=$(pwd) && cd $HOME/.config/dotfiles && git pull && ./update.sh && cd $cwd && source $HOME/.zshrc"

# Update system apps
alias update-apt="sudo apt update && sudo apt upgrade && sudo apt autoremove && sudo apt autoclean"
alias update-yay="yay -Syu"
alias update-brew="brew update && brew upgrade && brew cleanup"
alias update-snap="sudo snap refresh"
alias update-flatpak="flatpak update"
alias update-system="update-yay && update-brew && update-snap && update-flatpak"

# Update neovim
alias update-nvim-base="cwd=$(pwd) && cd $HOME/.config/bootstrap && go run app/update-nvim.go && cd $cwd"
alias update-nvim-plugins='nvim "+Lazy! sync" +qa'
alias update-nvim="update-nvim-base && update-nvim-plugins"

# Update ghostty
alias update-ghostty="cwd=$(pwd) && cd $HOME/.config/bootstrap && go run app/update-ghostty.go && cd $cwd"

# Update all
alias update-all="update-system && update-dotfiles && update-nvim && update-ghostty && source $HOME/.zshrc"

# Gear lever (app images)
alias gearlever="flatpak run it.mijorus.gearlever"

# Copilot CLI
alias copilot="gh copilot"
alias cpe="gh copilot explain"
alias cps="gh copilot suggest"

# Go Automate
alias auto="go-automate"
alias ga="go-automate"

# Cursor
alias cursor="~/apps/appimages/cursor.appimage"

# Create a new release PR (Custom script in internal repo)
alias ghrpr="./.github/create-release-pr-draft.sh"

# Development
alias dev="git pull && pnpm i && pnpm dev"

# ------------------------------
# Commands
# ------------------------------
# Fastfetch
ff
