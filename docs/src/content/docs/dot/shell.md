---
title: Shell Setup
description: Shell completions, editing keys, aliases, and small shell helpers.
sidebar:
  order: 4
---

## Shell completions

The `zsh/` package adds `${XDG_DATA_HOME:-~/.local/share}/zsh/site-functions` to `fpath` before `zsh-autocomplete` runs `compinit`.

Generated completions are stowed for the two local CLIs:

- `dot completions bash|fish|zsh` writes the stowed `dot` completions in this repo.
- `context completions bash|fish|zsh` writes the stowed `context` completions in this repo.
- `_omarchy` is a stowed zsh completion wrapper for dynamic Omarchy subcommands.

Installed package completions are also wired into common aliases where needed. `handoffs` completes through `_notes` and runs `notes handoffs`.

Zsh also has a live generated completion:

- `mise completion zsh` is generated at shell startup into the live, non-stowed `_mise` path and refreshed when the `mise` binary is newer than the cached completion.

The live `_mise` file is intentionally not version-controlled; it tracks the installed `mise` binary on each machine.

`watchexec` is managed through mise, so `mise watch <task>` can rerun short feedback tasks such as tests and type checks when files change. Keep persistent development servers under the project's documented server workflow or Pitchfork instead.

## Editing keys

fzf's native zsh integration provides fuzzy history search with `Ctrl+R`, file and directory insertion with `Ctrl+T`, directory changes with `Alt+C`, and fuzzy tab completion.

The zsh config restores the standard editing bindings used by this setup after plugins load, including Delete as forward-delete. `dot doctor` checks the Delete binding and reports drift when a plugin or local override changes it.

## Small helpers

The shell initialises zoxide as `zd`, which also backs Omarchy's `cd` alias. Directory changes teach zoxide which paths are used most often, while `zd <query>` jumps directly to a ranked match.

Omarchy's `ff` alias opens an fzf file picker with previews. `fast` runs Fastfetch without replacing that picker. `cat` and `b` use bat's normal highlighted output, while `bp` uses plain output.

The shell keeps a few typo and navigation helpers close to the aliases. For example, `cwd` prints a short reminder that the real command is `pwd`, then runs `pwd` so the mistake still returns useful output.

Run `update` to select maintenance steps with Gum. Dotfiles and Omarchy remain separate choices, while each enabled Topgrade step can be selected independently. Selected work runs in the displayed order: Dotfiles, Omarchy, then Topgrade. Mise, GitHub CLI extensions, and Yazi appear first within Topgrade and start selected; the remaining steps are opt-in:

| Step | Topgrade name |
| --- | --- |
| Mise | `mise` |
| GitHub CLI extensions | `github_cli_extensions` |
| Yazi | `yazi` |
| ProtonPlus | `protonplus` |
| Firmware | `firmware` |
| Rustup | `rustup` |
| TLDR | `tldr` |
| Neovim | `vim` |
| Containers | `containers` |
| Claude Code | `claude_code` |
| Claude Code plugins | `claude_code_plugins` |
| uv | `uv` |

Selected Topgrade steps run together through `topgrade --only`; selecting every Topgrade step uses the normal full `topgrade` command instead.

Use `update -y` or `update --yes`, or run it in a non-interactive shell, to select every step without prompting. Agent-driven runs without a controlling terminal route internal `sudo` calls through a temporary `pkexec` helper so authentication can use the desktop PolicyKit prompt. Interactive terminals keep normal `sudo` credential caching. The sequence stops if a selected step fails.
