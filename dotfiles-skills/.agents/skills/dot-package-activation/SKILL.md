---
name: dot-package-activation
description: >
  Activate a change to a repository that produces an Arch package used on this
  machine, only through the published package. Use before installing, running
  or reporting such a change as live, or when another repository needs the new
  binary to finish verification.
metadata:
  author: timmo001
---

# Package Activation

Development builds are for validation only. Never activate a change with `go install`, a binary copied onto `PATH`, or a local `pacman -U`/`yay -U` artifact.

## When A Consumer Needs The New Binary

Only when a consuming repository needs the newly packaged binary to finish verification: validate both changesets, then offer exactly two paths, commit and push, or stop for review. Otherwise stop uncommitted as usual.

## After Commit And Push

1. Push the package source first.
2. Wait for publication: the repository's workflow into the signed `timmo` repo, or `/timmo001-private/publish-package [package]` for private packages.
3. Upgrade through pacman, then finish the consumer side.
4. Don't report the change as active until pacman owns the running binary: `pacman -Qo "$(command -v <binary>)"` and `pacman -Q <package>`.

If a repository becomes public with maintained public or AUR publish workflows, prefer those over the private package repo unless the user wants both.
