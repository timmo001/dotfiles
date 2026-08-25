import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect } from "effect";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let captureDirectory: string | undefined;
const prepareDirectory = () => {
  if (captureDirectory) return captureDirectory;
  const parent = process.env.DOT_CONTEXT_CAPTURE_DIR || join(tmpdir(), "opencode");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  captureDirectory = mkdtempSync(join(parent, "context-baseline-"));
  mkdirSync(join(captureDirectory, "system"), { mode: 0o700 });
  mkdirSync(join(captureDirectory, "tools"), { mode: 0o700 });
  return captureDirectory;
};
const slug = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);

export default Plugin.define({
  id: "context-capture",
  effect: (context) =>
    Effect.gen(function* () {
      if (process.env.DOT_CONTEXT_CAPTURE !== "1") return;
      yield* context.session.hook("context", (event) =>
        Effect.sync(() => {
          const directory = prepareDirectory();
          const segments = event.system.map((part) => part.text);
          const index = segments.map((segment, i) => {
            const file = join("system", `${String(i).padStart(3, "0")}.txt`);
            writeFileSync(join(directory, file), segment, { mode: 0o600 });
            return { segment: i, chars: segment.length, file };
          });
          writeFileSync(join(directory, "system-index.json"), JSON.stringify(index, null, 2), { mode: 0o600 });
          for (const [toolID, tool] of Object.entries(event.tools)) {
            const input = JSON.stringify(tool.input ?? {});
            appendFileSync(
              join(directory, "tools.jsonl"),
              `${JSON.stringify({ toolID, descriptionChars: tool.description.length, parametersChars: input.length, totalChars: tool.description.length + input.length })}\n`,
              { mode: 0o600 },
            );
            writeFileSync(
              join(directory, "tools", `${slug(toolID)}.json`),
              JSON.stringify({ description: tool.description, parameters: tool.input }, null, 2),
              { mode: 0o600 },
            );
          }
        }),
      );
    }),
});
