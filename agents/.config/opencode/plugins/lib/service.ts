import { Service } from "@opencode/client/effect/service";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
} from "effect/unstable/http";

export const discoverService = () =>
  Service.discover().pipe(
    Effect.provide(NodeFileSystem.layer),
  );

export const executeHttp = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    return yield* client.execute(request);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
  );
