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

/**
 * Install the latest release .deb of each package in
 * `.dot-public-deb-releases.yml` whose installed version differs, through apt.
 * Returns the exit code of the first failed install, or 0.
 */
export const updateDebReleases = Effect.fn("DebReleases.update")(function* (
  env: Readonly<Record<string, string>>,
) {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const file = join(config.publicDotfiles, ".dot-public-deb-releases.yml");

  if (!(yield* fs.exists(file))) return 0;

  const entries = yield* fs.readFileString(file).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(DebRelease))),
  );

  const architecture = (yield* executor.run("dpkg", [
    "--print-architecture",
  ])).trim();

  for (const entry of entries) {
    const release = yield* Release.view({
      repo: entry.repository,
      fields: ["tagName", "assets"],
    });

    const version = release.tagName.replace(/^v/, "");

    const installed = (yield* executor
      .run("dpkg-query", ["-W", "-f=${Version}", entry.package])
      .pipe(Effect.orElseSucceed(() => ""))).trim();

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

    const exitCode = yield* executor.inherit(
      "sudo",
      [
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        join(directory, asset.name),
      ],
      { ...(Object.keys(env).length > 0 && { env }) },
    );

    if (exitCode !== 0) return exitCode;
  }

  return 0;
}, Effect.scoped);
