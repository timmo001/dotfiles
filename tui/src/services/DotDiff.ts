import { Context, Effect, Layer, Schema } from "effect";
import type { Repo } from "../types.js";

const log = (msg: string) => console.error(`[dot-tui:DotDiff] ${msg}`);

/** Domain error for `dot diff` command failures */
export class DotDiffError extends Schema.TaggedErrorClass<DotDiffError>()(
  "DotDiffError",
  {
    message: Schema.String,
  },
) {}

/** Service interface for running `dot diff` shell commands */
interface DotDiffService {
  /** List repositories that have uncommitted or unpushed changes */
  readonly listChanged: () => Effect.Effect<readonly Repo[], DotDiffError>;
  /** List all tracked repositories */
  readonly listAll: () => Effect.Effect<readonly Repo[], DotDiffError>;
}

/** Effect service for {@link DotDiffService} */
export class DotDiff extends Context.Service<DotDiff, DotDiffService>()(
  "DotDiff",
) {
  static readonly layer = Layer.succeed(DotDiff, {
    listChanged: () => runDotDiff(["--list-changed"]),
    listAll: () => runDotDiff(["--list-all"]),
  });
}

function parseDotDiffOutput(output: string): readonly Repo[] {
  return output
    .trim()
    .split("\n")
    .filter((line) => line.includes("|"))
    .map((line) => {
      const [name, path] = line.split("|", 2);
      return { name: name.trim(), path: path.trim(), locked: false };
    });
}

/** Run a `dot diff` subcommand and parse the output into repositories */
const runDotDiff = Effect.fn("DotDiff.runDotDiff")(function* (
  args: string[],
): Effect.fn.Return<readonly Repo[], DotDiffError> {
  return yield* Effect.tryPromise({
    try: async () => {
      log(`Running: dot diff ${args.join(" ")}`);
      const proc = Bun.spawn(["dot", "diff", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: process.env.PATH },
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        const msg = `dot diff ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`;
        log(msg);
        throw new Error(msg);
      }

      const repos = parseDotDiffOutput(stdout);
      log(`dot diff ${args.join(" ")}: ${repos.length} repos`);
      return repos;
    },
    catch: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      log(`Error: ${msg}`);
      return new DotDiffError({ message: msg });
    },
  });
});
