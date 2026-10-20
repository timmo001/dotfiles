import { Effect } from "effect";
import { reloadAgents } from "../lib/agentRuntime.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { updatesRefresh } from "./Updates.js";

/** Parts that `dot reload` can reload. */
export const RELOAD_PARTS = ["updates", "doctor", "agents"] as const;

/** One reloadable part. */
export type ReloadPart = (typeof RELOAD_PARTS)[number];

// Typing into agent sessions is never part of a plain reload.
const DEFAULT_RELOAD_PARTS = RELOAD_PARTS.filter((part) => part !== "agents");

/** Options for {@link reload}. */
export interface ReloadOptions {
  /** Parts to reload; empty reloads every part except agents. */
  readonly parts: readonly ReloadPart[];
}

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

/** Reload the selected parts, or all of them except agents. */
export const reload = Effect.fn("reload")(function* (options: ReloadOptions) {
  const log = yield* OutputLog;

  const selected = new Set<ReloadPart>(
    options.parts.length ? options.parts : DEFAULT_RELOAD_PARTS,
  );

  yield* log.section("Reload");

  if (selected.has("updates")) yield* updates;

  if (selected.has("doctor")) yield* doctor;

  if (selected.has("agents")) yield* reloadAgents;
});
