export PATH=$PATH:$HOME/.local/share/omarchy/bin

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
export VISUAL=cursor
export REACT_EDITOR=cursor

# ------------------------------
# GPG
# ------------------------------
export GPG_TTY=$(tty)

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
source $HOME/.cargo/env
export PATH=$HOME/.cargo/bin:$PATH

# ------------------------------
# Brew for Linux
# ------------------------------
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

# -------------------------------
# Java
# ------------------------------
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export PATH=$JAVA_HOME/bin:$PATH

# ------------------------------
# Android
# ------------------------------
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools

# ------------------------------
# HDR / Gamescope
# ------------------------------
export ENABLE_HDR_WSI=1
export DXVK_HDR=1

# -------------------------------
# SST
# -------------------------------
export PATH=/home/aidan/.sst/bin:$PATH

# ------------------------------
# Hyprland
# ------------------------------
export XDG_CURRENT_DESKTOP=Hyprland
export XDG_SESSION_TYPE=wayland
export QT_QPA_PLATFORM=xcb
export QT_WAYLAND_DISABLE_WINDOWDECORATION=1

# ------------------------------
# Load environment variables
# from .env file if it exists
# ------------------------------
load-env() {
  if [ -f .env ]; then
    while IFS='=' read -r key value; do
      if [[ ! $key =~ ^# && -n $key ]]; then
        export "$key=$value"
      fi
    done <.env
    echo "Loaded environment variables from .env"
  else
    echo "No .env file found in current directory"
  fi
}

# ------------------------------
# Change directory and load .env
# ------------------------------
cd-env() {
  cd "$1"
  load-env
}

# ------------------------------
# Development
# ------------------------------
dev() {
  git pull

  if [ -f go.mod ]; then
    echo "Using go..."
    go run . "$@"
    return 0
  fi

  if [ -f requirements.txt ] || [ -f pyproject.toml ]; then
    echo "Using python..."
    if [ -f .venv/bin/activate ]; then
      source .venv/bin/activate
    else
      uv venv .venv
      source .venv/bin/activate
    fi
    uv pip install -r requirements.txt 2>/dev/null || uv pip install -e .
    python main.py "$@"
    return 0
  fi

  # Open cursor
  cursor .

  if [ -f package.json ]; then
    if [ -f deno.lock ]; then
      echo "Using deno..."
      deno task dev "$@"
    elif [ -f bun.lock ]; then
      echo "Using bun..."
      bun i
      bun dev "$@"
    elif [ -f pnpm-lock.yaml ]; then
      echo "Using pnpm..."
      pnpm i
      pnpm dev "$@"
    elif [ -f yarn.lock ]; then
      echo "Using yarn..."
      yarn i
      yarn dev "$@"
    else
      echo "Using npm..."
      npm i
      npm run dev "$@"
    fi
    return 0
  fi

  echo "No supported project files found (go.mod, requirements.txt, pyproject.toml, package.json)"
  return 1
}

# Function to find and edit a file in a specified directory (or current if none given)
find-and-edit() {
  local use_visual=0
  local dir="."
  local file

  # Parse arguments for --visual flag and optional directory
  for arg in "$@"; do
    case "$arg" in
    --visual)
      use_visual=1
      ;;
    *)
      dir="$arg"
      ;;
    esac
  done

  # Use fd if available, otherwise fall back to find
  if command -v fd &>/dev/null; then
    file=$(fd --type f . "$dir" | fzf --height 40% --reverse --prompt="Edit: ")
  else
    file=$(find "$dir" -type f | fzf --height 40% --reverse --prompt="Edit: ")
  fi

  if [[ -n "$file" ]]; then
    if [[ $use_visual -eq 1 ]]; then
      "$VISUAL" "$file"
    else
      "$EDITOR" "$file"
    fi
  else
    echo "No file selected."
  fi
}

bulk-rename-files() {
  if [ $# -ne 2 ]; then
    echo "Usage: bulk-rename-files <pattern> <replacement>"
    return 1
  fi

  local pattern="$1"
  local replacement="$2"
  local files
  local old new

  # Remove the leading * from the pattern to get the suffix
  local suffix="${pattern#\*}"

  files=()
  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(find . -type f -name "$pattern" -print0)

  if [ ${#files[@]} -eq 0 ]; then
    echo "No files found matching pattern: $pattern"
    return 0
  fi

  echo "The following files will be renamed:"
  for old in "${files[@]}"; do
    if [[ "$old" == *"$suffix" ]]; then
      new="${old/%$suffix/$replacement}"
      echo "'$old' -> '$new'"
    fi
  done

  echo -n "Proceed? [y/N]: "
  read -r answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    return 0
  fi

  for old in "${files[@]}"; do
    if [[ "$old" == *"$suffix" ]]; then
      new="${old/%$suffix/$replacement}"
      if [ -e "$new" ]; then
        echo "Skipping '$old' (target '$new' exists)"
        continue
      fi
      mv -- "$old" "$new"
    fi
  done
  echo "Done."
}

save-installed-packages() {
  local outfile="$HOME/.local/installed-packages.txt"
  echo "# System packages (including AUR)" >"$outfile"
  yay -Qqe | sort -u | tr '\n' ' ' >>"$outfile"
  echo -e "\n\n# Brew formulae" >>"$outfile"
  if command -v brew &>/dev/null; then
    brew list --formula | sort -u | tr '\n' ' ' >>"$outfile"
    echo -e "\n\n# Brew casks" >>"$outfile"
    brew list --cask | sort -u | tr '\n' ' ' >>"$outfile"
  else
    echo "brew not found" >>"$outfile"
  fi
  echo -e "\n\n# Flatpak apps" >>"$outfile"
  if command -v flatpak &>/dev/null; then
    flatpak list --app --columns=application | sort -u | tr '\n' ' ' >>"$outfile"
  else
    echo "flatpak not found" >>"$outfile"
  fi
  echo -e "\n" >>"$outfile"
  echo "Saved all user-installed packages (system, brew, flatpak) to $outfile"
}

# ------------------------------
# Aliases
# ------------------------------
# alias cat="bat"
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

# Image optimiser
alias img-optimise="$HOME/.img-optimize/optimize.sh"
alias img-pngwebp-to-webp="bulk-rename-files '*.png.webp' '.webp'"
alias img-jpgwebp-to-webp="bulk-rename-files '*.jpg.webp' '.webp'"
alias img-optimise-all="img-optimise --all && img-pngwebp-to-webp && img-jpgwebp-to-webp"

# Update system apps
alias update-yay="yay -Syu"
alias update-brew="brew update && brew upgrade && brew cleanup"
alias update-flatpak="sudo flatpak update"
alias update-system="update-yay && update-brew && update-flatpak && save-installed-packages"
alias update-mirrors="sudo reflector --country 'GB' --age 12 --protocol https --sort rate --save /etc/pacman.d/mirrorlist"

# Update all
alias update-all="update-system && update-dotfiles && source $HOME/.zshrc"

# Gear lever (app images)
alias gearlever="flatpak run it.mijorus.gearlever"

# Copilot CLI
alias copilot="gh copilot"
alias cpe="gh copilot explain"
alias cps="gh copilot suggest"

# Go Automate
alias auto="go-automate"
alias ga="go-automate"

# Create a new release PR (Custom script in internal repo)
alias ghrpr="./.github/create-release-pr-draft.sh"

# Go
alias gor="go run ."
alias gob="go build ."
alias goi="go install ."

# Quick paths
alias home="cd ~"
alias dotfiles="cd ~/.local/dotfiles"
alias dotfiles-private="cd ~/.local/dotfiles-private"
alias config="cd ~/.config"
alias repos="cd ~/repos"

# Reboot to windows
alias reboot-windows="reboot-to-windows"

# Find and edit
alias fe="find-and-edit"
alias fev="find-and-edit --visual"

# ------------------------------
# Private dotfiles
# ------------------------------
if [ -f ~/.zshrc-private ]; then
  source ~/.zshrc-private
fi

# ------------------------------
# Commands
# ------------------------------
clear

# Fastfetch
# ff

. "$HOME/.local/share/../bin/env"
