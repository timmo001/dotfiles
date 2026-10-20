import { Effect, type FileSystem, Schema } from "effect";
import { cliStyler } from "./ansi.js";
import { plural } from "./runSummary.js";
import { pathExists, readTextOrNull } from "./fsProbe.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { runElevated } from "./elevatedCommand.js";
import { ENV, envString } from "./env.js";

/** IPv4 ufw user rules file scanned to detect already-configured ports. */
const UFW_USER_RULES_FILE = "/etc/ufw/user.rules";

/** Absolute ufw path, used because /usr/sbin is often not on a user PATH. */
const UFW_BINARY = "/usr/sbin/ufw";

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
export type ManagedFirewallRule =
  ManagedPortRule | ManagedRouteRule | ManagedSourceRule;

/**
 * An inbound ufw rule allowing all traffic from a source network or arriving
 * on an interface.
 */
export interface ManagedSourceRule {
  /** Discriminant: an any-port allow rule for a trusted source. */
  readonly kind: "source";
  /** Human-readable purpose, stored as the ufw rule comment. */
  readonly label: string;
  /** Source network in CIDR form (e.g. `192.168.0.0/16`). */
  readonly from?: string;
  /** Interface the traffic arrives on (e.g. `tailscale0`). */
  readonly interface?: string;
}

/**
 * ufw rules dot keeps open on the server.
 *
 * - SSH on 22, so enabling ufw never locks the server out.
 * - System Bridge serves its API on 9170, which Home Assistant connects to.
 * - Ollama (11434) and Ollaya (11435) serve models to other machines.
 * - Private networks and Tailscale are trusted, so LAN services (Plex, Samba,
 *   ESPHome and others with changing ports) and containers reaching host
 *   services keep working.
 */
export const MANAGED_FIREWALL_RULES: readonly ManagedFirewallRule[] = [
  { kind: "port", label: "SSH", port: "22", protocols: ["tcp"] },
  { kind: "port", label: "System Bridge", port: "9170", protocols: ["tcp"] },
  { kind: "port", label: "Ollama", port: "11434", protocols: ["tcp"] },
  { kind: "port", label: "Ollaya", port: "11435", protocols: ["tcp"] },
  { kind: "source", label: "Private network", from: "192.168.0.0/16" },
  { kind: "source", label: "Private network", from: "10.0.0.0/8" },
  { kind: "source", label: "Docker networks", from: "172.16.0.0/12" },
  { kind: "source", label: "Tailscale", interface: "tailscale0" },
];

/** Domain error for firewall setup failures. */
export class FirewallSetupError extends Schema.TaggedError<FirewallSetupError>()(
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

/** Build the spec for a single trusted-source rule. */
function sourceRuleSpec(rule: ManagedSourceRule): FirewallRuleSpec {
  const addArgs = rule.interface
    ? ["allow", "in", "on", rule.interface]
    : ["allow", "from", rule.from ?? "any"];

  return {
    addArgs,
    deleteArgs: ["delete", ...addArgs],
    tupleKey: `allow any any 0.0.0.0/0 any ${rule.from ?? "0.0.0.0/0"} ${rule.interface ? `in_${rule.interface}` : "in"}`,
    comment: rule.label,
    describe: rule.interface
      ? `all in on ${rule.interface}`
      : `all from ${rule.from}`,
  };
}

/** Flatten the managed rules into one spec per ufw rule unit. */
export function firewallRuleSpecs(): readonly FirewallRuleSpec[] {
  return MANAGED_FIREWALL_RULES.flatMap((rule) => {
    if (rule.kind === "route") return [routeRuleSpec(rule)];

    if (rule.kind === "source") return [sourceRuleSpec(rule)];

    return portRuleSpecs(rule);
  });
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

/**
 * Read the currently allowed ufw tuples, or an empty map when unreadable.
 *
 * Ubuntu keeps user.rules readable by root only, so an unreadable file is
 * read through non-interactive sudo, which never prompts.
 */
export const presentUfwTuples = Effect.fn("FirewallSetup.presentUfwTuples")(
  function* () {
    const filePath = ufwRulesFilePath();

    if (!(yield* pathExists(filePath))) return new Map<string, UfwTuple>();

    const executor = yield* CommandExecutor;

    const text =
      (yield* readTextOrNull(filePath)) ??
      (yield* executor
        .run("sudo", ["-n", "cat", filePath])
        .pipe(Effect.orElseSucceed(() => null)));

    if (text === null) return new Map<string, UfwTuple>();

    return yield* Effect.try(() => parseUfwAllowTuples(text)).pipe(
      Effect.orElseSucceed(() => new Map<string, UfwTuple>()),
    );
  },
);

const unresolvedFirewallSpecs = Effect.fn("FirewallSetup.unresolvedSpecs")(
  function* (specs: readonly FirewallRuleSpec[]) {
    const present = yield* presentUfwTuples();

    return specs.filter((spec) => {
      const tuple = present.get(spec.tupleKey);

      return !tuple || tuple.comment !== spec.comment;
    });
  },
);

function fail(message: string): Effect.Effect<never, FirewallSetupError> {
  return Effect.fail(new FirewallSetupError({ message }));
}

/**
 * Whether ufw is installed. It lives in /usr/sbin, which is often missing
 * from a user PATH, so that path is checked as well.
 */
export const ufwInstalled: Effect.Effect<
  boolean,
  never,
  CommandExecutor | FileSystem.FileSystem
> = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return (
    (yield* executor.exitCode("which", ["ufw"])) === 0 ||
    (yield* pathExists(UFW_BINARY))
  );
});

/** Whether ufw is enabled, read through non-interactive sudo. */
export const ufwActive: Effect.Effect<boolean, never, CommandExecutor> =
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    const status = yield* executor
      .run("sudo", ["-n", UFW_BINARY, "status"])
      .pipe(Effect.orElseSucceed(() => ""));

    return /^Status: active/m.test(status);
  });

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
    ...commands.map((args) => shellCommand([UFW_BINARY, ...args])),
  ].join("\n");
}

function ufwAllowArgs(spec: FirewallRuleSpec): readonly string[] {
  return [...spec.addArgs, "comment", spec.comment];
}

const reconcileFirewallRules = Effect.gen(function* () {
  const log = yield* OutputLog;
  const present = yield* presentUfwTuples();
  const specs = firewallRuleSpecs();
  const toAdd = specs.filter((spec) => !present.has(spec.tupleKey));

  const toRecomment = specs.filter(
    (spec) =>
      present.has(spec.tupleKey) &&
      present.get(spec.tupleKey)?.comment !== spec.comment,
  );

  if (toAdd.length === 0 && toRecomment.length === 0) {
    yield* log.info(cliStyler().dim("Firewall rules already configured"));

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

  const unresolved = yield* unresolvedFirewallSpecs(specs);

  if (unresolved.length > 0) {
    return yield* fail(
      `ufw firewall setup did not persist: ${unresolved
        .map((spec) => `${spec.describe} (${spec.comment})`)
        .join(", ")}`,
    );
  }

  const changed = toAdd.length + toRecomment.length;
  yield* log.success(`Configured ${plural(changed, "firewall rule")}`);
});

/**
 * Ensure the managed ufw rules are present, each tagged with its purpose as a
 * ufw comment so it is visible in `ufw status`.
 *
 * Idempotent: rules are read from the ufw user.rules file (through
 * non-interactive sudo when it is root-only), so a fully configured machine
 * needs no prompt. Missing rules are added; rules
 * that exist with a missing or stale comment are deleted and re-added (ufw
 * cannot edit a comment in place). A single `ufw reload` follows any change.
 * ufw is then enabled when inactive; the SSH rule is in place first, so this
 * cannot lock the server out. Skips with a warning when ufw is not installed.
 */
export const configureFirewallRules: Effect.Effect<
  void,
  FirewallSetupError,
  CommandExecutor | OutputLog | FileSystem.FileSystem
> = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Configure Firewall");

  if (!(yield* ufwInstalled)) {
    yield* log.warn("Skipping firewall rules (ufw not installed)");

    return;
  }

  yield* reconcileFirewallRules;

  if (yield* ufwActive) return;

  yield* log.info("Enabling ufw");

  const exitCode = yield* runElevated("sh", [
    "-c",
    firewallSetupScript([["--force", "enable"]]),
  ]);

  if (exitCode !== 0 || !(yield* ufwActive))
    return yield* fail(`ufw enable exited ${exitCode}`);

  yield* log.success("Enabled ufw");
});
