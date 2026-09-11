import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import type { DiffRepo } from "../types.js";
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

    for (const folder of listStowFolders(repo.path, config).sort()) {
      const flags = ["--simulate", "--verbose"];
      if (requiresNoFolding(repo.path, folder)) flags.push("--no-folding");
      if (folder === "agents") {
        flags.push(
          ...(repo.path === config.publicDotfiles
            ? ["--ignore=\\.agents/skills/dotfiles-stow($|/)"]
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
