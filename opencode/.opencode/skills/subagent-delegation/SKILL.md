---
name: subagent-delegation
description: When and how to delegate work to subagents for efficient task completion
---

# Subagent Delegation

Use this skill to determine when to delegate work to specialized subagents.

## Available Subagents

### @explore
**Use for:** Quick, read-only repository discovery
- Searching for files by pattern
- Locating symbols/definitions
- Scanning documentation
- Finding where something is used

**Best when:** You need fast answers about the codebase structure.

### @general
**Use for:** Multi-step investigations or parallel tool work
- Complex research requiring multiple searches
- Parallel lookups across different areas
- Running commands like custom commands (e.g., `timmo001/read-branch`)
- Any task that benefits from focused, autonomous work

**Best when:** The investigation is complex or you want parallel execution.

## Decision Guide

| Situation | Agent |
|-----------|-------|
| "Where is X defined?" | @explore |
| "Find all usages of Y" | @explore |
| "What does this codebase do?" | @general |
| "Summarize changes on this branch" | @general |
| "Run the read-branch command" | @general |
| Large diff needs investigation | @general |

## Tips

- Prefer CLI commands for local/GitHub queries (`git`, `gh`)
- Use `webfetch` for external/online information
- Use the `question` tool when there are unknowns that can't be looked up
- Don't provide plans/solutions unless explicitly asked - gather info first
