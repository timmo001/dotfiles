# ------------------------------
# Basic path
# ------------------------------
export PATH=$HOME/bin:/usr/local/bin:$PATH

# ------------------------------
# Oh my zsh
# ------------------------------
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git zsh-autosuggestions zsh-syntax-highlighting fast-syntax-highlighting zsh-autocomplete)
source $ZSH/oh-my-zsh.sh

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
# Rust
# ------------------------------
source $HOME/.cargo/env

# ------------------------------
# Brew for Linux
# ------------------------------
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

# ------------------------------
# Aliases
# ------------------------------
alias cat=bat
alias ls="ls -la --color=always"
alias la="tree"

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

