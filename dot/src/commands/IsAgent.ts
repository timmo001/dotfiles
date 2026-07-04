import { Effect } from "effect";
import { hasOption } from "../lib/args.js";
import { detectAgent } from "../lib/agent.js";

/**
 * Print AI agent detection and exit 0 when an agent is detected, 1 otherwise,
 * so shell callers can branch with `if dot is-agent; then ...`.
 */
export function isAgentCommand(args: readonly string[] = []) {
  return Effect.promise(async () => {
    const detection = detectAgent();
    if (hasOption(args, "--json")) {
      process.stdout.write(`${JSON.stringify(detection)}\n`);
    } else if (hasOption(args, "--quiet") || hasOption(args, "-q")) {
      if (detection.id) process.stdout.write(`${detection.id}\n`);
    } else if (detection.isAgent) {
      process.stdout.write(
        `Detected agent: ${detection.name} (${detection.id})\n`,
      );
    } else {
      process.stdout.write("No AI agent detected\n");
    }
    process.exit(detection.isAgent ? 0 : 1);
  });
}
