import { Effect, Scope } from "effect";
import { Prompt } from "effect/unstable/cli";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isAgent } from "../lib/agent.js";
import { HOME_DIR, STATE_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const TOPGRADE_UPDATES = [
  ["Topgrade: GitHub CLI extensions", "github_cli_extensions", true],
  ["Topgrade: Yazi", "yazi", true],
  ["Topgrade: Mise", "mise", false],
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

type UpdateChoice =
  "dotfiles" | "omarchy" | (typeof TOPGRADE_UPDATES)[number][1];

const UPDATE_CHOICES: ReadonlyArray<{
  readonly title: string;
  readonly value: UpdateChoice;
  readonly selected: boolean;
}> = [
  { title: "Dotfiles", value: "dotfiles", selected: true },
  { title: "Omarchy", value: "omarchy", selected: true },
  ...TOPGRADE_UPDATES.map(([title, value, selected]) => ({
    title,
    value,
    selected,
  })),
];

function section(title: string): void {
  process.stdout.write(`\n\u001b[1;36m${title}\u001b[0m\n`);
}

function temporarySudoEnvironment(): Effect.Effect<
  Readonly<Record<string, string>>,
  never,
  Scope.Scope
> {
  if (
    !isAgent() ||
    (process.stdin.isTTY === true && process.stdout.isTTY === true)
  ) {
    return Effect.succeed({});
  }

  return Effect.acquireRelease(
    Effect.sync(() => {
      const directory = mkdtempSync(join(tmpdir(), "dot-system-update-"));
      symlinkSync(
        join(HOME_DIR, ".local", "libexec", "update-sudo"),
        join(directory, "sudo"),
      );
      return directory;
    }),
    (directory) =>
      Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  ).pipe(
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

/** Select and run system maintenance steps in their fixed display order. */
export const systemUpdate = Effect.fn("SystemUpdate.run")(function* (options: {
  readonly yes: boolean;
}) {
  const automatic =
    options.yes ||
    process.stdin.isTTY !== true ||
    process.stdout.isTTY !== true;
  const selected = automatic
    ? UPDATE_CHOICES.map(({ value }) => value)
    : yield* Prompt.run(
        Prompt.multiSelect({
          message: "Choose updates:",
          choices: UPDATE_CHOICES,
        }),
      ).pipe(
        Effect.catchTag("QuitError", () => Effect.succeed([])),
        // NodeTerminal retains its raw readline resource for a 10 ms idle window.
        Effect.tap(() => Effect.sleep("20 millis")),
      );

  if (selected.length === 0) return;

  const selectedSet = new Set<UpdateChoice>(selected);
  const baseEnv = yield* temporarySudoEnvironment();

  if (selectedSet.has("dotfiles")) {
    section("Dotfiles");
    const exitCode = yield* runChild("dot", ["update"], baseEnv);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      return;
    }
  }

  if (selectedSet.has("omarchy")) {
    section("Omarchy");
    let exitCode = yield* runChild("dot", ["stow", "--public"], baseEnv);
    if (exitCode === 0) {
      yield* Effect.sync(() =>
        mkdirSync(join(STATE_DIR, "mise"), { recursive: true }),
      );
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

  const topgrade = TOPGRADE_UPDATES.filter(([, value]) =>
    selectedSet.has(value),
  ).map(([, value]) => value);
  if (topgrade.length === 0) return;

  section("Topgrade");
  const args =
    topgrade.length === TOPGRADE_UPDATES.length
      ? automatic
        ? ["-y"]
        : []
      : ["--only", ...topgrade];
  const exitCode = yield* runChild("topgrade", args, baseEnv);
  if (exitCode !== 0) process.exitCode = exitCode;
}, Effect.scoped);
