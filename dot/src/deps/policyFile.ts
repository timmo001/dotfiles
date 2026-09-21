import { Effect, JsonSchema, Schema } from "effect";
import { parseDocument, stringify } from "yaml";
import { DependencyConfig, DependencyConfigError } from "./config.js";

/** Native policy filename written by the importer. */
export const dependencyPolicyFile = "dot-deps.yml";

/** Generated, repository-local editor schema referenced by the YAML policy. */
export const dependencyPolicySchemaFile = "dot-deps.schema.json";

/** Accepted policy filenames during migration from JSON. */
export const dependencyPolicyFiles = [dependencyPolicyFile, "dot-deps.json"];

/** Select exactly one policy without silently ignoring a second configuration. */
export const dependencyPolicyPath = Effect.fn("Dependencies.policyPath")(
  function* (paths: Iterable<string>) {
    const candidates = [...paths].filter((path) =>
      dependencyPolicyFiles.includes(path),
    );

    if (candidates.length !== 1)
      return yield* new DependencyConfigError({
        message: candidates.length
          ? "Both dot-deps.yml and dot-deps.json exist; keep only one policy"
          : "Missing dot-deps.yml dependency policy",
      });

    return candidates[0];
  },
);

/** Decode YAML 1.2 or legacy JSON with the same strict runtime schema. */
export const decodeDependencyConfig = Effect.fn("Dependencies.decodeConfig")(
  function* (text: string) {
    const value = yield* Effect.try({
      try: () => {
        const document = parseDocument(text, {
          version: "1.2",
          uniqueKeys: true,
        });

        if (document.errors.length || document.warnings.length)
          throw new Error("Invalid policy YAML");

        return document.toJS({ maxAliasCount: 100 });
      },
      catch: () =>
        new DependencyConfigError({
          message: "Invalid dependency policy YAML",
        }),
    });

    return yield* Schema.decodeUnknownEffect(DependencyConfig)(value, {
      onExcessProperty: "error",
    }).pipe(
      Effect.mapError(
        () =>
          new DependencyConfigError({
            message: "Dependency policy does not match its schema",
          }),
      ),
    );
  },
);

/** Read the policy carried by a pinned snapshot, including legacy JSON snapshots. */
export const readDependencyConfig = Effect.fn("Dependencies.readConfig")(
  function* (files: Readonly<Record<string, string>>) {
    return yield* decodeDependencyConfig(
      files[yield* dependencyPolicyPath(Object.keys(files))],
    );
  },
);

/** Render block-style YAML and its portable editor-schema association. */
export function renderDependencyConfig(config: DependencyConfig): string {
  return `# yaml-language-server: $schema=./${dependencyPolicySchemaFile}\n---\n${stringify(config, { aliasDuplicateObjects: false, lineWidth: 0, defaultKeyType: "PLAIN", defaultStringType: "QUOTE_DOUBLE" })}`;
}

/** Generate the editor schema from the runtime policy contract. */
export function renderDependencySchema(): string {
  const document = JsonSchema.toDocumentDraft07(
    Schema.toJsonSchemaDocument(DependencyConfig, {
      onExcessProperty: "error",
    }),
  );

  return `${JSON.stringify(
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "Dot dependency policy",
      $comment:
        "Generated from the native dependency policy schema by dot deps import-renovate",
      ...document.schema,
      definitions: document.definitions,
    },
    null,
    2,
  )}\n`;
}
