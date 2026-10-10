import { Effect, Schema, Stream } from "../../dot/node_modules/effect/dist/index.js";
import { Gh, GhCommandError, GhDecodeError } from "../../dot/node_modules/@timmo001/effect-gh/src/index.ts";
import { GitHub, toGitHubError, type GitHubService } from "../../dot/src/git/services/GitHub.js";

/** Handlers for the argv the real effect-gh operations send to gh. */
export interface FakeGh {
  /** JSON reads (`gh api`, `gh release view --json`); return the parsed JSON. */
  // Raw fixture JSON; the real operation's response schema decodes it.
  // oxlint-disable-next-line anti-slop/no-unknown-returns
  readonly read?: (args: readonly string[]) => unknown;
  /** Commands whose stdout is used as text, such as mutations and `gh release create`. */
  readonly write?: (args: readonly string[]) => string;
}

const unexpected = (kind: string) => (args: readonly string[]) => {
  throw new Error(`Unexpected ${kind}: ${args.join(" ")}`);
};

/** A GitHub service that runs real effect-gh operations against fake gh output. */
export function fakeGitHub(handlers: FakeGh) {
  const read = handlers.read ?? unexpected("read");
  const write = handlers.write ?? unexpected("write");

  const gh = Gh.of({
    execute: (args) => Effect.sync(() => ({ stdout: write(args), stderr: "", exitCode: 0 })),
    json: (args, schema) =>
      Effect.try({
        try: () => read(args),
        catch: (cause) => new GhCommandError({ executable: "gh", exitCode: 1, stdout: "", stdoutTruncated: false, stderr: String(cause), stderrTruncated: false }),
      }).pipe(Effect.flatMap((value) => Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError((cause) => new GhDecodeError({ cause }))))),
    stream: () => Stream.die("Unexpected gh stream"),
    interactive: () => Effect.die("Unexpected interactive gh"),
  });

  const run: GitHubService["read"] = (label, operation) =>
    operation.pipe(Effect.provideService(Gh, gh), Effect.mapError((error) => toGitHubError(label, error)));

  return GitHub.of({ isAvailable: Effect.succeed(true), read: run, write: run });
}
