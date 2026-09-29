/**
 * @file Opt-in capture of the assembled starter context for token profiling.
 */

import { Plugin } from "@opencode/plugin/effect";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";

let captureDirectory: string | undefined;

const prepareDirectory = Effect.gen(function* () {
  if (captureDirectory) return captureDirectory;
  const fs = yield* FileSystem.FileSystem;
  const parent = process.env.DOT_CONTEXT_CAPTURE_DIR || join(tmpdir(), "opencode");
  yield* fs.makeDirectory(parent, { recursive: true, mode: 0o700 });

  const directory = yield* fs.makeTempDirectory({
    directory: parent,
    prefix: "context-baseline-",
  });

  yield* fs.makeDirectory(join(directory, "system"), { mode: 0o700 });
  yield* fs.makeDirectory(join(directory, "tools"), { mode: 0o700 });
  captureDirectory = directory;

  return directory;
});

const slug = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);

export default Plugin.define({
  id: "context-capture",
  effect: (context) =>
    Effect.gen(function* () {
      if (process.env.DOT_CONTEXT_CAPTURE !== "1") return;
      yield* context.session.hook("context", (event) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* prepareDirectory;
          const segments = event.system.map((part) => part.text);
          const index: { segment: number; chars: number; file: string }[] = [];

          for (const [i, segment] of segments.entries()) {
            const file = join("system", `${String(i).padStart(3, "0")}.txt`);
            yield* fs.writeFileString(join(directory, file), segment, { mode: 0o600 });
            index.push({ segment: i, chars: segment.length, file });
          }

          yield* fs.writeFileString(
            join(directory, "system-index.json"),
            JSON.stringify(index, null, 2),
            { mode: 0o600 },
          );

          for (const [toolID, tool] of Object.entries(event.tools)) {
            const input = JSON.stringify(tool.input ?? {});

            yield* fs.writeFileString(
              join(directory, "tools.jsonl"),
              `${JSON.stringify({ toolID, descriptionChars: tool.description.length, parametersChars: input.length, totalChars: tool.description.length + input.length })}\n`,
              { flag: "a", mode: 0o600 },
            );

            yield* fs.writeFileString(
              join(directory, "tools", `${slug(toolID)}.json`),
              JSON.stringify({ description: tool.description, parameters: tool.input }, null, 2),
              { mode: 0o600 },
            );
          }
        }).pipe(Effect.orDie, Effect.provide(NodeFileSystem.layer)),
      );
    }),
});
