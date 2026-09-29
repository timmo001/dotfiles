import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { runElevated } from "../lib/elevatedCommand.js";
import { ENV, envString } from "../lib/env.js";
import { displayPath } from "../lib/paths.js";

const PUBLIC_REPO_NAME = "timmo";

const PUBLIC_REPO_FINGERPRINT = "F94469C08E3B717014E2815FA026A3671E9151DA";

const PUBLIC_REPO_KEY_URL = "https://packages.timmo.dev/timmo-arch-repo.asc";

const PUBLIC_REPO_DATABASE_URL = "https://packages.timmo.dev/x86_64/timmo.db";

const DEFAULT_PUBLIC_PACMAN_REPO_CONFIG = "/etc/pacman.d/timmo.conf";

const DEFAULT_PUBLIC_PACMAN_MAIN_CONFIG = "/etc/pacman.conf";

/** Domain error for public pacman repository setup failures. */
class SetupPublicRepoError extends Schema.TaggedError<SetupPublicRepoError>()(
  "SetupPublicRepoError",
  { message: Schema.String },
) {}

function fail(message: string): Effect.Effect<never, SetupPublicRepoError> {
  return Effect.fail(new SetupPublicRepoError({ message }));
}

/** Path to the public pacman repository snippet. */
export function publicPacmanRepoConfigPath(): string {
  return (
    envString(ENV.DOT_PUBLIC_PACMAN_REPO_CONFIG) ??
    DEFAULT_PUBLIC_PACMAN_REPO_CONFIG
  );
}

/** Path to the main pacman configuration file used for public repo setup. */
export function publicPacmanMainConfigPath(): string {
  return (
    envString(ENV.DOT_PUBLIC_PACMAN_MAIN_CONFIG) ??
    DEFAULT_PUBLIC_PACMAN_MAIN_CONFIG
  );
}

/** Expected public pacman repository snippet. */
export function publicPackageRepoConfigContents(): string {
  return `[${PUBLIC_REPO_NAME}]\nSigLevel = PackageRequired DatabaseOptional TrustedOnly\nServer = https://packages.timmo.dev/$arch\n`;
}

/** Include line that registers the public repository with pacman. */
export function publicPackageRepoIncludeLine(): string {
  return `Include = ${publicPacmanRepoConfigPath()}`;
}

/** Primary fingerprint from GnuPG colon output, excluding subkey fingerprints. */
export function primaryFingerprint(gpgOutput: string): string | null {
  const lines = gpgOutput.split("\n");
  const publicKeyIndex = lines.findIndex((line) => line.startsWith("pub:"));

  if (publicKeyIndex < 0) return null;

  const fingerprint = lines
    .slice(publicKeyIndex + 1)
    .find((line) => line.startsWith("fpr:"));

  return fingerprint?.split(":")[9] || null;
}

/** Main pacman config with one public include before the first package repo. */
export function withPublicPackageRepoInclude(contents: string): string {
  const includeLine = publicPackageRepoIncludeLine();

  const lines = contents
    .split("\n")
    .filter((line) => line.trim() !== includeLine);

  let firstRepository = lines.findIndex((line) => {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line)?.[1];

    return section !== undefined && section.toLowerCase() !== "options";
  });

  while (
    firstRepository > 1 &&
    lines[firstRepository - 1] === "" &&
    lines[firstRepository - 2] === ""
  ) {
    lines.splice(firstRepository - 1, 1);
    firstRepository--;
  }

  const insertAt = firstRepository < 0 ? lines.length : firstRepository;
  lines.splice(insertAt, 0, includeLine, "");

  return `${lines.join("\n").trimEnd()}\n`;
}

/** Whether the public repo snippet exactly matches the required configuration. */
export const publicPackageRepoConfigMatches = Effect.fn(
  "SetupPublicRepo.configMatches",
)(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = publicPacmanRepoConfigPath();

  return (
    (yield* fs.exists(path).pipe(Effect.orDie)) &&
    (yield* fs.readFileString(path).pipe(Effect.orDie)).trimEnd() ===
      publicPackageRepoConfigContents().trimEnd()
  );
});

/** Whether the public include is present before every package repository. */
export const publicPackageRepoIncludeRegistered = Effect.fn(
  "SetupPublicRepo.includeRegistered",
)(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = publicPacmanMainConfigPath();

  if (!(yield* fs.exists(path).pipe(Effect.orDie))) return false;

  const lines = (yield* fs.readFileString(path).pipe(Effect.orDie)).split("\n");

  const includeIndex = lines.findIndex(
    (line) => line.trim() === publicPackageRepoIncludeLine(),
  );

  const firstRepository = lines.findIndex((line) => {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line)?.[1];

    return section !== undefined && section.toLowerCase() !== "options";
  });

  return (
    includeIndex >= 0 && (firstRepository < 0 || includeIndex < firstRepository)
  );
});

const createTempDirectory = Effect.fn("SetupPublicRepo.createTempDirectory")(
  function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs
      .makeTempDirectory({
        directory: envString(ENV.TMPDIR) ?? "/tmp",
        prefix: "dot-public-repo-",
      })
      .pipe(
        Effect.tap((path) => fs.chmod(path, 0o700)),
        Effect.mapError(
          (error) =>
            new SetupPublicRepoError({
              message: `Could not create private temporary directory: ${String(error)}`,
            }),
        ),
      );
  },
);

const removeTempDirectory = Effect.fn("SetupPublicRepo.removeTempDirectory")(
  function* (path: string) {
    const fs = yield* FileSystem.FileSystem;

    yield* fs
      .remove(path, { recursive: true, force: true })
      .pipe(Effect.ignore);
  },
);

function installFile(
  source: string,
  target: string,
): Effect.Effect<void, SetupPublicRepoError, CommandExecutor> {
  return Effect.gen(function* () {
    const exitCode = yield* runElevated("install", [
      "-D",
      "-m",
      "0644",
      source,
      target,
    ]);

    if (exitCode !== 0) {
      return yield* fail(
        `Could not install ${displayPath(target)} (install exited ${exitCode})`,
      );
    }
  });
}

function verifyPublishedRepository(
  keyPath: string,
): Effect.Effect<void, SetupPublicRepoError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    if (
      (yield* executor.exitCode("curl", [
        "-fsSI",
        PUBLIC_REPO_DATABASE_URL,
      ])) !== 0
    ) {
      return yield* fail(
        `Public package repository database is unavailable: ${PUBLIC_REPO_DATABASE_URL}`,
      );
    }

    const downloaded = yield* executor.exitCode("curl", [
      "-fsSL",
      PUBLIC_REPO_KEY_URL,
      "-o",
      keyPath,
    ]);

    if (downloaded !== 0) {
      return yield* fail(`Could not download public repository key`);
    }

    const keyDetails = yield* executor
      .run("gpg", ["--batch", "--show-keys", "--with-colons", keyPath])
      .pipe(
        Effect.mapError(
          () =>
            new SetupPublicRepoError({
              message: "Could not inspect downloaded public repository key",
            }),
        ),
      );

    const actualFingerprint = primaryFingerprint(keyDetails);

    if (actualFingerprint !== PUBLIC_REPO_FINGERPRINT) {
      return yield* fail(
        `Public repository key fingerprint mismatch: expected ${PUBLIC_REPO_FINGERPRINT}, got ${actualFingerprint ?? "none"}`,
      );
    }
  });
}

function trustPublicRepositoryKey(
  keyPath: string,
): Effect.Effect<void, SetupPublicRepoError, CommandExecutor> {
  return Effect.gen(function* () {
    for (const [action, args] of [
      ["import", ["--add", keyPath]],
      ["locally sign", ["--lsign-key", PUBLIC_REPO_FINGERPRINT]],
    ] as const) {
      const exitCode = yield* runElevated("pacman-key", args);

      if (exitCode !== 0) {
        return yield* fail(
          `Could not ${action} public repository key (pacman-key exited ${exitCode})`,
        );
      }
    }
  });
}

function configurePublicRepository(
  tempDirectory: string,
): Effect.Effect<
  void,
  SetupPublicRepoError,
  CommandExecutor | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (!(yield* publicPackageRepoConfigMatches())) {
      const snippetPath = join(tempDirectory, "timmo.conf");

      yield* fs
        .writeFileString(snippetPath, publicPackageRepoConfigContents())
        .pipe(
          Effect.mapError(
            (error) =>
              new SetupPublicRepoError({
                message: `Could not write public repository config: ${String(error)}`,
              }),
          ),
        );
      yield* installFile(snippetPath, publicPacmanRepoConfigPath());
    }

    if (!(yield* publicPackageRepoIncludeRegistered())) {
      const mainConfigPath = publicPacmanMainConfigPath();

      const mainConfig = yield* fs.readFileString(mainConfigPath).pipe(
        Effect.mapError(
          (error) =>
            new SetupPublicRepoError({
              message: `Could not read ${displayPath(mainConfigPath)}: ${String(error)}`,
            }),
        ),
      );

      const updatedPath = join(tempDirectory, "pacman.conf");

      yield* fs
        .writeFileString(updatedPath, withPublicPackageRepoInclude(mainConfig))
        .pipe(
          Effect.mapError(
            (error) =>
              new SetupPublicRepoError({
                message: `Could not prepare ${displayPath(mainConfigPath)}: ${String(error)}`,
              }),
          ),
        );
      yield* installFile(updatedPath, mainConfigPath);
    }
  });
}

/** Verify, trust, and register the signed public timmo pacman repository. */
export const setupPublicRepo = Effect.gen(function* () {
  const log = yield* OutputLog;
  yield* log.section("Configure Public Package Repository");

  const tempDirectory = yield* createTempDirectory();
  yield* Effect.gen(function* () {
    const keyPath = join(tempDirectory, "timmo-arch-repo.asc");
    yield* verifyPublishedRepository(keyPath);
    yield* trustPublicRepositoryKey(keyPath);
    yield* configurePublicRepository(tempDirectory);
  }).pipe(Effect.ensuring(removeTempDirectory(tempDirectory)));

  if (
    !(yield* publicPackageRepoConfigMatches()) ||
    !(yield* publicPackageRepoIncludeRegistered())
  ) {
    return yield* fail(
      "Public package repository setup did not reach ready state",
    );
  }

  const refreshExitCode = yield* runElevated("pacman", ["-Sy", "--noconfirm"]);

  if (refreshExitCode !== 0) {
    return yield* fail(
      `Could not refresh package databases (pacman exited ${refreshExitCode})`,
    );
  }

  yield* log.info(
    `Public pacman repo is configured (${displayPath(publicPacmanRepoConfigPath())})`,
  );
});
