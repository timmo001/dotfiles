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
  /** `limit` rate-limits new connections, as for SSH; `allow` by default. */
  readonly action?: "allow" | "limit";
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
 * ufw rules dot keeps open on Station, taken from the desktop's where they
 * apply. The Home Assistant dev ports, libvirt and Docker DNS are left out,
 * since Station runs none of them. Services moved over from the Home
 * Assistant Green add their own rules when they move.
 *
 * - SSH is rate limited, the same as the desktop's rule.
 * - KDE Connect discovers and connects over the full 1714-1764 range on both
 *   UDP (discovery) and TCP (transfer). Plasma ships it.
 * - LocalSend discovers and transfers over 53317 on both UDP and TCP.
 * - System Bridge serves its API on 9170, which Home Assistant connects to.
 * - The OpenCode server listens on its default port, 49374, on every
 *   interface, so Home Assistant's Assist can pair with it and use its agents.
 * - Plannotator plan reviews listen on 19432-19439 in remote mode, which binds
 *   every interface, so only Tailscale may reach them. Code reviews and the
 *   Inbox go through tailscale serve, which ufw never sees.
 * - Steam Remote Play finds devices over UDP 27031-27036 and streams over TCP
 *   27036-27037.
 * - KRdp, Plasma's RDP server, listens on 3389.
 * - Sunshine serves Moonlight clients: HTTPS pairing on 47984, HTTP on 47989,
 *   its web UI on 47990 and RTSP on 48010 over TCP, with video, control and
 *   audio on UDP 47998-48000, 48002 and 48010. Moonlight on Station only connects
 *   out, so it needs nothing.
 * - Kestrel NVR serves its web app and API on 7380, and takes camera uploads
 *   over FTP on 7381 with data on 7390-7399.
 * - The Upkeep server serves its API and dashboard to workers and admins on
 *   7272, and Triage's server takes events and serves its API on 7171. Its
 *   MCP server for Home Assistant on 8099 only answers the Green's address.
 * - Forgejo serves Git over SSH on 2222. The router only forwards 443, so it
 *   stays on the home network and the tailnet.
 */
export const MANAGED_FIREWALL_RULES: readonly ManagedFirewallRule[] = [
  {
    kind: "port",
    label: "SSH",
    port: "22",
    protocols: ["tcp"],
    action: "limit",
  },
  {
    kind: "port",
    label: "KDE Connect",
    port: "1714:1764",
    protocols: ["udp", "tcp"],
  },
  {
    kind: "port",
    label: "LocalSend",
    port: "53317",
    protocols: ["udp", "tcp"],
  },
  { kind: "port", label: "System Bridge", port: "9170", protocols: ["tcp"] },
  { kind: "port", label: "OpenCode server", port: "49374", protocols: ["tcp"] },
  {
    kind: "port",
    label: "Plannotator plan reviews",
    port: "19432:19439",
    protocols: ["tcp"],
    interface: "tailscale0",
  },
  {
    kind: "port",
    label: "Steam Remote Play",
    port: "27031:27036",
    protocols: ["udp"],
  },
  {
    kind: "port",
    label: "Steam Remote Play",
    port: "27036:27037",
    protocols: ["tcp"],
  },
  { kind: "port", label: "KRdp", port: "3389", protocols: ["tcp"] },
  { kind: "port", label: "Sunshine", port: "47984", protocols: ["tcp"] },
  { kind: "port", label: "Sunshine", port: "47989:47990", protocols: ["tcp"] },
  { kind: "port", label: "Sunshine", port: "48010", protocols: ["tcp", "udp"] },
  { kind: "port", label: "Sunshine", port: "47998:48000", protocols: ["udp"] },
  { kind: "port", label: "Sunshine", port: "48002", protocols: ["udp"] },
  { kind: "port", label: "Kestrel", port: "7380", protocols: ["tcp"] },
  {
    kind: "port",
    label: "Kestrel camera uploads",
    port: "7381",
    protocols: ["tcp"],
  },
  {
    kind: "port",
    label: "Kestrel camera uploads",
    port: "7390:7399",
    protocols: ["tcp"],
  },
  { kind: "port", label: "Upkeep server", port: "7272", protocols: ["tcp"] },
  { kind: "port", label: "Triage server", port: "7171", protocols: ["tcp"] },
  {
    kind: "port",
    label: "Triage MCP for Home Assistant",
    port: "8099",
    protocols: ["tcp"],
  },
  { kind: "port", label: "Forgejo SSH", port: "2222", protocols: ["tcp"] },
];

/**
 * ufw application profiles whose rules dot's own replace. CachyOS opens SSH
 * and KDE Connect through these, without the comments dot matches on, so the
 * profile rules are removed once dot's are in place rather than kept as
 * duplicates.
 */
const REPLACED_APP_PROFILES = ["SSH", "KDE Connect"] as const;

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
  const action = rule.action ?? "allow";

  return rule.protocols.map((protocol) => {
    const addArgs = rule.interface
      ? [
          action,
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
          action,
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
      tupleKey: `${action} ${protocol} ${rule.port} 0.0.0.0/0 any 0.0.0.0/0 ${direction}`,
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
export const presentUfwTuples = Effect.fn("FirewallSetup.presentUfwTuples")(
  function* () {
    const filePath = ufwRulesFilePath();

    if (!(yield* pathExists(filePath))) return new Map<string, UfwTuple>();

    const text = yield* readTextOrNull(filePath);

    if (text === null) return new Map<string, UfwTuple>();

    return yield* Effect.try(() => parseUfwAllowTuples(text)).pipe(
      Effect.orElseSucceed(() => new Map<string, UfwTuple>()),
    );
  },
);

/**
 * The replaced application profiles that still have a rule. ufw stores a
 * profile rule's tuple with the profile name URL-encoded in place of the
 * comment, such as `KDE%20Connect - in`.
 */
const presentReplacedAppProfiles = Effect.fn(
  "FirewallSetup.presentReplacedAppProfiles",
)(function* () {
  const text = yield* readTextOrNull(ufwRulesFilePath());

  if (text === null) return [];

  return REPLACED_APP_PROFILES.filter((app) =>
    text
      .split("\n")
      .some(
        (line) =>
          line.startsWith("### tuple ###") &&
          line.endsWith(` ${encodeURIComponent(app)} - in`),
      ),
  );
});

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
  CommandExecutor | OutputLog | FileSystem.FileSystem
> = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Configure Firewall");

  if (!(yield* commandAvailable("ufw"))) {
    yield* log.warn("Skipping firewall rules (ufw not installed)");

    return;
  }

  const present = yield* presentUfwTuples();
  const specs = firewallRuleSpecs();
  const toAdd = specs.filter((spec) => !present.has(spec.tupleKey));

  const toRecomment = specs.filter(
    (spec) =>
      present.has(spec.tupleKey) &&
      present.get(spec.tupleKey)?.comment !== spec.comment,
  );

  const appProfiles = yield* presentReplacedAppProfiles();

  if (
    toAdd.length === 0 &&
    toRecomment.length === 0 &&
    appProfiles.length === 0
  ) {
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

  // Only after dot's own rules are added, so SSH is never left closed.
  for (const app of appProfiles) {
    yield* log.info(`Replacing the ${app} profile rule with dot's own`);
    commands.push(["delete", "allow", app]);
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

  const changed = toAdd.length + toRecomment.length + appProfiles.length;
  yield* log.success(`Configured ${plural(changed, "firewall rule")}`);
});
