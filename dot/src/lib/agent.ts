import { readFileSync } from "node:fs";
import { ENV, type EnvName, envString } from "./env.js";

/** Result of AI coding agent detection. */
export interface AgentDetection {
  /** Whether dot is running under an AI coding agent. */
  readonly isAgent: boolean;
  /** Stable provider id (e.g. `opencode`), or null when no agent is detected. */
  readonly id: string | null;
  /** Human-readable provider name, or null when no agent is detected. */
  readonly name: string | null;
}

/** An AI coding agent identified by its environment or ancestor process. */
interface AgentProvider {
  /** Stable provider id. */
  readonly id: string;
  /** Human-readable provider name. */
  readonly name: string;
  /** Environment variables that indicate this agent (matched as any-of). */
  readonly env: readonly EnvName[];
  /** Ancestor process names that indicate this agent (matched as substrings). */
  readonly processNames: readonly string[];
}

/**
 * Agent-class providers keyed on the environment variables they inject and the
 * process names they run under. Mirrors the `type: "agent"` providers in
 * `am-i-vibing`; only direct-agent tools are listed, so interactive editors do
 * not trip detection.
 */
const PROVIDERS: readonly AgentProvider[] = [
  {
    id: "opencode",
    name: "OpenCode",
    env: [
      ENV.OPENCODE,
      ENV.OPENCODE_BIN_PATH,
      ENV.OPENCODE_SERVER,
      ENV.OPENCODE_APP_INFO,
      ENV.OPENCODE_MODES,
    ],
    processNames: ["opencode"],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    env: [ENV.CLAUDECODE],
    processNames: ["claude"],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    env: [ENV.CODEX_THREAD_ID],
    processNames: ["codex"],
  },
];

const NO_AGENT: AgentDetection = { isAgent: false, id: null, name: null };

/** Maximum ancestor hops to walk when checking the process tree. */
const MAX_ANCESTRY_HOPS = 24;

/** Whether an environment variable is set to a non-empty value. */
function envSet(name: EnvName): boolean {
  const value = envString(name);
  return value !== undefined && value !== "";
}

/** Return the first provider whose environment variables are present. */
function matchProviderEnv(): AgentDetection | undefined {
  for (const provider of PROVIDERS) {
    if (provider.env.some(envSet)) {
      return { isAgent: true, id: provider.id, name: provider.name };
    }
  }
  return undefined;
}

/** Parent pid and process name for a pid, read from Linux `/proc`. */
interface ProcInfo {
  /** Parent process id. */
  readonly ppid: number;
  /** Process name (`comm`), truncated to 15 characters by the kernel. */
  readonly comm: string;
}

/**
 * Read a process's parent pid and name from `/proc/<pid>/stat`. Returns
 * undefined when the file is unreadable, including on non-Linux hosts.
 */
function readProc(pid: number): ProcInfo | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commEnd = stat.lastIndexOf(")");
    const commStart = stat.indexOf("(");
    if (commStart === -1 || commEnd === -1) return undefined;
    const comm = stat.slice(commStart + 1, commEnd);
    const ppid = Number.parseInt(
      stat.slice(commEnd + 2).split(" ")[1] ?? "",
      10,
    );
    return Number.isFinite(ppid) ? { ppid, comm } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk the process tree from the current process, matching ancestor names
 * against provider `processNames`. This is the reliable signal for agents (such
 * as OpenCode) that inject no environment variable into spawned shells.
 */
function matchProcessAncestry(): AgentDetection | undefined {
  let pid = process.pid;
  for (let hop = 0; hop < MAX_ANCESTRY_HOPS; hop++) {
    const info = readProc(pid);
    if (!info) return undefined;
    const comm = info.comm.toLowerCase();
    for (const provider of PROVIDERS) {
      if (provider.processNames.some((name) => comm.includes(name))) {
        return { isAgent: true, id: provider.id, name: provider.name };
      }
    }
    if (info.ppid <= 1) return undefined;
    pid = info.ppid;
  }
  return undefined;
}

/**
 * Detect whether dot is running under an AI coding agent.
 *
 * Honours the `DOT_AGENT` override first (`1` forces agent, `0` forces human),
 * then checks agent-class provider environment variables, then falls back to a
 * Linux `/proc` process-ancestry walk. The ancestry walk reads `/proc` directly
 * rather than spawning a subprocess, so it stays cheap on the Linux hosts dot
 * targets.
 */
export function detectAgent(): AgentDetection {
  const override = envString(ENV.DOT_AGENT);
  if (override === "0") return NO_AGENT;
  const matched = matchProviderEnv() ?? matchProcessAncestry();
  if (override === "1") {
    return matched ?? { isAgent: true, id: "unknown", name: "AI agent" };
  }
  return matched ?? NO_AGENT;
}

/** Whether dot is running under an AI coding agent. */
export function isAgent(): boolean {
  return detectAgent().isAgent;
}
