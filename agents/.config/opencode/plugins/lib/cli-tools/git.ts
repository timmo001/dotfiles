import { Tool } from "@opencode/schema/tool";
import { Duration, Effect, Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, runCli, runCliText, tailLines } from "./tool";

const tool = clientTools(Layer.empty);

const directory = Schema.optionalKey(
  Schema.String.check(Schema.isStartingWith("/")).annotate({
    description: "An absolute directory to run in instead of the session's",
  }),
);

/** A revision, kept from starting with a dash so it can't pass as an option. */
const Rev = Schema.String.check(Schema.isPattern(/^[^-]/)).annotate({
  description: "A revision, such as HEAD, main, origin/main~2, a SHA or a range like main..HEAD",
});

const paths = Schema.optionalKey(Schema.Array(Schema.String)).annotate({
  description: "Limit to these paths or pathspecs",
});

const cwd = (input: { readonly directory?: string }, context: { readonly directory: string }) =>
  input.directory ?? context.directory;

const git = (args: readonly string[], dir: string, timeout: Duration.Input = "1 minute") =>
  runCliText("git", ["--no-pager", ...args], { cwd: dir, timeout });

const pathArgs = (input: { readonly paths?: readonly string[] }) =>
  input.paths === undefined || input.paths.length === 0 ? [] : ["--", ...input.paths];

const flag = (name: string, value: boolean | undefined) => (value ? [name] : []);

const option = (name: string, value: string | number | undefined) =>
  value === undefined ? [] : [`${name}=${value}`];

const lines = (text: string) => (text === "" ? [] : text.split("\n"));

const SEPARATOR = "\x1f";

/** Rows of fields split on the unit separator, as objects keyed by `keys`. */
const records = (text: string, keys: readonly string[]) =>
  lines(text).map((line): Record<string, string> =>
    Object.fromEntries(line.split(SEPARATOR).map((value, index) => [keys[index] ?? String(index), value])),
  );

/** Git repositories through the git CLI: status, history, diffs and other reads, plus fetch. */
export const gitNamespace: ClientNamespace = {
  kind: "client",
  command: "git",
  description:
    "Git in the session's directory, or another with directory: status, log, show, diff, grep, files, blame, branches, remotes, refs, stashes and worktrees, plus fetch. Commit with dot.git_commit.",
  available: commandExists("git"),
  tools: [
    tool({
      name: "status",
      description: "Read the branch, its upstream and ahead/behind counts, and changed, staged and untracked files.",
      access: "read",
      pinned: true,
      input: Schema.Struct({ directory, paths }),
      run: (input, context) => git(["status", "--short", "--branch", ...pathArgs(input)], cwd(input, context)),
    }),
    tool({
      name: "log",
      description: "List commits, newest first, with their SHA, author, date, subject and refs.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        directory,
        rev: Schema.optionalKey(Rev),
        paths,
        limit: Schema.optionalKey(Schema.Int).annotate({ description: "How many commits, 20 by default" }),
        since: Schema.optionalKey(Schema.String).annotate({ description: "Such as 2 days ago or 2026-10-01" }),
        author: Schema.optionalKey(Schema.String),
        grep: Schema.optionalKey(Schema.String).annotate({ description: "A pattern the message must match" }),
        body: Schema.optionalKey(Schema.Boolean).annotate({ description: "Include each commit's full message" }),
      }),
      run: (input, context) => {
        const fields = ["%H", "%an", "%aI", "%s", "%D", ...(input.body ? ["%b"] : [])];
        const end = "\x1e";

        return git(
          [
            "log",
            `--max-count=${input.limit ?? 20}`,
            `--format=${fields.join("%x1f")}%x1e`,
            ...option("--since", input.since),
            ...option("--author", input.author),
            ...option("--grep", input.grep),
            ...(input.rev === undefined ? [] : [input.rev]),
            ...pathArgs(input),
          ],
          cwd(input, context),
        ).pipe(
          Effect.map((text) =>
            text
              .split(end)
              .map((entry) => entry.replace(/^\n/, ""))
              .filter((entry) => entry !== "")
              .map((entry) => {
                const [sha, author, date, subject, refs, body] = entry.split(SEPARATOR);

                return {
                  sha,
                  author,
                  date,
                  subject,
                  refs: refs === "" ? [] : refs?.split(", "),
                  body: input.body ? (body?.trim() ?? "") : undefined,
                };
              }),
          ),
        );
      },
    }),
    tool({
      name: "show",
      description:
        "Show a commit's message and patch, or with path, a file's contents at that revision (rev:path).",
      access: "read",
      input: Schema.Struct({
        directory,
        rev: Rev,
        path: Schema.optionalKey(Schema.String).annotate({ description: "Show this file at rev instead" }),
        stat: Schema.optionalKey(Schema.Boolean).annotate({ description: "Changed files and line counts, no patch" }),
      }),
      run: (input, context) =>
        git(
          input.path === undefined
            ? ["show", ...flag("--stat", input.stat), input.rev]
            : ["show", `${input.rev}:${input.path}`],
          cwd(input, context),
        ),
    }),
    tool({
      name: "diff",
      description:
        "Diff the working tree against the index, the index against HEAD with staged, or two revisions or a range.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        directory,
        from: Schema.optionalKey(Rev),
        to: Schema.optionalKey(Rev),
        staged: Schema.optionalKey(Schema.Boolean),
        paths,
        stat: Schema.optionalKey(Schema.Boolean),
        nameOnly: Schema.optionalKey(Schema.Boolean),
        context: Schema.optionalKey(Schema.Int).annotate({ description: "Lines of context, 3 by default" }),
      }),
      run: (input, context) =>
        git(
          [
            "diff",
            ...flag("--staged", input.staged),
            ...flag("--stat", input.stat),
            ...flag("--name-status", input.nameOnly),
            ...(input.context === undefined ? [] : [`-U${input.context}`]),
            ...(input.from === undefined ? [] : [input.from]),
            ...(input.to === undefined ? [] : [input.to]),
            ...pathArgs(input),
          ],
          cwd(input, context),
        ),
    }),
    tool({
      name: "grep",
      description:
        "Search tracked files, or a revision's, for a pattern, with file and line numbers. Returns an empty string when nothing matches.",
      access: "read",
      input: Schema.Struct({
        directory,
        pattern: Schema.String,
        rev: Schema.optionalKey(Rev),
        paths,
        ignoreCase: Schema.optionalKey(Schema.Boolean),
        fixed: Schema.optionalKey(Schema.Boolean).annotate({ description: "Match the pattern as plain text" }),
        untracked: Schema.optionalKey(Schema.Boolean).annotate({ description: "Search untracked files too" }),
      }),
      run: (input, context) =>
        runCli(
          "git",
          [
            "--no-pager",
            "grep",
            "-n",
            "-I",
            ...flag("-i", input.ignoreCase),
            ...flag("-F", input.fixed),
            ...flag("--untracked", input.untracked),
            "-e",
            input.pattern,
            ...(input.rev === undefined ? [] : [input.rev]),
            ...pathArgs(input),
          ],
          { cwd: cwd(input, context), timeout: "1 minute" },
        ).pipe(
          Effect.flatMap((run) => {
            if (run.exitCode === 0) return Effect.succeed(run.stdout.trimEnd());

            if (run.exitCode === 1 && run.stderr.trim() === "") return Effect.succeed("");

            return Effect.fail(
              new Tool.Error({ message: `git grep exited ${run.exitCode}\n${tailLines(run.stderr || run.stdout)}` }),
            );
          }),
        ),
    }),
    tool({
      name: "ls_files",
      description: "List tracked files, or untracked ones that aren't ignored with others.",
      access: "read",
      input: Schema.Struct({
        directory,
        paths,
        others: Schema.optionalKey(Schema.Boolean).annotate({ description: "Untracked files instead" }),
      }),
      run: (input, context) =>
        Effect.map(
          git(
            ["ls-files", ...(input.others ? ["--others", "--exclude-standard"] : []), ...pathArgs(input)],
            cwd(input, context),
          ),
          lines,
        ),
    }),
    tool({
      name: "blame",
      description: "Show who last changed each line of a file, optionally for a line range or at a revision.",
      access: "read",
      input: Schema.Struct({
        directory,
        path: Schema.String,
        rev: Schema.optionalKey(Rev),
        start: Schema.optionalKey(Schema.Int),
        end: Schema.optionalKey(Schema.Int),
      }),
      run: (input, context) =>
        git(
          [
            "blame",
            "--date=short",
            ...(input.start === undefined ? [] : ["-L", `${input.start},${input.end ?? ""}`]),
            ...(input.rev === undefined ? [] : [input.rev]),
            "--",
            input.path,
          ],
          cwd(input, context),
        ),
    }),
    tool({
      name: "branch_list",
      description: "List branches with their SHA, upstream, ahead/behind and last commit date, local only unless all.",
      access: "read",
      input: Schema.Struct({
        directory,
        all: Schema.optionalKey(Schema.Boolean).annotate({ description: "Include remote-tracking branches" }),
      }),
      run: (input, context) =>
        Effect.map(
          git(
            [
              "for-each-ref",
              "--sort=-committerdate",
              `--format=${["%(refname:short)", "%(objectname:short)", "%(HEAD)", "%(upstream:short)", "%(upstream:track)", "%(committerdate:iso-strict)", "%(subject)"].join("%1f")}`,
              "refs/heads",
              ...(input.all ? ["refs/remotes"] : []),
            ],
            cwd(input, context),
          ),
          (text) =>
            records(text, ["name", "sha", "head", "upstream", "track", "date", "subject"]).map((branch) => ({
              ...branch,
              head: branch.head === "*",
            })),
        ),
    }),
    tool({
      name: "remote_list",
      description: "List remotes with their fetch and push URLs.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) => git(["remote", "-v"], cwd(input, context)),
    }),
    tool({
      name: "ls_remote",
      description: "List a remote's branches and tags with their SHAs, without fetching.",
      access: "read",
      input: Schema.Struct({
        directory,
        remote: Schema.optionalKey(Rev).annotate({ description: "A remote name or URL, origin by default" }),
        patterns: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
          description: "Ref patterns such as refs/tags/* or main",
        }),
      }),
      run: (input, context) =>
        Effect.map(
          git(["ls-remote", input.remote ?? "origin", ...(input.patterns ?? [])], cwd(input, context)),
          (text) =>
            lines(text).map((line) => {
              const [sha, ref] = line.split("\t");

              return { sha, ref };
            }),
        ),
    }),
    tool({
      name: "rev_parse",
      description: "Resolve revisions to full SHAs, such as HEAD, a branch or origin/main.",
      access: "read",
      input: Schema.Struct({ directory, revs: Schema.Array(Rev) }),
      run: (input, context) =>
        Effect.map(git(["rev-parse", "--verify", "--end-of-options", ...input.revs], cwd(input, context)), (text) =>
          Object.fromEntries(lines(text).map((sha, index) => [input.revs[index], sha])),
        ),
    }),
    tool({
      name: "merge_base",
      description: "Find the best common ancestor of two revisions.",
      access: "read",
      input: Schema.Struct({ directory, a: Rev, b: Rev }),
      run: (input, context) => git(["merge-base", input.a, input.b], cwd(input, context)),
    }),
    tool({
      name: "stash_list",
      description: "List stashes with their dates and messages.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) =>
        Effect.map(git(["stash", "list", "--format=%gd%x1f%cI%x1f%gs"], cwd(input, context)), (text) =>
          records(text, ["ref", "date", "message"]),
        ),
    }),
    tool({
      name: "worktree_list",
      description: "List the repository's worktrees with their paths, HEADs and branches.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) =>
        Effect.map(git(["worktree", "list", "--porcelain"], cwd(input, context)), (text) =>
          text
            .split("\n\n")
            .filter((block) => block.trim() !== "")
            .map((block) =>
              Object.fromEntries(
                lines(block.trim()).map((line) => {
                  const index = line.indexOf(" ");

                  return index === -1 ? [line, true] : [line.slice(0, index), line.slice(index + 1)];
                }),
              ),
            ),
        ),
    }),
    tool({
      name: "fetch",
      description: "Fetch from a remote, or all remotes, updating remote-tracking branches. Doesn't touch local branches.",
      access: "write",
      timeout: "5 minutes",
      input: Schema.Struct({
        directory,
        remote: Schema.optionalKey(Rev),
        all: Schema.optionalKey(Schema.Boolean),
        prune: Schema.optionalKey(Schema.Boolean),
        tags: Schema.optionalKey(Schema.Boolean),
      }),
      resource: (input) => (input.all ? "--all" : (input.remote ?? "origin")),
      summary: (input) =>
        ["git fetch", ...(input.all ? ["--all"] : [input.remote ?? "origin"]), ...flag("--prune", input.prune), ...flag("--tags", input.tags)].join(" "),
      run: (input, context) =>
        runCli(
          "git",
          [
            "fetch",
            ...(input.all ? ["--all"] : [input.remote ?? "origin"]),
            ...flag("--prune", input.prune),
            ...flag("--tags", input.tags),
          ],
          { cwd: cwd(input, context), timeout: "5 minutes" },
        ).pipe(
          Effect.flatMap((run) =>
            run.exitCode === 0
              ? Effect.succeed((run.stdout + run.stderr).trim())
              : Effect.fail(new Tool.Error({ message: `git fetch exited ${run.exitCode}\n${tailLines(run.stderr)}` })),
          ),
        ),
    }),
  ],
};
