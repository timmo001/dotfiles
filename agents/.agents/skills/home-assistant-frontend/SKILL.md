---
name: home-assistant-frontend
description: Home Assistant frontend skill routing and personal engineering overlays. Use when editing or reviewing the Home Assistant frontend so repository-local `ha-frontend-*` skills stay authoritative and applicable Lit, TypeScript, cleanup, and HA companion skills are also loaded.
---

# Home Assistant Frontend

Use this skill when working in the Home Assistant frontend repository or on code that follows its conventions. It routes to the project's own guidance and adds only cross-project engineering preferences.

## Primary Source of Truth

The frontend repository owns Home Assistant implementation conventions through its `AGENTS.md` and `.agents/skills/ha-frontend-*` skills:

1. Read the repository's applicable instructions before editing or reviewing.
2. Discover and load every applicable repo-local `ha-frontend-*` skill based on its description.
3. Treat those repo-local skills as authoritative for components, contexts, styling, testing, user-facing text, and review conventions.
4. Do not replace repository guidance with a global pattern or copy repository conventions into this skill.

## When to Apply

- Editing files in a Home Assistant frontend checkout
- Reviewing or writing `ha-*` prefixed Web Components
- Working with HA dialogs, panels, Lovelace cards, or selectors
- Applying HA localization, theming, or design token patterns

## Personal Overlay

Layer these global skills over the repository guidance when their scopes apply:

- applicable `home-assistant-*` specialists for cross-repository workflows;
- applicable `lit-*` skills for Lit concerns;
- applicable `*-ts` skills before editing or reviewing TypeScript;
- `cleanup-*` and `remove-single-use-*` skills whenever their safe code-quality rules apply.

For Home Assistant rendering or picker work, load both `lit-rendering` and `home-assistant-lit-rendering`. Preserve the stricter TypeScript and cleanup guidance unless it conflicts with an explicit repository rule.

## Sibling Repositories

The Home Assistant core, documentation, custom cards, custom dashboards, and core packages commonly live alongside the frontend. When working across repositories, reference the available sibling checkout directly rather than guessing APIs or conventions. Follow each target repository's own instructions and skills.

### Core (`../core`)

- Read the Core repository instructions when the frontend change involves backend APIs, WebSocket commands, entity models, or integration data structures.
- Reference core source (e.g. `homeassistant/components/<integration>/`) to understand data shapes, service schemas, and WebSocket API handlers before consuming them in frontend code.
- When adding or modifying frontend calls to backend APIs, verify the API exists in core and match parameter names, types, and response shapes to the core implementation.
- If asked to make changes that span both frontend and core (new WebSocket command, new entity feature), work in both repos and follow each repo's own `AGENTS.md` for its conventions.

### User Docs (`../home-assistant.io`)

- Read the user documentation repository instructions when asked to create or update user-facing documentation.
- Documentation for new frontend features, integrations, or UI changes goes here.
- Follow the documentation repository's writing style rather than imposing global frontend copy guidance.
- When a frontend change adds user-visible functionality, remind that corresponding docs may be needed and offer to create them following the docs repo's conventions.

### Developer Docs (`../developers.home-assistant`)

- Developer documentation for custom cards, custom dashboards, frontend architecture, and core packages lives here (developers.home-assistant.io).
- When creating or updating documentation for custom card APIs, dashboard strategies, Lovelace extensibility, or frontend development guides, work in this repo.
- Reference `docs/frontend/` and `docs/frontend.md` for existing frontend developer documentation.
- Core packages are cloned here — use them as reference for documenting Python package APIs and integration development patterns.
- Discover and follow that repository's `AGENTS.md` and repo-local skills before making changes.
