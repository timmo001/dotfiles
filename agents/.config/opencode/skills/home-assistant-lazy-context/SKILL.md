---
name: home-assistant-lazy-context
description: Home Assistant frontend lazy-context and memoization guidance for context-aware components.
---

# Home Assistant Lazy Context

Use this skill when reviewing or editing Home Assistant frontend context, memoization, or `hass` removal work.

## Context Architecture (`src/data/context/index.ts`)

Three tiers of Lit contexts provided by `context-mixin.ts`:

### Core Contexts (always subscribed)

| Context | Type | Contents |
|---------|------|----------|
| `registriesContext` | `HomeAssistantRegistries` | entities, devices, areas, floors registries |
| `statesContext` | `HomeAssistant["states"]` | Live entity state map |
| `servicesContext` | `HomeAssistant["services"]` | Services map |
| `internationalizationContext` | `HomeAssistantInternationalization` | localize, locale, language, loaders |
| `apiContext` | `HomeAssistantApi` | callService, callWS, fetchWithAuth, hassUrl |
| `connectionContext` | `HomeAssistantConnection` | connection, connected, debugConnection |
| `uiContext` | `HomeAssistantUI` | themes, panels, sidebar, kiosk |
| `configContext` | `HomeAssistantConfig` | auth, config, user, userData, systemData |
| `formattersContext` | `HomeAssistantFormatters` | formatEntityState, formatEntityName, etc. |
| `entitiesContext` | `HomeAssistant["entities"]` | Entity registry map |
| `devicesContext` | `HomeAssistant["devices"]` | Device registry map |
| `areasContext` | `HomeAssistant["areas"]` | Area registry map |
| `floorsContext` | `HomeAssistant["floors"]` | Floor registry map |

### Lazy Contexts (subscribed only when consumed)

Managed by `LazyContextProvider` -- WS subscription defers until first consumer, tears down after 5s idle when all consumers disconnect.

| Context | Type |
|---------|------|
| `labelsContext` | `LabelRegistryEntry[]` |
| `fullEntitiesContext` | `EntityRegistryEntry[]` |
| `configEntriesContext` | `ConfigEntry[]` |
| `manifestsContext` | `DomainManifestLookup` |

### Deprecated Contexts

Do not use. Each has a `@deprecated` comment naming the replacement:
- `connectionSingleContext` → `connectionContext`
- `localizeContext`, `localeContext` → `internationalizationContext`
- `configSingleContext`, `userContext`, `userDataContext`, `authContext` → `configContext`
- `themesContext`, `selectedThemeContext`, `panelsContext` → `uiContext`

## Entity Decorators (`src/common/decorators/consume-context-entry.ts`)

- `@consumeEntityState({ entityIdPath })` — resolves entity ID from host config path, subscribes to `statesContext`, returns `HassEntity`
- `@consumeEntityStates({ entityIdPath })` — same for array of entity IDs → `HassEntity[]`
- `@consumeEntityRegistryEntry({ entityIdPath })` — subscribes to `entitiesContext`, returns `EntityRegistryDisplayEntry`

## Migration: Removing `hass`

When a component adopts context, the `hass` property is removed. This requires revising all sub-components and helpers it passes `hass` to.

### Decision Tree for Sub-Components

1. **Component can consume context directly** (it's rendered in the app tree, not reused across unrelated trees):
   - Remove `hass` property, add `@consume` decorators for each needed slice.
   - Use `ContextType<typeof fooContext>` for typing.

2. **Component is a shared utility** (reused widely, context conversion would touch too many callers):
   - Pass the **individual item** as a prop when scope is small (e.g. `localize: LocalizeFunc`, `states: HassEntities`).
   - Pass `Pick<HomeAssistant, "callWS" | "localize">` when the component needs a few unrelated slices and context is not viable.
   - Never pass the full `HomeAssistant` object.

3. **Helper/utility functions** (pure data functions):
   - Narrow the parameter from `HomeAssistant` to `Pick<HomeAssistant, "callWS">` (or the single value needed).
   - This lets the consuming component pass its context slice directly (e.g. `this._api`) without reconstructing `hass`.
   - Prefer narrowing the helper over changing every caller — keeps the scope of the change small.

### Narrowing Helpers to Avoid Scope Explosion

When a component adopts context, its helpers still need data. Rather than passing a reconstructed `hass`-like object or converting every caller, **narrow the helper signature** so the context slice satisfies it directly:

```ts
// BEFORE: helper accepts full hass
export const fetchDeviceTriggers = (hass: HomeAssistant, deviceId: string) =>
  hass.callWS<DeviceTrigger[]>({...});

// AFTER: helper accepts only what it uses
export const fetchDeviceTriggers = (
  hass: Pick<HomeAssistant, "callWS">,
  deviceId: string
) => hass.callWS<DeviceTrigger[]>({...});
```

The component then passes its context slice directly:

```ts
// Component consumes apiContext (which satisfies Pick<HomeAssistant, "callWS">)
@state()
@consume({ context: apiContext, subscribe: true })
private _api!: ContextType<typeof apiContext>;

// Passes directly — no reconstruction needed
const triggers = await fetchDeviceTriggers(this._api, deviceId);
```

This keeps the change focused: the dialog/panel adopts context, the helpers get narrowed types, and all other callers of those helpers still work unchanged (since `HomeAssistant` satisfies `Pick<HomeAssistant, "callWS">`).

### When to Use `Pick` vs Individual Values

- **`Pick<HomeAssistant, "callWS">`** — when the helper uses methods from a single context group and the existing param name `hass` stays readable. Keeps changes minimal.
- **Individual value** (e.g. `states: HassEntities`) — when passing a plain data map that the helper iterates/reads. More explicit, avoids the `hass.` prefix.
- **`Pick` with multiple keys** — avoid unless strictly necessary. If a helper needs `"callWS" | "localize"`, consider splitting it or accepting the grouped context type directly.

### Consumption Pattern

```ts
@state()
@consume({ context: apiContext, subscribe: true })
private _api!: ContextType<typeof apiContext>;

@state()
@consume({ context: internationalizationContext, subscribe: true })
private _i18n!: ContextType<typeof internationalizationContext>;

@state()
@consume({ context: statesContext, subscribe: true })
private _states!: ContextType<typeof statesContext>;
```

Usage: `this._api.callWS(...)`, `this._i18n.localize(...)`, `this._states[entityId]`.

## Rules

### General
- Preserve runtime behavior and public API shape unless the user asked otherwise.
- Use the narrowest correct data source; prefer contexts, lazy contexts, and entity decorators over broad `hass` access.
- Do not use deprecated contexts; use the replacement named in `@deprecated` comments.
- Do not replicate `hass` or build local objects that mirror large parts of `HomeAssistant`.
- Do not add provider fallbacks when an existing app-level context/lazy context is already correct.
- Do not duplicate `LazyContextProvider` lifecycle behavior in feature components.
- Do not create wrapper helpers that only forward existing utility calls.

### Typing
- Use `ContextType<typeof context>` for consumed context typing.
- Use required (`!`) when lifecycle guarantees availability; use optional (`?`) only when value can be genuinely absent.
- Avoid excessive defensive guards around required consumed contexts.
- For sub-components that can't use context, type props as narrow as possible: prefer `LocalizeFunc` over `HomeAssistantInternationalization`, prefer `Pick<HomeAssistant, "callWS">` over `HomeAssistant`.

### Memoization
- Pass explicit narrow inputs only (actual state slice, config, primitive, small arrays).
- Do not pass broad objects (`hass`, `this`, large mutable maps) into `memoizeOne`.
- Do not widen signatures with pass-through `localize`, `language`, `locale`, or config values when class/context access already exists.
- Do not add passthrough fields (`_language`, `_locale`, `_config`) only to route values into helpers.
- For rarely changed values like locale/config, read from existing class/context access at point of use.

### Style
- Do not add unnecessary comments or abstractions.
