import { Effect } from "effect";
import { reloadAgents } from "../lib/agentRuntime.js";
import { OutputLog } from "../services/OutputLog.js";
import { updatesRefresh } from "./Updates.js";

/** Parts that `dot reload` can reload. */
export const RELOAD_PARTS = ["updates", "agents"] as const;

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

/** Reload the selected parts, or all of them except agents. */
export const reload = Effect.fn("reload")(function* (options: ReloadOptions) {
  const log = yield* OutputLog;

  const selected = new Set<ReloadPart>(
    options.parts.length ? options.parts : DEFAULT_RELOAD_PARTS,
  );

  yield* log.section("Reload");

  if (selected.has("updates")) yield* updates;

  if (selected.has("agents")) yield* reloadAgents;
});
