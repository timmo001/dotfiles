import { Effect, FileSystem, Schema } from "effect";
import { dirname, join } from "path";
import { DATA_DIR, HOME_DIR } from "./paths.js";
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

/** Failure while cloning or updating the managed skills checkout. */
export class SkillsCheckoutError extends Schema.TaggedError<SkillsCheckoutError>()(
  "SkillsCheckoutError",
  { message: Schema.String },
) {}

const buildError = (error: { readonly message: string }) =>
  new SkillsMaintenanceBuildError({ message: error.message });

const checkoutError = (error: { readonly message: string }) =>
  new SkillsCheckoutError({ message: error.message });

const SKILLS_REPOSITORY_URL = "https://github.com/timmo001/skills.git";

/**
 * dot-owned skills checkout, detached at the latest fetched `origin/main`.
 * Stowed skills, the skill-maintenance build and external installs all come
 * from it, so branch switches in the writable checkout never leak in.
 */
export const SKILLS_CHECKOUT = join(DATA_DIR, "dot", "skills");

/**
 * Trust the checkout's mise config so tools run inside it never stop at a
 * trust prompt. Best-effort: a missing `mise` or failed trust is ignored.
 */
const trustSkillsCheckout = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const miseConfig = join(SKILLS_CHECKOUT, "mise.toml");

  if (!(yield* pathExists(miseConfig))) return;

  yield* executor.exitCode("mise", ["trust", miseConfig], { cwd: HOME_DIR });
}).pipe(Effect.withSpan("SkillsCheckout.trust"));

/** Clone and trust the managed skills checkout when it does not exist yet. */
export const ensureSkillsCheckout = Effect.gen(function* () {
  if (yield* pathExists(join(SKILLS_CHECKOUT, ".git"))) return false;

  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  yield* fs
    .makeDirectory(dirname(SKILLS_CHECKOUT), { recursive: true })
    .pipe(Effect.mapError(checkoutError));

  yield* executor
    .run("git", ["clone", "--quiet", SKILLS_REPOSITORY_URL, SKILLS_CHECKOUT])
    .pipe(Effect.mapError((error) => checkoutError({ message: error.stderr })));

  yield* trustSkillsCheckout;

  return true;
}).pipe(Effect.withSpan("SkillsCheckout.ensure"));

/**
 * Fetch `main` and detach the managed skills checkout at `origin/main`,
 * discarding any local edits, then re-trust its mise config.
 *
 * @returns The revisions before and after, equal when nothing changed.
 */
export const updateSkillsCheckout = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const git = (args: readonly string[]) =>
    executor
      .run("git", args, { cwd: SKILLS_CHECKOUT })
      .pipe(
        Effect.mapError((error) => checkoutError({ message: error.stderr })),
      );

  const cloned = yield* ensureSkillsCheckout;

  const head = git(["rev-parse", "--short", "HEAD"]).pipe(
    Effect.map((sha) => sha.trim()),
  );

  const from = cloned ? null : yield* head;

  yield* git(["fetch", "--quiet", "origin", "main"]);

  yield* git([
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "--quiet",
    "--force",
    "--detach",
    "origin/main",
  ]);

  yield* git(["clean", "-fdq"]);

  if (!cloned) yield* trustSkillsCheckout;

  return { from, to: yield* head };
}).pipe(Effect.withSpan("SkillsCheckout.update"));

/**
 * Resolve the source for authoring commands: the writable checkout when it
 * exists, otherwise the managed checkout.
 */
export const skillsAuthoringSource = Effect.fn("SkillsMaintenance.source")(
  function* (home = HOME_DIR) {
    const writable = join(home, "repos", "skills");

    return (yield* pathExists(join(writable, "src", "index.ts")))
      ? writable
      : SKILLS_CHECKOUT;
  },
);

/**
 * Compile and atomically install the standalone skill-maintenance executable
 * from the managed skills checkout, skipping the build when it already came
 * from the same clean source tree.
 */
export const buildSkillsMaintenance = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  yield* ensureSkillsCheckout.pipe(Effect.mapError(buildError));

  const source = SKILLS_CHECKOUT;
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
