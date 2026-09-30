import { Context, Effect, Layer, Schema } from "effect";
import Fuse from "fuse.js";

/** The search query had no terms. */
export class SearchQueryEmpty extends Schema.TaggedError<SearchQueryEmpty>()(
  "SearchQueryEmpty",
  {},
) {}

/** A weighted field searched by {@link SearchService.fuzzy}. */
export interface SearchKey<T, Name extends string = string> {
  /** Field name reported in {@link SearchResult.matched}. */
  readonly name: Name;
  /** Relative ranking weight; higher counts for more. */
  readonly weight: number;
  /** Field values for an item; arrays match each element separately. */
  readonly getFn: (item: T) => string | readonly string[] | null | undefined;
}

/** Tuning that overrides the {@link SearchService.fuzzy} defaults. */
export interface SearchOverrides {
  /** Fuse match threshold from 0 (exact) to 1 (anything); default 0.45. */
  readonly threshold?: number;
  /** Drop results scoring below this, from 1 to 100; default 40. */
  readonly minScore?: number;
  /** Drop results more than this many points below the best; default 20. */
  readonly maxGap?: number;
  /**
   * Points taken off when a query word appears only inside other words, such
   * as "her" in "weather"; typo matches are not affected. Default 25.
   */
  readonly midWordPenalty?: number;
  /** Shortest matched run of characters that counts; default 2. */
  readonly minMatchCharLength?: number;
  /** Maximum results, applied after ranking; default 5. */
  readonly limit?: number;
}

/** Items, query and fields for one {@link SearchService.fuzzy} call. */
export interface SearchInput<T, Name extends string = string> {
  /** Items to search. */
  readonly items: readonly T[];
  /** Whitespace-separated terms; every term must match some field. */
  readonly query: string;
  /** Searchable fields; the first also breaks near-ties by length. */
  readonly keys: readonly SearchKey<T, Name>[];
  /** Tuning overrides. */
  readonly overrides?: SearchOverrides;
}

/** One ranked search result. */
export interface SearchResult<T, Name extends string = string> {
  /** Matching item. */
  readonly item: T;
  /** Relevance from 1 to 100; higher is closer. */
  readonly score: number;
  /** Fields that matched the query. */
  readonly matched: readonly Name[];
}

/** Ranked results from one {@link SearchService.fuzzy} call. */
export interface SearchResults<T, Name extends string = string> {
  /** Results within the limit, best first. */
  readonly results: readonly SearchResult<T, Name>[];
  /** Close matches before the limit was applied. */
  readonly total: number;
}

/** Shared search over in-memory items. */
export interface SearchService {
  /**
   * Typo-tolerant search, loose enough for ambiguous queries from agents and
   * people. Every query word must match some field. Results far below the
   * best are dropped, the rest ranked by score in bands of 5, then by the
   * shorter first field so short exact names win near-ties, then limited
   * (5 by default; `Infinity` for all). `total` counts every close match so
   * callers can say when more are available.
   */
  readonly fuzzy: <T, Name extends string>(
    input: SearchInput<T, Name>,
  ) => Effect.Effect<SearchResults<T, Name>, SearchQueryEmpty>;
}

/** Effect service for {@link SearchService}. */
export class Search extends Context.Service<Search, SearchService>()(
  "dot/Search",
) {
  /** Fuse.js-backed search with token matching across weighted fields. */
  static readonly layer = Layer.succeed(Search, {
    fuzzy: Effect.fn("Search.fuzzy")(function* <T, Name extends string>({
      items,
      query,
      keys,
      overrides = {},
    }: SearchInput<T, Name>) {
      const trimmed = query.trim();

      if (trimmed === "") return yield* new SearchQueryEmpty();

      const fuse = new Fuse(items, {
        keys: keys.map(({ name, weight, getFn }) => ({
          name,
          weight,
          getFn: (item: T) => getFn(item) ?? undefined,
        })),
        threshold: overrides.threshold ?? 0.45,
        minMatchCharLength: overrides.minMatchCharLength ?? 2,
        ignoreDiacritics: true,
        useTokenSearch: true,
        tokenMatch: "all",
        includeScore: true,
        includeMatches: true,
      });

      const names = new Set<string>(keys.map(({ name }) => name));

      const primaryLength = (item: T) =>
        ([keys[0]?.getFn(item) ?? []].flat()[0] ?? "").length;

      const normalise = (value: string) =>
        value
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();

      const terms = normalise(trimmed).split(/\s+/);

      const onlyMidWord = (item: T) => {
        const values = keys
          .flatMap(({ getFn }) => [getFn(item) ?? []].flat())
          .map(normalise);

        const words = values.flatMap((value) => value.split(/[^\p{L}\p{N}]+/u));

        return terms.some(
          (term) =>
            values.some((value) => value.includes(term)) &&
            !words.some((word) => word.startsWith(term)),
        );
      };

      const penalty = overrides.midWordPenalty ?? 25;

      const scored = fuse
        .search(trimmed)
        .map(({ item, score, matches }): SearchResult<T, Name> => ({
          item,
          score: Math.max(
            1,
            Math.round((1 - (score ?? 1)) * 100) -
              (onlyMidWord(item) ? penalty : 0),
          ),
          matched: [...new Set((matches ?? []).map(({ key }) => key))].filter(
            (key): key is Name => key !== undefined && names.has(key),
          ),
        }));

      const floor = Math.max(
        overrides.minScore ?? 40,
        Math.max(0, ...scored.map(({ score }) => score)) -
          (overrides.maxGap ?? 20),
      );

      const close = scored
        .filter(({ score }) => score >= floor)
        .sort(
          (a, b) =>
            Math.round(b.score / 5) - Math.round(a.score / 5) ||
            primaryLength(a.item) - primaryLength(b.item) ||
            b.score - a.score,
        );

      return {
        results: close.slice(0, overrides.limit ?? 5),
        total: close.length,
      } satisfies SearchResults<T, Name>;
    }),
  });
}
