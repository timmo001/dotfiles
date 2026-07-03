/**
 * @file Desktop-notification service for MCP-driven actions.
 *
 * Emits system notifications (via `notify-send`) when an agent performs a
 * mutating action through the MCP server, so the user stays aware of background
 * changes regardless of which harness launched `dot mcp`. This replaces the
 * OpenCode-only push toast with a cross-harness notification.
 *
 * The seam is a service so the real implementation can later be swapped for the
 * system-bridge notifier without touching call sites. Interactive CLI/TUI paths
 * use {@link Notifier.layerNoop}.
 */
import { Context, Effect, Layer } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";

/** Service interface for emitting desktop notifications. */
export interface NotifierService {
  /** Send a best-effort desktop notification. Never fails. */
  readonly notify: (title: string, message: string) => Effect.Effect<void>;
}

/** Effect service for {@link NotifierService}. */
export class Notifier extends Context.Service<Notifier, NotifierService>()(
  "Notifier",
) {
  /**
   * Real notifier backed by `notify-send`. Non-fatal: a missing notification
   * daemon or binary is swallowed so it never breaks the triggering action.
   */
  static readonly layerNotifySend = Layer.effect(
    Notifier,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      return {
        notify: (title, message) =>
          executor.exitCode("notify-send", [title, message]).pipe(
            Effect.catchCause(() => Effect.void),
            Effect.asVoid,
          ),
      };
    }),
  );

  /** No-op notifier for interactive CLI/TUI paths. */
  static readonly layerNoop = Layer.succeed(Notifier, {
    notify: () => Effect.void,
  });
}
