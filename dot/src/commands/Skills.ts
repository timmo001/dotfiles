import { Effect } from "effect";
import { join } from "path";
import { HOME_DIR } from "../lib/paths.js";
import { skillsMaintenanceSource } from "../lib/skillsMaintenance.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

/** Forward parsed facade arguments to the installed skill-maintenance executable. */
export const runSkillsMaintenance = Effect.fn("Skills.run")(function* (
  args: readonly string[],
  setExitCode: (exitCode: number) => void = (exitCode) => {
    process.exitCode = exitCode;
  },
) {
  const executor = yield* CommandExecutor;
  const config = yield* Config;
  const executable = join(HOME_DIR, ".local", "bin", "skill-maintenance");
  const exitCode = yield* executor.inherit(executable, args, {
    cwd: skillsMaintenanceSource(config.publicDotfiles),
  });
  if (exitCode !== 0) {
    setExitCode(exitCode);
  }
});
