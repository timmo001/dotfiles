import type { ViewId } from "./types.js";
import { menuItemsById, submenus } from "./menu.js";
import { nativeCommandNames } from "./cli/spec.js";
import { renderHelp } from "./cli/help.js";

type DiffTab = "changed" | "unchanged";

/** Parsed CLI flags for `dot` */
export interface Flags {
  /** Resolved subcommand (dot-separated path) matching a menu item ID or view ID */
  readonly subcommand: string | undefined;
  /** Initial tab for the diff view */
  readonly tab: DiffTab;
  /** Normalized ISO timestamp for workflow run filters */
  readonly since: string | undefined;
  /** Show help and exit */
  readonly help: boolean;
  /** Remaining args not consumed by subcommand or flag parsing */
  readonly rest: readonly string[];
}

function parseDiffTab(value: string): DiffTab {
  if (value === "other" || value === "unchanged") return "unchanged";
  if (value === "changed") return "changed";
  console.error(
    `Unknown --tab value: ${value} (expected: changed, other, unchanged)`,
  );
  process.exit(1);
}

function parseSince(value: string): string {
  const trimmed = value.trim();
  const timestamp = parseSinceTimestamp(trimmed);

  if (!Number.isFinite(timestamp)) {
    console.error(
      `Unknown --since value: ${value} (expected an ISO/RFC date, epoch timestamp, or relative duration like 2d / 2 days ago)`,
    );
    process.exit(1);
  }

  return new Date(timestamp).toISOString();
}

function parseSinceTimestamp(value: string): number {
  if (/^\d+$/.test(value)) return normalizeEpoch(Number(value));
  return parseRelativeSinceTimestamp(value) ?? Date.parse(value);
}

function parseRelativeSinceTimestamp(value: string): number | undefined {
  const match = value
    .toLowerCase()
    .match(
      /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)(?:\s+ago)?$/,
    );
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;

  const unit = match[2];
  const millis = relativeUnitMillis(unit);
  return millis === undefined ? undefined : Date.now() - amount * millis;
}

function relativeUnitMillis(unit: string | undefined): number | undefined {
  switch (unit) {
    case "s":
    case "sec":
    case "secs":
    case "second":
    case "seconds":
      return 1_000;
    case "m":
    case "min":
    case "mins":
    case "minute":
    case "minutes":
      return 60_000;
    case "h":
    case "hr":
    case "hrs":
    case "hour":
    case "hours":
      return 3_600_000;
    case "d":
    case "day":
    case "days":
      return 86_400_000;
    case "w":
    case "week":
    case "weeks":
      return 604_800_000;
    default:
      return undefined;
  }
}

function normalizeEpoch(epoch: number): number {
  return epoch < 10_000_000_000 ? epoch * 1000 : epoch;
}

function stripTuiPrefix(args: readonly string[]): readonly string[] {
  return args.length > 0 && args[0] === "tui" ? args.slice(1) : args;
}

function collectLeadingPositionals(args: readonly string[]): {
  readonly positionals: readonly string[];
  readonly startIndex: number;
} {
  const positionals: string[] = [];
  let index = 0;

  while (index < args.length && !args[index].startsWith("-")) {
    positionals.push(args[index]);
    index++;
  }

  return { positionals, startIndex: index };
}

function findKnownTargetLength(positionals: readonly string[]): number {
  for (let len = positionals.length; len >= 1; len--) {
    if (isKnownTarget(positionals.slice(0, len).join("."))) return len;
  }

  return 0;
}

function resolvePositionals(positionals: readonly string[]): {
  readonly subcommand: string | undefined;
  readonly rest: readonly string[];
} {
  if (positionals.length === 0) return { subcommand: undefined, rest: [] };

  const consumed = findKnownTargetLength(positionals);
  const resolvedCount = consumed === 0 ? 1 : consumed;
  const subcommand = positionals.slice(0, resolvedCount).join(".");

  return { subcommand, rest: positionals.slice(resolvedCount) };
}

type ParsedOptions = {
  tab: DiffTab;
  since: string | undefined;
  help: boolean;
  rest: string[];
};

type FlagHandler = (
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
) => number;

function createParsedOptions(): ParsedOptions {
  return { tab: "changed", since: undefined, help: false, rest: [] };
}

function setHelp(
  _args: readonly string[],
  _index: number,
  parsed: ParsedOptions,
): number {
  parsed.help = true;
  return 0;
}

function consumeSinceEquals(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
): number {
  parsed.since = parseSince(args[index].slice("--since=".length));
  return 0;
}

function consumeSinceOption(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
): number {
  const values = collectFlagValues(args, index + 1);

  if (values.length === 0) {
    console.error("--since requires a date value");
    process.exit(1);
  }

  parsed.since = parseSince(values.join(" "));
  return values.length;
}

function consumeTabOption(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
): number {
  const next = args[index + 1];

  if (!next || next.startsWith("-")) {
    console.error("--tab requires a value (e.g. --tab changed or --tab other)");
    process.exit(1);
  }

  parsed.tab = parseDiffTab(next);
  return 1;
}

function collectFlagValues(
  args: readonly string[],
  startIndex: number,
): string[] {
  const values: string[] = [];

  for (let index = startIndex; index < args.length; index++) {
    if (args[index].startsWith("--")) break;
    values.push(args[index]);
  }

  return values;
}

const flagHandlers = new Map<string, FlagHandler>([
  ["--help", setHelp],
  ["-h", setHelp],
  ["--since", consumeSinceOption],
  ["--tab", consumeTabOption],
]);

function parseOptions(
  args: readonly string[],
  startIndex: number,
): ParsedOptions {
  const parsed = createParsedOptions();

  for (let index = startIndex; index < args.length; index++) {
    const arg = args[index];
    const handler = arg.startsWith("--since=")
      ? consumeSinceEquals
      : flagHandlers.get(arg);

    if (!handler) {
      parsed.rest.push(arg);
      continue;
    }

    index += handler(args, index, parsed);
  }

  return parsed;
}

/** Check whether a candidate string matches any known view, menu item, or submenu */
function isKnownTarget(candidate: string): boolean {
  if (nativeCommandNames.has(candidate)) return true;
  if (menuItemsById.has(candidate) || submenus.has(candidate)) return true;
  return false;
}

/**
 * Parse CLI args into structured flags with greedy subcommand resolution.
 *
 * Positional args are joined with `.` using greedy longest-match against
 * the menu registry. For example, `["omarchy", "theme", "set"]` resolves
 * to subcommand `"omarchy.theme.set"` if that ID exists in the registry.
 *
 * The `tui` prefix is a transparent alias — `dot tui git-diff` is equivalent to
 * `dot git-diff`. It is stripped before subcommand resolution so remaining
 * positionals and flags are processed normally.
 */
export function parseFlags(args: readonly string[]): Flags {
  const effectiveArgs = stripTuiPrefix(args);
  const { positionals, startIndex } = collectLeadingPositionals(effectiveArgs);
  const resolved = resolvePositionals(positionals);
  const parsed = parseOptions(effectiveArgs, startIndex);

  return {
    subcommand: resolved.subcommand,
    tab: parsed.tab,
    since: parsed.since,
    help: parsed.help,
    rest: [...resolved.rest, ...parsed.rest],
  };
}

/** Resolve a subcommand string to a navigation target */
export function resolveSubcommand(
  sub: string,
):
  | { type: "view"; viewId: ViewId }
  | { type: "item"; itemId: string }
  | undefined {
  // Direct view names. `diff` is a short alias for `git-diff`.
  if (sub === "dashboard") {
    return { type: "view", viewId: "dashboard" };
  }
  if (sub === "git-diff" || sub === "diff") {
    return { type: "view", viewId: "git-diff" };
  }
  if (sub === "git-notifications") {
    return { type: "view", viewId: "git-notifications" };
  }
  if (sub === "omarchy") return { type: "view", viewId: "omarchy" };

  // Match against menu item IDs or submenu keys
  if (menuItemsById.has(sub)) return { type: "item", itemId: sub };
  if (submenus.has(sub)) return { type: "item", itemId: sub };

  return undefined;
}

/**
 * Print help text, optionally scoped to a specific subcommand.
 *
 * - `git-diff` — shows diff-specific flags
 * - `git-notifications` — shows GitHub inbox flags and actions
 * - `omarchy` — shows available omarchy submenus and space-separated navigation
 * - No subcommand — shows the full generic help
 */
export function printHelp(subcommand?: string): void {
  console.log(renderHelp(subcommand));
}
