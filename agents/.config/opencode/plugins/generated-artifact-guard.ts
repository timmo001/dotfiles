/**
 * @file Blocks direct mutation of generated dotfiles artefacts.
 *
 * The guard remains inactive outside this repository's generator layout and
 * directs edits back to each artefact's canonical generation command.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  generatedArtifactForPath,
  generatedArtifactFromPatch,
  generatedArtifactFromShell,
} from "../lib/generated-artifacts";
import { argRecord, stringArg } from "../lib/guard-paths";

async function findDotfilesRoot(directory: string): Promise<string | null> {
  let current = resolve(directory);
  while (true) {
    try {
      await Promise.all([
        access(resolve(current, "dot/src/cli/spec.ts")),
        access(resolve(current, "docs/scripts/generate-opencode-reference.ts")),
      ]);
      return current;
    } catch {}

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function guardError(path: string, command: string): Error {
  return new Error(
    `Direct mutation of generated artefact '${path}' is blocked.\n` +
      `Regenerate it with: ${command}\n` +
      "Edit the canonical source instead.",
  );
}

export const GeneratedArtifactGuard = (async ({ directory }) => {
  const baseDirectory = resolve(directory || process.cwd());
  const root = await findDotfilesRoot(baseDirectory);
  if (!root) return {};

  return {
    "tool.execute.before": async (input, output) => {
      const args = argRecord(output.args);
      const workdirArg = stringArg(args.workdir);
      const workdir = workdirArg
        ? isAbsolute(workdirArg)
          ? workdirArg
          : resolve(baseDirectory, workdirArg)
        : baseDirectory;

      const artifact =
        input.tool === "write" || input.tool === "edit"
          ? generatedArtifactForPath(root, stringArg(args.filePath), workdir)
          : input.tool === "apply_patch"
            ? generatedArtifactFromPatch(
                root,
                stringArg(args.patchText),
                workdir,
              )
            : input.tool === "bash"
              ? generatedArtifactFromShell(
                  root,
                  stringArg(args.command),
                  workdir,
                )
              : undefined;

      if (artifact) throw guardError(artifact.path, artifact.command);
    },
  };
}) satisfies Plugin;

export default GeneratedArtifactGuard;
