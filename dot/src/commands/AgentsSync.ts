import { Effect } from "effect";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../lib/paths.js";
import { ENV, envString } from "../lib/env.js";
import { cliStyler } from "../lib/ansi.js";

/** Metadata attached to each sync operation */
interface SyncMetadata {
  readonly source: string;
  readonly timestamp: string;
}

/** Adapter for a single harness target that receives mirrored AGENTS.md content */
interface HarnessTarget {
  readonly name: string;
  readonly outputPath: () => string;
  readonly transform: (content: string, metadata: SyncMetadata) => string;
}

/** Atomic write: mkdir -p, write to temp, rename over destination */
function atomicWrite(dest: string, content: string): void {
  // Remove broken symlinks at dest (rename won't overwrite them on all platforms)
  try {
    const stat = existsSync(dest);

    if (!stat) {
      // lstatSync would tell us if it's a dangling symlink, but
      // the simplest approach: unlink if the path entry exists but is unresolvable
      unlinkSync(dest);
    }
  } catch {
    // No existing file or symlink — nothing to remove
  }

  writeFileAtomic(dest, content, { createDirectory: true });
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

const cursorTarget: HarnessTarget = {
  name: "cursor",
  outputPath: () =>
    envString(ENV.DOT_AGENTS_SYNC_RULE_FILE) ??
    join(HOME_DIR, ".cursor", "rules", "global-agents.mdc"),
  transform: (content, meta) =>
    [
      "---",
      "description: Global agent instructions mirrored from AGENTS.md; refresh with dot agents-sync.",
      "alwaysApply: true",
      "---",
      "",
      `<!-- dot agents-sync: source=${meta.source} synced=${meta.timestamp} -->`,
      "",
      content,
    ].join("\n"),
};

const claudeTarget: HarnessTarget = {
  name: "claude",
  outputPath: () => join(HOME_DIR, ".claude", "CLAUDE.md"),
  transform: (content, meta) =>
    [
      `<!-- dot agents-sync: source=${meta.source} synced=${meta.timestamp} -->`,
      "",
      content,
    ].join("\n"),
};

const targets: readonly HarnessTarget[] = [cursorTarget, claudeTarget];

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Mirror `~/.config/opencode/AGENTS.md` to all registered harness targets.
 *
 * Each target receives a transformed copy written directly to its native
 * instructions path. OpenCode is the single source of truth; all other
 * tools receive plain file copies (no symlinks).
 *
 * Respects environment overrides:
 * - `DOT_AGENTS_SYNC_SOURCE` — path to source AGENTS.md (default: `~/.config/opencode/AGENTS.md`)
 * - `DOT_AGENTS_SYNC_RULE_FILE` — override Cursor output path
 */
export const agentsSync = Effect.gen(function* () {
  yield* Config;
  const log = yield* OutputLog;

  yield* log.section("Agents Rules Sync");

  const source =
    envString(ENV.DOT_AGENTS_SYNC_SOURCE) ??
    join(CONFIG_DIR, "opencode", "AGENTS.md");

  if (!existsSync(source)) {
    yield* log.warn(`Skipped (missing source): ${displayPath(source)}`);

    return;
  }

  const content = readFileSync(source, "utf-8");

  const metadata: SyncMetadata = {
    source: displayPath(source),
    timestamp: new Date().toISOString(),
  };

  for (const target of targets) {
    const dest = target.outputPath();
    const output = target.transform(content, metadata);

    yield* Effect.sync(() => atomicWrite(dest, output));
    yield* log.success(
      `${cliStyler().accent(target.name)} ${cliStyler().dim(displayPath(dest))}`,
    );
  }
});
