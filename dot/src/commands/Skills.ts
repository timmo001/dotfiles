import { Effect } from "effect";
import { join } from "path";
import { HOME_DIR } from "../lib/paths.js";
import { skillsMaintenanceSource } from "../lib/skillsMaintenance.js";
import { LauncherError } from "../services/Launcher.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

/** Forward parsed facade arguments to the installed skill-maintenance executable. */
export const runSkillsMaintenance = Effect.fn("Skills.run")(function* (
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;
  const config = yield* Config;
  const executable = join(HOME_DIR, ".local", "bin", "skill-maintenance");
  const exitCode = yield* executor.inherit(executable, args, {
    cwd: skillsMaintenanceSource(config.publicDotfiles),
  });
  if (exitCode !== 0) {
    return yield* new LauncherError({
      message: `skill-maintenance exited ${exitCode}`,
      exitCode,
    });
  }
});
