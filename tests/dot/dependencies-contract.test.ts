import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "../../dot/node_modules/@effect/platform-node/dist/index.js";
import {
  Effect,
  Layer,
  Schema,
  Stream,
} from "../../dot/node_modules/effect/dist/index.js";
import {
  DependencyConfig,
  assertDependencyOverrides,
  assertDependencyPolicyReady,
  overrideHash,
  type RenovateObject,
} from "../../dot/src/deps/config.js";
import { DependencyImporter } from "../../dot/src/deps/importRenovate.js";
import {
  RenovateResolver,
  type ResolvedRenovate,
} from "../../dot/src/deps/renovateResolver.js";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(
  source: RenovateObject,
  resolve?: (source: RenovateObject) => ResolvedRenovate,
) {
  const root = mkdtempSync(join(tmpdir(), "dependency-import-"));
  temporary.push(root);
  const output = join(root, "dot-deps.json");
  const sourceFile = join(root, "renovate.json");
  writeFileSync(sourceFile, JSON.stringify(source));
  let calls = 0;
  let staged = false;

  const base: RenovateObject = {
    minimumReleaseAge: "1 day",
    packageRules: [{ matchPackageNames: ["@example/*"], groupName: "Example" }],
  };

  const layer = DependencyImporter.layer.pipe(
    Layer.provide([
      NodeServices.layer,
      Layer.succeed(
        RenovateResolver,
        RenovateResolver.of({
          resolve: (_root, input) =>
            Effect.sync(() => {
              calls += 1;

              return resolve
                ? resolve(input)
                : {
                    version: "fixture",
                    defaults: {},
                    base,
                    full: {
                      ...base,
                      ...input,
                      packageRules: [
                        ...(Array.isArray(base.packageRules)
                          ? base.packageRules
                          : []),
                        ...(Array.isArray(input.packageRules)
                          ? input.packageRules
                          : []),
                      ],
                    },
                  };
            }),
        }),
      ),
      Layer.succeed(
        CommandExecutor,
        CommandExecutor.of({
          run: (_command, args) => {
            if (args[0] === "rev-parse") return Effect.succeed(root);

            if (args[0] === "diff")
              return Effect.succeed(staged ? "dot-deps.json\n" : "");

            return Effect.die("Unexpected external command");
          },
          stream: () => Stream.die("Unexpected streamed command"),
          inherit: () => Effect.die("Unexpected inherited command"),
          exitCode: () => Effect.die("Unexpected command"),
        }),
      ),
    ]),
  );

  return {
    root,
    sourceFile,
    output,
    calls: () => calls,
    stage: () => {
      staged = true;
    },
    run: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const importer = yield* DependencyImporter;

          return yield* importer.import({
            directory: root,
            source: "renovate.json",
            timeout: 1000,
          });
        }).pipe(Effect.provide(layer)),
      ),
  };
}

test("import and re-import preserve the native base while replacing ordered overrides", async () => {
  const source: RenovateObject = {
    extends: ["example:preset"],
    packageRules: [
      { matchPackageNames: ["@example/one"], enabled: false },
      { matchPackageNames: ["@example/two"], minimumReleaseAge: null },
    ],
  };

  const repo = fixture(source);
  const first = await repo.run();
  expect(first.config.policy.base.rules[0].set.groupName).toBe("Example");
  expect(first.config.policy.overrides.rules.map((rule) => rule.set)).toEqual([
    { enabled: false },
    { minimumReleaseAge: null },
  ]);

  const edited = {
    ...first.config,
    policy: {
      ...first.config.policy,
      base: {
        ...first.config.policy.base,
        settings: { minimumReleaseAge: "3 days" },
      },
      overrides: {
        ...first.config.policy.overrides,
        settings: { enabled: false },
      },
    },
    validation: {
      setup: [],
      checks: [
        {
          context: "build",
          commands: [
            { argv: ["mise", "run", "check"], cwd: ".", timeout: 1000 },
          ],
        },
      ],
    },
  };

  writeFileSync(repo.output, JSON.stringify(edited));

  const changed = {
    packageRules: [
      { matchPackageNames: ["@example/three"], allowedVersions: "<2" },
    ],
  };

  writeFileSync(repo.sourceFile, JSON.stringify(changed));
  await expect(
    Effect.runPromise(assertDependencyOverrides(first.config, changed)),
  ).rejects.toThrow("overrides changed");
  const second = await repo.run();
  expect(repo.calls()).toBe(1);
  expect(second.config.policy.base.settings.minimumReleaseAge).toBe("3 days");
  expect(second.config.validation).toEqual(edited.validation);
  expect(second.config.policy.overrides.settings).toEqual({});
  expect(second.config.policy.overrides.rules).toHaveLength(1);
  expect(second.config.policy.overrides.rules[0].set.allowedVersions).toBe(
    "<2",
  );
  await Effect.runPromise(assertDependencyOverrides(second.config, changed));
  expect(readdirSync(repo.root).sort()).toEqual([
    "dot-deps.json",
    "renovate.json",
  ]);
});

test("override drift ignores frozen presets and presentation, but preserves rule order and datasource keys", () => {
  const source = {
    extends: ["old"],
    labels: ["dependencies"],
    packageRules: [{ enabled: false }, { enabled: true }],
  };

  expect(overrideHash(source)).toBe(
    overrideHash({ ...source, extends: ["new"], labels: ["other"] }),
  );
  expect(overrideHash(source)).not.toBe(
    overrideHash({
      ...source,
      packageRules: [...source.packageRules].reverse(),
    }),
  );
  expect(
    overrideHash({ customDatasources: { labels: { format: "plain" } } }),
  ).not.toBe(overrideHash({ customDatasources: {} }));
});

test("unsupported selectors cannot become broader rules or permit publication", async () => {
  const repo = fixture({
    packageRules: [{ matchJsonata: ["isLockfileUpdate"], enabled: true }],
    hostRules: [{ token: "must-not-be-saved" }],
  });

  const result = await repo.run();
  expect(result.config.policy.overrides.rules).toEqual([]);
  expect(
    result.config.import.overrideDiagnostics
      .filter((entry) => entry.disposition === "blocked")
      .map((entry) => entry.path),
  ).toEqual([
    "renovate.json.hostRules",
    "renovate.json.packageRules[0].matchJsonata",
  ]);
  expect(readFileSync(repo.output, "utf8")).not.toContain("must-not-be-saved");
  await expect(
    Effect.runPromise(assertDependencyPolicyReady(result.config)),
  ).rejects.toThrow("Unresolved dependency policy");
});

test("re-import blocks nested presets rather than broadening their rules", async () => {
  const repo = fixture({});
  const initial = await repo.run();

  const source = {
    packageRules: [{ extends: ["preset:selector"], enabled: false }],
  };

  expect(overrideHash(source)).not.toBe(
    overrideHash({ packageRules: [{ enabled: false }] }),
  );
  writeFileSync(repo.sourceFile, JSON.stringify(source));
  await expect(
    Effect.runPromise(assertDependencyOverrides(initial.config, source)),
  ).rejects.toThrow("overrides changed");
  const result = await repo.run();
  expect(repo.calls()).toBe(1);
  expect(result.config.policy.overrides.rules).toEqual([]);
  await expect(
    Effect.runPromise(assertDependencyPolicyReady(result.config)),
  ).rejects.toThrow("packageRules[0].extends");
});

test("staged native config is preserved and unresolved checks block publication", async () => {
  const repo = fixture({});
  const result = await repo.run();
  await expect(
    Effect.runPromise(assertDependencyPolicyReady(result.config)),
  ).rejects.toThrow("mapped local checks");
  repo.stage();
  const original = readFileSync(repo.output, "utf8");
  await expect(repo.run()).rejects.toThrow("staged changes");
  expect(readFileSync(repo.output, "utf8")).toBe(original);
  expect(
    Schema.decodeUnknownSync(Schema.fromJsonString(DependencyConfig))(original),
  ).toEqual(result.config);
});

test("an unexpected resolver merge stops conversion before writing native policy", async () => {
  const repo = fixture({}, () => ({
    version: "fixture",
    defaults: {},
    base: {},
    full: { packageRules: [{ enabled: false }] },
  }));

  await expect(repo.run()).rejects.toThrow("supported ordered merge");
  expect(() => readFileSync(repo.output)).toThrow();
});

test("merge verification preserves replacement arrays, additive lists and datasource replacement", async () => {
  const base = {
    enabledManagers: ["npm"],
    ignorePaths: ["vendor/**"],
    ignoreDeps: ["old"],
    npm: { managerFilePatterns: ["/package.json$/"], pinDigests: true },
    customDatasources: {
      example: {
        defaultRegistryUrlTemplate: "https://example.com/old",
        format: "plain",
        transformTemplates: ["old"],
      },
    },
  };

  const source = {
    enabledManagers: ["mise"],
    ignorePaths: [],
    ignoreDeps: ["new"],
    npm: { managerFilePatterns: ["/other.json$/"], pinDigests: false },
    customDatasources: {
      example: { defaultRegistryUrlTemplate: "https://example.com/new" },
    },
  };

  const full = {
    ...source,
    ignoreDeps: ["old", "new"],
    npm: {
      ...source.npm,
      managerFilePatterns: ["/package.json$/", "/other.json$/"],
    },
  };

  const repo = fixture(source, () => ({
    version: "fixture",
    defaults: {},
    base,
    full,
  }));

  await repo.run();

  for (const changed of [
    { ...full, ignoreDeps: ["new"] },
    { ...full, ignorePaths: ["vendor/**"] },
    { ...full, npm: source.npm },
    { ...full, customDatasources: base.customDatasources },
  ]) {
    const mismatch = fixture(source, () => ({
      version: "fixture",
      defaults: {},
      base,
      full: changed,
    }));

    await expect(mismatch.run()).rejects.toThrow(
      "do not reproduce the resolved policy",
    );
    expect(readdirSync(mismatch.root)).toEqual(["renovate.json"]);
  }
});

test("invalid source values are withheld from errors and leave no output", async () => {
  const repo = fixture({ minimumReleaseAge: { token: "must-not-be-logged" } });
  await expect(repo.run()).rejects.toThrow("source values are withheld");
  expect(readdirSync(repo.root)).toEqual(["renovate.json"]);
  writeFileSync(repo.sourceFile, '{"token":"must-not-be-logged"');
  await expect(repo.run()).rejects.toThrow(
    "Invalid Renovate JSON in renovate.json",
  );
});

test("validation commands require a positive deadline and repository-relative working directory", async () => {
  const result = await fixture({}).run();

  for (const command of [
    { argv: ["check"], cwd: "../outside", timeout: 1000 },
    { argv: ["check"], cwd: "/outside", timeout: 1000 },
    { argv: ["check"], cwd: ".", timeout: 0 },
    { argv: [], cwd: ".", timeout: 1000 },
  ]) {
    expect(
      Schema.is(DependencyConfig)({
        ...result.config,
        validation: { setup: [command], checks: [] },
      }),
    ).toBe(false);
  }
});
