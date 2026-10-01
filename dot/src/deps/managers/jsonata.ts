import jsonata from "jsonata";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { Effect, Match, Predicate, Record, Schema } from "effect";
import type { DependencyPolicy } from "../config.js";
import {
  DependencyDiscoveryError,
  type Dependency,
  type Extraction,
} from "../model.js";
import { matchesPatterns } from "../rules.js";
import { regexDependency } from "./regex.js";

const Fields = Schema.Record(Schema.String, Schema.Unknown);

/** Extract dependencies from JSONata queries over parsed JSON, YAML or TOML files. */
export const extractJsonata = Effect.fn("Dependencies.extractJsonata")(
  function* (
    file: string,
    text: string,
    managers: DependencyPolicy["jsonataManagers"],
  ): Effect.fn.Return<Extraction, DependencyDiscoveryError> {
    const dependencies: Dependency[] = [];
    const blockers: string[] = [];

    for (const manager of managers ?? []) {
      if (!matchesPatterns(file, manager.files)) continue;

      const data = yield* Effect.try({
        try: () =>
          Match.value(manager.format).pipe(
            Match.when("yaml", () => parseYaml(text)),
            Match.when("toml", () => parseToml(text)),
            Match.when("json", () => JSON.parse(text)),
            Match.exhaustive,
          ),
        catch: () =>
          new DependencyDiscoveryError({
            message: `${file}: invalid ${manager.format}`,
          }),
      });

      for (const pattern of manager.patterns) {
        const result: unknown = yield* Effect.tryPromise({
          try: () => jsonata(pattern).evaluate(data),
          catch: () =>
            new DependencyDiscoveryError({
              message: `${file}: invalid JSONata query`,
            }),
        });

        for (const item of result === undefined
          ? []
          : Array.isArray(result)
            ? result
            : [result]) {
          const fields = Schema.is(Fields)(item)
            ? Record.filter(item, Predicate.isString)
            : undefined;

          const dependency =
            fields &&
            (yield* Effect.try({
              try: () =>
                regexDependency(
                  file,
                  fields,
                  manager.templates,
                  "custom.jsonata",
                ),
              catch: () =>
                new DependencyDiscoveryError({
                  message: `${file}: invalid JSONata template`,
                }),
            }));

          if (!dependency) {
            blockers.push(
              `${file}: JSONata result lacks dependency, value or datasource`,
            );
            continue;
          }

          dependencies.push(dependency);
        }
      }
    }

    return { dependencies, blockers };
  },
);
