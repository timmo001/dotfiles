import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Predicate,
  Record,
  Schema,
} from "effect";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CommandExecutor } from "../services/CommandExecutor.js";
import {
  DependencyConfig,
  DependencyConfigError,
  DependencyPolicy,
  ignoredRenovateFields,
  mergeDependencyPolicy,
  overrideHash,
  overrideSnapshot,
  RenovateObject,
  type DependencyDiagnostic,
} from "./config.js";
import { RenovateResolver } from "./renovateResolver.js";
import {
  decodeDependencyConfig,
  dependencyPolicyFile,
  dependencyPolicyFiles,
  dependencyPolicyPath,
  dependencyPolicySchemaFile,
  renderDependencyConfig,
  renderDependencySchema,
} from "./policyFile.js";

const managers = ["bun", "npm", "mise", "github-actions", "git-submodules"];

const selectors = {
  matchManagers: "managers",
  matchDatasources: "datasources",
  matchPackageNames: "packages",
  matchDepNames: "dependencies",
  matchFileNames: "files",
  matchDepTypes: "dependencyTypes",
  matchSourceUrls: "sourceUrls",
  matchCurrentValue: "currentValues",
  matchCurrentVersion: "currentVersions",
  matchUpdateTypes: "updateTypes",
};

const templates = {
  datasourceTemplate: "datasource",
  depNameTemplate: "dependency",
  packageNameTemplate: "package",
  currentValueTemplate: "value",
  versioningTemplate: "versioning",
  extractVersionTemplate: "extractVersion",
  autoReplaceStringTemplate: "replacement",
};

const settingNames = new Set(
  Object.keys(DependencyPolicy.fields.settings.fields),
);

const Strings = Schema.Array(Schema.String);

function settingsFrom(source: RenovateObject) {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => settingNames.has(key)),
  );
}

function diagnosticsFor(
  source: RenovateObject,
  supported: ReadonlySet<string>,
  path: string,
  defaults?: RenovateObject,
): DependencyDiagnostic[] {
  return Object.entries(source)
    .filter(
      ([key, value]) =>
        !supported.has(key) &&
        !(defaults && isDeepStrictEqual(defaults[key], value)),
    )
    .map(([key, value]) => ({
      path: `${path}.${key}`,
      disposition: ignoredRenovateFields.has(key) ? "ignored" : "blocked",
      message: ignoredRenovateFields.has(key)
        ? "Not used by the on-demand, no-PR workflow"
        : "No native translation; implement or explicitly exclude this policy before publishing",
      ...Record.filter(
        {
          scope:
            Schema.is(RenovateObject)(value) &&
            Schema.is(RenovateObject)(defaults?.[key]) &&
            Schema.is(Strings)(value.managerFilePatterns)
              ? { files: value.managerFilePatterns }
              : undefined,
        },
        Predicate.isNotUndefined,
      ),
    }));
}

/** Decode source sections and translate ordered rules without dropping unsupported selectors. */
export const translateDependencyPolicy = Effect.fn(
  "Dependencies.translatePolicy",
)(function* (source: RenovateObject, path: string, defaults?: RenovateObject) {
  const sections = yield* Schema.decodeEffect(
    Schema.Struct({
      packageRules: Schema.optionalKey(Schema.Array(RenovateObject)),
      customManagers: Schema.optionalKey(Schema.Array(RenovateObject)),
      customDatasources: Schema.optionalKey(
        Schema.Record(Schema.String, RenovateObject),
      ),
    }),
  )(source);

  const diagnostics = diagnosticsFor(
    source,
    new Set([
      ...settingNames,
      ...managers,
      "packageRules",
      "customManagers",
      "customDatasources",
      "enabledManagers",
      "ignorePaths",
      "ignoreDeps",
      "extends",
      "ignorePresets",
    ]),
    path,
    defaults,
  );

  const rules = yield* Effect.forEach(
    sections.packageRules ?? [],
    Effect.fn("Dependencies.translateRule")(function* (rule, index) {
      const findings = diagnosticsFor(
        rule,
        new Set([...settingNames, ...Object.keys(selectors), "description"]),
        `${path}.packageRules[${index}]`,
      );

      const unsupported = findings.some(
        (entry) => entry.disposition === "blocked",
      );

      const presentationOnly = Object.keys(rule).every(
        (key) =>
          key in selectors ||
          key === "matchJsonata" ||
          key === "description" ||
          ignoredRenovateFields.has(key),
      );

      const scope = Object.fromEntries(
        Object.entries(selectors)
          .filter(
            ([key, name]) =>
              rule[key] !== undefined &&
              [
                "managers",
                "datasources",
                "packages",
                "dependencies",
                "files",
                "dependencyTypes",
              ].includes(name),
          )
          .map(([key, name]) => [
            name,
            Array.isArray(rule[key]) ? rule[key] : [rule[key]],
          ]),
      );

      const scopedFindings = findings.map((finding) =>
        finding.disposition === "ignored"
          ? finding
          : {
              ...finding,
              ...(presentationOnly && finding.disposition === "blocked"
                ? {
                    disposition: "ignored" as const,
                    message:
                      "Selector only controls presentation fields unused by the native updater",
                  }
                : Record.filter(
                    {
                      scope: Object.keys(scope).length
                        ? { dependencies: scope }
                        : undefined,
                    },
                    Predicate.isNotUndefined,
                  )),
            },
      );

      const description =
        rule.description === undefined
          ? undefined
          : yield* Schema.decodeEffect(Strings)(
              Array.isArray(rule.description)
                ? rule.description
                : [rule.description],
            );

      return {
        findings: scopedFindings,
        // Dropping a selector could broaden a rule, so reject the whole rule.
        rule: unsupported
          ? []
          : [
              {
                ...Record.filter({ description }, Predicate.isNotUndefined),
                match: Object.fromEntries(
                  Object.entries(selectors)
                    .filter(([key]) => rule[key] !== undefined)
                    .map(([key, name]) => [
                      name,
                      Array.isArray(rule[key]) ? rule[key] : [rule[key]],
                    ]),
                ),
                set: settingsFrom(rule),
              },
            ],
      };
    }),
  );

  const nativeManagers = yield* Effect.forEach(
    managers.filter((name) => source[name] !== undefined),
    Effect.fn("Dependencies.translateManager")(function* (name) {
      const value = yield* Schema.decodeUnknownEffect(RenovateObject)(
        source[name],
      );

      const baseline = defaults?.[name];

      return {
        name,
        value: {
          ...Record.filter(
            { files: value.managerFilePatterns },
            Predicate.isNotUndefined,
          ),
          settings: settingsFrom(value),
        },
        findings: diagnosticsFor(
          value,
          new Set([...settingNames, "managerFilePatterns"]),
          `${path}.${name}`,
          Schema.is(RenovateObject)(baseline) ? baseline : undefined,
        ),
      };
    }),
  );

  const regexManagers = (sections.customManagers ?? []).map(
    (manager, index) => {
      const managerPath = `${path}.customManagers[${index}]`;

      const findings = diagnosticsFor(
        manager,
        new Set([
          ...Object.keys(templates),
          "customType",
          "description",
          "managerFilePatterns",
          "matchStrings",
          "matchStringsStrategy",
        ]),
        managerPath,
      );

      if (manager.customType !== "regex")
        findings.push({
          path: `${managerPath}.customType`,
          disposition: "blocked",
          message: "Only regex extraction has a native translation",
        });

      return {
        findings,
        managers: findings.some((entry) => entry.disposition === "blocked")
          ? []
          : [
              {
                files: manager.managerFilePatterns,
                patterns: manager.matchStrings,
                ...Record.filter(
                  { strategy: manager.matchStringsStrategy },
                  Predicate.isNotUndefined,
                ),
                templates: Object.fromEntries(
                  Object.entries(templates)
                    .filter(([key]) => manager[key] !== undefined)
                    .map(([key, name]) => [name, manager[key]]),
                ),
              },
            ],
      };
    },
  );

  const datasources = Object.entries(sections.customDatasources ?? {}).map(
    ([name, datasource]) => {
      const findings = diagnosticsFor(
        datasource,
        new Set(["defaultRegistryUrlTemplate", "format", "transformTemplates"]),
        `${path}.customDatasources.${name}`,
      );

      return {
        findings,
        entries: findings.some((entry) => entry.disposition === "blocked")
          ? []
          : [
              [
                name,
                {
                  registry: datasource.defaultRegistryUrlTemplate,
                  format: datasource.format ?? "json",
                  transforms: datasource.transformTemplates ?? [],
                },
              ],
            ],
      };
    },
  );

  const policy = yield* Schema.decodeUnknownEffect(DependencyPolicy)({
    settings: settingsFrom(source),
    ...Record.filter(
      {
        enabledManagers: source.enabledManagers,
        ignorePaths: source.ignorePaths,
        ignoreDependencies: source.ignoreDeps,
      },
      Predicate.isNotUndefined,
    ),
    managers: Object.fromEntries(
      nativeManagers.map((manager) => [manager.name, manager.value]),
    ),
    rules: rules.flatMap((entry) => entry.rule),
    regexManagers: regexManagers.flatMap((entry) => entry.managers),
    datasources: Object.fromEntries(
      datasources.flatMap((entry) => entry.entries),
    ),
  });

  return {
    policy,
    diagnostics: [
      ...diagnostics,
      ...rules.flatMap((entry) => entry.findings),
      ...nativeManagers.flatMap((entry) => entry.findings),
      ...regexManagers.flatMap((entry) => entry.findings),
      ...datasources.flatMap((entry) => entry.findings),
    ],
  };
});

/** Preserve native base policy and checks when replacing imported overrides. */
export const replaceDependencyOverrides = Effect.fn(
  "Dependencies.replaceOverrides",
)(function* (config: DependencyConfig, source: RenovateObject) {
  const translated = yield* translateDependencyPolicy(
    source,
    config.import.source,
  );

  return yield* Schema.decodeEffect(DependencyConfig)({
    schemaVersion: config.schemaVersion,
    validation: config.validation,
    policy: { ...config.policy, overrides: translated.policy },
    import: {
      ...config.import,
      overrideHash: overrideHash(source),
      overrideDiagnostics: translated.diagnostics,
    },
  });
});

/** Import options; paths are resolved from the selected local repository. */
export interface ImportRenovateOptions {
  /** Repository checkout, defaulting to the current directory. */
  readonly directory: string;
  /** Repository-relative JSON source file. */
  readonly source: string;
  /** Deadline in milliseconds for each resolver pass. */
  readonly timeout: number;
}

/** Completed local import, including its saved compatibility report. */
export interface DependencyImportResult {
  /** Written native configuration path. */
  readonly path: string;
  /** Validated configuration and redacted conversion diagnostics. */
  readonly config: DependencyConfig;
}

/** Authority to replace imported policy without changing Git history. */
export interface DependencyImporterService {
  /** Read, translate and save one repository's dependency policy. */
  readonly import: (
    options: ImportRenovateOptions,
  ) => Effect.Effect<DependencyImportResult, DependencyConfigError>;
}

/** Filesystem and resolver workflow for {@link DependencyImporterService}. */
export class DependencyImporter extends Context.Service<
  DependencyImporter,
  DependencyImporterService
>()("dot/Dependencies/Importer") {
  /** Construct import operations from their application-owned dependencies. */
  static readonly layer = Layer.effect(
    DependencyImporter,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* CommandExecutor;
      const resolver = yield* RenovateResolver;

      return DependencyImporter.of({
        import: Effect.fn("DependencyImporter.import")(
          function* (options) {
            const root = (yield* executor.run(
              "git",
              ["rev-parse", "--show-toplevel"],
              { cwd: options.directory },
            )).trim();

            const sourcePath = relative(root, resolve(root, options.source));

            if (
              !sourcePath ||
              sourcePath === ".." ||
              sourcePath.startsWith("../") ||
              isAbsolute(sourcePath)
            )
              return yield* new DependencyConfigError({
                message: "The Renovate source must be inside the repository",
              });
            const sourceText = yield* fs.readFileString(join(root, sourcePath));

            const source = yield* Schema.decodeEffect(
              Schema.fromJsonString(RenovateObject),
            )(sourceText).pipe(
              Effect.mapError(
                () =>
                  new DependencyConfigError({
                    message: `Invalid Renovate JSON in ${sourcePath}`,
                  }),
              ),
            );

            const output = join(root, dependencyPolicyFile);
            const schemaPath = join(root, dependencyPolicySchemaFile);

            const originalPaths = yield* Effect.filter(
              dependencyPolicyFiles,
              (path) => fs.exists(join(root, path)),
            );

            const originalPath = originalPaths.length
              ? yield* dependencyPolicyPath(originalPaths)
              : undefined;

            const originalOutput =
              originalPath !== undefined
                ? yield* fs.readFileString(join(root, originalPath))
                : undefined;

            const originalSchema = (yield* fs.exists(schemaPath))
              ? yield* fs.readFileString(schemaPath)
              : undefined;

            const imported = yield* Effect.gen(function* () {
              if (originalOutput !== undefined) {
                const existing = yield* decodeDependencyConfig(originalOutput);

                if (existing.import.source !== sourcePath)
                  return yield* new DependencyConfigError({
                    message: `Existing policy was imported from ${existing.import.source}; use that source for re-import`,
                  });

                return yield* replaceDependencyOverrides(existing, source);
              }

              const resolved = yield* resolver.resolve(
                root,
                source,
                options.timeout,
              );

              yield* Effect.forEach(
                ["packageRules", "customManagers"],
                Effect.fn("DependencyImporter.verifyMerge")(function* (key) {
                  const inherited = resolved.base[key] ?? [];
                  const local = source[key] ?? [];

                  if (
                    !Array.isArray(inherited) ||
                    !Array.isArray(local) ||
                    !isDeepStrictEqual(
                      overrideSnapshot(resolved.full[key] ?? []),
                      overrideSnapshot([...inherited, ...local]),
                    )
                  )
                    return yield* new DependencyConfigError({
                      message: `Resolver changed ${key} beyond a supported ordered merge; import stopped`,
                    });
                }),
                { discard: true },
              );

              const base = yield* translateDependencyPolicy(
                resolved.base,
                "presets",
                resolved.defaults,
              );

              const overrides = yield* translateDependencyPolicy(
                source,
                sourcePath,
              );

              const full = yield* translateDependencyPolicy(
                resolved.full,
                "resolved",
                resolved.defaults,
              );

              if (
                !isDeepStrictEqual(
                  mergeDependencyPolicy(base.policy, overrides.policy),
                  full.policy,
                )
              )
                return yield* new DependencyConfigError({
                  message:
                    "Native base and overrides do not reproduce the resolved policy; import stopped",
                });

              return yield* Schema.decodeEffect(DependencyConfig)({
                schemaVersion: 1,
                policy: { base: base.policy, overrides: overrides.policy },
                validation: { setup: [], checks: [] },
                import: {
                  source: sourcePath,
                  resolverVersion: resolved.version,
                  overrideHash: overrideHash(source),
                  baseDiagnostics: base.diagnostics,
                  overrideDiagnostics: overrides.diagnostics,
                },
              });
            });

            if (
              (yield* fs.readFileString(join(root, sourcePath))) !==
                sourceText ||
              !isDeepStrictEqual(
                originalPaths,
                yield* Effect.filter(dependencyPolicyFiles, (path) =>
                  fs.exists(join(root, path)),
                ),
              ) ||
              (originalPath !== undefined
                ? yield* fs.readFileString(join(root, originalPath))
                : undefined) !== originalOutput ||
              ((yield* fs.exists(schemaPath))
                ? yield* fs.readFileString(schemaPath)
                : undefined) !== originalSchema
            )
              return yield* new DependencyConfigError({
                message:
                  "Configuration changed during import; retry without overwriting those edits",
              });

            if (
              (yield* executor.run(
                "git",
                [
                  "diff",
                  "--cached",
                  "--name-only",
                  "--",
                  ...dependencyPolicyFiles,
                  dependencyPolicySchemaFile,
                ],
                { cwd: root },
              )).trim()
            )
              return yield* new DependencyConfigError({
                message:
                  "Dependency policy or editor schema has staged changes; finish those before importing",
              });

            const temporary = yield* fs.makeTempDirectoryScoped({
              directory: root,
              prefix: ".dot-deps-",
            });

            yield* fs.writeFileString(
              join(temporary, dependencyPolicyFile),
              renderDependencyConfig(imported),
            );
            yield* fs.writeFileString(
              join(temporary, dependencyPolicySchemaFile),
              renderDependencySchema(),
            );
            yield* fs.rename(
              join(temporary, dependencyPolicySchemaFile),
              schemaPath,
            );
            yield* fs.rename(join(temporary, dependencyPolicyFile), output);

            if (
              originalPath !== undefined &&
              originalPath !== dependencyPolicyFile
            )
              yield* fs.remove(join(root, originalPath));

            return { path: output, config: imported };
          },
          Effect.scoped,
          Effect.mapError((error) =>
            error instanceof DependencyConfigError
              ? error
              : new DependencyConfigError({
                  message:
                    "Dependency import failed while reading, translating or saving configuration; source values are withheld because they may contain credentials",
                }),
          ),
        ),
      });
    }),
  );
}
