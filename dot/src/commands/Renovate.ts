import { Api, Gh, Repository } from "@timmo001/effect-gh";
import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";

/** Options for on-demand dependency update PRs. */
export interface RenovateOptions {
  /** GitHub repository, defaulting to the current directory. */
  readonly repository?: string;
  /** Include dependencies already covered by open Renovate PRs. */
  readonly all: boolean;
  /** Preview updates without writing branches, PRs or issues. */
  readonly dryRun: boolean;
  /** Deadline in milliseconds for each Renovate pass. */
  readonly timeout: number;
}

class RenovateError extends Schema.TaggedError<RenovateError>()(
  "RenovateError",
  { message: Schema.String },
) {}

const OpenPr = Schema.Struct({
  number: Schema.Finite,
  head: Schema.Struct({
    ref: Schema.String,
    repo: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
  }),
});

const Report = Schema.fromJsonString(
  Schema.Struct({
    repositories: Schema.Record(
      Schema.String,
      Schema.Struct({
        branches: Schema.Array(
          Schema.Struct({
            branchName: Schema.String,
            upgrades: Schema.Array(
              Schema.Struct({ depName: Schema.optionalKey(Schema.String) }),
            ),
          }),
        ),
      }),
    ),
  }),
);

/** Run Renovate as the authenticated gh user against a repository's default branch. */
export const renovate = Effect.fn("Renovate.run")(function* (
  options: RenovateOptions,
) {
  const gh = yield* Gh;
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* Config;
  const log = yield* OutputLog;

  const repository = yield* Repository.view(options.repository, {
    cwd: process.cwd(),
    timeout: "30 seconds",
  });

  const hostname = new URL(repository.url).hostname;

  const user = yield* Api.json(
    {
      endpoint: "user",
      method: "GET",
      hostname,
      options: { timeout: "30 seconds" },
    },
    Schema.Struct({ login: Schema.String, type: Schema.String }),
  );

  if (user.type !== "User") {
    return yield* new RenovateError({
      message:
        "Sign gh into a personal GitHub account before running dot renovate",
    });
  }

  const runtimeDirectory = join(config.publicDotfiles, "dot", "renovate");

  yield* executor
    .run("mise", [
      "exec",
      "--cd",
      runtimeDirectory,
      "--",
      "renovate",
      "--version",
    ])
    .pipe(
      Effect.mapError(
        (error) =>
          new RenovateError({
            message: `Could not start the Renovate runtime: ${error.stderr}`,
          }),
      ),
    );

  const directory = yield* fs.makeTempDirectoryScoped({
    prefix: "dot-renovate-",
  });

  const reportPath = join(directory, "report.json");
  const branchPrefix = `dot-renovate/${user.login}/`;

  const token = (yield* gh.execute(["auth", "token", "--hostname", hostname], {
    timeout: "30 seconds",
  })).stdout.trim();

  const run = Effect.fn("Renovate.pass")(function* (
    preview: boolean,
    ignoreDeps: readonly string[],
  ) {
    const dryRun = preview || options.dryRun;

    const force = {
      prHourlyLimit: 0,
      commitHourlyLimit: 0,
      prCommitsPerRunLimit: 0,
      prConcurrentLimit: 0,
      branchConcurrentLimit: 0,
      prCreation: "immediate",
      schedule: ["at any time"],
      dependencyDashboard: false,
      dependencyDashboardTitle: `dot renovate (${user.login})`,
      dependencyDashboardApproval: false,
      suppressNotifications: ["configErrorIssue"],
      automerge: false,
      platformAutomerge: false,
      pruneStaleBranches: false,
      configMigration: false,
      skipArtifactsUpdate: dryRun ? true : undefined,
      branchPrefix: preview ? undefined : branchPrefix,
      branchPrefixOld: preview ? undefined : branchPrefix,
    };

    return yield* executor.inherit(
      "dot",
      [
        "run",
        "--timeout",
        `${options.timeout} millis`,
        "--",
        "mise",
        "exec",
        "--cd",
        runtimeDirectory,
        "--",
        "renovate",
        "--platform=github",
        `--username=${user.login}`,
        `--ignore-pr-author=${preview}`,
        `--endpoint=${hostname === "github.com" ? "https://api.github.com/" : `https://${hostname}/api/v3/`}`,
        "--autodiscover=false",
        "--onboarding=false",
        "--require-config=required",
        "--fork-processing=enabled",
        "--exit-code-for-errors=true",
        "--config-validation-error=true",
        "--report-type=file",
        `--report-path=${reportPath}`,
        "--repository-cache=disabled",
        ...(dryRun ? ["--dry-run=full"] : []),
        repository.nameWithOwner,
      ],
      {
        cwd: directory,
        env: {
          RENOVATE_CONFIG_FILE: "",
          RENOVATE_ADDITIONAL_CONFIG_FILE: "",
          RENOVATE_DRY_RUN: "",
          RENOVATE_FORCE: JSON.stringify(force),
          RENOVATE_TOKEN: token,
          GITHUB_COM_TOKEN: hostname === "github.com" ? token : "",
          RENOVATE_CONFIG: JSON.stringify({
            gitAuthor: null,
            baseDir: join(directory, "work"),
            cacheDir: join(config.cacheDir, "renovate"),
            ignoreDeps,
          }),
        },
      },
    );
  });

  yield* log.info(
    `${options.dryRun ? "Previewing" : "Running"} Renovate for ${repository.nameWithOwner} as ${user.login}`,
  );
  yield* log.info(
    "Using the default branch's Renovate config; bypassing PR limits and schedules, keeping release-age and dependency rules",
  );

  const ignoreDeps = new Set<string>();

  if (!options.all) {
    const pages = yield* Api.pages(
      {
        endpoint: `repos/${repository.nameWithOwner}/pulls`,
        method: "GET",
        hostname,
        query: { state: "open", per_page: 100 },
        options: { timeout: "30 seconds" },
      },
      Schema.Array(OpenPr),
    );

    const openBranches = new Map(
      pages
        .flat()
        .flatMap((pr) =>
          pr.head.repo?.full_name === repository.nameWithOwner &&
          !pr.head.ref.startsWith(branchPrefix)
            ? [[pr.head.ref, pr.number] as const]
            : [],
        ),
    );

    if (openBranches.size > 0) {
      yield* log.info("Checking which updates already have open PRs");
      const exitCode = yield* run(true, []);

      if (exitCode !== 0) {
        process.exitCode = exitCode;

        return;
      }

      const report = yield* Schema.decodeEffect(Report)(
        yield* fs.readFileString(reportPath),
      );

      const result = report.repositories[repository.nameWithOwner];

      if (!result) {
        return yield* new RenovateError({
          message:
            "Renovate did not report this repository; check its config and the run output",
        });
      }

      for (const branch of result.branches) {
        const pr = openBranches.get(branch.branchName);

        if (pr === undefined) continue;

        for (const upgrade of branch.upgrades) {
          if (!upgrade.depName) {
            return yield* new RenovateError({
              message: `Cannot identify dependencies covered by PR #${pr}`,
            });
          }

          ignoreDeps.add(upgrade.depName);
        }

        yield* log.info(
          `Skipping dependencies covered by PR #${pr} (${branch.branchName})`,
        );
      }
    }
  }

  process.exitCode = yield* run(false, [...ignoreDeps]);
}, Effect.scoped);
