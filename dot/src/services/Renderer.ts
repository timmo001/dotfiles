import { Context, Effect, Layer } from "effect";
import type { CliRenderer } from "@opentui/core";
import type { Theme } from "../theme.js";

const log = (msg: string) => console.error(`[dot:Renderer] ${msg}`);
let suppressNextDestroyExit = false;

/** Destroy the renderer without exiting the process, for handoff to a CLI command. */
export function destroyRendererForCommand(renderer: CliRenderer): void {
  try {
    suppressNextDestroyExit = true;
    renderer.destroy();
  } catch (error) {
    suppressNextDestroyExit = false;
    throw error;
  }
}

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
   *
   * The `@opentui/core` module is imported lazily here so that CLI-only code
   * paths (e.g. `dot git-diff --bar-json`) never trigger the native library load.
   *
   * @param theme - The resolved theme for colours/background.
   * @param nativeLibPath - Optional pre-extracted native lib path from
   *   {@link extractNativeLibIfNeeded}. When provided, `setRenderLibPath` is
   *   called immediately after import to override the eager module init.
   */
  static layer(theme: Theme, nativeLibPath?: string) {
    return Layer.effect(
      Renderer,
      Effect.acquireRelease(
        Effect.promise(async () => {
          log("Creating renderer...");
          const { createCliRenderer, setRenderLibPath } =
            await import("@opentui/core");
          if (nativeLibPath) {
            setRenderLibPath(nativeLibPath);
          }
          return createCliRenderer({
            exitOnCtrlC: true,
            screenMode: "alternate-screen",
            useMouse: true,
            autoFocus: true,
            backgroundColor: theme.transparent ? "transparent" : theme.bg,
            onDestroy: () => {
              const shouldExit = !suppressNextDestroyExit;
              suppressNextDestroyExit = false;
              if (shouldExit) process.exit(0);
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
