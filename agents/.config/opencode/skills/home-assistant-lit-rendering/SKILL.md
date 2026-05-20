---
name: home-assistant-lit-rendering
description: Home Assistant Lit rendering extensions for HA components and context-aware picker callback shape.
---

# Home Assistant Lit Rendering

Use this skill together with `lit-rendering` when editing Home Assistant frontend Lit code.

- Keep Home Assistant-specific rendering aligned with existing `ha-*` component patterns.
- When adding editor tabs or controls, gate them by the same HA mode/capability checks used by the existing action path; do not expose UI for YAML, generated, read-only, or unsupported modes just because optional callbacks are present.
- For `ha-generic-picker`, match repository callback shape:
  - `.getItems=${this._getItems}` when callback reads existing component state.
  - `.getItems=${this._getItems(optionsOrSections)}` when callback closes over render-local data.
- Keep `.sections` and `.getItems` aligned to the same current-render source.
- When values come from Home Assistant context (`hass`, consumed i18n/config contexts), avoid introducing passthrough fields just to route those values.
- Prefer existing Home Assistant references before introducing a new local rendering shape:
  - `src/components/ha-selector/ha-selector-select.ts`
  - `src/components/ha-target-picker.ts`
  - `src/components/ha-navigation-picker.ts`
