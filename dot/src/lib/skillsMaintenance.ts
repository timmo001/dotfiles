import { Effect, Schema } from "effect";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { dirname, join } from "path";
import { HOME_DIR } from "./paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

/** Failure while building the installed skill-maintenance executable. */
export class SkillsMaintenanceBuildError extends Schema.TaggedError<SkillsMaintenanceBuildError>()(
  "SkillsMaintenanceBuildError",
  { message: Schema.String },
) {}

/** Resolve the preferred standalone skills source. */
export function skillsMaintenanceSource(
  publicDotfiles: string,
  home = HOME_DIR,
): string {
  const writable = join(home, "repos", "skills");
  return existsSync(join(writable, "src", "index.ts"))
    ? writable
    : join(publicDotfiles, "agents", ".agents", "skills");
}

/** Compile and atomically install the standalone skill-maintenance executable. */
export const buildSkillsMaintenance = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const source = skillsMaintenanceSource(config.publicDotfiles);
  const entrypoint = join(source, "src", "index.ts");
  const target = join(
    config.publicDotfiles,
    "scripts",
    ".local",
    "bin",
    "skill-maintenance",
  );
  const temporary = `${target}.new`;

  if (!existsSync(entrypoint)) {
    return yield* new SkillsMaintenanceBuildError({
      message: `Skill maintenance source is unavailable: ${entrypoint}`,
    });
  }

  yield* Effect.sync(() => {
    mkdirSync(dirname(target), { recursive: true });
    rmSync(temporary, { force: true });
  });

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
    yield* Effect.sync(() => rmSync(temporary, { force: true }));
    return yield* new SkillsMaintenanceBuildError({
      message: `Skill-maintenance build exited ${buildCode}`,
    });
  }

  yield* Effect.sync(() => {
    chmodSync(temporary, 0o755);
    renameSync(temporary, target);
  });
  return target;
});
