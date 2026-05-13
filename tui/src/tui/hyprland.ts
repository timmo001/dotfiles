import { Effect } from "effect";

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
  }).pipe(Effect.catchAll(() => Effect.void));
