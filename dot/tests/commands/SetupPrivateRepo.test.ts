import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setupPrivatePackageRepo } from "../../src/commands/SetupPrivateRepo.js";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";
import { OutputLog } from "../../src/services/OutputLog.js";
import { ENV } from "../../src/lib/env.js";

const previousPacmanRepoConfig =
  process.env[ENV.DOT_PRIVATE_PACMAN_REPO_CONFIG];
const previousPacmanMainConfig =
  process.env[ENV.DOT_PRIVATE_PACMAN_MAIN_CONFIG];
const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dot-setup-private-repo-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  if (previousPacmanRepoConfig === undefined) {
    delete process.env[ENV.DOT_PRIVATE_PACMAN_REPO_CONFIG];
  } else {
    process.env[ENV.DOT_PRIVATE_PACMAN_REPO_CONFIG] = previousPacmanRepoConfig;
  }

  if (previousPacmanMainConfig === undefined) {
    delete process.env[ENV.DOT_PRIVATE_PACMAN_MAIN_CONFIG];
  } else {
    process.env[ENV.DOT_PRIVATE_PACMAN_MAIN_CONFIG] = previousPacmanMainConfig;
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("setupPrivatePackageRepo", () => {
  test("skips source clone when the mirror database and pacman config are current", async () => {
    const root = tempRoot();
    const sourcePath = join(root, "source");
    const mirrorPath = join(root, "mirror");
    const pacmanRepoConfig = join(root, "timmo-private.conf");
    const pacmanMainConfig = join(root, "pacman.conf");

    mkdirSync(mirrorPath, { recursive: true });
    writeFileSync(join(mirrorPath, "timmo-private.db"), "database");
    writeFileSync(
      pacmanRepoConfig,
      `[timmo-private]\nSigLevel = Optional TrustAll\nServer = file://${mirrorPath}\n`,
    );
    writeFileSync(pacmanMainConfig, `Include = ${pacmanRepoConfig}\n`);
    process.env[ENV.DOT_PRIVATE_PACMAN_REPO_CONFIG] = pacmanRepoConfig;
    process.env[ENV.DOT_PRIVATE_PACMAN_MAIN_CONFIG] = pacmanMainConfig;

    const messages: string[] = [];
    const inherited: Array<readonly [string, readonly string[]]> = [];
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: (command, args) =>
        Effect.succeed(command === "which" && args[0] === "sudo" ? 0 : 1),
      inherit: (command, args) =>
        Effect.sync(() => {
          inherited.push([command, args]);
          return 0;
        }),
    });
    const outputLog = Layer.succeed(OutputLog, {
      info: (message) => Effect.sync(() => void messages.push(message)),
      warn: () => Effect.void,
      error: () => Effect.void,
      section: () => Effect.void,
      stream: Stream.empty,
      flush: Effect.succeed(""),
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    });

    await Effect.runPromise(
      setupPrivatePackageRepo({
        name: "timmo-private",
        remote: null,
        path: sourcePath,
        mirrorPath,
        sigLevel: "Optional TrustAll",
      }).pipe(Effect.provide(Layer.merge(commandExecutor, outputLog))),
    );

    expect(messages).toContain(
      "Private pacman repo already configured; skipping source clone",
    );
    expect(inherited).toEqual([["sudo", ["pacman", "-Sy", "--noconfirm"]]]);
  });

  test("does not treat an empty mirror as installed", async () => {
    const root = tempRoot();
    const sourcePath = join(root, "source");
    const mirrorPath = join(root, "mirror");
    const pacmanRepoConfig = join(root, "timmo-private.conf");
    const pacmanMainConfig = join(root, "pacman.conf");

    mkdirSync(mirrorPath, { recursive: true });
    writeFileSync(
      pacmanRepoConfig,
      `[timmo-private]\nSigLevel = Optional TrustAll\nServer = file://${mirrorPath}\n`,
    );
    writeFileSync(pacmanMainConfig, `Include = ${pacmanRepoConfig}\n`);
    process.env[ENV.DOT_PRIVATE_PACMAN_REPO_CONFIG] = pacmanRepoConfig;
    process.env[ENV.DOT_PRIVATE_PACMAN_MAIN_CONFIG] = pacmanMainConfig;

    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: () => Effect.die("inherit should not be called"),
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

    const error = await Effect.runPromise(
      setupPrivatePackageRepo({
        name: "timmo-private",
        remote: null,
        path: sourcePath,
        mirrorPath,
        sigLevel: "Optional TrustAll",
      }).pipe(
        Effect.provide(Layer.merge(commandExecutor, outputLog)),
        Effect.flip,
      ),
    );
    expect(error).toMatchObject({
      message: expect.stringContaining(
        "Missing private package repo source clone",
      ),
    });
  });
});
