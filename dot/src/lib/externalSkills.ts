import { Effect, FileSystem, Option, Schema } from "effect";
import { dirname, join, resolve } from "path";
import { HOME_DIR } from "./paths.js";
import { skillsMaintenanceSource } from "./skillsMaintenance.js";
import {
  lstatOrNull,
  pathExists,
  readDirectoryOrNull,
  readLinkOrNull,
  readTextOrNull,
} from "./fsProbe.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { plural } from "./runSummary.js";

/** Skills directory shared by every Agent Skills client. */
export const AGENT_SKILLS_DIR = join(HOME_DIR, ".agents", "skills");

const decodeManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

/** External skills recorded by skill-maintenance whose `SKILL.md` is missing. */
export const missingExternalSkills = Effect.fn("ExternalSkills.missing")(
  function* (skillsDir: string = AGENT_SKILLS_DIR) {
    const text = yield* readTextOrNull(
      join(skillsDir, ".external-skills.json"),
    );

    const installed = text === null ? Option.none() : decodeManifest(text);

    if (Option.isNone(installed)) return [];
    const missing: string[] = [];

    for (const name of Object.keys(installed.value))
      if (!(yield* pathExists(join(skillsDir, name, "SKILL.md"))))
        missing.push(name);

    return missing;
  },
);

const pruneDirectory: (
  directory: string,
  sources: readonly string[],
) => Effect.Effect<number, never, FileSystem.FileSystem> = Effect.fn(
  "ExternalSkills.pruneDirectory",
)(function* (directory: string, sources: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  let removed = 0;

  for (const entry of (yield* readDirectoryOrNull(directory)) ?? []) {
    const path = join(directory, entry);
    const info = yield* lstatOrNull(path);

    if (info?.type === "Directory") {
      removed += yield* pruneDirectory(path, sources);
      continue;
    }

    const link = yield* readLinkOrNull(path);

    if (link === null || (yield* pathExists(path))) continue;
    const target = resolve(dirname(path), link);

    if (!sources.some((source) => target.startsWith(`${source}/`))) continue;

    if (
      yield* fs.remove(path).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
    )
      removed++;
  }

  if ((yield* readDirectoryOrNull(directory))?.length === 0)
    yield* fs.remove(directory).pipe(Effect.ignore);

  return removed;
});

/**
 * Remove dangling links into the dotfiles sources, and the directories they
 * leave empty, from skills that have been removed or moved upstream.
 *
 * @returns The number of dangling links removed.
 */
export const pruneStaleSkillLinks = Effect.fn("ExternalSkills.prune")(
  function* (sources: readonly string[], skillsDir: string = AGENT_SKILLS_DIR) {
    let removed = 0;

    for (const entry of (yield* readDirectoryOrNull(skillsDir)) ?? []) {
      const path = join(skillsDir, entry);

      if ((yield* lstatOrNull(path))?.type === "Directory")
        removed += yield* pruneDirectory(path, sources);
    }

    return removed;
  },
);

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

  const pruned = yield* pruneStaleSkillLinks(
    [config.publicDotfiles, config.privateDotfiles].filter(
      (source) => source !== null,
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

  if (!(yield* pathExists(executable))) {
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
