export PATH=$PATH:$HOME/.local/share/omarchy/bin
export PATH=$PATH:$HOME/.config/hypr/bin

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
export RIPGREP_CONFIG_PATH="${HOME}/.config/ripgrep/config"

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
# Hyprland
# ------------------------------
export XDG_CURRENT_DESKTOP=Hyprland
export XDG_SESSION_TYPE=wayland
export QT_QPA_PLATFORM=xcb
export QT_WAYLAND_DISABLE_WINDOWDECORATION=1
export ELECTRON_OZONE_PLATFORM_HINT=wayland

. "$HOME/.local/bin/env"

# Opencode
OPENCODE_ENABLE_EXA=1

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

dot() {
  local dot_bin="$HOME/.config/dotfiles/scripts/.local/bin/dot"
  local cmd="${1:-help}"
  local rc
  local original_dir="$PWD"
  local target_dir
  local found_dirty=0
  local upstream_sha
  local ahead_count
  local behind_count
  local repo
  local -a repos

  if [[ ! -x "$dot_bin" ]]; then
    echo "dot script not found or not executable: $dot_bin"
    return 1
  fi

  command "$dot_bin" "$@"
  rc=$?

  if [[ "${DOT_AUTO_CD:-1}" == "1" && "$cmd" == "diff" ]]; then
    repos=(
      "$HOME/.config/bootstrap"
      "$HOME/.config/hypr"
      "$HOME/.config/waybar"
      "$HOME/.config/ghostty"
      "$HOME/.config/uwsm"
      "$HOME/.config/dotfiles"
      "$HOME/.config/dotfiles-private"
      "$HOME/Documents/notes"
    )

    target_dir="$HOME/.config/dotfiles"
    for repo in "${repos[@]}"; do
      if ! git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        continue
      fi

      if [[ -n "$(git -C "$repo" status --porcelain 2>/dev/null)" ]]; then
        target_dir="$repo"
        found_dirty=1
        break
      fi
    done

    # Remote divergence (clean tree but ahead/behind upstream) — same priority order as repos
    if [[ $found_dirty -eq 0 ]]; then
      for repo in "${repos[@]}"; do
        if ! git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
          continue
        fi
        upstream_sha="$(git -C "$repo" rev-parse --verify '@{u}' 2>/dev/null)" || continue
        ahead_count="$(git -C "$repo" rev-list --count "${upstream_sha}..HEAD" 2>/dev/null)" || ahead_count=0
        behind_count="$(git -C "$repo" rev-list --count "HEAD..${upstream_sha}" 2>/dev/null)" || behind_count=0
        if [[ "$ahead_count" -gt 0 || "$behind_count" -gt 0 ]]; then
          target_dir="$repo"
          found_dirty=1
          break
        fi
      done
    fi

    if [[ $found_dirty -eq 1 ]]; then
      builtin cd "$target_dir" || return $rc
    elif [[ $rc -ne 0 ]]; then
      builtin cd "$HOME/.config/dotfiles" || return $rc
    else
      builtin cd "$original_dir" || return $rc
    fi
  else
    builtin cd "$original_dir" || return $rc
  fi

  return $rc
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

command-breakdown() {
  local verbose=0

  while (( $# > 0 )); do
    case "$1" in
    -v|--verbose)
      verbose=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      echo "Usage: command-breakdown [-v|--verbose] <command> [args ...]" >&2
      return 1
      ;;
    *)
      break
      ;;
    esac
  done

  if (( $# == 0 )); then
    echo "Usage: command-breakdown [-v|--verbose] <command> [args ...]"
    return 1
  fi

  local -a tokens expanded
  local first resolved where_output
  local last_alias_name=""
  local last_alias_first=""
  local last_alias_word_count=0
  local -A seen
  local depth=0
  local indent=""

  tokens=("$@")
  first="${tokens[1]}"

  while (( ${+aliases[$first]} )); do
    if [[ -n "${seen[$first]}" ]]; then
      if (( verbose )); then
        echo "${indent}${first} -> cycle detected"
      fi
      echo "cycle-detected:${first}" >&2
      return 1
    fi
    seen[$first]=1

    if (( verbose )); then
      echo "${indent}${first} -> alias: ${aliases[$first]}"
    fi

    last_alias_name="$first"
    expanded=(${(z)aliases[$first]})
    last_alias_first="${expanded[1]}"
    last_alias_word_count=${#expanded[@]}
    tokens=("${expanded[@]}" "${tokens[@]:1}")
    first="${tokens[1]}"

    depth=$((depth + 1))
    indent=$(printf '%*s' $((depth * 2)) '')
  done

  if whence -p "$first" >/dev/null 2>&1; then
    resolved=$(whence -p "$first")
    if (( verbose )); then
      echo "${indent}${first} -> command: ${resolved}"
    fi
    tokens[1]="$resolved"
  elif (( ${+functions[$first]} )); then
    if [[ -n "$last_alias_name" ]] \
      && (( ${+builtins[$last_alias_name]} )) \
      && (( last_alias_word_count == 1 )) \
      && [[ "$last_alias_first" == "$first" ]]; then
      if (( verbose )); then
        echo "${indent}${first} -> function (builtin alias target for ${last_alias_name})"
      fi
      tokens[1]="$last_alias_name"
    elif (( verbose )); then
      echo "${indent}${first} -> function"
    fi
  else
    where_output=$(where "$first" 2>/dev/null)
    if [[ -n "$where_output" ]]; then
      resolved="${where_output%%$'\n'*}"
      if (( verbose )); then
        echo "${indent}${first} -> ${resolved}"
      fi
      tokens[1]="$resolved"
    elif (( verbose )); then
      echo "${indent}${first} -> not found"
    fi
  fi

  print -r -- ${(j: :)tokens}
}

# ------------------------------
# Aliases
# ------------------------------

# alias cat="bat"
alias la="tree"
alias cbd="command-breakdown"

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
alias gap='git add -p'
alias gcoall='git checkout -- .'
alias gr='git remote'
alias gre='git reset'

git-merged-branches() {
  local default_branch current_branch branch

  current_branch=$(git branch --show-current 2>/dev/null)

  if command -v gh >/dev/null 2>&1 && gh repo view >/dev/null 2>&1; then
    default_branch=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null)

    if [ -n "$default_branch" ]; then
      gh pr list --state merged --base "$default_branch" --json headRefName --jq '.[].headRefName' 2>/dev/null \
        | while IFS= read -r branch; do
            if [ -n "$branch" ] && [ "$branch" != "$current_branch" ] && git show-ref --verify --quiet "refs/heads/$branch"; then
              echo "$branch"
            fi
          done \
        | sort -u
      return 0
    fi
  fi

  default_branch=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | cut -d/ -f2-)

  if [ -z "$default_branch" ]; then
    echo "Could not detect the default branch from GitHub or origin/HEAD"
    return 1
  fi

  git for-each-ref refs/heads/ --merged "origin/$default_branch" --format='%(refname:short)' \
    | grep -vx "$default_branch" \
    | grep -vx "$current_branch"
}

git-update() {
  # Save current directory
  local current_dir=$(pwd) # Save current directory
  cd $1 # Change to the given path
  git pull --rebase # Pull the latest changes
  cd $current_dir # Change back to the original directory
}

## Docker
alias ld="lazydocker"

alias dco="docker compose"
alias dps="docker ps"
alias dpa="docker ps -a"
alias dl="docker ps -l -q"
alias dx="docker exec -it"

# Dirs
alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."
alias .....="cd ../../../.."
alias ......="cd ../../../../.."

# Flush DNS
alias flushdns="sudo resolvectl flush-caches"
alias fc="sudo resolvectl flush-caches"

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
alias dotfiles="cd ~/.config/dotfiles"
alias dotfiles-private="cd ~/.config/dotfiles-private"
alias config="cd ~/.config"
alias repos="cd ~/repos"

# Reboot to Windows
alias reboot-windows="reboot-to windows"

# Reboot to Bazzite
alias reboot-bazzite="reboot-to bazzite"

# Reboot to UEFI firmware setup
alias reboot-uefi="reboot-to uefi"
alias reboot-bios="reboot-to bios"

# Find and edit
alias fe="find-and-edit"
alias fev="find-and-edit --visual"

# Cursor
# alias cursor="/usr/bin/cursor $(grep -v '^#' ~/.config/cursor-flags.conf 2>/dev/null | tr '\n' ' ')"

# Omarchy shorcuts
alias olw="omarchy-launch-webapp"
alias ou="omarchy-update"
alias ouf="omarchy-update-firmware"

# ------------------------------
# Omarchy Part 1 - History
# Part of ~/.local/share/omarchy/default/bash/shell
# ------------------------------
HISTCONTROL=ignoreboth
HISTSIZE=32768
HISTFILESIZE="${HISTSIZE}"

# ------------------------------
# Omarchy Part 2
# ------------------------------
# source ~/.local/share/omarchy/default/bash/shell
source ~/.local/share/omarchy/default/bash/aliases
source ~/.local/share/omarchy/default/bash/functions
# source ~/.local/share/omarchy/default/bash/prompt

# ------------------------------
# Omarchy Part 3 - Mise
# Partically from ~/.local/share/omarchy/default/bash/init
# ------------------------------
if command -v mise &> /dev/null; then
  eval "$(mise activate bash)"
fi

# ------------------------------
# Omarchy Part 4
# ------------------------------
source ~/.local/share/omarchy/default/bash/envs
# [[ $- == *i* ]] && bind -f ~/.local/share/omarchy/default/bash/inputrc

# ------------------------------
# Omarchy extras
# ------------------------------
timmo-update-extras() {
  git-update ~/.config/hypr
  git-update ~/.config/waybar
  git-update ~/.config/ghostty
  git-update ~/.config/uwsm
  git-update ~/.config/dotfiles
  git-update ~/.config/dotfiles-private
}

# ------------------------------
# Private dotfiles
# ------------------------------
if [ -f ~/.zshrc-private ]; then
  source ~/.zshrc-private
fi

# ------------------------------
# Key bindings for word navigation
# ------------------------------
# Ctrl+Left/Right for word navigation
bindkey "^[[1;5D" backward-word
bindkey "^[[1;5C" forward-word

# Alt+Left/Right for word navigation (alternative)
bindkey "^[[1;3D" backward-word
bindkey "^[[1;3C" forward-word

# ------------------------------
# Commands
# ------------------------------
clear

# Fastfetch
# ff

# Vite+ bin (https://viteplus.dev)
. "$HOME/.vite-plus/env"
