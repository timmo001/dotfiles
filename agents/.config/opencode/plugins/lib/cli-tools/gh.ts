import { NodeServices } from "@effect/platform-node";
import { Tool } from "@opencode/schema/tool";
import {
  Api,
  Attachment,
  Comment,
  Discussion,
  Gh,
  GhCommandError,
  GhDecodeError,
  GhInvalidOptionsError,
  GhTimeoutError,
  Graphql,
  Issue,
  Label,
  layer as ghClientLayer,
  PullRequest,
  Release,
  Repository,
  Review,
  Search,
  Workflow,
} from "@timmo001/effect-gh";
import { type Duration, Effect, Layer, Option, Schema } from "effect";
import {
  type CliInput,
  type ClientCall,
  type ClientNamespace,
  type ClientTool,
  type CliToolAccess,
  commandExists,
  plain,
  runCliText,
  tailLines,
  toToolError,
} from "./tool";

const ghLayer = ghClientLayer().pipe(Layer.provide(NodeServices.layer));

/** Where one gh tool call runs. */
interface GhCall {
  /** The session directory, where gh runs. */
  readonly cwd: string;
  /** [HOST/]OWNER/REPO, or empty when the tool doesn't resolve one and none was given. */
  readonly repo: string;
}

/**
 * How a tool finds its repository: `resolve` uses `repo` or the session directory's repository,
 * `local` passes `repo` through so gh picks the repository and current branch itself, and `none`
 * has no repository.
 */
type RepoMode = "resolve" | "local" | "none";

/** A call's access and permission resource, when they depend on more than its input's shape. */
interface Classified {
  readonly access: CliToolAccess;
  readonly resource: string;
}

const toGhError = (cause: unknown): Tool.Error => {
  if (cause instanceof Tool.Error) return cause;

  if (cause instanceof GhCommandError)
    return new Tool.Error({
      message: `gh exited ${cause.exitCode}\n${tailLines(cause.stderr || cause.stdout)}`,
      error: cause,
    });

  if (cause instanceof Graphql.ResponseError)
    return new Tool.Error({ message: cause.errors.map((entry) => entry.message).join("\n"), error: cause });

  if (cause instanceof Attachment.PrivateRepositoryError)
    return new Tool.Error({
      message: `${cause.repository} is private, so attachments uploaded against it 404 for everyone else. Pass a public repository, such as your fork, as uploadRepository.`,
      error: cause,
    });

  if (cause instanceof GhTimeoutError) return new Tool.Error({ message: `gh timed out after ${cause.timeoutMs}ms`, error: cause });

  if (cause instanceof GhInvalidOptionsError || cause instanceof GhDecodeError)
    return new Tool.Error({ message: `${cause._tag}: ${String(cause.cause)}`, error: cause });

  return toToolError(cause);
};

const currentRepository = (cwd: string) =>
  Repository.view(undefined, { cwd }).pipe(Effect.map((repo) => repo.nameWithOwner));

const WithRepository = Schema.Struct({ repo: Schema.String });

const preview = (input: CliInput) => {
  const text = JSON.stringify(input, null, 2);

  return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
};

/** Define a gh tool, resolving its repository before the permission check so the prompt can name it. */
const ghTool = <S extends Schema.Codec<any, any>, A, E>(tool: {
  readonly name: string;
  readonly description: string;
  readonly access: CliToolAccess;
  readonly pinned?: boolean;
  readonly timeout?: Duration.Input;
  readonly repo?: RepoMode;
  readonly input: S;
  /** The call's access and resource, for tools that read or write depending on their input. */
  readonly classify?: (input: S["Type"]) => Effect.Effect<Classified, Tool.Error | Graphql.ParseError>;
  /** The permission resource after the tool id; the repository when unset. */
  readonly resource?: (input: S["Type"], repo: string) => string | undefined;
  readonly run: (input: S["Type"], call: GhCall) => Effect.Effect<A, E, Gh>;
}): ClientTool => ({
  name: tool.name,
  description: tool.description,
  access: tool.access,
  pinned: tool.pinned ?? false,
  timeout: tool.timeout ?? "2 minutes",
  input: tool.input,
  prepare: (input, context) =>
    Schema.decodeUnknownEffect(tool.input)(input).pipe(
      Effect.mapError((error) => new Tool.Error({ message: `Invalid input for ${tool.name}: ${error.message}` })),
      Effect.flatMap((decoded: S["Type"]) =>
        Effect.gen(function* () {
          const given = Option.getOrUndefined(
            Option.map(Schema.decodeUnknownOption(WithRepository)(decoded), (input) => input.repo),
          );

          const mode = tool.repo ?? "resolve";

          const repo =
            mode === "none" ? "" : (given ?? (mode === "resolve" ? yield* currentRepository(context.directory) : ""));

          const classified = tool.classify === undefined ? undefined : yield* tool.classify(decoded);

          return {
            access: classified?.access,
            resource:
              classified?.resource ?? (tool.resource === undefined ? repo || undefined : tool.resource(decoded, repo)),
            summary: `${tool.name}${repo ? ` ${repo}` : ""}\n${preview(input)}`,
            run: tool.run(decoded, { cwd: context.directory, repo }).pipe(
              Effect.map(plain),
              Effect.provide(ghLayer),
              Effect.mapError(toGhError),
              Effect.timeoutOrElse({
                duration: tool.timeout ?? "2 minutes",
                orElse: () => Effect.fail(new Tool.Error({ message: `${tool.name} timed out` })),
              }),
            ),
          } satisfies ClientCall;
        }).pipe(Effect.provide(ghLayer), Effect.mapError(toGhError)),
      ),
    ),
});

const withGh = <A, E>(f: (gh: Gh["Service"]) => Effect.Effect<A, E>) => Effect.flatMap(Effect.service(Gh), f);

/** The REST path and host of [HOST/]OWNER/REPO. */
const restTarget = (repo: string) => {
  const parts = repo.split("/");

  return parts.length === 3 ? { path: parts.slice(1).join("/"), hostname: parts[0] } : { path: repo };
};

const repo = Schema.optionalKey(Schema.String).annotate({
  description: "OWNER/REPO, or HOST/OWNER/REPO. Defaults to the session directory's repository",
});

const number = (what: string) => Schema.Int.annotate({ description: `The ${what} number` });

const selector = Schema.Union([Schema.Int, Schema.String]).annotate({
  description: "The pull request's number, URL or branch",
});

const body = (what: string) =>
  Schema.String.annotate({
    description: `The ${what} in GitHub Markdown. Reference attachments by their local path`,
  });

const headSha = Schema.String.annotate({
  description:
    "The head commit you reviewed (headRefOid from pr_view). The call fails if the branch has moved since",
});

const Attachments = Schema.optionalKey(
  Schema.Array(
    Schema.Struct({
      path: Schema.String.annotate({ description: "The local file, written the same way the text references it" }),
      alt: Schema.String.annotate({ description: "Alt text, used when the text doesn't reference the path" }),
    }),
  ),
).annotate({
  description:
    "Images, videos or other files to upload with this write. Each local path in the text is replaced with the file's URL, and a file the text doesn't reference is added at the end. Uploads go against the target repository when you can push to it, otherwise your fork of it, which must be public",
});

const uploadRepository = Schema.optionalKey(Schema.String).annotate({
  description: "A public OWNER/REPO to upload attachments against, instead of the target repository or your fork",
});

type AttachmentList = typeof Attachments.Type | undefined;

/** Where attachments for a post in `repo` go: the repository itself when you can push to it, otherwise your fork. */
const uploadTarget = Effect.fn("gh.uploadTarget")(function* (repo: string, cwd: string) {
  const target = yield* Api.json(
    { endpoint: `repos/${repo}`, method: "GET", options: { cwd } },
    Schema.Struct({
      name: Schema.String,
      private: Schema.Boolean,
      permissions: Schema.optionalKey(Schema.Struct({ push: Schema.Boolean })),
    }),
  );

  if (target.permissions?.push === true || target.private) return repo;

  const user = yield* Api.json(
    { endpoint: "user", method: "GET", options: { cwd } },
    Schema.Struct({ login: Schema.String }),
  );

  return `${user.login}/${target.name}`;
});

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const markdownLink = (path: string, alt: string, url: string) => {
  const type = Attachment.contentType(path);

  if (type.startsWith("image/")) return `![${alt}](${url})`;

  return type.startsWith("video/") ? url : `[${alt}](${url})`;
};

/**
 * Upload attachments and swap each local path in the texts for its URL. Files no text references
 * are added to the end of the first text.
 */
const attach = Effect.fn("gh.attach")(function* (
  texts: readonly string[],
  attachments: AttachmentList,
  call: GhCall,
  upload: string | undefined,
) {
  if (attachments === undefined || attachments.length === 0) return texts;

  const target = upload ?? (yield* uploadTarget(call.repo || (yield* currentRepository(call.cwd)), call.cwd));
  const result = [...texts];

  for (const file of attachments) {
    const url = yield* Attachment.upload({ repository: target, path: file.path }, { cwd: call.cwd });
    const pattern = new RegExp(`(?:\\./)?${escapeRegExp(file.path.replace(/^\.\//, ""))}`, "g");
    const referenced = result.some((text) => new RegExp(pattern.source).test(text));

    if (referenced) {
      for (const [index, text] of result.entries()) result[index] = text.replace(pattern, url);
    } else {
      result[0] = `${result[0] ?? ""}\n\n${markdownLink(file.path, file.alt, url)}`.trimStart();
    }
  }

  return result;
});

const attachOne = (text: string, attachments: AttachmentList, call: GhCall, upload: string | undefined) =>
  attach([text], attachments, call, upload).pipe(Effect.map((texts) => texts[0] ?? text));

const postComment = (repo: string, issue: number, text: string, cwd: string) => {
  const { path, hostname } = restTarget(repo);

  const request: Api.Request = {
    endpoint: `repos/${path}/issues/${issue}/comments`,
    method: "POST",
    body: { body: text },
    options: { cwd },
  };

  return Api.json(
    hostname === undefined ? request : { ...request, hostname },
    Schema.Struct({ id: Schema.Int, html_url: Schema.String }),
  ).pipe(Effect.map((comment) => ({ id: comment.id, url: comment.html_url })));
};

/** An API endpoint with owners, repositories, numbers and SHAs as placeholders, so "always allow" covers its shape. */
const endpointPattern = (endpoint: string) =>
  (endpoint.replace(/^https?:\/\/[^/]+\//, "").replace(/^\//, "").split(/[?#]/)[0] ?? "")
    .replace(/^repos\/[^/]+\/[^/]+/, "repos/{owner}/{repo}")
    .replace(/\/[0-9a-f]{40}(?=\/|$)/g, "/{sha}")
    .replace(/\/\d+(?=\/|$)/g, "/{number}");

const prViewFields = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "author",
  "headRefName",
  "headRefOid",
  "baseRefName",
  "body",
  "reviewDecision",
  "mergeStateStatus",
  "labels",
  "assignees",
  "mergedAt",
  "autoMergeRequest",
] as const;

const prListFields = ["number", "title", "url", "state", "isDraft", "author", "headRefName", "labels"] as const;

const issueViewFields = ["number", "title", "url", "state", "updatedAt", "author", "labels", "body"] as const;

const issueListFields = ["number", "title", "url", "state", "updatedAt", "author", "labels"] as const;

const releaseFields = [
  "tagName",
  "name",
  "url",
  "body",
  "isDraft",
  "isPrerelease",
  "targetCommitish",
  "publishedAt",
  "assets",
] as const;

const runStatus = Schema.Literals([
  "queued",
  "completed",
  "in_progress",
  "requested",
  "waiting",
  "pending",
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "success",
  "timed_out",
]);

const InlineComment = Schema.Struct({
  path: Schema.String.annotate({ description: "The file's path in the repository" }),
  line: Schema.Int.annotate({ description: "The last line of the range the comment applies to" }),
  body: body("comment"),
  side: Schema.optionalKey(Schema.Literals(["LEFT", "RIGHT"])).annotate({
    description: "RIGHT (the default) for the new side of the diff, LEFT for the old",
  }),
  startLine: Schema.optionalKey(Schema.Int).annotate({ description: "The first line, for a comment on a range" }),
  startSide: Schema.optionalKey(Schema.Literals(["LEFT", "RIGHT"])),
});

const ReleaseSettings = {
  title: Schema.optionalKey(Schema.String),
  notes: Schema.optionalKey(Schema.String).annotate({ description: "The release notes in GitHub Markdown" }),
  target: Schema.optionalKey(Schema.String).annotate({
    description: "The branch or full commit SHA to create the tag from",
  }),
  draft: Schema.optionalKey(Schema.Boolean),
  prerelease: Schema.optionalKey(Schema.Boolean),
};

/** GitHub through the effect-gh client, run in the session directory. */
export const ghNamespace: ClientNamespace = {
  kind: "client",
  command: "gh",
  description:
    "GitHub through the gh CLI: pull requests and their reviews, review threads and comments, issues, discussions, releases, Actions runs and code search. `repo` defaults to the session directory's repository. Text writes take `attachments` ([{ path, alt }]), uploaded and swapped in for their local paths, including in reviews, inline review comments and discussions. Prefer the typed tools; `api` (REST) and `graphql` are the escape hatches, and run without asking for GET and HEAD requests and query-only documents.",
  available: commandExists("gh"),
  tools: [
    ghTool({
      name: "repo_view",
      description: "View a repository: its name with owner, URL, default branch and whether it's private.",
      access: "read",
      repo: "local",
      input: Schema.Struct({ repo }),
      run: (_, call) => Repository.view(call.repo || undefined, { cwd: call.cwd }),
    }),
    ghTool({
      name: "pr_view",
      description:
        "View a pull request, or the current branch's: title, body, state, author, head and base, head commit, review decision, merge state, labels and assignees.",
      access: "read",
      pinned: true,
      repo: "local",
      input: Schema.Struct({ repo, number: Schema.optionalKey(selector) }),
      run: (input, call) =>
        PullRequest.get(
          { repository: call.repo || undefined, selector: input.number, fields: prViewFields },
          { cwd: call.cwd },
        ),
    }),
    ghTool({
      name: "pr_list",
      description: "List pull requests, 30 open ones by default, newest first.",
      access: "read",
      pinned: true,
      repo: "local",
      input: Schema.Struct({
        repo,
        state: Schema.optionalKey(Schema.Literals(["open", "closed", "merged", "all"])),
        limit: Schema.optionalKey(Schema.Int),
        base: Schema.optionalKey(Schema.String).annotate({ description: "Only pull requests into this branch" }),
        head: Schema.optionalKey(Schema.String).annotate({ description: "Only pull requests from this branch" }),
        search: Schema.optionalKey(Schema.String).annotate({ description: "GitHub search qualifiers, such as author:@me" }),
      }),
      run: ({ ...input }, call) =>
        PullRequest.query({ ...input, repository: call.repo || undefined, fields: prListFields }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "pr_checks",
      description:
        "A pull request's checks with their state and bucket (pass, fail, pending, skipping, cancel), and the overall status.",
      access: "read",
      input: Schema.Struct({
        repo,
        number: selector,
        required: Schema.optionalKey(Schema.Boolean).annotate({ description: "Only required checks" }),
      }),
      run: (input, call) =>
        PullRequest.checks(input.number, { repository: call.repo, required: input.required, cwd: call.cwd }),
    }),
    ghTool({
      name: "pr_diff",
      description: "A pull request's unified diff.",
      access: "read",
      input: Schema.Struct({ repo, number: selector }),
      run: (input, call) => PullRequest.diff(input.number, { repository: call.repo, cwd: call.cwd }),
    }),
    ghTool({
      name: "pr_reviews",
      description: "Every review on a pull request with its author, state and body, oldest first.",
      access: "read",
      input: Schema.Struct({ repo, number: number("pull request") }),
      run: (input, call) => Review.list({ repo: call.repo, number: input.number }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "pr_review_threads",
      description:
        "Every review thread on a pull request with its ID, path, line, whether it's resolved or outdated, and its comments. Reply with review_thread_reply and resolve with review_thread_resolve by thread ID.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        repo,
        number: number("pull request"),
        unresolvedOnly: Schema.optionalKey(Schema.Boolean),
      }),
      run: (input, call) => Review.threads({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "pr_comments",
      description:
        "Every conversation comment on a pull request, oldest first, with its numeric ID for comment_edit. Inline review comments are in pr_review_threads.",
      access: "read",
      input: Schema.Struct({ repo, number: number("pull request") }),
      run: (input, call) => Comment.list({ repo: call.repo, number: input.number }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "issue_view",
      description: "View an issue with its body, author and labels.",
      access: "read",
      repo: "local",
      input: Schema.Struct({
        repo,
        number: Schema.Union([Schema.Int, Schema.String]).annotate({ description: "The issue's number or URL" }),
      }),
      run: (input, call) =>
        Issue.get(input.number, { repo: call.repo || undefined, fields: issueViewFields }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "issue_list",
      description: "List issues, 30 open ones by default.",
      access: "read",
      repo: "local",
      input: Schema.Struct({
        repo,
        state: Schema.optionalKey(Schema.Literals(["open", "closed", "all"])),
        limit: Schema.optionalKey(Schema.Int),
        labels: Schema.optionalKey(Schema.Array(Schema.String)),
        assignee: Schema.optionalKey(Schema.String),
        search: Schema.optionalKey(Schema.String).annotate({ description: "GitHub search qualifiers" }),
      }),
      run: ({ ...input }, call) =>
        Issue.query({ ...input, repo: call.repo || undefined, fields: issueListFields }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "issue_comments",
      description: "Every comment on an issue, oldest first, with its numeric ID for comment_edit.",
      access: "read",
      input: Schema.Struct({ repo, number: number("issue") }),
      run: (input, call) => Comment.list({ repo: call.repo, number: input.number }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "discussion_view",
      description: "View a discussion with its body, category and whether it's answered.",
      access: "read",
      input: Schema.Struct({ repo, number: number("discussion") }),
      run: (input, call) => Discussion.view({ repo: call.repo, number: input.number }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "discussion_list",
      description: "List discussions, 30 open ones by default, most recently updated first.",
      access: "read",
      input: Schema.Struct({
        repo,
        state: Schema.optionalKey(Schema.Literals(["open", "closed", "all"])),
        limit: Schema.optionalKey(Schema.Int),
      }),
      run: (input, call) => Discussion.list({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "discussion_comments",
      description:
        "Every top-level comment on a discussion with its replies and node ID, which discussion_comment takes as replyTo.",
      access: "read",
      input: Schema.Struct({ repo, number: number("discussion") }),
      run: (input, call) => Discussion.comments({ repo: call.repo, number: input.number }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "release_view",
      description: "View a release, or the latest one, with its notes and assets.",
      access: "read",
      repo: "local",
      input: Schema.Struct({ repo, tag: Schema.optionalKey(Schema.String) }),
      run: (input, call) =>
        Release.view({ repo: call.repo || undefined, tag: input.tag, fields: releaseFields }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "release_list",
      description: "List releases, newest first.",
      access: "read",
      repo: "local",
      input: Schema.Struct({ repo, limit: Schema.optionalKey(Schema.Int) }),
      run: (input, call) =>
        withGh((gh) =>
          gh.json(
            [
              "release",
              "list",
              "--json=tagName,name,isDraft,isPrerelease,isLatest,publishedAt",
              `--limit=${input.limit ?? 30}`,
              ...(call.repo ? [`--repo=${call.repo}`] : []),
            ],
            Schema.Unknown,
            { cwd: call.cwd },
          ),
        ),
    }),
    ghTool({
      name: "search_code",
      description: "Search code on GitHub with code search, by query, owner, repository or file name.",
      access: "read",
      repo: "none",
      input: Schema.Struct({
        query: Schema.String,
        owner: Schema.optionalKey(Schema.String),
        repo: Schema.optionalKey(Schema.String).annotate({ description: "Only this OWNER/REPO" }),
        filename: Schema.optionalKey(Schema.String),
        limit: Schema.optionalKey(Schema.Int),
      }),
      run: (input, call) => Search.code(input, { cwd: call.cwd }),
    }),
    ghTool({
      name: "rate_limit",
      description: "The REST, GraphQL and search quotas left, with their reset times in epoch seconds.",
      access: "read",
      repo: "none",
      input: Schema.Struct({}),
      run: (_, call) =>
        Api.json(
          { endpoint: "rate_limit", method: "GET", options: { cwd: call.cwd } },
          Schema.Struct({ resources: Schema.Record(Schema.String, Schema.Unknown) }),
        ).pipe(Effect.map((response) => response.resources)),
    }),
    ghTool({
      name: "run_list",
      description: "List recent Actions runs, 20 by default, newest first.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        repo,
        limit: Schema.optionalKey(Schema.Int),
        branch: Schema.optionalKey(Schema.String),
        commit: Schema.optionalKey(Schema.String),
        workflow: Schema.optionalKey(Schema.String).annotate({ description: "The workflow's name, file name or ID" }),
        status: Schema.optionalKey(runStatus),
      }),
      run: (input, call) => Workflow.list({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "run_view",
      description: "View an Actions run's status and conclusion, the latest attempt unless attempt is set.",
      access: "read",
      input: Schema.Struct({ repo, runId: Schema.Int, attempt: Schema.optionalKey(Schema.Int) }),
      run: (input, call) => Workflow.view({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "run_jobs",
      description: "An Actions run's jobs and their steps, with their IDs for run_logs and run_rerun.",
      access: "read",
      input: Schema.Struct({ repo, runId: Schema.Int, attempt: Schema.optionalKey(Schema.Int) }),
      run: (input, call) => Workflow.jobs({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "run_logs",
      description: "An Actions run's logs, or only its failed steps' with failedOnly, optionally for one job.",
      access: "read",
      input: Schema.Struct({
        repo,
        runId: Schema.Int,
        attempt: Schema.optionalKey(Schema.Int),
        failedOnly: Schema.optionalKey(Schema.Boolean),
        job: Schema.optionalKey(Schema.Int).annotate({ description: "The job's ID from run_jobs" }),
      }),
      run: (input, call) => Workflow.logs({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "pr_create",
      description:
        "Open a pull request and return its URL. The head defaults to the session directory's current branch, and the base to the repository's default branch; pass head as OWNER:BRANCH for a fork.",
      access: "write",
      input: Schema.Struct({
        repo,
        title: Schema.String,
        body: body("description"),
        base: Schema.optionalKey(Schema.String),
        head: Schema.optionalKey(Schema.String),
        draft: Schema.optionalKey(Schema.Boolean),
        assignees: Schema.optionalKey(Schema.Array(Schema.String)),
        labels: Schema.optionalKey(Schema.Array(Schema.String)),
        attachments: Attachments,
        uploadRepository,
      }),
      run: (input, call) =>
        Effect.gen(function* () {
          const head = input.head ?? (yield* runCliText("git", ["branch", "--show-current"], { cwd: call.cwd }));

          const base =
            input.base ?? (yield* Repository.view(call.repo, { cwd: call.cwd })).defaultBranchRef?.name ?? "main";

          const text = yield* attachOne(input.body, input.attachments, call, input.uploadRepository);

          const created = yield* PullRequest.create(
            {
              repository: call.repo,
              base,
              head,
              title: input.title,
              body: text,
              assignees: input.assignees,
              draft: input.draft,
            },
            { cwd: call.cwd },
          );

          if (input.labels !== undefined && input.labels.length > 0)
            yield* PullRequest.edit(created.url, { repository: call.repo, addLabels: input.labels }, { cwd: call.cwd });

          return created;
        }),
    }),
    ghTool({
      name: "pr_edit",
      description: "Change a pull request's title, body, labels or assignees.",
      access: "write",
      input: Schema.Struct({
        repo,
        number: selector,
        title: Schema.optionalKey(Schema.String),
        body: Schema.optionalKey(body("description")),
        addLabels: Schema.optionalKey(Schema.Array(Schema.String)),
        removeLabels: Schema.optionalKey(Schema.Array(Schema.String)),
        addAssignees: Schema.optionalKey(Schema.Array(Schema.String)),
        attachments: Attachments,
        uploadRepository,
      }),
      run: ({ number: pr, attachments, uploadRepository: upload, ...input }, call) =>
        Effect.gen(function* () {
          const text =
            input.body === undefined ? undefined : yield* attachOne(input.body, attachments, call, upload);

          yield* PullRequest.edit(pr, { ...input, body: text, repository: call.repo }, { cwd: call.cwd });
        }),
    }),
    ghTool({
      name: "pr_comment",
      description: "Comment on a pull request's conversation and return the comment's ID and URL.",
      access: "write",
      input: Schema.Struct({
        repo,
        number: number("pull request"),
        body: body("comment"),
        attachments: Attachments,
        uploadRepository,
      }),
      run: (input, call) =>
        attachOne(input.body, input.attachments, call, input.uploadRepository).pipe(
          Effect.flatMap((text) => postComment(call.repo, input.number, text, call.cwd)),
        ),
    }),
    ghTool({
      name: "pr_review",
      description:
        "Submit a review on the head commit you read: approve, request changes or comment, with optional inline comments. Fails if the branch has moved.",
      access: "write",
      input: Schema.Struct({
        repo,
        number: number("pull request"),
        event: Schema.Literals(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
        headSha,
        body: Schema.optionalKey(body("review")).annotate({
          description: "The review body in GitHub Markdown. Required to request changes or comment",
        }),
        comments: Schema.optionalKey(Schema.Array(InlineComment)),
        attachments: Attachments,
        uploadRepository,
      }),
      run: (input, call) =>
        Effect.gen(function* () {
          const current = yield* PullRequest.get(
            { repository: call.repo, selector: input.number, fields: ["headRefOid"] },
            { cwd: call.cwd },
          );

          if (current.headRefOid !== input.headSha)
            return yield* new Tool.Error({
              message: `The head moved from ${input.headSha} to ${current.headRefOid}; review the new commits first.`,
            });

          const comments = input.comments ?? [];

          const [text = "", ...bodies] = yield* attach(
            [input.body ?? "", ...comments.map((comment) => comment.body)],
            input.attachments,
            call,
            input.uploadRepository,
          );

          const review = {
            repo: call.repo,
            number: input.number,
            event: input.event,
            commitId: input.headSha,
          } satisfies Review.SubmitOptions;

          const withBody = text === "" ? review : { ...review, body: text };

          return yield* Review.submit(
            comments.length === 0
              ? withBody
              : {
                  ...withBody,
                  comments: comments.map((comment, index) => ({ ...comment, body: bodies[index] ?? comment.body })),
                },
            { cwd: call.cwd },
          );
        }),
    }),
    ghTool({
      name: "pr_merge",
      description:
        "Merge a pull request pinned to the head commit you reviewed, or turn on auto-merge with auto, then return its state.",
      access: "write",
      input: Schema.Struct({
        repo,
        number: number("pull request"),
        method: Schema.Literals(["squash", "merge", "rebase"]),
        headSha,
        auto: Schema.optionalKey(Schema.Boolean).annotate({
          description: "Merge once its requirements are met instead of now",
        }),
      }),
      resource: (input, repo) => `${repo} ${input.method}`,
      run: (input, call) =>
        Effect.gen(function* () {
          yield* withGh((gh) =>
            gh.execute(
              [
                "pr",
                "merge",
                `--repo=${call.repo}`,
                `--${input.method}`,
                `--match-head-commit=${input.headSha}`,
                ...(input.auto ? ["--auto"] : []),
                "--",
                String(input.number),
              ],
              { cwd: call.cwd },
            ),
          );

          return yield* PullRequest.get(
            {
              repository: call.repo,
              selector: input.number,
              fields: ["state", "mergedAt", "autoMergeRequest", "url"],
            },
            { cwd: call.cwd },
          );
        }),
    }),
    ghTool({
      name: "review_thread_reply",
      description: "Reply to a review thread by its ID from pr_review_threads.",
      access: "write",
      repo: "local",
      input: Schema.Struct({
        repo: Schema.optionalKey(Schema.String).annotate({
          description: "The pull request's OWNER/REPO, for uploading attachments. Defaults to the session directory's",
        }),
        threadId: Schema.String,
        body: body("reply"),
        attachments: Attachments,
        uploadRepository,
      }),
      run: (input, call) =>
        attachOne(input.body, input.attachments, call, input.uploadRepository).pipe(
          Effect.flatMap((text) => Review.reply({ threadId: input.threadId, body: text }, { cwd: call.cwd })),
        ),
    }),
    ghTool({
      name: "review_thread_resolve",
      description: "Resolve a review thread by its ID from pr_review_threads.",
      access: "write",
      repo: "none",
      input: Schema.Struct({ threadId: Schema.String }),
      run: (input, call) => Review.resolve({ threadId: input.threadId }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "review_thread_unresolve",
      description: "Unresolve a review thread by its ID from pr_review_threads.",
      access: "write",
      repo: "none",
      input: Schema.Struct({ threadId: Schema.String }),
      run: (input, call) => Review.unresolve({ threadId: input.threadId }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "comment_edit",
      description:
        "Replace the body of your pull request or issue comment, or with kind review your inline review comment, by its numeric ID.",
      access: "write",
      input: Schema.Struct({
        repo,
        id: Schema.Int.annotate({ description: "The comment's numeric ID" }),
        kind: Schema.optionalKey(Schema.Literals(["issue", "review"])),
        body: body("comment"),
        attachments: Attachments,
        uploadRepository,
      }),
      run: ({ attachments, uploadRepository: upload, ...input }, call) =>
        attachOne(input.body, attachments, call, upload).pipe(
          Effect.flatMap((text) => Comment.edit({ ...input, body: text, repo: call.repo }, { cwd: call.cwd })),
        ),
    }),
    ghTool({
      name: "comment_delete",
      description:
        "Delete your pull request or issue comment, or with kind review your inline review comment, by its numeric ID.",
      access: "write",
      input: Schema.Struct({
        repo,
        id: Schema.Int,
        kind: Schema.optionalKey(Schema.Literals(["issue", "review"])),
      }),
      run: (input, call) => Comment.remove({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "issue_create",
      description: "Open an issue and return its URL.",
      access: "write",
      input: Schema.Struct({
        repo,
        title: Schema.String,
        body: body("issue"),
        labels: Schema.optionalKey(Schema.Array(Schema.String)),
        attachments: Attachments,
        uploadRepository,
      }),
      run: (input, call) =>
        attachOne(input.body, input.attachments, call, input.uploadRepository).pipe(
          Effect.flatMap((text) =>
            Issue.create({ repo: call.repo, title: input.title, body: text, labels: input.labels }, { cwd: call.cwd }),
          ),
        ),
    }),
    ghTool({
      name: "issue_edit",
      description: "Change an issue's title, body or labels.",
      access: "write",
      input: Schema.Struct({
        repo,
        number: number("issue"),
        title: Schema.optionalKey(Schema.String),
        body: Schema.optionalKey(body("issue")),
        addLabels: Schema.optionalKey(Schema.Array(Schema.String)),
        removeLabels: Schema.optionalKey(Schema.Array(Schema.String)),
        attachments: Attachments,
        uploadRepository,
      }),
      run: ({ number: issue, attachments, uploadRepository: upload, ...input }, call) =>
        Effect.gen(function* () {
          const text =
            input.body === undefined ? undefined : yield* attachOne(input.body, attachments, call, upload);

          yield* Issue.edit(issue, { ...input, body: text, repo: call.repo }, { cwd: call.cwd });
        }),
    }),
    ghTool({
      name: "issue_comment",
      description: "Comment on an issue and return the comment's ID and URL.",
      access: "write",
      input: Schema.Struct({
        repo,
        number: number("issue"),
        body: body("comment"),
        attachments: Attachments,
        uploadRepository,
      }),
      run: (input, call) =>
        attachOne(input.body, input.attachments, call, input.uploadRepository).pipe(
          Effect.flatMap((text) => postComment(call.repo, input.number, text, call.cwd)),
        ),
    }),
    ghTool({
      name: "issue_close",
      description: "Close an issue as completed or not planned, optionally with a closing comment.",
      access: "write",
      input: Schema.Struct({
        repo,
        number: number("issue"),
        reason: Schema.optionalKey(Schema.Literals(["completed", "not planned"])),
        comment: Schema.optionalKey(Schema.String),
      }),
      run: (input, call) =>
        withGh((gh) =>
          gh.execute(
            [
              "issue",
              "close",
              `--repo=${call.repo}`,
              ...(input.reason === undefined ? [] : [`--reason=${input.reason}`]),
              ...(input.comment === undefined ? [] : [`--comment=${input.comment}`]),
              "--",
              String(input.number),
            ],
            { cwd: call.cwd },
          ),
        ).pipe(Effect.asVoid),
    }),
    ghTool({
      name: "discussion_comment",
      description:
        "Comment on a discussion, or reply to one of its comments with replyTo, and return the comment's ID and URL.",
      access: "write",
      input: Schema.Struct({
        repo,
        number: number("discussion"),
        body: body("comment"),
        replyTo: Schema.optionalKey(Schema.String).annotate({
          description: "The node ID of the top-level comment to reply to, from discussion_comments",
        }),
        attachments: Attachments,
        uploadRepository,
      }),
      run: (input, call) =>
        attachOne(input.body, input.attachments, call, input.uploadRepository).pipe(
          Effect.flatMap((text) =>
            input.replyTo === undefined
              ? Discussion.comment({ repo: call.repo, number: input.number, body: text }, { cwd: call.cwd })
              : Discussion.reply({ commentId: input.replyTo, body: text }, { cwd: call.cwd }),
          ),
        ),
    }),
    ghTool({
      name: "release_create",
      description: "Create a release and return its URL. Asset paths are relative to the session directory.",
      access: "write",
      input: Schema.Struct({
        repo,
        tag: Schema.String,
        ...ReleaseSettings,
        generateNotes: Schema.optionalKey(Schema.Boolean).annotate({
          description: "Generate notes from merged pull requests",
        }),
        notesStartTag: Schema.optionalKey(Schema.String),
        verifyTag: Schema.optionalKey(Schema.Boolean).annotate({
          description: "Fail unless the tag already exists on the remote",
        }),
        assets: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
      run: (input, call) => Release.create({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "release_edit",
      description: "Change a release's title, notes, target, or draft and prerelease state.",
      access: "write",
      input: Schema.Struct({ repo, tag: Schema.String, ...ReleaseSettings }),
      run: (input, call) => Release.edit({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "release_upload",
      description:
        "Upload asset files to a release, replacing ones with the same name with clobber. Paths are relative to the session directory.",
      access: "write",
      timeout: "10 minutes",
      input: Schema.Struct({
        repo,
        tag: Schema.String,
        assets: Schema.Array(Schema.String),
        clobber: Schema.optionalKey(Schema.Boolean),
      }),
      run: (input, call) => Release.upload({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "run_rerun",
      description: "Rerun an Actions run, only its failed jobs with failedOnly, or one job.",
      access: "write",
      input: Schema.Struct({
        repo,
        runId: Schema.Int,
        failedOnly: Schema.optionalKey(Schema.Boolean),
        job: Schema.optionalKey(Schema.Int).annotate({ description: "The job's ID from run_jobs" }),
      }),
      run: (input, call) => Workflow.rerun({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "workflow_dispatch",
      description: "Start a workflow_dispatch run of a workflow, by file name or ID.",
      access: "write",
      input: Schema.Struct({
        repo,
        workflow: Schema.String,
        ref: Schema.optionalKey(Schema.String),
        inputs: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      }),
      resource: (input, repo) => `${repo} ${input.workflow}`,
      run: (input, call) => Workflow.dispatch({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "label_create",
      description: "Create a label, or update it with force.",
      access: "write",
      input: Schema.Struct({
        repo,
        name: Schema.String,
        color: Schema.optionalKey(Schema.String).annotate({ description: "A hex colour without #" }),
        description: Schema.optionalKey(Schema.String),
        force: Schema.optionalKey(Schema.Boolean),
      }),
      run: (input, call) => Label.create({ ...input, repo: call.repo }, { cwd: call.cwd }),
    }),
    ghTool({
      name: "upload_attachment",
      description:
        "Upload one file as a GitHub attachment and return its URL and Markdown. Prefer a write's attachments; the asset 404s until a post uses it.",
      access: "write",
      repo: "local",
      input: Schema.Struct({
        repo: Schema.optionalKey(Schema.String).annotate({
          description: "The OWNER/REPO the post is in. Defaults to the session directory's",
        }),
        path: Schema.String,
        alt: Schema.optionalKey(Schema.String),
        uploadRepository,
      }),
      run: (input, call) =>
        Effect.gen(function* () {
          const target =
            input.uploadRepository ?? (yield* uploadTarget(call.repo || (yield* currentRepository(call.cwd)), call.cwd));

          const url = yield* Attachment.upload({ repository: target, path: input.path }, { cwd: call.cwd });

          return { url, repository: target, markdown: markdownLink(input.path, input.alt ?? "", url) };
        }),
    }),
    ghTool({
      name: "api",
      description:
        "Call the GitHub REST API, for what the typed tools don't cover. GET and HEAD run without asking; other methods ask. {owner} and {repo} in the endpoint are filled from the session directory's repository. Returns the JSON response, or text when it isn't JSON. Use graphql for GraphQL.",
      access: "read",
      repo: "none",
      timeout: "5 minutes",
      input: Schema.Struct({
        endpoint: Schema.String.annotate({ description: "A path such as repos/{owner}/{repo}/pulls, or a full URL" }),
        method: Schema.optionalKey(Schema.Literals(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])).annotate({
          description: "GET by default",
        }),
        query: Schema.optionalKey(
          Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
        ),
        headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
        body: Schema.optionalKey(Schema.Json).annotate({ description: "The JSON request body" }),
        paginate: Schema.optionalKey(Schema.Boolean).annotate({
          description: "Fetch every page of a GET, returned as an array of pages",
        }),
      }),
      classify: (input) => {
        const method = input.method ?? "GET";

        if (/^\/?graphql(?:[?#]|$)/.test(input.endpoint))
          return Effect.fail(new Tool.Error({ message: "Use the graphql tool for GraphQL" }));

        return Effect.succeed({
          access: method === "GET" || method === "HEAD" ? "read" : "write",
          resource: `${method} ${endpointPattern(input.endpoint)}`,
        });
      },
      run: ({ paginate, body: requestBody, ...input }, call) => {
        const request = { ...input, method: input.method ?? "GET", options: { cwd: call.cwd } };

        if (paginate && requestBody === undefined && request.method === "GET")
          return Api.pages({ ...request, method: "GET" }, Schema.Unknown);

        return Api.text(requestBody === undefined ? request : { ...request, body: requestBody }).pipe(
          Effect.map((output) =>
            Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(output), () => output),
          ),
        );
      },
    }),
    ghTool({
      name: "graphql",
      description:
        "Run a GitHub GraphQL document, for what the typed tools don't cover. Query-only documents run without asking; mutations ask. Returns the response's data.",
      access: "read",
      repo: "none",
      input: Schema.Struct({
        document: Schema.String.annotate({ description: "The GraphQL query or mutation" }),
        variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
      }),
      classify: (input) =>
        Graphql.operations(input.document).pipe(
          Effect.flatMap((operations) => {
            if (operations.length === 0)
              return Effect.fail(new Tool.Error({ message: "The document has no operation" }));

            if (operations.some((operation) => operation.kind === "subscription"))
              return Effect.fail(new Tool.Error({ message: "Subscriptions aren't supported" }));

            const writes = operations.filter((operation) => operation.kind === "mutation");

            return Effect.succeed({
              access: writes.length === 0 ? ("read" as const) : ("write" as const),
              resource:
                writes.length === 0
                  ? `query ${operations.flatMap((operation) => operation.fields).join(",")}`
                  : `mutation ${writes.flatMap((operation) => operation.fields).join(",")}`,
            });
          }),
        ),
      run: (input, call) => Graphql.query(input.document, input.variables, Schema.Unknown, { cwd: call.cwd }),
    }),
  ],
};
