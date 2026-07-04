---
name: home-assistant-list-components
description: Home Assistant list component migration and usage guidance. Use when editing ha-list, ha-list-item, ha-md-list, or migrating to ha-list-nav, ha-list-selectable, ha-list-item-button, ha-list-item-option, or ha-list-item-base.
---

# Home Assistant List Components

Use this skill when working with list containers or list items in the Home Assistant frontend. The new primitives replace the deprecated MWC-based `ha-list`, `ha-md-list`, `ha-list-item`, and `ha-md-list-item`.

## Component Hierarchy

```text
ha-row-item (base row layout — slots, spacing, disabled)
├── ha-list-item-base (non-interactive, role="listitem")
│   ├── ha-list-item-button (interactive, renders <a> or <button>)
│   └── ha-list-item-option (selectable, role="option", aria-selected)

ha-list-base (roving-tabindex container, role="list")
├── ha-list-nav (wraps in <nav> landmark, use with ha-list-item-button + href)
└── ha-list-selectable (role="listbox", owns selection state)
```

## Container Selection

| Use case | Container | Items |
|----------|-----------|-------|
| Navigation list (links) | `ha-list-nav` | `ha-list-item-button` with `href` |
| Action list (buttons) | `ha-list-base` | `ha-list-item-button` without `href` |
| Single-select listbox | `ha-list-selectable` | `ha-list-item-option` |
| Multi-select listbox | `ha-list-selectable multi` | `ha-list-item-option` |
| Static display rows | `ha-list-base` | `ha-list-item-base` |

## Slot Mapping (MWC to New)

| Old (MWC) | New | Notes |
|-----------|-----|-------|
| default slot (text) | `headline` slot or `.headline` attribute | Primary text |
| `slot="secondary"` | `supporting-text` slot or `.supportingText` attribute | Secondary line |
| `slot="graphic"` | `slot="start"` | Leading icon/avatar |
| `slot="meta"` | `slot="end"` | Trailing content |
| — | `slot="content"` | Escape hatch: replaces entire middle column |

## CSS Custom Properties

### Container

- `--ha-list-gap` — spacing between items (default `0`)
- `--ha-list-padding` — padding around the list (default `0`)

### Row

- `--ha-row-item-padding-block` — vertical padding
- `--ha-row-item-padding-inline` — horizontal padding
- `--ha-row-item-gap` — gap between start/content/end
- `--ha-row-item-min-height` — minimum row height (default `48px`)

### Focus

- `--ha-list-item-focus-radius` — focus outline border-radius
- `--ha-list-item-focus-width` — focus outline width (steady state)
- `--ha-list-item-focus-offset` — focus outline offset
- `--ha-list-item-focus-background` — background color on keyboard focus

### Selection

- `--ha-list-item-selected-background` — background when selected (appearance="line")

## CSS Parts

All items expose: `base`, `start`, `content`, `headline`, `supporting-text`, `end`.

Additional parts:

- `ha-list-nav`: `nav` (the `<nav>` wrapper), `base` (inner div)
- `ha-list-item-button`: `ripple`
- `ha-list-item-option`: `ripple`, `checkbox`

## Events

- `ha-list-activated` — from `ha-list-base` on Enter/Space. Detail: `{ index, item }`.
- `ha-list-selected` — from `ha-list-selectable` on selection change. Detail: `{ index, diff: { added, removed } }`.

## Migration Rules

### From `ha-list` + `ha-list-item` (MWC)

1. **Identify interactivity**: Does the item navigate (href), perform an action (click), allow selection, or just display info?
2. **Pick container**: Navigation → `ha-list-nav`. Selection → `ha-list-selectable`. Otherwise → `ha-list-base`.
3. **Pick item**: Navigates → `ha-list-item-button` with `href`. Action → `ha-list-item-button` without `href`. Selection → `ha-list-item-option`. Static → `ha-list-item-base`.
4. **Remap slots**: `graphic` → `start`, `meta` → `end`, text → `headline`/`supporting-text`.
5. **Remove MWC attributes**: `twoline`, `hasMeta`, `hasGraphic`, `noninteractive`, `activated`, `graphic="icon"` — these have no equivalent and are not needed.
6. **Replace event listeners**: `@request-selected` → use `ha-list-selected` on the container (for selectable) or `@click` / `ha-list-activated` for buttons.

### Non-interactive rows inside `ha-list-nav`

Use `ha-list-item-base` (not `ha-list-item-button`) for rows that display info without a link or action but still need to live inside a nav list. These participate in the list layout but are excluded from roving tabindex.

### Tooltip on non-interactive rows

`ha-list-item-base` accepts pointer events by default, so `ha-tooltip` hover works without needing `interactive`.

## Reference Implementations

```text
src/panels/config/components/ha-config-navigation-list.ts  — ha-list-nav + ha-list-item-button
src/panels/config/devices/ha-config-device-page.ts         — mixed ha-list-item-button + ha-list-item-base in ha-list-nav
gallery/src/pages/components/ha-list.markdown              — canonical gallery documentation
```

## Anti-patterns

- Do not use `ha-list-item-button` for non-interactive display rows — use `ha-list-item-base`.
- Do not put `ha-list-item-option` inside `ha-list-nav` — use `ha-list-selectable`.
- Do not handle selection in individual items — `ha-list-selectable` owns selection state.
- Do not use `@click` on `ha-list-item-option` for selection — listen to `ha-list-selected` on the container.
- Do not add `role` attributes manually — the components set correct ARIA roles automatically.
