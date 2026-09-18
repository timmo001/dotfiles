import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { Context, Effect, FileSystem, Layer, Schema } from "effect";
import { CACHE_DIR } from "../lib/paths.js";
import { DependencyDiscoveryError } from "./model.js";

/** Persistent, private cache IO. Decoding cached payloads remains the consumer's duty. */
export interface DependencyDiskCacheService {
  /** Read a previously saved payload. */
  readonly read: (
    key: string,
  ) => Effect.Effect<string | undefined, DependencyDiscoveryError>;
  /** Atomically replace one payload. */
  readonly write: (
    key: string,
    value: string,
  ) => Effect.Effect<void, DependencyDiscoveryError>;
  /** Save a sparse, immutable source checkout outside the caller's repository. */
  readonly checkout: (
    repository: string,
    sha: string,
    files: Readonly<Record<string, string>>,
  ) => Effect.Effect<string, DependencyDiscoveryError>;
}

/** Filesystem authority for {@link DependencyDiskCacheService}. */
export class DependencyDiskCache extends Context.Service<
  DependencyDiskCache,
  DependencyDiskCacheService
>()("dot/Dependencies/DiskCache") {
  /** Store provider data outside all repository worktrees. */
  static readonly layer = Layer.effect(
    DependencyDiskCache,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = join(CACHE_DIR, "dot", "dependencies");

      const path = (key: string) =>
        join(directory, createHash("sha256").update(key).digest("hex"));

      return DependencyDiskCache.of({
        checkout: Effect.fn("DependencyDiskCache.checkout")(
          function* (repository, sha, files) {
            if (!/^[a-f\d]{40}$/i.test(sha))
              return yield* new DependencyDiscoveryError({
                message: "Invalid snapshot commit identity",
              });

            const root = join(
              directory,
              "checkouts",
              createHash("sha256").update(repository).digest("hex"),
            );

            yield* fs.makeDirectory(root, { recursive: true, mode: 0o700 });
            const destination = join(root, sha);

            if (yield* fs.exists(destination)) return destination;

            const staging = yield* fs.makeTempDirectoryScoped({
              directory: root,
              prefix: ".checkout-",
            });

            const temporary = join(staging, "snapshot");
            yield* fs.makeDirectory(temporary, { mode: 0o700 });

            for (const [file, content] of Object.entries(files)) {
              if (
                isAbsolute(file) ||
                normalize(file) !== file ||
                file.startsWith("../") ||
                file.split("/").includes(".git")
              )
                return yield* new DependencyDiscoveryError({
                  message: "Invalid dependency snapshot path",
                });
              yield* fs.makeDirectory(join(temporary, dirname(file)), {
                recursive: true,
                mode: 0o700,
              });
              yield* fs.writeFileString(join(temporary, file), content, {
                mode: 0o600,
              });
            }

            yield* fs.rename(temporary, destination);

            return destination;
          },
          Effect.scoped,
          Effect.mapError(
            () =>
              new DependencyDiscoveryError({
                message: "Cannot save isolated dependency checkout",
              }),
          ),
        ),
        read: Effect.fn("DependencyDiskCache.read")(
          function* (key) {
            const file = path(key);

            return (yield* fs.exists(file))
              ? yield* fs.readFileString(file)
              : undefined;
          },
          Effect.mapError(
            () =>
              new DependencyDiscoveryError({
                message: "Cannot read dependency cache",
              }),
          ),
        ),
        write: Effect.fn("DependencyDiskCache.write")(
          function* (key, value) {
            yield* fs.makeDirectory(directory, {
              recursive: true,
              mode: 0o700,
            });

            const temporary = yield* fs.makeTempFileScoped({
              directory,
              prefix: ".write-",
            });

            yield* fs.writeFileString(temporary, value, { mode: 0o600 });
            yield* fs.rename(temporary, path(key));
          },
          Effect.scoped,
          Effect.mapError(
            () =>
              new DependencyDiscoveryError({
                message: "Cannot save dependency cache",
              }),
          ),
        ),
      });
    }),
  );
}

/** Conditional HTTP cache record, decoded before sending validators. */
export const HttpCacheEntry = Schema.Struct({
  body: Schema.String,
  etag: Schema.optionalKey(Schema.String),
  modified: Schema.optionalKey(Schema.String),
});
