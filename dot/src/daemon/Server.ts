/**
 * @file The dot daemon: serves {@link DaemonRpcs} (the update status, the
 * registered services and the Git panel) over a Unix socket until SIGINT,
 * SIGTERM or SIGHUP, following the upnext and ha-bridge servers.
 */

import { NodeSocketServer } from "@effect/platform-node";
import {
  Cause,
  Deferred,
  Effect,
  FileSystem,
  HashSet,
  Layer,
  Option,
  Path,
  PlatformError,
  Predicate,
  Stream,
} from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Socket, SocketServer } from "effect/socket";
import { GitStore } from "./GitStore.js";
import { DaemonRpcs } from "./Rpcs.js";
import { ServicesStore } from "./ServicesStore.js";
import { DAEMON_SOCKET_PATH } from "./socketPath.js";
import { StatusFiles } from "./StatusFiles.js";
import { UpdatesStore } from "./UpdatesStore.js";

const Handlers = DaemonRpcs.toLayer(
  Effect.gen(function* () {
    const updates = yield* UpdatesStore;
    const services = yield* ServicesStore;
    const git = yield* GitStore;

    return DaemonRpcs.of({
      GetUpdates: () => Effect.map(updates.get, Option.getOrNull),
      WatchUpdates: () => Stream.map(updates.changes, Option.getOrNull),
      RefreshUpdates: (options) => updates.refresh(options),
      PublishUpdates: ({ status }) => updates.publish(status),
      WatchServices: () => Stream.map(services.changes, Option.getOrNull),
      RefreshServices: () => services.refresh,
      WatchGit: () => git.changes,
      RefreshGit: ({ force }) => git.refresh(force),
    });
  }),
);

// `readlink` on a real directory fails with EINVAL.
const isNotASymlink = (error: PlatformError.PlatformError) =>
  Predicate.hasProperty(error.reason.cause, "code") &&
  error.reason.cause.code === "EINVAL";

const refuseDirectory = (directory: string, description: string) =>
  Effect.fail(
    PlatformError.badArgument({
      module: "FileSystem",
      method: "prepareSocket",
      description: `${directory}: ${description}`,
    }),
  );

// The socket is mode 0600, but whoever can write its directory can replace it.
const prepareSocket = Effect.fn("Daemon.prepareSocket")(function* (
  socketPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.dirname(socketPath);

  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });

  const symlink = yield* fs.readLink(directory).pipe(
    Effect.as(true),
    Effect.catchIf(isNotASymlink, () => Effect.succeed(false)),
  );

  if (symlink)
    return yield* refuseDirectory(
      directory,
      "socket directory must not be a symbolic link",
    );

  const info = yield* fs.stat(directory);

  if (info.type !== "Directory")
    return yield* refuseDirectory(
      directory,
      "socket path is not inside a directory",
    );

  const owner = Option.getOrUndefined(info.uid);
  const uid = process.getuid?.();

  if (owner !== undefined && uid !== undefined && owner !== uid)
    return yield* refuseDirectory(
      directory,
      "socket directory is owned by another user",
    );

  yield* fs.chmod(directory, 0o700);
  yield* fs.remove(socketPath, { force: true });
});

const disconnectCodes = HashSet.make("ECONNRESET", "EPIPE");

const isDisconnect = (error: unknown): error is Socket.SocketError => {
  if (!Socket.isSocketError(error)) return false;

  const { reason } = error;

  if (Predicate.isTagged(reason, "SocketCloseError")) return true;

  return (
    (Predicate.isTagged(reason, "SocketReadError") ||
      Predicate.isTagged(reason, "SocketWriteError")) &&
    Predicate.hasProperty(reason.cause, "code") &&
    HashSet.has(disconnectCodes, String(reason.cause.code))
  );
};

// Watchers come and go, so a dropped connection is logged at debug level
// instead of as an unhandled server error.
const quietSocketServer = (socketPath: string) =>
  Layer.effect(
    SocketServer.SocketServer,
    Effect.gen(function* () {
      const server = yield* SocketServer.SocketServer;

      return SocketServer.SocketServer.of({
        address: server.address,
        run: (handler) =>
          server.run((socket) =>
            handler(socket).pipe(
              // The RPC protocol turns read errors into defects.
              Effect.catchCauseIf(
                (cause) => isDisconnect(Cause.squash(cause)),
                () => Effect.logDebug("Client disconnected"),
              ),
            ),
          ),
      });
    }),
  ).pipe(Layer.provide(NodeSocketServer.layer({ path: socketPath })));

// Requiring SocketServer orders this after the socket is listening.
const secureSocket = (socketPath: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* SocketServer.SocketServer;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.chmod(socketPath, 0o600);
      yield* Effect.addFinalizer(() =>
        fs.remove(socketPath, { force: true }).pipe(Effect.ignore),
      );
      yield* Effect.logInfo("Listening", socketPath);
    }),
  );

/** Run the dot daemon until it is signalled to stop. */
export const daemonServe = Effect.gen(function* () {
  const stop = yield* Deferred.make<void>();
  const onSignal = () => Deferred.doneUnsafe(stop, Effect.void);

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      process.on("SIGHUP", onSignal);
    }),
    () =>
      Effect.sync(() => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        process.off("SIGHUP", onSignal);
      }),
  );

  yield* prepareSocket(DAEMON_SOCKET_PATH);

  yield* Effect.raceFirst(
    Layer.launch(
      Layer.mergeAll(
        RpcServer.layer(DaemonRpcs),
        secureSocket(DAEMON_SOCKET_PATH),
        StatusFiles,
      ).pipe(
        Layer.provide(Handlers),
        Layer.provide(
          Layer.mergeAll(
            UpdatesStore.layer,
            ServicesStore.layer,
            GitStore.layer,
          ),
        ),
        Layer.provide(RpcServer.layerProtocolSocketServer),
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(quietSocketServer(DAEMON_SOCKET_PATH)),
      ),
    ),
    Deferred.await(stop),
  );

  yield* Effect.logInfo("Stopped");
}).pipe(Effect.scoped, Effect.withSpan("Daemon.serve"));
