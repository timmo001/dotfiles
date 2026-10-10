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

const decodeMarketplace = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      plugins: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          source: Schema.Union([
            Schema.String,
            Schema.Struct({ sha: Schema.optionalKey(Schema.String) }),
          ]),
          metadata: Schema.optionalKey(
            Schema.Struct({ skill: Schema.optionalKey(Schema.String) }),
          ),
        }),
      ),
    }),
  ),
);

const decodeListing = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        id: Schema.optionalKey(Schema.String),
        version: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
);

/**
 * Names or ids from a `claude plugin ... list --json` listing, each mapped to
 * its version (empty when the listing has none).
 */
const listNames = Effect.fn("Skills.listClaudeNames")(function* (
  args: readonly string[],
  key: "name" | "id",
) {
  const executor = yield* CommandExecutor;
  const output = yield* executor.run("claude", [...args, "--json"]);

  return new Map(
    Option.getOrElse(decodeListing(output), () => []).flatMap((entry) => {
      const value = entry[key];

      return value === undefined ? [] : [[value, entry.version ?? ""] as const];
    }),
  );
});

/** A marketplace plugin, from a path inside the marketplace or a remote source. */
interface MarketplacePlugin {
  /** Plugin name. */
  readonly name: string;
  /** Source path relative to the marketplace root, or `null` when remote. */
  readonly localPath: string | null;
  /** Skill a remote plugin provides: `metadata.skill`, else the plugin name. */
  readonly skill: string;
  /**
   * Version prefix Claude Code gives a remote plugin pinned to a commit (the
   * first 12 characters of its SHA), or `null` when it is not pinned.
   */
  readonly pin: string | null;
}

const isLocalSource = Schema.is(Schema.String);

/** Parse a `marketplace.json`, keeping each plugin's local path when it has one. */
const readMarketplace = (text: string) =>
  Option.map(decodeMarketplace(text), ({ name, plugins }) => ({
    name,
    plugins: plugins.map((plugin): MarketplacePlugin => ({
      name: plugin.name,
      localPath: isLocalSource(plugin.source) ? plugin.source : null,
      skill: plugin.metadata?.skill ?? plugin.name,
      pin: isLocalSource(plugin.source)
        ? null
        : (plugin.source.sha?.slice(0, 12) ?? null),
    })),
  }));

/**
 * Skills one plugin provides: each `SKILL.md` folder under a local source, or
 * the named skill of a remote single-skill source.
 */
const pluginSkills = Effect.fn("Skills.pluginSkills")(function* (
  root: string,
  plugin: MarketplacePlugin,
) {
  if (plugin.localPath === null) return [plugin.skill];
  const directory = resolve(root, plugin.localPath);
  const skills: string[] = [];

  for (const entry of (yield* readDirectoryOrNull(directory)) ?? [])
    if (yield* pathExists(join(directory, entry, "SKILL.md")))
      skills.push(entry);

  return skills;
});

/**
 * Register each local Claude plugin marketplace, install its missing plugins,
 * and update pinned ones whose commit changed. A plugin that fails to install
 * is left uncovered so its skills keep their `~/.claude/skills` links.
 *
 * @returns Skill names now provided by plugins, and the number of changes.
 */
const syncClaudePlugins = Effect.fn("Skills.syncClaudePlugins")(function* (
  roots: readonly string[],
) {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  const [registered, installed] = yield* log.withSpinner(
    "Reading Claude Code plugins",
    Effect.all([
      listNames(["plugin", "marketplace", "list"], "name"),
      listNames(["plugin", "list"], "id"),
    ]),
  );

  // Each step shows a spinner, then a timed line; a failure logs its stderr.
  const claude = (label: string, args: readonly string[]) =>
    log.withSpinner(label, executor.run("claude", args)).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        log
          .warn(`${label} failed: ${error.stderr || `exit ${error.exitCode}`}`)
          .pipe(Effect.as(false)),
      ),
    );

  const covered = new Set<string>();
  let changed = 0;

  for (const root of roots) {
    const text = yield* readTextOrNull(
      join(root, ".claude-plugin", "marketplace.json"),
    );

    if (text === null) continue;
    const marketplace = readMarketplace(text);

    if (Option.isNone(marketplace)) {
      yield* log.warn(
        `Skipping unreadable marketplace in ${displayPath(root)}`,
      );
      continue;
    }

    const { name, plugins } = marketplace.value;

    // A local directory marketplace is read in place, so it never needs a refresh.
    if (!registered.has(name)) {
      if (
        !(yield* claude(`Adding marketplace ${name}`, [
          "plugin",
          "marketplace",
          "add",
          root,
        ]))
      )
        continue;

      changed++;
    }

    let current = 0;

    for (const plugin of plugins) {
      const id = `${plugin.name}@${name}`;
      const version = installed.get(id);

      // Local plugins load in place; pinned ones only change with their pin.
      const upToDate =
        version !== undefined &&
        (plugin.pin === null || version.startsWith(plugin.pin));

      if (upToDate) {
        current++;
      } else {
        const action = version === undefined ? "install" : "update";

        if (
          !(yield* claude(
            `${version === undefined ? "Installing" : "Updating"} ${id}`,
            ["plugin", action, id],
          ))
        )
          continue;

        changed++;
      }

      for (const skill of yield* pluginSkills(root, plugin)) covered.add(skill);
    }

    if (current > 0)
      yield* log.info(
        `${plural(current, "plugin")} from ${name} already up to date`,
      );
  }

  return { covered, changed };
});

/**
 * Link skills that no Claude plugin provides into Claude Code's skills
 * directory, one directory link per skill. Links back into the shared
 * directory that are dangling, or now provided by a plugin, are removed;
 * anything else, such as stowed or tool-installed Claude skills, is left alone.
 *
 * @returns The number of links created and removed.
 */
const linkClaudeSkills = Effect.fn("Skills.linkClaude")(function* (
  covered: ReadonlySet<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  let linked = 0;
  let removed = 0;

  for (const entry of (yield* readDirectoryOrNull(CLAUDE_SKILLS_DIR)) ?? []) {
    const path = join(CLAUDE_SKILLS_DIR, entry);
    const link = yield* readLinkOrNull(path);

    if (link === null) continue;
    const target = resolve(CLAUDE_SKILLS_DIR, link);

    if (dirname(target) !== AGENT_SKILLS_DIR) continue;

    if (
      (yield* pathExists(path)) &&
      !covered.has(target.slice(AGENT_SKILLS_DIR.length + 1))
    )
      continue;

    yield* fs.remove(path);
    removed++;
  }

  for (const name of (yield* readDirectoryOrNull(AGENT_SKILLS_DIR)) ?? []) {
    const source = join(AGENT_SKILLS_DIR, name);
    const target = join(CLAUDE_SKILLS_DIR, name);

    if (covered.has(name)) continue;

    if (!(yield* pathExists(join(source, "SKILL.md")))) continue;

    if ((yield* lstatOrNull(target)) !== null) continue;

    yield* fs.makeDirectory(CLAUDE_SKILLS_DIR, { recursive: true });
    yield* fs.symlink(source, target);
    linked++;
  }

  return { linked, removed };
});

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
 * checkout, install the Claude Code plugins those sources publish, then link
 * the remaining skills into Claude Code's skills directory.
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

  yield* log.section("Claude Code Plugins");

  const plugins = yield* syncClaudePlugins([
    SKILLS_CHECKOUT,
    config.publicDotfiles,
  ]).pipe(
    Effect.catch((error) =>
      log
        .warn(`Could not sync Claude Code plugins: ${error.message}`)
        .pipe(Effect.as(null)),
    ),
  );

  if (plugins === null) {
    actions.push(warn("Claude Code plugins skipped"));
  } else if (plugins.changed > 0) {
    actions.push(
      notable(
        `Installed or updated ${plural(plugins.changed, "Claude Code plugin")}`,
      ),
    );
  } else {
    actions.push(skip("Claude Code plugins already installed"));
  }

  const claude = yield* linkClaudeSkills(plugins?.covered ?? new Set()).pipe(
    Effect.catch((error) =>
      log
        .warn(`Could not link Claude Code skills: ${error.message}`)
        .pipe(Effect.as(null)),
    ),
  );

  if (claude === null) {
    actions.push(warn("Claude Code skill links skipped"));
  } else if (claude.linked + claude.removed > 0) {
    yield* log.success(
      `Linked ${plural(claude.linked, "Claude Code skill")}, removed ${plural(claude.removed, "link")} now provided by plugins`,
    );
    actions.push(
      notable(
        `Linked ${plural(claude.linked, "Claude Code skill")}, removed ${plural(claude.removed, "link")}`,
      ),
    );
  } else {
    yield* log.info("Claude Code skills are up to date");
    actions.push(skip("Claude Code skills already linked"));
  }

  return actions;
}).pipe(Effect.withSpan("Skills.sync"));
