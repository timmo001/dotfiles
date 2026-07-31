---
title: Lazygit
description: Run shared repository maintenance commands from Lazygit.
sidebar:
  order: 7
---

The Lazygit configuration is stowed from `lazygit/.config/lazygit/config.yml`.

Press `Ctrl+B` in the Local Branches panel to run `gh poi`, which cleans up local branches whose pull requests have been merged. Lazygit suspends its interface while the command runs in the terminal, then restores it when the command exits.
