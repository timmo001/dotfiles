# OpenCode Config

Shared [OpenCode](https://opencode.ai) skills, agents, plugins, and commands.

Published from [`timmo001/dotfiles`](https://github.com/timmo001/dotfiles) — source at [`agents/.config/opencode/`](https://github.com/timmo001/dotfiles/tree/main/agents/.config/opencode).

## Installation

Import individual skills using the `import-external-skill` workflow:

```
# origin: https://github.com/timmo001/opencode-config/tree/main/skills/<skill-name>
```

Or clone the full repo and copy what you need:

```bash
git clone https://github.com/timmo001/opencode-config.git
```

Agents, commands, and plugins can be copied directly into your OpenCode config directory (`~/.config/opencode/`).

## Skills

### Locally Authored

| Skill | Description |
|---|---|
| `ask-questions-if-underspecified` | Ask minimal clarifying questions only when ambiguity materially changes implementation |
| `check-skill-updates` | Check imported skills for upstream changes and apply updates. Use when reviewing whether externally imported skills have new upstream content, or when `dot skill-updates` reports available changes. |
| `cleanup-unnecessary-variables` | Safe unnecessary-variable cleanup guidance for code review and refactoring. |
| `diagnose` | Disciplined diagnosis workflow for hard bugs, regressions, flaky behavior, and performance issues. Use when behavior is broken, failing, intermittent, or slower than expected and the agent needs a reproducible feedback loop before fixing. |
| `dotfiles-stow` | REQUIRED when changing configs managed by ~/.config/dotfiles or ~/.config/dotfiles-private. Enforces editing stow source paths (not ad-hoc live paths) and using the dot command for stow/update/validation workflows. |
| `fallow` | Codebase intelligence for JavaScript and TypeScript. Free static layer finds unused code (files, exports, types, dependencies), code duplication, circular dependencies, complexity hotspots, architecture boundary violations, and feature flag patterns. Optional paid runtime layer (Fallow Runtime) merges production execution data into the same health report for hot-path review, cold-path deletion confidence, and stale-flag evidence. 90 framework plugins, zero configuration, sub-second static analysis. Use when asked to analyze code health, find unused code, detect duplicates, check circular dependencies, audit complexity, check architecture boundaries, detect feature flags, clean up the codebase, auto-fix issues, merge runtime coverage, or run fallow. |
| `git-workflow` | Patterns for working with git branches, remotes, and diffs against the default branch |
| `import-external-skill` | Import skills from external repos into the local dotfiles skill library. Use when pulling in a skill from a public repo, reviewing an external skill set for useful additions, or adapting external skill content into existing local skills. |
| `improve-codebase-architecture` | Review a codebase area for architectural friction and propose focused structural improvements. Use when the user wants to improve maintainability, reduce coupling, simplify understanding, or identify where code should be consolidated or deepened. |
| `pkexec-root` | Use pkexec first for commands that need root directly or indirectly. |
| `pr-review` | Guidelines for reviewing pull requests - what to analyze, review etiquette, and output formatting |
| `remove-single-use-functions` | Safe single-use function removal guidance for code review and refactoring. |
| `types-enforce-ts` | TypeScript type-safety guidance for editing and reviewing `.ts`, `.tsx`, `.mts`, and `.cts` files. |
| `write-a-skill` | Create new OpenCode skills with concise descriptions, clear triggers, and minimal supporting files. Use when adding or rewriting a local skill, command-adjacent skill, or reusable agent workflow. |

### Imported

These skills were imported from external sources and may include local adaptations.

| Skill | Origin |
|---|---|
| `css-motion-systems` | [stolinski/s-stack](https://github.com/stolinski/s-stack/tree/main/skills/css-motion-systems) |
| `html` | [stolinski/s-stack](https://github.com/stolinski/s-stack/tree/main/skills/html) |
| `motion-choreography-patterns` | [stolinski/s-stack](https://github.com/stolinski/s-stack/tree/main/skills/motion-choreography-patterns) |

## Agents

| Agent | Description |
|---|---|
| `ask` | Ask clarifying questions before taking action |
| `build-ask` | Build agent that executes clear tasks and relies on permissions for write actions |
| `build-locked` | Build agent that can edit files but cannot run shell commands |
| `general-readonly` | General-style parallel subagent that researches and runs commands but cannot modify workspace files via file tools (for delegation from read-only primaries). |
| `refactorer` | Refactor code while preserving behavior and following local command and skill workflows |
| `reviewer` | Reviews code for quality, bugs, security, and best practices |

## Commands

| Command | Description | Agent |
|---|---|---|
| `/check-skill-updates` | Check imported skills for upstream updates | default |
| `/cleanup-unnecessary-variables` | Inline and remove unnecessary variables from current git scope | refactorer |
| `/debug-frontend` | Debug browser-specific UI issues with Chrome DevTools tools first | ask |
| `/explore-codebase` | Explore a codebase topic with the task explore subagent | ask |
| `/fallow-audit` | Audit changed JavaScript or TypeScript code with Fallow | ask |
| `/fallow-project-analyse` | Analyse a JavaScript or TypeScript project with Fallow | ask |
| `/git-workflow` | Read branch, diff, and PR context from BranchContextPlugin without extra git calls | ask |
| `/import-external-skill` | Import or review external skills for the local skill library | default |
| `/improve-codebase-architecture` | Review a codebase area for architectural friction and focused structural improvements | ask |
| `/investigate` | Investigate a topic, issue, or area without editing by default | ask |
| `/plan` | Manual entrypoint to native plan mode from the current conversation context | plan |
| `/refactor-current-work` | Refactor current branch work while preserving behaviour | refactorer |
| `/remove-single-use-functions` | Inline and remove safe single-use functions from current git scope | refactorer |
| `/review-current-work` | Review current branch work with BranchContextPlugin context | reviewer |
| `/timmo001/reset-branch-reapply` | Reset branch to default and reapply current diff staged | build |
| `/types-enforce-ts` | Enforce TypeScript type safety in current git scope | refactorer |

## Plugins

| Plugin | Description |
|---|---|
| `branch-context` | Injects branch-context blocks into command prompts before execution |
| `env-protection` | Blocks reads of .env files to prevent leaking secrets |
| `notification` | Plays a desktop notification sound when agent tasks complete |
| `readonly-subagent-task-guard` | Forces read-only primary agents to delegate only to non-modifying subagents |

## Publishing

This repo is published from [`timmo001/dotfiles`](https://github.com/timmo001/dotfiles) via `git subtree push`:

```bash
dot opencode-publish
```
