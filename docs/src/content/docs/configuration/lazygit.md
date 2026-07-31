---
title: Lazygit
description: Run shared repository maintenance commands from Lazygit.
sidebar:
  order: 7
---

The Lazygit configuration is stowed from `lazygit/.config/lazygit/config.yml`.

Press `Ctrl+B` in the Local Branches panel to run `gh poi`, which cleans up local branches whose pull requests have been merged. Lazygit suspends its interface while the command runs in the terminal, then restores it when the command exits.

Press `Ctrl+F` in the Local Branches panel to run `git-rebase-default`. The command resolves and fetches the default branch from `upstream`, falling back to `origin`, then rebases the checked-out branch onto it with `--autostash`. If local `<remote>/HEAD` is missing or disagrees with the advertised default, the shared resolver asks before repairing it and fails without prompting under an agent. Run the same command from a shell with the `grd` alias.
