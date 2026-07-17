# 🧰 Dotfiles Docs

The [dotfiles](https://github.com/timmo001/dotfiles) documentation site, built with Astro and Starlight.

## Site

The site is available at <https://dotfiles.timmo.dev>.

## Project Structure

Content lives in `src/content/docs/` and is exposed as routes based on file names. Two sections are generated and should not be hand-edited:

- `src/content/docs/dot/commands.md` — generated from `dot/src/cli/spec.ts` by `bun run gen:cli`.
- `src/content/docs/reference/{agents,commands,skills,plugins}.md` — generated from the OpenCode assets by `bun run gen:opencode`.

## Commands

All commands run from this `docs/` directory:

- `bun install`
- `bun run dev` (runs the generators first via `predev`)
- `bun run build`
- `bun run deploy` (deploy the built site to Cloudflare Workers)
- `bun run deploy:preview` (upload a preview version without promoting it)
- `bun run preview`
- `bun run gen` (regenerate the generated reference pages)
- `bun run og` (regenerate the Open Graph image)

## Deployment

The site deploys to Cloudflare Workers as static assets. Workers Builds uses:

- Root directory: `docs`
- Production branch: `distro/arch-omarchy`
- Build command: `bun run build`
- Deploy command: `bun run deploy`
- Non-production deploy command: `bun run deploy:preview`

`wrangler.jsonc` owns the Worker name, compatibility date, asset directory, and 404 behaviour. The site is fully static, so it does not use an Astro adapter or invoke Worker code for page requests.
