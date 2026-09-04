# 🧰 Dotfiles Docs

The [dotfiles](https://github.com/timmo001/dotfiles) documentation site, built with Blume and Astro.

## Site

The site is available at <https://dotfiles.timmo.dev>.

## Project Structure

Content lives in `src/content/docs/` and is exposed as routes based on file names. Two sections are generated and should not be hand-edited:

- `src/content/docs/dot/commands.md` — generated from `dot/src/cli/spec.ts` by `bun run gen:cli`.
- `src/content/docs/agents/opencode/{agents,commands,plugins}.md` — generated from the OpenCode assets by `bun run gen:opencode`. Skills are catalogued in [timmo001/skills `SKILLS.md`](https://github.com/timmo001/skills/blob/main/SKILLS.md#skills-catalogue).

## Commands

All commands run from this `docs/` directory:

- `bun install`
- `bun run dev` (runs the generators first via `predev`)
- `bun run build`
- `bun run check`
- `bun run validate`
- `bun run deploy` (deploy the built site to Cloudflare Workers)
- `bun run deploy:preview` (upload a preview version without promoting it)
- `bun run preview`
- `bun run gen` (regenerate the generated reference pages)
- `bun run og` (regenerate the legacy shared Open Graph image)

## Deployment

The site deploys to Cloudflare Workers with Blume's Astro server bundle. Server output provides the hosted read-only MCP endpoint and Markdown content negotiation; Ask AI is disabled and no model binding or API key is required. Workers Builds uses:

- Root directory: `docs`
- Production branch: `distro/arch-omarchy`
- Build command: `bun run build`
- Deploy command: `bun run deploy`
- Non-production deploy command: `bun run deploy:preview`

`wrangler.jsonc` owns the Worker name, compatibility settings, custom domain, and observability. Blume passes it to the Astro Cloudflare adapter, which writes the deployable configuration to `dist/server/wrangler.json`; the deploy scripts use that generated configuration.
