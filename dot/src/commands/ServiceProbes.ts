/**
 * @file The first `services.d` checks: commands that print a check status for
 * `dot services` to cache and show, such as `check: { run: [dot, services,
 * probe, syncthing] }`. Each prints its status on stdout and exits 0, even
 * when what it checks is unhealthy; exiting non-zero means the probe itself
 * couldn't run.
 */
import {
  Clock,
  Console,
  Duration,
  Effect,
  Option,
  Result,
  Schema,
} from "effect";
import { connect } from "node:tls";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { expandHomePath } from "../lib/paths.js";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import type { CheckOutput } from "./Services.js";

/** A probe couldn't read what it checks. */
export class ProbeError extends Schema.TaggedError<ProbeError>()("ProbeError", {
  message: Schema.String,
}) {}

const printStatus = (status: CheckOutput) =>
  Console.log(JSON.stringify(status));

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** A short local time, such as `21 Nov 02:27`. */
const shortTime = (time: number) =>
  new Date(time).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const ago = (millis: number) => {
  const hours = Math.round(millis / 3_600_000);

  return hours < 1
    ? "under an hour ago"
    : hours < 48
      ? `${plural(hours, "hour")} ago`
      : `${plural(Math.round(hours / 24), "day")} ago`;
};

const SyncthingFolder = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  paused: Schema.Boolean,
});

const SyncthingFolderStatus = Schema.Struct({
  state: Schema.String,
  error: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Finite),
  pullErrors: Schema.optional(Schema.Finite),
  needBytes: Schema.Finite,
  needTotalItems: Schema.Finite,
  globalBytes: Schema.Finite,
  inSyncBytes: Schema.Finite,
});

const SyncthingErrors = Schema.Struct({
  errors: Schema.NullOr(
    Schema.Array(Schema.Struct({ message: Schema.String })),
  ),
});

/**
 * Print Syncthing's folders and errors as a check status: how many items and
 * bytes are out of sync, each folder's state, and Syncthing's own errors.
 */
export const probeSyncthing = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const http = yield* HttpClient.HttpClient;

  const gui = (property: string) =>
    executor
      .run("syncthing", ["cli", "config", "gui", property, "get"])
      .pipe(Effect.map((output) => output.trim()));

  const settings = yield* Effect.all([
    gui("raw-address"),
    gui("apikey"),
    gui("raw-use-tls"),
  ]).pipe(Effect.option);

  if (Option.isNone(settings))
    return yield* printStatus({
      health: "failed",
      summary: "Syncthing isn't answering",
    });

  const [address, apiKey, tls] = settings.value;

  const base = `${tls === "true" ? "https" : "http"}://${address.replace(/^0\.0\.0\.0(?=:)/, "127.0.0.1")}`;

  const get = <S extends Schema.Top>(path: string, schema: S) =>
    http.get(`${base}${path}`, { headers: { "X-API-Key": apiKey } }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError(
        (error) => new ProbeError({ message: `${path}: ${String(error)}` }),
      ),
    );

  const read = yield* Effect.gen(function* () {
    const folders = yield* get(
      "/rest/config/folders",
      Schema.Array(SyncthingFolder),
    );

    const statuses = yield* Effect.forEach(
      folders.filter((folder) => !folder.paused),
      (folder) =>
        get(
          `/rest/db/status?folder=${encodeURIComponent(folder.id)}`,
          SyncthingFolderStatus,
        ).pipe(Effect.map((status) => ({ folder, status }))),
      { concurrency: 4 },
    );

    const { errors } = yield* get("/rest/system/error", SyncthingErrors);

    return { folders, statuses, errors: errors ?? [] };
  }).pipe(Effect.result);

  if (Result.isFailure(read))
    return yield* printStatus({
      health: "failed",
      summary: `Syncthing isn't answering: ${read.failure.message}`,
    });

  const { folders, statuses, errors } = read.success;

  const broken = statuses.filter(
    ({ status }) =>
      status.state === "error" ||
      (status.pullErrors ?? 0) > 0 ||
      (status.errors ?? 0) > 0,
  );

  const outOfSyncItems = statuses.reduce(
    (total, { status }) => total + status.needTotalItems,
    0,
  );

  const outOfSyncBytes = statuses.reduce(
    (total, { status }) => total + status.needBytes,
    0,
  );

  const syncing = statuses.filter(({ status }) => status.needTotalItems > 0);

  const folderState = ({
    folder,
    status,
  }: (typeof statuses)[number]): string =>
    status.state === "error"
      ? `error: ${status.error || "unknown"}`
      : status.needTotalItems > 0 && status.globalBytes > 0
        ? `${status.state} ${Math.floor((status.inSyncBytes / status.globalBytes) * 100)}%`
        : folder.paused
          ? "paused"
          : status.state;

  yield* printStatus({
    health:
      broken.length > 0 ? "degraded" : errors.length > 0 ? "warning" : "ok",
    summary:
      broken.length > 0
        ? `${broken.map(({ folder }) => folder.label || folder.id).join(", ")} ${broken.length === 1 ? "has" : "have"} errors`
        : syncing.length > 0
          ? `Syncing ${plural(syncing.length, "folder")}`
          : errors.length > 0
            ? plural(errors.length, "Syncthing error")
            : `${plural(statuses.length, "folder")} up to date`,
    stats: [
      { id: "folders", label: "Folders", value: folders.length, kind: "count" },
      {
        id: "out_of_sync_items",
        label: "Items out of sync",
        value: outOfSyncItems,
        kind: "count",
      },
      {
        id: "out_of_sync_bytes",
        label: "Out of sync",
        value: outOfSyncBytes,
        unit: "B",
        kind: "size",
      },
    ],
    lists: [
      {
        id: "folders",
        label: "Folders",
        items: [
          ...statuses.map((entry) => ({
            label: entry.folder.label || entry.folder.id,
            value: folderState(entry),
          })),
          ...folders
            .filter((folder) => folder.paused)
            .map((folder) => ({
              label: folder.label || folder.id,
              value: "paused",
            })),
        ],
      },
    ],
    ...(errors.length > 0 && {
      notes: errors.slice(-5).map(({ message }) => message),
    }),
  });
}).pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.withSpan("Probe.syncthing"),
);

/** When an HTTPS site's certificate expires, read from its TLS handshake. */
const certificateExpiry = (url: URL, timeout: Duration.Duration) =>
  Effect.callback<number, ProbeError>((resume) => {
    const socket = connect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname,
      timeout: Duration.toMillis(timeout),
    });

    const fail = (message: string) => {
      socket.destroy();
      resume(Effect.fail(new ProbeError({ message })));
    };

    socket.once("secureConnect", () => {
      const expires = Date.parse(socket.getPeerCertificate().valid_to);
      socket.end();
      resume(
        Number.isFinite(expires)
          ? Effect.succeed(expires)
          : Effect.fail(new ProbeError({ message: "No certificate expiry" })),
      );
    });
    socket.once("timeout", () => fail("TLS handshake timed out"));
    socket.once("error", (error) => fail(error.message));

    return Effect.sync(() => socket.destroy());
  });

/** What `dot services probe http` checks a URL for. */
export interface HttpProbeOptions {
  /** Status codes that count as healthy; redirects aren't followed. */
  readonly expect: ReadonlyArray<number>;
  /** A response slower than this is a warning. */
  readonly slow: Duration.Duration;
  /** A certificate expiring within this is a warning. */
  readonly certWarn: Duration.Duration;
  /** How long the request and the TLS handshake may each take. */
  readonly timeout: Duration.Duration;
}

/**
 * Print a URL's health as a check status: the status code it answers with,
 * without following redirects, how long it took and, for HTTPS, how long its
 * certificate has left. Failed when it can't be reached, answers with an
 * unexpected status or its certificate has expired; a warning when it's slow
 * or its certificate expires soon.
 */
export const probeHttp = Effect.fn("Probe.http")(function* (
  target: string,
  options: HttpProbeOptions,
) {
  const url = yield* Effect.try({
    try: () => new URL(target),
    catch: () => new ProbeError({ message: `Not a URL: ${target}` }),
  });

  const http = yield* HttpClient.HttpClient;
  const started = yield* Clock.currentTimeMillis;

  const response = yield* http.head(url).pipe(
    Effect.filterOrElse(
      (head) => head.status !== 405,
      () => http.get(url),
    ),
    Effect.timeoutOrElse({
      duration: options.timeout,
      orElse: () =>
        Effect.fail(
          new ProbeError({
            message: `no answer within ${Duration.format(options.timeout)}`,
          }),
        ),
    }),
    Effect.mapError((error) =>
      error instanceof ProbeError
        ? error
        : new ProbeError({ message: error.message }),
    ),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    Effect.result,
  );

  const finished = yield* Clock.currentTimeMillis;

  if (Result.isFailure(response))
    return yield* printStatus({
      health: "failed",
      summary: `Can't reach ${url.host}: ${response.failure.message}`,
    });

  const status = response.success.status;
  const elapsed = finished - started;

  const expiry =
    url.protocol === "https:"
      ? yield* certificateExpiry(url, options.timeout).pipe(Effect.result)
      : undefined;

  const certificateError =
    expiry !== undefined && Result.isFailure(expiry)
      ? expiry.failure.message
      : undefined;

  const msLeft =
    expiry !== undefined && Result.isSuccess(expiry)
      ? expiry.success - finished
      : undefined;

  const daysLeft =
    msLeft === undefined ? undefined : Math.floor(msLeft / 86_400_000);

  const expected = options.expect.includes(status);
  const expired = msLeft !== undefined && msLeft <= 0;

  const expiringSoon =
    msLeft !== undefined && msLeft < Duration.toMillis(options.certWarn);

  const isSlow = elapsed > Duration.toMillis(options.slow);
  const answered = `Answered ${status} in ${elapsed} ms`;

  yield* printStatus({
    health:
      !expected || expired
        ? "failed"
        : expiringSoon || isSlow || certificateError !== undefined
          ? "warning"
          : "ok",
    summary: !expected
      ? `Answered ${status}, expected ${options.expect.join(" or ")}`
      : expired
        ? "Certificate has expired"
        : expiringSoon
          ? `Certificate expires in ${plural(daysLeft ?? 0, "day")}`
          : certificateError !== undefined
            ? `${answered}, but can't read its certificate`
            : isSlow
              ? `Slow: ${answered.toLowerCase()}`
              : answered,
    stats: [
      { id: "status", label: "Status", value: status },
      {
        id: "response_time",
        label: "Response time",
        value: elapsed / 1000,
        kind: "duration",
      },
      ...(daysLeft === undefined
        ? []
        : [
            {
              id: "certificate_days",
              label: "Certificate days left",
              value: daysLeft,
              kind: "count" as const,
            },
          ]),
    ],
    ...(certificateError !== undefined && {
      notes: [`Certificate: ${certificateError}`],
    }),
  });
}, Effect.provide(FetchHttpClient.layer));

const KopiaSnapshot = Schema.Struct({
  source: Schema.Struct({
    host: Schema.String,
    userName: Schema.String,
    path: Schema.String,
  }),
  startTime: Schema.String,
  endTime: Schema.optional(Schema.String),
});

const decodeSnapshots = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(KopiaSnapshot)),
);

/**
 * Print a Kopia repository's state as a check status: each source's newest
 * snapshot, and the repository's size, which for an off-site repository is
 * what it uses there. Snapshots older than `maxAge` are a warning.
 */
export const probeKopia = Effect.fn("Probe.kopia")(function* (
  config: string | undefined,
  maxAge: Duration.Duration,
) {
  const executor = yield* CommandExecutor;
  const now = yield* Clock.currentTimeMillis;

  const configArgs =
    config === undefined ? [] : [`--config-file=${expandHomePath(config)}`];

  const snapshots = yield* executor
    .run("kopia", [
      "snapshot",
      "list",
      "--all",
      "--json",
      "--max-results=1",
      ...configArgs,
    ])
    .pipe(
      Effect.flatMap(decodeSnapshots),
      Effect.mapError((error) =>
        error instanceof CommandError ? error.stderr.trim() : error.message,
      ),
      Effect.result,
    );

  if (Result.isFailure(snapshots))
    return yield* printStatus({
      health: "failed",
      summary: `Can't read the repository: ${snapshots.failure.split("\n").at(-1) ?? ""}`,
    });

  // A repository server's clients can't list blobs, so the size is optional.
  const size = yield* executor
    .run("kopia", ["blob", "stats", "--raw", ...configArgs])
    .pipe(
      Effect.map((output) => Number(/^Total: (\d+)$/m.exec(output)?.[1])),
      Effect.map((bytes) => (Number.isFinite(bytes) ? bytes : undefined)),
      Effect.orElseSucceed(() => undefined),
    );

  const sources = snapshots.success
    .map((snapshot) => ({
      label: `${snapshot.source.userName}@${snapshot.source.host}:${snapshot.source.path}`,
      time: Date.parse(snapshot.endTime ?? snapshot.startTime),
    }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => b.time - a.time);

  const newest = sources[0]?.time;

  const old = sources.filter(
    ({ time }) => now - time > Duration.toMillis(maxAge),
  );

  yield* printStatus({
    health: newest === undefined || old.length > 0 ? "warning" : "ok",
    summary:
      newest === undefined
        ? "No snapshots yet"
        : old.length > 0
          ? `${plural(old.length, "source")} older than ${Duration.format(maxAge)}`
          : `Newest snapshot ${ago(now - newest)}`,
    stats: [
      ...(newest === undefined
        ? []
        : [
            {
              id: "newest",
              label: "Newest snapshot",
              value: newest,
              kind: "timestamp" as const,
            },
          ]),
      {
        id: "sources",
        label: "Sources",
        value: sources.length,
        kind: "count" as const,
      },
      ...(size === undefined
        ? []
        : [
            {
              id: "repository_size",
              label: "Repository size",
              value: size,
              unit: "B",
              kind: "size" as const,
            },
          ]),
    ],
    lists: [
      {
        id: "sources",
        label: "Sources",
        items: sources.map(({ label, time }) => ({
          label,
          value: shortTime(time),
        })),
      },
    ],
    ...(size === undefined && {
      notes: ["Repository size needs a direct connection to the repository"],
    }),
  });
});
