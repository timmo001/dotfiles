import { Duration, Effect, Option, Predicate, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** The Plannotator Inbox could not be reached or refused a request. */
export class BriefInboxError extends Schema.TaggedError<BriefInboxError>()(
  "BriefInboxError",
  { message: Schema.String },
) {}

/** Name of the Inbox thread every report joins. */
export const BRIEF_THREAD = "Daily brief";

const CALL_ID = 2;

const CALL_TIMEOUT = Duration.seconds(60);

const RpcResponse = Schema.Struct({
  id: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(
    Schema.Struct({
      isError: Schema.optionalKey(Schema.Boolean),
      structuredContent: Schema.optionalKey(Schema.Unknown),
      content: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({ text: Schema.optionalKey(Schema.String) }),
        ),
      ),
    }),
  ),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
});

const SentMessage = Schema.Struct({
  message_id: Schema.String,
  thread_id: Schema.String,
});

const Answer = Schema.Struct({
  selected: Schema.optionalKey(Schema.Array(Schema.String)),
  note: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const Question = Schema.Struct({
  key: Schema.String,
  state: Schema.String,
  answer: Schema.optionalKey(Schema.NullOr(Answer)),
  sent_reply_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

/** Decoded Inbox question with the person's answer. */
export type InboxQuestion = typeof Question.Type;

const Message = Schema.Struct({
  id: Schema.String,
  reply_to: Schema.NullOr(Schema.String),
  author: Schema.Struct({ kind: Schema.String }),
  body: Schema.String,
  created_at: Schema.String,
  questions: Schema.optionalKey(Schema.Array(Question)),
});

/** Decoded Inbox message. */
export type InboxMessage = typeof Message.Type;

const ThreadResult = Schema.Struct({
  thread: Schema.Struct({
    thread_id: Schema.String,
    resolved_at: Schema.NullOr(Schema.String),
    messages: Schema.Array(Message),
  }),
});

/** Decoded Inbox thread. */
export type InboxThread = typeof ThreadResult.Type.thread;

/** Arguments of the Inbox's `send_message` tool used by the brief. */
interface SendArguments {
  readonly project_path: string;
  readonly thread: string;
  readonly body: string;
  readonly idempotency_key: string;
  readonly supersedes?: readonly string[];
}

/** Arguments of the Inbox's `read_thread` tool used by the brief. */
interface ReadArguments {
  readonly project_path: string;
  readonly thread_id: string;
  readonly asked_by: "anyone";
  readonly include_resolved: boolean;
}

/** One Inbox tool call. */
type ToolCall =
  | { readonly name: "send_message"; readonly arguments: SendArguments }
  | { readonly name: "read_thread"; readonly arguments: ReadArguments };

const encoder = new TextEncoder();

/**
 * Call one tool on `plannotator inbox mcp` over newline-delimited JSON-RPC.
 * Each call starts its own server: initialise, call, read the reply, close.
 */
const callTool = Effect.fn("brief.inbox.call")(
  function* (call: ToolCall) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const input = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "dot-brief", version: "1.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        jsonrpc: "2.0",
        id: CALL_ID,
        method: "tools/call",
        params: call,
      },
    ]
      .map((message) => `${JSON.stringify(message)}\n`)
      .join("");

    const handle = yield* spawner.spawn(
      ChildProcess.make("plannotator", ["inbox", "mcp"], {
        // Keep stdin open until the reply arrives; closing it stops the server.
        stdin: { stream: Stream.make(encoder.encode(input)), endOnDone: false },
        stdout: "pipe",
        stderr: "ignore",
      }),
    );

    const reply = yield* handle.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.map((line) =>
        Schema.decodeOption(Schema.fromJsonString(RpcResponse))(line),
      ),
      Stream.filter(Option.isSome),
      Stream.map((response) => response.value),
      Stream.filter((response) => response.id === CALL_ID),
      Stream.runHead,
    );

    if (Option.isNone(reply))
      return yield* new BriefInboxError({
        message: `plannotator inbox mcp closed before answering ${call.name}`,
      });

    const { result, error } = reply.value;

    if (error || !result || result.isError)
      return yield* new BriefInboxError({
        message: `${call.name} failed: ${error?.message ?? result?.content?.map((part) => part.text ?? "").join(" ") ?? "no result"}`,
      });

    return result.structuredContent;
  },
  Effect.scoped,
  Effect.timeout(CALL_TIMEOUT),
  Effect.mapError(
    (error) =>
      new BriefInboxError({
        message: Predicate.isTagged(error, "BriefInboxError")
          ? error.message
          : `Plannotator Inbox unavailable: ${error.message}`,
      }),
  ),
);

/** Post a message to the brief's Inbox thread. */
export const sendBrief = Effect.fn("brief.inbox.send")(function* (options: {
  readonly projectPath: string;
  readonly body: string;
  readonly idempotencyKey: string;
  readonly supersedes: readonly string[];
}) {
  const content = yield* callTool({
    name: "send_message",
    arguments: {
      project_path: options.projectPath,
      thread: BRIEF_THREAD,
      body: options.body,
      idempotency_key: options.idempotencyKey,
      ...(options.supersedes.length > 0 && {
        supersedes: options.supersedes,
      }),
    },
  });

  return yield* Schema.decodeUnknownEffect(SentMessage)(content).pipe(
    Effect.mapError(
      (error) =>
        new BriefInboxError({
          message: `Unexpected send_message reply: ${error.message}`,
        }),
    ),
  );
});

/** Read a whole Inbox thread, every message with its questions and answers. */
export const readBriefThread = Effect.fn("brief.inbox.read")(function* (
  projectPath: string,
  threadId: string,
) {
  const content = yield* callTool({
    name: "read_thread",
    arguments: {
      project_path: projectPath,
      thread_id: threadId,
      asked_by: "anyone",
      include_resolved: true,
    },
  });

  return yield* Schema.decodeUnknownEffect(ThreadResult)(content).pipe(
    Effect.map((result) => result.thread),
    Effect.mapError(
      (error) =>
        new BriefInboxError({
          message: `Unexpected read_thread reply: ${error.message}`,
        }),
    ),
  );
});
