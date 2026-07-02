---
name: pitchfork-dev-servers
description: Manage long-running local dev servers by precedence - the project's own AGENTS.md workflow first, framework-native background mode next, then pitchfork as the fallback. Use when starting, stopping, restarting, checking, or tailing development servers, background servers, `pitchfork.toml`, pitchfork MCP tools, or local AGENTS/mise tasks that mention pitchfork.
---

# Pitchfork Dev Servers

Use this skill when a task involves starting or managing a long-running local server and the repo provides `pitchfork.toml`, local tasks, MCP tooling, or AGENTS guidance mentioning pitchfork.

Pitchfork is the fallback tier, not the default. Follow the project's own declared workflow first, then framework-native background mode, then pitchfork, then foreground for explicit debugging.

## Preflight

1. Read local `AGENTS.md` first, especially a `## Background Dev Servers` section. Local repo guidance wins over this global skill.
2. Check whether the project relies on a framework-native background mode (for example Astro 7+, which self-detaches `astro dev` under an agent). If so, that is the declared workflow, not pitchfork.
3. Check for repo-provided pitchfork wrappers: `mise tasks`, `pitchfork.toml`, or project-specific task names such as `serve:*`, `dev:*`, `background:*`, or aliases documented locally.
4. Check whether pitchfork MCP tools are available for observation and control: `pitchfork_status`, `pitchfork_logs`, `pitchfork_stop`, `pitchfork_restart`, `pitchfork_start`.
5. Check whether the `pitchfork` CLI is installed before falling back to raw foreground server commands.

## Rules

1. Follow the project's declared workflow first. Read local `AGENTS.md`, project skills, and repo tasks; local guidance wins. Do not invent a naming convention when the repo has one.
2. Use framework-native background mode when the project relies on one. Astro 7+ self-detaches `astro dev` under an agent (`.astro/dev.json` lock; `astro dev status|logs|stop`; `/_astro/status`); use that instead of pitchfork.
3. Use pitchfork as the fallback when the repo ships `pitchfork.toml` or pitchfork-backed tasks but declares nothing more specific. Prefer `serve:*` tasks over foreground `run:*`, `dev`, or raw server commands.
4. Use foreground commands only for explicit foreground debugging, one-shot checks, or when the declared workflow is unavailable.
5. Do not assume MCP `pitchfork_start` can start per-repo daemons from any cwd. If start fails with no matching daemon, run the repo's local pitchfork-backed task from that repo directory.
6. Use pitchfork MCP status, logs, restart, and stop tools when available once a daemon exists. Otherwise use the matching CLI commands.
7. When wrappers stop production resource owners, avoid replacing them with broad process kills. Prefer resource-targeted commands like `fuser <port>/tcp` or `fuser <socket>`.
8. OpenCode's `pitchfork-dev-server-guard` plugin enforces the pitchfork tier only: in repos that declare `pitchfork.toml` it redirects known foreground dev-server commands to `serve:*` or `pitchfork start` and notes the change. It deliberately ignores `astro dev`.

## Command Discovery

1. Read local `AGENTS.md` first for the repo's preferred dev-server commands.
2. Use `mise tasks` when the command name is not obvious.
3. If there is no wrapper task but `pitchfork.toml` exists, run pitchfork directly from the repo directory.
4. Typical operations are `pitchfork start <daemon>`, `pitchfork status`, `pitchfork logs -t <daemon>`, `pitchfork restart <daemon>`, and `pitchfork stop <daemon>`.
5. Treat `serve:*` as a common local convention, not a requirement.

## Notes

- Some repos use pitchfork wrappers to stop production services or resource owners before starting dev servers, then restore production when dev exits. Preserve that behaviour.
- Pitchfork is intended to keep agents from blocking on foreground servers. Prefer background start plus logs and status checks over running a server in the agent shell.
