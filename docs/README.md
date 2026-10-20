# Dotfiles Docs

The [dotfiles](https://github.com/timmo001/dotfiles) documentation site, built with Blume and Astro.

## Site

The site is available at <https://ubuntu-server.dotfiles.timmo.dev>. The desktop build publishes its own copy at <https://dotfiles.timmo.dev>.

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
- `bun run preview`
- `bun run gen` (regenerate the generated reference pages)
- `bun run og` (regenerate the legacy shared Open Graph image)

## Deployment

The site deploys to Cloudflare Workers with Blume's Astro server bundle. Server output provides the hosted read-only MCP endpoint and Markdown content negotiation; Ask AI is disabled and no model binding or API key is required.

`alchemy.run.ts` is the Alchemy stack: one Worker per distro branch, picked by stage, built from what Blume writes to `dist/server/`. The Deploy docs workflow runs `mise run docs:deploy` on pushes to each distro branch with that branch's stage. Run `mise run docs:plan` (with `ALCHEMY_STAGE` for a stage other than `prod`) to see what a deploy would change.
