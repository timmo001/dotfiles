import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCliCommand } from "../cli/spec.js";
import { ENV, envString } from "./env.js";
import { HOME_DIR } from "./paths.js";
import { extractFlagNames, machineId, type UsageEvent } from "./usage.js";

/** A whitelisted tool that shell-history backfill will import. */
interface HistoryTool {
  /** Canonical tool name recorded on the event. */
  readonly tool: string;
  /** Whether the leading token after the binary is a canonical `dot` command. */
  readonly canonicaliseDot: boolean;
}

/** Binaries whose invocations are safe to import from shell history. */
const HISTORY_TOOLS: Readonly<Record<string, HistoryTool>> = {
  dot: { tool: "dot", canonicaliseDot: true },
  context: { tool: "context", canonicaliseDot: false },
  notes: { tool: "notes", canonicaliseDot: false },
  note: { tool: "notes", canonicaliseDot: false },
  handoff: { tool: "notes", canonicaliseDot: false },
  handoffs: { tool: "notes", canonicaliseDot: false },
};

/** Per-shell backfill report line. */
export interface HistorySourceReport {
  /** Shell name. */
  readonly shell: string;
  /** History file path inspected. */
  readonly file: string;
  /** Whether the file existed and was read. */
  readonly found: boolean;
  /** Number of whitelisted events parsed (0 when undated or absent). */
  readonly imported: number;
  /** Optional note (e.g. why a shell was skipped). */
  readonly note?: string;
}

/** Result of scanning shell histories for whitelisted tool invocations. */
export interface HistoryScan {
  /** Parsed events, source `history`, with null exit code and duration. */
  readonly events: readonly UsageEvent[];
  /** Per-shell reports for user feedback. */
  readonly sources: readonly HistorySourceReport[];
}

/** Split a command line into whitespace tokens (no quote handling needed). */
function tokenise(line: string): readonly string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** Build a history event from tokens, or null when not whitelisted. */
function eventFromTokens(
  tokens: readonly string[],
  epochSeconds: number,
  machine: string,
): UsageEvent | null {
  const [binary, ...rest] = tokens;
  if (!binary) return null;
  const invokedAs = binary.split("/").pop() ?? binary;
  const tool = HISTORY_TOOLS[invokedAs];
  if (!tool) return null;
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;

  const positional = rest.find((token) => !token.startsWith("-"));
  const command =
    positional === undefined
      ? []
      : tool.canonicaliseDot
        ? [getCliCommand(positional)?.name ?? positional]
        : [positional];

  return {
    ts: new Date(epochSeconds * 1000).toISOString(),
    machine,
    tool: tool.tool,
    invokedAs,
    command,
    flags: extractFlagNames(
      rest,
      tool.canonicaliseDot && positional
        ? new Set(
            getCliCommand(positional)?.options?.flatMap((option) =>
              option.short ? [option.name, option.short] : [option.name],
            ) ?? [],
          )
        : undefined,
    ),
    exitCode: null,
    durationMs: null,
    source: "history",
    invoker: "human",
  };
}

/** Parse fish history (`- cmd:` / `when:` pairs) for whitelisted events. */
function parseFishHistory(
  contents: string,
  machine: string,
): readonly UsageEvent[] {
  const events: UsageEvent[] = [];
  let cmd: string | null = null;
  for (const line of contents.split("\n")) {
    if (line.startsWith("- cmd: ")) {
      cmd = line.slice("- cmd: ".length);
      continue;
    }
    const whenMatch = line.match(/^\s+when:\s*(\d+)/);
    if (whenMatch && cmd !== null) {
      const event = eventFromTokens(
        tokenise(cmd),
        Number.parseInt(whenMatch[1], 10),
        machine,
      );
      if (event) events.push(event);
      cmd = null;
    }
  }
  return events;
}

/** Parse zsh extended history (`: <ts>:<dur>;<cmd>`) for whitelisted events. */
function parseZshHistory(
  contents: string,
  machine: string,
): readonly UsageEvent[] {
  const events: UsageEvent[] = [];
  for (const line of contents.split("\n")) {
    const match = line.match(/^: (\d+):\d+;(.*)$/);
    if (!match) continue;
    const event = eventFromTokens(
      tokenise(match[2]),
      Number.parseInt(match[1], 10),
      machine,
    );
    if (event) events.push(event);
  }
  return events;
}

/** Location of the fish history file, honouring `XDG_DATA_HOME`. */
function fishHistoryPath(): string {
  const dataHome =
    envString(ENV.XDG_DATA_HOME) ?? join(HOME_DIR, ".local", "share");
  return join(dataHome, "fish", "fish_history");
}

/** Location of the zsh history file, honouring `HISTFILE`. */
function zshHistoryPath(): string {
  return envString(ENV.HISTFILE) ?? join(HOME_DIR, ".zsh_history");
}

/** Read a history file, returning null when it is absent or unreadable. */
function readHistory(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Scan shell histories for whitelisted tool invocations. Only fish and zsh
 * extended history carry timestamps, so those are imported; bash history is
 * reported but skipped because undated entries cannot be placed in time.
 */
export function scanShellHistory(): HistoryScan {
  const machine = machineId();
  const events: UsageEvent[] = [];
  const sources: HistorySourceReport[] = [];

  const fishPath = fishHistoryPath();
  const fishContents = readHistory(fishPath);
  if (fishContents === null) {
    sources.push({ shell: "fish", file: fishPath, found: false, imported: 0 });
  } else {
    const parsed = parseFishHistory(fishContents, machine);
    events.push(...parsed);
    sources.push({
      shell: "fish",
      file: fishPath,
      found: true,
      imported: parsed.length,
    });
  }

  const zshPath = zshHistoryPath();
  const zshContents = readHistory(zshPath);
  if (zshContents === null) {
    sources.push({ shell: "zsh", file: zshPath, found: false, imported: 0 });
  } else {
    const parsed = parseZshHistory(zshContents, machine);
    events.push(...parsed);
    sources.push({
      shell: "zsh",
      file: zshPath,
      found: true,
      imported: parsed.length,
      note:
        parsed.length === 0
          ? "no whitelisted entries (needs extended history with timestamps)"
          : undefined,
    });
  }

  const bashPath = join(HOME_DIR, ".bash_history");
  if (existsSync(bashPath)) {
    sources.push({
      shell: "bash",
      file: bashPath,
      found: true,
      imported: 0,
      note: "skipped: bash history has no timestamps",
    });
  }

  return { events, sources };
}
