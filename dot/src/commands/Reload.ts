import { resolveSocketPath, UpnextClient } from "@timmo001/effect-upnext";
import { Effect, FileSystem, Option } from "effect";
import { basename } from "path";
import { applyOmarchyShellConfig } from "../lib/omarchyShellConfig.js";
import { WORKSPACE_MUTATION_LOCK_PATH } from "../lib/workspaceMutationLock.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { updatesRefresh } from "./Updates.js";

/** Parts of the desktop that `dot reload` can reload. */
export const RELOAD_PARTS = [
  "keyboard",
  "upnext",
  "shell",
  "updates",
  "doctor",
] as const;

/** One reloadable part of the desktop. */
export type ReloadPart = (typeof RELOAD_PARTS)[number];

/** Options for {@link reload}. */
export interface ReloadOptions {
  /** Parts to reload; empty reloads every part. */
  readonly parts: readonly ReloadPart[];
  /** Skip opening auto-open live channels during the upnext recheck. */
  readonly noAutoOpen: boolean;
}

const REFRESHED_SHELL_MODULES = [
  "omarchy.indicators",
  "omarchy.clock",
  "timmo.git",
] as const;

const HOLDER_EXIT_ATTEMPTS = 30;

const keyboard = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  // EC-managed backlights can come back at 0 after suspend.
  if (Bun.which("kbd-backlight-rearm") === null) return;
  yield* executor.exitCode("kbd-backlight-rearm", []);
  yield* log.success("Re-armed keyboard backlight");
}).pipe(Effect.withSpan("Reload.keyboard"));

const upnext = Effect.fn("Reload.upnext")(function* (open: boolean) {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if (Bun.which("upnext") === null) {
    return yield* log.warn("upnext is not installed");
  }

  const socketPath = yield* resolveSocketPath(Option.none());

  yield* Effect.gen(function* () {
    const client = yield* UpnextClient;
    yield* client.Recheck({ open });
  }).pipe(
    Effect.provide(UpnextClient.layer(socketPath)),
    Effect.matchEffect({
      onFailure: (error) =>
        executor
          .exitCode("systemctl", ["--user", "restart", "upnext.service"])
          .pipe(
            Effect.andThen(
              log.warn(
                `upnext recheck failed (${error.message}), restarted it`,
              ),
            ),
          ),
      onSuccess: () => log.success("Rechecked upnext"),
    }),
  );
});

// A workspace command waiting on a shell menu never returns once the shell
// restarts, and keeps holding the mutation lock.
const clearWorkspaceMutationLock = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;

  const running = (pid: number) =>
    fs.exists(`/proc/${pid}`).pipe(Effect.orElseSucceed(() => false));

  const lock = yield* fs
    .readFileString(WORKSPACE_MUTATION_LOCK_PATH)
    .pipe(Effect.option);

  if (Option.isNone(lock)) return;
  const pid = Number(lock.value);

  const args =
    Number.isInteger(pid) && pid > 1
      ? yield* fs.readFileString(`/proc/${pid}/cmdline`).pipe(
          Effect.map((cmdline) =>
            cmdline.split("\0").filter((arg) => arg !== ""),
          ),
          Effect.orElseSucceed(() => []),
        )
      : [];

  if (args.length) {
    const [command = "", subcommand = ""] = args;

    if (basename(command) !== "dot" || !subcommand.startsWith("workspace-")) {
      return yield* log.warn(
        `Workspace mutation lock held by ${pid} (${args.join(" ")}), left in place`,
      );
    }

    yield* executor.exitCode("pkill", ["-TERM", "-P", String(pid)]);
    yield* executor.exitCode("kill", ["-TERM", "--", String(pid)]);

    for (
      let attempt = 0;
      attempt < HOLDER_EXIT_ATTEMPTS && (yield* running(pid));
      attempt += 1
    ) {
      yield* Effect.sleep("100 millis");
    }

    if (yield* running(pid)) {
      return yield* log.warn(
        `Workspace mutation ${pid} did not exit, lock left in place`,
      );
    }

    yield* log.success(`Stopped stuck ${args.join(" ")}`);
  }

  yield* fs
    .remove(WORKSPACE_MUTATION_LOCK_PATH, { force: true })
    .pipe(Effect.ignore);

  yield* log.success("Cleared workspace mutation lock");
}).pipe(Effect.withSpan("Reload.clearWorkspaceMutationLock"));

const shell = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  if (!config.omarchy.enabled) {
    return yield* log.info("Shell reload skipped (Omarchy disabled)");
  }

  yield* clearWorkspaceMutationLock;

  // Restores the generated layout, reversing ad-hoc `omarchy bar move` edits.
  yield* applyOmarchyShellConfig;

  const restarted = yield* executor.exitCode("omarchy", ["restart", "shell"]);

  if (restarted !== 0) {
    return yield* log.warn(
      `Shell restart failed (exit ${restarted}; session may be locked)`,
    );
  }

  yield* log.success("Restarted Omarchy shell");

  const rescanned = yield* executor.exitCode("omarchy", [
    "shell",
    "shell",
    "rescanPlugins",
  ]);

  yield* rescanned === 0
    ? log.success("Rescanned Omarchy shell plugins")
    : log.warn(`Shell plugin rescan failed (exit ${rescanned})`);

  for (const target of REFRESHED_SHELL_MODULES) {
    yield* executor.exitCode("omarchy-shell", ["-q", target, "refresh"]);
  }

  yield* log.success("Requested shell module refresh");
}).pipe(Effect.withSpan("Reload.shell"));

const updates = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* updatesRefresh({ timeout: 120 }).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        log.warn(`Available updates refresh failed: ${String(error)}`),
      onSuccess: () => log.success("Refreshed available updates"),
    }),
  );
}).pipe(Effect.withSpan("Reload.updates"));

const doctor = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  const exitCode = yield* executor.exitCode("systemctl", [
    "--user",
    "start",
    "--no-block",
    "dot-doctor.service",
  ]);

  yield* exitCode === 0
    ? log.success("Started dot doctor check")
    : log.warn(`dot doctor check failed to start (exit ${exitCode})`);
}).pipe(Effect.withSpan("Reload.doctor"));

/**
 * Reload the selected desktop parts, or all of them.
 *
 * The upnext recheck waits on every YouTube feed, so it runs alongside the
 * other parts instead of holding up the shell restart.
 */
export const reload = Effect.fn("reload")(function* (options: ReloadOptions) {
  const log = yield* OutputLog;
  const selected = new Set(options.parts.length ? options.parts : RELOAD_PARTS);
  const has = (part: ReloadPart) => selected.has(part);

  yield* log.section("Reload");

  const foreground = Effect.gen(function* () {
    if (has("keyboard")) yield* keyboard;

    if (has("shell")) yield* shell;

    if (has("updates")) yield* updates;

    if (has("doctor")) yield* doctor;
  });

  yield* Effect.all(
    [foreground, ...(has("upnext") ? [upnext(!options.noAutoOpen)] : [])],
    { concurrency: "unbounded", discard: true },
  );
});
