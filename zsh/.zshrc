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
# (compinit runs before the plugins below)
# ------------------------------
if [[ -d "${XDG_DATA_HOME:-$HOME/.local/share}/zsh/site-functions" ]]; then
  fpath=("${XDG_DATA_HOME:-$HOME/.local/share}/zsh/site-functions" $fpath)
fi

# ------------------------------
# mise completions
# Generated at runtime into a live (non-stowed) path; regenerates when the
# mise binary is upgraded. Runs before compinit so _mise
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
# Zsh plugins
# autosuggestions and syntax highlighting come from apt (see
# .dot-public-packages); fzf-tab is optional, from a mise http: install
# fzf-tab needs compinit first and must load before the widget-wrapping plugins.
# ------------------------------
autoload -Uz compinit && compinit
zstyle ':completion:*' menu no
zstyle ':completion:*:descriptions' format '[%d]'

_fzf_tab_plugin="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}/installs/http-fzf-tab/latest/fzf-tab.plugin.zsh"
[[ -r "$_fzf_tab_plugin" ]] && source "$_fzf_tab_plugin"
unset _fzf_tab_plugin

[[ -r /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]] && \
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
[[ -r /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]] && \
  source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

autoload -Uz _dot 2>/dev/null
compdef _dot dot 2>/dev/null

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
export VISUAL=nvim
export REACT_EDITOR=nvim

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
# Bun
# ------------------------------
export PATH="$HOME/.cache/.bun/bin:$PATH"

[ -f "$HOME/.local/bin/env" ] && . "$HOME/.local/bin/env"

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
  echo "# Manually installed apt packages" >"$outfile"
  apt-mark showmanual | sort -u | tr '\n' ' ' >>"$outfile"
  echo -e "\n" >>"$outfile"
  echo "Saved manually installed apt packages to $outfile"
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

alias cat="bat"
alias b="bat"
alias bp="bat --plain"
alias la="tree"
alias cbd="command-breakdown"

y() {
  local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
  command yazi "$@" --cwd-file="$tmp"
  IFS= read -r -d '' cwd < "$tmp"
  [ "$cwd" != "$PWD" ] && [ -d "$cwd" ] && builtin cd -- "$cwd"
  command rm -f -- "$tmp"
}

alias e="y"

alias fast="fastfetch"

## Git
alias lg="lazygit"

alias gc="git commit -m"
alias gca="git commit -a -m"
alias gp="git push origin HEAD"
alias gpf="git push --force-with-lease --force-if-includes origin HEAD"
# Pull like the Git panel; dot offers git pull origin if the pull fails.
function gpu {
  local repo
  if (( $# == 0 )) && (( $+commands[dot] )) && repo=$(git rev-parse --show-toplevel 2>/dev/null); then
    dot update --repo "$repo"
  else
    git pull origin "$@"
  fi
}
alias gst="git status"
alias glog="git log --graph --topo-order --pretty='%w(100,0,6)%C(yellow)%h%C(bold)%C(black)%d %C(cyan)%ar %C(green)%an%n%C(bold)%C(white)%s %N' --abbrev-commit"
alias gdiff="git diff"
alias gdd='git-diff-default'
alias gld='git-log-default'
alias gco="git checkout"
alias gb='git branch'
alias gba='git branch -a'
alias gadd='git add'
alias gap='git add -p'
alias gcoall='git checkout -- .'
alias gr='git remote'
alias gre='git reset'
alias gsd='git-switch-default'
alias gsdp='gsd && printf "\n\033[1;36mClean up merged branches\033[0m\n" && gh poi'
alias grd='git-rebase-default'
alias gra='echo "Aborting rebase..."; git rebase --abort'

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

# Notes
alias handoffs="notes handoffs"

# Copilot CLI
alias copilot="gh copilot"
alias cpe="gh copilot explain"
alias cps="gh copilot suggest"

# Create a new release PR (Custom script in internal repo)
alias ghrpr="./.github/create-release-pr-draft.sh"

# Go
alias gor="go run ."
alias gob="go build ."
alias goi="go install ."

# Quick paths
alias home="cd ~"
alias config="cd ~/.config"
alias repos="cd ~/repos"

_repo_workspace() {
  local label="$1"
  local directory="$2"
  local tab_label="${3:-Shell}"
  shift 3

  local workspace_id created tab_id pane_id command

  if ! herdr status server >/dev/null 2>&1; then
    echo "Shared Herdr server is not running" >&2
    return 1
  fi

  workspace_id="$(herdr workspace list | jq -r --arg label "$label" '
    (.result.workspaces // .workspaces // [])
    | map(select(.label == $label))
    | first
    | .workspace_id // empty
  ')"

  if [ "$#" -gt 0 ] && [ -n "$workspace_id" ] && [ "$workspace_id" = "${HERDR_WORKSPACE_ID:-}" ]; then
    cd "$directory" && "$@"
    return
  fi

  if [ -z "$workspace_id" ]; then
    created="$(herdr workspace create --cwd "$directory" --label "$label" --no-focus)" || return
    workspace_id="$(jq -r '.result.workspace.workspace_id // .workspace.workspace_id // empty' <<<"$created")"
    tab_id="$(jq -r '.result.tab.tab_id // .tab.tab_id // empty' <<<"$created")"
    pane_id="$(jq -r '.result.root_pane.pane_id // .root_pane.pane_id // empty' <<<"$created")"
  elif [ "$#" -gt 0 ]; then
    created="$(herdr tab create --workspace "$workspace_id" --cwd "$directory" --label "$tab_label" --no-focus)" || return
    tab_id="$(jq -r '.result.tab.tab_id // .tab.tab_id // empty' <<<"$created")"
    pane_id="$(jq -r '.result.root_pane.pane_id // .root_pane.pane_id // empty' <<<"$created")"
  fi

  if [ "$#" -gt 0 ]; then
    if [ -z "$tab_id" ] || [ -z "$pane_id" ]; then
      echo "Herdr did not return tab and pane IDs for $label" >&2
      return 1
    fi

    herdr tab rename "$tab_id" "$tab_label" >/dev/null || return
    command="${(j: :)${(q+)@}}"
    herdr pane run "$pane_id" "$command" >/dev/null || return
  elif [ -z "$workspace_id" ]; then
    echo "Herdr did not return a workspace ID for $label" >&2
    return 1
  fi

  herdr workspace focus "$workspace_id" >/dev/null
}

_repo_open() {
  if [ "${HERDR_ENV:-}" != 1 ]; then
    cd "$2"
    return
  fi

  local workspace_id
  workspace_id="$(herdr workspace list | jq -r --arg label "$1" '
    (.result.workspaces // .workspaces // [])
    | map(select(.label == $label))
    | first
    | .workspace_id // empty
  ')" || return

  if [ -n "$workspace_id" ] && [ "$workspace_id" = "${HERDR_WORKSPACE_ID:-}" ]; then
    cd "$2"
    return
  fi

  dot herdr repo open "$1" "$2"
}

[[ -r "$HOME/.cache/dot/repo-shortcuts.zsh" ]] && source "$HOME/.cache/dot/repo-shortcuts.zsh"

# Find and edit
alias fe="find-and-edit"
alias fev="find-and-edit --visual"

alias update="dot up"

# Docker compose helpers. The compose-* scripts come from the nas-containers repository.
alias cu="compose-up"
alias cr="compose-restart"
alias cl="compose-logs"
alias cps="compose-ps"

# Home Assistant dev servers: shortcuts for dot homeassistant (dot ha), which
# reads its repositories, daemons and URLs from ~/.config/dot/homeassistant.yml.
# Each prints the dot command it runs first.
function _dot_ha() {
  print -r -- $'\e[2m'"\$ dot ha ${(j: :)${(q-)@}}"$'\e[0m'
  dot ha "$@"
}

function hacdev() { _dot_ha core dev "$@" }
function hacdevbg() { _dot_ha core dev --background "$@" }
function hacdevlatest() { _dot_ha core dev --latest "$@" }
function hacdevlatestbg() { _dot_ha core dev --latest --background "$@" }
function hacdevstatus() { _dot_ha status core }
function hacdevstop() { _dot_ha stop core }
function hacdevlogs() { _dot_ha logs core --follow }

function hafdev() { _dot_ha frontend dev "$@" }
function hafdevbg() { _dot_ha frontend dev --background "$@" }
function hafdevstatus() { _dot_ha status build }
function hafdevstop() { _dot_ha stop build }
function hafdevlogs() { _dot_ha logs build --follow }

function hafdevserve() { _dot_ha frontend serve "$@" }
function hafdevservestatus() { _dot_ha status serve }
function hafdevservestop() { _dot_ha stop serve }
function hafdevservelogs() { _dot_ha logs serve --follow }
function hafdevserveprod() { _dot_ha frontend serve prod "$@" }
function hafdevserveprodbg() { _dot_ha frontend serve prod --background "$@" }
function hafdevserveprodnc() { _dot_ha frontend serve link "$@" }
function hafdevserveprodncbg() { _dot_ha frontend serve link --background "$@" }

function hafdevdesign() { _dot_ha frontend gallery "$@" }
function hafdevdesignbg() { _dot_ha frontend gallery --background "$@" }
function hafdevdesignstatus() { _dot_ha status gallery }
function hafdevdesignstop() { _dot_ha stop gallery }
function hafdevdesignlogs() { _dot_ha logs gallery --follow }

function hafdevdemo() { _dot_ha frontend demo "$@" }
function hafdevdemobg() { _dot_ha frontend demo --background "$@" }
function hafdevdemostatus() { _dot_ha status demo }
function hafdevdemostop() { _dot_ha stop demo }
function hafdevdemologs() { _dot_ha logs demo --follow }

function hafdeve2eapp() { _dot_ha frontend e2e "$@" }
function hafdeve2eappbg() { _dot_ha frontend e2e --background "$@" }
function hafdeve2eappstatus() { _dot_ha status e2e }
function hafdeve2eappstop() { _dot_ha stop e2e }
function hafdeve2eapplogs() { _dot_ha logs e2e --follow }

function hafdevsuitesstatus() { _dot_ha status gallery demo e2e }
function hafdevsuitesstop() { _dot_ha stop gallery demo e2e }

function hafbuild() { _dot_ha frontend build }

function hadev() { _dot_ha dev "$@" }
function hadevbg() { _dot_ha dev --background "$@" }
function hadevstatus() { _dot_ha status }
function hadevstop() { _dot_ha stop }

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
# Omarchy shell helpers
# The desktop sources these from Omarchy's bash aliases and envs. Omarchy is
# not installed here, so the ones wanted on the server live here instead.
# ------------------------------
if command -v eza &> /dev/null; then
  alias ls='eza -lh --group-directories-first --icons=auto'
  alias lsa='ls -a'
  alias lt='eza --tree --level=2 --long --icons --git'
  alias lta='lt -a'
fi

alias ff="fzf --preview 'bat --style=numbers --color=always {}'"
alias eff='$EDITOR "$(ff)"'

# zoxide below defines zd
command -v zoxide &> /dev/null && alias cd="zd"

alias d='docker'
alias h='herdr'
alias g='git'
alias gcm='git commit -m'
alias gcam='git commit -a -m'
alias gcad='git commit -a --amend'
alias mup='MISE_MINIMUM_RELEASE_AGE=0 mise up'
n() { if [ "$#" -eq 0 ]; then command nvim . ; else command nvim "$@"; fi; }

# From Omarchy's default/bash/fns, minus the ones that need a desktop, tmux,
# hunk or inotify.
compress() { tar -czf "${1%/}.tar.gz" "${1%/}"; }
alias decompress="tar -xzf"

sff() { if [ $# -eq 0 ]; then echo "Usage: sff <destination> (e.g. sff host:/tmp/)"; return 1; fi; local file; file=$(find . -type f -printf '%T@\t%p\n' | sort -rn | cut -f2- | ff) && [ -n "$file" ] && scp "$file" "$1"; }

# Create a worktree and branch next to the current checkout.
ga() {
  if [[ -z "$1" ]]; then
    echo "Usage: ga [branch name]"
    return 1
  fi

  local branch="$1"
  local base="$(basename "$PWD")"
  local wt_path="../${base}--${branch}"

  git worktree add -b "$branch" "$wt_path"
  mise trust "$wt_path"
  cd "$wt_path"
}

# Remove the current worktree and its branch.
gd() {
  if gum confirm "Remove worktree and branch?"; then
    local cwd base branch root worktree

    cwd="$(pwd)"
    worktree="$(basename "$cwd")"
    root="${worktree%%--*}"
    branch="${worktree#*--}"

    if [[ "$root" != "$worktree" ]]; then
      cd "../$root"
      git worktree remove "$cwd" --force || return 1
      git branch -D "$branch"
    fi
  fi
}

# Herdr dev layout: editor, AI pane on the right, terminal below.
# Usage: hdl <ai command> [<second ai command>]
_herdr_split() {
  herdr pane split "$1" --direction "$2" --ratio "$3" --cwd "$4" --no-focus |
    jq -r '.result.pane.pane_id'
}

hdl() {
  [[ -z $1 ]] && { echo "Usage: hdl <ai command> [<second ai command>]"; return 1; }
  [[ -z $HERDR_PANE_ID ]] && { echo "You must start herdr to use hdl."; return 1; }

  local current_dir="${PWD}"
  local editor_pane="$HERDR_PANE_ID" ai_pane ai2_pane
  local ai="$1"
  local ai2="${2:-}"

  herdr tab rename "$HERDR_TAB_ID" "$(basename "$current_dir")" >/dev/null
  _herdr_split "$editor_pane" down 0.85 "$current_dir" >/dev/null
  ai_pane=$(_herdr_split "$editor_pane" right 0.7 "$current_dir")

  if [[ -n $ai2 ]]; then
    ai2_pane=$(_herdr_split "$ai_pane" down 0.5 "$current_dir")
    herdr pane run "$ai2_pane" "$ai2" >/dev/null
  fi

  herdr pane run "$ai_pane" "$ai" >/dev/null
  herdr pane run "$editor_pane" "$EDITOR ." >/dev/null
}

# SSH port forwarding: fip starts, dip stops, lip lists.
fip() {
  (( $# < 2 )) && echo "Usage: fip <host> <port1> [port2] ..." && return 1
  local host="$1"
  shift
  for port in "$@"; do
    ssh -f -N -L "${port}:localhost:${port}" "$host" && echo "Forwarding localhost:$port -> $host:$port"
  done
}

dip() {
  (( $# == 0 )) && echo "Usage: dip <port1> [port2] ..." && return 1
  for port in "$@"; do
    pkill -f "ssh.*-L ${port}:localhost:${port}" && echo "Stopped forwarding port $port" || echo "No forwarding on port $port"
  done
}

lip() {
  pgrep -af "ssh.*-L [0-9]+:localhost:[0-9]+" || echo "No active forwards"
}

export BAT_THEME=ansi
export MANROFFOPT="-c"
export MANPAGER="sh -c 'col -bx | bat -l man -p'"

# ------------------------------
# Mise, zoxide and fzf
# ------------------------------
if command -v mise &> /dev/null; then
  eval "$(mise activate zsh)"
fi

if command -v zoxide &> /dev/null; then
  eval "$(zoxide init zsh --cmd zd)"
fi

# fzf's key bindings fail to restore the zle option without a terminal, as in OpenCode's ! shell
if command -v fzf &> /dev/null && [[ -t 0 ]]; then
  source <(fzf --zsh)
fi

# ------------------------------
# Dotfiles extras
# ------------------------------
timmo-update-extras() {
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
# MCP bearer credentials (agent harnesses)
# ------------------------------
# Scope tokens to agent harnesses instead of exposing them to every shell child.
# Resolve the real binary with whence -p; do not pass shell builtin `command` to
# env (env looks for an external executable named "command").
_dot_with_mcp_bearers() {
  local github_token system_bridge_token bin
  bin="$(whence -p "$1")" || return $?
  shift
  github_token="$(gh auth token 2>/dev/null)" || return $?
  system_bridge_token="$(system-bridge client token 2>/dev/null)" || return $?
  env \
    DOT_GH_MCP_BEARER="$github_token" \
    SYSTEM_BRIDGE_MCP_BEARER="$system_bridge_token" \
    "$bin" "$@"
}

opencode2() {
  "$HOME/.local/bin/opencode2" "$@"
}

alias c2="opencode2"
alias opencode="opencode2"
alias c="c2"
alias c2-cancel="opencode2-cancel"

unalias copilot 2>/dev/null
copilot() {
  _dot_with_mcp_bearers copilot "$@"
}

claude() {
  _dot_with_mcp_bearers claude "$@"
}

# ------------------------------
# Herdr managed session cleanup
# ------------------------------
_dot_herdr_close_clients_if_last_pane() {
  [[ -n "${HERDR_ENV:-}" ]] || return 0
  command -v herdr >/dev/null 2>&1 || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local shell_pid workspaces tabs panes
  shell_pid="$(herdr pane process-info --current 2>/dev/null | jq -r '.result.process_info.shell_pid // empty' 2>/dev/null)"
  [[ "$shell_pid" == "$$" ]] || return 0

  workspaces="$(herdr workspace list 2>/dev/null | jq -r '(.result.workspaces // .workspaces // []) | length' 2>/dev/null)"
  tabs="$(herdr tab list 2>/dev/null | jq -r '(.result.tabs // .tabs // []) | length' 2>/dev/null)"
  panes="$(herdr pane list 2>/dev/null | jq -r '(.result.panes // .panes // []) | length' 2>/dev/null)"

  [[ "$workspaces" == "1" && "$tabs" == "1" && "$panes" == "1" ]] || return 0

  # The server keeps running; the pane and tab close when this shell exits.
  # Leave a Dotfiles workspace for the next attach, then detach the attached
  # clients so their terminal windows close too.
  herdr workspace create \
    --cwd "${DOTFILES_PUBLIC_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/dotfiles}" \
    --label Dotfiles --focus >/dev/null 2>&1

  local proc pid exe
  local -a args
  for proc in /proc/<->(N); do
    pid="${proc:t}"
    [[ -O "$proc" ]] || continue
    exe="$(readlink -- "$proc/exe" 2>/dev/null)" || continue
    [[ "${exe:t}" == "herdr" ]] || continue
    args=(${(0)"$(<"$proc/cmdline")"})
    args=("${(@)args[2,-1]}")
    if (( ${#args} == 0 )) || [[ "${args[*]}" == "session attach default" ]]; then
      kill -TERM -- "$pid" 2>/dev/null
    fi
  done
}

add-zsh-hook -d zshexit _dot_herdr_stop_if_last_pane 2>/dev/null
add-zsh-hook -d zshexit _dot_herdr_close_clients_if_last_pane 2>/dev/null
add-zsh-hook zshexit _dot_herdr_close_clients_if_last_pane

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

# ------------------------------
# Commands
# ------------------------------
# Fastfetch
# ff
