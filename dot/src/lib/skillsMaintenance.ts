import { Effect, FileSystem, Schema } from "effect";
import { dirname, join } from "path";
import { HOME_DIR } from "./paths.js";
import {
  isBuildCurrent,
  sourceBuildKey,
  installCompiledBinary,
} from "./buildStamp.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { pathExists } from "./fsProbe.js";

/** Failure while building the installed skill-maintenance executable. */
export class SkillsMaintenanceBuildError extends Schema.TaggedError<SkillsMaintenanceBuildError>()(
  "SkillsMaintenanceBuildError",
  { message: Schema.String },
) {}

const buildError = (error: { readonly message: string }) =>
  new SkillsMaintenanceBuildError({ message: error.message });

/** Resolve the preferred standalone skills source. */
export const skillsMaintenanceSource = Effect.fn("SkillsMaintenance.source")(
  function* (publicDotfiles: string, home = HOME_DIR) {
    const writable = join(home, "repos", "skills");

    return (yield* pathExists(join(writable, "src", "index.ts")))
      ? writable
      : join(publicDotfiles, "agents", ".agents", "skills");
  },
);

/**
 * Compile and atomically install the standalone skill-maintenance executable,
 * skipping the build when it already came from the same clean source tree.
 */
export const buildSkillsMaintenance = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const source = yield* skillsMaintenanceSource(config.publicDotfiles);
  const entrypoint = join(source, "src", "index.ts");

  const target = join(
    config.publicDotfiles,
    "scripts",
    ".local",
    "bin",
    "skill-maintenance",
  );

  const temporary = `${target}.new`;

  if (!(yield* pathExists(entrypoint))) {
    return yield* new SkillsMaintenanceBuildError({
      message: `Skill maintenance source is unavailable: ${entrypoint}`,
    });
  }

  const buildKey = yield* sourceBuildKey(source);

  if (yield* isBuildCurrent(target, buildKey)) return { target, built: false };

  yield* fs
    .makeDirectory(dirname(target), { recursive: true })
    .pipe(
      Effect.andThen(fs.remove(temporary, { force: true })),
      Effect.mapError(buildError),
    );

  const installCode = yield* executor.inherit(
    "bun",
    ["install", "--frozen-lockfile"],
    { cwd: source },
  );

  if (installCode !== 0) {
    return yield* new SkillsMaintenanceBuildError({
      message: `Locked skill-maintenance dependency install exited ${installCode}`,
    });
  }

  const buildCode = yield* executor.inherit(
    "bun",
    ["build", "src/index.ts", "--compile", "--outfile", temporary],
    { cwd: source },
  );

  if (buildCode !== 0) {
    yield* fs
      .remove(temporary, { force: true })
      .pipe(Effect.mapError(buildError));

    return yield* new SkillsMaintenanceBuildError({
      message: `Skill-maintenance build exited ${buildCode}`,
    });
  }

  yield* installCompiledBinary(temporary, target, buildKey).pipe(
    Effect.mapError(buildError),
  );

  return { target, built: true };
});
