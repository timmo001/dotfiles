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
export class BriefInboxError extends Schema.TaggedError<BriefInboxError>()(
  "BriefInboxError",
  { message: Schema.String },
) {}

/** Name of the Inbox thread every report joins. */
export const BRIEF_THREAD = "Daily brief";

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

/** Arguments of the Inbox's `wait_for_reply` tool used by the brief. */
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
  /** Call one Inbox tool and return its structured result. */
  readonly call: (call: ToolCall) => Effect.Effect<unknown, BriefInboxError>;
}

const inboxError = (error: { readonly message: string }) =>
  new BriefInboxError({
    message: Predicate.isTagged(error, "BriefInboxError")
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
  const responses = yield* Queue.unbounded<RpcResponse, BriefInboxError>();
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
        new BriefInboxError({ message: "plannotator inbox mcp closed" }),
      ),
    ),
    Effect.forkScoped,
  );

  const send = (message: RpcMessage) =>
    Queue.offer(requests, encoder.encode(`${JSON.stringify(message)}\n`));

  const request = Effect.fn("brief.inbox.request")(function* (
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
    clientInfo: { name: "dot-brief", version: "1.0.0" },
  }).pipe(Effect.timeout(CALL_TIMEOUT));

  yield* send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const call = Effect.fn("brief.inbox.call")(
    function* (tool: ToolCall) {
      const { result, error } = yield* request("tools/call", tool);

      if (error || !result || result.isError)
        return yield* new BriefInboxError({
          message: `${tool.name} failed: ${error?.message ?? result?.content?.map((part) => part.text ?? "").join(" ") ?? "no result"}`,
        });

      return result.structuredContent;
    },
    Effect.timeout(CALL_TIMEOUT),
    Effect.mapError(inboxError),
  );

  return { call } satisfies InboxSession;
}).pipe(Effect.mapError(inboxError));

/** Call one tool on a session of its own, closed straight after. */
const callTool = (tool: ToolCall) =>
  openInboxSession.pipe(
    Effect.flatMap((session) => session.call(tool)),
    Effect.scoped,
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

/**
 * Hold until the person replies in the thread, or about 50 seconds pass.
 * `status` is `replied`, `waiting` or `resolved`; pass `cursor` to the next
 * wait so nothing in between is missed.
 */
export const waitForBriefReply = Effect.fn("brief.inbox.wait")(function* (
  session: InboxSession,
  options: {
    readonly projectPath: string;
    readonly threadId: string;
    readonly cursor: number | undefined;
  },
) {
  const content = yield* session.call({
    name: "wait_for_reply",
    arguments: {
      project_path: options.projectPath,
      thread_id: options.threadId,
      timeout_seconds: WAIT_SECONDS,
      ...(options.cursor !== undefined && { cursor: options.cursor }),
    },
  });

  return yield* Schema.decodeUnknownEffect(WaitResult)(content).pipe(
    Effect.mapError(
      (error) =>
        new BriefInboxError({
          message: `Unexpected wait_for_reply reply: ${error.message}`,
        }),
    ),
  );
});
