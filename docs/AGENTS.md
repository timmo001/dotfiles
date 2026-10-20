# Docs Agent Guide

This directory is the Blume + Astro documentation site for the dotfiles repo, deployed to `dotfiles.timmo.dev`. Keep changes small and aligned with existing patterns.

## Toolchain

- Use **bun** for dependencies (`bun install`). Run dev tasks via mise from the repo root: `mise run docs:dev`, `mise run docs:build`, `mise run docs:preview`, `mise run docs:gen`. Each task sets `dir = "docs"` and wraps the matching `bun run` script in `package.json`, so `bun run dev` / `bun run build` still work. Cloudflare Workers Builds runs `bun run build`, then `bun run deploy`.
- Node + bun versions and the dev tasks are defined in the single root `mise.toml` (tasks namespaced `docs:*`). Workers Builds uses the committed `bun.lock` and pinned Wrangler dependency.

## Background Dev Servers

- Start the dev server with `mise run serve:docs`, which runs `blume dev` through Pitchfork in the background and restarts it if it exits or stops responding. Do not run `mise run docs:dev` or `blume dev` in the foreground from an agent; Blume does not detach on its own. Manage it with `serve:docs:status`, `serve:docs:logs`, `serve:docs:restart` and `serve:docs:stop`. Do not edit the generated `.blume/` runtime.
- The daemon is configured in the root `pitchfork.toml`. It serves `http://127.0.0.1:7790/`, or the next free port, and is always at `https://docs.dotfiles.localhost` through the Pitchfork proxy.
- Test through that HTTPS address, in the browser, with curl and anywhere else. Never add the proxy's own port, such as `:8443`, even if Pitchfork prints one: that means the 443 redirect is missing (it's lost on reboot), so run `pitchfork proxy doctor`, then `pitchfork proxy setup -y` to restore it. Use the `127.0.0.1` port only when the proxy isn't running.

## Layout

- Content: `src/content/docs/` (Markdown/MDX with YAML frontmatter; file names map to routes). Top-level pages for the main sections; `dot/`, `desktop/`, and `agents/` hold section pages (`agents/opencode/` for OpenCode, other harnesses directly under `agents/`). Generated catalogues live under `dot/commands.md` and `agents/opencode/{agents,commands,plugins}.md`.
- Sidebar order is set explicitly in `blume.config.ts` (`navigation.sidebar`).
- Branding: `src/assets/logo.svg` is the source logo; `public/favicon.svg`, `public/logo-light.svg` and `public/logo-dark.svg` are copies of it. Overview illustrations live in `public/illustrations/`.
- Shared parts come from [`@timmo001/docs-kit`](https://github.com/timmo001/docs-kit): `components.ts` wires its home banner and header GitHub link, and `theme.css` imports its layout styles (wider content column, "On this page" next to the content). Put site-specific style overrides after that import.
- Site, navigation, theme, and SEO config: `blume.config.ts`, built with docs-kit's `docsConfig`, which supplies the shared defaults (logos, agent surfaces, Cloudflare deployment, share cards).
- Generated runtime: `.blume/` (ignored; never edit it directly).

## Distro Sites

Each `distro/*` branch publishes its own copy of this site to its own Cloudflare Worker, so every site describes only what its branch ships. The header **Distro** switcher and the `/distros` page link them together.

- `distros.ts` lists every distro (ID, label, branch, host name). It lives on the default branch and merges into the others; never edit it only on a distro branch.
- `current-distro.ts` names this branch's entry. `blume.config.ts` reads it for `site`, `github.branch` and the switcher. The default branch never changes this file, so merges keep each distro branch's value.
- `wrangler.jsonc` holds this branch's Worker `name` and custom-domain route. Each distro branch sets its own; the default branch keeps `dotfiles-docs` on `dotfiles.timmo.dev`.

To add a distro:

1. On the default branch, add its entry to `distros.ts` and a row to `src/content/docs/distros.mdx`, then merge into the other distro branches.
2. On the distro branch, set `current-distro.ts` to the new ID and give `wrangler.jsonc` a new Worker name (`dotfiles-docs-<id>`) and route (`<id>.dotfiles.timmo.dev`). Trim the sidebar and pages to what the branch ships.
3. In Cloudflare, create a Workers Builds project for that Worker with the distro branch as its production branch, the `docs` root directory, and the same build and deploy commands as the main site.

## Generated Content

Two areas are generated from the single source of truth in the repo:

- `src/content/docs/dot/commands.md` ← `dot/src/cli/spec.ts` via `mise run docs:gen:cli` (wraps `bun run gen:cli`).
- `src/content/docs/agents/opencode/{agents,commands,plugins}.md` ← `agents/.config/opencode/**` via `mise run docs:gen:opencode` (wraps `bun run gen:opencode`). Skills are catalogued in [timmo001/skills `SKILLS.md`](https://github.com/timmo001/skills/blob/main/SKILLS.md#skills-catalogue), not generated here.

Regenerate the affected catalogue from its source and include the output in the changeset; never hand-edit it. `mise run docs:gen` regenerates both. `docs:dev` also regenerates them, while production builds consume committed output. CI checks catalogue drift and builds the site.

`mise run docs:og` (wraps `bun run og`) renders the raster branding from `src/assets/logo.svg` with docs-kit's `writeBrandImages`: the Open Graph image `public/og.png`, the search engine logo `public/logo.png`, `public/apple-touch-icon.png`, and the GitHub social preview `.github/social-preview.png` (upload it by hand under the repository's **Settings > Social preview**). Regenerate them only when the branding or tagline changes.

## Authoring

- Use YAML frontmatter with `title` and `description`.
- File names are kebab-case and map to routes; internal links are root-relative.
- Use Blume callouts (`:::note`, `:::tip`, `:::caution`) in MDX files and language tags on code fences.
- Blume components such as `Card`, `CardGroup`, `Tabs`, `Tab`, and `FileTree` are globally available in MDX without imports.
- Run `bun run validate` for links and assets and `bun run build` for the production output.

## AI surfaces

- Blume generates `llms.txt`, `llms-full.txt`, raw `.md` mirrors, WebMCP, and `agent-readability.json`.
- The hosted read-only MCP server is enabled at `/mcp`, which requires Cloudflare server output.
- Ask AI is intentionally disabled, so the site has no model provider, model API key, or paid AI binding.
- `wrangler.jsonc` is adapter input. Blume emits the deployable Worker config at `dist/server/wrangler.json`, and deploy scripts target that file.

## Source of truth

This site is a short what-and-why reference for the dotfiles repo. The top-level `README.md` links here rather than duplicating content. Follow the Documentation section in the repo-root `AGENTS.md`: default is no hand-written update for ordinary behaviour changes.
