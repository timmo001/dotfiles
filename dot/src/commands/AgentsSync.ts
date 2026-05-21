import { Effect } from "effect";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "fs";
import { dirname } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";

const HOME = process.env.HOME ?? "/home/" + process.env.USER;

/**
 * Mirror `~/.config/opencode/AGENTS.md` into a Cursor `.mdc` rule file.
 *
 * Respects environment overrides:
 * - `DOT_AGENTS_SYNC_SOURCE` — path to AGENTS.md (default: `~/.config/opencode/AGENTS.md`)
 * - `DOT_AGENTS_SYNC_RULE_FILE` — explicit output path override
 *
 * Output location priority:
 * 1. `DOT_AGENTS_SYNC_RULE_FILE` env var
 * 2. `$PRIVATE_DOTFILES/agents/.cursor/rules/global-agents.mdc` (if private available)
 * 3. `~/.cursor/rules/global-agents.mdc` (fallback)
 */
export const agentsSync = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;

  yield* log.section("Agents Rules Sync");

  const source =
    process.env.DOT_AGENTS_SYNC_SOURCE ?? `${HOME}/.config/opencode/AGENTS.md`;

  if (!existsSync(source)) {
    yield* log.warn(`Skipped (missing source): ${displayPath(source)}`);
    return;
  }

  const content = readFileSync(source, "utf-8");
  const resolvedSource = displayPath(source);

  // Determine destination
  const dest = resolveDestination(config);
  const ruleDir = dirname(dest);

  // Build .mdc content with frontmatter
  const timestamp = new Date().toISOString();
  const mdc = [
    "---",
    "description: Global agent instructions mirrored from AGENTS.md; refresh with dot agents-sync.",
    "alwaysApply: true",
    "---",
    "",
    `<!-- dot agents-sync: source=${resolvedSource} synced=${timestamp} -->`,
    "",
    content,
  ].join("\n");

  // Atomic write: temp file then rename
  yield* Effect.sync(() => {
    mkdirSync(ruleDir, { recursive: true });
    const tmp = `${dest}.tmp.${process.pid}`;
    writeFileSync(tmp, mdc, "utf-8");
    renameSync(tmp, dest);
  });

  yield* log.info(`Wrote Cursor rule: ${displayPath(dest)}`);
});

/** Resolve the destination path for the .mdc rule file */
function resolveDestination(config: {
  readonly canUsePrivate: boolean;
  readonly privateDotfiles: string | null;
}): string {
  const envDest = process.env.DOT_AGENTS_SYNC_RULE_FILE;
  if (envDest) return envDest;

  if (config.canUsePrivate && config.privateDotfiles) {
    return `${config.privateDotfiles}/agents/.cursor/rules/global-agents.mdc`;
  }

  return `${HOME}/.cursor/rules/global-agents.mdc`;
}

/** Replace $HOME prefix with ~ for display */
function displayPath(p: string): string {
  return p.replace(HOME, "~");
}
