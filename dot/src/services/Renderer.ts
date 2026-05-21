import { Context, Effect, Layer } from "effect";
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { shutdownServer } from "./OpenCodeServer.js";
import type { Theme } from "../theme.js";

const log = (msg: string) => console.error(`[dot:Renderer] ${msg}`);

/**
 * Effect service wrapping the OpenTUI {@link CliRenderer} with scoped lifecycle.
 *
 * Acquired on entry to TUI mode; destroyed when the scope closes (or the
 * process exits). CLI-mode code paths do not include this service.
 */
export class Renderer extends Context.Service<Renderer, CliRenderer>()(
  "Renderer",
) {
  /**
   * Create a layer that acquires the renderer on construction
   * and destroys it on scope finalisation.
   */
  static layer(theme: Theme) {
    return Layer.effect(
      Renderer,
      Effect.acquireRelease(
        Effect.promise(() => {
          log("Creating renderer...");
          return createCliRenderer({
            exitOnCtrlC: true,
            screenMode: "alternate-screen",
            useMouse: false,
            backgroundColor: theme.transparent ? "transparent" : theme.bg,
            onDestroy: () => {
              shutdownServer();
              process.exit(0);
            },
          });
        }),
        (renderer) =>
          Effect.sync(() => {
            log("Destroying renderer");
            renderer.destroy();
          }),
      ),
    );
  }
}
