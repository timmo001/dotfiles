/**
 * @file A client for the dot daemon, and a helper for commands that fall back
 * to doing the work themselves when it isn't running.
 */

import { NodeSocket } from "@effect/platform-node";
import { Context, Effect, Layer, Option } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import { DaemonRpcs } from "./Rpcs.js";
import { DAEMON_SOCKET_PATH } from "./socketPath.js";

/** A connection to the dot daemon. */
export class DaemonClient extends Context.Service<
  DaemonClient,
  RpcClient.FromGroup<typeof DaemonRpcs, RpcClientError>
>()("dot/daemon/DaemonClient") {
  // Calls fail when the daemon is unreachable instead of waiting for it, so
  // watchers exit and their supervisor restarts them. A few missed pings are
  // allowed before a healthy but busy connection is dropped.
  /** Connect to the daemon's socket. */
  static readonly layer = Layer.effect(
    DaemonClient,
    RpcClient.make(DaemonRpcs),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolSocket({ pingTimeout: "15 seconds" })),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(NodeSocket.layerNet({ path: DAEMON_SOCKET_PATH })),
  );
}

/**
 * Run `use` against the daemon, or return none when it can't answer, so the
 * caller can do the work itself.
 */
export const tryDaemon = <A, E, R>(
  use: Effect.Effect<A, E, R | DaemonClient>,
): Effect.Effect<Option.Option<A>, never, Exclude<R, DaemonClient>> =>
  use.pipe(
    Effect.asSome,
    Effect.provide(DaemonClient.layer),
    Effect.orElseSucceed(() => Option.none<A>()),
  );
