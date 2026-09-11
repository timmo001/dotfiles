import { expect, test } from "bun:test";
import { Gh, layer } from "@timmo001/effect-gh";
import {
  Deferred,
  Effect,
  Fiber,
  Layer,
  Match,
  Predicate,
  Sink,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { GitHub } from "../src/git/services/GitHub.js";
import { CommandExecutor } from "../src/services/CommandExecutor.js";
import { ghOutput } from "../src/lib/gh.js";
import { ghRepoCloneCaptured } from "../src/lib/git.js";
import { checkGithubMcpAuth } from "../src/doctor/checks/githubMcpAuth.js";

const text = (value: string) => Stream.succeed(new TextEncoder().encode(value));

const fixture = Effect.fn("test.fixture")(function* (
  response: (
    command: ChildProcess.StandardCommand,
  ) => Partial<ChildProcessSpawner.ChildProcessHandle>,
) {
  const commands: ChildProcess.StandardCommand[] = [];
  const spawned = yield* Deferred.make<void>();
  let releases = 0;

  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      if (!Predicate.isTagged(command, "StandardCommand"))
        return Effect.die("Expected literal gh argv");

      return Effect.acquireRelease(
        Effect.sync(() => {
          commands.push(command);

          return ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout: Stream.empty,
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
            ...response(command),
          });
        }).pipe(Effect.tap(() => Deferred.succeed(spawned, undefined))),
        () =>
          Effect.sync(() => {
            releases++;
          }),
      );
    }),
  );

  const sdk = layer().pipe(Layer.provide(spawner));

  const executor = Layer.mock(CommandExecutor, {
    exitCode: () => Effect.succeed(0),
  });

  return {
    commands,
    spawned,
    releases: () => releases,
    sdk,
    github: GitHub.layer.pipe(Layer.provide([sdk, executor])),
    doctor: Layer.merge(sdk, executor),
  };
});

test("rate-limit retries retain full stderr, invalidate the cache and stop at the bound", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const failed = yield* Deferred.make<void>();
      const stderr = `  rate limit exceeded\n${"x".repeat(70_000)}\n`;

      const fake = yield* fixture((command) =>
        command.args[1] === "rate_limit"
          ? { stdout: text("10\t0\n") }
          : {
              stderr: text(stderr),
              exitCode: Deferred.succeed(failed, undefined).pipe(
                Effect.as(ChildProcessSpawner.ExitCode(7)),
              ),
            },
      );

      const github = yield* GitHub.pipe(Effect.provide(fake.github));

      const fiber = yield* github
        .run(["api", "user"], { retries: 1 })
        .pipe(Effect.flip, Effect.forkChild);

      yield* Deferred.await(failed);
      yield* TestClock.adjust("1 second");
      const error = yield* Fiber.join(fiber);
      expect(error._tag).toBe("GitHubError");
      expect(error).toMatchObject({
        command: "gh api user",
        exitCode: 7,
        stderr: stderr.trim(),
        rateLimited: true,
        retryable: true,
      });
      expect(fake.commands.map((command) => command.args[1])).toEqual([
        "rate_limit",
        "user",
        "rate_limit",
        "user",
      ]);
      expect(fake.releases()).toBe(4);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

test("JSON pages, jq output and decode failures keep their existing contracts", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* fixture((command) => ({
        stdout: text(
          Match.value(command.args[1]).pipe(
            Match.when("rate_limit", () => "10\t0\n"),
            Match.when("items", () => '[[{"id":1}],[]]'),
            Match.when("user", () => "  login\n"),
            Match.orElse(() => "invalid JSON"),
          ),
        ),
      }));

      const github = yield* GitHub.pipe(Effect.provide(fake.github));
      const args = ["api", "items", "--paginate", "--slurp"];
      expect(yield* github.json(args)).toEqual([[{ id: 1 }], []]);
      expect(yield* github.api("user", { jq: ".login" })).toBe("login");
      const error = yield* github.json(["api", "bad"]).pipe(Effect.flip);
      expect(error._tag).toBe("GitHubError");
      expect(error).toMatchObject({
        retryable: false,
        rateLimited: false,
      });
      expect(fake.commands.map((command) => command.args)).toEqual([
        [
          "api",
          "rate_limit",
          "--jq",
          ".resources.core | [.remaining, .reset] | @tsv",
        ],
        args,
        ["api", "user", "--jq", ".login"],
        ["api", "bad"],
      ]);
    }),
  );
});

test("captured clone keeps literal args, noninteractive git settings and domain errors", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* fixture(() => ({
        stdout: text("discarded progress"),
        stderr: text("  clone failed\n"),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(3)),
      }));

      const error = yield* ghRepoCloneCaptured("owner/repo", "test clone", [
        "--depth",
        "1",
      ]).pipe(Effect.provide(fake.sdk), Effect.flip);

      expect(error._tag).toBe("GitCommandError");
      expect(error).toMatchObject({
        message:
          "gh repo clone owner/repo test clone -- --depth 1 failed with exit 3: clone failed",
      });
      expect(fake.commands[0]).toMatchObject({
        command: "gh",
        args: [
          "repo",
          "clone",
          "owner/repo",
          "test clone",
          "--",
          "--depth",
          "1",
        ],
        options: {
          shell: false,
          stdin: "ignore",
          env: {
            GIT_TERMINAL_PROMPT: "0",
            GIT_SSH_COMMAND:
              "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
            GH_PROMPT_DISABLED: "1",
          },
        },
      });
      expect(fake.releases()).toBe(1);
    }),
  );
});

test("caller timeouts interrupt captured gh and release the child scope", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* fixture(() => ({
        stdout: Stream.never,
        exitCode: Effect.never,
      }));

      const gh = yield* Gh.pipe(Effect.provide(fake.sdk));

      const fiber = yield* ghOutput(gh, ["api", "user"]).pipe(
        Effect.timeout("5 seconds"),
        Effect.flip,
        Effect.forkChild,
      );

      yield* Deferred.await(fake.spawned);
      yield* TestClock.adjust("5 seconds");
      expect((yield* Fiber.join(fiber))._tag).toBe("TimeoutError");
      expect(fake.releases()).toBe(1);
      expect(fake.commands).toHaveLength(1);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

test("doctor auth drains both pipes without including tokens in its report", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* fixture(() => ({
        stdout: text("secret-token"),
        stderr: text("secret-diagnostic"),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
      }));

      const results = yield* checkGithubMcpAuth.pipe(
        Effect.provide(fake.doctor),
      );

      expect(results).toEqual([
        {
          severity: "warn",
          message:
            "gh has no token; the GitHub MCP server will fail to authenticate",
          detail: "Run: gh auth login",
        },
      ]);
      expect(fake.commands[0]?.args).toEqual(["auth", "token"]);
      expect(fake.releases()).toBe(1);
    }),
  );
});
