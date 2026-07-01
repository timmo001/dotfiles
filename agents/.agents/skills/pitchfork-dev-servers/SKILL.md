---
name: pitchfork-dev-servers
description: Prefer pitchfork-backed workflows for long-running local dev servers and check available MCP/tooling first. Use when starting, stopping, restarting, checking, or tailing development servers, background servers, `pitchfork.toml`, pitchfork MCP tools, or local AGENTS/mise tasks that mention pitchfork.
---

# Pitchfork Dev Servers

Use this skill when a task involves starting or managing a long-running local server and the repo provides `pitchfork.toml`, local tasks, MCP tooling, or AGENTS guidance mentioning pitchfork.

## Preflight

1. Read local `AGENTS.md` first. Local repo guidance wins over this global skill.
2. Check for repo-provided pitchfork wrappers: `mise tasks`, `pitchfork.toml`, or project-specific task names such as `serve:*`, `dev:*`, `background:*`, or aliases documented locally.
3. Check whether pitchfork MCP tools are available for observation and control: `pitchfork_status`, `pitchfork_logs`, `pitchfork_stop`, `pitchfork_restart`, `pitchfork_start`.
4. Check whether the `pitchfork` CLI is installed before falling back to raw foreground server commands.

## Rules

1. Prefer repo-provided pitchfork-backed tasks over foreground `run:*`, `dev`, or raw server commands when starting long-running servers.
2. Defer to local `AGENTS.md`, project skills, and repo tasks for the exact command. Do not invent a naming convention when the repo has one.
3. Use foreground commands only for explicit foreground debugging, one-shot checks, or when pitchfork is unavailable.
4. Do not assume MCP `pitchfork_start` can start per-repo daemons from any cwd. If start fails with no matching daemon, run the repo's local pitchfork-backed task from that repo directory.
5. Use pitchfork MCP status, logs, restart, and stop tools when available once a daemon exists. Otherwise use the matching CLI commands.
6. When wrappers stop production resource owners, avoid replacing them with broad process kills. Prefer resource-targeted commands like `fuser <port>/tcp` or `fuser <socket>`.

## Command Discovery

1. Read local `AGENTS.md` first for the repo's preferred dev-server commands.
2. Use `mise tasks` when the command name is not obvious.
3. If there is no wrapper task but `pitchfork.toml` exists, run pitchfork directly from the repo directory.
4. Typical operations are `pitchfork start <daemon>`, `pitchfork status`, `pitchfork logs -t <daemon>`, `pitchfork restart <daemon>`, and `pitchfork stop <daemon>`.
5. Treat `serve:*` as a common local convention, not a requirement.

## Notes

- Some repos use pitchfork wrappers to stop production services or resource owners before starting dev servers, then restore production when dev exits. Preserve that behaviour.
- Pitchfork is intended to keep agents from blocking on foreground servers. Prefer background start plus logs and status checks over running a server in the agent shell.
