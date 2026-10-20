import { Effect, Schema } from "effect";
import { join } from "path";
import { readTextOrNull } from "./fsProbe.js";

const PrivateSelectionFile = Schema.Struct({
  stow: Schema.optionalKey(Schema.Array(Schema.String)),
  mcp: Schema.optionalKey(
    Schema.Struct({ exclude: Schema.Array(Schema.String) }),
  ),
  repos: Schema.optionalKey(
    Schema.Struct({
      list: Schema.NonEmptyString,
      shallow: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

const RepoListsFile = Schema.Record(Schema.String, Schema.Array(Schema.String));

/** Private file holding named lists of tracked repositories by GitHub slug. */
export const REPO_LISTS_FILE = "dot-repo-lists.yml";

/** Tracked repositories this machine clones and checks. */
export interface RepoSelection {
  /** Name of the list in the private {@link REPO_LISTS_FILE}. */
  readonly list: string;
  /** Clone missing repositories with `--depth=1`. */
  readonly shallow: boolean;
}

/** What this machine takes from the private dotfiles, per `.dot-private.yml`. */
export interface PrivateSelection {
  /** Private stow packages to link, or `null` to link them all. */
  readonly stow: ReadonlySet<string> | null;
  /** MCP servers from the private spec this machine keeps disabled. */
  readonly mcpExclude: ReadonlySet<string>;
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
      Effect.map(({ stow, mcp, repos }): PrivateSelection => ({
        stow: stow === undefined ? null : new Set(stow),
        mcpExclude: new Set(mcp?.exclude),
        repos:
          repos === undefined
            ? null
            : { list: repos.list, shallow: repos.shallow ?? false },
      })),
      Effect.orElseSucceed((): PrivateSelection => ({
        stow: new Set(),
        mcpExclude: new Set(),
        repos: { list: "", shallow: true },
      })),
    );
  },
);

/**
 * Read a named list of lowercase GitHub slugs from the private
 * {@link REPO_LISTS_FILE}, or `null` when the file or list is missing or
 * invalid.
 */
export const readRepoList = Effect.fn("PrivateSelection.readRepoList")(
  function* (privateDotfiles: string, list: string) {
    const text = yield* readTextOrNull(join(privateDotfiles, REPO_LISTS_FILE));

    if (text === null) return null;

    return yield* Effect.try(() => Bun.YAML.parse(text)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(RepoListsFile)),
      Effect.map((lists): ReadonlySet<string> | null =>
        Object.hasOwn(lists, list)
          ? new Set(lists[list].map((slug) => slug.toLowerCase()))
          : null,
      ),
      Effect.orElseSucceed(() => null),
    );
  },
);
