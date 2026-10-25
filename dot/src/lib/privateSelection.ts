import { Effect, Schema } from "effect";
import { join } from "path";
import { readTextOrNull } from "./fsProbe.js";

const PrivateSelectionFile = Schema.Struct({
  stow: Schema.optionalKey(Schema.Array(Schema.String)),
  mcp: Schema.optionalKey(
    Schema.Struct({ exclude: Schema.Array(Schema.String) }),
  ),
  opencode: Schema.optionalKey(
    Schema.Struct({
      plugins: Schema.optionalKey(Schema.Array(Schema.String)),
      instructions: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
  repos: Schema.optionalKey(
    Schema.Struct({
      machine: Schema.NonEmptyString,
      shallow: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

/** Tracked repositories this machine clones and checks. */
export interface RepoSelection {
  /** Machine name a repository's `machines` in `dot-git.yml` must list. */
  readonly machine: string;
  /** Clone missing repositories with `--depth=1`. */
  readonly shallow: boolean;
}

/** OpenCode settings this machine layers over the shared config. */
export interface OpenCodeLayer {
  /** Plugin operations, such as `-plannotator` to remove a shared plugin. */
  readonly plugins: readonly string[];
  /** Extra instruction files loaded on this machine. */
  readonly instructions: readonly string[];
}

/** What this machine takes from the private dotfiles, per `.dot-private.yml`. */
export interface PrivateSelection {
  /** Private stow packages to link, or `null` to link them all. */
  readonly stow: ReadonlySet<string> | null;
  /** MCP servers from the private spec this machine keeps disabled. */
  readonly mcpExclude: ReadonlySet<string>;
  /** OpenCode plugins and instructions changed on this machine. */
  readonly opencode: OpenCodeLayer;
  /** Tracked repositories to keep, or `null` to keep them all. */
  readonly repos: RepoSelection | null;
}

/**
 * Read the public `.dot-private.yml`, or `null` when it is missing and the
 * machine takes everything. An invalid file stows no private packages and
 * keeps no tracked repositories, so a typo never pulls in the desktop's.
 */
export const readPrivateSelection = Effect.fn("PrivateSelection.read")(
  function* (publicDotfiles: string) {
    const text = yield* readTextOrNull(
      join(publicDotfiles, ".dot-private.yml"),
    );

    if (text === null) return null;

    return yield* Effect.try(() => Bun.YAML.parse(text)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(PrivateSelectionFile)),
      Effect.map(({ stow, mcp, opencode, repos }): PrivateSelection => ({
        stow: stow === undefined ? null : new Set(stow),
        mcpExclude: new Set(mcp?.exclude),
        opencode: {
          plugins: opencode?.plugins ?? [],
          instructions: opencode?.instructions ?? [],
        },
        repos:
          repos === undefined
            ? null
            : { machine: repos.machine, shallow: repos.shallow ?? false },
      })),
      Effect.orElseSucceed((): PrivateSelection => ({
        stow: new Set(),
        mcpExclude: new Set(),
        opencode: { plugins: [], instructions: [] },
        repos: { machine: "", shallow: true },
      })),
    );
  },
);
