import { join, relative } from "node:path";
import { Clock, Effect, FileSystem, Option, Schema, Stream } from "effect";
import semver from "semver";
import {
  CommandError,
  CommandExecutor,
} from "../../services/CommandExecutor.js";
import {
  normalizeGitHubSlug,
  type GitManagedRepo,
} from "../../services/GitConfig.js";
import { formatCause, isString } from "../../lib/schema.js";
import { GitHub } from "../services/GitHub.js";
import { evidenceId } from "./changes.js";
import { releasePaths } from "./state.js";
import {
  ReleaseError,
  type ReleaseSettings,
  type ReleaseSnapshot,
  type ReleaseVersionFile,
} from "./types.js";

/** How supplied release notes combine with GitHub-generated notes. */
export type ReleaseNotesMode = "prepend" | "replace";

/** Release notes read from a file when the plan is built. */
export interface ReleaseNotes {
  /** File the notes were read from. */
  readonly file: string;
  /** Whether the notes precede or replace the generated notes. */
  readonly mode: ReleaseNotesMode;
  /** Trimmed notes text bound to the plan identity. */
  readonly text: string;
}

/** Preview selection, or explicit confirmation of the returned plan identity. */
export interface ReleasePublishAction {
  /** Configured name or GitHub slug. */
  readonly repo: string;
  /** Exact reviewed snapshot. */
  readonly snapshot: string;
  /** Plan identity returned by an unconfirmed preview. */
  readonly confirm?: string;
  /** Markdown file with hand-written release notes. */
  readonly notesFile?: string;
  /** How the notes file combines with generated notes; defaults to prepend. */
  readonly notesMode?: ReleaseNotesMode;
}

/** Visible operation/output events delivered while creating a release. */
export type ReleaseProgress = (message: string) => Effect.Effect<void>;

/** Complete explanation bound to a confirmation token. */
export interface ReleasePlan {
  /** Identity of the source, recipe and proposed changes. */
  readonly id: string;
  /** GitHub repository. */
  readonly repo: string;
  /** Reviewed snapshot identity. */
  readonly snapshot: string;
  /** Exact starting commit. */
  readonly head: string;
  /** Destination branch. */
  readonly branch: string;
  /** New stable release tag. */
  readonly tag: string;
  /** Baseline for GitHub-generated release notes, or null for the first release. */
  readonly previousTag: string | null;
  /** Hand-written release notes bound to this plan, when supplied. */
  readonly notes?: ReleaseNotes;
  /** Ordered steps shown before confirmation. */
  readonly steps: readonly string[];
  /** Manifest changes, including already-prepared versions. */
  readonly versions: readonly {
    readonly path: string;
    readonly before: string;
    readonly after: string;
  }[];
  /** Commands run in an isolated prepared worktree. */
  readonly commands: readonly (readonly string[])[];
  /** Full progress log, including subprocess output. */
  readonly logPath: string;
}

/** Preview or completed GitHub release, without claiming publication jobs succeeded. */
export type ReleasePublishResult =
  | { readonly type: "plan"; readonly plan: ReleasePlan }
  | {
      readonly type: "created";
      readonly tag: string;
      readonly target: string;
      readonly url: string;
      readonly actionsUrl: string;
      readonly logPath: string;
    };

const Manifest = Schema.fromJsonString(
  Schema.Struct({ version: Schema.String }),
);

const JsonManifest = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
);

function withManifestVersion(content: string, version: string): string {
  const original = Schema.decodeSync(JsonManifest)(content);
  const expected = JSON.stringify({ ...original, version });

  for (const match of content.matchAll(
    /("version"\s*:\s*)"(?:[^"\\]|\\.)*"/g,
  )) {
    const candidate =
      content.slice(0, match.index) +
      match[1] +
      JSON.stringify(version) +
      content.slice(match.index + match[0].length);

    const decoded = Schema.decodeOption(JsonManifest)(candidate);

    if (Option.isSome(decoded) && JSON.stringify(decoded.value) === expected)
      return candidate;
  }

  throw new ReleaseError({
    message:
      "Could not replace the top-level manifest version while preserving formatting",
  });
}

/** Read and replace one supported version literal, preserving every other byte. */
export function prepareReleaseVersion(
  content: string,
  file: ReleaseVersionFile,
  version: string,
) {
  if (isString(file)) {
    const before = Schema.decodeSync(Manifest)(content).version;

    return { before, content: withManifestVersion(content, version) };
  }

  // Tokenise without evaluating Python, so comments and strings cannot mimic keywords.
  const tokens = [
    ...content.matchAll(
      /#[^\r\n]*|'''(?:\\[\s\S]|(?!''')[^\\])*'''|"""(?:\\[\s\S]|(?!""")[^\\])*"""|'(?:\\[\s\S]|[^'\\\r\n])*'|"(?:\\[\s\S]|[^"\\\r\n])*"|[A-Za-z_]\w*|\s+|[^\s]/g,
    ),
  ].filter((token) => !/^(?:\s|#)/.test(token[0]));

  const calls = tokens.flatMap((token, index) =>
    token[0] === "setup" && tokens[index + 1]?.[0] === "(" ? [index + 1] : [],
  );

  const invalid = () =>
    new ReleaseError({
      message: `${file.path} must contain one explicit literal version keyword in a single setup call`,
    });

  if (
    calls.length !== 1 ||
    tokens.some((token) => token[0] === "'" || token[0] === '"')
  )
    throw invalid();
  const opening = calls[0];

  if (tokens[opening - 2]?.[0] === "def") throw invalid();

  if (
    tokens[opening - 2]?.[0] === "." &&
    tokens[opening - 3]?.[0] !== "setuptools"
  )
    throw invalid();
  const stack = ["("];
  let literal: RegExpExecArray | undefined;

  for (let index = opening + 1; index < tokens.length; index++) {
    const token = tokens[index][0];

    if (stack.length === 1) {
      if (token === "*" && tokens[index + 1]?.[0] === "*") throw invalid();

      if (token === "version" && tokens[index + 1]?.[0] === "=") {
        if (literal || !["(", ","].includes(tokens[index - 1][0]))
          throw invalid();
        literal = tokens[index + 2];

        if (
          !literal ||
          !/^(['"])\d+(?:\.\d+)+\1$/.test(literal[0]) ||
          ![",", ")"].includes(tokens[index + 3]?.[0])
        )
          throw invalid();
      }
    }

    if (["(", "[", "{"].includes(token)) stack.push(token);
    else if ([")", "]", "}"].includes(token)) {
      if (stack.pop() !== { ")": "(", "]": "[", "}": "{" }[token])
        throw invalid();

      if (stack.length === 0) break;
    }
  }

  if (stack.length || !literal || !/^\d+(?:\.\d+)+$/.test(version))
    throw invalid();

  return {
    before: literal[0].slice(1, -1),
    content:
      content.slice(0, literal.index + 1) +
      version +
      content.slice(literal.index + literal[0].length - 1),
  };
}

const StableRelease = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  published_at: Schema.NullOr(Schema.String),
});

const ReleasePages = Schema.Array(
  Schema.Array(
    Schema.Struct({ draft: Schema.Boolean, prerelease: Schema.Boolean }),
  ),
);

/** Read the latest stable release, or null when the repository has never published one. */
export const latestStableRelease = Effect.fn("releases.latestStable")(
  function* (repo: string) {
    const github = yield* GitHub;

    const latest = yield* github
      .json(["api", `repos/${repo}/releases/latest`])
      .pipe(
        Effect.mapError((error) => new ReleaseError({ message: error.stderr })),
        Effect.flatMap(Schema.decodeUnknownEffect(StableRelease)),
        Effect.catchIf(
          (error) =>
            error instanceof ReleaseError && /\(HTTP 404\)/.test(error.message),
          () => Effect.succeed(null),
        ),
        Effect.mapError((error) =>
          error instanceof ReleaseError
            ? error
            : new ReleaseError({ message: formatCause(error) }),
        ),
      );

    if (latest) return latest;

    // GitHub also returns 404 when stable releases exist but none is marked latest.
    const pages = yield* github
      .json([
        "api",
        `repos/${repo}/releases?per_page=100`,
        "--paginate",
        "--slurp",
      ])
      .pipe(
        Effect.mapError((error) => new ReleaseError({ message: error.stderr })),
        Effect.flatMap(Schema.decodeUnknownEffect(ReleasePages)),
        Effect.mapError((error) =>
          error instanceof ReleaseError
            ? error
            : new ReleaseError({ message: formatCause(error) }),
        ),
      );

    if (pages.flat().some((release) => !release.draft && !release.prerelease))
      return yield* new ReleaseError({
        message: "GitHub has stable releases, but none is marked as the latest",
      });

    return null;
  },
);

/** Increment a stable SemVer tag using the reviewed consumer impact. */
export function nextReleaseTag(snapshot: ReleaseSnapshot): string;
/** Compute the configured stable tag using an explicitly supplied timestamp. */
export function nextReleaseTag(
  snapshot: ReleaseSnapshot,
  versioning: "semver" | "calver" | undefined,
  timestamp: number,
): string;
/** Compute a tag from the configured scheme and recorded upstream evidence. */
export function nextReleaseTag(
  snapshot: ReleaseSnapshot,
  settings: Pick<ReleaseSettings, "versioning" | "fork">,
  timestamp?: number,
): string;
/** Compute the next stable tag without reading the wall clock. */
export function nextReleaseTag(
  snapshot: ReleaseSnapshot,
  settings:
    | "semver"
    | "calver"
    | Pick<ReleaseSettings, "versioning" | "fork"> = "semver",
  timestamp?: number,
): string {
  const versioning = isString(settings) ? settings : settings.versioning;

  if (versioning === "fork" || versioning === "fork-base-js") {
    const fork = isString(settings) ? undefined : settings.fork;

    if (!fork || snapshot.suggestion === "none" || !snapshot.upstreamBase)
      throw new ReleaseError({
        message:
          "Choose a release impact and refresh the upstream base with fork settings before creating a release",
      });

    if (
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
        snapshot.upstreamBase,
      ) ||
      !semver.valid(snapshot.upstreamBase)
    )
      throw new ReleaseError({
        message:
          "The recorded upstream base must be a bare plain SemVer version; refresh the comparison",
      });

    if (snapshot.releaseTag === null)
      return `${snapshot.upstreamBase}-${fork.suffix}.0`;

    const match =
      /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([0-9A-Za-z-]+)\.(0|[1-9]\d*))?$/.exec(
        snapshot.releaseTag,
      );

    if (
      !match ||
      !semver.valid(match[1]) ||
      (match[2] !== undefined && match[2] !== fork.suffix)
    )
      throw new ReleaseError({
        message: `The fork baseline must be bare X.Y.Z or X.Y.Z-${fork.suffix}.N, without a v prefix`,
      });

    const order = semver.compare(snapshot.upstreamBase, match[1]);

    if (order < 0)
      throw new ReleaseError({
        message:
          "The upstream base is older than the fork release baseline; reconcile it before creating a release",
      });
    const count = match[3] === undefined ? undefined : Number(match[3]);
    const next = order === 0 && count !== undefined ? count + 1 : 0;

    if (
      (count !== undefined && !Number.isSafeInteger(count)) ||
      !Number.isSafeInteger(next)
    )
      throw new ReleaseError({
        message: "Fork release counts must be safe integers",
      });

    return `${snapshot.upstreamBase}-${fork.suffix}.${next}`;
  }

  if (versioning === "calver") {
    const now = new Date(timestamp ?? NaN);

    if (
      snapshot.releaseTag === null &&
      snapshot.suggestion !== "none" &&
      Number.isFinite(now.getTime())
    )
      return `${now.toISOString().slice(0, 10).replaceAll("-", "")}.0`;

    const match = /^(v?)(\d{4})(\d{2})(\d{2})\.(0|[1-9]\d*)$/.exec(
      snapshot.releaseTag ?? "",
    );

    if (
      !match ||
      snapshot.suggestion === "none" ||
      !Number.isFinite(now.getTime()) ||
      now.getUTCFullYear() < 1 ||
      now.getUTCFullYear() > 9999
    )
      throw new ReleaseError({
        message:
          "Choose a release impact, a valid UTC date and a stable YYYYMMDD.N baseline before creating a release",
      });
    const date = `${match[2]}-${match[3]}-${match[4]}`;
    const baseline = new Date(`${date}T00:00:00.000Z`);

    if (
      Number(match[2]) < 1 ||
      !Number.isFinite(baseline.getTime()) ||
      baseline.toISOString().slice(0, 10) !== date
    )
      throw new ReleaseError({
        message: "The CalVer baseline must contain a valid calendar date",
      });
    const today = now.toISOString().slice(0, 10);

    if (date > today)
      throw new ReleaseError({
        message:
          "The CalVer baseline is in the future; reconcile it before creating a release",
      });
    const count = Number(match[5]);
    const next = date === today ? count + 1 : 0;

    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(next))
      throw new ReleaseError({
        message: "CalVer release counts must be safe integers",
      });

    return `${match[1]}${today.replaceAll("-", "")}.${next}`;
  }

  if (snapshot.releaseTag === null && snapshot.suggestion !== "none")
    return snapshot.suggestion === "major" ? "1.0.0" : "0.1.0";

  const match = /^(v?)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    snapshot.releaseTag ?? "",
  );

  if (!match || snapshot.suggestion === "none")
    throw new ReleaseError({
      message:
        "Choose a release impact and a stable SemVer baseline before creating a release",
    });

  let major = Number(match[2]),
    minor = Number(match[3]),
    patch = Number(match[4]);

  if (snapshot.suggestion === "major") {
    major++;
    minor = 0;
    patch = 0;
  } else if (snapshot.suggestion === "minor") {
    minor++;
    patch = 0;
  } else patch++;

  return `${match[1]}${major}.${minor}.${patch}`;
}

/** Build a read-only plan, then execute it only when its exact identity is confirmed. */
export const publishRelease = Effect.fn("releases.publish")(function* (
  repo: GitManagedRepo,
  settings: ReleaseSettings,
  snapshot: ReleaseSnapshot,
  confirmation: string | undefined,
  report: ReleaseProgress,
  notesRequest?: Pick<ReleaseNotes, "file" | "mode">,
) {
  const fs = yield* FileSystem.FileSystem;
  const recipe = settings.publish;

  if (!recipe)
    return yield* new ReleaseError({
      message: "Programmatic releases are not configured for this repository",
    });
  const executor = yield* CommandExecutor;
  const github = yield* GitHub;
  let logFile: string | undefined;

  const progress = Effect.fn("releases.progress")(function* (message: string) {
    if (logFile)
      yield* fs
        .writeFileString(logFile, message + "\n", { flag: "a" })
        .pipe(
          Effect.mapError(
            (error) => new ReleaseError({ message: formatCause(error) }),
          ),
        );
    yield* report(message);
  });

  const notes = notesRequest
    ? yield* fs.readFileString(notesRequest.file).pipe(
        Effect.mapError(
          (error) =>
            new ReleaseError({
              message: `Could not read release notes file ${notesRequest.file}: ${formatCause(error)}`,
            }),
        ),
        Effect.flatMap((content) =>
          content.trim()
            ? Effect.succeed({ ...notesRequest, text: content.trim() })
            : Effect.fail(
                new ReleaseError({
                  message: `Release notes file ${notesRequest.file} is empty`,
                }),
              ),
        ),
      )
    : undefined;

  const timestamp = yield* Clock.currentTimeMillis;

  const tag = yield* Effect.try({
    try: () => nextReleaseTag(snapshot, settings, timestamp),
    catch: (error) => new ReleaseError({ message: formatCause(error) }),
  });

  const version = tag.replace(/^v/, "");

  const git = (args: readonly string[], cwd = repo.path) =>
    executor
      .run("git", args, { cwd })
      .pipe(
        Effect.mapError((error) => new ReleaseError({ message: error.stderr })),
      );

  const remote = (yield* git(["remote", "get-url", "--push", "origin"])).trim();

  if (normalizeGitHubSlug(remote)?.toLowerCase() !== repo.github.toLowerCase())
    return yield* new ReleaseError({
      message:
        "The origin push URL does not match the configured release repository",
    });

  const verifyRemote = Effect.fn("releases.verifyRemote")(function* (
    head: string,
    tagged = false,
  ) {
    yield* progress(
      "Checking the latest stable release, watched branch and new tag",
    );

    const release = yield* latestStableRelease(repo.github);

    const baseline = snapshot.releaseTag;

    const refs = (yield* git([
      "ls-remote",
      remote,
      `refs/heads/${settings.branch}`,
      ...(baseline === null
        ? []
        : [`refs/tags/${baseline}`, `refs/tags/${baseline}^{}`]),
      `refs/tags/${tag}`,
    ]))
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/));

    const ref = (name: string) => refs.find(([, key]) => key === name)?.[0];

    if (
      (release?.tag_name ?? null) !== baseline ||
      release?.draft ||
      release?.prerelease ||
      ref(`refs/heads/${settings.branch}`) !== head ||
      (baseline !== null &&
        (ref(`refs/tags/${baseline}^{}`) ?? ref(`refs/tags/${baseline}`)) !==
          snapshot.releaseCommit)
    )
      return yield* new ReleaseError({
        message:
          "The release baseline or watched branch changed; refresh the review and preview again",
      });

    if (tagged && ref(`refs/tags/${tag}`) !== head)
      return yield* new ReleaseError({
        message: `Tag ${tag} does not point at the prepared commit; inspect GitHub before retrying`,
      });

    if (!tagged && ref(`refs/tags/${tag}`))
      return yield* new ReleaseError({
        message: `Tag ${tag} already exists; inspect it on GitHub before creating another release`,
      });
  });

  yield* verifyRemote(snapshot.head);

  const prepared = yield* Effect.forEach(recipe.version_files, (file) =>
    Effect.gen(function* () {
      const path = isString(file) ? file : file.path;

      const mode = (yield* git(["ls-tree", snapshot.head, "--", path])).split(
        " ",
      )[0];

      if (mode !== "100644" && mode !== "100755")
        return yield* new ReleaseError({
          message: `${path} must be a tracked regular version file`,
        });
      const original = yield* git(["show", `${snapshot.head}:${path}`]);

      const manifest = yield* Effect.try({
        try: () => prepareReleaseVersion(original, file, version),
        catch: (error) => new ReleaseError({ message: formatCause(error) }),
      });

      // A first release adopts whatever version the files already carry.
      if (
        snapshot.releaseTag !== null &&
        ![snapshot.releaseTag.replace(/^v/, ""), version].includes(
          manifest.before,
        )
      )
        return yield* new ReleaseError({
          message: `${path} has version ${manifest.before}; reconcile it with ${tag} in the release preparation session`,
        });

      return { file, path, before: manifest.before, after: version };
    }),
  );

  const versions = prepared.map(({ path, before, after }) => ({
    path,
    before,
    after,
  }));

  const changed = prepared.filter((file) => file.before !== file.after);
  const needsPreparation = changed.length > 0 || recipe.commands.length > 0;
  // Regenerated files only ride along with a version commit.
  const generated = changed.length ? (recipe.generated_files ?? []) : [];

  const extraGenerated = generated.filter(
    (path) => !changed.some((file) => file.path === path),
  );

  const id = evidenceId([
    snapshot.id,
    remote,
    tag,
    recipe,
    versions,
    ...(notes ? [{ mode: notes.mode, text: notes.text }] : []),
  ]);

  const logPath = join(releasePaths(repo.github).state, `publish-${id}.log`);

  const generatedSince =
    snapshot.releaseTag === null
      ? "covering the full history"
      : `starting at ${snapshot.releaseTag}`;

  const steps = [
    ...(needsPreparation
      ? [
          `Prepare an isolated worktree from ${settings.branch} at ${snapshot.head}. Local uncommitted changes are excluded.`,
          "Initialise the prepared worktree's Git submodules.",
        ]
      : [
          `Use the reviewed ${settings.branch} commit ${snapshot.head}. Local uncommitted changes are excluded.`,
        ]),
    ...versions.map(
      (file) =>
        `${file.path}: ${file.before} -> ${file.after}${file.before === file.after ? " (already prepared)" : ""}`,
    ),
    ...recipe.commands.map(
      (command) =>
        `Run: ${command.map((arg) => JSON.stringify(arg)).join(" ")}`,
    ),
    ...(recipe.commands.length
      ? []
      : [
          "No local validation commands are configured; build and package validation runs in the repository's GitHub workflows.",
        ]),
    ...(changed.length
      ? [
          `Commit only ${changed.map((file) => file.path).join(", ")}${extraGenerated.length ? `, plus ${extraGenerated.join(", ")} where the commands regenerate them,` : ""} as "Release ${tag}" through dot git commit.`,
          `Atomically push that version commit to ${repo.github}:${settings.branch} and create tag ${tag}.`,
        ]
      : [
          `Create tag ${tag} at the reviewed commit; no version commit or branch push is needed.`,
        ]),
    ...(notes
      ? [
          `Release notes from ${notes.file}:\n${notes.text.replace(/^/gm, "   ")}`,
        ]
      : []),
    notes?.mode === "replace"
      ? `Create and publish GitHub release ${tag} at the resulting commit, using only the release notes from ${notes.file}.`
      : notes
        ? `Create and publish GitHub release ${tag} at the resulting commit with the release notes from ${notes.file} followed by GitHub-generated notes ${generatedSince}, applied straight after creation.`
        : `Create and publish GitHub release ${tag} at the resulting commit, with GitHub-generated notes ${generatedSince}.`,
    "Publishing the release triggers the repository's release workflows. Their build/package results are available on GitHub Actions.",
    ...(needsPreparation
      ? [
          "Remove the temporary worktree after success; retain it on failure and show its path.",
        ]
      : []),
    `Stream every step and command output here and save the full log to ${logPath}.`,
  ];

  const plan: ReleasePlan = {
    id,
    repo: repo.github,
    snapshot: snapshot.id,
    head: snapshot.head,
    branch: settings.branch,
    tag,
    previousTag: snapshot.releaseTag,
    ...(notes && { notes }),
    steps,
    versions,
    commands: recipe.commands,
    logPath,
  };

  if (confirmation === undefined)
    return { type: "plan", plan } satisfies ReleasePublishResult;

  if (confirmation !== id)
    return yield* new ReleaseError({
      message:
        "The release plan changed; read the new preview before confirming",
    });

  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(releasePaths(repo.github).state, {
      recursive: true,
      mode: 0o700,
    });
    yield* fs.writeFileString(
      logPath,
      "Confirmed release plan\n" + steps.join("\n") + "\n\n",
      { flag: "a", mode: 0o600 },
    );
    logFile = logPath;
  }).pipe(
    Effect.mapError(
      (error) => new ReleaseError({ message: formatCause(error) }),
    ),
  );

  const directory = needsPreparation
    ? yield* Effect.gen(function* () {
        const base = join(releasePaths(repo.github).state, "preparations");
        yield* fs.makeDirectory(base, { recursive: true, mode: 0o700 });

        return join(
          yield* fs.makeTempDirectory({ directory: base, prefix: "release-" }),
          "source",
        );
      }).pipe(
        Effect.mapError(
          (error) => new ReleaseError({ message: formatCause(error) }),
        ),
      )
    : repo.path;

  const run = Effect.fn("releases.runStep")(function* (
    command: string,
    args: readonly string[],
    cwd: string,
  ) {
    yield* progress(
      `$ ${[command, ...args].map((arg) => JSON.stringify(arg)).join(" ")}`,
    );
    yield* executor.stream(command, args, { cwd }).pipe(
      Stream.runForEach(progress),
      Effect.mapError(
        (error) =>
          new ReleaseError({
            message:
              error instanceof CommandError
                ? error.stderr ||
                  `${error.command} exited with code ${error.exitCode}`
                : error.message,
          }),
      ),
    );
    yield* progress(`Completed: ${command} ${args.join(" ")}`);
  });

  return yield* Effect.gen(function* () {
    let target = snapshot.head;

    if (needsPreparation) {
      yield* progress(`Preparing ${tag} in ${directory}`);
      yield* run(
        "git",
        ["worktree", "add", "--detach", directory, snapshot.head],
        repo.path,
      );
      yield* run(
        "git",
        ["submodule", "update", "--init", "--recursive"],
        directory,
      );

      for (const file of changed) {
        yield* progress(
          `Updating ${file.path}: ${file.before} -> ${file.after}`,
        );
        yield* Effect.gen(function* () {
          const path = yield* fs.realPath(join(directory, file.path));

          if (relative(yield* fs.realPath(directory), path).startsWith(".."))
            return yield* new ReleaseError({
              message: `${file.path} leaves the prepared worktree`,
            });
          const content = yield* fs.readFileString(path);
          yield* fs.writeFileString(
            path,
            yield* Effect.try(
              () => prepareReleaseVersion(content, file.file, version).content,
            ),
          );
        }).pipe(
          Effect.mapError(
            (error) => new ReleaseError({ message: formatCause(error) }),
          ),
        );
      }

      for (const command of recipe.commands)
        yield* run(command[0], command.slice(1), directory);
      yield* progress(
        "Checking the validated worktree contains only the agreed version changes",
      );

      const paths = (yield* git(
        ["diff", "HEAD", "--name-only", "-z"],
        directory,
      ))
        .split("\0")
        .filter(Boolean);

      const untracked = (yield* git(
        ["ls-files", "--others", "--exclude-standard"],
        directory,
      )).trim();

      if (
        untracked ||
        paths.some(
          (path) =>
            !changed.some((file) => file.path === path) &&
            !generated.includes(path),
        )
      )
        return yield* new ReleaseError({
          message:
            "Validation changed files outside the confirmed version bump; inspect the retained worktree",
        });

      const regenerated = extraGenerated.filter((path) => paths.includes(path));

      for (const file of prepared) {
        const original = yield* git(["show", `${snapshot.head}:${file.path}`]);
        yield* Effect.gen(function* () {
          const actual = yield* fs.readFileString(join(directory, file.path));

          // A regenerated version file may change elsewhere, but its version must still be exact.
          if (generated.includes(file.path)) {
            if (
              (yield* Effect.try(() =>
                prepareReleaseVersion(actual, file.file, version),
              )).before !== version
            )
              return yield* new ReleaseError({
                message: `Validation left ${file.path} without version ${version}`,
              });

            return;
          }

          const expected =
            file.before === file.after
              ? original
              : yield* Effect.try(
                  () =>
                    prepareReleaseVersion(original, file.file, version).content,
                );

          if (actual !== expected)
            return yield* new ReleaseError({
              message: `Validation changed ${file.path} beyond its agreed version bump`,
            });
        }).pipe(
          Effect.mapError(
            (error) => new ReleaseError({ message: formatCause(error) }),
          ),
        );
      }

      if (
        (yield* git(["rev-parse", "HEAD"], directory)).trim() !== snapshot.head
      )
        return yield* new ReleaseError({
          message: "Validation changed the prepared HEAD; preview again",
        });
      yield* verifyRemote(snapshot.head);

      const diffArgs = [
        "diff",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-prefix",
        snapshot.head,
      ];

      const approvedDiff = yield* git(diffArgs, directory);

      if (changed.length) {
        yield* run(
          "dot",
          [
            "git",
            "commit",
            "-m",
            `Release ${tag}`,
            "--skip-agent-oxlint",
            ...changed.flatMap((file) => ["--path", file.path]),
            ...regenerated.flatMap((path) => ["--path", path]),
          ],
          directory,
        );
        target = (yield* git(["rev-parse", "HEAD"], directory)).trim();

        if (
          (yield* git(["rev-parse", `${target}^`], directory)).trim() !==
            snapshot.head ||
          (yield* git([...diffArgs, target], directory)) !== approvedDiff
        )
          return yield* new ReleaseError({
            message:
              "The version commit differs from the validated changes; inspect the retained worktree",
          });
      }
    }

    yield* verifyRemote(snapshot.head);
    yield* run(
      "git",
      [
        "push",
        "--atomic",
        remote,
        ...(changed.length ? [`${target}:refs/heads/${settings.branch}`] : []),
        `${target}:refs/tags/${tag}`,
      ],
      directory,
    );
    yield* progress(
      changed.length
        ? `Version commit and tag pushed: ${target}. Your original checkout can now be fast-forwarded.`
        : `Tag ${tag} pushed at ${target}`,
    );
    yield* verifyRemote(target, true);
    yield* progress(
      notes?.mode === "replace"
        ? `Creating GitHub release ${tag} at ${target} with the notes from ${notes.file}`
        : `Creating GitHub release ${tag} at ${target} with generated notes ${generatedSince}`,
    );

    const notesPath = join(releasePaths(repo.github).state, `notes-${id}.md`);

    const writeNotes = (content: string) =>
      fs
        .writeFileString(notesPath, content + "\n", { mode: 0o600 })
        .pipe(
          Effect.mapError(
            (error) => new ReleaseError({ message: formatCause(error) }),
          ),
        );

    if (notes?.mode === "replace") yield* writeNotes(notes.text);

    const url = (yield* github
      .run(
        [
          "release",
          "create",
          tag,
          "--repo",
          repo.github,
          "--verify-tag",
          ...(notes?.mode === "replace"
            ? ["--notes-file", notesPath]
            : [
                "--generate-notes",
                ...(snapshot.releaseTag === null
                  ? []
                  : ["--notes-start-tag", snapshot.releaseTag]),
              ]),
        ],
        { retries: 0 },
      )
      .pipe(
        Effect.mapError((error) => new ReleaseError({ message: error.stderr })),
      )).trim();

    if (notes?.mode === "prepend") {
      yield* progress(
        `Applying the notes from ${notes.file} before the generated notes`,
      );

      yield* Effect.gen(function* () {
        const { body } = yield* github
          .json([
            "release",
            "view",
            tag,
            "--repo",
            repo.github,
            "--json",
            "body",
          ])
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Struct({ body: Schema.String }),
              ),
            ),
          );

        yield* writeNotes(
          [notes.text, body.trim()].filter(Boolean).join("\n\n"),
        );

        yield* github.run([
          "release",
          "edit",
          tag,
          "--repo",
          repo.github,
          "--notes-file",
          notesPath,
        ]);
      }).pipe(
        Effect.mapError(
          (error) =>
            new ReleaseError({
              message: `Release ${url} was created, but its notes could not be applied: ${"stderr" in error ? error.stderr : formatCause(error)}. Run gh release edit ${tag} --repo ${repo.github} --notes-file ${notes.file} to apply them.`,
            }),
        ),
      );
    }

    yield* progress(`GitHub release created: ${url}`);
    const actionsUrl = `https://github.com/${repo.github}/actions`;
    yield* progress(`Follow publication jobs: ${actionsUrl}`);

    if (needsPreparation)
      yield* run(
        "git",
        ["worktree", "remove", "--force", "--force", directory],
        repo.path,
      ).pipe(
        Effect.catch((error) =>
          progress(
            `Release created; temporary worktree cleanup failed: ${error.message}`,
          ),
        ),
      );

    return {
      type: "created",
      tag,
      target,
      url,
      actionsUrl,
      logPath,
    } satisfies ReleasePublishResult;
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const message = `${error.message}\n${needsPreparation ? `Prepared worktree retained at ${directory}. ` : ""}Full progress: ${logPath}. If a push or release request failed, inspect GitHub and refresh before retrying.`;
        yield* progress(message);

        return yield* new ReleaseError({ message });
      }),
    ),
  );
});
