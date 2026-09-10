import { Effect } from "effect";
import { join } from "node:path";
import { HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** One installed target shared by the Git panel and terminal release recovery. */
export interface HerdrAgentTarget {
  /** Picker identity. */
  readonly command: string;
  /** Friendly picker label. */
  readonly label: string;
  /** Command launched in the repository workspace. */
  readonly executable: string;
  /** Herdr integration expected before sending the prompt. */
  readonly kind: string;
}

/** Discover the same installed integrations, in the same order, for both pickers. */
export const installedHerdrAgents = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const status = yield* executor.run("herdr", ["integration", "status"]);
  const available = new Set(
    status.split("\n").flatMap((line) => {
      const match = /^(\S+): (current|outdated)\b/.exec(line);
      return match ? [match[1]] : [];
    }),
  );
  const targets: HerdrAgentTarget[] = [];
  const opencode2 = join(HOME_DIR, ".local", "bin", "opencode2");
  if (
    available.has("opencode") &&
    (yield* executor.exitCode("test", ["-x", opencode2])) === 0
  )
    targets.push({
      command: "opencode2",
      label: "OpenCode 2",
      executable: opencode2,
      kind: "opencode",
    });
  const labels = [
    ["opencode", "OpenCode 1"],
    ["pi", "Pi"],
    ["cursor", "Cursor Agent"],
    ["claude", "Claude Code"],
    ["codex", "Codex"],
    ["copilot", "GitHub Copilot"],
    ["omp", "OMP"],
    ["devin", "Devin"],
    ["droid", "Droid"],
    ["kimi", "Kimi"],
    ["kilo", "Kilo"],
    ["hermes", "Hermes"],
    ["qodercli", "Qoder CLI"],
    ["qwen", "Qwen"],
    ["mastracode", "Mastra Code"],
    ["antigravity-cli", "Antigravity CLI"],
    ["grok", "Grok"],
  ];
  for (const [command, label] of labels)
    if (available.has(command))
      targets.push({
        command,
        label,
        executable: command === "cursor" ? "cursor-agent" : command,
        kind: command,
      });
  return targets;
}).pipe(Effect.withSpan("herdr.installedAgents"));
