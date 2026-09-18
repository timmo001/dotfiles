import { createHash } from "node:crypto";
import { dirname } from "node:path";
import semver from "semver";
import {
  Api,
  Gh,
  GhCommandError,
  PullRequest,
  Repository,
  type GhError,
} from "@timmo001/effect-gh";
import {
  Cache,
  Context,
  Effect,
  Layer,
  Schema,
  Schedule,
  Predicate,
  Record,
  Ref as EffectRef,
  Semaphore,
} from "effect";
import { mergeDependencyPolicy, type DependencyPolicy } from "./config.js";
import { decodeDependencyConfig, dependencyPolicyPath } from "./policyFile.js";
import { DependencyDiskCache } from "./cache.js";
import { dependencyFile, extractDependencies } from "./extract.js";
import { validateDependencyPatterns } from "./rules.js";
import {
  dependencyIdentity,
  DependencyDiscoveryError,
  TreeEntry,
  type Snapshot,
  type Dependency,
  Releases,
} from "./model.js";

const Tree = Schema.Struct({
  truncated: Schema.Boolean,
  tree: Schema.Array(TreeEntry),
});

const Blob = Schema.Struct({
  encoding: Schema.Literal("base64"),
  content: Schema.String,
});

const Commit = Schema.Struct({
  sha: Schema.String,
  commit: Schema.Struct({
    committer: Schema.NullOr(Schema.Struct({ date: Schema.String })),
  }),
});

const Ref = Schema.Struct({ sha: Schema.String, ref: Schema.String });

const Pr = Schema.Struct({
  number: Schema.Int,
  html_url: Schema.String,
  draft: Schema.Boolean,
  base: Ref,
  head: Ref,
});

const ChangedFile = Schema.Struct({
  filename: Schema.String,
  previous_filename: Schema.optionalKey(Schema.String),
  status: Schema.String,
});

/** Dependency changes established from immutable PR merge-base/head inputs. */
export const PullRequestCoverage = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  head: Schema.String,
  checks: Schema.String,
  identities: Schema.Array(Schema.String),
  ambiguousFiles: Schema.Array(Schema.String),
});

/** Decoded open dependency PR coverage. */
export interface PullRequestCoverage extends Schema.Schema.Type<
  typeof PullRequestCoverage
> {}

/** GitHub read authority; no mutation operations are exposed to the planner. */
export interface DependencyGithubService {
  /** Resolve hosting identity and remote default branch through the SDK. */
  readonly resolve: (
    directory: string,
    repository: string | undefined,
    timeout: number,
  ) => Effect.Effect<Repository.Repository, DependencyDiscoveryError>;
  /** Load immutable selected blobs from one remote commit. */
  readonly snapshot: (
    repository: string,
    target: string,
    timeout: number,
    concurrency: number,
    policy?: DependencyPolicy,
  ) => Effect.Effect<Snapshot, DependencyDiscoveryError>;
  /** Inventory every open PR and compare dependency identities. */
  readonly inventory: (
    snapshot: Snapshot,
    policy: DependencyPolicy,
    timeout: number,
    concurrency: number,
  ) => Effect.Effect<readonly PullRequestCoverage[], DependencyDiscoveryError>;
  /** Enumerate provider releases/tags or resolve one branch commit. */
  readonly releases: (
    repository: string,
    datasource: string,
    ref: string,
    timeout: number,
  ) => Effect.Effect<Releases, DependencyDiscoveryError>;
  /** Read a GitHub-hosted custom datasource using gh authentication. */
  readonly rawFile: (
    repository: string,
    ref: string,
    path: string,
    timeout: number,
  ) => Effect.Effect<string, DependencyDiscoveryError>;
}

/** SDK implementation of {@link DependencyGithubService}. */
export class DependencyGithub extends Context.Service<
  DependencyGithub,
  DependencyGithubService
>()("dot/Dependencies/Github") {
  /** Reuse gh authentication, paginated SDK reads and immutable blob caches. */
  static readonly layer = Layer.effect(
    DependencyGithub,
    Effect.gen(function* () {
      const gh = yield* Gh;
      const disk = yield* DependencyDiskCache;
      const permits = yield* Semaphore.make(4);
      const rateLimited = yield* EffectRef.make(false);

      const read = Effect.fn("DependencyGithub.read")(
        function* <A>(
          effect: Effect.Effect<A, GhError, Gh>,
          operation: string,
        ) {
          if (yield* EffectRef.get(rateLimited))
            return yield* new DependencyDiscoveryError({
              message: `${operation}: GitHub rate limit reached; further reads stopped for this run`,
            });

          return yield* effect.pipe(
            Effect.provideService(Gh, gh),
            Effect.tapError((error) =>
              error instanceof GhCommandError &&
              /rate limit|HTTP 429/i.test(error.stderr)
                ? EffectRef.set(rateLimited, true)
                : Effect.void,
            ),
          );
        },
        (effect, _request, operation) =>
          effect.pipe(
            permits.withPermit,
            Effect.retry({
              times: 2,
              schedule: Schedule.exponential("300 millis"),
              while: (error) =>
                error instanceof GhCommandError &&
                /HTTP 50[234]|connection reset/.test(error.stderr) &&
                !/rate limit|HTTP 429/i.test(error.stderr),
            }),
            Effect.mapError((error) =>
              error instanceof DependencyDiscoveryError
                ? error
                : new DependencyDiscoveryError({
                    message: `${operation}: ${error._tag}${error instanceof GhCommandError && /rate limit|HTTP 429|HTTP 403/i.test(error.stderr) ? " (provider rate limit or access denied; no retry)" : ""}`,
                  }),
            ),
          ),
      );

      const blobs = yield* Cache.make({
        capacity: 4096,
        timeToLive: "1 hour",
        lookup: Effect.fn("DependencyGithub.blob")(function* (key: string) {
          const { repository, sha, timeout } =
            yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(
                Schema.Struct({
                  repository: Schema.String,
                  sha: Schema.String,
                  timeout: Schema.Finite,
                }),
              ),
            )(key);

          const cacheKey = `blob:${repository}:${sha}`;
          const saved = yield* disk.read(cacheKey);

          const blobHash = (text: string) =>
            createHash("sha1")
              .update(`blob ${Buffer.byteLength(text)}\0`)
              .update(text)
              .digest("hex");

          if (saved !== undefined && blobHash(saved) === sha) return saved;

          const blob = yield* read(
            Api.json(
              {
                endpoint: `repos/${repository}/git/blobs/${sha}`,
                method: "GET",
                options: { timeout },
              },
              Blob,
            ),
            `Read blob ${sha}`,
          );

          const text = Buffer.from(blob.content, "base64").toString("utf8");

          if (blobHash(text) !== sha)
            return yield* new DependencyDiscoveryError({
              message:
                "Dependency blob is corrupt or is not a supported UTF-8 file",
            });
          yield* disk.write(cacheKey, text);

          return text;
        }),
      });

      const snapshot = Effect.fn("DependencyGithub.snapshot")(function* (
        repository: string,
        target: string,
        timeout: number,
        concurrency: number,
        existingPolicy?: DependencyPolicy,
      ): Effect.fn.Return<Snapshot, DependencyDiscoveryError> {
        const commit = yield* read(
          Api.json(
            {
              endpoint: `repos/${repository}/commits/${encodeURIComponent(target)}`,
              method: "GET",
              options: { timeout },
            },
            Commit,
          ),
          `Resolve ${repository}@${target}`,
        );

        const tree = yield* read(
          Api.json(
            {
              endpoint: `repos/${repository}/git/trees/${commit.sha}`,
              method: "GET",
              query: { recursive: "1" },
              options: { timeout },
            },
            Tree,
          ),
          "Read repository tree",
        );

        if (tree.truncated)
          return yield* new DependencyDiscoveryError({
            message:
              "GitHub truncated the repository tree; discovery cannot be complete",
          });

        const file = Effect.fn("DependencyGithub.file")(function* (
          path: string,
        ) {
          const entry = tree.tree.find(
            (entry) =>
              entry.path === path &&
              entry.type === "blob" &&
              entry.mode !== "120000",
          );

          if (!entry)
            return yield* new DependencyDiscoveryError({
              message: `Missing regular file ${path} at ${repository}@${commit.sha}`,
            });

          return yield* Cache.get(
            blobs,
            JSON.stringify({ repository, sha: entry.sha, timeout }),
          ).pipe(
            Effect.mapError(
              () =>
                new DependencyDiscoveryError({
                  message: `Could not read ${path} at ${commit.sha}`,
                }),
            ),
          );
        });

        const configPath = existingPolicy
          ? undefined
          : yield* dependencyPolicyPath(
              tree.tree.map((entry) => entry.path),
            ).pipe(
              Effect.mapError(
                (error) =>
                  new DependencyDiscoveryError({
                    message: `${error.message} at ${commit.sha}`,
                  }),
              ),
            );

        const configText =
          configPath === undefined ? undefined : yield* file(configPath);

        const config =
          configText === undefined
            ? undefined
            : yield* decodeDependencyConfig(configText).pipe(
                Effect.mapError(
                  () =>
                    new DependencyDiscoveryError({
                      message: `Invalid ${configPath} at ${commit.sha}`,
                    }),
                ),
              );

        const policy =
          existingPolicy ??
          (config
            ? mergeDependencyPolicy(config.policy.base, config.policy.overrides)
            : undefined);

        if (!policy)
          return yield* new DependencyDiscoveryError({
            message: "No pinned dependency policy",
          });
        yield* Effect.try({
          try: () => validateDependencyPatterns(policy),
          catch: () =>
            new DependencyDiscoveryError({
              message: "Invalid native dependency matcher",
            }),
        });

        const selected = tree.tree.filter(
          (entry) =>
            entry.type === "blob" &&
            entry.mode !== "120000" &&
            (dependencyFile(policy, entry.path) ||
              entry.path === config?.import.source),
        );

        const entries = yield* Effect.forEach(
          selected,
          (entry) =>
            file(entry.path).pipe(
              Effect.map((text) => [entry.path, text] as const),
            ),
          { concurrency },
        );

        const files = Object.fromEntries(entries);

        if (configPath !== undefined && configText !== undefined)
          files[configPath] = configText;

        const directory = configText
          ? yield* disk.checkout(repository, commit.sha, files)
          : undefined;

        return {
          repository,
          target,
          sha: commit.sha,
          tree: tree.tree,
          files,
          ...Record.filter({ directory }, Predicate.isNotUndefined),
        };
      });

      return DependencyGithub.of({
        resolve: Effect.fn("DependencyGithub.resolve")(
          (directory, repository, timeout) =>
            read(
              Repository.view(repository, { cwd: directory, timeout }),
              "Resolve repository",
            ),
        ),
        snapshot,
        inventory: Effect.fn("DependencyGithub.inventory")(
          function* (pinned, policy, timeout, concurrency) {
            const pages = yield* read(
              Api.pages(
                {
                  endpoint: `repos/${pinned.repository}/pulls`,
                  method: "GET",
                  query: { state: "open", per_page: 100 },
                  options: { timeout },
                },
                Schema.Array(Pr),
              ),
              "Inventory open PRs",
            );

            return yield* Effect.forEach(
              pages.flat(),
              Effect.fn("DependencyGithub.comparePr")(function* (pr) {
                const [checks, filePages] = yield* Effect.all(
                  [
                    read(
                      PullRequest.checks(pr.number, {
                        repository: pinned.repository,
                        timeout,
                      }),
                      `Read checks for PR #${pr.number}`,
                    ).pipe(
                      Effect.map(
                        (value) =>
                          `${value.status} (${value.checks.length} checks)${pr.draft ? ", draft" : ""}`,
                      ),
                      Effect.catch((error) =>
                        Effect.succeed(
                          `unavailable (${error.message})${pr.draft ? ", draft" : ""}`,
                        ),
                      ),
                    ),

                    read(
                      Api.pages(
                        {
                          endpoint: `repos/${pinned.repository}/pulls/${pr.number}/files`,
                          method: "GET",
                          query: { per_page: 100 },
                          options: { timeout },
                        },
                        Schema.Array(ChangedFile),
                      ),
                      `Read changed files for PR #${pr.number}`,
                    ),
                  ],
                  { concurrency: 2 },
                );

                const files = filePages.flat();

                if (files.length >= 3000)
                  return yield* new DependencyDiscoveryError({
                    message: `PR #${pr.number} reaches GitHub's changed-file limit; inventory may be incomplete`,
                  });

                const current = yield* read(
                  Api.json(
                    {
                      endpoint: `repos/${pinned.repository}/pulls/${pr.number}`,
                      method: "GET",
                      options: { timeout },
                    },
                    Pr,
                  ),
                  `Verify PR #${pr.number} comparison inputs`,
                );

                if (
                  current.base.sha !== pr.base.sha ||
                  current.head.sha !== pr.head.sha
                )
                  return yield* new DependencyDiscoveryError({
                    message: `PR #${pr.number} changed during inventory; retry the preview`,
                  });

                const comparison = yield* read(
                  Api.json(
                    {
                      endpoint: `repos/${pinned.repository}/compare/${pr.base.sha}...${pr.head.sha}`,
                      method: "GET",
                      query: { per_page: 1 },
                      options: { timeout },
                    },
                    Schema.Struct({
                      merge_base_commit: Schema.Struct({ sha: Schema.String }),
                    }),
                  ),
                  `Resolve merge base for PR #${pr.number}`,
                );

                const relevant = files.filter(
                  (file) =>
                    dependencyFile(policy, file.filename) ||
                    (file.previous_filename &&
                      dependencyFile(policy, file.previous_filename)) ||
                    pinned.tree.some(
                      (entry) =>
                        entry.mode === "160000" && entry.path === file.filename,
                    ),
                );

                const cacheKey = `pr-v2:${pinned.repository}:${pr.base.sha}:${comparison.merge_base_commit.sha}:${pr.head.sha}:${createHash("sha256").update(JSON.stringify({ policy, relevant })).digest("hex")}`;
                const saved = yield* disk.read(cacheKey);

                if (saved !== undefined) {
                  const decoded = yield* Schema.decodeUnknownEffect(
                    Schema.fromJsonString(PullRequestCoverage),
                  )(saved).pipe(
                    Effect.mapError(
                      () =>
                        new DependencyDiscoveryError({
                          message: `Invalid cached PR #${pr.number} comparison`,
                        }),
                    ),
                  );

                  return {
                    ...decoded,
                    number: pr.number,
                    url: pr.html_url,
                    checks,
                  };
                }

                const identities: string[] = [];
                const ambiguousFiles: string[] = [];

                if (relevant.length) {
                  const [base, head] = yield* Effect.all(
                    [
                      snapshot(
                        pinned.repository,
                        comparison.merge_base_commit.sha,
                        timeout,
                        concurrency,
                        policy,
                      ),
                      snapshot(
                        pinned.repository,
                        pr.head.sha,
                        timeout,
                        concurrency,
                        policy,
                      ),
                    ],
                    { concurrency: 2 },
                  );

                  const before = yield* extractDependencies(base, policy);
                  const after = yield* extractDependencies(head, policy);

                  const paths = new Set(
                    relevant.flatMap((file) => [
                      file.filename,
                      ...(file.previous_filename
                        ? [file.previous_filename]
                        : []),
                    ]),
                  );

                  const inDiff = (dependency: Dependency) =>
                    paths.has(dependency.file) ||
                    (dependency.manager === "npm" &&
                      [...paths].some(
                        (file) =>
                          /bun\.lockb?$/.test(file) &&
                          dirname(file) === dirname(dependency.file),
                      ));

                  const beforeDependencies = before.dependencies.filter(inDiff);
                  const afterDependencies = after.dependencies.filter(inDiff);

                  const identityAtHead = (dependency: Dependency) =>
                    dependencyIdentity({
                      ...dependency,
                      file:
                        relevant.find(
                          (file) =>
                            file.status === "renamed" &&
                            file.previous_filename === dependency.file,
                        )?.filename ?? dependency.file,
                    });

                  const values = (
                    dependencies: typeof before.dependencies,
                    identity: string,
                    beforeRename: boolean,
                  ) =>
                    JSON.stringify(
                      dependencies
                        .filter(
                          (dependency) =>
                            (beforeRename
                              ? identityAtHead(dependency)
                              : dependencyIdentity(dependency)) === identity,
                        )
                        .map((dependency) => [
                          dependency.current,
                          dependency.digest,
                          dependency.resolved,
                        ])
                        .sort(),
                    );

                  for (const dependency of beforeDependencies) {
                    const identity = identityAtHead(dependency);

                    if (
                      values(beforeDependencies, identity, true) !==
                      values(afterDependencies, identity, false)
                    ) {
                      identities.push(identity, dependencyIdentity(dependency));
                    }
                  }

                  for (const dependency of afterDependencies) {
                    const identity = dependencyIdentity(dependency);

                    if (
                      values(beforeDependencies, identity, true) !==
                      values(afterDependencies, identity, false)
                    )
                      identities.push(identity);
                  }

                  if (before.blockers.length || after.blockers.length)
                    ambiguousFiles.push(
                      ...relevant.flatMap((file) => [
                        file.filename,
                        ...(file.previous_filename
                          ? [file.previous_filename]
                          : []),
                      ]),
                    );

                  // Unknown lockfile-only changes may update transitive or ambiguous identities.
                  if (!identities.length)
                    ambiguousFiles.push(
                      ...relevant
                        .filter((file) => /bun\.lockb?$/.test(file.filename))
                        .map((file) => file.filename),
                    );
                }

                const coverage = {
                  number: pr.number,
                  url: pr.html_url,
                  head: pr.head.sha,
                  checks,
                  identities: [...new Set(identities)],
                  ambiguousFiles,
                };

                yield* disk.write(cacheKey, JSON.stringify(coverage));

                return coverage;
              }),
              { concurrency },
            );
          },
        ),
        releases: Effect.fn("DependencyGithub.releases")(
          function* (repository, datasource, ref, timeout) {
            if (datasource === "git-refs") {
              const selected =
                /^[a-f\d]{7,40}$/i.test(ref) || ref === "HEAD"
                  ? (yield* read(
                      Repository.view(repository, { timeout }),
                      "Resolve dependency default branch",
                    )).defaultBranchRef?.name
                  : ref;

              if (!selected)
                return yield* new DependencyDiscoveryError({
                  message: `${repository}: missing default branch`,
                });

              const commit = yield* read(
                Api.json(
                  {
                    endpoint: `repos/${repository}/commits/${encodeURIComponent(selected)}`,
                    method: "GET",
                    options: { timeout },
                  },
                  Commit,
                ),
                `Resolve ${repository} ref`,
              );

              return {
                releases: [
                  {
                    version: selected,
                    digest: commit.sha,
                    ...Record.filter(
                      { date: commit.commit.committer?.date },
                      Predicate.isNotUndefined,
                    ),
                  },
                ],
              };
            }

            const releases = (yield* read(
              Api.pages(
                {
                  endpoint: `repos/${repository}/releases`,
                  method: "GET",
                  query: { per_page: 100 },
                  options: { timeout },
                },
                Schema.Array(
                  Schema.Struct({
                    tag_name: Schema.String,
                    published_at: Schema.NullOr(Schema.String),
                    draft: Schema.Boolean,
                  }),
                ),
              ),
              `Read ${repository} releases`,
            ))
              .flat()
              .filter((release) => !release.draft);

            if (datasource === "github-releases")
              return {
                releases: releases.map((release) => ({
                  version: release.tag_name,
                  ...Record.filter(
                    { date: release.published_at ?? undefined },
                    Predicate.isNotUndefined,
                  ),
                })),
              };

            const tags = (yield* read(
              Api.pages(
                {
                  endpoint: `repos/${repository}/tags`,
                  method: "GET",
                  query: { per_page: 100 },
                  options: { timeout },
                },
                Schema.Array(
                  Schema.Struct({
                    name: Schema.String,
                    commit: Schema.Struct({ sha: Schema.String }),
                  }),
                ),
              ),
              `Read ${repository} tags`,
            )).flat();

            const versions = yield* Effect.forEach(
              tags,
              Effect.fn("DependencyGithub.tagDate")(function* (tag) {
                let date = releases.find(
                  (release) => release.tag_name === tag.name,
                )?.published_at;

                const version =
                  semver.valid(tag.name) ??
                  (/^(?:v|go|rust-)?\d+(?:\.\d+){0,2}$/.test(tag.name)
                    ? semver.coerce(tag.name)?.version
                    : undefined);

                const current =
                  semver.valid(ref) ?? semver.coerce(ref)?.version;

                if (
                  !date &&
                  version &&
                  current &&
                  semver.gte(version, current)
                ) {
                  const key = `commit-date:${repository}:${tag.commit.sha}`;
                  const cached = yield* disk.read(key);

                  if (cached) date = cached;
                  else {
                    const commit = yield* read(
                      Api.json(
                        {
                          endpoint: `repos/${repository}/commits/${tag.commit.sha}`,
                          method: "GET",
                          options: { timeout },
                        },
                        Commit,
                      ),
                      `Read ${repository} tag date`,
                    );

                    date = commit.commit.committer?.date;

                    if (date) yield* disk.write(key, date);
                  }
                }

                return {
                  version: tag.name,
                  digest: tag.commit.sha,
                  ...Record.filter(
                    { date: date ?? undefined },
                    Predicate.isNotUndefined,
                  ),
                };
              }),
              { concurrency: 4 },
            );

            return { releases: versions };
          },
        ),
        rawFile: Effect.fn("DependencyGithub.rawFile")(
          (repository, ref, path, timeout) =>
            read(
              Api.raw({
                endpoint: `repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
                method: "GET",
                query: { ref },
                headers: { Accept: "application/vnd.github.raw+json" },
                options: { timeout },
              }),
              "Read GitHub custom datasource",
            ).pipe(Effect.map((result) => result.stdout)),
        ),
      });
    }),
  );
}
