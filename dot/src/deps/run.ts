import { basename, join } from "node:path";
import { Api } from "@timmo001/effect-gh";
import {
  Clock,
  Effect,
  FileSystem,
  Ref,
  Result,
  Schema,
  Semaphore,
} from "effect";
import {
  assertDependencyPolicyReady,
  mergeDependencyPolicy,
} from "./config.js";
import { readDependencyConfig } from "./policyFile.js";
import { dependencyCheckRequirements } from "./checks.js";
import { DependencyGithub } from "./github.js";
import { extractDependencies } from "./extract.js";
import { requiresSourceUrl } from "./rules.js";
import { githubWorkflowScope } from "../lib/githubWorkflowScope.js";
import { dependencyRunLog, type DependencyRunLog } from "./log.js";
import {
  DependencyPlanner,
  dependencyGroupOrder,
  type DependencyPlan,
  type DependencyPlanOptions,
} from "./plan.js";
import {
  applyDependencyGroup,
  dependencyCandidateTree,
  prepareDependencyWorkspace,
  removeDependencyWorkspace,
  publishDependencyGroup,
  validateDependencyGroup,
} from "./publish.js";
import {
  dependencyRunPaths,
  DependencyRunError,
  lockDependencyTarget,
  readDependencyTrust,
} from "./state.js";

const runnablePlan = Effect.fn("Dependencies.runnablePlan")(function* (
  plan: DependencyPlan,
) {
  const config = yield* readDependencyConfig(plan.snapshot.files);
  yield* assertDependencyPolicyReady(config, {
    dependencies: plan.dependencies.map((entry) => entry.dependency),
    files: plan.snapshot.tree.map((entry) => entry.path),
  });

  const policy = mergeDependencyPolicy(
    config.policy.base,
    config.policy.overrides,
  );

  for (const entry of plan.dependencies)
    if (
      entry.selection.blockers.length &&
      (requiresSourceUrl(policy, entry.dependency) || entry.groups.length !== 1)
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
  options: DependencyPlanOptions,
  paths: ReturnType<typeof dependencyRunPaths>,
  identity: { readonly login: string; readonly id: number },
  log: DependencyRunLog,
  coordination: {
    readonly plan: Ref.Ref<DependencyPlan>;
    readonly publication: Semaphore.Semaphore;
    readonly repository: Semaphore.Semaphore;
    readonly checks: Semaphore.Semaphore;
    readonly discovery: Semaphore.Semaphore;
    readonly workflowScope: ReturnType<typeof githubWorkflowScope>;
  },
) {
  const planner = yield* DependencyPlanner;
  const fs = yield* FileSystem.FileSystem;
  const started = yield* Clock.currentTimeMillis;
  const retained: string[] = [];
  let plan = yield* Ref.get(coordination.plan);
  let publishing = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const config = yield* runnablePlan(plan);
    const entries = plan.dependencies.filter((entry) => entry.group === group);

    if (entries.some((entry) => entry.selection.blockers.length))
      return yield* new DependencyRunError({
        message: `Group ${group}: ${entries.flatMap((entry) => entry.selection.blockers.map((reason) => `${entry.dependency.name}: ${reason}`)).join("; ")}`,
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

    if (
      updates.some((entry) =>
        entry.dependency.file.startsWith(".github/workflows/"),
      ) &&
      (yield* coordination.workflowScope.pipe(
        Semaphore.withPermit(coordination.discovery),
      )) === "missing"
    )
      return yield* new DependencyRunError({
        message:
          "GitHub credential lacks workflow scope; run gh auth refresh --hostname github.com --scopes workflow, then retry",
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
    ).pipe(Semaphore.withPermit(coordination.discovery));

    yield* log.event(
      `[CHECKS] ${requirements.required.length} required mappings; base hosted results: ${requirements.current.join(", ") || "none"}`,
    );

    const workspace = yield* prepareDependencyWorkspace(
      paths,
      plan.snapshot,
      log,
      options.timeout,
      identity,
    ).pipe(Semaphore.withPermit(coordination.repository));

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
      coordination.repository,
    );

    const candidate = yield* dependencyCandidateTree(
      workspace.directory,
      allowed,
      plan.snapshot.sha,
      log,
      options.timeout,
    );

    yield* validateDependencyGroup(
      workspace.directory,
      config,
      log,
      options.concurrency,
      coordination,
    );

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

    if (!publishing) {
      yield* log.event(
        `[READY] ${group}: validation passed; waiting for publication slot`,
      );
      yield* Effect.acquireRelease(
        Effect.interruptible(coordination.publication.take(1)),
        () => coordination.publication.release(1),
      );
      publishing = true;
      yield* log.event(`[INTEGRATE] ${group}`);
    }

    const refreshed = yield* planner
      .refresh(yield* Ref.get(coordination.plan), options)
      .pipe(Semaphore.withPermit(coordination.discovery));

    yield* Ref.set(coordination.plan, refreshed);
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
    ).pipe(Semaphore.withPermit(coordination.discovery));

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
    ).pipe(Semaphore.withPermit(coordination.repository));

    if (result.status === "moved") {
      plan = yield* planner
        .refresh(plan, options)
        .pipe(Semaphore.withPermit(coordination.discovery));
      yield* Ref.set(coordination.plan, plan);
      continue;
    }

    const removed = yield* removeDependencyWorkspace(
      paths,
      workspace.directory,
      result.commit,
      log,
      options.timeout,
    ).pipe(
      Semaphore.withPermit(coordination.repository),
      Effect.as(true),
      Effect.catch((error) =>
        log
          .event(`[RETAINED] Published successfully; ${error.message}`)
          .pipe(Effect.as(false)),
      ),
    );

    const record = {
      group,
      status: "published",
      commit: result.commit,
      target: result.remote,
      url: `https://github.com/${plan.snapshot.repository}/commit/${result.commit}`,
      actions: `https://github.com/${plan.snapshot.repository}/actions?query=sha%3A${result.commit}`,
      duration: (yield* Clock.currentTimeMillis) - started,
      retained: retained.filter(
        (path) => !removed || path !== workspace.directory,
      ),
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

    return record;
  }

  return yield* new DependencyRunError({
    message: `${group}: target, policy or requirements kept moving; three attempts exhausted`,
  });
}, Effect.scoped);

/** Start groups by priority with bounded parallel work and one exact-commit publisher. */
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

  const config = yield* readDependencyConfig(snapshot.files);

  const extracted = yield* extractDependencies(
    snapshot,
    mergeDependencyPolicy(config.policy.base, config.policy.overrides),
  );

  if (extracted.blockers.length)
    return yield* new DependencyRunError({
      message: extracted.blockers.join("; "),
    });
  yield* assertDependencyPolicyReady(config, {
    dependencies: extracted.dependencies,
    files: snapshot.tree.map((entry) => entry.path),
  });

  const identity = yield* Api.json(
    { endpoint: "user", method: "GET", options: { timeout: options.timeout } },
    Schema.Struct({ login: Schema.String, id: Schema.Int }),
  );

  const initial = yield* planner.plan({ ...options, target });
  yield* runnablePlan(initial);

  const activeGroups = new Set(
    initial.dependencies
      .filter(
        (entry) =>
          entry.selection.release ||
          entry.selection.blockers.length ||
          entry.skippedBy.length,
      )
      .map((entry) => entry.group),
  );

  const groups = dependencyGroupOrder(initial.dependencies).filter((group) =>
    activeGroups.has(group),
  );

  const coordination = {
    plan: yield* Ref.make(initial),
    publication: yield* Semaphore.make(1),
    repository: yield* Semaphore.make(1),
    checks: yield* Semaphore.make(options.concurrency),
    discovery: yield* Semaphore.make(1),
    workflowScope: yield* Effect.cached(githubWorkflowScope()),
  };

  const reports = yield* Semaphore.make(1);

  const results: {
    group: string;
    status: string;
    reason?: string;
    commit?: string;
  }[] = [];

  yield* log.event(
    `[CONCURRENCY] Up to ${options.concurrency} groups and ${options.concurrency} check commands; first ready group publishes`,
  );
  yield* log.event(
    `[WORKTREES] ${paths.repository}; worktree directories under ${paths.run}`,
  );

  yield* Effect.forEach(
    groups,
    Effect.fn("Dependencies.groupWorker")(function* (group, index) {
      const groupLog = yield* dependencyRunLog(
        join(paths.run, `group-${index + 1}`),
      );

      yield* log.event(
        `[GROUP ${index + 1}/${groups.length}] ${group}; ${groupLog.path}`,
      );

      const outcome = yield* publishGroup(
        group,
        { ...options, target },
        paths,
        identity,
        groupLog,
        coordination,
      ).pipe(Effect.result);

      yield* Effect.gen(function* () {
        if (Result.isSuccess(outcome)) results.push(outcome.success);
        else {
          const reason =
            outcome.failure instanceof Error
              ? outcome.failure.message
              : String(outcome.failure);

          results.push({ group, status: "failed", reason });

          yield* log.event(
            `[FAILED] ${group}: ${reason}; see ${groupLog.path}`,
          );
        }

        yield* fs.writeFileString(
          join(paths.run, "results.json"),
          JSON.stringify(results, null, 2),
          { mode: 0o600 },
        );
      }).pipe(Semaphore.withPermit(reports));
    }),
    { concurrency: options.concurrency, discard: true },
  );

  const failed = results.filter((result) => result.status === "failed").length;
  yield* log.event(
    `[SUMMARY] ${results.filter((result) => result.status === "published").length} published, ${results.filter((result) => result.status === "skipped").length} skipped, ${failed} failed; ${log.path}`,
  );

  if (failed)
    return yield* new DependencyRunError({
      message: `Dependency run partially failed; inspect ${paths.run}`,
    });
}, Effect.scoped);
