---
name: safe-process-signals
description: >
  Safe process killing and signal handling for agent/subprocess contexts. Use when running pkill, killall, kill, or any process termination command from a shell subprocess, automated script, or coding agent.
---

# Safe Process Signals

Prevent agent hangs and self-kills when terminating processes from subprocesses.

## The Core Problem

When an agent runs a command like `pkill -f "pattern"`, the shell subprocess executing that command may match itself or its parent process tree. This causes:

- The agent's own shell to be killed mid-execution
- The command to hang indefinitely (agent waits for a process that killed itself)
- Unintended kills of the editor, IDE, or terminal hosting the agent

This is especially dangerous with `-f` (full command line matching) because parent processes like `cursor.mjs`, `code-server`, or `node` appear in the ancestry.

## Rules

### 1. Never use bare `pkill -f "pattern"`

The `-f` flag matches the full command line of every process, including the `pkill` command itself and its parent process tree.

### 2. Use the bracket trick to prevent self-match

```bash
# WRONG - may kill self or parent
pkill -f "cursor.mjs"

# CORRECT - bracket trick prevents the pkill process from matching itself
pkill -f "[c]ursor.mjs"
```

The bracket trick works because `[c]ursor.mjs` matches the target process's cmdline `cursor.mjs`, but the pkill process's own cmdline contains the literal string `[c]ursor.mjs` which does not match the regex `[c]ursor.mjs`.

### 3. Prefer pgrep before pkill

Always verify what will be matched before killing:

```bash
# Check first
pgrep -f "[c]ursor.mjs" -a

# Then kill if the output looks correct
pkill -f "[c]ursor.mjs"
```

### 4. Prefer exact name match (-x) over -f when possible

Omarchy's restart helpers use `pkill -x <name>` which matches the process name only - no self-match risk, no parent-tree risk. Follow this pattern:

```bash
# Best: exact process name (what omarchy-restart-* uses)
pkill -x "waybar"

# Acceptable: bracket trick when -f is needed
pkill -f "[n]ode.*server.js"

# Dangerous: bare -f in subprocess context
pkill -f "node.*server.js"
```

When you need to restart an Omarchy-managed app, prefer the built-in helper:

```bash
omarchy restart waybar
omarchy restart terminal
omarchy restart-app <name> [args...]
```

### 5. Exclude own process tree when using kill pipelines

```bash
# Safe pipeline - exclude grep itself and current shell
pgrep -f "[m]yapp" | xargs kill 2>/dev/null
```

### 6. Use timeout as a safety net

When uncertain about hang risk, wrap in a timeout:

```bash
timeout 5 pkill -f "[p]attern" 2>/dev/null || true
```

### 7. Avoid killall -r (regex) with broad patterns

`killall -r` uses regex on process names. Broad patterns risk matching unintended processes.

```bash
# Dangerous - matches anything with "server" in the name
killall -r "server"

# Safer - exact name
killall -e "my-server"
```

## Signal Choice

| Signal | Use case |
|--------|----------|
| `SIGTERM` (default) | Graceful shutdown, always try first |
| `SIGINT` | Simulate Ctrl+C, for interactive programs |
| `SIGKILL` (-9) | Last resort only, process cannot clean up |
| `SIGHUP` | Reload config (for daemons that support it) |

Never default to `-9`. Always try `SIGTERM` first, wait briefly, then escalate:

```bash
pkill -f "[p]attern" && sleep 2 && pkill -9 -f "[p]attern" 2>/dev/null || true
```

## Common Patterns

### Kill a specific app safely

```bash
pkill -f "[c]ursor.mjs" 2>/dev/null || true
```

### Kill and confirm dead

```bash
pkill -f "[m]yapp" 2>/dev/null
sleep 1
if pgrep -f "[m]yapp" > /dev/null; then
  pkill -9 -f "[m]yapp" 2>/dev/null
fi
```

### Kill by PID file

```bash
# Safest approach when a pidfile exists
kill "$(cat /tmp/myapp.pid)" 2>/dev/null || true
```

## What NOT to Do

- `pkill -f "pattern"` without bracket trick in any subprocess context
- `kill -9` as a first step
- `killall` without `-e` (exact) on systems where names are ambiguous
- Broad regex patterns with `pkill -f` that match common strings like "node", "python", "java"
- Piping `ps aux | grep pattern | awk | kill` without excluding grep from results
