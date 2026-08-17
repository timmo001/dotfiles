---
title: Pi
description: Lightweight Pi setup alongside the main OpenCode configuration.
---

[Pi](https://github.com/earendil-works/pi) is installed through mise as a lightweight companion to OpenCode. It shares repository `AGENTS.md` files and the portable skills under `~/.agents/skills/` without maintaining a separate instruction or skill selection layer.

The stowed `~/.pi/agent/extensions/workflow.ts` extension adds two workflows:

- After successful manual or threshold compaction, Pi queues a follow-up that reconstructs the active task and continues the next unfinished step. Overflow compaction is left to Pi's built-in retry.
- `/research-tab <topic>` creates an unfocused tab in the current Herdr workspace, starts another Pi session in the same directory, and sends it a read-only primary-source research prompt. The command reports an error when Pi is not running inside Herdr.

Pi settings, authentication, trust, sessions, and generated integrations remain runtime-owned. Herdr and Omarchy continue to manage their own Pi extensions beside the stowed workflow extension.
