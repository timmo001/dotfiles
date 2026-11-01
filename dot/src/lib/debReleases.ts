import { Release } from "@timmo001/effect-gh";
import { Console, Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

/** A package installed from the .deb on a repository's latest GitHub release. */
const DebRelease = Schema.Struct({
  repository: Schema.String,
  package: Schema.String,
});

/** A configured release package that cannot be installed. */
export class DebReleaseError extends Schema.TaggedError<DebReleaseError>()(
  "DebReleaseError",
  { message: Schema.String },
) {}

/** Each configured release package with its latest release and installed version. */
const releaseVersions = Effect.gen(function* () {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const file = join(config.publicDotfiles, ".dot-public-deb-releases.yml");

  if (!(yield* fs.exists(file))) return [];

  const entries = yield* fs.readFileString(file).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(DebRelease))),
  );

  return yield* Effect.forEach(
    entries,
    (entry) =>
      Effect.gen(function* () {
        const release = yield* Release.view({
          repo: entry.repository,
          fields: ["tagName", "assets"],
        });

        const installed = (yield* executor
          .run("dpkg-query", ["-W", "-f=${Version}", entry.package])
          .pipe(Effect.orElseSucceed(() => ""))).trim();

        return {
          entry,
          release,
          installed,
          version: release.tagName.replace(/^v/, ""),
        };
      }),
    { concurrency: "unbounded" },
  );
}).pipe(Effect.withSpan("DebReleases.versions"));

/**
 * Release packages whose installed version differs from the latest release,
 * as `name old -> new` lines, or null when the check couldn't run.
 */
export const pendingDebReleases = releaseVersions.pipe(
  Effect.map((versions) =>
    versions.flatMap(({ entry, installed, version }) =>
      installed === version
        ? []
        : [`${entry.package} ${installed || "none"} -> ${version}`],
    ),
  ),
  Effect.orElseSucceed(() => null),
  Effect.withSpan("DebReleases.pending"),
);

/**
 * Install the latest release .deb of each package in
 * `.dot-public-deb-releases.yml` whose installed version differs, through apt.
 * Returns the exit code of the first failed install, or 0.
 */
export const updateDebReleases = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;

  const architecture = (yield* executor.run("dpkg", [
    "--print-architecture",
  ])).trim();

  for (const { entry, release, installed, version } of yield* releaseVersions) {
    if (installed === version) {
      yield* Console.log(`[INFO] ${entry.package} ${version} is up to date`);
      continue;
    }

    const asset = release.assets.find(({ name }) =>
      name.endsWith(`_${architecture}.deb`),
    );

    if (!asset)
      return yield* new DebReleaseError({
        message: `${entry.repository} ${release.tagName} has no ${architecture} .deb`,
      });

    const directory = yield* fs.makeTempDirectoryScoped({
      prefix: "dot-deb-release-",
    });

    yield* Release.download({
      repo: entry.repository,
      tag: release.tagName,
      patterns: [asset.name],
      directory,
    });

    yield* Console.log(
      `[INFO] Installing ${entry.package} ${version}${installed ? ` over ${installed}` : ""}`,
    );

    const exitCode = yield* executor.inherit("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      join(directory, asset.name),
    ]);

    if (exitCode !== 0) return exitCode;
  }

  return 0;
}).pipe(Effect.scoped, Effect.withSpan("DebReleases.update"));
