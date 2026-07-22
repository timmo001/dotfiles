---
title: Environment Variables
description: All DOT_*, DOTFILES_*, and OMARCHY_* options that influence dot.
sidebar:
  order: 2
---

These variables tune paths and behaviour for `dot`. Most have sensible defaults; set them only when you need to override the default.

## Managed toolchain

The global mise configuration provides the Android SDK command-line tools and sets the SDK environment for Gradle and `sdkmanager`. Individual Android repositories still declare their required platform and build-tools versions; install those SDK packages with `sdkmanager` when a checkout requires them.

## Paths and overlay

| Variable               | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `DOTFILES_PUBLIC_DIR`  | Public dotfiles path (default `~/.config/dotfiles`).          |
| `DOTFILES_PRIVATE_DIR` | Private dotfiles path (default `~/.config/dotfiles-private`). |
| `DOT_ALLOW_PRIVATE`    | Private overlay policy: optional `auto`, required `always`, or skipped `never` (default `auto`). A failed attempted clone is fatal in `auto` mode. |

## Git and GitHub

| Variable                                 | Description                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOT_GIT_CONFIG_FILE`                    | Private git repo config for `git-diff`, `git-log`, `git-workflows`, `git-notifications --bar-json`, `update`, and `doctor` (default `$DOTFILES_PRIVATE_DIR/dot-git.yml`). |
| `DOT_GITHUB_RETRIES`                     | Extra `gh` retry attempts after the first try (default `2`).                                                                                                              |
| `DOT_GITHUB_RATE_LIMIT_TTL_SECONDS`      | Seconds to cache `gh api rate_limit` results (default `60`).                                                                                                              |
| `DOT_GITHUB_RATE_LIMIT_MIN_REMAINING`    | Minimum REST quota remaining before `gh` calls wait (default `0`).                                                                                                        |
| `DOT_GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS` | Upper bound on rate-limit backoff waits (default `60`).                                                                                                                   |
| `DOT_INCLUDE_OMARCHY_DIFF_REPOS`         | Include Omarchy repos in `dot git-diff` (`1\|0`, default `1`).                                                                                                            |
| `DOT_FETCH_TTL_SECONDS`                  | Seconds to reuse the last upstream fetch (default `300`).                                                                                                                 |
| `DOT_GH_EXTENSIONS_FILE`                 | Public `gh` extension list installed by `dot init` (default `$DOTFILES_PUBLIC_DIR/.dot-gh-extensions`).                                                                   |
| `DOT_GH_MCP_BEARER`                      | Bearer token for the read-only GitHub MCP server. The shell wrappers and `opencode-server` set it only for agent harness processes; it is not exported globally.        |

## Private packages

| Variable                          | Description                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DOT_PUBLIC_PACKAGES_FILE`        | Public Arch/AUR package list for `dot init`, full `dot update`, and package checks (default `$DOTFILES_PUBLIC_DIR/.dot-public-packages`). |
| `DOT_PRIVATE_PACKAGE_REPO_FILE`   | Private pacman repo config (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-repo`).                                      |
| `DOT_PRIVATE_PACKAGES_FILE`       | Private package list (default `$DOTFILES_PRIVATE_DIR/.dot-private-packages`).                                                |
| `DOT_PRIVATE_PACKAGE_MAP_FILE`    | Private package name-to-source map for `dot private-pkg-publish` (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-map`). |
| `DOT_PRIVATE_PACMAN_REPO_CONFIG`  | Pacman repo snippet path written by `dot` (default `/etc/pacman.d/timmo-private.conf`).                                      |
| `DOT_PRIVATE_PACMAN_MAIN_CONFIG`  | Main pacman config file scanned for the private repo `Include` (default `/etc/pacman.conf`).                                 |
| `DOT_PRIVATE_BROWSER_CHECKS_FILE` | Private browser-extension doctor checks (default `$DOTFILES_PRIVATE_DIR/.dot-browser-checks`).                               |

## Omarchy and Hyprland

| Variable                | Description                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `OMARCHY_REPO_BASE_DIR` | Omarchy repo base path (default `~/.config`).                                                          |
| `OMARCHY_HOST`          | Hypr host override name; `dot init` defaults to `desktop` when unset unless `--host <name>` is passed. |
| `DOT_OMARCHY_BRANCH`    | Branch override for non-bootstrap Omarchy repos during sync.                                           |
| `DOT_BOOTSTRAP_BRANCH`  | Branch for `bootstrap` sync (default `distro/omarchy`).                                                |

## Init and logging

| Variable                  | Description                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOT_INIT_NONINTERACTIVE` | Force non-interactive init mode (`1\|0`, default `0`).                                                                                            |
| `DOT_INIT_LOG_FILE`       | Default `dot init` log path when `--log` is not passed (default `~/.local/state/dot/init.log`).                                                   |
| `DOT_LOG_FILE`            | Active log file for the current `dot` run. Set automatically during `dot init`; child commands inherit it when `DOT_TEE_INHERIT_LOG=1`.           |
| `DOT_LOG_MIRROR_FILE`     | Secondary log destination mirrored after each write. Set automatically when `dot init --log` targets a GVFS path that cannot be written directly. |
| `DOT_TEE_INHERIT_LOG`     | When `1`, child processes launched by `dot` append stdout/stderr to `DOT_LOG_FILE` (set automatically during `dot init`).                         |
| `DOT_UFW_RULES_FILE`      | ufw rules file scanned by the firewall setup and doctor check (default `/etc/ufw/user.rules`).                                                    |

## Agents sync

`dot agents-sync` mirrors `~/.config/opencode/AGENTS.md` to agent harness instruction files. It runs automatically at the end of full `dot update` and `dot init`; phase-scoped updates skip it. There is no environment toggle to disable it.

Each target receives a transformed copy with harness-appropriate formatting where needed. All targets include a `dot agents-sync` HTML comment with source path and timestamp. OpenCode remains the single source of truth; other agent harnesses get plain file copies, not symlinks.

| Variable                    | Description                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `DOT_AGENTS_SYNC_SOURCE`    | AGENTS file to mirror (default `~/.config/opencode/AGENTS.md`).                               |
| `DOT_AGENTS_SYNC_RULE_FILE` | Override path for a primary agents-sync target (default `~/.cursor/rules/global-agents.mdc`). |

## MCP sync

| Variable              | Description                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| `DOT_MCP_CONFIG_FILE` | Private MCP sync spec read by `dot mcp-sync` (default `$DOTFILES_PRIVATE_DIR/mcp.yml`). |

## Debugging and output

| Variable                  | Description                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `DOT_DEBUG`               | Enable stderr debug logging from `dot` subsystems (`1` or any non-empty value).               |
| `DOT_USAGE_DIR`           | Usage event root (default `$XDG_STATE_HOME/tool-usage`).                                       |
| `DOT_USAGE_DISABLE`       | Disable automatic live `dot` usage recording when set to `1`; explicit backfill still writes. |
| `DOT_CONTEXT_CAPTURE`     | Capture assembled OpenCode starter context when set to `1`.                                   |
| `DOT_CONTEXT_CAPTURE_DIR` | Parent for private `context-baseline-*` capture directories (default `/tmp/opencode`).         |
| `NO_COLOR`                | Disable ANSI colour in TTY-aware output such as `context git` (any non-empty value).           |

Context capture writes numbered system-prompt segments, `system-index.json`, per-tool schemas, and `tools.jsonl` into a unique private child directory. It measures assembled context without changing prompts or tool definitions.

## Agent detection

| Variable    | Description                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOT_AGENT` | Override AI agent detection used by `dot is-agent` and the interactive-TUI guard: `1` forces agent mode, `0` forces it off, unset auto-detects. |

## Notes

| Variable        | Description                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `NOTES`         | Notes vault git repo used by the standalone `notes` CLI/MCP server and OpenCode note commands (preferred; default `~/Documents/notes`). |
| `DOT_NOTES_DIR` | Compatibility notes vault override used when `NOTES` is unset.                                                |
