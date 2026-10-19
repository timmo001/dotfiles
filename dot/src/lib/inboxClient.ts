import {
  Duration,
  Effect,
  Option,
  Predicate,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** The Plannotator Inbox could not be reached or refused a request. */
export class InboxError extends Schema.TaggedError<InboxError>()("InboxError", {
  message: Schema.String,
}) {}

/** Longer than a `wait_for_reply` hold, so a wait isn't cut short. */
const CALL_TIMEOUT = Duration.seconds(90);

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

type RpcResponse = typeof RpcResponse.Type;

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
  /** Questions closed unanswered by "Mark read"; the Inbox writes this message, not the person. */
  set_aside: Schema.optionalKey(Schema.Array(Schema.String)),
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

/** Arguments of the Inbox's `send_message` tool. */
interface SendArguments {
  readonly project_path: string;
  readonly thread?: string;
  readonly reply_to?: string;
  readonly subject?: string;
  readonly body: string;
  readonly idempotency_key: string;
  readonly supersedes?: readonly string[];
  readonly attachments?: readonly string[];
}

/** Arguments of the Inbox's `read_thread` tool. */
interface ReadArguments {
  readonly project_path: string;
  readonly thread_id: string;
  readonly asked_by: "anyone";
  readonly include_resolved: boolean;
}

/** Arguments of the Inbox's `wait_for_reply` tool. */
interface WaitArguments {
  readonly project_path: string;
  readonly thread_id: string;
  readonly cursor?: number;
  readonly timeout_seconds: number;
}

/** One Inbox tool call. */
type ToolCall =
  | { readonly name: "send_message"; readonly arguments: SendArguments }
  | { readonly name: "read_thread"; readonly arguments: ReadArguments }
  | { readonly name: "wait_for_reply"; readonly arguments: WaitArguments };

const WaitResult = Schema.Struct({
  status: Schema.String,
  cursor: Schema.optionalKey(Schema.Finite),
});

/** How long one `wait_for_reply` holds before handing back a cursor. */
const WAIT_SECONDS = 50;

/** Parameters of the MCP `initialize` request. */
interface InitializeParams {
  readonly protocolVersion: string;
  readonly capabilities: Readonly<Record<string, never>>;
  readonly clientInfo: { readonly name: string; readonly version: string };
}

type RpcParams = InitializeParams | ToolCall;

/** A JSON-RPC request or notification sent to the Inbox server. */
interface RpcMessage {
  readonly jsonrpc: "2.0";
  readonly id?: number;
  readonly method: string;
  readonly params?: RpcParams;
}

const encoder = new TextEncoder();

/** An open connection to `plannotator inbox mcp`. */
export interface InboxSession {
  /** Call one Inbox tool and decode its structured result with `reply`. */
  readonly call: <A>(
    call: ToolCall,
    reply: Schema.Decoder<A>,
  ) => Effect.Effect<A, InboxError>;
}

const inboxError = (error: { readonly message: string }) =>
  new InboxError({
    message: Predicate.isTagged(error, "InboxError")
      ? error.message
      : `Plannotator Inbox unavailable: ${error.message}`,
  });

/**
 * Start `plannotator inbox mcp` for the life of the scope and initialise it.
 * Requests go out over stdin as newline-delimited JSON-RPC, one at a time.
 */
export const openInboxSession = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const requests = yield* Queue.unbounded<Uint8Array>();
  const responses = yield* Queue.unbounded<RpcResponse, InboxError>();
  const ids = yield* Ref.make(1);

  const handle = yield* spawner.spawn(
    ChildProcess.make("plannotator", ["inbox", "mcp"], {
      stdin: { stream: Stream.fromQueue(requests) },
      stdout: "pipe",
      stderr: "ignore",
    }),
  );

  yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.map((line) =>
      Schema.decodeOption(Schema.fromJsonString(RpcResponse))(line),
    ),
    Stream.filter(Option.isSome),
    Stream.runForEach((response) => Queue.offer(responses, response.value)),
    Effect.exit,
    Effect.andThen(
      Queue.fail(
        responses,
        new InboxError({ message: "plannotator inbox mcp closed" }),
      ),
    ),
    Effect.forkScoped,
  );

  const send = (message: RpcMessage) =>
    Queue.offer(requests, encoder.encode(`${JSON.stringify(message)}\n`));

  const request = Effect.fn("inbox.request")(function* (
    method: string,
    params: RpcParams,
  ) {
    const id = yield* Ref.getAndUpdate(ids, (next) => next + 1);

    yield* send({ jsonrpc: "2.0", id, method, params });

    for (;;) {
      const response = yield* Queue.take(responses);

      if (response.id === id) return response;
    }
  });

  yield* request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "dot", version: "1.0.0" },
  }).pipe(Effect.timeout(CALL_TIMEOUT));

  yield* send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const call = Effect.fn("inbox.call")(
    function* <A>(tool: ToolCall, reply: Schema.Decoder<A>) {
      const { result, error } = yield* request("tools/call", tool);

      if (error || !result || result.isError)
        return yield* new InboxError({
          message: `${tool.name} failed: ${error?.message ?? result?.content?.map((part) => part.text ?? "").join(" ") ?? "no result"}`,
        });

      return yield* Schema.decodeUnknownEffect(reply)(
        result.structuredContent,
      ).pipe(
        Effect.mapError(
          (decodeError) =>
            new InboxError({
              message: `Unexpected ${tool.name} reply: ${decodeError.message}`,
            }),
        ),
      );
    },
    Effect.timeout(CALL_TIMEOUT),
    Effect.mapError(inboxError),
  );

  return { call } satisfies InboxSession;
}).pipe(Effect.mapError(inboxError));

/** Call one tool on a session of its own, closed straight after. */
const callTool = <A>(tool: ToolCall, reply: Schema.Decoder<A>) =>
  openInboxSession.pipe(
    Effect.flatMap((session) => session.call(tool, reply)),
    Effect.scoped,
  );

/** Options for {@link sendInboxMessage}. */
export interface SendInboxMessageOptions {
  /** Repository or folder the message belongs to. */
  readonly projectPath: string;
  /** Named thread to join or start; ignored with {@link replyTo}. */
  readonly thread?: string;
  /** Message id to reply to, in that message's thread. */
  readonly replyTo?: string;
  /** Subject when the message starts a thread. */
  readonly subject?: string;
  /** Markdown body. */
  readonly body: string;
  /** Sending again with the same key doesn't post twice. */
  readonly idempotencyKey: string;
  /** Earlier open questions this message withdraws. */
  readonly supersedes?: readonly string[];
  /** Absolute paths of files shown beside the message. */
  readonly attachments?: readonly string[];
}

/** Post a message to the Plannotator Inbox. */
export const sendInboxMessage = Effect.fn("inbox.send")(function* (
  options: SendInboxMessageOptions,
) {
  return yield* callTool(
    {
      name: "send_message",
      arguments: {
        project_path: options.projectPath,
        body: options.body,
        idempotency_key: options.idempotencyKey,
        ...(options.thread !== undefined && { thread: options.thread }),
        ...(options.replyTo !== undefined && { reply_to: options.replyTo }),
        ...(options.subject !== undefined && { subject: options.subject }),
        ...(options.supersedes &&
          options.supersedes.length > 0 && { supersedes: options.supersedes }),
        ...(options.attachments &&
          options.attachments.length > 0 && {
            attachments: options.attachments,
          }),
      },
    },
    SentMessage,
  );
});

/** Read a whole Inbox thread, every message with its questions and answers. */
export const readInboxThread = Effect.fn("inbox.read")(function* (
  projectPath: string,
  threadId: string,
) {
  const result = yield* callTool(
    {
      name: "read_thread",
      arguments: {
        project_path: projectPath,
        thread_id: threadId,
        asked_by: "anyone",
        include_resolved: true,
      },
    },
    ThreadResult,
  );

  return result.thread;
});

/**
 * Hold until the person replies in the thread, or about 50 seconds pass.
 * `status` is `replied`, `waiting` or `resolved`; pass `cursor` to the next
 * wait so nothing in between is missed.
 */
export const waitForInboxReply = Effect.fn("inbox.wait")(function* (
  session: InboxSession,
  options: {
    readonly projectPath: string;
    readonly threadId: string;
    readonly cursor: number | undefined;
  },
) {
  return yield* session.call(
    {
      name: "wait_for_reply",
      arguments: {
        project_path: options.projectPath,
        thread_id: options.threadId,
        timeout_seconds: WAIT_SECONDS,
        ...(options.cursor !== undefined && { cursor: options.cursor }),
      },
    },
    WaitResult,
  );
});
