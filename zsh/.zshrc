export PATH="$PATH:$HOME/.local/share/omarchy/bin"
export PATH="$PATH:$HOME/.config/hypr/bin"

# ------------------------------
# Source profile
# ------------------------------
if [ -f "$HOME/.zsh_profile" ]; then
  source "$HOME/.zsh_profile"
fi

# ------------------------------
# Basic path
# ------------------------------
export PATH="$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# ------------------------------
# Completion fpath
# (compinit is handled by zsh-autocomplete, loaded below)
# ------------------------------
if [[ -d "${XDG_DATA_HOME:-$HOME/.local/share}/zsh/site-functions" ]]; then
  fpath=("${XDG_DATA_HOME:-$HOME/.local/share}/zsh/site-functions" $fpath)
fi

# ------------------------------
# mise completions
# Generated at runtime into a live (non-stowed) path; regenerates when the
# mise binary is upgraded. Runs before zsh-autocomplete's compinit so _mise
# is discovered on fpath in the same session. Not version-controlled.
# ------------------------------
if command -v mise &> /dev/null; then
  _mise_comp="${XDG_DATA_HOME:-$HOME/.local/share}/zsh/site-functions/_mise"
  if [[ ! -e "$_mise_comp" || "$(command -v mise)" -nt "$_mise_comp" ]]; then
    mise completion zsh > "$_mise_comp" 2>/dev/null
  fi
  unset _mise_comp
fi

# ------------------------------
# Ghostty shell features
# Strip title features; the hooks below own the terminal title.
# ------------------------------
if [[ -n "${GHOSTTY_SHELL_FEATURES:-}" ]]; then
  typeset -a _dot_ghostty_features
  _dot_ghostty_features=("${(@s:,:)GHOSTTY_SHELL_FEATURES}")
  _dot_ghostty_features=("${(@)_dot_ghostty_features:#title}")
  _dot_ghostty_features=("${(@)_dot_ghostty_features:#no-title}")
  export GHOSTTY_SHELL_FEATURES="${(j:,:)_dot_ghostty_features}"
  unset _dot_ghostty_features
fi

# ------------------------------
# Zsh plugins (pacman/AUR, managed by dot via .dot-public-packages)
# fast-syntax-highlighting replaces zsh-syntax-highlighting; do not load both.
# zsh-autocomplete loads last so it sees the widgets the others define.
# ------------------------------
[[ -r /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh ]] && \
  source /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
[[ -r /usr/share/zsh/plugins/fast-syntax-highlighting/fast-syntax-highlighting.plugin.zsh ]] && \
  source /usr/share/zsh/plugins/fast-syntax-highlighting/fast-syntax-highlighting.plugin.zsh
[[ -r /usr/share/zsh/plugins/zsh-autocomplete/zsh-autocomplete.plugin.zsh ]] && \
  source /usr/share/zsh/plugins/zsh-autocomplete/zsh-autocomplete.plugin.zsh

autoload -Uz _dot 2>/dev/null
compdef _dot dot 2>/dev/null

autoload -Uz _omarchy 2>/dev/null
compdef _omarchy omarchy 2>/dev/null

autoload -Uz _notes 2>/dev/null
compdef _notes notes note handoffs handoff 2>/dev/null

autoload -Uz _mise 2>/dev/null
compdef _mise mise 2>/dev/null

# ------------------------------
# Terminal title
# ------------------------------
autoload -Uz add-zsh-hook

_dot_set_terminal_title() {
  local title="$1"
  title=${title//$'\a'/}
  title=${title//$'\e'/}
  print -rn -- $'\e]2;'"${title[1,160]}"$'\a'
}

typeset -gA DOT_TERMINAL_TITLE_ALIASES

_dot_terminal_title_alias() {
  local command_line="$1"
  local command_name=""
  local -a command_words

  command_words=(${(z)command_line})
  command_name="${command_words[1]}"

  if [[ -n "$command_name" && -n "${DOT_TERMINAL_TITLE_ALIASES[$command_name]-}" ]]; then
    print -rn -- "$DOT_TERMINAL_TITLE_ALIASES[$command_name]"
  fi
}

_dot_terminal_title_command() {
  local command_line="$1"
  local expanded_line="${2:-}"
  local title=""

  title="$(_dot_terminal_title_alias "$command_line")"

  if [[ -z "$title" && -n "$expanded_line" ]]; then
    title="$(_dot_terminal_title_alias "$expanded_line")"
  fi

  if [[ -n "$title" ]]; then
    print -rn -- "$title"
  else
    print -rn -- "$command_line"
  fi
}

_dot_terminal_title_context() {
  local dir="${PWD/#$HOME/~}"
  local title="$dir"
  local branch git_status

  if command git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    branch=$(command git branch --show-current 2>/dev/null)
    if [[ -z "$branch" ]]; then
      branch=$(command git rev-parse --short HEAD 2>/dev/null)
    fi

    local conflicted stashed deleted renamed modified staged untracked
    local line index_status worktree_status
    if command git rev-parse --verify --quiet refs/stash >/dev/null 2>&1; then
      stashed='$'
    fi
    for line in "${(@f)$(command git --no-optional-locks status --porcelain=v1 2>/dev/null)}"; do
      index_status="${line[1,1]}"
      worktree_status="${line[2,2]}"

      if [[ "$index_status$worktree_status" == "??" ]]; then
        untracked="?"
        continue
      fi
      if [[ "$index_status" == "U" || "$worktree_status" == "U" || "$index_status$worktree_status" == "AA" || "$index_status$worktree_status" == "DD" ]]; then
        conflicted="="
      fi
      if [[ "$index_status" == "D" || "$worktree_status" == "D" ]]; then
        deleted="✘"
      fi
      if [[ "$index_status" == "R" ]]; then
        renamed="»"
      fi
      if [[ "$index_status" == "A" || "$index_status" == "M" ]]; then
        staged="+"
      fi
      if [[ "$worktree_status" == "M" || "$worktree_status" == "T" ]]; then
        modified="!"
      fi
    done
    git_status="${conflicted}${stashed}${deleted}${renamed}${modified}${staged}${untracked}"
    if [[ -n "$git_status" ]]; then
      git_status="[$git_status]"
    fi

    if [[ -n "$branch" ]]; then
      title="$title | $branch$git_status"
    fi
  fi

  print -rn -- "$title"
}

_dot_terminal_title_preexec() {
  local command_line="$1"
  local expanded_line="${3:-}"
  local command_title=""
  command_line=${command_line//$'\n'/ }
  command_line=${command_line//$'\r'/ }
  expanded_line=${expanded_line//$'\n'/ }
  expanded_line=${expanded_line//$'\r'/ }
  command_title="$(_dot_terminal_title_command "$command_line" "$expanded_line")"
  _dot_set_terminal_title "$command_title | $(_dot_terminal_title_context)"
}

_dot_terminal_title() {
  local last_status=$?
  local title="$(_dot_terminal_title_context)"

  if (( last_status != 0 )); then
    title="❯ $title"
  fi

  _dot_set_terminal_title "$title"
  return $last_status
}

# ------------------------------
# Starship
# ------------------------------
export STARSHIP_CONFIG=~/.config/starship/starship.toml
eval "$(starship init zsh)"

add-zsh-hook -d preexec _dot_terminal_title_preexec 2>/dev/null
add-zsh-hook preexec _dot_terminal_title_preexec
add-zsh-hook -d precmd _dot_terminal_title 2>/dev/null
add-zsh-hook precmd _dot_terminal_title

# ------------------------------
# Ripgrep
# ------------------------------
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
export GPG_TTY="$(tty)"

# ------------------------------
# Go
# ------------------------------
export GOPATH="$HOME/go"
export PATH="$PATH:/usr/local/go/bin:$HOME/go/bin"

# ------------------------------
# Hyprland
# ------------------------------
export XDG_CURRENT_DESKTOP=Hyprland
export XDG_SESSION_TYPE=wayland
export QT_QPA_PLATFORM=xcb
export QT_WAYLAND_DISABLE_WINDOWDECORATION=1
export ELECTRON_OZONE_PLATFORM_HINT=wayland

[ -f "$HOME/.local/bin/env" ] && . "$HOME/.local/bin/env"

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
alias gpf="git push --force-with-lease --force-if-includes origin HEAD"
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
  cd "$1" # Change to the given path
  git pull --rebase # Pull the latest changes
  cd "$current_dir" # Change back to the original directory
}

## Docker
alias ld="lazydocker"

alias dco="docker compose"
alias dps="docker ps"
alias dpa="docker ps -a"
alias dl="docker ps -l -q"
alias dx="docker exec -it"

# cwd is not a command: remind, then run the real one (pwd)
cwd() {
  print -P "%F{yellow}cwd isn't a command, the real one is: pwd%f" >&2
  pwd
}

# times is a shell builtin, so forward the command name to the timezone helper.
times() {
  "$HOME/.local/bin/times" "$@"
}

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

# Notes
alias handoffs="notes handoffs"

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
# History
# zsh-native settings (oh-my-zsh used to provide these). HISTFILE/SAVEHIST
# must be set or zsh keeps no persistent history, which leaves
# zsh-autosuggestions with nothing to suggest.
# ------------------------------
HISTFILE="$HOME/.zsh_history"
HISTSIZE=32768
SAVEHIST=32768
setopt SHARE_HISTORY        # share history across running shells
setopt EXTENDED_HISTORY     # record timestamps
setopt INC_APPEND_HISTORY   # append as commands run, not just on exit
setopt HIST_IGNORE_ALL_DUPS # drop older duplicate of a repeated command
setopt HIST_IGNORE_SPACE    # ignore commands that start with a space
setopt HIST_REDUCE_BLANKS   # tidy surplus whitespace

# ------------------------------
# Omarchy Part 2
# ------------------------------
# source ~/.local/share/omarchy/default/bash/shell
source ~/.local/share/omarchy/default/bash/aliases
# Omarchy's worktree helpers define ga()/gd(); our `ga` alias (go-automate)
# would make zsh fail to parse those functions, so drop it first.
unalias ga 2>/dev/null
source ~/.local/share/omarchy/default/bash/functions
# Re-assert our preferred ga: go-automate wins over the worktree helper.
alias ga="go-automate"
# source ~/.local/share/omarchy/default/bash/prompt

# ------------------------------
# Omarchy Part 3 - Mise
# Partically from ~/.local/share/omarchy/default/bash/init
# ------------------------------
if command -v mise &> /dev/null; then
  eval "$(mise activate zsh)"
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
  git-update ~/.config/waybar
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
# GitHub MCP bearer (OpenCode + Cursor)
# ------------------------------
# Sources the token from gh's keyring at shell start, so no secret lives here.
# Custom name to avoid generic credential-env sniffing; read via {env:DOT_GH_MCP_BEARER}.
command -v gh >/dev/null 2>&1 && export DOT_GH_MCP_BEARER="$(gh auth token 2>/dev/null)"

# ------------------------------
# Herdr default session
# ------------------------------
_dot_herdr_stop_if_last_pane() {
  [[ -n "${HERDR_ENV:-}" ]] || return 0
  command -v herdr >/dev/null 2>&1 || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local workspaces tabs panes
  workspaces="$(herdr workspace list 2>/dev/null | jq -r '(.result.workspaces // .workspaces // []) | length' 2>/dev/null)"
  tabs="$(herdr tab list 2>/dev/null | jq -r '(.result.tabs // .tabs // []) | length' 2>/dev/null)"
  panes="$(herdr pane list 2>/dev/null | jq -r '(.result.panes // .panes // []) | length' 2>/dev/null)"

  if [[ "$workspaces" == "1" && "$tabs" == "1" && "$panes" == "1" ]]; then
    herdr server stop >/dev/null 2>&1 || true
  fi
}

add-zsh-hook -d zshexit _dot_herdr_stop_if_last_pane 2>/dev/null
add-zsh-hook zshexit _dot_herdr_stop_if_last_pane

_dot_maybe_start_herdr() {
  [[ $- == *i* ]] || return 0
  [[ -z "${HERDR_ENV:-}" ]] || return 0
  [[ -z "${DOT_NO_HERDR:-}" ]] || return 0
  [[ -z "${SSH_CONNECTION:-}${SSH_CLIENT:-}${SSH_TTY:-}" ]] || return 0
  [[ -n "${GHOSTTY_RESOURCES_DIR:-}${GHOSTTY_BIN_DIR:-}" || "${TERM_PROGRAM:-}" == "ghostty" ]] || return 0
  command -v herdr >/dev/null 2>&1 || return 0

  if [[ -n "${DOT_HERDR_STARTED:-}" ]]; then
    return 0
  fi

  DOT_HERDR_STARTED=1 exec herdr || print -u2 -- "dot: herdr failed; continuing in plain zsh"
}

# ------------------------------
# Key bindings for word navigation
# ------------------------------
# Ctrl+Left/Right for word navigation
bindkey "^[[1;5D" backward-word
bindkey "^[[1;5C" forward-word

# Alt+Left/Right for word navigation (alternative)
bindkey "^[[1;3D" backward-word
bindkey "^[[1;3C" forward-word

# Standard editing keys (previously provided by oh-my-zsh's key-bindings.zsh,
# lost when omz was removed). Bind the literal xterm/ghostty sequences plus
# terminfo fallbacks so Delete/Home/End/Insert work.
bindkey "^[[3~" delete-char        # Delete
bindkey "^[[2~" overwrite-mode     # Insert
bindkey "^[[H"  beginning-of-line  # Home
bindkey "^[[F"  end-of-line        # End
bindkey "^[[1~" beginning-of-line  # Home (vt variant)
bindkey "^[[4~" end-of-line        # End (vt variant)
[[ -n "${terminfo[kdch1]}" ]] && bindkey "${terminfo[kdch1]}" delete-char
[[ -n "${terminfo[khome]}" ]] && bindkey "${terminfo[khome]}" beginning-of-line
[[ -n "${terminfo[kend]}"  ]] && bindkey "${terminfo[kend]}"  end-of-line
[[ -n "${terminfo[kich1]}" ]] && bindkey "${terminfo[kich1]}" overwrite-mode

_dot_maybe_start_herdr
unfunction _dot_maybe_start_herdr

# ------------------------------
# Commands
# ------------------------------
# Fastfetch
# ff
