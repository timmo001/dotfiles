import { expect, test } from "bun:test";
import { Effect } from "../../dot/node_modules/effect/dist/index.js";
import { skipDependencyCommand } from "../../dot/src/deps/config";
import { decodeDependencyConfig } from "../../dot/src/deps/policyFile";
import type { Dependency } from "../../dot/src/deps/model";
import { extractRegex } from "../../dot/src/deps/managers/regex";
import { prepareDependencyEdits } from "../../dot/src/deps/edits";
import type { DependencyPolicy } from "../../dot/src/deps/config";

test("recursive plugin matching preserves outside pins and inherited capture offsets", async () => {
  const policy: DependencyPolicy = {
    settings: {},
    managers: {},
    rules: [],
    datasources: {},
    regexManagers: [
      {
        files: ["config.json"],
        strategy: "recursive",
        templates: {},
        patterns: [
          '\\{\\s*"datasource":\\s*"(?<datasource>npm)"[^}]*\\}',
          '"plugins":\\s*\\[[^\\]]*\\]',
          '"(?<depName>[^"@]+)@(?<currentValue>[^"]+)"',
        ],
      },
    ],
  };

  const original =
    '{"outside":"sample@1.0.0","groups":[{"datasource":"npm","plugins":["sample@1.0.0","other@2.0.0"]}]}';

  const extracted = extractRegex("config.json", original, policy.regexManagers);
  expect(extracted.blockers).toEqual([]);
  expect(
    extracted.dependencies.map((entry) => [entry.name, entry.datasource]),
  ).toEqual([
    ["sample", "npm"],
    ["other", "npm"],
  ]);
  const dependency = extracted.dependencies[0];

  if (!dependency) throw new Error("Missing nested dependency");

  const prepared = await Effect.runPromise(
    prepareDependencyEdits(
      {
        repository: "example/config",
        target: "main",
        sha: "base",
        tree: [],
        files: { "config.json": original },
      },
      policy,
      [
        {
          dependency,
          group: "sample",
          groups: ["sample"],
          skippedBy: [],
          selection: {
            settings: {},
            release: { version: "1.1.0" },
            reason: "test",
            blockers: [],
          },
        },
      ],
    ),
  );

  expect(prepared.files["config.json"]).toBe(
    '{"outside":"sample@1.0.0","groups":[{"datasource":"npm","plugins":["sample@1.1.0","other@2.0.0"]}]}',
  );
});

test("standalone exclusions cannot suppress checks for a mixed or unknown group", async () => {
  const config = await Effect.runPromise(
    decodeDependencyConfig(
      await Bun.file(new URL("../../dot-deps.yml", import.meta.url)).text(),
    ),
  );

  const uv = {
    manager: "mise",
    file: "mise/.config/mise/config.toml",
    name: "uv",
    package: "astral-sh/uv",
    datasource: "github-releases",
    dependencyType: "tools",
    current: "0.12.17",
  } satisfies Dependency;

  for (const command of [
    ...config.validation.setup,
    ...config.validation.checks.flatMap((check) => check.commands),
  ]) {
    expect(skipDependencyCommand(command, [uv])).toBe(true);
    expect(skipDependencyCommand(command, [uv, { ...uv, name: "bun" }])).toBe(
      false,
    );
    expect(
      skipDependencyCommand(command, [{ ...uv, name: "unknown-tool" }]),
    ).toBe(false);
    expect(
      skipDependencyCommand(command, [{ ...uv, file: "dot/mise.toml" }]),
    ).toBe(false);
    expect(skipDependencyCommand(command, [])).toBe(false);
    expect(
      skipDependencyCommand({ ...command, skipFor: undefined }, [uv]),
    ).toBe(false);
  }
});
