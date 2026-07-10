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

/**
 * An inbound ufw allow rule for a port or port range, optionally scoped to a
 * single interface (e.g. libvirt's `virbr0`).
 */
export interface ManagedPortRule {
  /** Discriminant: a port/range allow rule. */
  readonly kind: "port";
  /**
   * Human-readable purpose. Shown in init logs and doctor output, and stored
   * as the ufw rule comment so it appears in `ufw status`.
   */
  readonly label: string;
  /** ufw port token: a single port (`8123`) or an inclusive range (`1714:1764`). */
  readonly port: string;
  /** Protocols this port should be allowed on. */
  readonly protocols: readonly FirewallProtocol[];
  /** Interface to scope the rule to (e.g. `virbr0`); omit for any interface. */
  readonly interface?: string;
}

/**
 * A ufw forwarding (route) allow rule for traffic arriving on an interface,
 * used to let libvirt's NAT network forward guest traffic through the host.
 */
export interface ManagedRouteRule {
  /** Discriminant: a routed/forwarded allow rule. */
  readonly kind: "route";
  /** Human-readable purpose, stored as the ufw rule comment. */
  readonly label: string;
  /** Interface routed traffic arrives on (e.g. `virbr0`). */
  readonly interface: string;
}

/** A ufw rule managed by dot init and verified by dot doctor. */
export type ManagedFirewallRule = ManagedPortRule | ManagedRouteRule;

/**
 * ufw rules dot keeps open.
 *
 * - KDE Connect discovers and connects over the full 1714-1764 range on both
 *   UDP (discovery) and TCP (transfer).
 * - Home Assistant serves its frontend on 8123 and its companion port 8124.
 * - OpenCode's local server listens on its default port 4096.
 * - LocalSend discovers and transfers over 53317 on both UDP and TCP.
 * - libvirt's default NAT network needs the host to accept guest DHCP (67) and
 *   DNS (53) on `virbr0` and to forward (route) guest traffic off `virbr0`,
 *   which ufw's default `deny (incoming)`/`deny (routed)` policy otherwise
 *   blocks.
 */
export const MANAGED_FIREWALL_RULES: readonly ManagedFirewallRule[] = [
  {
    kind: "port",
    label: "KDE Connect",
    port: "1714:1764",
    protocols: ["udp", "tcp"],
  },
  { kind: "port", label: "Home Assistant", port: "8123", protocols: ["tcp"] },
  { kind: "port", label: "Home Assistant", port: "8124", protocols: ["tcp"] },
  { kind: "port", label: "OpenCode server", port: "4096", protocols: ["tcp"] },
  {
    kind: "port",
    label: "LocalSend",
    port: "53317",
    protocols: ["udp", "tcp"],
  },
  {
    kind: "port",
    label: "libvirt DHCP",
    port: "67",
    protocols: ["udp"],
    interface: "virbr0",
  },
  {
    kind: "port",
    label: "libvirt DNS",
    port: "53",
    protocols: ["tcp", "udp"],
    interface: "virbr0",
  },
  { kind: "route", label: "libvirt NAT forward", interface: "virbr0" },
];

/** Domain error for firewall setup failures. */
export class FirewallSetupError extends Schema.TaggedErrorClass<FirewallSetupError>()(
  "FirewallSetupError",
  {
    message: Schema.String,
  },
) {}

/** A single ufw rule unit derived from a managed rule (one per protocol). */
export interface FirewallRuleSpec {
  /**
   * ufw arguments that add this rule, excluding the trailing `comment <label>`,
   * e.g. `["allow", "8123/tcp"]` or
   * `["allow", "in", "on", "virbr0", "to", "any", "port", "67", "proto", "udp"]`.
   */
  readonly addArgs: readonly string[];
  /**
   * ufw arguments that delete this rule. Port rules prefix `addArgs` with
   * `delete` (`ufw delete allow 8123/tcp`), but route rules keep `route` first
   * (`ufw route delete allow in on virbr0`), so the delete form is stored
   * explicitly rather than derived from `addArgs`.
   */
  readonly deleteArgs: readonly string[];
  /**
   * Exact tuple key used to match `### tuple ###` lines, including source,
   * destination, and direction/interface fields.
   */
  readonly tupleKey: string;
  /** Expected ufw rule comment (the owning rule's label). */
  readonly comment: string;
  /** Short human descriptor for logs and doctor output, e.g. `67/udp on virbr0`. */
  readonly describe: string;
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

/** Build the specs (one per protocol) for a single port rule. */
function portRuleSpecs(rule: ManagedPortRule): readonly FirewallRuleSpec[] {
  const direction = rule.interface ? `in_${rule.interface}` : "in";
  return rule.protocols.map((protocol) => {
    const addArgs = rule.interface
      ? [
          "allow",
          "in",
          "on",
          rule.interface,
          "to",
          "any",
          "port",
          rule.port,
          "proto",
          protocol,
        ]
      : [
          "allow",
          "proto",
          protocol,
          "from",
          "any",
          "to",
          "any",
          "port",
          rule.port,
        ];
    return {
      addArgs,
      deleteArgs: ["delete", ...addArgs],
      tupleKey: `allow ${protocol} ${rule.port} 0.0.0.0/0 any 0.0.0.0/0 ${direction}`,
      comment: rule.label,
      describe: rule.interface
        ? `${rule.port}/${protocol} on ${rule.interface}`
        : `${rule.port}/${protocol}`,
    };
  });
}

/** Build the spec for a single route rule. */
function routeRuleSpec(rule: ManagedRouteRule): FirewallRuleSpec {
  return {
    addArgs: ["route", "allow", "in", "on", rule.interface],
    deleteArgs: ["route", "delete", "allow", "in", "on", rule.interface],
    tupleKey: `route:allow any any 0.0.0.0/0 any 0.0.0.0/0 in_${rule.interface}`,
    comment: rule.label,
    describe: `route in on ${rule.interface}`,
  };
}

/** Flatten the managed rules into one spec per ufw rule unit. */
export function firewallRuleSpecs(): readonly FirewallRuleSpec[] {
  return MANAGED_FIREWALL_RULES.flatMap((rule) =>
    rule.kind === "route" ? [routeRuleSpec(rule)] : portRuleSpecs(rule),
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
 * Parse `### tuple ### <action> <proto> <port> ...` entries from a ufw
 * user.rules file. Keys preserve the complete tuple identity so a restricted
 * source rule cannot satisfy a managed any-source rule.
 */
export function parseUfwAllowTuples(
  content: string,
): ReadonlyMap<string, UfwTuple> {
  const tuples = new Map<string, UfwTuple>();
  for (const line of content.split("\n")) {
    const head = line.match(
      /### tuple ### (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)/,
    );
    if (!head) continue;
    const [
      ,
      action,
      proto,
      port,
      destination,
      destinationPort,
      source,
      direction,
    ] = head;
    const commentMatch = line.match(/ comment=([0-9a-fA-F]+)/);
    tuples.set(
      `${action} ${proto} ${port} ${destination} ${destinationPort} ${source} ${direction}`,
      {
        comment: commentMatch ? decodeUfwComment(commentMatch[1]) : null,
      },
    );
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

function unresolvedFirewallSpecs(
  specs: readonly FirewallRuleSpec[],
): readonly FirewallRuleSpec[] {
  const present = presentUfwTuples();
  return specs.filter((spec) => {
    const tuple = present.get(spec.tupleKey);
    return !tuple || tuple.comment !== spec.comment;
  });
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

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function shellCommand(args: readonly string[]): string {
  return args.map(shellQuote).join(" ");
}

/** Build a shell script that applies several ufw commands under one elevation. */
export function firewallSetupScript(
  commands: readonly (readonly string[])[],
): string {
  return [
    "set -e",
    ...commands.map((args) => shellCommand(["ufw", ...args])),
  ].join("\n");
}

function ufwAllowArgs(spec: FirewallRuleSpec): readonly string[] {
  return [...spec.addArgs, "comment", spec.comment];
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

  const commands: (readonly string[])[] = [];

  for (const spec of toRecomment) {
    yield* log.info(`Updating comment for ${spec.describe} (${spec.comment})`);
    commands.push(spec.deleteArgs, ufwAllowArgs(spec));
  }

  for (const spec of toAdd) {
    yield* log.info(`Allowing ${spec.describe} (${spec.comment})`);
    commands.push(ufwAllowArgs(spec));
  }

  commands.push(["reload"]);

  const exitCode = yield* runElevated("sh", [
    "-c",
    firewallSetupScript(commands),
  ]);
  if (exitCode !== 0) {
    return yield* fail(`ufw firewall setup exited ${exitCode}`);
  }

  const unresolved = unresolvedFirewallSpecs(specs);
  if (unresolved.length > 0) {
    return yield* fail(
      `ufw firewall setup did not persist: ${unresolved
        .map((spec) => `${spec.describe} (${spec.comment})`)
        .join(", ")}`,
    );
  }

  const changed = toAdd.length + toRecomment.length;
  yield* log.info(
    `Configured ${changed} firewall rule${changed === 1 ? "" : "s"}`,
  );
});
