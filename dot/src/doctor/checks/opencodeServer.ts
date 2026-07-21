import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { hyprRepoPath } from "../../lib/omarchyHost.js";
import { CONFIG_DIR, displayPath } from "../../lib/paths.js";
import { Config } from "../../services/Config.js";
import type { CheckResult } from "../types.js";

const OPENCODE_SERVER_COMMAND = "opencode-server";
const OPENCODE_ENV_PATH = join(CONFIG_DIR, "opencode", ".env");

type PasswordStatus = "missing-file" | "missing-key" | "empty" | "set";

function unquoteValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? trimmed.slice(1, -1).trim()
    : trimmed.replace(/\s+#.*$/, "").trim();
}

function passwordStatus(envPath: string): PasswordStatus {
  if (!existsSync(envPath)) return "missing-file";

  const content = readFileSync(envPath, "utf8");
  const passwordLine = content
    .split("\n")
    .map((line) =>
      line.match(/^\s*(?:export\s+)?OPENCODE_SERVER_PASSWORD\s*=\s*(.*)$/),
    )
    .find((match): match is RegExpMatchArray => match !== null);

  if (!passwordLine) return "missing-key";
  return unquoteValue(passwordLine[1] ?? "") ? "set" : "empty";
}

function passwordResult(envPath: string): CheckResult {
  switch (passwordStatus(envPath)) {
    case "set":
      return {
        severity: "ok",
        message: `OpenCode server password is configured in ${displayPath(envPath)}`,
      };
    case "missing-file":
      return {
        severity: "warn",
        message: `OpenCode server password file missing: ${displayPath(envPath)}`,
        detail: "Create it with mode 600 and set OPENCODE_SERVER_PASSWORD",
      };
    case "missing-key":
      return {
        severity: "warn",
        message: `OPENCODE_SERVER_PASSWORD is not set in ${displayPath(envPath)}`,
      };
    case "empty":
      return {
        severity: "warn",
        message: `OPENCODE_SERVER_PASSWORD is empty in ${displayPath(envPath)}`,
      };
  }
}

/** Check shared Hypr autostart and local OpenCode server password configuration. */
export function opencodeServerResults(
  autostartPath: string,
  envPath: string,
): CheckResult[] {
  const startsServer =
    existsSync(autostartPath) &&
    readFileSync(autostartPath, "utf8")
      .split("\n")
      .some((line) => /^\s*exec-once\s*=.*\bopencode-server\b/.test(line));

  if (startsServer) {
    return [
      {
        severity: "ok",
        message: "OpenCode server autostarts on all Hypr hosts",
      },
      passwordResult(envPath),
    ];
  }

  return [
    {
      severity: "warn",
      message: "OpenCode server does not autostart on all Hypr hosts",
      detail: `Expected ${displayPath(autostartPath)} to start ${OPENCODE_SERVER_COMMAND}`,
    },
  ];
}

/** Check shared OpenCode server autostart and password configuration. */
export const checkOpencodeServer = Effect.gen(function* () {
  const config = yield* Config;
  return opencodeServerResults(
    join(hyprRepoPath(config), "autostart.conf"),
    OPENCODE_ENV_PATH,
  );
});
