import { Extension } from "@timmo001/effect-gh";
import { Console, Effect, FileSystem, Scope } from "effect";
import { Prompt } from "effect/cli";
import { tmpdir } from "os";
import { join } from "path";
import { COMPOSE_CONFIG, composeUp } from "./Compose.js";
import { isAgent } from "../lib/agent.js";
import { cliStyler } from "../lib/ansi.js";
import { updateDebReleases } from "../lib/debReleases.js";
import { HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const TOPGRADE_UPDATES = [
  ["Topgrade: Yazi", "yazi", false],
  ["Topgrade: Rustup", "rustup", false],
  ["Topgrade: TLDR", "tldr", false],
  ["Topgrade: Neovim", "vim", false],
  ["Topgrade: Claude Code", "claude_code", false],
  ["Topgrade: Claude Code plugins", "claude_code_plugins", false],
  ["Topgrade: uv", "uv", false],
] as const;

/** Steps `dot update system --step` accepts, in display order. */
export const UPDATE_STEPS = [
  "dotfiles",
  "apt",
  "releases",
  "github-cli",
  "compose",
  ...TOPGRADE_UPDATES.map(([, value]) => value),
] as const;

type UpdateChoice = (typeof UPDATE_STEPS)[number];

const updateChoices = (
  compose: boolean,
): ReadonlyArray<{
  readonly title: string;
  readonly value: UpdateChoice;
  readonly selected: boolean;
}> => [
  { title: "Dotfiles", value: "dotfiles", selected: true },
  { title: "Apt packages", value: "apt", selected: true },
  { title: "GitHub release packages", value: "releases", selected: true },
  { title: "GitHub CLI extensions", value: "github-cli", selected: true },
  ...(compose
    ? [{ title: "Compose up", value: "compose" as const, selected: true }]
    : []),
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
  selfUpdate: boolean,
) {
  if (selectedSet.has("dotfiles")) {
    section("Dotfiles");

    const exitCode = yield* runChild(
      "dot",
      [
        "update",
        ...(selfUpdate ? [] : ["--no-self-update"]),
        "--summary-file",
        summaryFile,
      ],
      baseEnv,
    );

    if (exitCode !== 0) {
      process.exitCode = exitCode;

      return;
    }
  }

  if (selectedSet.has("apt")) {
    section("Apt Packages");

    let exitCode = yield* runChild("sudo", ["apt-get", "update"], baseEnv);

    if (exitCode === 0) {
      exitCode = yield* runChild(
        "sudo",
        ["apt-get", "upgrade", ...(automatic ? ["-y"] : [])],
        baseEnv,
      );
    }

    if (exitCode !== 0) {
      process.exitCode = exitCode;

      return;
    }
  }

  if (selectedSet.has("releases")) {
    section("GitHub Release Packages");

    const exitCode = yield* updateDebReleases(baseEnv).pipe(
      Effect.catch((error) =>
        Console.error(`[ERROR] ${error.message}`).pipe(Effect.as(1)),
      ),
    );

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

  if (selectedSet.has("compose")) {
    const exitCode = yield* composeUp([]).pipe(
      Effect.catch((error) =>
        Console.error(`[ERROR] ${error.message}`).pipe(Effect.as(1)),
      ),
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

/** Select and run system maintenance steps in their fixed display order. */
export const systemUpdate = Effect.fn("SystemUpdate.run")(function* (options: {
  readonly yes: boolean;
  readonly steps: readonly UpdateChoice[];
  readonly selfUpdate: boolean;
}) {
  const automatic =
    options.yes ||
    process.stdin.isTTY !== true ||
    process.stdout.isTTY !== true;

  const fs = yield* FileSystem.FileSystem;

  const choices = updateChoices(
    yield* fs.exists(COMPOSE_CONFIG).pipe(Effect.orElseSucceed(() => false)),
  );

  const selected =
    options.steps.length > 0
      ? options.steps
      : automatic
        ? choices.map(({ value }) => value)
        : yield* Prompt.run(
            Prompt.MultiSelect({
              message: "Choose updates:",
              choices,
            }),
          ).pipe(
            Effect.catchTag("QuitError", () => Effect.succeed([])),
            // NodeTerminal retains its raw readline resource for a 10 ms idle window.
            Effect.tap(() => Effect.sleep("20 millis")),
          );

  if (selected.length === 0) return;

  const selectedSet = new Set<UpdateChoice>(selected);
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

  yield* runSteps(
    selectedSet,
    automatic,
    baseEnv,
    summaryFile,
    options.selfUpdate,
  ).pipe(Effect.ensuring(printSummary));
}, Effect.scoped);
