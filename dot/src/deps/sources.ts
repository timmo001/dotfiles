import {
  Cache,
  Context,
  Effect,
  Layer,
  Ref,
  Schema,
  Schedule,
  Predicate,
  Record,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";
import jsonata from "jsonata";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { DependencyPolicy } from "./config.js";
import { DependencyDiskCache, HttpCacheEntry } from "./cache.js";
import { DependencyGithub } from "./github.js";
import {
  DependencyDiscoveryError,
  Releases,
  type Dependency,
} from "./model.js";
import { renderTemplate } from "./managers/regex.js";

const Lookup = Schema.Struct({
  datasource: Schema.String,
  package: Schema.String,
  ref: Schema.String,
  timeout: Schema.Finite,
  datasources: DependencyPolicy.fields.datasources,
});

const Npm = Schema.Struct({
  versions: Schema.Record(Schema.String, Schema.Unknown),
  time: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  "dist-tags": Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  repository: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Struct({ url: Schema.String })]),
  ),
});

/** Metadata authority with deduplicated requests and visible failures. */
export interface DependencySourcesService {
  /** Read releases without running the package manager. */
  readonly lookup: (
    dependency: Dependency,
    policy: DependencyPolicy,
    timeout: number,
  ) => Effect.Effect<Releases, DependencyDiscoveryError>;
  /** Completed provider requests and cache reuse for progress reporting. */
  readonly stats: () => Effect.Effect<{
    readonly requests: number;
    readonly hits: number;
  }>;
}

/** HTTP/SDK implementation of {@link DependencySourcesService}. */
export class DependencySources extends Context.Service<
  DependencySources,
  DependencySourcesService
>()("dot/Dependencies/Sources") {
  /** Conditional HTTP caching and bounded idempotent retries live at this boundary. */
  static readonly layer = Layer.effect(
    DependencySources,
    Effect.gen(function* () {
      const github = yield* DependencyGithub;
      const disk = yield* DependencyDiskCache;

      const limiter = yield* RateLimiter.make.pipe(
        Effect.provide(RateLimiter.layerStoreMemory),
      );

      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.withRateLimiter({
          limiter,
          window: "1 second",
          limit: 4,
          key: (request) => new URL(request.url).origin,
          times: 2,
        }),
      );

      const requests = yield* Ref.make(0);
      const calls = yield* Ref.make(0);

      const get = Effect.fn("DependencySources.http")(function* (
        url: string,
        timeout: number,
      ) {
        const parsed = yield* Effect.try({
          try: () => new URL(url),
          catch: () =>
            new DependencyDiscoveryError({ message: "Invalid datasource URL" }),
        });

        if (parsed.protocol !== "https:" || parsed.username || parsed.password)
          return yield* new DependencyDiscoveryError({
            message: "Datasources require HTTPS without embedded credentials",
          });

        if (parsed.hostname === "raw.githubusercontent.com") {
          const [owner, repo, ref, ...path] = parsed.pathname
            .slice(1)
            .split("/");

          if (!owner || !repo || !ref || !path.length)
            return yield* new DependencyDiscoveryError({
              message: "Invalid GitHub raw-file URL",
            });

          return yield* github.rawFile(
            `${owner}/${repo}`,
            ref,
            path.join("/"),
            timeout,
          );
        }

        if (
          parsed.hostname === "github.com" ||
          parsed.hostname === "api.github.com"
        )
          return yield* new DependencyDiscoveryError({
            message: "Use a GitHub datasource or raw-file URL for GitHub IO",
          });
        const key = `http:${url}`;
        const saved = yield* disk.read(key);

        const cached = saved
          ? yield* Schema.decodeEffect(Schema.fromJsonString(HttpCacheEntry))(
              saved,
            ).pipe(
              Effect.mapError(
                () =>
                  new DependencyDiscoveryError({
                    message: "Invalid HTTP cache record",
                  }),
              ),
            )
          : undefined;

        const response = yield* http
          .get(url, {
            headers: Record.filter(
              {
                "If-None-Match": cached?.etag,
                "If-Modified-Since": cached?.modified,
              },
              Predicate.isNotUndefined,
            ),
          })
          .pipe(
            Effect.flatMap((response) =>
              response.status >= 500 || response.status === 408
                ? HttpClientResponse.filterStatusOk(response)
                : Effect.succeed(response),
            ),
            HttpClientResponseRetry,
            Effect.timeout(timeout),
            Effect.mapError(
              () =>
                new DependencyDiscoveryError({
                  message: `${parsed.hostname}: HTTP request failed or timed out`,
                }),
            ),
          );

        if (response.status === 304 && cached) return cached.body;

        if (response.status < 200 || response.status >= 300)
          return yield* new DependencyDiscoveryError({
            message: `${parsed.hostname}: HTTP ${response.status}${response.status === 429 || response.status === 403 ? `; rate limit or access denied, retry after ${response.headers["retry-after"] ?? "provider reset"}` : ""}`,
          });

        const body = yield* response.text.pipe(
          Effect.timeout(timeout),
          Effect.mapError(
            () =>
              new DependencyDiscoveryError({
                message: `${parsed.hostname}: cannot read response body`,
              }),
          ),
        );

        yield* disk.write(
          key,
          JSON.stringify({
            body,
            ...Record.filter(
              {
                etag: response.headers.etag,
                modified: response.headers["last-modified"],
              },
              Predicate.isNotUndefined,
            ),
          }),
        );

        return body;
      });

      const cache = yield* Cache.make({
        capacity: 2048,
        timeToLive: "10 minutes",
        lookup: Effect.fn("DependencySources.fetch")(function* (key: string) {
          const input = yield* Schema.decodeEffect(
            Schema.fromJsonString(Lookup),
          )(key);

          yield* Ref.update(requests, (value) => value + 1);

          if (
            input.datasource === "git-refs" &&
            input.package.startsWith("https://codeberg.org/")
          ) {
            const repository = input.package
              .replace(/^https:\/\/codeberg\.org\//, "")
              .replace(/\.git$/, "");

            if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
              return yield* new DependencyDiscoveryError({
                message: "Invalid Codeberg repository identity",
              });
            const base = `https://codeberg.org/api/v1/repos/${repository}`;

            const repositoryData = yield* Schema.decodeEffect(
              Schema.fromJsonString(
                Schema.Struct({ default_branch: Schema.String }),
              ),
            )(yield* get(base, input.timeout));

            const ref =
              input.ref === "HEAD" || /^[a-f\d]{7,40}$/i.test(input.ref)
                ? repositoryData.default_branch
                : input.ref;

            const commit = yield* Schema.decodeEffect(
              Schema.fromJsonString(
                Schema.Struct({
                  sha: Schema.String,
                  commit: Schema.Struct({
                    committer: Schema.Struct({ date: Schema.String }),
                  }),
                }),
              ),
            )(
              yield* get(
                `${base}/git/commits/${encodeURIComponent(ref)}?stat=false&verification=false&files=false`,
                input.timeout,
              ),
            );

            return {
              releases: [
                {
                  version: ref,
                  digest: commit.sha,
                  date: commit.commit.committer.date,
                },
              ],
              sourceUrl: `https://codeberg.org/${repository}`,
            };
          }

          if (input.datasource === "android-sdk") {
            const text = yield* get(
              "https://dl.google.com/android/repository/repository2-3.xml",
              input.timeout,
            );

            const data = yield* Effect.try({
              try: () => {
                if (XMLValidator.validate(text) !== true)
                  throw new Error("Invalid XML");

                return new XMLParser({
                  ignoreAttributes: false,
                  attributeNamePrefix: "",
                  removeNSPrefix: true,
                  parseTagValue: false,
                  isArray: (name) => name === "remotePackage",
                }).parse(text);
              },
              catch: () =>
                new DependencyDiscoveryError({
                  message: "Invalid Android SDK repository XML",
                }),
            });

            const metadata = yield* Schema.decodeUnknownEffect(
              Schema.Struct({
                "sdk-repository": Schema.Struct({
                  remotePackage: Schema.Array(
                    Schema.Struct({
                      path: Schema.String,
                      revision: Schema.Struct({
                        major: Schema.String,
                        minor: Schema.optionalKey(Schema.String),
                        micro: Schema.optionalKey(Schema.String),
                        preview: Schema.optionalKey(Schema.String),
                      }),
                    }),
                  ),
                }),
              }),
            )(data);

            return {
              sourceUrl: null,
              releases: metadata["sdk-repository"].remotePackage
                .filter(
                  (entry) =>
                    entry.path.startsWith("cmdline-tools;") &&
                    !entry.revision.preview,
                )
                .map((entry) => ({
                  version: `${entry.revision.major}.${entry.revision.minor ?? "0"}${entry.revision.micro && entry.revision.micro !== "0" ? `.${entry.revision.micro}` : ""}`,
                })),
            };
          }

          if (
            ["github-tags", "github-releases", "git-refs"].includes(
              input.datasource,
            )
          ) {
            const repository = input.package
              .replace(/^(?:git\+)?https:\/\/github.com\//, "")
              .replace(/^git@github.com:/, "")
              .replace(/\.git$/, "");

            if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
              return yield* new DependencyDiscoveryError({
                message: `Unsupported Git source for ${input.package}`,
              });

            const metadata = yield* github.releases(
              repository,
              input.datasource,
              input.ref,
              input.timeout,
            );

            return {
              ...metadata,
              sourceUrl: `https://github.com/${repository}`,
            };
          }

          if (input.datasource === "npm") {
            const text = yield* get(
              `https://registry.npmjs.org/${encodeURIComponent(input.package)}`,
              input.timeout,
            );

            const metadata = yield* Schema.decodeEffect(
              Schema.fromJsonString(Npm),
            )(text).pipe(
              Effect.mapError(
                () =>
                  new DependencyDiscoveryError({
                    message: `${input.package}: malformed npm metadata`,
                  }),
              ),
            );

            const source = Schema.is(Schema.String)(metadata.repository)
              ? metadata.repository
              : metadata.repository?.url;

            const sourceUrl = source
              ?.replace(/^git\+/, "")
              .replace(/^git:\/\/github\.com\//, "https://github.com/")
              .replace(/^git@github\.com:/, "https://github.com/")
              .replace(/^github:/, "https://github.com/")
              .replace(/\.git$/, "");

            return {
              sourceUrl: sourceUrl || null,
              releases: Object.keys(metadata.versions).map((version) => ({
                version,
                ...Record.filter(
                  { date: metadata.time?.[version] },
                  Predicate.isNotUndefined,
                ),
              })),
              ...Record.filter(
                { latest: metadata["dist-tags"]?.latest },
                Predicate.isNotUndefined,
              ),
            };
          }

          if (input.datasource === "crate") {
            const text = yield* get(
              `https://crates.io/api/v1/crates/${encodeURIComponent(input.package)}`,
              input.timeout,
            );

            const metadata = yield* Schema.decodeEffect(
              Schema.fromJsonString(
                Schema.Struct({
                  crate: Schema.Struct({
                    repository: Schema.NullOr(Schema.String),
                  }),
                  versions: Schema.Array(
                    Schema.Struct({
                      num: Schema.String,
                      created_at: Schema.String,
                      yanked: Schema.Boolean,
                    }),
                  ),
                }),
              ),
            )(text);

            return {
              sourceUrl: metadata.crate.repository,
              releases: metadata.versions
                .filter((version) => !version.yanked)
                .map((version) => ({
                  version: version.num,
                  date: version.created_at,
                })),
            };
          }

          const custom =
            input.datasources[input.datasource.replace(/^custom\./, "")];

          if (!input.datasource.startsWith("custom.") || !custom)
            return yield* new DependencyDiscoveryError({
              message: `Unsupported datasource: ${input.datasource}`,
            });

          const url = yield* Effect.try({
            try: () =>
              renderTemplate(custom.registry, {
                packageName: input.package,
                depName: input.package,
              }),
            catch: () =>
              new DependencyDiscoveryError({
                message: "Invalid custom datasource URL template",
              }),
          });

          const text = yield* get(url, input.timeout);
          let data: Schema.Json;

          if (custom.format === "plain")
            data = {
              releases: text
                .split(/\r?\n/)
                .filter(Boolean)
                .map((version) => ({ version })),
            };
          else if (custom.format === "json")
            data = yield* Schema.decodeEffect(
              Schema.fromJsonString(Schema.Json),
            )(text);
          else
            return yield* new DependencyDiscoveryError({
              message: `Unsupported datasource format: ${custom.format}`,
            });

          for (const transform of custom.transforms) {
            const expression = yield* Effect.try({
              try: () => jsonata(transform),
              catch: () =>
                new DependencyDiscoveryError({
                  message: "Invalid custom datasource JSONata",
                }),
            });

            data = yield* Effect.tryPromise({
              try: () => expression.evaluate(data),
              catch: () =>
                new DependencyDiscoveryError({
                  message: "Custom datasource JSONata failed",
                }),
            }).pipe(
              Effect.timeout(input.timeout),
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
            );
          }

          return yield* Schema.decodeUnknownEffect(Releases)(data).pipe(
            Effect.mapError(
              () =>
                new DependencyDiscoveryError({
                  message: `Invalid transformed metadata: ${input.datasource}`,
                }),
            ),
          );
        }),
      });

      return DependencySources.of({
        lookup: Effect.fn("DependencySources.lookup")(
          function* (dependency, policy, timeout) {
            yield* Ref.update(calls, (value) => value + 1);

            return yield* Cache.get(
              cache,
              JSON.stringify({
                datasource: dependency.datasource,
                package: dependency.package,
                ref: ["git-refs", "github-tags"].includes(dependency.datasource)
                  ? dependency.current
                  : "",
                timeout,
                datasources: dependency.datasource.startsWith("custom.")
                  ? policy.datasources
                  : {},
              }),
            ).pipe(
              Effect.timeout(timeout),
              Effect.mapError((error) =>
                error instanceof DependencyDiscoveryError
                  ? error
                  : new DependencyDiscoveryError({
                      message: Predicate.isTagged(error, "TimeoutError")
                        ? `${dependency.name}: ${dependency.datasource} lookup exceeded ${timeout}ms`
                        : `${dependency.name}: ${dependency.datasource} returned metadata that failed decoding`,
                    }),
              ),
            );
          },
        ),
        stats: Effect.fn("DependencySources.stats")(function* () {
          const count = yield* Ref.get(requests);

          return { requests: count, hits: (yield* Ref.get(calls)) - count };
        }),
      });
    }),
  );
}

// Retry transport failures and transient server errors; rate limits stay visible.
const HttpClientResponseRetry = Effect.retry({
  times: 2,
  schedule: Schedule.exponential("300 millis"),
});
