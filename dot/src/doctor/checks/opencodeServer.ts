import { Effect } from "effect";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { hyprRepoPath } from "../../lib/omarchyHost.js";
import { CONFIG_DIR, displayPath } from "../../lib/paths.js";
import { Config, type ConfigService } from "../../services/Config.js";
import type { CheckResult } from "../types.js";

const DESKTOP_HOST = "desktop";
const OPENCODE_SERVER_COMMAND = "opencode-server";
const OPENCODE_ENV_PATH = join(CONFIG_DIR, "opencode", ".env");

interface HostAutostart {
  readonly host: string;
  readonly path: string;
  readonly startsServer: boolean;
}

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

function passwordStatus(): PasswordStatus {
  if (!existsSync(OPENCODE_ENV_PATH)) return "missing-file";

  const content = readFileSync(OPENCODE_ENV_PATH, "utf8");
  const passwordLine = content
    .split("\n")
    .map((line) =>
      line.match(/^\s*(?:export\s+)?OPENCODE_SERVER_PASSWORD\s*=\s*(.*)$/),
    )
    .find((match): match is RegExpMatchArray => match !== null);

  if (!passwordLine) return "missing-key";
  return unquoteValue(passwordLine[1] ?? "") ? "set" : "empty";
}

function passwordResult(): CheckResult {
  switch (passwordStatus()) {
    case "set":
      return {
        severity: "ok",
        message: `OpenCode server password is configured in ${displayPath(OPENCODE_ENV_PATH)}`,
      };
    case "missing-file":
      return {
        severity: "warn",
        message: `OpenCode server password file missing: ${displayPath(OPENCODE_ENV_PATH)}`,
        detail: "Create it with mode 600 and set OPENCODE_SERVER_PASSWORD",
      };
    case "missing-key":
      return {
        severity: "warn",
        message: `OPENCODE_SERVER_PASSWORD is not set in ${displayPath(OPENCODE_ENV_PATH)}`,
      };
    case "empty":
      return {
        severity: "warn",
        message: `OPENCODE_SERVER_PASSWORD is empty in ${displayPath(OPENCODE_ENV_PATH)}`,
      };
  }
}

function hostAutostarts(config: ConfigService): HostAutostart[] {
  const hostsDir = join(hyprRepoPath(config), "hosts");
  if (!existsSync(hostsDir)) return [];

  return readdirSync(hostsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(hostsDir, entry.name, "autostart.conf");
      const content = existsSync(path) ? readFileSync(path, "utf8") : "";
      return {
        host: entry.name,
        path,
        startsServer: content
          .split("\n")
          .some((line) => /^\s*exec-once\s*=.*\bopencode-server\b/.test(line)),
      } satisfies HostAutostart;
    });
}

function autostartResults(autostarts: readonly HostAutostart[]): CheckResult[] {
  const desktop = autostarts.find(
    (autostart) => autostart.host === DESKTOP_HOST,
  );
  const serverHosts = autostarts.filter((autostart) => autostart.startsServer);
  const results: CheckResult[] = [];

  if (!desktop) {
    results.push({
      severity: "warn",
      message: "Missing desktop Hypr host autostart config",
    });
  } else if (desktop.startsServer) {
    results.push({
      severity: "ok",
      message: `OpenCode server autostarts on ${DESKTOP_HOST}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `OpenCode server does not autostart on ${DESKTOP_HOST}`,
      detail: `Expected ${displayPath(desktop.path)} to start ${OPENCODE_SERVER_COMMAND}`,
    });
  }

  for (const autostart of serverHosts) {
    if (autostart.host === DESKTOP_HOST) continue;
    results.push({
      severity: "warn",
      message: `OpenCode server should not autostart on ${autostart.host}`,
      detail: `Remove ${OPENCODE_SERVER_COMMAND} from ${displayPath(autostart.path)}`,
    });
  }

  if (serverHosts.length > 0) {
    results.push(passwordResult());
  }

  return results;
}

/** Check OpenCode server autostart hosts and password configuration. */
export const checkOpencodeServer = Effect.gen(function* () {
  const config = yield* Config;
  return autostartResults(hostAutostarts(config));
});
