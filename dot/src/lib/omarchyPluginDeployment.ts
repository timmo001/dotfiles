import { Effect } from "effect";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "fs";
import { basename, dirname, join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { LauncherError } from "../services/Launcher.js";

/** Discover real plugin submodule directories in the Omarchy stow package. */
export function omarchyPluginSubmodules(repo: string): string[] {
  const directory = join(repo, "omarchy/.config/omarchy/plugins");

  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name) &&
        !entry.name.includes(".."),
    )
    .map((entry) => join(directory, entry.name))
    .filter((source) =>
      lstatSync(join(source, ".git"), { throwIfNoEntry: false })?.isFile(),
    );
}

function sameFiles(source: string, target: string): boolean {
  const expected = lstatSync(source);
  const actual = lstatSync(target, { throwIfNoEntry: false });

  if (!actual || expected.isSymbolicLink() || actual.isSymbolicLink())
    return false;

  if (expected.isDirectory() && actual.isDirectory()) {
    const names = readdirSync(source)
      .filter((name) => name !== ".git")
      .sort();

    const targets = readdirSync(target).sort();

    return (
      names.length === targets.length &&
      names.every(
        (name, index) =>
          name === targets[index] &&
          sameFiles(join(source, name), join(target, name)),
      )
    );
  }

  return (
    expected.isFile() &&
    actual.isFile() &&
    (expected.mode & 0o777) === (actual.mode & 0o777) &&
    readFileSync(source).equals(readFileSync(target))
  );
}

/** Copy and validate a plugin before replacing its live files, retaining a backup. */
export const deployOmarchyPlugin = Effect.fn("deployOmarchyPlugin")(function* (
  source: string,
  target: string,
  repo: string,
) {
  const executor = yield* CommandExecutor;

  const filesystem = <T>(action: () => T) =>
    Effect.try({
      try: action,
      catch: (error) =>
        new LauncherError({
          message: `Could not deploy ${basename(source)}: ${String(error)}`,
          exitCode: 1,
        }),
    });

  // Validate even unchanged sources, and never copy development symlinks.
  yield* executor.run("omarchy-plugin-validate", [source]);

  if (yield* filesystem(() => sameFiles(source, target))) return null;

  const stage = yield* Effect.acquireRelease(
    filesystem(() => {
      mkdirSync(dirname(target), { recursive: true });

      return mkdtempSync(join(dirname(target), ".dot-plugin-"));
    }),
    (directory) =>
      Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );

  yield* filesystem(() =>
    cpSync(source, stage, {
      recursive: true,
      dereference: false,
      filter: (file) => file !== join(source, ".git"),
    }),
  );
  yield* executor.run("omarchy-plugin-validate", [stage]);

  return yield* filesystem(() => {
    let backup: string | null = null;

    if (lstatSync(target, { throwIfNoEntry: false })) {
      const backups = join(repo, "backup/omarchy-plugins");
      mkdirSync(backups, { recursive: true });
      backup = join(
        mkdtempSync(join(backups, `${basename(source)}-`)),
        "plugin",
      );
      renameSync(target, backup);
    }

    try {
      renameSync(stage, target);
    } catch (error) {
      if (backup) renameSync(backup, target);
      throw error;
    }

    return { target, backup };
  });
}, Effect.scoped);
