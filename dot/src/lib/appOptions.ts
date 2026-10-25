import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { isPackageInstalled } from "./aptPackages.js";
import { readListFile } from "./listFile.js";
import { ENV, envString } from "./env.js";
import type { ConfigService } from "../services/Config.js";

/** The OpenCode app's mise system config, holding the tools built into its image. */
const IMAGE_MISE_CONFIG = "/etc/mise/config.toml";

/** Where the user changes the app's options. */
const APP_OPTIONS_LOCATION =
  "Settings > Apps > OpenCode > Configuration in Home Assistant";

/** The OpenCode app options dot reads. */
const AppOptions = Schema.Struct({
  system_packages: Schema.Array(Schema.String),
  tools: Schema.Array(Schema.String),
});

const AppInfo = Schema.Struct({
  data: Schema.Struct({ options: AppOptions }),
});

const ImageMiseConfig = Schema.Struct({
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

/** The app's options could not be read from the Supervisor. */
export class AppOptionsError extends Schema.TaggedError<AppOptionsError>()(
  "AppOptionsError",
  { message: Schema.String },
) {}

/** System packages and tools this machine needs from the app. */
export interface AppRequirements {
  /** Debian packages for the app's `system_packages` option. */
  readonly packages: readonly string[];
  /** mise tools for the app's `tools` option, as option entries. */
  readonly tools: readonly string[];
}

/** Requirements the app's options and image don't provide yet. */
export interface MissingAppRequirements extends AppRequirements {
  /** Packages in the option that apt hasn't installed yet. */
  readonly notInstalled: readonly string[];
}

/**
 * The tool name of a `tools` option entry, `[backend:]name[@version]`, keeping
 * the `@` of a scoped npm name. Matches the app's own parsing.
 */
export function appToolName(entry: string): string {
  const at = entry.lastIndexOf("@");

  return at > 0 && entry[at - 1] !== ":" ? entry.slice(0, at) : entry;
}

/** The public package and tool lists this machine needs from the app. */
export function publicAppRequirements(config: ConfigService): AppRequirements {
  return {
    packages:
      readListFile(
        envString(ENV.DOT_PUBLIC_PACKAGES_FILE) ??
          join(config.publicDotfiles, ".dot-public-packages"),
      ) ?? [],
    tools: readListFile(join(config.publicDotfiles, ".dot-public-tools")) ?? [],
  };
}

/** Read the app's own options from the Supervisor. */
export const readAppOptions = Effect.gen(function* () {
  const token = envString(ENV.SUPERVISOR_TOKEN);

  if (!token)
    return yield* new AppOptionsError({
      message: "SUPERVISOR_TOKEN is not set; is this the OpenCode app?",
    });

  const info = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch("http://supervisor/addons/self/info", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok)
        throw new Error(`The Supervisor answered ${response.status}`);

      return Schema.decodeUnknownSync(AppInfo)(await response.json());
    },
    catch: (error) =>
      new AppOptionsError({
        message: `Could not read the app's options: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

  return info.data.options;
}).pipe(Effect.withSpan("AppOptions.read"));

/** Tool names built into the app's image, or none when its config can't be read. */
const imageToolNames = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(IMAGE_MISE_CONFIG).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.TOML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(ImageMiseConfig)),
    Effect.map(({ tools }) => Object.keys(tools ?? {})),
    Effect.orElseSucceed((): readonly string[] => []),
  );
}).pipe(Effect.withSpan("AppOptions.imageToolNames"));

/**
 * Compare requirements with the app's options and image. Packages in the
 * option are also checked with apt, since the app only installs them after it
 * starts.
 */
export const missingAppRequirements = Effect.fn("AppOptions.missing")(
  function* (requirements: AppRequirements) {
    const options = yield* readAppOptions;

    const providedTools = new Set(
      [...options.tools, ...(yield* imageToolNames)].map(appToolName),
    );

    const optionPackages = new Set(options.system_packages);
    const notInstalled: string[] = [];

    for (const packageName of requirements.packages) {
      if (
        optionPackages.has(packageName) &&
        !(yield* isPackageInstalled(packageName))
      )
        notInstalled.push(packageName);
    }

    return {
      packages: requirements.packages.filter(
        (packageName) => !optionPackages.has(packageName),
      ),
      tools: requirements.tools.filter(
        (entry) => !providedTools.has(appToolName(entry)),
      ),
      notInstalled,
    } satisfies MissingAppRequirements;
  },
);

/** Whether anything is missing from the app. */
export function hasMissingAppRequirements(
  missing: MissingAppRequirements,
): boolean {
  return (
    missing.packages.length > 0 ||
    missing.tools.length > 0 ||
    missing.notInstalled.length > 0
  );
}

/** Lines telling the user what to add to the app, and how to apply it. */
export function appRequirementInstructions(
  missing: MissingAppRequirements,
): readonly string[] {
  return [
    ...(missing.packages.length > 0
      ? [
          `Add to the app's system_packages option: ${missing.packages.join(", ")}`,
        ]
      : []),
    ...(missing.tools.length > 0
      ? [`Add to the app's tools option: ${missing.tools.join(", ")}`]
      : []),
    ...(missing.packages.length > 0 || missing.tools.length > 0
      ? [`Change them in ${APP_OPTIONS_LOCATION}, then restart the app`]
      : []),
    ...(missing.notInstalled.length > 0
      ? [
          `In the option but not installed yet: ${missing.notInstalled.join(", ")}. Restart the app, or check its log if they still don't appear`,
        ]
      : []),
  ];
}
