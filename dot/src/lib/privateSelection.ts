import { Effect, Schema } from "effect";
import { join } from "path";
import { readTextOrNull } from "./fsProbe.js";

/**
 * `.dot-private.yml`, in the same format as the NAS's server branch. Station
 * reads its stow, MCP, Syncthing and OpenCode parts; it takes every tracked
 * repository, so it has no `repos` key.
 */
const PrivateSelectionFile = Schema.Struct({
  stow: Schema.optionalKey(Schema.Array(Schema.String)),
  mcp: Schema.optionalKey(
    Schema.Struct({ exclude: Schema.Array(Schema.String) }),
  ),
  syncthing: Schema.optionalKey(
    Schema.Struct({ exclude: Schema.Array(Schema.String) }),
  ),
  opencode: Schema.optionalKey(
    Schema.Struct({
      plugins: Schema.optionalKey(Schema.Array(Schema.String)),
      instructions: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
});

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
  /** Syncthing folder IDs from the private config this machine leaves out. */
  readonly syncthingExclude: ReadonlySet<string>;
  /** OpenCode plugins and instructions changed on this machine. */
  readonly opencode: OpenCodeLayer;
}

/**
 * Read the public `.dot-private.yml`, or `null` when it is missing and the
 * machine takes everything. An invalid file stows no private packages, so a
 * typo never pulls in the desktop's.
 */
export const readPrivateSelection = Effect.fn("PrivateSelection.read")(
  function* (publicDotfiles: string) {
    const text = yield* readTextOrNull(
      join(publicDotfiles, ".dot-private.yml"),
    );

    if (text === null) return null;

    return yield* Effect.try(() => Bun.YAML.parse(text)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(PrivateSelectionFile)),
      Effect.map(({ stow, mcp, syncthing, opencode }): PrivateSelection => ({
        stow: stow === undefined ? null : new Set(stow),
        mcpExclude: new Set(mcp?.exclude),
        syncthingExclude: new Set(syncthing?.exclude),
        opencode: {
          plugins: opencode?.plugins ?? [],
          instructions: opencode?.instructions ?? [],
        },
      })),
      Effect.orElseSucceed((): PrivateSelection => ({
        stow: new Set(),
        mcpExclude: new Set(),
        syncthingExclude: new Set(),
        opencode: { plugins: [], instructions: [] },
      })),
    );
  },
);
