import { Service } from "@opencode-ai/client/effect/service";
import { Effect, FileSystem, PlatformError } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
} from "effect/unstable/http";
import { readFile } from "node:fs/promises";

const serviceFileSystem = FileSystem.makeNoop({
  readFileString: (path) =>
    Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) =>
        PlatformError.systemError({
          _tag: "Unknown",
          module: "FileSystem",
          method: "readFileString",
          pathOrDescriptor: path,
          cause,
        }),
    }),
});

export const discoverService = () =>
  Service.discover().pipe(
    Effect.provideService(FileSystem.FileSystem, serviceFileSystem),
  );

export const executeHttp = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* client.execute(request);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
  );
