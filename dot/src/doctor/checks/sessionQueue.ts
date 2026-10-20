import { Effect } from "effect";
import { probe, readSessionQueueConfig } from "../../lib/sessionQueue.js";
import type { CheckResult } from "../types.js";

/** Check the HA box queue folder is reachable over SSH and writable. */
export const checkSessionQueue = Effect.gen(function* () {
  const queue = yield* readSessionQueueConfig;

  if (!queue)
    return [
      { severity: "ok", message: "Session queue not configured" },
    ] satisfies CheckResult[];

  return yield* probe(queue).pipe(
    Effect.as<CheckResult[]>([
      { severity: "ok", message: `Session queue reachable at ${queue.ssh}` },
    ]),
    Effect.catch((error) =>
      Effect.succeed<CheckResult[]>([
        {
          severity: "warn",
          message: `Session queue unreachable or missing at ${queue.ssh}:${queue.path}`,
          detail: error.message,
        },
      ]),
    ),
  );
});
