/**
 * @file Blocks direct file access to the repository notes vault.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";
import { runText } from "./lib/process";
import {
  argRecord,
  expandHome,
  stringArg,
  targetIsInsideDirectory,
} from "../lib/guard-paths";

const PATH_ARG_TOOLS = new Set(["read", "write", "edit", "grep", "glob", "list"]);

const resolveNotesVaultPath = Effect.gen(function* () {
  const stdout = yield* runText("notes", ["root", "--repo-notes"]).pipe(
    Effect.map((output) => output.trim()),
    Effect.orElseSucceed(() => ""),
  );

  if (stdout) return stdout;

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
        `Use the Notes CLI to access the vault at ${expandedVaultPath}.`;

      yield* context.tool.hook("execute.before", (event) => {
        const args = argRecord(event.input);

        const pathBlocked =
          PATH_ARG_TOOLS.has(event.tool) &&
          [args.filePath, args.path, args.pattern].some((value) =>
            targetIsInsideDirectory(expandedVaultPath, stringArg(value)),
          );

        return pathBlocked
          ? Effect.fail(new Tool.Error({ message: message(event.tool) }))
          : Effect.void;
      });
    }),
});
