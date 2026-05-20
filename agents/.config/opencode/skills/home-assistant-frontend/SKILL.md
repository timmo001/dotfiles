---
name: home-assistant-frontend
description: Home Assistant frontend development with Lit Web Components and TypeScript. Use when working in the Home Assistant frontend repo, editing ha-* components, reviewing HA PRs, or applying HA-specific conventions (localization, theming, dialogs, panels, cards).
---

# Home Assistant Frontend

Use this skill when working in the Home Assistant frontend repository or on code that follows its conventions.

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

## Core Conventions

1. **Component naming**: `ha-` prefix for HA components, `hui-` for Lovelace UI, `dialog-` for dialogs.
2. **TypeScript strict**: All code is strict TypeScript. Use `import type` for type-only imports.
3. **No console statements**: Use proper logging (`no-console: "error"`).
4. **Localization**: All user-facing text via `this.hass.localize()` with keys in `src/translations/en.json`.
5. **Theming**: Use CSS custom properties from the theme system. Use `--ha-space-*` tokens for spacing.
6. **Mobile-first**: Design for mobile, enhance for desktop.
7. **Accessibility**: ARIA labels, keyboard navigation, screen reader support, WCAG AA contrast.

## Verification

- `yarn lint:types` — TypeScript compiler (never with file arguments).
- `yarn lint` — ESLint + Prettier + TypeScript + Lit.
- `yarn format` — auto-fix ESLint + Prettier.
- `yarn test` — Vitest.

Never run `yarn lint:types` with file arguments — it ignores tsconfig and emits .js files.

## Text and Terminology

- Use "Home Assistant" in full, never "HA" or "HASS".
- Sentence case everywhere (titles, headings, buttons, labels).
- "Delete" for permanent actions, "Remove" for reversible ones.
- "Create" for new things, "Add" for existing items.
- American English, Oxford comma, no Latin abbreviations.

## Key Patterns

- **Dialogs**: Use `ha-wa-dialog` with `header-title` attribute, `_open` state, `@closed` handler.
- **Forms**: Schema-driven `ha-form` with `computeLabel`/`computeError`/`computeHelper`.
- **Alerts**: `ha-alert` with `alert-type` (error/warning/info/success).
- **Loading**: `ha-spinner` (not `ha-circular-progress`).
- **Popovers**: `ha-adaptive-popover` for anchored desktop / bottom sheet mobile.
- **Panels**: Lazy-loaded via dynamic imports, extend `SubscribeMixin(LitElement)`.
- **Cards**: Implement `LovelaceCard` with `setConfig()` and `getCardSize()`.

## References

When relevant, consult these files in the HA frontend repo:

```text
src/data/context/index.ts
src/state/context-mixin.ts
src/state/lazy-context-provider.ts
src/components/ha-selector/ha-selector-select.ts
src/components/ha-target-picker.ts
src/components/ha-navigation-picker.ts
src/resources/theme/core.globals.ts
```
