// Writes the site's own amber theme (themes/dotfiles.json) into theme.css,
// between its marker comments: once as the default, once more for the theme
// picker, and its Groundwork tokens for the picker's own controls. Fails on a missed contrast check, so a theme that reads badly
// never ships. Runs before dev, build and check.
import { readFile, writeFile } from 'node:fs/promises';
import {
  blumeThemeCss,
  blumeThemesCss,
  parseTheme,
  runtimeTheme,
} from '@timmo001/groundwork-tokens/runtime';

const start = '/* themes/dotfiles.json, rendered by scripts/theme.ts: start */';
const end = '/* themes/dotfiles.json, rendered by scripts/theme.ts: end */';

const parsed = parseTheme(await readFile('themes/dotfiles.json', 'utf8'));

if ('failure' in parsed) throw new Error(String(parsed.failure));

const { theme, css: tokens, checks } = runtimeTheme(parsed.success);
const misses = checks.filter((check) => !check.passes);

if (misses.length > 0) {
  throw new Error(
    `The dotfiles theme misses its contrast in ${misses.map((miss) => `${miss.mode} ${miss.role}`).join(', ')}`,
  );
}

const css = await readFile('theme.css', 'utf8');
const from = css.indexOf(start);
const to = css.indexOf(end);

if (from === -1 || to < from) throw new Error('theme.css has no markers');

const rendered = `${css.slice(0, from + start.length)}\n${blumeThemeCss(theme)}\n${blumeThemesCss([theme])}\n${tokens}\n${css.slice(to)}`;

if (rendered !== css) await writeFile('theme.css', rendered);
