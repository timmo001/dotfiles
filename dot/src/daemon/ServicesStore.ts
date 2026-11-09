/**
 * @file The dot daemon's view of the registered services, checked every
 * minute and whenever a job changes.
 */

import { Context, Effect, Layer, Schema } from "effect";
import { servicesReport } from "../commands/Services.js";
import { formatCause } from "../lib/schema.js";
import { polledStore } from "./PolledStore.js";
import { ServicesReport, StatusCheckError } from "./Rpcs.js";

// Optional fields left undefined aren't JSON, so the snapshot is sent as the
// JSON `dot services status --json` prints.
const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ServicesReport),
);

const make = polledStore(
  "ServicesStore",
  servicesReport.pipe(
    Effect.flatMap((report) => decodeReport(JSON.stringify(report))),
    Effect.mapError(
      (error) => new StatusCheckError({ message: formatCause(error) }),
    ),
  ),
  "1 minute",
);

/** The registered services' snapshot, its changes, and a way to check now. */
export type ServicesStoreService = Effect.Success<typeof make>;

/** The daemon's registered services; see {@link ServicesStoreService}. */
export class ServicesStore extends Context.Service<
  ServicesStore,
  ServicesStoreService
>()("dot/daemon/ServicesStore") {
  /** Checks the services now and every minute. */
  static readonly layer = Layer.effect(ServicesStore, make);
}
