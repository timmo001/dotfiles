import {
  HerdrSdk,
  herdrSdkLayerFromOptions,
  type Agent,
  type Workspace,
} from "@timmo001/effect-herdr";
import { Clock, Duration, Effect, FileSystem, Option, Schema } from "effect";
import { Prompt } from "effect/cli";
import { hostname } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { formatRelativeTimeAgo } from "../git/services/relativeTime.js";
import { isAgent } from "../lib/agent.js";
import { ENV, envString } from "../lib/env.js";
import {
  gitHead,
  gitOutput,
  gitRemoteOrigin,
  gitWorkingTreeClean,
} from "../lib/git.js";
import { resolvedOmarchyHost } from "../lib/omarchyHost.js";
import { CACHE_DIR, HOME_DIR, displayPath } from "../lib/paths.js";
import {
  attachmentFor,
  attachmentTarget,
  claim,
  download,
  finish,
  listPending,
  localDirectory,
  readSessionQueueConfig,
  release,
  SESSION_QUEUE_CONFIG_PATH,
  SessionQueueError,
  sessionTree,
  upload,
  type Attachment,
  type QueueMeta,
} from "../lib/sessionQueue.js";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { normalizeGitHubSlug } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";
import { DEFAULT_SOCKET_PATH, openHerdrRepo } from "./HerdrRepoOpen.js";
import { loadTracked } from "./Repos.js";
import { getOpenCode, SESSION_ID_PATTERN } from "./SessionStatus.js";

const OPENCODE = join(HOME_DIR, ".local", "bin", "opencode2");

const TAKEN_DIR = join(CACHE_DIR, "dot", "session-queue");

const SessionInfo = Schema.Struct({
  id: Schema.String,
  title: Schema.optionalKey(Schema.String),
  parentID: Schema.optionalKey(Schema.NullOr(Schema.String)),
  location: Schema.Struct({ directory: Schema.String }),
});

const ChildPage = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
  cursor: Schema.Struct({
    next: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});

const fail = (message: string) => new SessionQueueError({ message });

const interactive = () =>
  !isAgent() && process.stdin.isTTY === true && process.stdout.isTTY === true;

const herdrLayer = () =>
  herdrSdkLayerFromOptions({
    socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
    requestTimeout: Duration.seconds(5),
  });

interface HerdrSnapshot {
  readonly workspaces: readonly Workspace[];
  readonly agents: readonly Agent[];
}

const emptySnapshot = { workspaces: [], agents: [] } satisfies HerdrSnapshot;

const herdrSnapshot = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;

  return yield* Effect.all(
    { workspaces: herdr.workspaces.list(), agents: herdr.agents.list() },
    { concurrency: 2 },
  );
}).pipe(
  Effect.provide(herdrLayer()),
  Effect.catchCause(() => Effect.succeed(emptySnapshot)),
  Effect.withSpan("sessionQueue.herdrSnapshot"),
);

const openCodeSession = (agent: Agent) =>
  Option.getOrUndefined(
    Option.filter(
      agent.agentSession,
      (session) => session.agent === "opencode" && session.kind === "id",
    ),
  )?.value;

const requireQueue = Effect.gen(function* () {
  const queue = yield* readSessionQueueConfig;

  if (!queue)
    return yield* fail(
      `No session queue: ${displayPath(SESSION_QUEUE_CONFIG_PATH)} is missing`,
    );

  return queue;
});

const thisHost = Effect.gen(function* () {
  const config = yield* Config;
  const host = (yield* resolvedOmarchyHost(config)) ?? hostname();

  return host.replace(/[^A-Za-z0-9._-]/g, "-");
});

const opencodeVersion = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return (yield* executor.run(OPENCODE, ["--version"]))
    .trim()
    .replace(/^opencode\s+/, "");
});

const childSessions = Effect.fn("sessionQueue.childSessions")(function* (
  parentID: string,
) {
  const ids: string[] = [];
  let cursor: string | undefined;

  do {
    const query = new URLSearchParams({ parentID, limit: "200" });

    if (cursor) query.set("cursor", cursor);

    const page = yield* getOpenCode(
      `/api/session?${query.toString()}`,
      ChildPage,
    );

    ids.push(...page.data.map((session) => session.id));
    cursor = page.cursor.next ?? undefined;
  } while (cursor);

  return ids;
});

/**
 * Without an ID, an agent sends the session in its own Herdr pane; a person
 * picks an OpenCode pane, current workspace first.
 */
const pickSession = Effect.fn("sessionQueue.pickSession")(function* (
  snapshot: HerdrSnapshot,
) {
  const ownPane = envString(ENV.HERDR_PANE_ID);
  const ownWorkspace = envString(ENV.HERDR_WORKSPACE_ID);

  if (isAgent()) {
    const own = snapshot.agents.find((agent) => agent.paneId === ownPane);
    const sessionId = own ? openCodeSession(own) : undefined;

    if (!sessionId)
      return yield* fail(
        "Herdr doesn't report an OpenCode session for this pane; pass the session ID",
      );

    return sessionId;
  }

  const candidates = snapshot.agents
    .filter((agent) => openCodeSession(agent) && agent.paneId !== ownPane)
    .sort(
      (a, b) =>
        Number(b.workspaceId === ownWorkspace) -
        Number(a.workspaceId === ownWorkspace),
    );

  if (candidates.length === 0 || !interactive())
    return yield* fail(
      "No OpenCode session to choose from; pass a session ID instead",
    );

  return yield* Prompt.run(
    Prompt.Select({
      message: "Send which session",
      choices: candidates.map((agent) => ({
        title: [
          snapshot.workspaces.find(
            (workspace) => workspace.id === agent.workspaceId,
          )?.label ?? agent.workspaceId,
          Option.getOrUndefined(agent.terminalTitleStripped) ??
            Option.getOrUndefined(agent.title) ??
            agent.paneId,
          agent.status,
        ].join(" · "),
        value: openCodeSession(agent) ?? "",
      })),
    }),
  ).pipe(Effect.catchTag("QuitError", () => Effect.fail(fail("Cancelled"))));
});

/** Where the session's checkout is and whether it has uncommitted work. */
const repositoryState = Effect.fn("sessionQueue.repositoryState")(function* (
  directory: string,
) {
  const root = yield* gitOutput(["rev-parse", "--show-toplevel"], {
    cwd: directory,
  }).pipe(
    Effect.map((path) => path.trim()),
    Effect.option,
  );

  if (Option.isNone(root)) return null;

  const head = yield* gitHead(root.value).pipe(Effect.option);

  if (Option.isNone(head)) return null;

  const branch = yield* gitOutput(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    {
      cwd: root.value,
    },
  ).pipe(
    Effect.map((name) => name.trim() || null),
    Effect.orElseSucceed(() => null),
  );

  const pushed = yield* gitOutput(["branch", "-r", "--contains", "HEAD"], {
    cwd: root.value,
  }).pipe(
    Effect.map((output) => output.trim().length > 0),
    Effect.orElseSucceed(() => false),
  );

  return {
    root: root.value,
    clean: yield* gitWorkingTreeClean(root.value),
    repository: {
      github: normalizeGitHubSlug(yield* gitRemoteOrigin(root.value)),
      name: basename(root.value),
      subdirectory: relative(root.value, directory),
      branch,
      head: head.value,
      pushed,
    },
  };
});

/**
 * Write uncommitted changes, untracked files included, as a binary patch
 * against HEAD. A throwaway index keeps the real one untouched.
 */
const writePatch = Effect.fn("sessionQueue.writePatch")(function* (
  root: string,
  scratch: string,
  to: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const options = {
    cwd: root,
    env: { GIT_INDEX_FILE: join(scratch, "index") },
  };

  yield* gitOutput(["read-tree", "HEAD"], options);
  yield* gitOutput(["add", "-A"], options);

  const files = (yield* gitOutput(
    ["diff", "--cached", "--name-only", "HEAD"],
    options,
  ))
    .split("\n")
    .filter(Boolean).length;

  if (files === 0) return null;

  yield* fs.writeFileString(
    to,
    yield* gitOutput(["diff", "--cached", "--binary", "HEAD"], options),
  );

  return { files };
});

const short = (head: string) => head.slice(0, 7);

/** What a command did, printed with `--json` under `result`. */
type ReportValue = QueueMeta | TakeOutcome;

const report = Effect.fn("sessionQueue.report")(function* (
  json: boolean,
  result: ReportValue,
  lines: readonly { readonly level: "info" | "warn"; readonly text: string }[],
) {
  const log = yield* OutputLog;

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ result, notes: lines.map((line) => line.text) })}\n`,
    );

    return;
  }

  for (const line of lines) yield* log[line.level](line.text);
});

const errorText = (error: { readonly message: string }) =>
  error instanceof CommandError
    ? error.stderr.trim() || `${error.command} failed (exit ${error.exitCode})`
    : error.message;

const handled = <A, R>(
  effect: Effect.Effect<A, { readonly message: string }, R>,
) =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(`${errorText(error)}\n`);
        process.exitCode = 1;
      }),
    ),
    Effect.asVoid,
  );

/** Export a session and its subagent sessions to the queue on the HA box. */
export const sessionSend = (options: {
  readonly sessionId?: string;
  readonly attach: readonly string[];
  readonly json: boolean;
}) =>
  handled(
    Effect.gen(function* () {
      const queue = yield* requireQueue;
      const executor = yield* CommandExecutor;
      const fs = yield* FileSystem.FileSystem;
      const snapshot = yield* herdrSnapshot;
      const sessionId = options.sessionId ?? (yield* pickSession(snapshot));

      if (!SESSION_ID_PATTERN.test(sessionId))
        return yield* fail(`Invalid OpenCode session ID ${sessionId}`);

      const { data: session } = yield* getOpenCode(
        `/api/session/${sessionId}`,
        Schema.Struct({ data: SessionInfo }),
      );

      if (session.parentID)
        return yield* fail(
          `${sessionId} is a subagent session; send its parent ${session.parentID} instead`,
        );

      const sessions = yield* sessionTree(sessionId, childSessions);

      const attachPaths = [
        ...new Set(options.attach.map((path) => resolve(path))),
      ];

      for (const path of attachPaths)
        if (!(yield* fs.exists(path)))
          return yield* fail(
            `Can't attach ${displayPath(path)}: it doesn't exist`,
          );

      const host = yield* thisHost;
      const now = yield* Clock.currentTimeMillis;
      const sentAt = new Date(now).toISOString();
      const id = `${sentAt.replace(/[-:]/g, "").slice(0, 15)}-${host}-${sessionId}`;

      const pane = snapshot.agents.find(
        (agent) => openCodeSession(agent) === sessionId,
      );

      const workspace = snapshot.workspaces.find(
        (candidate) => candidate.id === pane?.workspaceId,
      );

      const directory = session.location.directory;
      const state = yield* repositoryState(directory);

      const scratch = yield* fs.makeTempDirectoryScoped({
        prefix: "dot-session-send-",
      });

      const entry = join(scratch, id);

      yield* fs.makeDirectory(join(entry, "sessions"), { recursive: true });

      for (const child of sessions)
        yield* fs.writeFileString(
          join(entry, "sessions", `${child}.json`),
          yield* executor.run(OPENCODE, ["session", "export", child]),
        );

      const patch =
        state && !state.clean
          ? yield* writePatch(state.root, scratch, join(entry, "changes.patch"))
          : null;

      const attachments: Attachment[] = [];

      if (attachPaths.length > 0)
        yield* fs.makeDirectory(join(entry, "attachments"));

      for (const [index, path] of attachPaths.entries()) {
        yield* fs.copy(path, join(entry, "attachments", String(index)));
        attachments.push(attachmentFor(path, directory, HOME_DIR));
      }

      const meta = {
        version: 1,
        id,
        sessionId,
        sessions,
        title: session.title ?? null,
        host,
        sentAt,
        opencodeVersion: yield* opencodeVersion,
        directory,
        busy: pane?.status === "working",
        repository: state?.repository ?? null,
        herdr: workspace ? { workspace: workspace.label } : null,
        patch,
        attachments,
      } satisfies QueueMeta;

      yield* fs.writeFileString(join(entry, "meta.json"), JSON.stringify(meta));
      yield* upload(queue, scratch, id);

      yield* report(options.json, meta, [
        {
          level: "info",
          text: `Queued ${meta.title ?? sessionId} as ${id}${sessions.length > 1 ? ` with ${sessions.length - 1} subagent sessions` : ""}`,
        },
        ...(patch
          ? [
              {
                level: "info" as const,
                text: `Included uncommitted changes to ${patch.files} files as a patch`,
              },
            ]
          : []),
        ...(attachments.length > 0
          ? [
              {
                level: "info" as const,
                text: `Attached ${attachPaths.map(displayPath).join(", ")}`,
              },
            ]
          : []),
        ...(state && !state.repository.pushed
          ? [
              {
                level: "warn" as const,
                text: `HEAD ${short(state.repository.head)} isn't on any remote branch, so the other machine may not have it; push first`,
              },
            ]
          : []),
        ...(meta.busy
          ? [
              {
                level: "warn" as const,
                text: "The session was mid-turn, so that turn is cut off in the export",
              },
            ]
          : []),
        {
          level: "info",
          text: "The original session is unchanged; delete it once it's picked up elsewhere",
        },
      ]);
    }).pipe(Effect.scoped),
  );

/** List the sessions waiting in the queue. */
export const sessionQueueList = (options: { readonly json: boolean }) =>
  handled(
    Effect.gen(function* () {
      const queue = yield* requireQueue;
      const host = yield* thisHost;
      const now = yield* Clock.currentTimeMillis;
      const { entries, skipped } = yield* listPending(queue);

      if (options.json || isAgent()) {
        process.stdout.write(`${JSON.stringify({ entries, skipped })}\n`);

        return;
      }

      if (entries.length === 0) process.stdout.write("Nothing queued\n");

      for (const entry of entries)
        process.stdout.write(
          [
            `${entry.title ?? entry.sessionId}`,
            `  ${entry.id}`,
            `  from ${entry.host}${entry.host === host ? " (this machine)" : ""}, ${formatRelativeTimeAgo(entry.sentAt, now)}`,
            `  ${entry.repository ? `${entry.repository.github ?? entry.repository.name} on ${entry.repository.branch ?? short(entry.repository.head)}` : entry.directory}${entry.patch ? `, ${entry.patch.files} changed files` : ""}${entry.attachments?.length ? `, ${entry.attachments.length} attachments` : ""}`,
            "",
          ].join("\n"),
        );

      if (skipped.length > 0)
        process.stderr.write(
          `Skipped ${skipped.length} entries with unreadable metadata\n`,
        );
    }),
  );

type Changes =
  | { readonly kind: "none" }
  | { readonly kind: "applied"; readonly files: number }
  | { readonly kind: "left"; readonly path: string; readonly reason: string };

/** Attachments put back on this machine, or left in the taken entry. */
interface Attachments {
  readonly restored: readonly string[];
  readonly left: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
}

/**
 * Copy each attachment to its place here, never over an existing file; any
 * that can't go back stay in the taken entry.
 */
const restoreAttachments = Effect.fn("sessionQueue.restoreAttachments")(
  function* (meta: QueueMeta, directory: string, entry: string) {
    const fs = yield* FileSystem.FileSystem;
    const restored: string[] = [];
    const left: { path: string; reason: string }[] = [];

    for (const [index, attachment] of (meta.attachments ?? []).entries()) {
      const from = join(entry, "attachments", String(index));
      const target = attachmentTarget(attachment, directory, HOME_DIR);

      if (!target) {
        left.push({
          path: from,
          reason: `${attachment.path} isn't a safe path`,
        });
        continue;
      }

      if (yield* fs.exists(target)) {
        left.push({
          path: from,
          reason: `${displayPath(target)} already exists`,
        });
        continue;
      }

      yield* fs.makeDirectory(dirname(target), { recursive: true }).pipe(
        Effect.andThen(fs.copy(from, target)),
        Effect.andThen(Effect.sync(() => restored.push(target))),
        Effect.catch((error) =>
          Effect.sync(() =>
            left.push({
              path: from,
              reason: `couldn't copy to ${displayPath(target)}: ${error.message}`,
            }),
          ),
        ),
      );
    }

    return { restored, left } satisfies Attachments;
  },
);

/** What `take` did, printed with `--json`. */
interface TakeOutcome {
  readonly entry: QueueMeta;
  readonly directory: string;
  readonly changes: Changes;
  readonly attachments: Attachments;
  /** Whether the draft was pasted, or `null` when Herdr couldn't open it. */
  readonly opened: boolean | null;
}

/** Apply the sent patch only onto the same commit in a clean checkout, after asking. */
const applyChanges = Effect.fn("sessionQueue.applyChanges")(function* (
  meta: QueueMeta,
  directory: string,
  patchPath: string,
) {
  if (!meta.patch || !meta.repository)
    return { kind: "none" } satisfies Changes;

  const left = (reason: string): Changes => ({
    kind: "left",
    path: patchPath,
    reason,
  });

  const root = yield* gitOutput(["rev-parse", "--show-toplevel"], {
    cwd: directory,
  }).pipe(
    Effect.map((path) => path.trim()),
    Effect.option,
  );

  if (Option.isNone(root)) return left("this directory isn't a Git checkout");

  const head = yield* gitHead(root.value);

  if (head !== meta.repository.head)
    return left(
      `this checkout is at ${short(head)}, not ${short(meta.repository.head)}`,
    );

  if (!(yield* gitWorkingTreeClean(root.value)))
    return left("this checkout already has uncommitted changes");

  if (!interactive()) return left("it wasn't confirmed");

  const apply = yield* Prompt.run(
    Prompt.Confirm({
      message: `Apply the uncommitted changes to ${meta.patch.files} files from ${meta.host}?`,
      initial: true,
    }),
  ).pipe(Effect.orElseSucceed(() => false));

  if (!apply) return left("you chose not to apply it");

  return yield* gitOutput(["apply", "--binary", patchPath], {
    cwd: root.value,
  }).pipe(
    Effect.as<Changes>({ kind: "applied", files: meta.patch.files }),
    Effect.catch((error) =>
      Effect.succeed(left(`git apply failed: ${error.message}`)),
    ),
  );
});

/** The text pasted into OpenCode so the agent knows it has moved. */
export function takePrompt(
  meta: QueueMeta,
  here: {
    readonly host: string;
    readonly directory: string;
    readonly branch: string | null;
    readonly changes: Changes;
    readonly attachments: Attachments;
    readonly now: number;
  },
): string {
  const sent = meta.repository
    ? `It was on ${meta.repository.branch ?? "a detached HEAD"} at ${short(meta.repository.head)} when it was sent.`
    : `It was in ${meta.directory} when it was sent.`;

  const changes = {
    none: () => "There were no uncommitted changes.",
    applied: () => "Its uncommitted changes have been applied here.",
    left: () =>
      here.changes.kind === "left"
        ? `Its uncommitted changes were not applied (${here.changes.reason}); the patch is at ${here.changes.path}.`
        : "",
  }[here.changes.kind]();

  return [
    `This session was sent from ${meta.host} ${formatRelativeTimeAgo(meta.sentAt, here.now)} and is now on ${here.host}, in ${displayPath(here.directory)}${here.branch ? ` on branch ${here.branch}` : ""}. ${sent} ${changes}`,
    ...(meta.busy ? ["The last turn was cut off when it was sent."] : []),
    ...(here.attachments.restored.length > 0
      ? [
          `Files attached when it was sent are back at: ${here.attachments.restored.map(displayPath).join(", ")}.`,
        ]
      : []),
    ...(here.attachments.left.length > 0
      ? [
          `Some attached files weren't put back: ${here.attachments.left.map((item) => `${displayPath(item.path)} (${item.reason})`).join("; ")}.`,
        ]
      : []),
    `Before carrying on, check git status${meta.repository ? `, that HEAD matches ${short(meta.repository.head)}` : ""}, and re-read any files you changed earlier.`,
  ].join("\n\n");
}

/** Claim, download and import an entry, then open it in Herdr with a draft prompt. */
export const sessionTake = (options: {
  readonly entryId?: string;
  readonly json: boolean;
}) =>
  handled(
    Effect.gen(function* () {
      if (isAgent() && options.entryId === undefined)
        return yield* fail(
          "Ask the user to run dot session take on the machine that should pick the session up",
        );

      const queue = yield* requireQueue;
      const executor = yield* CommandExecutor;
      const fs = yield* FileSystem.FileSystem;
      const host = yield* thisHost;
      const { entries } = yield* listPending(queue);
      const now = yield* Clock.currentTimeMillis;

      if (entries.length === 0) return yield* fail("Nothing queued");

      const meta =
        options.entryId === undefined
          ? interactive()
            ? yield* Prompt.run(
                Prompt.Select({
                  message: "Take which session",
                  choices: entries.map((entry) => ({
                    title: `${entry.title ?? entry.sessionId} · ${entry.host} · ${entry.repository?.name ?? basename(entry.directory)} · ${formatRelativeTimeAgo(entry.sentAt, now)}`,
                    value: entry,
                  })),
                }),
              ).pipe(
                Effect.catchTag("QuitError", () =>
                  Effect.fail(fail("Cancelled")),
                ),
              )
            : yield* fail("Pass an entry ID from dot session queue")
          : entries.find((entry) => entry.id === options.entryId);

      if (!meta) return yield* fail(`No pending entry ${options.entryId}`);

      if (meta.sessions.some((id) => !SESSION_ID_PATTERN.test(id)))
        return yield* fail(`${meta.id} has invalid session IDs`);

      if (meta.host === host && interactive()) {
        const anyway = yield* Prompt.run(
          Prompt.Confirm({
            message: "This was sent from this machine. Take it anyway?",
          }),
        ).pipe(Effect.orElseSucceed(() => false));

        if (!anyway) return;
      }

      const version = yield* opencodeVersion;
      const tracked = yield* loadTracked.pipe(Effect.orElseSucceed(() => []));
      const local = localDirectory(meta, tracked);

      if (!(yield* fs.exists(local.directory)))
        return yield* fail(
          `${displayPath(local.directory)} doesn't exist here${meta.repository?.github ? `; clone ${meta.repository.github} and track it with dot repo induct` : ""}`,
        );

      yield* claim(queue, meta.id, host);

      const { changes, attachments } = yield* Effect.gen(function* () {
        const entry = join(TAKEN_DIR, meta.id);

        yield* fs.makeDirectory(TAKEN_DIR, { recursive: true });
        yield* fs.remove(entry, { recursive: true, force: true });
        yield* download(queue, meta.id, host, TAKEN_DIR);

        for (const id of meta.sessions)
          yield* executor.run(OPENCODE, [
            "session",
            "import",
            join(entry, "sessions", `${id}.json`),
            "--directory",
            local.directory,
          ]);

        const changes = yield* applyChanges(
          meta,
          local.directory,
          join(entry, "changes.patch"),
        );

        const attachments = yield* restoreAttachments(
          meta,
          local.directory,
          entry,
        );

        yield* finish(queue, meta.id, host);

        return { changes, attachments };
      }).pipe(
        Effect.tapError(() =>
          release(queue, meta.id, host).pipe(Effect.ignore),
        ),
      );

      const branch = yield* gitOutput(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        { cwd: local.directory },
      ).pipe(
        Effect.map((name) => name.trim() || null),
        Effect.orElseSucceed(() => null),
      );

      const draft = takePrompt(meta, {
        host,
        directory: local.directory,
        branch,
        changes,
        attachments,
        now,
      });

      const opened = yield* openHerdrRepo({
        label: local.name ?? meta.herdr?.workspace ?? basename(local.directory),
        directory: local.directory,
        agent: "opencode2",
        sessionId: meta.sessionId,
        draft,
      }).pipe(
        Effect.provide(herdrLayer()),
        Effect.map((result) => result.draftPasted),
        Effect.catchCause(() => Effect.succeed(null)),
      );

      if (opened !== true) yield* executor.exitCode("wl-copy", ["--", draft]);

      yield* report(
        options.json,
        {
          entry: meta,
          directory: local.directory,
          changes,
          attachments,
          opened,
        },
        [
          {
            level: "info",
            text: `Imported ${meta.title ?? meta.sessionId} into ${displayPath(local.directory)}`,
          },
          ...attachments.restored.map((path) => ({
            level: "info" as const,
            text: `Restored ${displayPath(path)}`,
          })),
          ...attachments.left.map((item) => ({
            level: "warn" as const,
            text: `Attachment not restored (${item.reason}): ${displayPath(item.path)}`,
          })),
          ...(meta.opencodeVersion !== version
            ? [
                {
                  level: "warn" as const,
                  text: `Sent from OpenCode ${meta.opencodeVersion}, this is ${version}; the export format is experimental`,
                },
              ]
            : []),
          ...(changes.kind === "left"
            ? [
                {
                  level: "warn" as const,
                  text: `Changes not applied (${changes.reason}): ${displayPath(changes.path)}`,
                },
              ]
            : []),
          ...(opened === null
            ? [
                {
                  level: "warn" as const,
                  text: `Couldn't open it in Herdr; run ${OPENCODE} --session ${meta.sessionId} in ${displayPath(local.directory)}. The draft prompt is on the clipboard`,
                },
              ]
            : opened
              ? []
              : [
                  {
                    level: "warn" as const,
                    text: "Couldn't paste the draft prompt; it's on the clipboard",
                  },
                ]),
        ],
      );
    }),
  );
