---
title: Stack Context
description: Deterministic tech-stack detection for the current directory, for agent context.
---

## `dot stack-context`

Detect a directory's tech stack deterministically from its files, with no LLM and no external tools. It reports the languages present (with their general locations), the package ecosystems declared by manifests, and the frameworks pulled in as dependencies. It is designed as a single command for agents to learn a project's stack, and as the shared producer for the OpenCode stack-context plugin (via `--json`).

It scans the directory you pass, or the current working directory when you pass none. Unlike [`dot git-context`](/git/context/), it does not require a git repository.

```bash
dot stack-context                  # stack summary for the current directory
dot stack-context --json           # structured stack-context payload (plugin format)
dot stack-context ~/projects/app   # scan a specific directory
```

## How detection works

Detection is a single directory walk that reads only manifests and takes an extension and filename census. It never reads source file bodies, runs a subprocess, or resolves a dependency closure, so it stays fast (sub-25ms even on large repositories). A [Phase 0 benchmark](/dot/stack-context/#why-native-detection) chose this native approach over a compiled `syft` + `tokei` composition, which was 100 to 2000 times slower and added external binaries.

The walk skips heavy or vendored directories (`node_modules`, `dist`, `build`, `.git`, `target`, `.venv`, and similar) and is bounded by a depth cap and a file cap. When the file cap is hit the result is marked truncated and a warning is added.

Signals carry a confidence tier so agents can weight them:

- **Languages** are `heuristic`: attributed by file extension or filename, aggregated by file count with their top general locations (the leading directories they live in).
- **Ecosystems** are `authoritative`: taken from manifest and lockfile presence (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, and others), plus GitHub Actions workflows.
- **Frameworks** are `authoritative` for npm (parsed from `package.json` dependency keys against a curated allowlist) and `strong` for Go, Cargo, and Python (matched by scanning the manifest for the package token). Keying on real package names avoids false positives, and reading declared dependencies catches a project's own framework even when a dependency scanner would miss it.

## Output

Plain text is the default. The summary has three sections:

```text
Stack: app (/home/user/projects/app)
412 files scanned

Languages:
  TypeScript  318 files  · src, packages
  CSS  20 files  · src/styles
  ...

Ecosystems:
  npm: package.json, packages/core/package.json
  github-actions: .github/workflows/ci.yml

Frameworks:
  Astro  (npm dep: astro)
  Effect  (npm dep: effect)
```

`--json` emits the structured stack-context payload consumed by the OpenCode stack-context plugin instead of text: `root`, `name`, `scannedFiles`, `truncated`, and the `languages`, `ecosystems`, and `frameworks` arrays (each list length-capped to bound the prompt), plus any `warnings`.

## OpenCode stack-context plugin

The `stack-context` plugin runs `dot stack-context --json` and injects a `<stack-context>` XML block into the command prompt before execution, so an agent starts with reliable, non-hallucinated stack context instead of guessing or re-scanning the tree. It fires on:

- `/inject-stack`, the dedicated command; and
- `/inject-context`, alongside the [branch-context plugin](/git/context/#opencode-branch-context-plugin), so one command injects branch and stack context together.

The block carries `<context-metadata>`, `<languages>`, `<ecosystems>`, `<frameworks>`, and an optional `<warnings>` section, each with a short description line.

## MCP

The same producer is exposed through the [`dot mcp`](/dot/mcp/) server as the read-only `stack_context` tool (optional `dir` parameter) and the `dot://stack-context` resource, so a harness can pull the summary on demand without a slash command.

## Agent guidance

1. Prefer `dot stack-context` (or the MCP `stack_context` tool) over guessing the stack or re-scanning the tree by hand.
2. When OpenCode injects `<stack-context>`, treat it as the primary source for the project's languages, ecosystems, and frameworks.
3. Weight the signals by their confidence: ecosystems and npm frameworks are authoritative; language attribution is heuristic.

## Why native detection

A throwaway Phase 0 benchmark compared native TypeScript detection against a `syft` + `tokei` composition over seven real repositories. Native produced the same compact summary 100 to 2000 times faster (sub-25ms versus 1.3 to 3.0 seconds) with no external dependency. The compiled tools were more thorough on language breadth and transitive dependencies, so `syft` remains the right choice for a future opt-in, on-demand detail tier, but native detection owns the compact producer that runs per command and per session.
