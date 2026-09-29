import { join } from "node:path";
import { Clock, Effect, FileSystem } from "effect";
import { STATE_DIR } from "./paths.js";

/** How long a manual start marker stays valid after it is written. */
const MANUAL_START_TTL_MILLIS = 2 * 60_000;

/** Path of the one-shot marker that flags a manual start of a systemd unit. */
export const manualStartMarker = (unit: string) =>
  join(STATE_DIR, "dot", "services", "manual-start", unit);

/** Record that the user started a unit by hand, just before systemd starts it. */
export const writeManualStart = Effect.fn("ManualStart.write")(function* (
  unit: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const marker = manualStartMarker(unit);

  yield* fs.makeDirectory(join(marker, ".."), { recursive: true });
  yield* fs.writeFileString(marker, String(yield* Clock.currentTimeMillis));
});

/** Remove a unit's manual start marker, returning whether a fresh one existed. */
export const consumeManualStart = Effect.fn("ManualStart.consume")(function* (
  unit: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const marker = manualStartMarker(unit);

  const written = yield* fs.readFileString(marker).pipe(
    Effect.map(Number),
    Effect.orElseSucceed(() => Number.NaN),
  );

  yield* fs.remove(marker, { force: true });

  return (
    Number.isFinite(written) &&
    (yield* Clock.currentTimeMillis) - written < MANUAL_START_TTL_MILLIS
  );
});
