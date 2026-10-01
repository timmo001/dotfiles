import { Effect, Option, Schema } from "effect";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmdirSync,
  unlinkSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { HOME_DIR } from "./paths.js";
import { skillsMaintenanceSource } from "./skillsMaintenance.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { plural } from "./runSummary.js";

/** Skills directory shared by every Agent Skills client. */
export const AGENT_SKILLS_DIR = join(HOME_DIR, ".agents", "skills");

const decodeManifest = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.String),
);

/** External skills recorded by skill-maintenance whose `SKILL.md` is missing. */
export const missingExternalSkills = (skillsDir = AGENT_SKILLS_DIR) => {
  const manifest = join(skillsDir, ".external-skills.json");

  if (!existsSync(manifest)) return [];

  try {
    return Option.match(
      decodeManifest(JSON.parse(readFileSync(manifest, "utf8"))),
      {
        onNone: () => [],
        onSome: (installed) =>
          Object.keys(installed).filter(
            (name) => !existsSync(join(skillsDir, name, "SKILL.md")),
          ),
      },
    );
  } catch {
    return [];
  }
};

const pruneDirectory = (directory: string, sources: readonly string[]) => {
  let removed = 0;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      removed += pruneDirectory(path, sources);
      continue;
    }

    if (!entry.isSymbolicLink() || existsSync(path)) continue;
    const target = resolve(dirname(path), readlinkSync(path));

    if (!sources.some((source) => target.startsWith(`${source}/`))) continue;
    unlinkSync(path);
    removed++;
  }

  if (readdirSync(directory).length === 0) rmdirSync(directory);

  return removed;
};

/**
 * Remove dangling links into the dotfiles sources, and the directories they
 * leave empty, from skills that have been removed or moved upstream.
 *
 * @returns The number of dangling links removed.
 */
export const pruneStaleSkillLinks = (
  sources: readonly string[],
  skillsDir = AGENT_SKILLS_DIR,
) => {
  if (!existsSync(skillsDir)) return 0;
  let removed = 0;

  for (const entry of readdirSync(skillsDir)) {
    const path = join(skillsDir, entry);

    if (lstatSync(path).isDirectory()) removed += pruneDirectory(path, sources);
  }

  return removed;
};

/**
 * Prune stale skill links, then install external skill imports into the
 * shared skills directory with the built skill-maintenance executable.
 * Failures are warnings so stowing still completes offline.
 *
 * @returns Actions taken, for a closing summary.
 */
export const syncExternalSkills = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  const actions: string[] = [];

  yield* log.section("External Skills");

  const pruned = yield* Effect.sync(() =>
    pruneStaleSkillLinks(
      [config.publicDotfiles, config.privateDotfiles].filter(
        (source): source is string => source !== null,
      ),
    ),
  );

  if (pruned > 0) actions.push(`Removed ${plural(pruned, "stale skill link")}`);

  const executable = join(
    config.publicDotfiles,
    "scripts",
    ".local",
    "bin",
    "skill-maintenance",
  );

  if (!existsSync(executable)) {
    yield* log.warn(
      "Skipping external skills (skill-maintenance is not built)",
    );

    return actions;
  }

  const exitCode = yield* executor.inherit(
    executable,
    ["install", "--target", AGENT_SKILLS_DIR],
    { cwd: yield* skillsMaintenanceSource(config.publicDotfiles) },
  );

  if (exitCode === 0) actions.push("Installed external skills");
  else
    yield* log.warn(
      `External skill install exited ${exitCode}; installed skills were kept`,
    );

  return actions;
}).pipe(Effect.withSpan("ExternalSkills.sync"));
