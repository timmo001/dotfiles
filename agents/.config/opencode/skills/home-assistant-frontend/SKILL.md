---
name: home-assistant-frontend
description: Home Assistant frontend development with Lit Web Components and TypeScript. Use when working in the Home Assistant frontend repo, editing ha-* components, reviewing HA PRs, or applying HA-specific conventions (localization, theming, dialogs, panels, cards).
---

# Home Assistant Frontend

Use this skill when working in the Home Assistant frontend repository or on code that follows its conventions.

## Primary Source of Truth

The HA frontend repo contains its own `AGENTS.md` and may contain repo-local skills. These are the canonical references and must be read and followed directly:

1. **Read `AGENTS.md`** in the HA frontend repo root before making any changes.
2. **Load any repo-local skills** defined in the HA frontend repo — they take precedence over guidance in this skill for repo-specific patterns.
3. **Do not duplicate** conventions already covered by the repo's own agent instructions. This skill exists only to trigger loading and to list companion skills.

## When to Apply

- Editing files in a Home Assistant frontend checkout
- Reviewing or writing `ha-*` prefixed Web Components
- Working with HA dialogs, panels, Lovelace cards, or selectors
- Applying HA localization, theming, or design token patterns

## Companion Skills

This skill works alongside and does not replace:

- `lit-rendering` — generic Lit rendering and memoization
- `home-assistant-lit-rendering` — HA-specific Lit rendering extensions
- `home-assistant-lazy-context` — HA lazy-context and memoization guidance
- `types-enforce-ts` — TypeScript type-safety baseline
- `cleanup-unnecessary-variables` — safe variable cleanup
- `remove-single-use-functions` — safe function inlining

Load all applicable companion skills when the change touches their concerns.

## Sibling Repositories

The Home Assistant core, documentation, custom cards, custom dashboards, and core packages all live in the parent directory (`../`) alongside the frontend. When working across repos, reference sibling code directly rather than guessing APIs or conventions. Each repo with an `AGENTS.md` has its own conventions — read it before making changes there.

### Core (`../core`)

- **Read `../core/AGENTS.md`** when the frontend change involves backend APIs, WebSocket commands, entity models, or integration data structures.
- Reference core source (e.g. `homeassistant/components/<integration>/`) to understand data shapes, service schemas, and WebSocket API handlers before consuming them in frontend code.
- When adding or modifying frontend calls to backend APIs, verify the API exists in core and match parameter names, types, and response shapes to the core implementation.
- If asked to make changes that span both frontend and core (new WebSocket command, new entity feature), work in both repos and follow each repo's own `AGENTS.md` for its conventions.

### User Docs (`../home-assistant.io`)

- **Read `../home-assistant.io/AGENTS.md`** when asked to create or update user-facing documentation.
- Documentation for new frontend features, integrations, or UI changes goes here.
- Follow the docs repo's writing style (American English, Microsoft Style Guide, sentence case, friendly tone, inclusive language) — do not invent a separate style.
- When a frontend change adds user-visible functionality, remind that corresponding docs may be needed and offer to create them following the docs repo's conventions.

### Developer Docs (`../developers.home-assistant`)

- Developer documentation for custom cards, custom dashboards, frontend architecture, and core packages lives here (developers.home-assistant.io).
- When creating or updating documentation for custom card APIs, dashboard strategies, Lovelace extensibility, or frontend development guides, work in this repo.
- Reference `docs/frontend/` and `docs/frontend.md` for existing frontend developer documentation.
- Core packages are cloned here — use them as reference for documenting Python package APIs and integration development patterns.
- If this repo gains an `AGENTS.md` or `.opencode/skills/`, read and follow those before making changes.

### Creating a New Custom Card, Card Feature, or Dashboard

When asked to create a new custom card, card feature, or dashboard:

1. Find the most recently modified `ha-card-*`, `ha-card-feature-*`, or `ha-dashboard-*` directory in `../` that matches the type being created.
2. Copy that repo as the starting point for the new project.
3. Reset its git history (`rm -rf .git && git init --initial-branch=main`).
4. Remove files specific to the original project (old source, tests, assets) while keeping the build tooling, config, and project structure.
5. Rename and update `package.json`, component names, and entry points to match the new project.
