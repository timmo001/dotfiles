import { Repository } from "@timmo001/effect-gh";
import { Effect } from "effect";
import { join } from "path";
import { HOME_DIR } from "../lib/paths.js";
import { skillsAuthoringSource } from "../lib/skillsMaintenance.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Forward parsed facade arguments to the installed skill-maintenance executable. */
export const runSkillsMaintenance = Effect.fn("Skills.run")(function* (
  args: readonly string[],
  setExitCode: (exitCode: number) => void = (exitCode) => {
    process.exitCode = exitCode;
  },
) {
  const executor = yield* CommandExecutor;
  const executable = join(HOME_DIR, ".local", "bin", "skill-maintenance");

  const exitCode = yield* executor.inherit(executable, args, {
    cwd: yield* skillsAuthoringSource(),
  });

  if (exitCode !== 0) {
    setExitCode(exitCode);
  }
});

/**
 * Edit a consumer repository's shared skills, defaulting to the GitHub
 * repository of the caller's directory, since skill-maintenance runs from the
 * skills checkout.
 */
export const editSkillConsumer = Effect.fn("Skills.editConsumer")(function* (
  action: "add" | "remove",
  repo: string | undefined,
  args: readonly string[],
) {
  const repository = repo ?? (yield* Repository.view()).nameWithOwner;

  yield* runSkillsMaintenance([
    "consumers",
    action,
    "--repo",
    repository,
    ...args,
  ]);
});
