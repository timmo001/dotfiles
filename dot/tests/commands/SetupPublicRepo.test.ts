import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  primaryFingerprint,
  publicPackageRepoConfigContents,
  publicPackageRepoConfigMatches,
  publicPackageRepoIncludeRegistered,
  setupPublicRepo,
  withPublicPackageRepoInclude,
} from "../../src/commands/SetupPublicRepo.js";
import { ENV } from "../../src/lib/env.js";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";
import { OutputLog } from "../../src/services/OutputLog.js";

const fingerprint = "F94469C08E3B717014E2815FA026A3671E9151DA";
const roots: string[] = [];

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

afterEach(() => {
  delete process.env[ENV.DOT_PUBLIC_PACMAN_REPO_CONFIG];
  delete process.env[ENV.DOT_PUBLIC_PACMAN_MAIN_CONFIG];
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("public repository setup", () => {
  test("reads the primary fingerprint rather than the signing subkey", () => {
    expect(
      primaryFingerprint(
        `pub:-:255:22:A026A3671E9151DA:0:0::::::\nfpr:::::::::${fingerprint}:\nsub:-:255:22:371AFA9549E3CD48:0:0::::::\nfpr:::::::::E6BCD7483BE088D6576AD675371AFA9549E3CD48:`,
      ),
    ).toBe(fingerprint);
    expect(
      primaryFingerprint("sub:-:255:22:key:\nfpr:::::::::wrong:"),
    ).toBeNull();
  });

  test("inserts one include before package repositories and keeps options first", () => {
    const configured = withPublicPackageRepoInclude(
      "[options]\nArchitecture = auto\n\n[core]\nInclude = /etc/pacman.d/mirrorlist\n",
    );
    expect(configured).toBe(
      "[options]\nArchitecture = auto\n\nInclude = /etc/pacman.d/timmo.conf\n\n[core]\nInclude = /etc/pacman.d/mirrorlist\n",
    );
    expect(withPublicPackageRepoInclude(configured)).toBe(configured);
  });

  test("only reports the exact signed config in overlay position as ready", () => {
    const root = mkdtempSync(join(tmpdir(), "dot-public-repo-"));
    roots.push(root);
    const repoConfig = join(root, "timmo.conf");
    const mainConfig = join(root, "pacman.conf");
    process.env[ENV.DOT_PUBLIC_PACMAN_REPO_CONFIG] = repoConfig;
    process.env[ENV.DOT_PUBLIC_PACMAN_MAIN_CONFIG] = mainConfig;

    writeFileSync(repoConfig, publicPackageRepoConfigContents());
    writeFileSync(
      mainConfig,
      withPublicPackageRepoInclude("[options]\n\n[core]\nServer = test\n"),
    );
    expect(publicPackageRepoConfigMatches()).toBe(true);
    expect(publicPackageRepoIncludeRegistered()).toBe(true);

    writeFileSync(
      repoConfig,
      "[timmo]\nSigLevel = Optional TrustAll\nServer = https://packages.timmo.dev/$arch\n",
    );
    expect(publicPackageRepoConfigMatches()).toBe(false);
  });

  test("fails before privileged changes when the repository is unavailable", async () => {
    let inheritedCommands = 0;
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: (command, args) =>
        Effect.succeed(command === "curl" && args.includes("-fsSI") ? 22 : 0),
      inherit: () => Effect.sync(() => ++inheritedCommands),
    });

    await expect(
      Effect.runPromise(
        setupPublicRepo.pipe(
          Effect.provide(Layer.merge(commandExecutor, outputLog)),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("database is unavailable"),
    });
    expect(inheritedCommands).toBe(0);
  });

  test("fails before privileged changes when the key fingerprint mismatches", async () => {
    let inheritedCommands = 0;
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () =>
        Effect.succeed(
          "pub:-:255:22:BAD:0:0::::::\nfpr:::::::::0000000000000000000000000000000000000000:",
        ),
      stream: () => Stream.die("stream should not be called"),
      exitCode: (command, args) =>
        Effect.sync(() => {
          if (command === "curl" && args.includes("-o")) {
            writeFileSync(args[args.indexOf("-o") + 1], "bad key");
          }
          return 0;
        }),
      inherit: () => Effect.sync(() => ++inheritedCommands),
    });

    await expect(
      Effect.runPromise(
        setupPublicRepo.pipe(
          Effect.provide(Layer.merge(commandExecutor, outputLog)),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("fingerprint mismatch"),
    });
    expect(inheritedCommands).toBe(0);
  });

  test("refreshes package databases after registering the repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "dot-public-repo-"));
    roots.push(root);
    const repoConfig = join(root, "timmo.conf");
    const mainConfig = join(root, "pacman.conf");
    process.env[ENV.DOT_PUBLIC_PACMAN_REPO_CONFIG] = repoConfig;
    process.env[ENV.DOT_PUBLIC_PACMAN_MAIN_CONFIG] = mainConfig;
    writeFileSync(repoConfig, publicPackageRepoConfigContents());
    writeFileSync(
      mainConfig,
      withPublicPackageRepoInclude("[options]\n\n[core]\nServer = test\n"),
    );

    const inheritedCommands: Array<readonly [string, readonly string[]]> = [];
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () =>
        Effect.succeed(
          `pub:-:255:22:A026A3671E9151DA:0:0::::::\nfpr:::::::::${fingerprint}:`,
        ),
      stream: () => Stream.die("stream should not be called"),
      exitCode: (command, args) =>
        Effect.sync(() => {
          if (command === "curl" && args.includes("-o")) {
            writeFileSync(args[args.indexOf("-o") + 1], "repository key");
          }
          return 0;
        }),
      inherit: (command, args) =>
        Effect.sync(() => {
          inheritedCommands.push([command, args]);
          return 0;
        }),
    });

    await Effect.runPromise(
      setupPublicRepo.pipe(
        Effect.provide(Layer.merge(commandExecutor, outputLog)),
      ),
    );

    expect(inheritedCommands.at(-1)?.[1]).toEqual([
      "pacman",
      "-Sy",
      "--noconfirm",
    ]);
  });
});
