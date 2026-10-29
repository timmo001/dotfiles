import { Effect, FileSystem, Option, Schema } from "effect";
import { isAbsolute, join, relative } from "node:path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import type { CommandError } from "../services/CommandExecutor.js";
import { CONFIG_DIR, displayPath } from "./paths.js";

/** Where the HA box queue is configured, stowed from the private overlay. */
export const SESSION_QUEUE_CONFIG_PATH = join(
  CONFIG_DIR,
  "dot",
  "session-queue.yml",
);

const DEFAULT_QUEUE_PATH = "/share/opencode-sessions";

/** Entry IDs and host names are used as remote path segments. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** SSH destination and queue folder on the box. */
export const SessionQueueConfig = Schema.Struct({
  ssh: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_][\w.@-]*$/)),
  path: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^\/[\w./-]+$/)),
  ),
});

/** Decoded {@link SessionQueueConfig} with the queue path resolved. */
export interface SessionQueue {
  /** SSH destination, such as `user@host`; port and key come from `~/.ssh/config`. */
  readonly ssh: string;
  /** Absolute queue folder on the box. */
  readonly path: string;
}

const Repository = Schema.Struct({
  github: Schema.NullOr(Schema.String),
  name: Schema.String,
  subdirectory: Schema.String,
  branch: Schema.NullOr(Schema.String),
  head: Schema.String,
  pushed: Schema.Boolean,
});

/**
 * A sent file or folder, stored as `attachments/<index>` in the entry. `path`
 * is relative to the session's directory or the home directory, so it lands in
 * the same place on a machine with different paths, or absolute otherwise.
 */
const Attachment = Schema.Struct({
  base: Schema.Literals(["directory", "home", "root"]),
  path: Schema.String,
});

/** Decoded {@link Attachment}. */
export interface Attachment extends Schema.Schema.Type<typeof Attachment> {}

/** `path` relative to `base` when it is strictly inside it. */
const inside = (base: string, path: string) => {
  const rel = relative(base, path);

  return rel !== "" &&
    rel !== ".." &&
    !rel.startsWith("../") &&
    !isAbsolute(rel)
    ? rel
    : undefined;
};

/** Where an attachment goes, relative to `directory` or `home` where possible. */
export function attachmentFor(
  path: string,
  directory: string,
  home: string,
): Attachment {
  const inDirectory = inside(directory, path);

  if (inDirectory !== undefined)
    return { base: "directory", path: inDirectory };

  const inHome = inside(home, path);

  return inHome !== undefined
    ? { base: "home", path: inHome }
    : { base: "root", path };
}

/** Where an attachment belongs on this machine, or `null` if it would escape its base. */
export function attachmentTarget(
  attachment: Attachment,
  directory: string,
  home: string,
): string | null {
  const base = { directory, home, root: "/" }[attachment.base];

  const target =
    attachment.base === "root" ? attachment.path : join(base, attachment.path);

  return isAbsolute(target) && inside(base, target) !== undefined
    ? target
    : null;
}

/** What `send` writes next to the exported sessions. */
export const QueueMeta = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String.check(Schema.isPattern(SAFE_NAME)),
  sessionId: Schema.String,
  sessions: Schema.Array(Schema.String),
  title: Schema.NullOr(Schema.String),
  host: Schema.String,
  sentAt: Schema.String,
  opencodeVersion: Schema.String,
  directory: Schema.String,
  busy: Schema.Boolean,
  repository: Schema.NullOr(Repository),
  herdr: Schema.NullOr(Schema.Struct({ workspace: Schema.String })),
  patch: Schema.NullOr(Schema.Struct({ files: Schema.Finite })),
  attachments: Schema.optionalKey(Schema.Array(Attachment)),
});

/** Decoded {@link QueueMeta}. */
export interface QueueMeta extends Schema.Schema.Type<typeof QueueMeta> {}

/** A queue operation, config read or remote command failed. */
export class SessionQueueError extends Schema.TaggedError<SessionQueueError>()(
  "SessionQueueError",
  { message: Schema.String },
) {}

/** Read the queue config, or `null` when this machine has none. */
export const readSessionQueueConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(SESSION_QUEUE_CONFIG_PATH))) return null;

  const config = yield* fs.readFileString(SESSION_QUEUE_CONFIG_PATH).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(SessionQueueConfig)),
    Effect.mapError(
      (cause) =>
        new SessionQueueError({
          message: `read ${displayPath(SESSION_QUEUE_CONFIG_PATH)}: ${cause.message}`,
        }),
    ),
  );

  return {
    ssh: config.ssh,
    path: (config.path ?? DEFAULT_QUEUE_PATH).replace(/\/+$/, ""),
  } satisfies SessionQueue;
}).pipe(Effect.withSpan("SessionQueue.readConfig"));

/** Check a value is safe to use as one remote path segment. */
export function isSafeName(value: string): boolean {
  return SAFE_NAME.test(value);
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const sshArgs = (queue: SessionQueue, script: string) => [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=10",
  queue.ssh,
  `sh -c ${quote(`P=${quote(queue.path)}; ${script}`)}`,
];

const sshFailure = (queue: SessionQueue) => (error: CommandError) =>
  new SessionQueueError({
    message:
      error.stderr.trim() || `ssh ${queue.ssh} failed (exit ${error.exitCode})`,
  });

const remote = Effect.fn("SessionQueue.remote")(function* (
  queue: SessionQueue,
  script: string,
) {
  const executor = yield* CommandExecutor;

  return yield* executor
    .run("ssh", sshArgs(queue, script))
    .pipe(Effect.mapError(sshFailure(queue)));
});

const remoteVariables = Effect.fn("SessionQueue.remoteVariables")(function* (
  values: Readonly<Record<string, string>>,
) {
  const entries = Object.entries(values);

  for (const [name, value] of entries)
    if (!isSafeName(value))
      return yield* new SessionQueueError({
        message: `Unsafe ${name} for the queue: ${value}`,
      });

  return entries.map(([name, value]) => `${name}=${quote(value)}`).join("; ");
});

/** Check the box is reachable and the queue folder is writable. */
export const probe = (queue: SessionQueue) =>
  remote(queue, 'test -d "$P/pending" && test -w "$P"');

/**
 * Upload `<parent>/<id>` into `incoming/`, then move it to `pending/`, so
 * listing never sees a half-written entry.
 */
export const upload = Effect.fn("SessionQueue.upload")(function* (
  queue: SessionQueue,
  parent: string,
  id: string,
) {
  const executor = yield* CommandExecutor;
  const vars = yield* remoteVariables({ ID: id });

  yield* executor
    .run("bash", [
      "-o",
      "pipefail",
      "-c",
      'tar -C "$1" -cf - "$2" | ssh "${@:3}"',
      "bash",
      parent,
      id,
      ...sshArgs(
        queue,
        `${vars}; mkdir -p "$P/incoming" "$P/pending" && tar -C "$P/incoming" -xf - && mv -T "$P/incoming/$ID" "$P/pending/$ID"`,
      ),
    ])
    .pipe(Effect.mapError(sshFailure(queue)));
});

/** List pending entries, skipping any whose metadata doesn't decode. */
export const listPending = Effect.fn("SessionQueue.listPending")(function* (
  queue: SessionQueue,
) {
  const output = yield* remote(
    queue,
    'for f in "$P"/pending/*/meta.json; do [ -f "$f" ] && cat "$f" && echo; done; true',
  );

  const entries: QueueMeta[] = [];
  const skipped: string[] = [];
  const decode = Schema.decodeEffect(Schema.fromJsonString(QueueMeta));

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;

    const decoded = yield* decode(line).pipe(Effect.option);

    if (Option.isSome(decoded)) entries.push(decoded.value);
    else skipped.push(line.slice(0, 80));
  }

  return {
    entries: entries.sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
    skipped,
  };
});

/**
 * Claim an entry for this host with one `mv`. A rename on one filesystem is
 * atomic, so when two machines take the same entry only one succeeds.
 */
export const claim = Effect.fn("SessionQueue.claim")(function* (
  queue: SessionQueue,
  id: string,
  host: string,
) {
  const vars = yield* remoteVariables({ ID: id, H: host });

  yield* remote(
    queue,
    `${vars}; mkdir -p "$P/claimed/$H" && mv -T "$P/pending/$ID" "$P/claimed/$H/$ID"`,
  ).pipe(
    Effect.mapError((error) =>
      /No such file|can't rename/.test(error.message)
        ? new SessionQueueError({
            message: `${id} is no longer pending; another machine may have taken it`,
          })
        : error,
    ),
  );
});

/** Download a claimed entry into `<to>/<id>`. */
export const download = Effect.fn("SessionQueue.download")(function* (
  queue: SessionQueue,
  id: string,
  host: string,
  to: string,
) {
  const executor = yield* CommandExecutor;
  const vars = yield* remoteVariables({ ID: id, H: host });

  yield* executor
    .run("bash", [
      "-o",
      "pipefail",
      "-c",
      'ssh "${@:2}" | tar -C "$1" -xf -',
      "bash",
      to,
      ...sshArgs(queue, `${vars}; tar -C "$P/claimed/$H" -cf - "$ID"`),
    ])
    .pipe(Effect.mapError(sshFailure(queue)));
});

/** Move a claimed entry to `done/` once it has been imported. */
export const finish = Effect.fn("SessionQueue.finish")(function* (
  queue: SessionQueue,
  id: string,
  host: string,
) {
  const vars = yield* remoteVariables({ ID: id, H: host });

  yield* remote(
    queue,
    `${vars}; mkdir -p "$P/done" && mv -T "$P/claimed/$H/$ID" "$P/done/$ID"`,
  );
});

/** Put a claimed entry back in `pending/` after a failed take. */
export const release = Effect.fn("SessionQueue.release")(function* (
  queue: SessionQueue,
  id: string,
  host: string,
) {
  const vars = yield* remoteVariables({ ID: id, H: host });

  yield* remote(queue, `${vars}; mv -T "$P/claimed/$H/$ID" "$P/pending/$ID"`);
});

/** Move a pending entry to `removed/`, so nothing can take it but it can still be recovered. */
export const remove = Effect.fn("SessionQueue.remove")(function* (
  queue: SessionQueue,
  id: string,
) {
  const vars = yield* remoteVariables({ ID: id });

  yield* remote(
    queue,
    `${vars}; mkdir -p "$P/removed" && mv -T "$P/pending/$ID" "$P/removed/$ID"`,
  ).pipe(
    Effect.mapError((error) =>
      /No such file|can't rename/.test(error.message)
        ? new SessionQueueError({
            message: `${id} is no longer pending; another machine may have taken it`,
          })
        : error,
    ),
  );
});

/**
 * Walk a session and its subagent sessions breadth-first, so every parent
 * comes before its children. OpenCode's import rejects a child whose parent
 * doesn't exist yet.
 */
export const sessionTree = Effect.fn("SessionQueue.sessionTree")(function* <
  E,
  R,
>(
  root: string,
  childrenOf: (id: string) => Effect.Effect<readonly string[], E, R>,
) {
  const order = [root];
  const seen = new Set(order);

  // The iterator also visits children pushed during the walk.
  for (const id of order)
    for (const child of yield* childrenOf(id))
      if (!seen.has(child)) {
        seen.add(child);
        order.push(child);
      }

  return order;
});

/**
 * Map a queued session onto this machine: the tracked checkout for its GitHub
 * repository plus the same subdirectory, otherwise the sender's own path.
 */
export function localDirectory(
  meta: Pick<QueueMeta, "directory" | "repository">,
  tracked: readonly {
    readonly github: string | null;
    readonly path: string;
    readonly name: string;
  }[],
): { readonly directory: string; readonly name: string | null } {
  const github = meta.repository?.github;

  const repo =
    github === null || github === undefined
      ? undefined
      : tracked.find((candidate) => candidate.github === github);

  return repo && meta.repository
    ? {
        directory: join(repo.path, meta.repository.subdirectory),
        name: repo.name,
      }
    : { directory: meta.directory, name: null };
}
