import { Effect, Option, Schema, Stdio, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { type TrackedCheckout, trackedCheckouts } from "../brief/repos.js";
import { itemAgentPrompt, itemOwnership } from "../git/itemAgent.js";
import {
  type GitItem,
  gitItemFromGitHubUrl,
  gitItemGitHubUrl,
  gitItemKey,
  gitItemLink,
  listedGitItems,
  openGitItemInPanel,
  pullRequestFromGitHubUrl,
} from "../git/itemLinks.js";
import { HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const MAX_MESSAGE_BYTES = 1024 * 1024;

/** A request from the dot links extension about the page in a tab. */
const NativeRequest = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literals(["resolve", "open", "review", "agent", "clear-deps"]),
    url: Schema.String,
  }),
);

/** A request the native host can't answer. */
class NativeHostError extends Schema.TaggedError<NativeHostError>()(
  "NativeHostError",
  { message: Schema.String },
) {}

// Chromium frames each message with a 32-bit length in native byte order,
// which is little-endian on every machine this runs on.
const frameLength = (bytes: Uint8Array) =>
  bytes.byteLength < 4
    ? undefined
    : new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);

const frameEnded = (bytes: Uint8Array) => {
  const length = frameLength(bytes);

  return (
    length !== undefined &&
    (length > MAX_MESSAGE_BYTES || bytes.byteLength >= 4 + length)
  );
};

const readRequest = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;

  const bytes = yield* stdio.stdin.pipe(
    Stream.scan(
      () => new Uint8Array(),
      (buffered, chunk) => {
        const combined = new Uint8Array(buffered.byteLength + chunk.byteLength);

        combined.set(buffered);
        combined.set(chunk, buffered.byteLength);

        return combined;
      },
    ),
    Stream.takeUntil(frameEnded),
    Stream.runLast,
    Effect.mapError(
      () => new NativeHostError({ message: "Could not read the request" }),
    ),
  );

  const length = Option.isSome(bytes) ? frameLength(bytes.value) : undefined;

  if (
    Option.isNone(bytes) ||
    length === undefined ||
    length > MAX_MESSAGE_BYTES ||
    bytes.value.byteLength < 4 + length
  )
    return yield* new NativeHostError({ message: "Incomplete request" });

  return yield* Schema.decodeEffect(NativeRequest)(
    new TextDecoder().decode(bytes.value.subarray(4, 4 + length)),
  ).pipe(
    Effect.mapError(
      () => new NativeHostError({ message: "Unsupported request" }),
    ),
  );
}).pipe(Effect.withSpan("LinkNativeHost.readRequest"));

/** The host's reply, sent back to the extension as JSON. */
type NativeReply =
  | {
      readonly ok: true;
      readonly link?: string | null;
      readonly listed?: boolean;
      /** The tracked checkout an agent on the issue or pull request opens in. */
      readonly checkout?: string | null;
    }
  | { readonly ok: false; readonly error: string };

const writeReply = Effect.fn("LinkNativeHost.writeReply")(function* (
  reply: NativeReply,
) {
  const stdio = yield* Stdio.Stdio;
  const payload = new TextEncoder().encode(JSON.stringify(reply));
  const frame = new Uint8Array(4 + payload.byteLength);

  new DataView(frame.buffer).setUint32(0, payload.byteLength, true);
  frame.set(payload, 4);

  yield* Stream.make(frame).pipe(
    Stream.run(stdio.stdout({ endOnDone: false })),
  );
});

// uwsm-app puts the command in its own unit, so it outlives this host and
// Chromium's process group.
const startApp = Effect.fn("LinkNativeHost.startApp")(function* (
  args: readonly string[],
  failure: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  yield* spawner
    .spawn(
      ChildProcess.make("uwsm-app", ["--", ...args], {
        cwd: HOME_DIR,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
      }),
    )
    .pipe(
      Effect.flatMap((child) => child.unref),
      Effect.asVoid,
      Effect.scoped,
      Effect.mapError(() => new NativeHostError({ message: failure })),
    );
});

const itemCheckout = Effect.fn("LinkNativeHost.itemCheckout")(function* (
  item: GitItem,
) {
  const checkouts = yield* trackedCheckouts([item.repo]).pipe(
    Effect.orElseSucceed(() => new Map<string, TrackedCheckout>()),
  );

  return checkouts.get(item.repo.toLowerCase()) ?? null;
});

const answer = Effect.gen(function* () {
  const request = yield* readRequest;
  const pull = pullRequestFromGitHubUrl(request.url);
  const item = gitItemFromGitHubUrl(request.url) ?? pull;

  if (request.type === "review") {
    if (!pull)
      return yield* new NativeHostError({ message: "Not a pull request" });

    yield* startApp(
      ["plannotator", "review", gitItemGitHubUrl(pull)],
      "Could not start Plannotator",
    );

    return { ok: true } satisfies NativeReply;
  }

  if (request.type === "clear-deps") {
    const executor = yield* CommandExecutor;

    // Starting the timer's unit, rather than running the command, joins a run
    // that's already going instead of racing it.
    yield* executor
      .run("systemctl", [
        "--user",
        "start",
        "--no-block",
        "dot-notifications-dismiss.service",
      ])
      .pipe(
        Effect.mapError(
          () =>
            new NativeHostError({
              message: "Could not start dot-notifications-dismiss.service",
            }),
        ),
      );

    return { ok: true } satisfies NativeReply;
  }

  if (request.type === "agent") {
    if (!item)
      return yield* new NativeHostError({
        message: "Not an issue or pull request",
      });

    const checkout = yield* itemCheckout(item);

    if (!checkout)
      return yield* new NativeHostError({
        message: `No tracked checkout of ${item.repo}`,
      });

    const prompt = itemAgentPrompt(item, yield* itemOwnership(item));

    yield* startApp(
      [
        "dot",
        "herdr",
        "repo",
        "open",
        "--agent",
        "opencode2",
        "--prompt",
        prompt,
        checkout.name,
        checkout.path,
      ],
      "Could not start an agent",
    );

    return { ok: true } satisfies NativeReply;
  }

  if (request.type === "resolve") {
    if (!item)
      return { ok: true, link: null, listed: false } satisfies NativeReply;

    const listed = yield* listedGitItems([item]);
    const checkout = yield* itemCheckout(item);

    return {
      ok: true,
      link: gitItemLink(item),
      listed: listed.has(gitItemKey(item)),
      checkout: checkout?.name ?? null,
    } satisfies NativeReply;
  }

  if (!item)
    return yield* new NativeHostError({
      message: "No Git panel link for this page",
    });

  if (!(yield* openGitItemInPanel(item)))
    return yield* new NativeHostError({ message: "Not in the Git panel" });

  return { ok: true } satisfies NativeReply;
});

/**
 * `dot link native-host`: the dot links Chromium extension's native messaging
 * host. Answers one request on stdin, in Chromium's length-prefixed JSON:
 * `resolve` reports a page's `dot://` link and whether the Git panel lists it,
 * and `open` opens it in the Git panel, never falling back to the browser.
 * `review` opens a pull request in a Plannotator review, from any of its tabs,
 * and `agent` starts an OpenCode agent on an issue or pull request in its
 * tracked checkout. `clear-deps` starts the dot-notifications-dismiss service
 * now instead of waiting for its timer.
 * Stdout carries only the reply.
 */
export const linkNativeHost = answer.pipe(
  Effect.catchTag("NativeHostError", (error) =>
    Effect.succeed({ ok: false, error: error.message } satisfies NativeReply),
  ),
  Effect.flatMap((reply: NativeReply) => writeReply(reply)),
  Effect.withSpan("LinkNativeHost"),
);
