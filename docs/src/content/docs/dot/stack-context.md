---
title: Stack Context
description: Deterministic tech-stack detection for the current directory, for agent context.
sidebar:
  order: 3
---

## `dot stack-context`

Detect a Git worktree's tech stack deterministically from its tracked and unignored files, with no LLM. It reports the languages present (with their general locations), the package ecosystems declared by manifests, development tooling, and the frameworks pulled in as dependencies. It is designed as a single command for agents to learn a project's stack, and as the shared producer for the OpenCode stack-context plugin (via `--json`).

It scans the directory you pass, or the current working directory when you pass none. The directory must be inside a Git worktree; outside Git, the command returns an empty snapshot with a warning instead of scanning arbitrary directories.

```bash
dot stack-context                  # stack summary for the current directory
dot stack-context --plain          # stack summary without ANSI styling
dot stack-context --json           # structured stack-context payload (plugin format)
dot stack-context ~/projects/app   # scan a specific directory
```

## How detection works

Detection asks Git for the file set using `git ls-files --cached --others --exclude-standard`, then reads only manifests and config files and takes an extension and filename census. That means tracked files and untracked files not ignored by Git are included, while `.gitignore`, `.git/info/exclude`, and global excludes are respected. It never reads source file bodies or resolves a dependency closure, so it stays fast. A [Phase 0 benchmark](/dot/stack-context/#why-native-detection) chose this native approach over a compiled `syft` + `tokei` composition, which was 100 to 2000 times slower and added external binaries.

Git supplies the candidate files, and the scan is still bounded by a depth cap and a file cap. When the file cap is hit the result is marked truncated and a warning is added.

Signals carry a confidence tier so agents can weight them:

- **Languages** are `heuristic`: attributed by file extension or filename, aggregated by file count with their top general locations (the leading directories they live in).
- **Ecosystems** are `authoritative`: taken from manifest and lockfile presence (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, and others), plus GitHub Actions workflows.
- **Tooling** is `authoritative`: taken from lockfiles, known config files, `package.json`'s `packageManager` field, and declared dependency names. It currently covers package managers, linters, formatters, task runners, build tools and bundlers, test runners, git hook tools, and release tools.
- **Frameworks** are `authoritative` for npm (parsed from `package.json` dependency keys against a curated allowlist) and `strong` for Go, Cargo, and Python (matched by scanning the manifest for the package token). Keying on real package names avoids false positives, and reading declared dependencies catches a project's own framework even when a dependency scanner would miss it. Vite, Vitest, and Jest are treated as tooling rather than frameworks.

## Output

Plain text is the default. In an interactive terminal, headings and labels are styled; pipes, redirects, `NO_COLOR`, and `--plain` keep output unstyled. The summary has four counted sections, with tooling grouped by category:

```text
Stack: app (/home/user/projects/app)
412 files scanned

Languages (3):
  TypeScript  318 files (77%)  · src, packages
  CSS  20 files (5%)  · src/styles
  ...

Ecosystems (2):
  npm: package.json, packages/core/package.json
  github-actions: .github/workflows/ci.yml

Tooling (5):
  package manager:
    Bun  package manager  · lockfile: bun.lock
  build tool:
    Vite  build tool  · npm dep: vite
  test runner:
    Vitest  test runner  · npm dep: vitest
  git hook:
    Lefthook  git hook  · config: lefthook.yml
  release tool:
    Changesets  release tool  · npm dep: @changesets/cli

Frameworks (2):
  Astro  npm dep: astro
  Effect  npm dep: effect
```

`--json` emits the structured stack-context payload consumed by the OpenCode stack-context plugin instead of text: `root`, `name`, `scannedFiles`, `truncated`, and the `languages`, `ecosystems`, `tooling`, and `frameworks` arrays (each list length-capped to bound the prompt), plus any `warnings`.

## OpenCode stack-context plugin

The `stack-context` plugin runs `dot stack-context --json` against the repository root and injects a `<stack-context>` XML block, so an agent starts with reliable, non-hallucinated stack context instead of guessing or re-scanning the tree. It injects in two ways:

- **On command** (`command.execute.before`): for `/inject-stack`, the dedicated command, and for `/inject-context`, alongside the [branch-context plugin](/git/context/#opencode-branch-context-plugin), so one command injects branch and stack context together.
- **Automatically** (`chat.message`): on the first message of a session, when the working directory is a git repository, so a session starts with the project's stack in its initial context without a slash command. There is no session-start hook, so the plugin injects on the first user message and tracks the session id to fire at most once per session. It is skipped outside a git repository and when nothing is detected.

Both paths resolve the Git repository root first and skip injection outside a Git worktree.

The block carries `<context-metadata>`, `<languages>`, `<ecosystems>`, `<tooling>`, `<frameworks>`, and an optional `<warnings>` section, each with a short description line.

### Troubleshooting automatic injection

If the first message in a new OpenCode session shows **Failed to send prompt** with **Unexpected server error**, check `~/.local/share/opencode/log/opencode.log` for `invalid user part before save` or a `ref=err_*` line. On OpenCode 1.17+, the `chat.message` hook runs after user parts are resolved, so injected parts must include `id`, `sessionID`, and `messageID` (not just `{ type, text }`). The plugin sets these; slash-command injection via `command.execute.before` is unaffected. Restart OpenCode after updating the plugin so the fix loads.

## MCP

The same producer is exposed through the [`dot mcp`](/dot/mcp/) server as the read-only `stack_context` tool (optional `dir` parameter) and the `dot://stack-context` resource, so a harness can pull the summary on demand without a slash command.

## Agent guidance

1. Prefer `dot stack-context` (or the MCP `stack_context` tool) over guessing the stack or re-scanning the tree by hand.
2. When OpenCode injects `<stack-context>`, treat it as the primary source for the project's languages, ecosystems, tooling, and frameworks.
3. Weight the signals by their confidence: ecosystems, tooling, and npm frameworks are authoritative; language attribution is heuristic.

## Why native detection

A throwaway Phase 0 benchmark compared native TypeScript detection against a `syft` + `tokei` composition over seven real repositories. Native produced the same compact summary 100 to 2000 times faster (sub-25ms versus 1.3 to 3.0 seconds) with no external dependency. The compiled tools were more thorough on language breadth and transitive dependencies, so `syft` remains the right choice for a future opt-in, on-demand detail tier, but native detection owns the compact producer that runs per command and per session.
