import { Effect, FileSystem, Option, Schema } from "effect";
import { dirname, join, resolve } from "path";
import { displayPath, HOME_DIR } from "./paths.js";
import { ensureSkillsCheckout, SKILLS_CHECKOUT } from "./skillsMaintenance.js";
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
import { notable, skip, warn } from "./updateSummary.js";
import type { RecapEntry } from "./updateSummary.js";

/** Skills directory shared by every Agent Skills client. */
export const AGENT_SKILLS_DIR = join(HOME_DIR, ".agents", "skills");

/** User skills directory Claude Code reads instead of the shared one. */
const CLAUDE_SKILLS_DIR = join(HOME_DIR, ".claude", "skills");

const decodeManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

const readManifest = Effect.fn("ExternalSkills.readManifest")(function* (
  skillsDir: string,
) {
  const text = yield* readTextOrNull(join(skillsDir, ".external-skills.json"));

  return text === null ? Option.none() : decodeManifest(text);
});

/** External skills recorded by skill-maintenance whose `SKILL.md` is missing. */
export const missingExternalSkills = Effect.fn("ExternalSkills.missing")(
  function* (skillsDir: string = AGENT_SKILLS_DIR) {
    const installed = yield* readManifest(skillsDir);

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
    yield* fs.remove(directory, { recursive: true }).pipe(Effect.ignore);

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
 * Link one authored skill's files into the shared skills directory, file by
 * file so stowed private additions can share its directories. Links into the
 * retired dotfiles submodule are replaced; anything else is left alone.
 *
 * @returns Whether any link was created or replaced, and paths left alone.
 */
const linkSkill = Effect.fn("Skills.linkSkill")(function* (
  name: string,
  retiredSource: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const source = join(SKILLS_CHECKOUT, name);
  const conflicts: string[] = [];
  let linked = false;

  const files = yield* fs
    .readDirectory(source, { recursive: true })
    .pipe(Effect.orElseSucceed((): string[] => []));

  for (const file of files) {
    if ((yield* lstatOrNull(join(source, file)))?.type !== "File") continue;

    const from = join(source, file);
    const target = join(AGENT_SKILLS_DIR, name, file);
    const existing = yield* lstatOrNull(target);

    if (existing !== null) {
      const link = yield* readLinkOrNull(target);

      if (link === null) {
        conflicts.push(target);
        continue;
      }

      const resolved = resolve(dirname(target), link);

      if (resolved === from) continue;

      if (
        !resolved.startsWith(`${retiredSource}/`) &&
        (yield* pathExists(target))
      ) {
        conflicts.push(target);
        continue;
      }

      yield* fs.remove(target);
    }

    yield* fs.makeDirectory(dirname(target), { recursive: true });
    yield* fs.symlink(from, target);
    linked = true;
  }

  return { linked, conflicts };
});

/**
 * Link every authored skill from the managed skills checkout.
 *
 * @returns The number of skills whose links changed.
 */
const linkAuthoredSkills = Effect.fn("Skills.linkAuthored")(function* (
  publicDotfiles: string,
) {
  const log = yield* OutputLog;
  const retiredSource = join(publicDotfiles, "agents", ".agents", "skills");
  let changed = 0;

  for (const name of (yield* readDirectoryOrNull(SKILLS_CHECKOUT)) ?? []) {
    if (!(yield* pathExists(join(SKILLS_CHECKOUT, name, "SKILL.md")))) continue;

    const { linked, conflicts } = yield* linkSkill(name, retiredSource).pipe(
      Effect.catch((error) =>
        log
          .warn(`Could not link skill ${name}: ${error.message}`)
          .pipe(Effect.as({ linked: false, conflicts: [] })),
      ),
    );

    for (const conflict of conflicts)
      yield* log.warn(
        `Left ${displayPath(conflict)} in place (not a skill link)`,
      );

    if (linked) changed++;
  }

  return changed;
});

/**
 * Mirror the shared skills directory into Claude Code's skills directory with
 * one directory link per skill. Existing entries, such as stowed or
 * tool-installed Claude skills, are left alone. Dangling links back into the
 * shared directory are removed.
 *
 * @returns The number of links created and removed.
 */
const linkClaudeSkills = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  let linked = 0;
  let removed = 0;

  for (const entry of (yield* readDirectoryOrNull(CLAUDE_SKILLS_DIR)) ?? []) {
    const path = join(CLAUDE_SKILLS_DIR, entry);
    const link = yield* readLinkOrNull(path);

    if (link === null || (yield* pathExists(path))) continue;

    if (dirname(resolve(CLAUDE_SKILLS_DIR, link)) !== AGENT_SKILLS_DIR)
      continue;

    yield* fs.remove(path);
    removed++;
  }

  for (const name of (yield* readDirectoryOrNull(AGENT_SKILLS_DIR)) ?? []) {
    const source = join(AGENT_SKILLS_DIR, name);
    const target = join(CLAUDE_SKILLS_DIR, name);

    if (!(yield* pathExists(join(source, "SKILL.md")))) continue;

    if ((yield* lstatOrNull(target)) !== null) continue;

    yield* fs.makeDirectory(CLAUDE_SKILLS_DIR, { recursive: true });
    yield* fs.symlink(source, target);
    linked++;
  }

  return { linked, removed };
}).pipe(Effect.withSpan("Skills.linkClaude"));

const installExternalSkills = Effect.fn("ExternalSkills.install")(function* (
  publicDotfiles: string,
) {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  const executable = join(
    publicDotfiles,
    "scripts",
    ".local",
    "bin",
    "skill-maintenance",
  );

  if (!(yield* pathExists(executable))) {
    yield* log.warn(
      "Skipping external skills (skill-maintenance is not built)",
    );

    return warn("External skills skipped (skill-maintenance is not built)");
  }

  const before = yield* readManifest(AGENT_SKILLS_DIR);

  const exitCode = yield* executor.inherit(
    executable,
    ["install", "--target", AGENT_SKILLS_DIR],
    { cwd: SKILLS_CHECKOUT },
  );

  if (exitCode !== 0) {
    yield* log.warn(
      `External skill install exited ${exitCode}; installed skills were kept`,
    );

    return warn(
      `External skill install exited ${exitCode}; installed skills were kept`,
    );
  }

  const previous: Record<string, string> = Option.getOrElse(before, () => ({}));

  const current: Record<string, string> = Option.getOrElse(
    yield* readManifest(AGENT_SKILLS_DIR),
    () => ({}),
  );

  const changed = new Set(
    [...Object.keys(previous), ...Object.keys(current)].filter(
      (name) => previous[name] !== current[name],
    ),
  ).size;

  if (changed > 0)
    return notable(`Updated ${plural(changed, "external skill")}`);

  yield* log.info("External skills are up to date");

  return skip("External skills already up to date");
});

/**
 * Prune stale skill links, install external skill imports with the built
 * skill-maintenance executable, link authored skills from the managed skills
 * checkout, then mirror the result into Claude Code's skills directory.
 * Failures are warnings so stowing still completes offline.
 *
 * @returns Actions taken or skipped in order, for a closing summary.
 */
export const syncSkills = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;
  const actions: RecapEntry[] = [];

  yield* log.section("Skills");

  const pruned = yield* pruneStaleSkillLinks(
    [config.publicDotfiles, config.privateDotfiles, SKILLS_CHECKOUT].filter(
      (source) => source !== null,
    ),
  );

  if (pruned > 0)
    actions.push(notable(`Removed ${plural(pruned, "stale skill link")}`));

  const cloned = yield* ensureSkillsCheckout.pipe(
    Effect.catch((error) =>
      log
        .warn(`Could not clone the skills checkout: ${error.message}`)
        .pipe(Effect.as(null)),
    ),
  );

  if (cloned === null) {
    actions.push(warn("Skills sync skipped (could not clone the checkout)"));

    return actions;
  }

  if (cloned)
    actions.push(notable(`Cloned skills to ${displayPath(SKILLS_CHECKOUT)}`));

  actions.push(yield* installExternalSkills(config.publicDotfiles));

  const linked = yield* linkAuthoredSkills(config.publicDotfiles);

  if (linked > 0) {
    actions.push(notable(`Linked ${plural(linked, "authored skill")}`));
  } else {
    yield* log.info("Authored skills are up to date");
    actions.push(skip("Authored skills already linked"));
  }

  const claude = yield* linkClaudeSkills.pipe(
    Effect.catch((error) =>
      log
        .warn(`Could not link Claude Code skills: ${error.message}`)
        .pipe(Effect.as(null)),
    ),
  );

  if (claude === null) {
    actions.push(warn("Claude Code skill links skipped"));
  } else if (claude.linked + claude.removed > 0) {
    actions.push(
      notable(
        `Linked ${plural(claude.linked, "Claude Code skill")}, removed ${plural(claude.removed, "stale link")}`,
      ),
    );
  } else {
    yield* log.info("Claude Code skills are up to date");
    actions.push(skip("Claude Code skills already linked"));
  }

  return actions;
}).pipe(Effect.withSpan("Skills.sync"));
