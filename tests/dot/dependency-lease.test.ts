import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeServices } from "../../dot/node_modules/@effect/platform-node/dist/index.js";
import {
  Deferred,
  Effect,
  Exit,
  Scope,
} from "../../dot/node_modules/effect/dist/index.js";
import { acquireDependencyLease } from "../../dot/src/deps/lease";
import { DependencyRunError } from "../../dot/src/deps/state";
import type { DependencyRunLog } from "../../dot/src/deps/log";

const command = Effect.fn("Test.git")(function* (
  argv: readonly string[],
  cwd: string,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const process = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });

      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);

      if (code) throw new Error(stderr);

      return stdout.trim();
    },
    catch: (error) => new DependencyRunError({ message: String(error) }),
  });
});

const log: DependencyRunLog = {
  path: "local-git-test",
  event: () => Effect.void,
  command: (_label, argv, cwd) => command(argv, cwd),
};

const fixture = Effect.fn("Test.fixture")(function* () {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "dependency-lease-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );

  const git = (...args: string[]) =>
    command(
      [
        "git",
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        ...args,
      ],
      directory,
    );

  yield* git("init", "--bare");
  yield* Effect.promise(() => writeFile(join(directory, "empty"), ""));
  const tree = yield* git("hash-object", "-w", "-t", "tree", "empty");
  const base = yield* git("commit-tree", tree, "-m", "Base");
  yield* git("update-ref", "refs/heads/main", base);

  const candidate = yield* git(
    "commit-tree",
    tree,
    "-p",
    base,
    "-m",
    "Candidate",
  );

  const resource = "test-target";
  const ref = `refs/heads/dot-deps-state/${createHash("sha256").update(resource).digest("hex")}`;

  return { directory, git, tree, base, candidate, resource, ref };
});

test("concurrent machines get one claim and a shared cooldown", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const remote = yield* fixture();
      const ready = yield* Deferred.make<void>();
      let arrivals = 0;

      const racingLog: DependencyRunLog = {
        ...log,
        command: (label, argv, cwd, timeout, capture) =>
          Effect.gen(function* () {
            if (
              argv.includes("push") &&
              !argv.includes("--atomic") &&
              arrivals < 2
            ) {
              arrivals++;

              if (arrivals === 2) yield* Deferred.succeed(ready, undefined);
              yield* Deferred.await(ready);
            }

            return yield* log.command(label, argv, cwd, timeout, capture);
          }),
      };

      yield* Effect.gen(function* () {
        const claims = yield* Effect.all(
          [0, 1].map(() =>
            acquireDependencyLease(
              remote.directory,
              remote.resource,
              racingLog,
              30_000,
              900_000,
            ),
          ),
          { concurrency: 2 },
        );

        expect(claims.filter(Boolean)).toHaveLength(1);

        for (const claim of claims) if (claim) yield* claim.assertOwned;
      }).pipe(Effect.scoped);
      expect(
        yield* acquireDependencyLease(
          remote.directory,
          remote.resource,
          log,
          30_000,
          900_000,
        ),
      ).toBeNull();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

test("target and ownership advance atomically, including server rejection", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const remote = yield* fixture();

      const lease = yield* acquireDependencyLease(
        remote.directory,
        remote.resource,
        log,
        30_000,
      );

      if (!lease) return yield* Effect.die("Missing claim");
      const before = yield* remote.git("rev-parse", remote.ref);
      const hook = join(remote.directory, "hooks", "update");
      yield* Effect.promise(() =>
        writeFile(
          hook,
          '#!/bin/sh\ncase "$1" in refs/heads/dot-deps-state/*) exit 1;; esac\n',
          { mode: 0o755 },
        ),
      );
      expect(
        (yield* lease
          .publish(remote.directory, remote.candidate, "main", remote.base)
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(yield* remote.git("rev-parse", "main")).toBe(remote.base);
      expect(yield* remote.git("rev-parse", remote.ref)).toBe(before);
      yield* Effect.promise(() => rm(hook));
      yield* lease.publish(
        remote.directory,
        remote.candidate,
        "main",
        remote.base,
      );
      expect(yield* remote.git("rev-parse", "main")).toBe(remote.candidate);
      expect(yield* remote.git("rev-parse", remote.ref)).not.toBe(before);
      yield* lease.assertOwned;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

test("expired owner cannot publish or release a replacement claim", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const remote = yield* fixture();
      const oldScope = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(oldScope, Exit.void));

      const old = yield* acquireDependencyLease(
        remote.directory,
        remote.resource,
        log,
        30_000,
      ).pipe(Scope.provide(oldScope));

      if (!old) return yield* Effect.die("Missing old claim");
      const previous = yield* remote.git("rev-parse", remote.ref);

      const expired = yield* remote.git(
        "commit-tree",
        remote.tree,
        "-p",
        previous,
        "-m",
        JSON.stringify({
          version: 1,
          owner: "expired",
          expiresAt: 0,
          nextRunAt: 0,
        }),
      );

      yield* remote.git("update-ref", remote.ref, expired, previous);

      const replacement = yield* acquireDependencyLease(
        remote.directory,
        remote.resource,
        log,
        30_000,
      );

      if (!replacement) return yield* Effect.die("Missing replacement claim");
      const claimed = yield* remote.git("rev-parse", remote.ref);
      expect(
        (yield* old
          .publish(remote.directory, remote.candidate, "main", remote.base)
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(yield* remote.git("rev-parse", "main")).toBe(remote.base);
      yield* Scope.close(oldScope, Exit.void);
      expect(yield* remote.git("rev-parse", remote.ref)).toBe(claimed);
      yield* replacement.assertOwned;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
