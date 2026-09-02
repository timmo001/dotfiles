import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentOxlint } from "../../src/commands/AgentOxlint.js";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";
import { Config, type ConfigService } from "../../src/services/Config.js";
import {
  emptyDotGitConfig,
  type DotGitConfig,
  type GitManagedRepo,
} from "../../src/services/GitConfig.js";
import { emptyMcpConfig } from "../../src/mcp/sync/loadSpec.js";
import { OutputLog } from "../../src/services/OutputLog.js";

const roots: string[] = [];
const originalCwd = process.cwd();
const originalExitCode = process.exitCode;

afterEach(() => {
  process.chdir(originalCwd);
  process.exitCode = originalExitCode ?? 0;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function repository(path: string, agentOxlintEnabled: boolean): GitManagedRepo {
  return {
    name: "fixture",
    path,
    github: "example/fixture",
    aliases: [],
    postUpdate: null,
    agentOxlint: agentOxlintEnabled,
    activity: { enabled: true, schedule: "* * * * *" },
    notifications: {
      enabled: true,
      schedule: "* * * * *",
      bar: { ignoreBotActivity: true },
    },
  };
}

function gitConfig(repo?: GitManagedRepo): DotGitConfig {
  return {
    ...emptyDotGitConfig("/tmp/dot-git.yml"),
    present: true,
    repositories: repo ? [repo] : [],
  };
}

function config(cacheDir: string, value: DotGitConfig): ConfigService {
  return {
    publicDotfiles: "/tmp/dotfiles",
    privateDotfiles: null,
    canUsePrivate: false,
    privateReason: "test",
    notesDir: "/tmp/notes",
    omarchy: {
      repoBase: "/tmp",
      diffRepos: [],
      worktreeRepos: [],
      worktreeBranches: [],
      expectedBranches: {},
      enabled: false,
    },
    gitConfig: value,
    mcpConfig: emptyMcpConfig("/tmp/mcp.yml"),
    cacheDir,
    stateDir: "/tmp/state",
    logDir: "/tmp/state/logs",
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agent-oxlint-test-"));
  const repo = join(root, "repo");
  const cache = join(root, "cache");
  mkdirSync(repo);
  writeFileSync(join(repo, "example.ts"), "export const value = 1;\n");
  roots.push(root);
  process.chdir(repo);
  return { root, repo, cache };
}

function seedInstalledCache(cacheDir: string): string {
  const directory = join(cacheDir, "agent-oxlint", "rules-0.1.4-oxlint-1.81.0");
  for (const [path, version] of [
    ["node_modules/oxlint/package.json", "1.81.0"],
    ["node_modules/@oxlint/plugins/package.json", "1.81.0"],
    ["node_modules/@timmo001/oxlint-rules/package.json", "0.1.4"],
  ] as const) {
    const target = join(directory, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, `${JSON.stringify({ version })}\n`);
  }
  const binary = join(directory, "node_modules/.bin/oxlint");
  mkdirSync(join(binary, ".."), { recursive: true });
  writeFileSync(binary, "#!/bin/sh\n");
  return binary;
}

function layers(options: {
  readonly repo: string;
  readonly cache: string;
  readonly enabled?: boolean;
  readonly files?: string;
  readonly lintExit?: number;
  readonly calls: Array<
    readonly [string, readonly string[], string | undefined]
  >;
  readonly messages: string[];
}) {
  const managed = repository(options.repo, options.enabled ?? true);
  return Layer.mergeAll(
    Layer.succeed(Config, config(options.cache, gitConfig(managed))),
    Layer.succeed(CommandExecutor, {
      run: (command, args) =>
        command === "git" && args.includes("--show-toplevel")
          ? Effect.succeed(`${options.repo}\n`)
          : Effect.succeed(options.files ?? "example.ts\n"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: (command, args, runOptions) =>
        Effect.sync(() => {
          options.calls.push([command, args, runOptions?.cwd]);
          if (command === "bun") seedInstalledCache(options.cache);
          return command === "bun" ? 0 : (options.lintExit ?? 0);
        }),
    }),
    Layer.succeed(OutputLog, {
      info: (message) =>
        Effect.sync(() => {
          options.messages.push(message);
        }),
      warn: () => Effect.void,
      error: () => Effect.void,
      section: () => Effect.void,
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    }),
  );
}

describe("agentOxlint", () => {
  test("skips repositories that are not opted in", async () => {
    const { repo, cache } = fixture();
    const calls: Array<
      readonly [string, readonly string[], string | undefined]
    > = [];
    const messages: string[] = [];

    await Effect.runPromise(
      agentOxlint({ paths: ["example.ts"], all: false }).pipe(
        Effect.provide(
          layers({ repo, cache, enabled: false, calls, messages }),
        ),
      ),
    );

    expect(calls).toEqual([]);
    expect(messages).toContain(
      "Repository is not opted into agent Oxlint; skipping",
    );
    expect(existsSync(cache)).toBe(false);
  });

  test("uses the managed cache without changing the host repository", async () => {
    const { repo, cache } = fixture();
    const calls: Array<
      readonly [string, readonly string[], string | undefined]
    > = [];
    const messages: string[] = [];
    const before = readdirSync(repo);
    const source = readFileSync(join(repo, "example.ts"), "utf-8");

    await Effect.runPromise(
      agentOxlint({ paths: ["example.ts"], all: false }).pipe(
        Effect.provide(layers({ repo, cache, calls, messages })),
      ),
    );

    expect(readdirSync(repo)).toEqual(before);
    expect(readFileSync(join(repo, "example.ts"), "utf-8")).toBe(source);
    expect(calls[0]).toEqual([
      "bun",
      ["install", "--production", "--cwd", expect.stringContaining(cache)],
      undefined,
    ]);
    expect(calls[1]?.[0]).toContain("node_modules/.bin/oxlint");
    expect(calls[1]?.[1]).toEqual([
      "--config",
      expect.stringContaining("oxlint.config.mjs"),
      "example.ts",
    ]);
    expect(calls[1]?.[2]).toBe(repo);
    const manifest = readFileSync(
      join(cache, "agent-oxlint/rules-0.1.4-oxlint-1.81.0/package.json"),
      "utf-8",
    );
    expect(manifest).toContain('"@timmo001/oxlint-rules": "0.1.4"');
    expect(manifest.match(/"1\.81\.0"/g)).toHaveLength(2);
    expect(
      readFileSync(
        join(cache, "agent-oxlint/rules-0.1.4-oxlint-1.81.0/oxlint.config.mjs"),
        "utf-8",
      ),
    ).toContain(
      '"anti-slop/require-safety-comment-for-type-assertion": "warn"',
    );
  });

  test.each([
    ["oxlint.config.ts", "example.ts\noxlint.config.ts\n"],
    ["package.json", "example.ts\npackage.json\n"],
  ] as const)(
    "skips a repository-owned Oxlint signal in %s",
    async (file, files) => {
      const { repo, cache } = fixture();
      writeFileSync(
        join(repo, file),
        file === "package.json"
          ? JSON.stringify({ scripts: { lint: "oxlint src" } })
          : "export default {};\n",
      );
      const calls: Array<
        readonly [string, readonly string[], string | undefined]
      > = [];
      const messages: string[] = [];

      await Effect.runPromise(
        agentOxlint({ paths: ["example.ts"], all: false }).pipe(
          Effect.provide(layers({ repo, cache, files, calls, messages })),
        ),
      );

      expect(calls).toEqual([]);
      expect(messages).toContain(
        "Repository Oxlint takes precedence; skipping agent pass",
      );
    },
  );

  test("reuses a ready cache, supports --all, and preserves lint failure", async () => {
    const { repo, cache } = fixture();
    seedInstalledCache(cache);
    const directory = join(cache, "agent-oxlint/rules-0.1.4-oxlint-1.81.0");
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify(
        {
          name: "dot-agent-oxlint",
          private: true,
          type: "module",
          dependencies: {
            "@oxlint/plugins": "1.81.0",
            "@timmo001/oxlint-rules": "0.1.4",
            oxlint: "1.81.0",
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(directory, "oxlint.config.mjs"),
      [
        'import { defineConfig } from "oxlint";',
        'import recommended from "@timmo001/oxlint-rules/configs/recommended";',
        "",
        "export default defineConfig({",
        "  extends: [recommended],",
        '  rules: {\n    "anti-slop/require-safety-comment-for-type-assertion": "warn"\n  },',
        "});",
        "",
      ].join("\n"),
    );
    const calls: Array<
      readonly [string, readonly string[], string | undefined]
    > = [];
    const messages: string[] = [];

    await Effect.runPromise(
      agentOxlint({ paths: [], all: true }).pipe(
        Effect.provide(layers({ repo, cache, lintExit: 7, calls, messages })),
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1].at(-1)).toBe(".");
    expect(process.exitCode).toBe(7);
  });

  test("rejects missing, conflicting, and escaping paths", async () => {
    const { repo, cache } = fixture();
    const calls: Array<
      readonly [string, readonly string[], string | undefined]
    > = [];
    const messages: string[] = [];
    const layer = layers({ repo, cache, calls, messages });

    for (const options of [
      { paths: [], all: false },
      { paths: ["example.ts"], all: true },
      { paths: ["../outside.ts"], all: false },
    ]) {
      const error = await Effect.runPromise(
        agentOxlint(options).pipe(Effect.flip, Effect.provide(layer)),
      );
      expect(error._tag).toBe("AgentOxlintError");
    }
    expect(calls).toEqual([]);
  });
});
