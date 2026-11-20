/**
 * @file `dot secrets push`: write another machine's secret files from this
 * desktop, where 1Password unlocks through its app. The target reads its own
 * descriptors from `~/.config/dot/secret-files.d/`, so it gets exactly its
 * host's files, and never signs in to 1Password itself. Each file it gets is
 * recorded in its own state with the same hash `dot stow` uses, so its stow
 * treats the file as current and doesn't try `op` itself.
 */

import { join, posix } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { cliStyler } from "../lib/ansi.js";
import { plural } from "../lib/runSummary.js";
import {
  SECRET_FILES_STATE,
  SecretFile,
  WrittenFrom,
  fillIn,
  secretFileHash,
} from "../lib/secretFiles.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";

/** Options for {@link secretsPush}. */
export interface SecretsPushOptions {
  /** The SSH destination, such as `aidan@arch-station.local`. */
  readonly target: string;
  /** Write every file, even ones whose template hasn't changed. */
  readonly force: boolean;
}

/** A push that couldn't read the target, fill in a file or write it. */
export class SecretsPushError extends Schema.TaggedError<SecretsPushError>()(
  "SecretsPushError",
  { message: Schema.String },
) {}

/** Quote a value for the target's POSIX shell. */
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

/** Write the given secret files on the target, and restart their units. */
export const secretsPush = Effect.fn("SecretsPush")(function* (
  options: SecretsPushOptions,
) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;
  const style = cliStyler();
  const { target } = options;

  // Filled-in files are staged here with mode 0600, and scp -p keeps it.
  const staging = yield* fs.makeTempDirectoryScoped({ prefix: "dot-secrets-" });

  // Every step shares one SSH connection: a target that rate-limits SSH, as
  // ufw's limit rule does, refuses a seventh new connection within 30s.
  const sshOptions = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${join(staging, "ssh")}`,
    "-o",
    "ControlPersist=60",
  ];

  yield* Effect.addFinalizer(() =>
    executor
      .exitCode("ssh", [...sshOptions, "-O", "exit", target])
      .pipe(Effect.asVoid),
  );

  const remote = (command: string) =>
    executor.run("ssh", [...sshOptions, target, command]).pipe(
      Effect.mapError(
        (cause) =>
          new SecretsPushError({
            message: `ssh ${target}: ${cause.stderr || `exited ${cause.exitCode}`}`,
          }),
      ),
    );

  const copy = (local: string, remotePath: string) =>
    executor
      .run("scp", ["-p", "-q", ...sshOptions, local, `${target}:${remotePath}`])
      .pipe(
        Effect.mapError(
          (cause) =>
            new SecretsPushError({
              message: `scp to ${target}: ${cause.stderr || `exited ${cause.exitCode}`}`,
            }),
        ),
      );

  yield* log.section(`Secret Files for ${target}`);

  const home = (yield* remote('printf %s "$HOME"')).trim();
  const descriptors = posix.join(home, ".config/dot/secret-files.d");
  const statePath = posix.join(home, ".local/state", SECRET_FILES_STATE);

  const names = (yield* remote(
    `ls -1 ${quote(descriptors)} 2>/dev/null || true`,
  ))
    .split("\n")
    .filter((name) => name.endsWith(".yml"))
    .sort();

  if (names.length === 0) {
    yield* log.info(`${target} has no secret files configured`);

    return;
  }

  const writtenFrom = new Map(
    Object.entries(
      yield* remote(`cat ${quote(statePath)} 2>/dev/null || echo '{}'`).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(WrittenFrom)),
        Effect.orElseSucceed((): Readonly<Record<string, string>> => ({})),
      ),
    ),
  );

  const units = new Set<string>();
  let written = 0;

  for (const name of names) {
    const file: SecretFile = yield* remote(
      `cat ${quote(posix.join(descriptors, name))}`,
    ).pipe(
      Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
      Effect.flatMap(Schema.decodeUnknownEffect(SecretFile)),
      Effect.mapError(
        (cause) =>
          new SecretsPushError({ message: `read ${name}: ${cause.message}` }),
      ),
    );

    const output = file.output.startsWith("~/")
      ? posix.join(home, file.output.slice(2))
      : file.output;

    const hash = secretFileHash(file);

    const present =
      (yield* executor.exitCode("ssh", [
        ...sshOptions,
        target,
        `test -f ${quote(output)}`,
      ])) === 0;

    if (!options.force && present && writtenFrom.get(output) === hash) {
      yield* log.info(style.dim(`${output} is up to date`));
      continue;
    }

    const content = yield* fillIn(file.template, file.account);
    const staged = join(staging, name);
    const remoteStaged = `${output}.dot-push`;

    yield* Effect.sync(() => writeFileAtomic(staged, content, { mode: 0o600 }));
    yield* remote(`mkdir -p ${quote(posix.dirname(output))}`);
    yield* copy(staged, remoteStaged);
    yield* remote(
      `chmod 600 ${quote(remoteStaged)} && mv -f ${quote(remoteStaged)} ${quote(output)}`,
    );

    writtenFrom.set(output, hash);
    written++;

    for (const unit of file.units ?? []) units.add(unit);

    yield* log.success(`Wrote ${style.dim(`${target}:${output}`)}`);
  }

  if (written === 0) {
    yield* log.success("Secret files already up to date");

    return;
  }

  const stagedState = join(staging, "secret-files.json");

  yield* Effect.sync(() =>
    writeFileAtomic(
      stagedState,
      `${JSON.stringify(Object.fromEntries(writtenFrom), null, 2)}\n`,
      {
        mode: 0o600,
      },
    ),
  );
  yield* remote(`mkdir -p ${quote(posix.dirname(statePath))}`);
  yield* copy(stagedState, statePath);

  // As dot stow does: enable each unit unless it already is, restarting it so
  // it reads the file. Units Quadlet generates can't be enabled, but start with
  // their [Install] section, so is-enabled reports them as generated.
  // Queue the starts rather than wait: a unit such as a tunnel can sit in its
  // start step for minutes, waiting for the network or its turn.
  for (const unit of units) {
    yield* remote(
      `(systemctl --user is-enabled --quiet ${quote(unit)} || systemctl --user enable ${quote(unit)}) && systemctl --user restart --no-block ${quote(unit)}`,
    );
    yield* log.success(`Restarted ${style.accent(unit)} on ${target}`);
  }

  yield* log.success(`Wrote ${plural(written, "secret file")} on ${target}`);
}, Effect.scoped);
