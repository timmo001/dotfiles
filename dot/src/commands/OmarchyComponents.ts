import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { displayPath } from "../lib/paths.js";
import { Config } from "../services/Config.js";
import { managedGitRepos } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";

/** Domain error raised when shared Omarchy components cannot be synced. */
export class OmarchyComponentsError extends Schema.TaggedError<OmarchyComponentsError>()(
  "OmarchyComponentsError",
  { message: Schema.String },
) {}

/**
 * Copy the shared Omarchy panel components from the public dotfiles source
 * into each repository whose private dot-git.yml entry sets
 * `omarchy_components`. With `check`, report drift without writing and fail
 * when any is found.
 */
export const syncOmarchyComponents = Effect.fn("syncOmarchyComponents")(
  function* (options: { readonly check: boolean }) {
    const fs = yield* FileSystem.FileSystem;
    const output = yield* OutputLog;
    const { gitConfig, publicDotfiles } = yield* Config;

    if (!gitConfig.valid) {
      return yield* new OmarchyComponentsError({
        message: `Invalid private git config ${displayPath(gitConfig.filePath)}: ${gitConfig.diagnostics.join("; ")}`,
      });
    }

    const source = join(
      process.env.DOTFILES_REPO ?? publicDotfiles,
      "omarchy",
      ".config",
      "omarchy",
      "components",
    );

    const targets = managedGitRepos(gitConfig).flatMap((repo) =>
      repo.omarchyComponents
        ? [
            {
              directory: join(repo.path, repo.omarchyComponents.directory),
              components: repo.omarchyComponents.components,
            },
          ]
        : [],
    );

    if (targets.length === 0) {
      yield* output.info(
        `No repositories set omarchy_components in ${displayPath(gitConfig.filePath)}`,
      );

      return;
    }

    const drifted: string[] = [];

    for (const target of targets) {
      if (!(yield* fs.exists(target.directory))) {
        yield* output.warn(
          `Target not found: ${displayPath(target.directory)}`,
        );
        continue;
      }

      for (const component of target.components) {
        const sourceFile = join(source, `${component}.qml`);

        if (!(yield* fs.exists(sourceFile))) {
          return yield* new OmarchyComponentsError({
            message: `Shared component not found: ${displayPath(sourceFile)}`,
          });
        }

        const targetFile = join(target.directory, `${component}.qml`);
        const contents = yield* fs.readFileString(sourceFile);

        const current = (yield* fs.exists(targetFile))
          ? yield* fs.readFileString(targetFile)
          : undefined;

        if (current === contents) continue;

        drifted.push(displayPath(targetFile));

        if (options.check) {
          yield* output.warn(`Out of date: ${displayPath(targetFile)}`);
        } else {
          yield* fs.writeFileString(targetFile, contents);
          yield* output.success(
            `${current === undefined ? "Added" : "Updated"} ${displayPath(targetFile)}`,
          );
        }
      }
    }

    if (drifted.length === 0) {
      yield* output.info("Shared components are up to date");
    } else if (options.check) {
      yield* output.error(
        `${drifted.length} component copies are out of date; run dot omarchy plugin sync components`,
      );
      process.exitCode = 1;
    }
  },
);
