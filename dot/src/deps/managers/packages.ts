import { dirname, join } from "node:path";
import { Effect, Schema, Predicate, Record } from "effect";
import { parse, type ParseError } from "jsonc-parser";
import {
  DependencyDiscoveryError,
  type Dependency,
  type Extraction,
} from "../model.js";

const Strings = Schema.Record(Schema.String, Schema.String);

const Manifest = Schema.Struct({
  dependencies: Schema.optionalKey(Strings),
  devDependencies: Schema.optionalKey(Strings),
  peerDependencies: Schema.optionalKey(Strings),
  optionalDependencies: Schema.optionalKey(Strings),
  overrides: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  resolutions: Schema.optionalKey(Strings),
});

const Lock = Schema.Struct({
  lockfileVersion: Schema.Finite,
  packages: Schema.Record(Schema.String, Schema.Array(Schema.Json)),
});

/** Decode Bun JSONC without running Bun or changing a lockfile. */
export const decodeBunLock = Effect.fn("Dependencies.decodeBunLock")(function* (
  text: string,
) {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });

  if (errors.length)
    return yield* new DependencyDiscoveryError({
      message: "Invalid Bun lockfile JSONC",
    });

  return yield* Schema.decodeUnknownEffect(Lock)(value);
});

/** Interpret npm aliases and GitHub dependency specs without shelling out. */
export function packageDependency(
  file: string,
  name: string,
  current: string,
  dependencyType: string,
): Dependency {
  const github =
    /^(?:github:|git\+https:\/\/github\.com\/|https:\/\/github\.com\/|git@github\.com:)([^#]+?)(?:\.git)?(?:#(.+))?$/.exec(
      current,
    ) ?? /^([\w.-]+\/[\w.-]+)(?:#(.+))?$/.exec(current);

  if (github) {
    const ref = github[2] ?? "HEAD";

    return {
      manager: "npm",
      file,
      name,
      package: github[1],
      datasource: /^v?\d+\.\d+\.\d+/.test(ref) ? "github-tags" : "git-refs",
      current: ref,
      ...Record.filter(
        { digest: /^[a-f\d]{7,40}$/i.test(ref) ? ref : undefined },
        Predicate.isNotUndefined,
      ),
      sourceUrl: `https://github.com/${github[1]}`,
      dependencyType,
    };
  }

  const alias = /^npm:(.+)@([^@]+)$/.exec(current);

  return {
    manager: "npm",
    file,
    name,
    package: alias?.[1] ?? name,
    datasource: /^(?:workspace:|file:|link:)/.test(current) ? "local" : "npm",
    current: alias?.[2] ?? current,
    dependencyType,
  };
}

/** Extract package manifests and their direct Bun resolutions from immutable text. */
export const extractPackages = Effect.fn("Dependencies.extractPackages")(
  function* (
    file: string,
    text: string,
    files: Readonly<Record<string, string>>,
  ): Effect.fn.Return<Extraction, DependencyDiscoveryError> {
    const manifest = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Manifest),
    )(text).pipe(
      Effect.mapError(
        () =>
          new DependencyDiscoveryError({
            message: `Invalid package manifest: ${file}`,
          }),
      ),
    );

    const lockText = files[join(dirname(file), "bun.lock")];

    const lock =
      lockText === undefined
        ? undefined
        : yield* decodeBunLock(lockText).pipe(
            Effect.mapError(
              () =>
                new DependencyDiscoveryError({
                  message: `Invalid Bun lockfile beside ${file}`,
                }),
            ),
          );

    const dependencies: Dependency[] = [];
    const blockers: string[] = [];

    for (const type of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
      "overrides",
      "resolutions",
    ] as const) {
      for (const [name, current] of Object.entries(manifest[type] ?? {})) {
        if (!Predicate.isString(current)) {
          blockers.push(
            `${file}: nested ${type} for ${name} requires explicit support`,
          );
          continue;
        }

        const referenced = current.startsWith("$")
          ? (manifest.dependencies?.[current.slice(1)] ??
            manifest.devDependencies?.[current.slice(1)])
          : undefined;

        const dependency = packageDependency(
          file,
          name,
          referenced ?? current,
          type,
        );

        const resolution = lock?.packages[name]?.[0];

        const resolved = Predicate.isString(resolution)
          ? resolution.slice(resolution.lastIndexOf("@") + 1)
          : undefined;

        const digest =
          dependency.digest ??
          (Predicate.isString(resolution) && dependency.datasource !== "npm"
            ? /#([a-f\d]{7,40})$/i.exec(resolution)?.[1]
            : undefined);

        dependencies.push({
          ...dependency,
          ...Record.filter({ resolved, digest }, Predicate.isNotUndefined),
        });
      }
    }

    if (files[join(dirname(file), "bun.lockb")] !== undefined)
      blockers.push(
        `${file}: binary Bun lockfiles require migration before publication`,
      );

    return { dependencies, blockers };
  },
);
