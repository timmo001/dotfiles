---
name: home-assistant-lazy-context
description: Home Assistant frontend lazy-context and memoization guidance for context-aware components.
---

# Home Assistant Lazy Context

Use this skill when reviewing or editing Home Assistant frontend context and memoization usage:

- Preserve runtime behavior and public API shape unless the user asked otherwise.
- Use the narrowest correct data source; prefer existing contexts, lazy contexts, and entity decorators over broad `hass` access.
- Do not use deprecated contexts from `src/data/context/index.ts`; use the replacement named in `@deprecated` comments.
- Do not replicate `hass` or build local objects that mirror large parts of `HomeAssistant`.
- Do not add provider fallbacks when an existing app-level context/lazy context is already correct.
- Do not duplicate `LazyContextProvider` lifecycle behavior in feature components.
- Do not create wrapper helpers that only forward existing utility calls.
- Use `ContextType<typeof context>` for consumed context typing and existing registry/entity types where available.
- Use required consumed context typing (`!`) when lifecycle guarantees availability; use optional (`?`) only when value can be genuinely absent.
- Avoid excessive defensive guards around required consumed contexts.
- For memoization, pass explicit narrow inputs only (actual state slice, config, primitive, small arrays).
- Do not pass broad objects (`hass`, `this`, large mutable maps) into `memoizeOne` when narrower inputs are available.
- Do not widen signatures with pass-through `localize`, `language`, `locale`, or config values when class/context access already exists.
- Do not add passthrough fields like `_language`, `_locale`, or `_config` only to route values into helpers.
- For rarely changed values like locale/config, read from existing class/context access at point of use.
- Do not add unnecessary comments or abstractions.
