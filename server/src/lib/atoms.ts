import { ServerApi } from "@dot/server-api";
import { Context, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { Atom, AtomRegistry } from "effect/reactivity";

/** The registry every component reads its atoms from. */
export const registry = AtomRegistry.make();

/** Typed client for the `dot server serve` API, checked against its schemas. */
class ApiClient extends Context.Service<
  ApiClient,
  HttpApiClient.ForApi<typeof ServerApi>
>()("dot-server/ApiClient") {
  static readonly layer = Layer.effect(
    ApiClient,
    HttpApiClient.make(ServerApi, { baseUrl: location.origin }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

const runtime = Atom.runtime(ApiClient.layer);

/** How often the services list refreshes on its own. */
const REFRESH = "15 seconds";

/** systemctl returns before the unit changes, so wait before refreshing. */
const SETTLE = "1 second";

/** Every registered service with its health, refreshed on a timer. */
export const services = runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient;

      return yield* client.services.list();
    }),
  )
  .pipe(Atom.withRefresh(REFRESH), Atom.keepAlive);

/** Recent journal lines of one service. */
export const journal = Atom.family((unit: string) =>
  runtime.atom(
    Effect.gen(function* () {
      const client = yield* ApiClient;

      return yield* client.services.logs({ params: { unit }, query: {} });
    }),
  ),
);

/** Start or stop one service, then refresh the list. */
export const serviceAction = Atom.family((unit: string) =>
  runtime.fn((action: "start" | "stop", get) =>
    Effect.gen(function* () {
      const client = yield* ApiClient;

      const request = {
        params: { unit },
        headers: { "x-dot-server": "1" },
      } as const;

      yield* action === "start"
        ? client.services.start(request)
        : client.services.stop(request);

      yield* Effect.sleep(SETTLE);

      get.refresh(services);
      get.refresh(journal(unit));
    }),
  ),
);
