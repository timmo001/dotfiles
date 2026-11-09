import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Tool } from "@opencode/schema/tool";
import { layer as ghClientLayer, Repository } from "@timmo001/effect-gh";
import { Duration, Effect, Layer, Schema } from "effect";
import {
  type ClientNamespace,
  clientTools,
  commandExists,
  type Redirect,
  runCli,
  runCliText,
  tailLines,
  toToolError,
} from "./tool";

const tool = clientTools(Layer.empty);

const ghLayer = ghClientLayer().pipe(Layer.provide(NodeServices.layer));

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

/**
 * Run a git command that changes the repository, returning what it printed, or undefined when it
 * printed nothing. Both streams are kept together, so a conflict's report survives a failure.
 */
const gitChange = (args: readonly string[], dir: string, timeout: Duration.Input = "2 minutes") =>
  runCli("git", ["--no-pager", ...args], {
    cwd: dir,
    timeout,
    mergeStderr: true,
    // Continuing a merge, rebase or cherry-pick keeps its message instead of waiting on an editor.
    env: { GIT_EDITOR: "true", GIT_TERMINAL_PROMPT: "0" },
  }).pipe(
    Effect.flatMap((run) =>
      run.exitCode === 0
        ? Effect.succeed(run.stdout.trim() || undefined)
        : Effect.fail(
            new Tool.Error({
              message: `git ${args[0]} exited ${run.exitCode}\n${tailLines(run.stdout)}`,
              metadata: { exitCode: run.exitCode },
            }),
          ),
    ),
  );

const Action = Schema.Literals(["continue", "abort"]).annotate({
  description: "Continue or abort the one in progress instead of starting one",
});

const ActionOrSkip = Schema.Literals(["continue", "abort", "skip"]).annotate({
  description: "Continue, abort or skip the commit in progress instead of starting one",
});

/** Start a merge, rebase or cherry-pick with `args`, or act on the one in progress. */
const sequence = (
  command: string,
  input: { readonly directory?: string; readonly action?: string },
  context: { readonly directory: string },
  args: readonly string[] | undefined,
) =>
  input.action !== undefined
    ? gitChange([command, `--${input.action}`], cwd(input, context))
    : args === undefined
      ? Effect.fail(new Tool.Error({ message: `git ${command} needs a revision to start, or an action` }))
      : gitChange([command, ...args], cwd(input, context));

const GITHUB_URL =
  /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** OWNER/REPO when a clone source is a github.com URL. */
const githubRepository = (source: string) => {
  const match = GITHUB_URL.exec(source);

  return match === null ? undefined : `${match[1]}/${match[2]}`;
};

/** Where a clone of a GitHub repository goes: the destination, or the repository's name. */
const cloneDestination = (input: { readonly directory?: string; readonly destination?: string }, repository: string) => {
  const destination = input.destination ?? repository.split("/")[1] ?? repository;

  return input.directory === undefined ? destination : join(input.directory, destination);
};

const cloneRedirect = (input: {
  readonly directory?: string;
  readonly source: string;
  readonly destination?: string;
  readonly depth?: number;
}): Redirect | undefined => {
  const repository = githubRepository(input.source);

  if (repository === undefined) return undefined;

  const destination = cloneDestination(input, repository);

  return {
    namespace: "gh",
    tool: "repo_clone",
    input:
      input.depth === undefined
        ? { repository, directory: destination }
        : { repository, directory: destination, depth: input.depth },
    reason: "gh clones GitHub repositories with your gh login and adds an upstream remote to forks",
  };
};

const depthArgs = (depth: number | undefined) => (depth === undefined ? [] : [`--depth=${depth}`]);

/** Git repositories through the git CLI: status, history, diffs and other reads, plus fetch. */
export const gitNamespace: ClientNamespace = {
  kind: "client",
  command: "git",
  description:
    "Git in the session's directory, or another with directory: status, log, show, diff, grep, files, blame, branches, tags, remotes, refs, reflog, stashes and worktrees, plus fetch, pull, clone, staging, switching and deleting branches, stashing, merges, rebases, cherry-picks and submodules. Commit and push with dot.git_commit; pull requests, forks and other GitHub work go through gh.",
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
        Effect.map(git(["rev-parse", ...input.revs], cwd(input, context)), (text) =>
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
      name: "tag_list",
      description: "List tags, newest first, with their SHA, date and subject.",
      access: "read",
      input: Schema.Struct({
        directory,
        pattern: Schema.optionalKey(Rev.annotate({ description: "A glob such as v1.*" })),
        contains: Schema.optionalKey(Rev).annotate({ description: "Only tags that contain this commit" }),
      }),
      run: (input, context) =>
        Effect.map(
          git(
            [
              "tag",
              "--list",
              "--sort=-creatordate",
              `--format=${["%(refname:short)", "%(objectname:short)", "%(creatordate:iso-strict)", "%(subject)"].join("%1f")}`,
              ...option("--contains", input.contains),
              ...(input.pattern === undefined ? [] : [input.pattern]),
            ],
            cwd(input, context),
          ),
          (text) => records(text, ["name", "sha", "date", "subject"]),
        ),
    }),
    tool({
      name: "reflog",
      description: "List where a ref, HEAD by default, has pointed, newest first: commits, checkouts, resets and rebases.",
      access: "read",
      input: Schema.Struct({
        directory,
        rev: Schema.optionalKey(Rev),
        limit: Schema.optionalKey(Schema.Int).annotate({ description: "How many entries, 20 by default" }),
      }),
      run: (input, context) =>
        Effect.map(
          git(
            ["reflog", "show", `--max-count=${input.limit ?? 20}`, "--format=%H%x1f%gd%x1f%gs", input.rev ?? "HEAD"],
            cwd(input, context),
          ),
          (text) => records(text, ["sha", "ref", "message"]),
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
    tool({
      name: "pull",
      description:
        "Fetch and bring the current branch up to date with its upstream, or a remote's branch: fast-forward only, or rebasing onto it with rebase.",
      access: "write",
      timeout: "5 minutes",
      input: Schema.Struct({
        directory,
        remote: Schema.optionalKey(Rev).annotate({ description: "origin by default when branch is given" }),
        branch: Schema.optionalKey(Rev),
        rebase: Schema.optionalKey(Schema.Boolean).annotate({ description: "Rebase local commits instead of fast-forwarding" }),
      }),
      run: (input, context) =>
        gitChange(
          [
            "pull",
            input.rebase ? "--rebase" : "--ff-only",
            ...(input.remote === undefined && input.branch === undefined ? [] : [input.remote ?? "origin"]),
            ...(input.branch === undefined ? [] : [input.branch]),
          ],
          cwd(input, context),
          "5 minutes",
        ),
    }),
    tool({
      name: "clone",
      description:
        "Clone a repository into destination, relative to directory. A github.com URL runs gh.repo_clone instead, so call that for GitHub repositories.",
      access: "write",
      timeout: "10 minutes",
      input: Schema.Struct({
        directory,
        source: Rev.annotate({ description: "A clone URL or a local repository's path" }),
        destination: Schema.optionalKey(Schema.String).annotate({
          description: "Where to clone to; the repository's name by default",
        }),
        depth: Schema.optionalKey(Schema.Int).annotate({ description: "A shallow clone with this many commits" }),
      }),
      redirect: cloneRedirect,
      resource: (input) => githubRepository(input.source) ?? input.source,
      summary: (input) => {
        const repository = githubRepository(input.source);

        return repository === undefined
          ? ["git clone", ...depthArgs(input.depth), input.source, ...(input.destination === undefined ? [] : [input.destination])].join(" ")
          : `gh repo clone ${repository} ${cloneDestination(input, repository)}`;
      },
      run: (input, context) => {
        const repository = githubRepository(input.source);

        if (repository === undefined)
          return gitChange(
            ["clone", ...depthArgs(input.depth), "--", input.source, ...(input.destination === undefined ? [] : [input.destination])],
            cwd(input, context),
            "10 minutes",
          );

        const destination = cloneDestination(input, repository);

        return Repository.clone(
          { repository, directory: destination, gitArgs: depthArgs(input.depth) },
          { cwd: context.directory, env: { GIT_TERMINAL_PROMPT: "0" } },
        ).pipe(
          Effect.as(`Cloned ${repository} into ${destination}`),
          Effect.catchTag("GhCommandError", (error) =>
            Effect.fail(
              new Tool.Error({
                message: `gh repo clone exited ${error.exitCode}\n${tailLines(error.stderr || error.stdout)}`,
                error,
              }),
            ),
          ),
          Effect.mapError(toToolError),
          Effect.provide(ghLayer),
        );
      },
    }),
    tool({
      name: "add",
      description: "Stage changes to these paths, including new and deleted files.",
      access: "write",
      input: Schema.Struct({ directory, paths: Schema.NonEmptyArray(Schema.String) }),
      run: (input, context) => gitChange(["add", "--", ...input.paths], cwd(input, context)),
    }),
    tool({
      name: "restore",
      description:
        "Unstage paths with staged, or discard their working tree changes without it. Discarded changes can't be recovered.",
      access: "write",
      input: Schema.Struct({
        directory,
        paths: Schema.NonEmptyArray(Schema.String),
        staged: Schema.optionalKey(Schema.Boolean).annotate({ description: "Unstage, leaving the working tree alone" }),
        source: Schema.optionalKey(Rev).annotate({ description: "Restore from this revision instead of the index or HEAD" }),
      }),
      // Unstaging and discarding are told apart, so "always" for one doesn't allow the other.
      resource: (input) => (input.staged ? "--staged" : "--worktree"),
      run: (input, context) =>
        gitChange(
          ["restore", ...flag("--staged", input.staged), ...option("--source", input.source), "--", ...input.paths],
          cwd(input, context),
        ),
    }),
    tool({
      name: "switch",
      description: "Switch to a branch, or create one with create, from startPoint or HEAD.",
      access: "write",
      input: Schema.Struct({
        directory,
        branch: Rev,
        create: Schema.optionalKey(Schema.Boolean),
        startPoint: Schema.optionalKey(Rev).annotate({ description: "Where a new branch starts" }),
      }),
      run: (input, context) =>
        gitChange(
          [
            "switch",
            ...(input.create ? ["--create", input.branch] : [input.branch]),
            ...(input.create && input.startPoint !== undefined ? [input.startPoint] : []),
          ],
          cwd(input, context),
        ),
    }),
    tool({
      name: "branch_delete",
      description: "Delete a local branch, refusing an unmerged one unless force.",
      access: "write",
      input: Schema.Struct({ directory, branch: Rev, force: Schema.optionalKey(Schema.Boolean) }),
      resource: (input) => (input.force ? "--force" : input.branch),
      run: (input, context) => gitChange(["branch", input.force ? "-D" : "-d", input.branch], cwd(input, context)),
    }),
    tool({
      name: "stash_push",
      description: "Stash working tree and staged changes, or only some paths', and leave the working tree clean.",
      access: "write",
      input: Schema.Struct({
        directory,
        message: Schema.optionalKey(Schema.String),
        paths,
        untracked: Schema.optionalKey(Schema.Boolean).annotate({ description: "Stash untracked files too" }),
        staged: Schema.optionalKey(Schema.Boolean).annotate({ description: "Stash only staged changes" }),
      }),
      run: (input, context) =>
        gitChange(
          [
            "stash",
            "push",
            ...(input.message === undefined ? [] : ["--message", input.message]),
            ...flag("--include-untracked", input.untracked),
            ...flag("--staged", input.staged),
            ...pathArgs(input),
          ],
          cwd(input, context),
        ),
    }),
    ...(
      [
        ["apply", "Apply a stash, the latest by default, and keep it."],
        ["pop", "Apply a stash, the latest by default, and drop it once it applies cleanly."],
        ["drop", "Delete a stash, the latest by default."],
      ] as const
    ).map(([action, description]) =>
      tool({
        name: `stash_${action}`,
        description,
        access: "write",
        input: Schema.Struct({
          directory,
          stash: Schema.optionalKey(Rev).annotate({ description: "A stash such as stash@{1}, from stash_list" }),
        }),
        run: (input, context) =>
          gitChange(["stash", action, ...(input.stash === undefined ? [] : [input.stash])], cwd(input, context)),
      }),
    ),
    tool({
      name: "merge",
      description:
        "Merge a revision into the current branch with git's default message, or continue or abort a merge with conflicts.",
      access: "write",
      input: Schema.Struct({
        directory,
        rev: Schema.optionalKey(Rev),
        ffOnly: Schema.optionalKey(Schema.Boolean).annotate({ description: "Fail unless it fast-forwards" }),
        noFf: Schema.optionalKey(Schema.Boolean).annotate({ description: "Always make a merge commit" }),
        action: Schema.optionalKey(Action),
      }),
      run: (input, context) =>
        sequence(
          "merge",
          input,
          context,
          input.rev === undefined
            ? undefined
            : ["--no-edit", ...flag("--ff-only", input.ffOnly), ...flag("--no-ff", input.noFf), input.rev],
        ),
    }),
    tool({
      name: "rebase",
      description:
        "Rebase the current branch onto upstream, never interactively, or continue, abort or skip during one with conflicts.",
      access: "write",
      input: Schema.Struct({
        directory,
        upstream: Schema.optionalKey(Rev),
        onto: Schema.optionalKey(Rev).annotate({ description: "Replay the commits after upstream onto this instead" }),
        autostash: Schema.optionalKey(Schema.Boolean).annotate({
          description: "Stash local changes first and reapply them after",
        }),
        action: Schema.optionalKey(ActionOrSkip),
      }),
      run: (input, context) =>
        sequence(
          "rebase",
          input,
          context,
          input.upstream === undefined
            ? undefined
            : [...flag("--autostash", input.autostash), ...option("--onto", input.onto), input.upstream],
        ),
    }),
    tool({
      name: "cherry_pick",
      description:
        "Apply commits onto the current branch with their own messages, or continue, abort or skip during one with conflicts.",
      access: "write",
      input: Schema.Struct({
        directory,
        revs: Schema.optionalKey(Schema.NonEmptyArray(Rev)),
        action: Schema.optionalKey(ActionOrSkip),
      }),
      run: (input, context) => sequence("cherry-pick", input, context, input.revs),
    }),
    tool({
      name: "submodule_update",
      description: "Check out submodules at the commits the superproject records, initialising new ones with init.",
      access: "write",
      timeout: "10 minutes",
      input: Schema.Struct({
        directory,
        paths,
        init: Schema.optionalKey(Schema.Boolean),
        recursive: Schema.optionalKey(Schema.Boolean),
      }),
      run: (input, context) =>
        gitChange(
          ["submodule", "update", ...flag("--init", input.init), ...flag("--recursive", input.recursive), ...pathArgs(input)],
          cwd(input, context),
          "10 minutes",
        ),
    }),
  ],
};
