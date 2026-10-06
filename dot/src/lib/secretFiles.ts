import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";
import { writeFileAtomic } from "./atomicWrite.js";
import { CONFIG_DIR, STATE_DIR, displayPath, expandHomePath } from "./paths.js";
import { plural } from "./runSummary.js";
import { notable, skip, warn } from "./updateSummary.js";
import type { RecapEntry } from "./updateSummary.js";

/** Secret file descriptors, stowed from the private overlay's host packages. */
export const SECRET_FILES_DIR = join(CONFIG_DIR, "dot", "secret-files.d");

/** The template hash each output was last written from, by output path. */
const STATE_PATH = join(STATE_DIR, "dot", "secret-files.json");

/** A file written from a template whose `{{ op://... }}` references 1Password fills in. */
const SecretFile = Schema.Struct({
  /** Where the filled-in file goes, written with mode 0600. */
  output: Schema.String,
  /** The file's content, with secrets as `{{ op://vault/item/field }}`. */
  template: Schema.String,
  /** User units to enable, and restart when the file changes. */
  units: Schema.optionalKey(Schema.Array(Schema.String)),
});

interface SecretFile extends Schema.Schema.Type<typeof SecretFile> {}

const WrittenFrom = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.String),
);

const reference = /\{\{\s*(op:\/\/[^}]+?)\s*\}\}/g;

/** Failure to read a descriptor, fill in its secrets or apply its units. */
class SecretFileError extends Schema.TaggedError<SecretFileError>()(
  "SecretFileError",
  { message: Schema.String },
) {}

const readDescriptors = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(SECRET_FILES_DIR))) return [];

  const names = (yield* fs.readDirectory(SECRET_FILES_DIR))
    .filter((name) => name.endsWith(".yml"))
    .sort();

  return yield* Effect.forEach(names, (name) =>
    fs.readFileString(join(SECRET_FILES_DIR, name)).pipe(
      Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
      Effect.flatMap(Schema.decodeUnknownEffect(SecretFile)),
      Effect.mapError(
        (cause) =>
          new SecretFileError({ message: `read ${name}: ${cause.message}` }),
      ),
    ),
  );
}).pipe(Effect.withSpan("SecretFiles.readDescriptors"));

const readWrittenFrom = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(STATE_PATH))) return {};

  return yield* fs
    .readFileString(STATE_PATH)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(WrittenFrom)));
}).pipe(
  Effect.orElseSucceed((): Readonly<Record<string, string>> => ({})),
  Effect.withSpan("SecretFiles.readWrittenFrom"),
);

/** Replace each secret reference with its value from `op read`. */
const fillIn = Effect.fn("SecretFiles.fillIn")(function* (template: string) {
  const executor = yield* CommandExecutor;
  const values = new Map<string, string>();

  for (const [, ref] of template.matchAll(reference)) {
    if (ref === undefined || values.has(ref)) continue;

    // Keep op on the terminal's session so 1Password authorises it once per
    // run and names the terminal, rather than prompting for every reference.
    const value = yield* executor
      .run("op", ["read", "--no-newline", ref], { sameProcessGroup: true })
      .pipe(
        Effect.mapError(
          (cause) => new SecretFileError({ message: cause.message }),
        ),
      );

    values.set(ref, value);
  }

  return template.replace(reference, (_, ref: string) => values.get(ref) ?? "");
});

const systemctl = Effect.fn("SecretFiles.systemctl")(function* (
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;

  yield* executor
    .run("systemctl", ["--user", ...args])
    .pipe(
      Effect.mapError(
        (cause) => new SecretFileError({ message: cause.message }),
      ),
    );
});

/** Enable the file's units, restarting them so they read a rewritten file. */
const applyUnits = Effect.fn("SecretFiles.applyUnits")(function* (
  file: SecretFile,
  written: boolean,
) {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  for (const unit of file.units ?? []) {
    const enabled =
      (yield* executor.exitCode("systemctl", [
        "--user",
        "is-enabled",
        "--quiet",
        unit,
      ])) === 0;

    if (!enabled) {
      yield* systemctl(["enable", "--now", unit]);
      yield* log.success(`Enabled ${cliStyler().accent(unit)}`);
    } else if (written) {
      yield* systemctl(["restart", unit]);
      yield* log.success(`Restarted ${cliStyler().accent(unit)}`);
    }
  }
});

/**
 * Write the private overlay's secret files and enable the units that read them.
 *
 * Each descriptor in `~/.config/dot/secret-files.d/` holds a template whose
 * `{{ op://... }}` references are filled in with `op read`. A file is only
 * written when it's missing or its template changed since it was last written,
 * so 1Password is asked only then. Its units are enabled, and restarted when
 * the file is rewritten.
 *
 * @returns Recap entries for the stow summary. Failures become a warning so a
 *   locked 1Password or missing `op` never stops the rest of stow.
 */
export const applySecretFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;
  const style = cliStyler();

  const files = yield* readDescriptors;

  if (files.length === 0) return [skip("No secret files configured")];

  yield* log.section("Secret Files");

  const writtenFrom = { ...(yield* readWrittenFrom) };
  let written = 0;

  for (const file of files) {
    const output = expandHomePath(file.output);
    const hash = createHash("sha256").update(file.template).digest("hex");

    const current = writtenFrom[output] === hash && (yield* fs.exists(output));

    if (!current) {
      const content = yield* fillIn(file.template);

      yield* Effect.sync(() =>
        writeFileAtomic(output, content, {
          mode: 0o600,
          createDirectory: true,
        }),
      );

      writtenFrom[output] = hash;
      written++;
      yield* Effect.sync(() =>
        writeFileAtomic(
          STATE_PATH,
          `${JSON.stringify(writtenFrom, null, 2)}\n`,
          { createDirectory: true },
        ),
      );
      yield* log.success(`Wrote ${style.dim(displayPath(output))}`);
    }

    yield* applyUnits(file, !current);
  }

  if (written === 0) {
    yield* log.success("Secret files up to date");

    return [skip("Secret files unchanged")];
  }

  return [notable(`Wrote ${plural(written, "secret file")}`)];
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;

      yield* log.warn(`Secret files not written: ${error.message}`);

      return [warn("Secret files not written")] satisfies RecapEntry[];
    }),
  ),
  Effect.withSpan("SecretFiles.apply"),
);
