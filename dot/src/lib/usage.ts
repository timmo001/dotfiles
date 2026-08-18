import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { ENV, envFlag, envString } from "./env.js";
import { STATE_DIR, expandHomePath } from "./paths.js";
import { Schema } from "effect";

/**
 * How a usage event was captured: `live` from a real invocation, or `history`
 * from a shell-history backfill.
 */
export type UsageSource = "live" | "history";

/** Coarse classification of who ran the command. */
export type UsageInvoker = "human" | "agent" | "automation";

/**
 * A single tool-usage event. This is the on-disk NDJSON record shape, kept
 * deliberately free of raw positional argument values (paths, ids, note text)
 * so it captures feature-level usage without collecting sensitive input.
 */
export interface UsageEvent {
  /** ISO-8601 timestamp of the invocation. */
  readonly ts: string;
  /** Machine identifier, used to partition per-machine event files. */
  readonly machine: string;
  /** Canonical tool name (e.g. `dot`, `context`, `notes`). */
  readonly tool: string;
  /** The binary name the tool was invoked as (e.g. `note`, `handoff`). */
  readonly invokedAs: string;
  /** Safe subcommand/feature path, without positional values. */
  readonly command: readonly string[];
  /** Sorted, deduped flag names (leading dashes preserved), never their values. */
  readonly flags: readonly string[];
  /** Process exit code, or null when unknown (e.g. history backfill). */
  readonly exitCode: number | null;
  /** Wall-clock duration in milliseconds, or null when unknown. */
  readonly durationMs: number | null;
  /** How the event was captured. */
  readonly source: UsageSource;
  /** Coarse caller classification. */
  readonly invoker: UsageInvoker;
}

const UsageEventSchema = Schema.Struct({
  ts: Schema.String,
  machine: Schema.optional(Schema.String),
  tool: Schema.String,
  invokedAs: Schema.optional(Schema.String),
  command: Schema.optional(Schema.Array(Schema.String)),
  flags: Schema.optional(Schema.Array(Schema.String)),
  exitCode: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
  source: Schema.optional(
    Schema.Union([Schema.Literal("live"), Schema.Literal("history")]),
  ),
  invoker: Schema.optional(
    Schema.Union([
      Schema.Literal("human"),
      Schema.Literal("agent"),
      Schema.Literal("automation"),
    ]),
  ),
});

/** Whether dot usage recording is disabled via `DOT_USAGE_DISABLE`. */
export function usageDisabled(): boolean {
  return envFlag(ENV.DOT_USAGE_DISABLE);
}

/**
 * Root directory for usage data. Defaults to `$XDG_STATE_HOME/tool-usage`
 * (falling back to `~/.local/state/tool-usage`), overridable with
 * `DOT_USAGE_DIR`.
 */
export function usageRoot(): string {
  const override = envString(ENV.DOT_USAGE_DIR);
  return override ? expandHomePath(override) : join(STATE_DIR, "tool-usage");
}

/** Replace filesystem-unsafe characters in a machine identifier. */
function sanitizeMachine(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "unknown";
}

/**
 * Stable identifier for the current machine, used to partition event files so
 * two machines never write the same file when their event directories are
 * synced. Prefers `OMARCHY_HOST`, then the system hostname.
 */
export function machineId(): string {
  return sanitizeMachine(envString(ENV.OMARCHY_HOST) ?? hostname());
}

/**
 * Extract sorted, deduped flag names from raw args. Values are never captured:
 * `--flag=value` becomes `--flag`, and a following value token is ignored.
 */
export function extractFlagNames(
  args: readonly string[],
  allowedFlags?: ReadonlySet<string>,
): readonly string[] {
  const names = new Set<string>();
  for (const arg of args) {
    if (!arg.startsWith("-") || arg === "-" || arg === "--") continue;
    const name = arg.split("=", 1)[0];
    if (name.length > 1 && (!allowedFlags || allowedFlags.has(name))) {
      names.add(name);
    }
  }
  return [...names].sort();
}

/** Path of the NDJSON file that holds events for a machine on a given date. */
function eventFilePath(root: string, machine: string, ts: string): string {
  const day = ts.slice(0, 10);
  return join(root, "events", machine, `${day}.ndjson`);
}

/**
 * Append a single usage event to its per-machine, per-day NDJSON file. Never
 * throws: recording failures must not break the invoking tool.
 */
export function appendUsageEvent(event: UsageEvent, root = usageRoot()): void {
  try {
    const file = eventFilePath(root, event.machine, event.ts);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(event)}\n`);
  } catch {
    // Usage recording is best-effort; swallow all errors.
  }
}

/** Parse one NDJSON line into a UsageEvent, or null when it is not valid. */
export function parseUsageEvent(line: string): UsageEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const value = Schema.decodeUnknownSync(UsageEventSchema)(
      JSON.parse(trimmed),
    );
    return {
      ts: value.ts,
      machine: value.machine ?? "unknown",
      tool: value.tool,
      invokedAs: value.invokedAs ?? value.tool,
      command: value.command ?? [],
      flags: value.flags ?? [],
      exitCode: value.exitCode ?? null,
      durationMs: value.durationMs ?? null,
      source: value.source === "history" ? "history" : "live",
      invoker: value.invoker ?? "human",
    };
  } catch {
    return null;
  }
}

/** Read every event under the `events/` tree of a single root directory. */
function readEventsFromRoot(root: string): readonly UsageEvent[] {
  const eventsDir = join(root, "events");
  if (!existsSync(eventsDir)) return [];
  const events: UsageEvent[] = [];
  let machineDirs: readonly string[] = [];
  try {
    machineDirs = readdirSync(eventsDir);
  } catch {
    return [];
  }
  for (const machine of machineDirs) {
    const dir = join(eventsDir, machine);
    let files: readonly string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".ndjson")) continue;
      try {
        const contents = readFileSync(join(dir, file), "utf8");
        for (const line of contents.split("\n")) {
          const event = parseUsageEvent(line);
          if (event) events.push(event);
        }
      } catch {
        // Skip unreadable files.
      }
    }
  }
  return events;
}

/**
 * Read every usage event across one or more root directories. Extra roots let
 * a summary combine a local root with directories synced from other machines.
 */
export function readAllEvents(
  roots: readonly string[] = [usageRoot()],
): readonly UsageEvent[] {
  const seen = new Set<string>();
  const events: UsageEvent[] = [];
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    for (const event of readEventsFromRoot(root)) {
      events.push(event);
    }
  }
  return events;
}

/** A stable dedup key for an event, used to avoid re-importing backfills. */
export function usageEventKey(event: UsageEvent): string {
  return [
    event.source,
    event.machine,
    event.ts,
    event.tool,
    event.command.join(" "),
    event.flags.join(","),
  ].join("|");
}

/** Comparable command identity used to suppress history/live overlap. */
export function usageCommandKey(event: UsageEvent): string {
  return [
    event.machine,
    event.tool,
    event.command.join(" "),
    event.flags.join(","),
  ].join("|");
}

/**
 * Install a best-effort usage recorder that writes one `live` event when the
 * process exits, capturing the real exit code and wall-clock duration. A no-op
 * when `DOT_USAGE_DISABLE=1`.
 */
export function installUsageHook(opts: {
  readonly tool: string;
  readonly invokedAs: string;
  readonly command: readonly string[];
  readonly args: readonly string[];
  readonly allowedFlags?: ReadonlySet<string>;
  readonly invoker: UsageInvoker;
}): void {
  if (usageDisabled()) return;
  const start = Date.now();
  const machine = machineId();
  const flags = extractFlagNames(opts.args, opts.allowedFlags);
  let recorded = false;
  process.on("exit", (code) => {
    if (recorded) return;
    recorded = true;
    appendUsageEvent({
      ts: new Date().toISOString(),
      machine,
      tool: opts.tool,
      invokedAs: opts.invokedAs,
      command: opts.command,
      flags,
      exitCode: code ?? 0,
      durationMs: Date.now() - start,
      source: "live",
      invoker: opts.invoker,
    });
  });
}
