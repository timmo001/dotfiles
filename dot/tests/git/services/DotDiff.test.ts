import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DotDiff } from "../../../src/git/services/DotDiff.js";
import { CommandExecutor } from "../../../src/services/CommandExecutor.js";
import { Config, type ConfigService } from "../../../src/services/Config.js";
import {
  emptyDotGitConfig,
  type DotGitConfig,
} from "../../../src/services/GitConfig.js";
import { emptyMcpConfig } from "../../../src/mcp/sync/loadSpec.js";
import { OutputLog } from "../../../src/services/OutputLog.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("DotDiff", () => {
  test("scans status without taking optional index locks", async () => {
    const root = join(
      process.env.TMPDIR ?? "/tmp",
      `dot-diff-test-${process.pid}-${Date.now()}`,
    );
    tempRoots.push(root);
    mkdirSync(join(root, ".git"), { recursive: true });

    const calls: Array<readonly [string, readonly string[]]> = [];
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: (command, args) =>
        Effect.sync(() => {
          calls.push([command, args]);
          if (args.includes("status")) return " M tracked\n";
          return "";
        }),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.succeed(1),
      inherit: () => Effect.die("inherit should not be called"),
    });
    const config = Layer.succeed(Config, testConfig(root));
    const outputLog = Layer.succeed(OutputLog, {
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
      section: () => Effect.void,
      stream: Stream.empty,
      flush: Effect.succeed(""),
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    });
    const dotDiffLayer = DotDiff.layer.pipe(
      Layer.provideMerge(commandExecutor),
      Layer.provideMerge(config),
      Layer.provideMerge(outputLog),
    );

    const repos = await Effect.runPromise(
      Effect.gen(function* () {
        const dotDiff = yield* DotDiff;
        return yield* dotDiff.getAll({ noFetch: true });
      }).pipe(Effect.provide(dotDiffLayer)),
    );

    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ isDirty: true, modified: 1 });
    expect(calls[0]).toEqual([
      "git",
      ["--no-optional-locks", "status", "--porcelain"],
    ]);
  });

  test("only applies activity schedules to scheduled scans", async () => {
    const root = join(
      process.env.TMPDIR ?? "/tmp",
      `dot-diff-schedule-test-${process.pid}-${Date.now()}`,
    );
    const publicDotfiles = join(root, "dotfiles");
    const scheduledRepo = join(root, "scheduled");
    tempRoots.push(root);
    mkdirSync(join(publicDotfiles, ".git"), { recursive: true });
    mkdirSync(join(scheduledRepo, ".git"), { recursive: true });

    const gitConfig: DotGitConfig = {
      filePath: join(root, "dot-git.yml"),
      present: true,
      valid: true,
      repositories: [
        {
          name: "scheduled",
          path: scheduledRepo,
          github: "example/scheduled",
          aliases: [],
          postUpdate: null,
          activity: { enabled: true, schedule: "0 0 31 2 *" },
          notifications: {
            enabled: false,
            schedule: "* * * * *",
            bar: { ignoreBotActivity: false },
          },
        },
      ],
      shortcuts: [],
      diagnostics: [],
    };
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () => Effect.succeed(""),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.succeed(1),
      inherit: () => Effect.die("inherit should not be called"),
    });
    const config = Layer.succeed(Config, {
      ...testConfig(publicDotfiles),
      canUsePrivate: true,
      privateReason: "enabled for test",
      gitConfig,
    });
    const outputLog = Layer.succeed(OutputLog, {
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
      section: () => Effect.void,
      stream: Stream.empty,
      flush: Effect.succeed(""),
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    });
    const dotDiffLayer = DotDiff.layer.pipe(
      Layer.provideMerge(commandExecutor),
      Layer.provideMerge(config),
      Layer.provideMerge(outputLog),
    );

    const [allRepos, scheduledRepos] = await Effect.runPromise(
      Effect.gen(function* () {
        const dotDiff = yield* DotDiff;
        return yield* Effect.all([
          dotDiff.getAll({ noFetch: true }),
          dotDiff.getAll({ noFetch: true, scheduledOnly: true }),
        ]);
      }).pipe(Effect.provide(dotDiffLayer)),
    );

    expect(allRepos.map((repo) => repo.path)).toEqual([
      publicDotfiles,
      scheduledRepo,
    ]);
    expect(scheduledRepos.map((repo) => repo.path)).toEqual([publicDotfiles]);
  });
});

function testConfig(publicDotfiles: string): ConfigService {
  const unavailable = join(publicDotfiles, "unavailable");
  return {
    publicDotfiles,
    privateDotfiles: null,
    canUsePrivate: false,
    privateReason: "disabled for test",
    notesDir: unavailable,
    omarchy: {
      repoBase: unavailable,
      diffRepos: [],
      worktreeRepos: [],
      worktreeBranches: [],
      expectedBranches: {},
      enabled: false,
    },
    gitConfig: emptyDotGitConfig(join(unavailable, "dot-git.yml")),
    mcpConfig: emptyMcpConfig(join(unavailable, "mcp.yml")),
    cacheDir: join(publicDotfiles, "cache"),
    stateDir: join(publicDotfiles, "state"),
    logDir: join(publicDotfiles, "state", "logs"),
  };
}
