import { Effect, FileSystem, Schema } from "effect";
import { basename, join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import type { DiffRepo } from "../types.js";
import { omarchyPluginSubmodules } from "./omarchyPluginDeployment.js";
import { CONFIG_DIR } from "./paths.js";
import { listStowFolders, requiresNoFolding } from "./stowFolders.js";

const HerdrPlugins = Schema.Array(
  Schema.Struct({
    source: Schema.Struct({
      kind: Schema.String,
      owner: Schema.optionalKey(Schema.String),
      repo: Schema.optionalKey(Schema.String),
      resolved_commit: Schema.optionalKey(Schema.String),
    }),
  }),
);

class UpdateMaintenanceError extends Schema.TaggedError<UpdateMaintenanceError>()(
  "UpdateMaintenanceError",
  { message: Schema.String },
) {}

/** Ignore active work, while allowing clean submodules awaiting a pinned commit. */
export const hasLocalUpdateWork = Effect.fn("Update.hasLocalWork")(function* (
  repo: DiffRepo,
) {
  if (repo.ahead > 0) return true;

  if (!repo.isDirty) return false;

  const executor = yield* CommandExecutor;

  const status = yield* executor.run(
    "git",
    [
      "status",
      "--porcelain=v2",
      "--untracked-files=normal",
      "--ignore-submodules=none",
    ],
    { cwd: repo.path },
  );

  return status
    .split("\n")
    .some((line) => line !== "" && !line.startsWith("1 .M SC.. "));
});

/** Path fields before the path in each `git status --porcelain=v2` entry kind. */
const STATUS_PATH_FIELD = new Map([
  ["1", 8],
  ["2", 9],
  ["?", 1],
]);

/**
 * Whether a fast-forward pull would keep the local work in a repository that
 * is only behind: `git merge --ff-only --no-autostash` refuses only when an
 * incoming commit touches a changed or untracked path, or a submodule holds
 * work of its own. Conflicted checkouts are never pullable.
 */
export const pullKeepsLocalWork = Effect.fn("Update.pullKeepsLocalWork")(
  function* (repo: DiffRepo) {
    if (repo.ahead > 0 || repo.behind === 0) return false;

    const executor = yield* CommandExecutor;

    const [status, incoming] = yield* Effect.all([
      executor.run(
        "git",
        [
          "status",
          "--porcelain=v2",
          "-z",
          "--untracked-files=normal",
          "--ignore-submodules=none",
        ],
        { cwd: repo.path },
      ),
      executor.run("git", ["diff", "--name-only", "-z", "HEAD", "@{u}"], {
        cwd: repo.path,
      }),
    ]);

    const entries = status.split("\0");
    const changed: string[] = [];

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index] ?? "";

      if (entry === "") continue;

      const fields = entry.split(" ");
      const kind = fields[0] ?? "";
      const pathField = STATUS_PATH_FIELD.get(kind);

      // Unmerged entries, or anything this parser doesn't know, block the pull.
      if (pathField === undefined) return false;

      const submodule = fields[2] ?? "";

      if (
        kind !== "?" &&
        submodule.startsWith("S") &&
        !(fields[1] === ".M" && submodule === "SC..")
      )
        return false;

      changed.push(fields.slice(pathField).join(" "));

      // Renames and copies carry their original path as the next entry.
      if (kind === "2") changed.push(entries[++index] ?? "");
    }

    return !incoming
      .split("\0")
      .filter((path) => path !== "")
      .some((path) =>
        changed.some((local) =>
          local.endsWith("/")
            ? path.startsWith(local)
            : path === local ||
              path.startsWith(`${local}/`) ||
              local.startsWith(`${path}/`),
        ),
      );
  },
);

/** Find unapplied submodule pins, stow links and Herdr lockfile commits. */
export const pendingUpdateMaintenance = Effect.fn("Update.pendingMaintenance")(
  function* (repo: DiffRepo) {
    const config = yield* Config;
    const executor = yield* CommandExecutor;
    const fs = yield* FileSystem.FileSystem;
    const pending: string[] = [];

    const submodules = yield* executor.run(
      "git",
      ["submodule", "status", "--recursive"],
      { cwd: repo.path },
    );

    if (submodules.split("\n").some((line) => /^[+-]/.test(line))) {
      pending.push(`${repo.name}: pinned submodules need updating`);
    }

    if (repo.category !== "dotfiles") return pending;

    for (const folder of (yield* listStowFolders(repo.path, config)).sort()) {
      const flags = ["--simulate", "--verbose"];

      if (yield* requiresNoFolding(repo.path, folder))
        flags.push("--no-folding");

      if (folder === "omarchy") {
        for (const source of yield* omarchyPluginSubmodules(repo.path)) {
          flags.push(
            `--ignore=^\\.config/omarchy/plugins/${basename(source).replaceAll(".", "\\.")}($|/)`,
          );
        }
      }

      if (folder === "agents") {
        flags.push(
          ...(repo.path === config.publicDotfiles
            ? ["--ignore=^/\\.agents/skills($|/)"]
            : [
                "--ignore=node_modules",
                "--ignore=package\\.json",
                "--ignore=bun\\.lock",
                "--ignore=\\.gitignore",
              ]),
        );
      }

      const output = yield* executor.run(
        "bash",
        ["-c", 'stow "$@" 2>&1', "stow", ...flags, folder],
        { cwd: repo.path },
      );

      if (
        output
          .split("\n")
          .some(
            (line) =>
              /^(LINK|UNLINK|MKDIR|RMDIR):/.test(line) &&
              !line.includes("reverts previous action"),
          )
      )
        pending.push(`${repo.name}: ${folder} needs stow`);
    }

    const lockPath = join(
      repo.path,
      "herdr/.config/herdr/plugins/config/herdr-lazy/plugins.lock",
    );

    if (!(yield* fs.exists(lockPath))) return pending;

    const lock = yield* fs.readFileString(lockPath);
    const registryPath = join(CONFIG_DIR, "herdr/plugins.json");

    const plugins = (yield* fs.exists(registryPath))
      ? yield* fs
          .readFileString(registryPath)
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.fromJsonString(HerdrPlugins)),
            ),
          )
      : [];

    for (const line of lock.split("\n")) {
      const pin = line.split("#", 1)[0].trim();

      if (!pin) continue;
      const [slug, commit] = pin.split("@");

      if (!slug || !commit)
        return yield* new UpdateMaintenanceError({
          message: `Invalid Herdr pin: ${pin}`,
        });

      if (
        !plugins.some(
          ({ source }) =>
            source.kind === "github" &&
            `${source.owner}/${source.repo}` === slug &&
            source.resolved_commit === commit,
        )
      )
        pending.push(`${repo.name}: Herdr pin ${slug} needs restoring`);
    }

    return pending;
  },
);
