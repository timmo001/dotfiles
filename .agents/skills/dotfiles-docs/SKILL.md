---
name: dotfiles-docs
description: Author and maintain the Blume docs site (docs/, dotfiles.timmo.dev) in this public dotfiles repo. Use when editing, writing, updating, reviewing, or pruning hand-written docs pages, blume.config.ts navigation, README docs links, or docs/AGENTS.md; when deciding whether a behaviour change needs a docs edit; or when documenting Omarchy, Hyprland, Herdr, Ghostty, OpenCode, or other local customisations without rewriting upstream manuals.
---

# Dotfiles docs

Repo-local contract for `docs/` (Blume site at `dotfiles.timmo.dev`). Reinforces the Documentation section in repo-root `AGENTS.md`; does not replace `docs/AGENTS.md` toolchain notes.

Load this whenever the work touches hand-written documentation in this repository. Pair with `maintain-docs` / `/update-docs` when catching docs up to code; this skill owns the local density and privacy rules those flows must follow here.

## Purpose

Short personal reference: what each major part of **these** dotfiles is, and why it exists. Not a product manual, install guide for others, or catalogue of every binding, flag, quirk, or script.

## When to edit

1. **Default: no hand-written update.** Ordinary behaviour changes do not need a page edit.
2. **Update a hand-written page only when a whole section's purpose changes** (major area added, removed, or renamed), not when an implementation detail changes.
3. **Do not add a page** for every new script, binding, layout, app, or one-off tool.
4. **Bare pages:** fill with unique local customisations when a section would otherwise be empty, without expanding into keybindings, close-first rules, edge cases, or runbooks that already live in source or `--help`.
5. **Done when:** the page states what-and-why for this setup, links upstream for product behaviour, and stays short.

## Upstream vs local

- Do **not** rewrite upstream product manuals (Herdr, Hyprland, Ghostty, Omarchy, OpenCode, Quickshell, etc.).
- Link to official docs for product behaviour; document only local customisations, package layout, and how this repo wires them.
- Name external applications with an upstream link that opens in a new tab. Blume markdown often will not emit `target="_blank"`; use an HTML anchor:

  ```html
  <a href="https://example.com" target="_blank" rel="noopener noreferrer">Name</a>
  ```

## Private overlay

- Do **not** document private overlay apps, plugins, or config by name or personal detail.
- Broad wording only (for example: "a private overlay can add or override plugins").
- Exception: plain display output names (`HDMI-A-2`, `eDP-1`, `DP-1`) are fine.

## Generated catalogues

- Stay generated; never hand-edit:
  - `docs/src/content/docs/dot/commands.md` ← `dot/src/cli/spec.ts` (CLI reference; sidebar nest under **dot**, not OpenCode)
  - `docs/src/content/docs/agents/opencode/{agents,commands,plugins}.md` ← OpenCode assets (paths under `/agents/opencode/`; sidebar nest under top-level **OpenCode** with `display: "group"`, Pi/Cursor as top-level siblings)
- Shared skills are catalogued in <a href="https://github.com/timmo001/skills/blob/main/SKILLS.md#skills-catalogue" target="_blank" rel="noopener noreferrer">timmo001/skills</a> (`SKILLS.md`). Document them on `/agents/skills` (link the catalogue, then list repo-local `.agents/skills/` only). Do not ship or regenerate `reference/skills`.
- After that link, optionally list **repo-local** skills under `.agents/skills/` only (name + short role from each `SKILL.md` description). Do not catalogue the skills submodule or `dotfiles-skills/` there.
- After OpenCode or `dot` sources change: `mise run docs:gen` and commit the result.
- Keep `blume.config.ts`, site Overview, `agents/overview.mdx`, `agents/skills.mdx`, `agents/opencode/overview.mdx`, and README docs-map aligned: **paths** under `/agents/overview`, `/agents/skills`, `/agents/opencode/*`, `/agents/{pi,cursor}`; **sidebar** is **Agents** (flat Overview/Skills), **OpenCode** (`display: "group"`), then top-level **Pi** and **Cursor** (no Other agents wrapper). Machine-readable docs URLs live on the site Overview; `dot/commands` sits with `dot`. Sidebar labels: `/agents/overview` → **Overview**, `/agents/skills` → **Skills**, `/agents/opencode/overview` → **Overview**, `/agents/opencode/agents` → **Agents** (via generated page title). Desktop pages live under `/desktop/*`.
- Cursor has **no** generated command catalogue in this repo; do not invent one on Cursor pages.
- `README.md` stays a slim pointer to the docs site.

## Voice and shape

- Prefer short sections with a blurb and/or a table.
- Spell out opaque jargon and abbreviations (for example write "mouse acceleration profile", not a bare acronym readers must decode).
- Prefer UK spelling in human-written docs prose; keep upstream product names unchanged.
- Include a personal-setup caution where install or cloning is discussed: this repo is for reference; wholesale installation on other machines is not recommended.

## Omarchy plugins (docs only)

When documenting third-party Omarchy bar plugins:

- Import via `omarchy plugin add` (backed by `dot omarchy-plugin`); they land as submodules under `omarchy/.config/omarchy/plugins/`.
- Placement and config live in `omarchy-plugins.json`.
- A private overlay may extend that layout; say so broadly, without naming private plugins.

For shell/QML implementation work, use `omarchy-shell-quickshell` instead of this skill.

## Verify

After hand-written docs edits that should ship: `mise run docs:check` (or the narrower validate/build tasks in `docs/AGENTS.md`). Report drift on generated pages rather than patching them by hand.
