import { Effect } from "effect";
import {
  ProcessRunner,
  type ProcessRunOptions,
} from "../services/ProcessRunner.js";

/** Run an external command without changing its arguments or standard streams. */
export const runCommand = Effect.fn("Run.command")(function* (
  command: string,
  args: readonly string[],
  options: ProcessRunOptions,
) {
  const runner = yield* ProcessRunner;
  process.exitCode = yield* runner.run(command, args, options).pipe(
    Effect.catchTags({
      ProcessRunTimeout: (error) =>
        Effect.sync(() => {
          console.error(
            `dot run: command exceeded ${error.milliseconds / 1000}s`,
          );

          return 124;
        }),
      ProcessRunError: (error) =>
        Effect.sync(() => {
          console.error(`dot run: ${error.message}`);

          return 125;
        }),
    }),
  );
});
