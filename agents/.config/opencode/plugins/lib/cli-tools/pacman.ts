import { Tool } from "@opencode/schema/tool";
import { Effect, Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, runCli, tailLines } from "./tool";

const tool = clientTools(Layer.empty);

const pkg = Schema.String.check(Schema.isPattern(/^[^-]/)).annotate({ description: "A package name" });

/** Run pacman or checkupdates, treating `empty` exit codes as no results rather than failures. */
const query = (command: string, args: readonly string[], empty: readonly number[] = [1]) =>
  runCli(command, args, { timeout: "2 minutes" }).pipe(
    Effect.flatMap((run) => {
      if (run.exitCode === 0) return Effect.succeed(run.stdout.trimEnd());

      if (empty.includes(run.exitCode) && run.stdout.trim() === "") return Effect.succeed("");

      return Effect.fail(
        new Tool.Error({
          message: `${command} ${args.join(" ")} exited ${run.exitCode}\n${tailLines(run.stderr || run.stdout)}`,
        }),
      );
    }),
  );

const lines = (text: string) => (text === "" ? [] : text.split("\n"));

/** Installed and repository packages through pacman queries. Read-only: installs go through pkexec. */
export const pacmanNamespace: ClientNamespace = {
  kind: "client",
  command: "pacman",
  description:
    "Arch packages through read-only pacman queries: package info, files, which package owns a path, searching, listing explicit or foreign packages, and pending updates. Installing stays in the shell through pkexec.",
  available: commandExists("pacman"),
  tools: [
    tool({
      name: "info",
      description: "Read installed packages' version, description, dependencies, size and install date, or the sync repositories' with remote.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        packages: Schema.Array(pkg),
        remote: Schema.optionalKey(Schema.Boolean).annotate({ description: "Read the sync repositories instead" }),
      }),
      run: (input) => query("pacman", [input.remote ? "-Si" : "-Qi", ...input.packages], []),
    }),
    tool({
      name: "files",
      description: "List the files an installed package owns.",
      access: "read",
      input: Schema.Struct({ package: pkg }),
      run: (input) =>
        Effect.map(query("pacman", ["-Qlq", input.package], []), (text) =>
          lines(text).filter((path) => !path.endsWith("/")),
        ),
    }),
    tool({
      name: "owner",
      description: "Find the installed package that owns a file or command path.",
      access: "read",
      input: Schema.Struct({ path: Schema.String }),
      run: (input) => query("pacman", ["-Qo", input.path], []),
    }),
    tool({
      name: "search",
      description:
        "Search installed packages' names and descriptions with a regular expression, or the sync repositories' with remote. Returns an empty string when nothing matches.",
      access: "read",
      input: Schema.Struct({
        query: Schema.String,
        remote: Schema.optionalKey(Schema.Boolean),
      }),
      run: (input) => query("pacman", [input.remote ? "-Ss" : "-Qs", "--", input.query]),
    }),
    tool({
      name: "list",
      description: "List installed packages with their versions: all, explicitly installed, or foreign (AUR and private repo builds no sync repository has).",
      access: "read",
      input: Schema.Struct({
        filter: Schema.optionalKey(Schema.Literals(["all", "explicit", "foreign"])),
      }),
      run: (input) =>
        Effect.map(
          query("pacman", [{ all: "-Q", explicit: "-Qe", foreign: "-Qm" }[input.filter ?? "all"]]),
          (text) =>
            lines(text).map((line) => {
              const [name, version] = line.split(" ");

              return { name, version };
            }),
        ),
    }),
    tool({
      name: "outdated",
      description: "List pending repository updates with checkupdates, from a temporary database so nothing is synced.",
      access: "read",
      timeout: "3 minutes",
      available: commandExists("checkupdates"),
      input: Schema.Struct({}),
      run: () =>
        Effect.map(query("checkupdates", ["--nocolor"], [2]), (text) =>
          lines(text).map((line) => {
            const [name, from, , to] = line.split(" ");

            return { name, from, to };
          }),
        ),
    }),
  ],
};
