import { basename, dirname, join } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Match, Schema } from "effect";
import { CommandError, CommandExecutor } from "./services/CommandExecutor.js";

// These jobs mirror the clean-checkout lint jobs in .github/workflows/lint.yml.
const Check = Schema.Literals(["actions", "json", "yaml", "markdown", "shell"]);

class SourceCheckError extends Schema.TaggedError<SourceCheckError>()(
  "SourceCheckError",
  { message: Schema.String },
) {}

const checkRepositoryFiles = Effect.gen(function* () {
  const check = yield* Schema.decodeUnknownEffect(Check)(process.argv[2]);
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;

  const root = (yield* executor.run("git", [
    "rev-parse",
    "--show-toplevel",
  ])).trim();

  const temporary = yield* fs.makeTempDirectoryScoped({
    prefix: "dot-source-check-",
  });

  const entries = (yield* executor.run("git", ["ls-files", "--stage", "-z"], {
    cwd: root,
  }))
    .split("\0")
    .filter(Boolean);

  const files: string[] = [];

  for (const entry of entries) {
    const separator = entry.indexOf("\t");
    const metadata = entry.slice(0, separator);
    const file = entry.slice(separator + 1);
    const [mode, , stage] = metadata.split(" ");

    if (separator < 0 || !file || stage !== "0")
      return yield* new SourceCheckError({
        message: "Resolve index conflicts before checking repository files",
      });
    const destination = join(temporary, file);
    yield* fs.makeDirectory(dirname(destination), { recursive: true });

    if (mode === "160000")
      yield* fs.makeDirectory(destination, { recursive: true });
    else if (mode === "120000")
      yield* fs.symlink(yield* fs.readLink(join(root, file)), destination);
    else {
      yield* fs.copyFile(join(root, file), destination);
      yield* fs.chmod(destination, mode === "100755" ? 0o755 : 0o644);
      files.push(file);
    }
  }

  if (check === "json") {
    const json = files.filter((file) => file.endsWith(".json"));
    yield* Effect.forEach(
      json,
      (file) =>
        fs.readFileString(join(temporary, file)).pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json)),
          ),
          Effect.mapError(
            () => new SourceCheckError({ message: `Invalid JSON: ${file}` }),
          ),
        ),
      { concurrency: 8, discard: true },
    );
    yield* Console.log(`Validated ${json.length} tracked JSON files`);

    return;
  }

  const commands = yield* Match.value(check).pipe(
    Match.when("actions", () =>
      Effect.succeed([
        [
          "actionlint",
          ...files.filter((file) =>
            /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file),
          ),
        ],
      ]),
    ),
    Match.when("yaml", () =>
      Effect.succeed([
        [
          "yamllint",
          "--config-file",
          ".yamllint.yml",
          "--format",
          "colored",
          ".",
        ],
      ]),
    ),
    Match.when("markdown", () =>
      Effect.succeed([["bunx", "--bun", "markdownlint-cli2", "**/*.md"]]),
    ),
    Match.when("shell", () =>
      Effect.forEach(
        files.filter((file) => file.startsWith("scripts/.local/bin/")),
        (file) =>
          Effect.gen(function* () {
            const name = basename(file);

            const named =
              /\.(?:bash|ksh|zsh|sh|shlib)$/.test(name) ||
              /^(?:\.?bash(?:rc|_aliases|_completion|_login|_logout|_profile)|suid_profile|\.?z(?:login|logout|profile|senv|shrc)|\.?profile)$/.test(
                name,
              );

            const executable =
              ((yield* fs.stat(join(temporary, file))).mode & 0o111) !== 0;

            let shebang = false;

            if (!named && !name.includes(".") && executable) {
              const buffer = new Uint8Array(256);
              const handle = yield* fs.open(join(temporary, file));
              yield* handle.read(buffer);
              shebang = /^#! *\/[^ ]*\/(env *)?[abk]*sh/.test(
                new TextDecoder().decode(buffer),
              );
            }

            return named || shebang
              ? [["shellcheck", "--severity=warning", "--format=gcc", file]]
              : [];
          }).pipe(Effect.scoped),
      ).pipe(Effect.map((commands) => commands.flat())),
    ),
    Match.exhaustive,
  );

  for (const argv of commands) {
    const code = yield* executor.inherit(argv[0], argv.slice(1), {
      cwd: temporary,
    });

    if (code !== 0)
      return yield* new CommandError({
        command: argv.join(" "),
        exitCode: code,
        stderr: `${check} validation failed`,
      });
  }

  yield* Console.log(
    `${check} validation passed on the tracked source checkout`,
  );
});

checkRepositoryFiles.pipe(
  Effect.scoped,
  Effect.provide(CommandExecutor.layer),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
