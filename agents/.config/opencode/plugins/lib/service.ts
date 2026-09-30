import { OpenCode } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import type { Endpoint } from "@opencode/client/service";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";

export const discoverService = () =>
  Service.discover().pipe(
    Effect.provide(NodeFileSystem.layer),
  );

export const connectClient = (endpoint: Endpoint) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const headers = Service.headers(endpoint);

    const authenticated = headers
      ? HttpClient.mapRequest(httpClient, HttpClientRequest.setHeaders(headers))
      : httpClient;

    return yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
      Effect.provideService(HttpClient.HttpClient, authenticated),
    );
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((error) => new Error(String(error))),
  );

export const executeHttp = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    return yield* client.execute(request);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
  );
