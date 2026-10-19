import { Extension } from "@timmo001/effect-gh";
import {
  HerdrSdk,
  herdrSdkLayerFromOptions,
  PaneId,
} from "@timmo001/effect-herdr";
import { Duration, Effect, FileSystem, Schema, Scope } from "effect";
import { Prompt } from "effect/cli";
import { tmpdir } from "os";
import { join } from "path";
import { isAgent } from "../lib/agent.js";
import { cliStyler } from "../lib/ansi.js";
import { ENV, envString } from "../lib/env.js";
import { HOME_DIR, STATE_DIR } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import { rebuild } from "../lib/selfUpdate.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { DEFAULT_SOCKET_PATH } from "./HerdrRepoOpen.js";

const TOPGRADE_UPDATES = [
  ["Topgrade: Yazi", "yazi", false],
  ["Topgrade: ProtonPlus", "protonplus", false],
  ["Topgrade: Firmware", "firmware", false],
  ["Topgrade: Rustup", "rustup", false],
  ["Topgrade: TLDR", "tldr", false],
  ["Topgrade: Neovim", "vim", false],
  ["Topgrade: Containers", "containers", false],
  ["Topgrade: Claude Code", "claude_code", false],
  ["Topgrade: Claude Code plugins", "claude_code_plugins", false],
  ["Topgrade: uv", "uv", false],
] as const;

/** Steps `dot update system --step` accepts, in display order. */
export const UPDATE_STEPS = [
  "dotfiles",
  "omarchy",
  "github-cli",
  ...TOPGRADE_UPDATES.map(([, value]) => value),
] as const;

type UpdateChoice = (typeof UPDATE_STEPS)[number];

const UPDATE_CHOICES: ReadonlyArray<{
  readonly title: string;
  readonly value: UpdateChoice;
  readonly selected: boolean;
}> = [
  { title: "Dotfiles", value: "dotfiles", selected: true },
  { title: "Omarchy", value: "omarchy", selected: true },
  { title: "GitHub CLI extensions", value: "github-cli", selected: true },
  ...TOPGRADE_UPDATES.map(([title, value, selected]) => ({
    title,
    value,
    selected,
  })),
];

function section(title: string): void {
  process.stdout.write(`\n${cliStyler().heading(title)}\n`);
}

function temporarySudoEnvironment(): Effect.Effect<
  Readonly<Record<string, string>>,
  never,
  FileSystem.FileSystem | Scope.Scope
> {
  if (
    !isAgent() ||
    (process.stdin.isTTY === true && process.stdout.isTTY === true)
  ) {
    return Effect.succeed({});
  }

  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const directory = yield* fs.makeTempDirectoryScoped({
      directory: tmpdir(),
      prefix: "dot-system-update-",
    });

    yield* fs.symlink(
      join(HOME_DIR, ".local", "libexec", "update-sudo"),
      join(directory, "sudo"),
    );

    return directory;
  }).pipe(
    Effect.orDie,
    Effect.map((directory) => ({
      PATH: `${directory}:${process.env.PATH ?? ""}`,
    })),
  );
}

const runChild = Effect.fn("SystemUpdate.runChild")(function* (
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) {
  const executor = yield* CommandExecutor;

  return yield* executor.inherit(command, args, {
    ...(Object.keys(env).length > 0 && { env }),
  });
});

const runSteps = Effect.fn("SystemUpdate.runSteps")(function* (
  selectedSet: ReadonlySet<UpdateChoice>,
  automatic: boolean,
  baseEnv: Readonly<Record<string, string>>,
  summaryFile: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if (selectedSet.has("dotfiles")) {
    section("Dotfiles");

    const exitCode = yield* runChild(
      "dot",
      ["update", "--summary-file", summaryFile],
      baseEnv,
    );

    if (exitCode !== 0) {
      process.exitCode = exitCode;

      return;
    }
  }

  if (selectedSet.has("omarchy")) {
    section("Omarchy");
    let exitCode = yield* runChild("dot", ["stow", "--public"], baseEnv);

    if (exitCode === 0) {
      yield* fs.makeDirectory(join(STATE_DIR, "mise"), { recursive: true });
      exitCode = yield* runChild("omarchy", ["update", "-y"], {
        ...baseEnv,
        MISE_GLOBAL_CONFIG_FILE: join(STATE_DIR, "mise", "omarchy-config.toml"),
      });
    }

    if (exitCode !== 0) {
      process.exitCode = exitCode;

      return;
    }
  }

  if (selectedSet.has("github-cli")) {
    section("GitHub CLI Extensions");

    const exitCode = yield* Extension.upgradeAll({
      interactive: true,
      timeout: null,
      env: baseEnv,
    }).pipe(
      Effect.as(0),
      Effect.catchTag("GhCommandError", (error) =>
        Effect.succeed(error.exitCode),
      ),
      Effect.orElseSucceed(() => 1),
    );

    if (exitCode !== 0) {
      process.exitCode = exitCode;

      return;
    }
  }

  const topgrade = TOPGRADE_UPDATES.flatMap(([, value]) =>
    selectedSet.has(value) ? [value] : [],
  );

  if (topgrade.length > 0) {
    section("Topgrade");

    const args =
      topgrade.length === TOPGRADE_UPDATES.length
        ? automatic
          ? ["-y"]
          : []
        : ["--only", ...topgrade];

    const exitCode = yield* runChild("topgrade", args, baseEnv);

    if (exitCode !== 0) {
      process.exitCode = exitCode;

      return;
    }
  }

  section("Update Status");

  const refreshExitCode = yield* runChild(
    "dot",
    ["updates", "refresh"],
    baseEnv,
  );

  if (refreshExitCode !== 0) process.exitCode = refreshExitCode;
});

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Run the given steps under `dot update system` in a pane split off this one,
 * leaving focus here. The pane stays open once the run finishes.
 */
const splitPane = Effect.fn("SystemUpdate.splitPane")(
  function* (steps: readonly UpdateChoice[], automatic: boolean) {
    const herdr = yield* HerdrSdk;

    const from = yield* Schema.decodeUnknownEffect(PaneId)(
      envString(ENV.HERDR_PANE_ID),
    );

    const pane = yield* herdr.panes.split(from, {
      direction: "right",
      cwd: HOME_DIR,
      focus: false,
    });

    yield* herdr.panes.rename(pane.id, "Dotfiles update");

    yield* herdr.panes.sendInput(pane.id, {
      text: [
        "dot",
        "update",
        "system",
        ...steps.flatMap((step) => ["--step", step]),
        ...(automatic ? ["--yes"] : []),
      ]
        .map(quote)
        .join(" "),
      keys: ["enter"],
    });
  },
  Effect.provide(
    herdrSdkLayerFromOptions({
      socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
      requestTimeout: Duration.seconds(5),
    }),
  ),
);

/**
 * Pull the public and private dotfiles and rebuild dot from them, so the
 * Omarchy update and the split pane both start from the latest dotfiles.
 *
 * @returns Whether the pull and rebuild succeeded.
 */
const pullDotfiles = Effect.fn("SystemUpdate.pullDotfiles")(function* () {
  const config = yield* Config;

  section("Pull Dotfiles");

  const exitCode = yield* runChild(
    "dot",
    [
      "update",
      "--pull",
      "--no-reload",
      "--repo",
      config.publicDotfiles,
      ...(config.privateDotfiles ? ["--repo", config.privateDotfiles] : []),
    ],
    {},
  );

  if (exitCode !== 0) {
    process.exitCode = exitCode;

    return false;
  }

  return yield* rebuild.pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(
          `[ERROR] Could not rebuild dot: ${formatCause(error)}\n`,
        );
        process.exitCode = 1;

        return false;
      }),
    ),
  );
});

/**
 * Under Herdr, pull the dotfiles first, then hand every step but Omarchy to a
 * split pane so both run, and prompt for authentication, at once.
 *
 * @returns The steps left for this pane, or none when the pull failed.
 */
const splitOffOmarchy = Effect.fn("SystemUpdate.splitOffOmarchy")(function* (
  selected: readonly UpdateChoice[],
  automatic: boolean,
) {
  const others = selected.filter((step) => step !== "omarchy");

  if (
    envString(ENV.HERDR_ENV) !== "1" ||
    isAgent() ||
    !selected.includes("omarchy") ||
    others.length === 0
  )
    return selected;

  if (others.includes("dotfiles") && !(yield* pullDotfiles())) return [];

  return yield* splitPane(others, automatic).pipe(
    Effect.as(["omarchy"] as const),
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(
          `[WARN] Could not open a Herdr pane, running every update here: ${formatCause(error)}\n`,
        );

        return selected;
      }),
    ),
  );
});

/** Select and run system maintenance steps in their fixed display order. */
export const systemUpdate = Effect.fn("SystemUpdate.run")(function* (options: {
  readonly yes: boolean;
  readonly steps: readonly UpdateChoice[];
}) {
  const automatic =
    options.yes ||
    process.stdin.isTTY !== true ||
    process.stdout.isTTY !== true;

  const selected =
    options.steps.length > 0
      ? options.steps
      : automatic
        ? UPDATE_CHOICES.map(({ value }) => value)
        : yield* Prompt.run(
            Prompt.MultiSelect({
              message: "Choose updates:",
              choices: UPDATE_CHOICES,
            }),
          ).pipe(
            Effect.catchTag("QuitError", () => Effect.succeed([])),
            // NodeTerminal retains its raw readline resource for a 10 ms idle window.
            Effect.tap(() => Effect.sleep("20 millis")),
          );

  if (selected.length === 0) return;

  const fs = yield* FileSystem.FileSystem;
  const steps = yield* splitOffOmarchy(selected, automatic);

  if (steps.length === 0) return;

  const selectedSet = new Set<UpdateChoice>(steps);
  const baseEnv = yield* temporarySudoEnvironment();

  const summaryFile = join(
    yield* fs
      .makeTempDirectoryScoped({ directory: tmpdir(), prefix: "dot-summary-" })
      .pipe(Effect.orDie),
    "summary.txt",
  );

  // Print the dotfiles summary last, even when a later step fails.
  const printSummary = fs.readFileString(summaryFile).pipe(
    Effect.flatMap((summary) =>
      Effect.sync(() => process.stdout.write(summary)),
    ),
    Effect.ignore,
  );

  yield* runSteps(selectedSet, automatic, baseEnv, summaryFile).pipe(
    Effect.ensuring(printSummary),
  );
}, Effect.scoped);
