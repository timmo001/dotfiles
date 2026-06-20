import { Effect } from "effect";

/** A floating Hyprland window size in pixels. */
export interface FloatingSize {
  /** Window width in pixels. */
  readonly width: number;
  /** Window height in pixels. */
  readonly height: number;
}

/** Omarchy default floating size, used by every view except the dashboard. */
export const DEFAULT_FLOATING_SIZE: FloatingSize = { width: 875, height: 600 };

/** Custom floating size used by the dashboard view. */
export const DASHBOARD_FLOATING_SIZE: FloatingSize = {
  width: 996,
  height: 600,
};

/** Resize the active Hyprland window to the given dimensions, only if floating. */
export const resizeIfFloating = (
  width: number,
  height: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const proc = Bun.spawn(["hyprctl", "activewindow", "-j"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = yield* Effect.promise(() => new Response(proc.stdout).text());
    const win = JSON.parse(text) as { floating?: boolean };
    if (win.floating) {
      Bun.spawn(
        [
          "hyprctl",
          "dispatch",
          "resizewindowpixel",
          `exact ${width} ${height},active`,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
    }
  }).pipe(Effect.catch(() => Effect.void));
