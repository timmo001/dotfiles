---
description: TypeScript type-safety rules
---

Applies only to TypeScript files such as `.ts`, `.tsx`, `.mts`, and `.cts`.

Use these rules when reviewing or editing TypeScript code:

- Preserve runtime behavior and public API shape unless the user asked otherwise.
- Prefer stricter and more precise types over broader types.
- Reuse or extend existing local types instead of creating duplicate one-off types.
- Avoid introducing `any`, unsafe double assertions, or blanket suppressions.
- Replace `any` with concrete types or `unknown` plus narrowing.
- Prefer narrowing and type guards over non-null assertions and forced casts.
- Keep inferred types when they are already clear and stable.
- Remove unnecessary casts and non-null assertions where safe.
- Add minimal annotations for function params or returns when clarity or safety improves.
- Align generics, unions, and nullability with real data flow.
- For Lit lifecycle methods that receive changed properties (`shouldUpdate`, `willUpdate`, `update`, `firstUpdated`, `updated`), prefer `changedProperties: PropertyValues<this>` for strict typing.
- For Lit lifecycle methods that need to handle `protected` or `private` changed properties, use `changedProperties: PropertyValues` (without `<this>`) instead of forcing `PropertyValues<this>`.
- Prefer explicit, narrow types.
- Remove unnecessary intermediate variables and one-off aliases when clarity is maintained.
- Inline one-time-use values when clarity is maintained.
- Prefer typing parameters at the signature level when it improves safety or clarity, and rely on inference when types are already clear.
- Avoid casting later at value access points when signature-level typing or narrowing is clearer.
- If project generic helpers exist, prefer concrete generic types over ad-hoc casts and loosely typed objects.
- Prefer top-level annotations and `satisfies` over type assertions when possible.
- Keep control flow simple without changing established logic unless explicitly requested.
- Do not use the non-null assertion operator (`!`) unless it is strictly required and justified by existing project rules.
- Do not add unnecessary comments or abstractions.
