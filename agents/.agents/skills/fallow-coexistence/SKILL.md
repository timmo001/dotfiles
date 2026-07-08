---
name: fallow-coexistence
description: Guidance for using Fallow alongside code-quality and framework skills without conflict. Use when running Fallow or acting on its findings — applying fix/suppress suggestions, interpreting dead-code or complexity output, or analysing Effect, Lit, or Home Assistant code — to decide what to apply, what to verify first, and how to configure Fallow.
---

# Fallow Coexistence

How to use Fallow alongside this repo's code-quality and framework skills. Fallow is a data source, not an authority: treat its findings as candidates, and let the owning skill make the call.

## Core rule

- Fallow reports; your skills decide. Never auto-apply Fallow's `fix`, `extract-shared`, or `suppress-line` actions without checking the relevant skill below.
- Prefer fixing the underlying issue or adding a config-level `rules` entry over scattering `fallow-ignore` comments.

## Pattern A — auto-fix vs manual rails

Fallow's `fix`/suppress actions push against the verification rails in `cleanup-unnecessary-variables`, `remove-single-use-functions`, and `types-enforce-ts`.

- `fix` removes exported surface on syntactic reachability alone; those skills scope safe removal to local, non-exported symbols with a verified single call site.
- Before deleting anything exported, run `trace_export` / `trace_file` and confirm by hand.
- Do not add `fallow-ignore` or blanket-suppression comments; they violate the "no unnecessary comments" and "no blanket suppressions" rules.

## Pattern B — syntactic engine vs framework idioms

Fallow is syntactic-only, so it false-positives where `effect`, `home-assistant-*`, and `lit-rendering` operate. Configure Fallow first instead of trusting raw output:

- Framework-invoked class members (Lit lifecycle, HA component methods) flagged "unused" → add names/globs to `usedClassMembers`.
- Registered or dynamically loaded modules (custom elements, locale files, plugins) flagged "unused file/export" → add globs to `dynamicallyLoaded`.
- Monorepo library exports flagged "unused" → list packages in `publicPackages`.
- Effect idioms (`Effect.gen` generators, pipes, `Layer` wiring) inflate complexity/CRAP scores → judge against the `effect` skill, not Fallow's thresholds.

The knob is the same across repos; the values (globs, member names) are per-repo.

```jsonc
{
  "usedClassMembers": [
    "agInit",
    { "extends": "LitElement", "members": ["render", "firstUpdated", "updated"] }
  ],
  "dynamicallyLoaded": ["src/translations/**", "src/panels/**"],
  "publicPackages": ["@myorg/shared"]
}
```

## Usable — Fallow as evidence

These consume Fallow cleanly; feed it in, let the skill judge:

- `code-review` — `audit` verdict and findings are review evidence.
- `improve-codebase-architecture` — `hotspots` / `targets` / `boundaries` / `dupes` are inputs; the skill supplies the structural judgment (override Fallow's mechanical `extract-shared` when it would add a shallow abstraction).
- `diagnose` — separate lane (runtime); no overlap.
- `branch-context-consumer` / `git-context` — supply the base ref that `audit --base` / `--changed-since` consume.

## When NOT to use

- Not for running Fallow itself — see the `fallow` skill.
- Not for non-JS/TS code, or when no skill owns the touched domain.
