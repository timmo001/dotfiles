import { Effect } from "effect";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";

/**
 * Run OpenCode debug subcommands and display their output.
 *
 * Sequentially runs `opencode debug paths`, `config`, `skill`, `info`,
 * and optionally `opencode debug agent <name>` if `--agent` is specified.
 */
export const opencodeDebug = (opts?: { readonly agent?: string }) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    const launcher = yield* Launcher;

    yield* log.section("OpenCode Debug");

    // Verify opencode is available
    const whichExit = yield* launcher.stream("which opencode");
    if (whichExit !== 0) {
      yield* log.error("OpenCode command not found in PATH");
      return;
    }

    const commands = [
      "opencode debug paths",
      "opencode debug config",
      "opencode debug skill",
      "opencode debug info",
    ];

    for (const cmd of commands) {
      yield* log.info(`Running: ${cmd}`);
      yield* launcher.suspend(cmd, { waitForKey: false });
    }

    if (opts?.agent) {
      const agentCmd = `opencode debug agent ${opts.agent}`;
      yield* log.info(`Running: ${agentCmd}`);
      yield* launcher.suspend(agentCmd, { waitForKey: false });
    } else {
      yield* log.info("Tip: add --agent <name> to inspect a configured agent");
    }
  });
