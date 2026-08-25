import { Plugin } from "@opencode-ai/plugin/effect";
import { Tool } from "@opencode-ai/schema/tool";
import { Effect } from "effect";
import {
  argRecord,
  commandMentionsPath,
  expandHome,
  stringArg,
  targetIsInsideDirectory,
} from "../lib/guard-paths";

const PATH_ARG_TOOLS = new Set(["read", "write", "edit", "grep", "glob", "list"]);

const resolveNotesVaultPath = Effect.promise(async () => {
  try {
    const proc = Bun.spawn(["notes", "root", "--repo-notes"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode === 0 && stdout.trim()) return stdout.trim();
  } catch {}
  const root = process.env.NOTES || process.env.DOT_NOTES_DIR || `${process.env.HOME ?? "~"}/Documents/notes`;
  return `${root}/repo-notes`;
});

export default Plugin.define({
  id: "notes-guard",
  effect: (context) =>
    Effect.gen(function* () {
      const vaultPath = yield* resolveNotesVaultPath;
      const expandedVaultPath = expandHome(vaultPath);
      const message = (tool: string) =>
        `Direct '${tool}' access to the notes vault is blocked.\n` +
        `The vault at ${expandedVaultPath} is exclusively managed by the notes MCP tools.`;
      yield* context.tool.hook("execute.before", (event) => {
        const args = argRecord(event.input);
        const pathBlocked =
          PATH_ARG_TOOLS.has(event.tool) &&
          [args.filePath, args.path, args.pattern].some((value) =>
            targetIsInsideDirectory(expandedVaultPath, stringArg(value)),
          );
        const command = stringArg(args.command);
        const shellBlocked =
          (event.tool === "shell" || event.tool === "bash") &&
          (commandMentionsPath(command, expandedVaultPath) || commandMentionsPath(command, vaultPath));
        return pathBlocked || shellBlocked
          ? Effect.fail(new Tool.Error({ message: message(event.tool) }))
          : Effect.void;
      });
    }),
});
