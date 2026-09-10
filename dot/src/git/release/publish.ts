import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { Effect, Schema, Stream } from "effect";
import {
  CommandError,
  CommandExecutor,
} from "../../services/CommandExecutor.js";
import {
  normalizeGitHubSlug,
  type GitManagedRepo,
} from "../../services/GitConfig.js";
import { formatCause } from "../../lib/schema.js";
import { GitHub } from "../services/GitHub.js";
import { evidenceId } from "./changes.js";
import { releasePaths } from "./state.js";
import {
  ReleaseError,
  type ReleaseSettings,
  type ReleaseSnapshot,
} from "./types.js";

/** Preview selection, or explicit confirmation of the returned plan identity. */
export interface ReleasePublishAction {
  /** Configured name or GitHub slug. */
  readonly repo: string;
  /** Exact reviewed snapshot. */
  readonly snapshot: string;
  /** Plan identity returned by an unconfirmed preview. */
  readonly confirm?: string;
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
  /** Baseline for GitHub-generated release notes. */
  readonly previousTag: string;
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
  const original = Schema.decodeUnknownSync(JsonManifest)(content);
  const expected = JSON.stringify({ ...original, version });
  for (const match of content.matchAll(
    /("version"\s*:\s*)"(?:[^"\\]|\\.)*"/g,
  )) {
    const candidate =
      content.slice(0, match.index) +
      match[1] +
      JSON.stringify(version) +
      content.slice(match.index + match[0].length);
    const decoded = Schema.decodeUnknownOption(JsonManifest)(candidate);
    if (decoded._tag === "Some" && JSON.stringify(decoded.value) === expected)
      return candidate;
  }
  throw new ReleaseError({
    message:
      "Could not replace the top-level manifest version while preserving formatting",
  });
}
const StableRelease = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
});

/** Increment a stable SemVer tag using the reviewed consumer impact. */
export function nextReleaseTag(snapshot: ReleaseSnapshot): string {
  const match = /^(v?)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    snapshot.releaseTag,
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
) {
  const recipe = settings.publish;
  if (!recipe)
    return yield* new ReleaseError({
      message: "Programmatic releases are not configured for this repository",
    });
  const executor = yield* CommandExecutor;
  const github = yield* GitHub;
  let logFile: string | undefined;
  const progress = Effect.fn("releases.progress")(function* (message: string) {
    yield* Effect.try({
      try: () => {
        if (logFile) appendFileSync(logFile, message + "\n");
      },
      catch: (error) => new ReleaseError({ message: formatCause(error) }),
    });
    yield* report(message);
  });
  const tag = yield* Effect.try({
    try: () => nextReleaseTag(snapshot),
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
    const release = yield* github
      .json(["api", `repos/${repo.github}/releases/latest`])
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(StableRelease)),
        Effect.mapError(
          (error) => new ReleaseError({ message: formatCause(error) }),
        ),
      );
    const refs = (yield* git([
      "ls-remote",
      remote,
      `refs/heads/${settings.branch}`,
      `refs/tags/${snapshot.releaseTag}`,
      `refs/tags/${snapshot.releaseTag}^{}`,
      `refs/tags/${tag}`,
    ]))
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/));
    const ref = (name: string) => refs.find(([, key]) => key === name)?.[0];
    if (
      release.draft ||
      release.prerelease ||
      release.tag_name !== snapshot.releaseTag ||
      ref(`refs/heads/${settings.branch}`) !== head ||
      (ref(`refs/tags/${snapshot.releaseTag}^{}`) ??
        ref(`refs/tags/${snapshot.releaseTag}`)) !== snapshot.releaseCommit
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
  const versions = yield* Effect.forEach(recipe.version_files, (path) =>
    Effect.gen(function* () {
      const mode = (yield* git(["ls-tree", snapshot.head, "--", path])).split(
        " ",
      )[0];
      if (mode !== "100644" && mode !== "100755")
        return yield* new ReleaseError({
          message: `${path} must be a tracked regular JSON file`,
        });
      const manifest = yield* git(["show", `${snapshot.head}:${path}`]).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Manifest)),
        Effect.mapError(
          (error) => new ReleaseError({ message: formatCause(error) }),
        ),
      );
      if (
        ![snapshot.releaseTag.replace(/^v/, ""), version].includes(
          manifest.version,
        )
      )
        return yield* new ReleaseError({
          message: `${path} has version ${manifest.version}; reconcile it with ${tag} in the release preparation session`,
        });
      return { path, before: manifest.version, after: version };
    }),
  );
  const changed = versions.filter((file) => file.before !== file.after);
  const needsPreparation = changed.length > 0 || recipe.commands.length > 0;
  const id = evidenceId([snapshot.id, remote, tag, recipe, versions]);
  const logPath = join(releasePaths(repo.github).state, `publish-${id}.log`);
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
          `Commit only ${changed.map((file) => file.path).join(", ")} as "Release ${tag}" through dot git-commit.`,
          `Atomically push that version commit to ${repo.github}:${settings.branch} and create tag ${tag}.`,
        ]
      : [
          `Create tag ${tag} at the reviewed commit; no version commit or branch push is needed.`,
        ]),
    `Create and publish GitHub release ${tag} at the resulting commit, with GitHub-generated notes starting at ${snapshot.releaseTag}.`,
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

  yield* Effect.try({
    try: () => {
      mkdirSync(releasePaths(repo.github).state, {
        recursive: true,
        mode: 0o700,
      });
      appendFileSync(
        logPath,
        "Confirmed release plan\n" + steps.join("\n") + "\n\n",
        { mode: 0o600 },
      );
      logFile = logPath;
    },
    catch: (error) => new ReleaseError({ message: formatCause(error) }),
  });

  const directory = needsPreparation
    ? yield* Effect.try({
        try: () => {
          const base = join(releasePaths(repo.github).state, "preparations");
          mkdirSync(base, { recursive: true, mode: 0o700 });
          return join(mkdtempSync(join(base, "release-")), "source");
        },
        catch: (error) => new ReleaseError({ message: formatCause(error) }),
      })
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
        yield* Effect.try({
          try: () => {
            const path = realpathSync(join(directory, file.path));
            if (relative(realpathSync(directory), path).startsWith(".."))
              throw new Error(`${file.path} leaves the prepared worktree`);
            const content = readFileSync(path, "utf8");
            writeFileSync(path, withManifestVersion(content, version));
          },
          catch: (error) => new ReleaseError({ message: formatCause(error) }),
        });
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
        paths.some((path) => !changed.some((file) => file.path === path))
      )
        return yield* new ReleaseError({
          message:
            "Validation changed files outside the confirmed version bump; inspect the retained worktree",
        });
      for (const file of versions) {
        const original = yield* git(["show", `${snapshot.head}:${file.path}`]);
        yield* Effect.try({
          try: () => {
            const expected =
              file.before === file.after
                ? original
                : withManifestVersion(original, version);
            if (readFileSync(join(directory, file.path), "utf8") !== expected)
              throw new Error(
                `Validation changed ${file.path} beyond its agreed version bump`,
              );
          },
          catch: (error) => new ReleaseError({ message: formatCause(error) }),
        });
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
            "git-commit",
            "-m",
            `Release ${tag}`,
            ...changed.flatMap((file) => ["--path", file.path]),
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
      `Creating GitHub release ${tag} at ${target} with generated notes since ${snapshot.releaseTag}`,
    );
    const url = (yield* github
      .run(
        [
          "release",
          "create",
          tag,
          "--repo",
          repo.github,
          "--verify-tag",
          "--generate-notes",
          "--notes-start-tag",
          snapshot.releaseTag,
        ],
        { retries: 0 },
      )
      .pipe(
        Effect.mapError((error) => new ReleaseError({ message: error.stderr })),
      )).trim();
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
