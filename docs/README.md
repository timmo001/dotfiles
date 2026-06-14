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
- `bun run preview`
- `bun run gen` (regenerate the generated reference pages)
- `bun run og` (regenerate the Open Graph image)

## Deployment

The site deploys to Vercel with the project **Root Directory** set to `docs/`. Astro is auto-detected (install `bun install`, build `bun run build`, output `dist`). Production branch: `distro/arch-omarchy`. No adapter or `vercel.json` is needed.
