---
name: human-step-guide
description: Prepare a concise guide when progress is blocked by a genuinely human-only action. Use for approvals, physical actions, credential entry, or dashboard steps the agent cannot perform; do not use for work available tools can complete.
---

# Human Step Guide

Use this skill only at a real human boundary. Work the agent can do remains agent work.

1. Confirm the blocker cannot be completed with the available tools and permissions.
2. Give the user one staged handoff containing:
   - the exact URL, application, device, or location
   - the exact action to take
   - the expected visible result
   - the non-secret information to return so work can continue
   - the verification step the agent will run afterwards
3. Stop at the boundary and wait for the result. Resume from the verification step when the user returns.

Never ask the user to expose a secret in chat. Never write `.env` files, secrets, variables, external settings, comments, or messages unless the user explicitly requests that specific action and the active agent has permission to perform it.
