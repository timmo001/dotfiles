import { Service } from "@opencode-ai/client/effect/service";
import type { Endpoint } from "@opencode-ai/client/service";
import { TuiEvent } from "@opencode-ai/schema/tui-event";
import { Effect, FileSystem } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

export interface ToastInput {
  readonly title?: string;
  readonly message: string;
  readonly variant: "info" | "success" | "warning" | "error";
  readonly duration: number;
}

export interface ToastDependencies {
  readonly discover: () => Effect.Effect<Endpoint | undefined, unknown>;
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, unknown>;
}

export const showToast = (
  directory: string,
  input: ToastInput,
  dependencies: ToastDependencies,
) =>
  Effect.gen(function* () {
    const endpoint = yield* dependencies.discover();
    if (!endpoint) return;

    const url = new URL("/tui/show-toast", endpoint.url);
    url.searchParams.set("directory", directory);
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeaders(Service.headers(endpoint) ?? {}),
      HttpClientRequest.schemaBodyJson(TuiEvent.ToastShow.data)(input),
    );
    yield* dependencies.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
  }).pipe(Effect.ignore);

export const createToast = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const httpClient = yield* HttpClient.HttpClient;
  return (directory: string, input: ToastInput) =>
    showToast(directory, input, {
      discover: () =>
        Service.discover().pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        ),
      execute: (request) => httpClient.execute(request),
    });
});
