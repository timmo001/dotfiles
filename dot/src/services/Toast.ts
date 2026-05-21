import { Context, Effect, Layer } from "effect";
import type { ToastVariant } from "../types.js";
import type { Theme } from "../theme.js";
import { Toast as ToastRenderable } from "../tui/Toast.js";
import { Renderer } from "./Renderer.js";

/** Service interface for the toast notification overlay */
export interface ToastService {
  /**
   * Show a toast notification.
   *
   * If `id` matches the current toast, the message and variant are replaced
   * in-place. Otherwise the previous toast is dismissed and a new one shown.
   */
  readonly show: (id: string, message: string, variant: ToastVariant) => void;

  /** Hide the current toast and clear state */
  readonly dismiss: () => void;
}

/**
 * Effect service for {@link ToastService}.
 *
 * Creates the toast renderable on the renderer root and exposes
 * show/dismiss methods. Depends on {@link Renderer}.
 */
export class Toast extends Context.Service<Toast, ToastService>()("Toast") {
  static layer(theme: Theme) {
    return Layer.effect(
      Toast,
      Effect.gen(function* () {
        const renderer = yield* Renderer;
        const impl = new ToastRenderable(renderer, theme);
        return {
          show: (id, message, variant) => impl.show(id, message, variant),
          dismiss: () => impl.dismiss(),
        };
      }),
    );
  }
}
