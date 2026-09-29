/**
 * @file Blocks direct mutation of generated dotfiles artefacts.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  generatedArtifactForPath,
  generatedArtifactFromPatch,
  generatedArtifactFromShell,
} from "../lib/generated-artifacts";
import { argRecord, stringArg } from "../lib/guard-paths";

const findDotfilesRoot = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    let current = resolve(directory);

    for (;;) {
      const found = yield* Effect.all([
        fs.access(resolve(current, "dot/src/cli/spec.ts")),
        fs.access(resolve(current, "docs/scripts/generate-opencode-reference.ts")),
      ]).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );

      if (found) return current;

      const parent = dirname(current);

      if (parent === current) return;
      current = parent;
    }
  });

export default Plugin.define({
  id: "generated-artifact-guard",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.tool.hook("execute.before", (event) =>
        Effect.gen(function* () {
          const session = yield* context.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie);
          const baseDirectory = session.location.directory;
          const root = yield* findDotfilesRoot(baseDirectory);

          if (!root) return;
          const args = argRecord(event.input);
          const workdirArg = stringArg(args.workdir);

          const workdir = workdirArg
            ? isAbsolute(workdirArg)
              ? workdirArg
              : resolve(baseDirectory, workdirArg)
            : baseDirectory;

          const artifact =
            event.tool === "write" || event.tool === "edit"
              ? generatedArtifactForPath(root, stringArg(args.filePath), workdir)
              : event.tool === "patch" || event.tool === "apply_patch"
                ? generatedArtifactFromPatch(root, stringArg(args.patchText), workdir)
                : event.tool === "shell" || event.tool === "bash"
                  ? generatedArtifactFromShell(root, stringArg(args.command), workdir)
                  : undefined;

          if (artifact) {
            return yield* Effect.fail(
              new Tool.Error({
                message:
                  `Direct mutation of generated artefact '${artifact.path}' is blocked.\n` +
                  `Regenerate it with: ${artifact.command}\nEdit the canonical source instead.`,
              }),
            );
          }
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
    }),
});
