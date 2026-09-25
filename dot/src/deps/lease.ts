import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  Clock,
  Effect,
  FileSystem,
  Ref,
  Result,
  Schema,
  Semaphore,
} from "effect";
import { STATE_DIR } from "../lib/paths.js";
import { dependencyGit } from "./publish.js";
import type { DependencyRunLog } from "./log.js";
import { DependencyRunError } from "./state.js";

const LeaseState = Schema.Struct({
  version: Schema.Literal(1),
  owner: Schema.NullOr(Schema.NonEmptyString),
  expiresAt: Schema.Finite,
  nextRunAt: Schema.Finite,
});

const LEASE_MILLIS = 120_000;

/** A remote run claim; publication advances the claim and target in one Git transaction. */
export interface DependencyLease {
  /** Renew ownership until interrupted; failure interrupts the work racing it. */
  readonly keepAlive: Effect.Effect<never, DependencyRunError>;
  /** Assert current remote ownership before starting another operation. */
  readonly assertOwned: Effect.Effect<void, DependencyRunError>;
  /** Push only while this lease and the checked target still match their expected revisions. */
  readonly publish: (
    directory: string,
    commit: string,
    target: string,
    base: string,
  ) => Effect.Effect<void, DependencyRunError>;
}

/** Claim an expiring Git-backed run slot, returning null for an active owner or cooldown. */
export const acquireDependencyLease = Effect.fn("Dependencies.acquireLease")(
  function* (
    remote: string,
    resource: string,
    log: DependencyRunLog,
    timeout: number,
    cooldown = 0,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const root = join(STATE_DIR, "dot", "dependency-leases");
    yield* fs.makeDirectory(root, { recursive: true, mode: 0o700 });

    const directory = yield* Effect.acquireRelease(
      fs.makeTempDirectory({ directory: root, prefix: "lease-" }),
      (path) => fs.remove(path, { recursive: true }).pipe(Effect.orDie),
    );

    const transport = dependencyGit(log, directory, timeout);

    const git = (args: readonly string[]) =>
      transport(args).pipe(
        Effect.mapError(
          (error) => new DependencyRunError({ message: error.message }),
        ),
      );

    const ref = `refs/heads/dot-deps-state/${createHash("sha256").update(resource).digest("hex")}`;
    const owner = randomUUID();
    const serial = yield* Semaphore.make(1);
    yield* git(["init", "--bare"]);
    yield* git(["config", "user.name", "dot deps"]);
    yield* git(["config", "user.email", "dot-deps@localhost"]);
    const empty = join(directory, "empty");
    yield* fs.writeFileString(empty, "");
    const tree = yield* git(["hash-object", "-w", "-t", "tree", empty]);

    const read = Effect.gen(function* () {
      const line = yield* git(["ls-remote", "--refs", remote, ref]);

      if (!line) return undefined;
      const sha = line.split(/\s/)[0];
      yield* git(["fetch", "--no-tags", remote, sha]);

      const state = yield* Schema.decodeEffect(
        Schema.fromJsonString(LeaseState),
      )(yield* git(["show", "-s", "--format=%B", sha])).pipe(
        Effect.mapError(
          () =>
            new DependencyRunError({
              message: `Invalid remote dependency lease ${ref}`,
            }),
        ),
      );

      return { sha, state };
    });

    const previous = yield* read;
    const now = yield* Clock.currentTimeMillis;

    if (
      previous &&
      (previous.state.expiresAt > now || previous.state.nextRunAt > now)
    ) {
      yield* log.event(
        `[SKIP] ${resource}: another machine owns the run or its interval is not due`,
      );

      return null;
    }

    const create = (state: typeof LeaseState.Type, parent?: string) =>
      git([
        "commit-tree",
        tree,
        ...(parent ? ["-p", parent] : []),
        "-m",
        JSON.stringify(state),
      ]);

    const state = {
      version: 1 as const,
      owner,
      expiresAt: now + LEASE_MILLIS,
      nextRunAt: 0,
    };

    const sha = yield* create(state, previous?.sha);
    yield* git([
      "push",
      `--force-with-lease=${ref}:${previous?.sha ?? ""}`,
      remote,
      `${sha}:${ref}`,
    ]).pipe(Effect.result);
    const observed = yield* read;

    if (observed?.sha !== sha) {
      if (observed && observed.sha !== previous?.sha) {
        yield* log.event(
          `[SKIP] ${resource}: another machine acquired the run`,
        );

        return null;
      }

      return yield* new DependencyRunError({
        message: `Could not acquire remote dependency lease ${ref}`,
      });
    }

    const current = yield* Ref.make(observed);
    yield* log.event(`[LEASE] Acquired ${resource}`);

    const owned = Effect.gen(function* () {
      const expected = yield* Ref.get(current);
      const latest = yield* read;

      if (
        latest?.sha !== expected.sha ||
        latest.state.owner !== owner ||
        latest.state.expiresAt <= (yield* Clock.currentTimeMillis)
      )
        return yield* new DependencyRunError({
          message: `Dependency lease ownership lost: ${resource}`,
        });

      return expected;
    });

    const advance = Effect.fn("Dependencies.advanceLease")(
      function* (
        publication:
          | { directory: string; commit: string; target: string; base: string }
          | undefined,
      ) {
        const expected = yield* owned;

        if (publication)
          yield* git([
            "fetch",
            "--no-tags",
            publication.directory,
            publication.commit,
          ]);

        const next = {
          ...expected.state,
          expiresAt: (yield* Clock.currentTimeMillis) + LEASE_MILLIS,
        };

        const nextSha = yield* create(next, expected.sha);

        const push = yield* git([
          "push",
          "--atomic",
          `--force-with-lease=${ref}:${expected.sha}`,
          ...(publication
            ? [
                `--force-with-lease=refs/heads/${publication.target}:${publication.base}`,
              ]
            : []),
          remote,
          `${nextSha}:${ref}`,
          ...(publication
            ? [`${publication.commit}:refs/heads/${publication.target}`]
            : []),
        ]).pipe(Effect.result);

        const latest = yield* read;

        if (latest?.sha !== nextSha)
          return yield* new DependencyRunError({
            message: `Dependency lease transaction failed for ${resource}${Result.isFailure(push) ? `: ${push.failure.message}` : ""}`,
          });
        yield* Ref.set(current, latest);
      },
      (effect) => effect.pipe(Semaphore.withPermit(serial)),
    );

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const expected = yield* Ref.get(current);
        const latest = yield* read;

        if (latest?.sha !== expected.sha || latest.state.owner !== owner)
          return;

        const completed = yield* Clock.currentTimeMillis;

        const idle = {
          version: 1 as const,
          owner: null,
          expiresAt: 0,
          nextRunAt: cooldown
            ? (Math.floor(completed / cooldown) + 1) * cooldown
            : 0,
        };

        const idleSha = yield* create(idle, expected.sha);
        yield* git([
          "push",
          `--force-with-lease=${ref}:${expected.sha}`,
          remote,
          `${idleSha}:${ref}`,
        ]);
        yield* log.event(`[LEASE] Released ${resource}`);
      }).pipe(
        Semaphore.withPermit(serial),
        Effect.catch((error) =>
          log
            .event(
              `[LEASE] Release failed; expiry will allow recovery: ${error.message}`,
            )
            .pipe(Effect.orDie),
        ),
      ),
    );

    return {
      assertOwned: owned.pipe(Effect.asVoid, Semaphore.withPermit(serial)),
      keepAlive: Effect.gen(function* () {
        yield* Effect.sleep("30 seconds");
        yield* advance(undefined);
      }).pipe(Effect.forever),
      publish: (directory, commit, target, base) =>
        advance({ directory, commit, target, base }),
    } satisfies DependencyLease;
  },
);
