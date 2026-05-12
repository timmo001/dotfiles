import { Context, Effect, Layer } from "effect"
import type { Repo } from "../types.js"

const log = (msg: string) => console.error(`[dot-tui:DotDiff] ${msg}`)

/** Service interface for running `dot diff` shell commands */
interface DotDiffService {
  /** List repositories that have uncommitted or unpushed changes */
  readonly listChanged: () => Effect.Effect<readonly Repo[], Error>
  /** List all tracked repositories */
  readonly listAll: () => Effect.Effect<readonly Repo[], Error>
}

/** Effect service tag for {@link DotDiffService} */
export class DotDiff extends Context.Tag("DotDiff")<DotDiff, DotDiffService>() {}

function parseDotDiffOutput(output: string): readonly Repo[] {
  return output
    .trim()
    .split("\n")
    .filter((line) => line.includes("|"))
    .map((line) => {
      const [name, path] = line.split("|", 2)
      return { name: name.trim(), path: path.trim() }
    })
}

function runDotDiff(args: string[]): Effect.Effect<readonly Repo[], Error> {
  return Effect.tryPromise({
    try: async () => {
      log(`Running: dot diff ${args.join(" ")}`)
      const proc = Bun.spawn(["dot", "diff", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: process.env.PATH },
      })

      const stdout = await new Response(proc.stdout).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        const msg = `dot diff ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`
        log(msg)
        throw new Error(msg)
      }

      const repos = parseDotDiffOutput(stdout)
      log(`dot diff ${args.join(" ")}: ${repos.length} repos`)
      return repos
    },
    catch: (error) => {
      const err = error instanceof Error ? error : new Error(String(error))
      log(`Error: ${err.message}`)
      return err
    },
  })
}

/** Live layer that shells out to `dot diff` for repository data */
export const DotDiffLive = Layer.succeed(DotDiff, {
  listChanged: () => runDotDiff(["--list-changed"]),
  listAll: () => runDotDiff(["--list-all"]),
})
