import { Effect, Schema } from "effect";
import { existsSync, readFileSync } from "fs";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { runElevated } from "./elevatedCommand.js";
import { ENV, envString } from "./env.js";

/** IPv4 ufw user rules file scanned to detect already-configured ports. */
const UFW_USER_RULES_FILE = "/etc/ufw/user.rules";

/** Supported transport protocols for a managed firewall rule. */
export type FirewallProtocol = "tcp" | "udp";

/** A ufw allow rule managed by dot init and verified by dot doctor. */
export interface ManagedFirewallRule {
  /**
   * Human-readable purpose. Shown in init logs and doctor output, and stored
   * as the ufw rule comment so it appears in `ufw status`.
   */
  readonly label: string;
  /** ufw port token: a single port (`8123`) or an inclusive range (`1714:1764`). */
  readonly port: string;
  /** Protocols this port should be allowed on. */
  readonly protocols: readonly FirewallProtocol[];
}

/**
 * Inbound ufw rules dot keeps open.
 *
 * - KDE Connect discovers and connects over the full 1714-1764 range on both
 *   UDP (discovery) and TCP (transfer).
 * - Home Assistant serves its frontend on 8123 and its companion port 8124.
 * - The dot OpenCode server (see OpenCodeServer.ts) listens on 4096.
 */
export const MANAGED_FIREWALL_RULES: readonly ManagedFirewallRule[] = [
  { label: "KDE Connect", port: "1714:1764", protocols: ["udp", "tcp"] },
  { label: "Home Assistant", port: "8123", protocols: ["tcp"] },
  { label: "Home Assistant", port: "8124", protocols: ["tcp"] },
  { label: "OpenCode server", port: "4096", protocols: ["tcp"] },
];

/** Domain error for firewall setup failures. */
export class FirewallSetupError extends Schema.TaggedErrorClass<FirewallSetupError>()(
  "FirewallSetupError",
  {
    message: Schema.String,
  },
) {}

/** A single protocol/port unit of a managed rule. */
export interface FirewallRuleSpec {
  /** ufw argument, e.g. `1714:1764/udp` or `8123/tcp`. */
  readonly arg: string;
  /** Tuple key used to match `### tuple ###` lines, e.g. `udp 1714:1764`. */
  readonly tupleKey: string;
  /** Expected ufw rule comment (the owning rule's label). */
  readonly comment: string;
}

/** Presence of a ufw allow rule and its decoded comment (null when absent). */
export interface UfwTuple {
  /** Decoded ufw rule comment, or null when the rule carries no comment. */
  readonly comment: string | null;
}

/** Path to the ufw user rules file, overridable via `DOT_UFW_RULES_FILE`. */
export function ufwRulesFilePath(): string {
  return envString(ENV.DOT_UFW_RULES_FILE) ?? UFW_USER_RULES_FILE;
}

/** Flatten the managed rules into one spec per protocol/port pair. */
export function firewallRuleSpecs(): readonly FirewallRuleSpec[] {
  return MANAGED_FIREWALL_RULES.flatMap((rule) =>
    rule.protocols.map((protocol) => ({
      arg: `${rule.port}/${protocol}`,
      tupleKey: `${protocol} ${rule.port}`,
      comment: rule.label,
    })),
  );
}

/** Decode a ufw comment, stored as hex-encoded UTF-8 bytes. */
function decodeUfwComment(hex: string): string | null {
  try {
    return Buffer.from(hex, "hex").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Parse `### tuple ### allow <proto> <port>` entries from a ufw user.rules
 * file. Returns a map of `"<proto> <port>"` keys to the rule's decoded comment
 * (null when the rule carries no comment).
 */
export function parseUfwAllowTuples(
  content: string,
): ReadonlyMap<string, UfwTuple> {
  const tuples = new Map<string, UfwTuple>();
  for (const line of content.split("\n")) {
    const head = line.match(/### tuple ### allow (tcp|udp) (\S+) /);
    if (!head) continue;
    const commentMatch = line.match(/ comment=([0-9a-fA-F]+)/);
    tuples.set(`${head[1]} ${head[2]}`, {
      comment: commentMatch ? decodeUfwComment(commentMatch[1]) : null,
    });
  }
  return tuples;
}

/** Read the currently allowed ufw tuples, or an empty map when unreadable. */
export function presentUfwTuples(): ReadonlyMap<string, UfwTuple> {
  const filePath = ufwRulesFilePath();
  if (!existsSync(filePath)) return new Map();
  try {
    return parseUfwAllowTuples(readFileSync(filePath, "utf-8"));
  } catch {
    return new Map();
  }
}

function fail(message: string): Effect.Effect<never, FirewallSetupError> {
  return Effect.fail(new FirewallSetupError({ message }));
}

function commandAvailable(
  command: string,
): Effect.Effect<boolean, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    return (yield* executor.exitCode("which", [command])) === 0;
  });
}

function ufwAllow(
  spec: FirewallRuleSpec,
): Effect.Effect<void, FirewallSetupError, CommandExecutor> {
  return Effect.gen(function* () {
    const exitCode = yield* runElevated("ufw", [
      "allow",
      spec.arg,
      "comment",
      spec.comment,
    ]);
    if (exitCode !== 0) {
      return yield* fail(`ufw allow ${spec.arg} exited ${exitCode}`);
    }
  });
}

/**
 * Ensure the managed ufw rules are present, each tagged with its purpose as a
 * ufw comment so it is visible in `ufw status`.
 *
 * Idempotent: rules are read from the world-readable ufw user.rules file, so a
 * fully configured machine needs no elevation. Missing rules are added; rules
 * that exist with a missing or stale comment are deleted and re-added (ufw
 * cannot edit a comment in place). A single `ufw reload` follows any change.
 * Skips with a warning when ufw is not installed.
 */
export const configureFirewallRules: Effect.Effect<
  void,
  FirewallSetupError,
  CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Configure Firewall");

  if (!(yield* commandAvailable("ufw"))) {
    yield* log.warn("Skipping firewall rules (ufw not installed)");
    return;
  }

  const present = presentUfwTuples();
  const specs = firewallRuleSpecs();
  const toAdd = specs.filter((spec) => !present.has(spec.tupleKey));
  const toRecomment = specs.filter(
    (spec) =>
      present.has(spec.tupleKey) &&
      present.get(spec.tupleKey)?.comment !== spec.comment,
  );

  if (toAdd.length === 0 && toRecomment.length === 0) {
    yield* log.info("Firewall rules already configured");
    return;
  }

  for (const spec of toRecomment) {
    yield* log.info(`Updating comment for ${spec.arg} (${spec.comment})`);
    const deleteExit = yield* runElevated("ufw", ["delete", "allow", spec.arg]);
    if (deleteExit !== 0) {
      return yield* fail(`ufw delete allow ${spec.arg} exited ${deleteExit}`);
    }
    yield* ufwAllow(spec);
  }

  for (const spec of toAdd) {
    yield* log.info(`Allowing ${spec.arg} (${spec.comment})`);
    yield* ufwAllow(spec);
  }

  const reloadExit = yield* runElevated("ufw", ["reload"]);
  if (reloadExit !== 0) {
    return yield* fail(`ufw reload exited ${reloadExit}`);
  }

  const changed = toAdd.length + toRecomment.length;
  yield* log.info(
    `Configured ${changed} firewall rule${changed === 1 ? "" : "s"}`,
  );
});
