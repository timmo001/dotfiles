import { NodeHttpServer } from "@effect/platform-node";
import { Console, Effect, FileSystem, Layer, Option } from "effect";
import { HttpRouter, HttpStaticServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  ServiceMonitorError,
  servicesJournal,
  servicesSnapshot,
  servicesStart,
  servicesStop,
} from "../commands/Services.js";
import { Config } from "../services/Config.js";
import { ServerApi, ServerFailure, ServiceNotFound } from "./api.js";
import { loginMiddleware } from "./auth.js";

const JOURNAL_LINES = 200;

type ServerRequirements = Effect.Services<
  | typeof servicesSnapshot
  | ReturnType<typeof servicesJournal>
  | ReturnType<typeof servicesStart>
>;

/** Options for {@link serverServe}. */
export interface ServerServeOptions {
  /** Address to listen on. */
  readonly host: string;
  /** Port to listen on. */
  readonly port: number;
  /** Dashboard build to serve, instead of `server/dist` in the public dotfiles. */
  readonly dashboard: Option.Option<string>;
}

/** Any failure the services commands raise; each carries a message. */
interface Failure {
  readonly message: string;
}

const toFailure = (error: Failure) =>
  new ServerFailure({ message: error.message });

const toUnitError = (error: Failure) =>
  error instanceof ServiceMonitorError
    ? new ServiceNotFound({ message: error.message })
    : toFailure(error);

const ServicesHandlers = HttpApiBuilder.group(
  ServerApi,
  "services",
  (handlers) =>
    handlers.handleAll({
      list: () => servicesSnapshot.pipe(Effect.mapError(toFailure)),
      logs: ({ params, query }) =>
        servicesJournal(params.unit, query.lines ?? JOURNAL_LINES).pipe(
          Effect.map((text) => ({ unit: params.unit, text })),
          Effect.mapError(toUnitError),
        ),
      start: ({ params }) =>
        servicesStart(params.unit).pipe(Effect.mapError(toUnitError)),
      stop: ({ params }) =>
        servicesStop(params.unit).pipe(Effect.mapError(toUnitError)),
    }),
);

const SystemHandlers = HttpApiBuilder.group(ServerApi, "system", (handlers) =>
  handlers.handleAll({ health: () => Effect.succeed({ ok: true }) }),
);

/** Serve the server dashboard and its API: registered services first, more later. */
export const serverServe = Effect.fn("Server.serve")(function* (
  options: ServerServeOptions,
) {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;
  const context = yield* Effect.context<ServerRequirements>();

  const dashboard = Option.getOrElse(options.dashboard, () =>
    join(config.publicDotfiles, "server", "dist"),
  );

  const api = HttpApiBuilder.layer(ServerApi).pipe(
    Layer.provide(Layer.mergeAll(ServicesHandlers, SystemHandlers)),
    Layer.provide(Layer.succeedContext(context)),
  );

  const built = yield* fs.exists(join(dashboard, "index.html"));

  if (!built)
    yield* Console.error(
      `[WARN] No dashboard build in ${dashboard}; serving the API only. Run mise run server:build.`,
    );

  const routes = built
    ? Layer.mergeAll(
        api,
        HttpStaticServer.layer({ root: dashboard, spa: true }),
      )
    : api;

  const auth = yield* loginMiddleware;

  yield* Console.log(`Serving on http://${options.host}:${options.port}`);

  return yield* Layer.launch(
    HttpRouter.serve(routes, { middleware: auth }).pipe(
      Layer.provide(
        NodeHttpServer.layer(createServer, {
          host: options.host,
          port: options.port,
        }),
      ),
    ),
  );
});
