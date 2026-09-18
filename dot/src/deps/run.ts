import { basename, dirname, join } from "node:path";
import { Api } from "@timmo001/effect-gh";
import { Clock, Effect, FileSystem, Result, Schema } from "effect";
import {
  assertDependencyPolicyReady,
  DependencyConfig,
  mergeDependencyPolicy,
} from "./config.js";
import { dependencyCheckRequirements } from "./checks.js";
import { DependencyGithub } from "./github.js";
import { dependencyGroups, requiresSourceUrl } from "./rules.js";
import { dependencyRunLog, type DependencyRunLog } from "./log.js";
import {
  DependencyPlanner,
  type DependencyPlan,
  type DependencyPlanOptions,
  type PlannedDependency,
} from "./plan.js";
import {
  applyDependencyGroup,
  dependencyCandidateTree,
  dependencyGit,
  prepareDependencyWorkspace,
  publishDependencyGroup,
  validateDependencyGroup,
} from "./publish.js";
import {
  dependencyRunPaths,
  DependencyRunError,
  lockDependencyTarget,
  readDependencyTrust,
} from "./state.js";

function groupFiles(entries: readonly PlannedDependency[]) {
  return [
    ...new Set(
      entries.flatMap(({ dependency }) => [
        dependency.file,
        ...(dependency.manager === "npm"
          ? [join(dirname(dependency.file), "bun.lock")]
          : []),
      ]),
    ),
  ];
}

const nativeConfig = (plan: DependencyPlan) =>
  Schema.decodeEffect(Schema.fromJsonString(DependencyConfig))(
    plan.snapshot.files["dot-deps.json"],
  );

const runnablePlan = Effect.fn("Dependencies.runnablePlan")(function* (
  plan: DependencyPlan,
) {
  const config = yield* nativeConfig(plan);
  yield* assertDependencyPolicyReady(config);

  const policy = mergeDependencyPolicy(
    config.policy.base,
    config.policy.overrides,
  );

  for (const entry of plan.dependencies)
    if (
      entry.selection.blockers.length &&
      (requiresSourceUrl(policy, entry.dependency) ||
        dependencyGroups(policy, entry.dependency).length !== 1)
    )
      return yield* new DependencyRunError({
        message: `Cannot establish independent groups while ${entry.dependency.name} has unresolved grouping metadata`,
      });

  const known = new Set(
    plan.dependencies.flatMap((entry) =>
      entry.selection.blockers.map(
        (blocker) => `${entry.dependency.name}: ${blocker}`,
      ),
    ),
  );

  const global = plan.failures.filter((failure) => !known.has(failure));

  if (global.length)
    return yield* new DependencyRunError({ message: global.join("; ") });

  return config;
});

const publishGroup = Effect.fn("Dependencies.runGroup")(function* (
  group: string,
  plan: DependencyPlan,
  options: DependencyPlanOptions,
  paths: ReturnType<typeof dependencyRunPaths>,
  identity: { readonly login: string; readonly id: number },
  log: DependencyRunLog,
  failedFiles: ReadonlySet<string>,
) {
  const planner = yield* DependencyPlanner;
  const fs = yield* FileSystem.FileSystem;
  const started = yield* Clock.currentTimeMillis;
  const retained: string[] = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const config = yield* runnablePlan(plan);
    const entries = plan.dependencies.filter((entry) => entry.group === group);

    if (entries.some((entry) => entry.selection.blockers.length))
      return yield* new DependencyRunError({
        message: `Group ${group} has unresolved discovery failures`,
      });

    if (entries.some((entry) => entry.skippedBy.length)) {
      yield* log.event(
        `[SKIP] ${group}: ${[...new Set(entries.flatMap((entry) => entry.skippedBy.map((pr) => `${pr.url} (${pr.checks})`)))].join(", ")}`,
      );

      return { group, status: "skipped", reason: "Open PR coverage", retained };
    }

    const updates = entries.filter((entry) => entry.selection.release);

    if (!updates.length)
      return {
        group,
        status: "skipped",
        reason: "No eligible updates remain",
        retained,
      };

    if (groupFiles(updates).some((file) => failedFiles.has(file)))
      return yield* new DependencyRunError({
        message: `${group} shares files with a failed group`,
      });

    for (const entry of updates)
      yield* log.event(
        `[UPDATE] ${entry.dependency.file}: ${entry.dependency.name} ${entry.dependency.current} -> ${entry.selection.candidate ?? entry.selection.release?.version}${entry.selection.release?.digest ? `@${entry.selection.release.digest}` : ""}`,
      );

    const trust = yield* readDependencyTrust(plan.snapshot.repository);

    const requirements = yield* dependencyCheckRequirements(
      plan.snapshot,
      config,
      trust.allowBypass,
      options.timeout,
    );

    yield* log.event(
      `[CHECKS] ${requirements.required.length} required mappings; base hosted results: ${requirements.current.join(", ") || "none"}`,
    );

    const workspace = yield* prepareDependencyWorkspace(
      paths,
      plan.snapshot,
      log,
      options.timeout,
      identity,
    );

    if (workspace.moved) {
      plan = yield* planner.plan(options);
      continue;
    }

    retained.push(workspace.directory);
    yield* fs.writeFileString(
      join(workspace.directory, "../", `${basename(workspace.directory)}.json`),
      JSON.stringify(
        {
          group,
          base: plan.snapshot.sha,
          directory: workspace.directory,
          status: "preparing",
          changes: updates.map((entry) => ({
            name: entry.dependency.name,
            file: entry.dependency.file,
            before: entry.dependency.current,
            after: entry.selection.candidate,
            digest: entry.selection.release?.digest,
          })),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    const policy = mergeDependencyPolicy(
      config.policy.base,
      config.policy.overrides,
    );

    const allowed = yield* applyDependencyGroup(
      workspace.directory,
      plan.snapshot,
      policy,
      updates,
      log,
      options.timeout,
    );

    const candidate = yield* dependencyCandidateTree(
      workspace.directory,
      allowed,
      plan.snapshot.sha,
      log,
      options.timeout,
    );

    yield* validateDependencyGroup(workspace.directory, config, log);

    const checked = yield* dependencyCandidateTree(
      workspace.directory,
      allowed,
      plan.snapshot.sha,
      log,
      options.timeout,
    );

    if (candidate !== checked)
      return yield* new DependencyRunError({
        message:
          "Setup or checks modified the prepared candidate; retained worktree needs inspection",
      });

    const refreshed = yield* planner.plan(options);
    yield* runnablePlan(refreshed);

    if (refreshed.snapshot.sha !== plan.snapshot.sha) {
      yield* log.event(
        `[RETRY] ${group}: target moved; discarding validation and rebuilding`,
      );
      plan = refreshed;
      continue;
    }

    const refreshedEntries = refreshed.dependencies.filter(
      (entry) => entry.group === group,
    );

    if (refreshedEntries.some((entry) => entry.skippedBy.length))
      return {
        group,
        status: "skipped",
        reason: "A dependency PR opened during validation",
        retained,
      };

    if (
      JSON.stringify(
        refreshedEntries.map((entry) => [entry.dependency, entry.selection]),
      ) !==
      JSON.stringify(
        entries.map((entry) => [entry.dependency, entry.selection]),
      )
    ) {
      plan = refreshed;
      continue;
    }

    const currentTrust = yield* readDependencyTrust(plan.snapshot.repository);

    const currentRequirements = yield* dependencyCheckRequirements(
      plan.snapshot,
      config,
      currentTrust.allowBypass,
      options.timeout,
    );

    if (currentRequirements.fingerprint !== requirements.fingerprint) {
      yield* log.event(
        `[RETRY] ${group}: branch requirements changed; validation must run again`,
      );
      plan = refreshed;
      continue;
    }

    const result = yield* publishDependencyGroup(
      workspace.directory,
      plan.snapshot,
      group,
      checked,
      allowed,
      log,
      options.timeout,
    );

    if (result.status === "moved") {
      plan = yield* planner.plan(options);
      continue;
    }

    const record = {
      group,
      status: "published",
      commit: result.commit,
      target: result.remote,
      url: `https://github.com/${plan.snapshot.repository}/commit/${result.commit}`,
      actions: `https://github.com/${plan.snapshot.repository}/actions?query=sha%3A${result.commit}`,
      duration: (yield* Clock.currentTimeMillis) - started,
      retained: retained.filter((path) => path !== workspace.directory),
    };

    yield* fs.writeFileString(
      join(paths.run, `${result.commit}.json`),
      JSON.stringify(record, null, 2),
      { mode: 0o600 },
    );
    yield* log.event(
      `[PUBLISHED] ${record.url} (local checks passed; hosted CI not awaited)\n[ACTIONS] ${record.actions}`,
    );
    yield* log.event(
      `[TARGET] ${plan.snapshot.repository}@${plan.snapshot.target}: ${record.target}; caller checkout preserved`,
    );
    yield* dependencyGit(
      log,
      paths.repository,
      options.timeout,
    )(["worktree", "remove", workspace.directory]).pipe(
      Effect.catch(() =>
        log.event(
          `[RETAINED] Published successfully; could not remove ${workspace.directory}`,
        ),
      ),
    );

    return record;
  }

  return yield* new DependencyRunError({
    message: `${group}: target, policy or requirements kept moving; three attempts exhausted`,
  });
});

/** Integrate independent groups serially from current remote state, retaining all failed work. */
export const runDependencyUpdates = Effect.fn("Dependencies.run")(function* (
  options: DependencyPlanOptions,
) {
  const github = yield* DependencyGithub;
  const planner = yield* DependencyPlanner;
  const fs = yield* FileSystem.FileSystem;

  const repository = yield* github.resolve(
    options.directory,
    options.repository,
    options.timeout,
  );

  const target = options.target ?? repository.defaultBranchRef?.name;

  if (!target)
    return yield* new DependencyRunError({
      message: "Repository has no default branch; pass --target",
    });
  yield* readDependencyTrust(repository.nameWithOwner);
  const paths = dependencyRunPaths(repository.nameWithOwner, target);
  yield* lockDependencyTarget(paths.root);
  const log = yield* dependencyRunLog(paths.run);
  yield* log.event(
    `[RUN] ${repository.nameWithOwner}@${target}; evidence: ${paths.run}`,
  );

  // Block unresolved policy before expensive metadata discovery or any repository command.
  const snapshot = yield* github.snapshot(
    repository.nameWithOwner,
    target,
    options.timeout,
    options.concurrency,
  );

  const config = yield* Schema.decodeEffect(
    Schema.fromJsonString(DependencyConfig),
  )(snapshot.files["dot-deps.json"]);

  yield* assertDependencyPolicyReady(config);

  const identity = yield* Api.json(
    { endpoint: "user", method: "GET", options: { timeout: options.timeout } },
    Schema.Struct({ login: Schema.String, id: Schema.Int }),
  );

  const initial = yield* planner.plan({ ...options, target });
  yield* runnablePlan(initial);

  const groups = [
    ...new Set(
      initial.dependencies
        .filter(
          (entry) =>
            entry.selection.release ||
            entry.selection.blockers.length ||
            entry.skippedBy.length,
        )
        .map((entry) => entry.group),
    ),
  ];

  const failedFiles = new Set(
    groupFiles(
      initial.dependencies.filter((entry) => entry.selection.blockers.length),
    ),
  );

  const results: {
    group: string;
    status: string;
    reason?: string;
    commit?: string;
  }[] = [];

  for (const [index, group] of groups.entries()) {
    yield* log.event(`[GROUP ${index + 1}/${groups.length}] ${group}`);

    const outcome = yield* Effect.gen(function* () {
      const plan =
        index === 0 ? initial : yield* planner.plan({ ...options, target });

      return yield* publishGroup(
        group,
        plan,
        { ...options, target },
        paths,
        identity,
        log,
        failedFiles,
      );
    }).pipe(Effect.result);

    if (Result.isSuccess(outcome)) results.push(outcome.success);
    else {
      const reason =
        outcome.failure instanceof Error
          ? outcome.failure.message
          : String(outcome.failure);

      results.push({ group, status: "failed", reason });

      for (const file of groupFiles(
        initial.dependencies.filter((entry) => entry.group === group),
      ))
        failedFiles.add(file);
      yield* log.event(
        `[FAILED] ${group}: ${reason}; work retained under ${paths.run}`,
      );
    }

    yield* fs.writeFileString(
      join(paths.run, "results.json"),
      JSON.stringify(results, null, 2),
      { mode: 0o600 },
    );
  }

  const failed = results.filter((result) => result.status === "failed").length;
  yield* log.event(
    `[SUMMARY] ${results.filter((result) => result.status === "published").length} published, ${results.filter((result) => result.status === "skipped").length} skipped, ${failed} failed; ${log.path}`,
  );

  if (failed)
    return yield* new DependencyRunError({
      message: `Dependency run partially failed; inspect ${paths.run}`,
    });
}, Effect.scoped);
