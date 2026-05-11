---
name: css-motion-systems
description: CSS motion design and implementation for web interfaces. Use when designing or building transitions, animations, `linear()` easing, transform strategy, View Transitions API patterns, motion tokens, or reviewing motion quality and accessibility.
# origin: https://github.com/stolinski/s-stack/tree/main/skills/css-motion-systems
---

# CSS Motion Systems

Production-oriented motion guidance for web UI. Focused on interaction clarity, performance, and accessibility -- not decorative animation.

## When to Use

- Building or refining interaction motion in product UI
- Choosing between CSS transition, keyframes, WAAPI, and View Transitions API
- Creating route transitions or shared element transitions
- Defining motion tokens (duration, distance, easing) for a design system
- Reviewing motion quality, performance, and accessibility

## When NOT to Use

- Static content with no interaction or state change
- Cases where motion increases cognitive load without adding clarity
- Immediate state updates where any delay harms usability

## Motion Goals

Each motion proposal should satisfy at least one:

1. **Continuity** -- where things came from and where they go
2. **Feedback** -- action acknowledged with clear response
3. **Hierarchy** -- what changed most and why
4. **Focus guidance** -- attention moves to the right target

## Mechanism Selection

Choose the lightest mechanism that satisfies the interaction:

- **CSS transition** -- state changes on a single element (hover, open/close, selected)
- **CSS keyframes** -- multi-stage timeline or repeated motion (loading, pulse, choreography)
- **WAAPI** -- imperative sequencing, playback control, cancel/reverse sync with logic
- **View Transitions API** -- continuity across DOM swaps, route changes, or layout mode changes

## Transform Strategy

### Individual properties (`translate:` / `rotate:` / `scale:`)

Prefer when:
- You want composable state layers (base styles + state overrides)
- Different interactions control different transform channels
- You need clearer design-token mapping

### `transform:` shorthand

Use when:
- Transform order is intentionally coupled
- You combine multiple functions and must preserve exact sequence
- You need functions not exposed as individual props

### `translate3d()` and 3D transforms

Use only when:
- You need actual 3D/perspective behaviour
- You have profiled a measurable compositor benefit in a real bottleneck

Avoid `translate3d()` as a blanket "GPU hack" -- it increases layer memory and can cause jank.

## Easing

- Use `cubic-bezier()` for most product interactions.
- Use `linear()` for piecewise velocity control and custom motion signatures.
- Tokenise easing values and reuse consistently.

See: [references/LINEAR_EASING_PATTERNS.md](references/LINEAR_EASING_PATTERNS.md)

## View Transitions API

### Same-document transitions

- Wrap DOM/state update in `document.startViewTransition(() => update())`
- Name only meaningful shared elements with `view-transition-name`
- Style transition pseudo-elements intentionally

### Cross-document transitions

- Opt in with `@view-transition { navigation: auto; }`
- Keep shared element naming consistent across pages
- Ensure entry/exit states remain meaningful when transition is unavailable

### Key pseudo-elements

- `::view-transition-old(root)` / `::view-transition-new(root)`
- `::view-transition-old(name)` / `::view-transition-new(name)`
- `::view-transition-group(name)`

### Failure and fallback

- Feature-detect and fall back to standard state updates
- Respect reduced motion by removing spatial travel and keeping clear state change
- Never block core interactions while waiting for transition effects

See: [references/VIEW_TRANSITION_RECIPES.md](references/VIEW_TRANSITION_RECIPES.md)

## Timing Heuristics

- Micro interactions: `120-180ms`
- Component transitions: `180-260ms`
- Structural/layout/route transitions: `240-420ms`
- Exits generally faster than enters

## Starter Tokens

See: [references/MOTION_TOKENS.css](references/MOTION_TOKENS.css)

## Performance Rules

- Prefer animating `transform` and `opacity`
- Avoid animating layout-affecting props (`top`, `left`, `width`, `height`) for frequent interactions
- Minimise long-running infinite animations on large surfaces
- Use `will-change` sparingly and remove when not needed
- Profile before and after changes (frame stability, long tasks, layer count)

## Accessibility Rules

- Support `@media (prefers-reduced-motion: reduce)`
- Replace large travel/zoom with fade or instant state change under reduced motion
- Keep feedback timing responsive; avoid long delays before state confirmation
- Ensure focus order, visibility, and keyboard behaviour remain correct during/after transitions

## Review Checklist

### Interaction quality

- Motion explains a state change, not just decoration
- Direction and distance match spatial context
- Enter and exit timing feels intentional and asymmetrical
- Staggering used only when it improves hierarchy

### Performance

- Primary animated properties are `transform` and/or `opacity`
- No avoidable layout-thrashing animations in frequent interactions
- Layer promotion controlled, not over-applied
- Interaction remains responsive under realistic load

### Accessibility

- `prefers-reduced-motion: reduce` implemented
- Reduced-motion behaviour keeps state changes understandable
- Focus management correct through transitions
- Keyboard and assistive tech flows not blocked by animation

### View Transitions

- Feature detection and graceful fallback present
- Shared element naming scoped and meaningful
- Pseudo-element styles explicit for root and shared groups
- Cross-document behaviour verified on supported browsers

### Validation

- Tested on desktop and mobile viewport sizes
- Tested in at least one lower-power or throttled scenario
- No visual tearing, clipping, or timing drift in rapid interactions
