import { Effect, Schema } from "effect";
import { join } from "path";
import { readTextOrNull } from "./fsProbe.js";

const PrivateSelectionFile = Schema.Struct({
  stow: Schema.optionalKey(Schema.Array(Schema.String)),
  mcp: Schema.optionalKey(
    Schema.Struct({ exclude: Schema.Array(Schema.String) }),
  ),
});

/** What this machine takes from the private dotfiles, per `.dot-private.yml`. */
export interface PrivateSelection {
  /** Private stow packages to link, or `null` to link them all. */
  readonly stow: ReadonlySet<string> | null;
  /** MCP servers from the private spec this machine keeps disabled. */
  readonly mcpExclude: ReadonlySet<string>;
}

/**
 * Read the public `.dot-private.yml`, or `null` when it is missing and the
 * machine takes everything. An invalid file stows no private packages, so a
 * typo never stows the desktop's packages.
 */
export const readPrivateSelection = Effect.fn("PrivateSelection.read")(
  function* (publicDotfiles: string) {
    const text = yield* readTextOrNull(
      join(publicDotfiles, ".dot-private.yml"),
    );

    if (text === null) return null;

    return yield* Effect.try(() => Bun.YAML.parse(text)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(PrivateSelectionFile)),
      Effect.map(({ stow, mcp }): PrivateSelection => ({
        stow: stow === undefined ? null : new Set(stow),
        mcpExclude: new Set(mcp?.exclude),
      })),
      Effect.orElseSucceed((): PrivateSelection => ({
        stow: new Set(),
        mcpExclude: new Set(),
      })),
    );
  },
);
