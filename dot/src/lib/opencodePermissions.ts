/**
 * @file OpenCode V2 permission rule evaluation for other harnesses.
 *
 * Mirrors OpenCode's semantics so another harness can enforce the same rule
 * list: rules are checked in order and the last match wins, and patterns use
 * OpenCode's wildcard syntax (`*` matches anything, `?` one character, and a
 * trailing ` *` is optional so `ls *` also matches `ls`).
 */
import { isAbsolute, relative, resolve } from "path";
import { HOME_DIR } from "./paths.js";

/** Outcome of a permission rule. */
export type PermissionEffect = "allow" | "ask" | "deny";

/** One OpenCode permission rule. */
export interface PermissionRule {
  /** Tool action, such as `shell`, `read`, or an MCP `server_tool` name. */
  readonly action: string;
  /** Resource pattern the action applies to. */
  readonly resource: string;
  /** Effect when the rule is the last match. */
  readonly effect: PermissionEffect;
}

/** A decision with the rule that produced it. */
export interface PermissionDecision {
  /** Resolved effect. */
  readonly effect: PermissionEffect;
  /** Human-readable reason naming the matching rule. */
  readonly reason: string;
}

/** One action and the resources it touches, all of which must be permitted. */
export interface PermissionRequest {
  /** OpenCode action name. */
  readonly action: string;
  /** Alternative spellings of each resource; any spelling may match a rule. */
  readonly resources: readonly (readonly string[])[];
}

const RANK: Record<PermissionEffect, number> = { allow: 0, ask: 1, deny: 2 };

function expandHome(pattern: string) {
  return pattern === "~" || pattern.startsWith("~/")
    ? `${HOME_DIR}${pattern.slice(1)}`
    : pattern;
}

/** Match a string against an OpenCode wildcard pattern. */
export function wildcardMatch(value: string, pattern: string) {
  const escaped = expandHome(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  const source = escaped.endsWith(" .*")
    ? `${escaped.slice(0, -3)}( .*)?`
    : escaped;

  return new RegExp(`^${source}$`, "s").test(value);
}

/** Find the last rule matching an action and any spelling of a resource. */
function lastMatch(
  rules: readonly PermissionRule[],
  action: string,
  spellings: readonly string[],
) {
  return rules.findLast(
    (rule) =>
      wildcardMatch(action, rule.action) &&
      spellings.some((spelling) => wildcardMatch(spelling, rule.resource)),
  );
}

/**
 * Evaluate requests against the rules. Every resource must match a rule: the
 * most restrictive match wins, and any unmatched resource leaves the decision
 * to the harness unless something else already denies or asks.
 *
 * @returns The decision, or `null` when the rules do not decide.
 */
export function evaluatePermissions(
  rules: readonly PermissionRule[],
  requests: readonly PermissionRequest[],
): PermissionDecision | null {
  let decision: PermissionDecision | null = null;
  let unmatched = false;

  for (const { action, resources } of requests) {
    for (const spellings of resources) {
      const rule = lastMatch(rules, action, spellings);

      if (rule === undefined) {
        unmatched = true;
        continue;
      }

      if (decision === null || RANK[rule.effect] > RANK[decision.effect]) {
        decision = {
          effect: rule.effect,
          reason: `OpenCode rule ${rule.action} ${rule.resource}: ${rule.effect}`,
        };
      }
    }
  }

  if (decision?.effect === "allow" && unmatched) return null;

  return decision;
}

/**
 * Spellings of a file path that OpenCode rules may be written against: the
 * absolute path and, inside the project, the project-relative path.
 */
export function pathSpellings(path: string, cwd: string) {
  const absolute = resolve(cwd, expandHome(path));
  const inside = relative(cwd, absolute);

  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside)
    ? [absolute, inside]
    : [absolute];
}

/** Whether a path lies outside the project directory. */
export function isExternalPath(path: string, cwd: string) {
  const inside = relative(cwd, resolve(cwd, expandHome(path)));

  return inside.startsWith("..") || isAbsolute(inside);
}

const SEPARATORS = ["&&", "||", ";", "|", "&", "\n"];

/**
 * Split a shell command line into simple commands the way OpenCode checks
 * them: on unquoted `&&`, `||`, `;`, `|`, `&` and newlines, with command
 * substitutions checked as commands of their own and leading variable
 * assignments removed.
 */
export function splitShellCommands(input: string): string[] {
  const commands: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  const flush = () => {
    const command = current
      .trim()
      .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)+/, "")
      .trim();

    if (command !== "") commands.push(command);
    current = "";
  };

  for (let index = 0; index < input.length; index++) {
    const char = input[index] ?? "";

    if (char === "\\" && quote !== "'") {
      current += char + (input[index + 1] ?? "");
      index++;
      continue;
    }

    if (quote !== null) {
      if (char === quote) quote = null;
      else if (quote === '"' && input.startsWith("$(", index)) {
        const end = closingParen(input, index + 2);

        commands.push(...splitShellCommands(input.slice(index + 2, end)));
      }

      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (input.startsWith("$(", index) || char === "`") {
      const end =
        char === "`"
          ? input.indexOf("`", index + 1)
          : closingParen(input, index + 2);

      const stop = end === -1 ? input.length : end;

      commands.push(
        ...splitShellCommands(
          input.slice(index + (char === "`" ? 1 : 2), stop),
        ),
      );
      current += input.slice(index, stop + 1);
      index = stop;
      continue;
    }

    const separator = SEPARATORS.find((token) =>
      input.startsWith(token, index),
    );

    // `>&` and `&>` are redirections, not background separators.
    const redirect =
      separator === "&" &&
      (input[index - 1] === ">" || input[index + 1] === ">");

    if (separator !== undefined && !redirect) {
      flush();
      index += separator.length - 1;
      continue;
    }

    current += char;
  }

  flush();

  return commands;
}

function closingParen(input: string, start: number) {
  let depth = 1;

  for (let index = start; index < input.length; index++) {
    if (input[index] === "(") depth++;

    if (input[index] === ")" && --depth === 0) return index;
  }

  return input.length;
}
