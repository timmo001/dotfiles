import { Effect, Option, Schema, Stdio, Stream } from "effect";
import {
  gitItemFromGitHubUrl,
  gitItemKey,
  gitItemLink,
  listedGitItems,
  openGitItemInPanel,
} from "../git/itemLinks.js";

const MAX_MESSAGE_BYTES = 1024 * 1024;

/** A request from the dot links extension about the page in a tab. */
const NativeRequest = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literals(["resolve", "open"]),
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

const answer = Effect.gen(function* () {
  const request = yield* readRequest;
  const item = gitItemFromGitHubUrl(request.url);

  if (request.type === "resolve") {
    if (!item)
      return { ok: true, link: null, listed: false } satisfies NativeReply;

    const listed = yield* listedGitItems([item]);

    return {
      ok: true,
      link: gitItemLink(item),
      listed: listed.has(gitItemKey(item)),
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
 * Stdout carries only the reply.
 */
export const linkNativeHost = answer.pipe(
  Effect.catchTag("NativeHostError", (error) =>
    Effect.succeed({ ok: false, error: error.message } satisfies NativeReply),
  ),
  Effect.flatMap((reply: NativeReply) => writeReply(reply)),
  Effect.withSpan("LinkNativeHost"),
);
