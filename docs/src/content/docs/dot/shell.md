---
title: Shell Setup
description: Zsh completions, editing keys, aliases, and small shell helpers.
sidebar:
  order: 4
---

## Zsh completions

The `zsh/` package adds `${XDG_DATA_HOME:-~/.local/share}/zsh/site-functions` to `fpath` before `zsh-autocomplete` runs `compinit`.

Generated completions live in two places:

- `dot completions zsh` writes the stowed `_dot` completion in this repo.
- `_context` is the stowed completion for the standalone context CLI, generated from `context completions zsh`.
- `mise completion zsh` is generated at shell startup into the live, non-stowed `_mise` path and refreshed when the `mise` binary is newer than the cached completion.

The live `_mise` file is intentionally not version-controlled; it tracks the installed `mise` binary on each machine.

## Editing keys

The zsh config restores the standard editing bindings used by this setup after plugins load, including Delete as forward-delete. `dot doctor` checks the Delete binding and reports drift when a plugin or local override changes it.

## Small helpers

The shell keeps a few typo and navigation helpers close to the aliases. For example, `cwd` prints a short reminder that the real command is `pwd`, then runs `pwd` so the mistake still returns useful output.
