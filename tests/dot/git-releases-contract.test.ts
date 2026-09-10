import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Clock, Effect, Stream } from "../../dot/node_modules/effect/dist/index.js";
import { appendGitRepository } from "../../dot/src/lib/gitRepoConfig.js";
import { parseDotGitConfigText, type GitManagedRepo } from "../../dot/src/services/GitConfig.js";
import { bunLockChanges, collectReleaseChanges, goModuleChanges, manifestChanges, releaseFact } from "../../dot/src/git/release/changes.js";
import { classifyReleaseFacts, highestImpact } from "../../dot/src/git/release/policy.js";
import { acceptReleaseSnapshot, applyReleaseReview, assertReleaseSelection, emptyReleaseCache, emptyReleaseReview, readReleaseState, releaseNotificationState, releasePaths, reviewRelease, saveReleaseDocument, withReleaseLock } from "../../dot/src/git/release/state.js";
import { CommandError, CommandExecutor } from "../../dot/src/services/CommandExecutor.js";
import { deliverReleaseNotification } from "../../dot/src/git/services/GitReleases.js";
import { GitHub } from "../../dot/src/git/services/GitHub.js";
import { nextReleaseTag, publishRelease } from "../../dot/src/git/release/publish.js";
import type { ReleaseFact, ReleaseReviewState, ReleaseSettings, ReleaseSnapshot } from "../../dot/src/git/release/types.js";

const repository: GitManagedRepo = {
  name: "Example", path: "/example", github: "example/project", aliases: [], postUpdate: null, agentOxlint: false,
  activity: { enabled: false, schedule: "* * * * *" },
  notifications: { enabled: false, schedule: "* * * * *", bar: { ignoreBotActivity: false } },
  releases: { enabled: true, schedule: "*/15 * * * *", branch: "main", policy: "oxlint-rules", source_minor_threshold: 50, overrides: [], notifications: { enabled: true, minimum_impact: "patch", cooldown_minutes: 60 } },
};

function settings(): ReleaseSettings {
  const source = appendGitRepository("schema_version: 2\nrepositories: []\n", repository);
  const parsed = parseDotGitConfigText(source, "fixture.yml");
  expect(parsed.diagnostics).toEqual([]);
  const releases = parsed.repositories[0].releases;
  if (!releases) throw new Error("Fixture lost release settings");
  return releases;
}

test("release confirmation binds the reviewed head and recipe before any write", async () => {
  const config = { ...settings(), publish: { version_files: ["package.json"], commands: [["mise", "run", "check"]] } };
  const current = snapshot([file("src/rule.ts")], "reviewed-head", config);
  const writes: string[] = [];
  let remoteHead = current.head;
  let newTag = "";
  const executor = CommandExecutor.of({
    run: (_command, args) => Effect.sync(() => {
      if (args[0] === "remote") return "git@github.com:example/project.git\n";
      if (args[0] === "ls-remote") return `${remoteHead}\trefs/heads/main\npublished\trefs/tags/1.0.0\n${newTag}`;
      if (args[0] === "ls-tree") return "100644 blob hash\tpackage.json\n";
      if (args[0] === "show") return '{"version":"1.0.0"}';
      writes.push(args.join(" "));
      throw new Error("Unexpected write");
    }),
    stream: (command) => { writes.push(command); return Stream.empty; },
    exitCode: () => Effect.succeed(0), inherit: () => Effect.succeed(0),
  });
  const github = GitHub.of({
    isAvailable: () => Effect.succeed(true),
    json: () => Effect.succeed({ tag_name: "1.0.0", draft: false, prerelease: false }),
    api: () => Effect.die("Unexpected API call"),
    run: () => { writes.push("release"); return Effect.succeed(""); },
  });
  const run = (recipe = config, confirmation?: string) => Effect.runPromise(publishRelease(repository, recipe, current, confirmation, () => Effect.void).pipe(
    Effect.provideService(CommandExecutor, executor), Effect.provideService(GitHub, github),
  ));
  const preview = await run();
  expect(preview.type).toBe("plan");
  if (preview.type !== "plan") throw new Error("Expected preview");
  expect(preview.plan.versions).toEqual([{ path: "package.json", before: "1.0.0", after: "1.0.1" }]);
  expect(preview.plan.steps.join("\n")).toContain("Atomically push");
  expect(writes).toEqual([]);
  await expect(run({ ...config, publish: { ...config.publish, commands: [["different-check"]] } }, preview.plan.id)).rejects.toThrow("plan changed");
  remoteHead = "new-head";
  await expect(run(config, preview.plan.id)).rejects.toThrow("watched branch changed");
  remoteHead = current.head;
  newTag = "another-commit\trefs/tags/1.0.1\n";
  await expect(run(config, preview.plan.id)).rejects.toThrow("already exists");
  expect(writes).toEqual([]);
});

function file(path: string, submodule: string | null = null): ReleaseFact {
  return releaseFact({ kind: "file", path, previousPath: null, changeType: "modified", before: "100644:old", after: "100644:new", dependency: null, role: null, submodule, subject: null, detail: `M ${path}`, complete: true });
}

function snapshot(facts: readonly ReleaseFact[], head = "head-one", config = settings()): ReleaseSnapshot {
  const findings = classifyReleaseFacts(facts, config);
  return applyReleaseReview({ id: "", repo: "example/project", name: "Example", branch: "main", releaseTag: "1.0.0", releaseCommit: "published", head, checkedAt: "2026-09-10T12:00:00Z", policyId: "fixture-policy", comparisonId: "", notificationId: "", url: `https://github.com/example/project/compare/published...${head}`, commits: [], findings, automaticSuggestion: highestImpact(findings.map((finding) => finding.automaticImpact)), suggestion: "none", reviewed: false, complete: facts.every((fact) => fact.complete), errors: [] }, emptyReleaseReview());
}

test("strict optional config feeds separate patch peers and quiet development-version facts", () => {
  const config = settings();
  const old = JSON.stringify({ peerDependencies: { oxlint: "1.0", "@oxlint/plugins": "1.0" }, devDependencies: { oxlint: "1.0", "@oxlint/plugins": "1.0" } });
  const next = JSON.stringify({ peerDependencies: { oxlint: "2.0", "@oxlint/plugins": "2.0" }, devDependencies: { oxlint: "2.0", "@oxlint/plugins": "2.0" } });
  const current = snapshot(manifestChanges("package.json", old, next, config));
  expect(current.findings.filter((fact) => fact.role === "peer").map((fact) => fact.impact)).toEqual(["patch", "patch"]);
  expect(current.findings.filter((fact) => fact.role === "development").map((fact) => fact.impact)).toEqual(["none", "none"]);
  expect(current.suggestion).toBe("patch");
  const devOnly = manifestChanges("package.json", old, JSON.stringify({ peerDependencies: { oxlint: "1.0", "@oxlint/plugins": "1.0" }, devDependencies: { oxlint: "3.0", "@oxlint/plugins": "3.0" } }), config);
  expect(snapshot(devOnly).suggestion).toBe("none");
  const source = appendGitRepository("schema_version: 2\nrepositories: []\n", repository);
  expect(parseDotGitConfigText(source.replace("*/15 * * * *", "*/0 * * * *"), "fixture.yml").valid).toBe(false);
});

test("source totals use net added plus deleted lines with a strict 50-line boundary", async () => {
  const history = gitHistory();
  const config = { ...settings(), policy: "system-bridge" as const };
  try {
    const source = { "main.go": "var value = 0\n" };
    const base = history.commit(source, "Baseline");
    for (const count of [49, 50, 51]) {
      const files = { "main.go": "var value = 1\n", "client/data_watch.go": "watch()\n".repeat(count - 2) };
      const head = history.commit(files, "fix: source update", base);
      const changes = await history.collect(base, head, config);
      expect(changes.errors).toEqual([]);
      expect(changes.facts.map((fact) => fact.changedLines)).toEqual([count - 2, 2]);
      const current = snapshot(changes.facts, head, config);
      expect(current.suggestion).toBe(count > 50 ? "minor" : "patch");
      expect(nextReleaseTag(current)).toBe(count > 50 ? "1.1.0" : "1.0.1");
      expect(snapshot(changes.facts, head, { ...config, source_excludes: ["**"] }).suggestion).toBe("patch");
      const reverted = history.commit({ "main.go": "var value = 2\n" }, "feat: misleading reverted change", head);
      expect(snapshot((await history.collect(base, reverted, config)).facts, reverted, config).suggestion).toBe("patch");
    }
    const rename = history.commit({ "client/odd\tname\n.go": source["main.go"] }, "Rename only", base);
    const renamed = await history.collect(base, rename, config);
    expect(renamed.errors).toEqual([]);
    expect(renamed.facts[0].changeType).toBe("renamed");
    expect(renamed.facts[0].changedLines).toBe(0);
    const binary = history.commit({ ...source, "client/image.bin": "\0binary\0" }, "Binary asset", base);
    expect((await history.collect(base, binary, config)).facts[0].changedLines).toBeNull();
  } finally { history.close(); }
});

test("source cutoff comes from validated config and omission disables only the size heuristic", () => {
  for (const threshold of [0, 10, 100]) {
    const config = { ...settings(), source_minor_threshold: threshold };
    expect(snapshot([{ ...file("src/change.ts"), changedLines: threshold }], "head", config).suggestion).toBe("patch");
    const above = snapshot([{ ...file("src/change.ts"), changedLines: threshold + 1 }], "head", config);
    expect(above.suggestion).toBe("minor");
    expect(above.findings[0].reason).toContain(`over ${threshold}`);
  }
  const disabled = { ...settings(), source_minor_threshold: undefined };
  const fact = { ...file("src/change.ts"), changedLines: 1000 };
  expect(snapshot([fact], "head", disabled).suggestion).toBe("patch");
  expect(snapshot([fact], "head", { ...disabled, overrides: [{ paths: ["src/**"], impact: "minor", reason: "Local rule policy" }] }).suggestion).toBe("minor");
  for (const threshold of [-1, 1.5]) {
    const source = appendGitRepository("schema_version: 2\nrepositories: []\n", { ...repository, releases: { ...settings(), source_minor_threshold: threshold } });
    expect(parseDotGitConfigText(source, "fixture.yml").valid).toBe(false);
  }
});

test("quiet paths, excluded scripts and dependency churn do not inflate source impact", async () => {
  const history = gitHistory();
  const config = { ...settings(), policy: "system-bridge" as const, source_excludes: ["scripts/**"] };
  try {
    const base = history.commit({ "client/source.go": "old\n" }, "Baseline");
    const head = history.commit({
      "client/source.go": "new\n",
      "client/source_test.go": "test\n".repeat(100),
      "scripts/dev.go": "dev\n".repeat(100),
      ".github/workflows/check.yml": "ci\n".repeat(100),
      "docs/guide.md": "docs\n".repeat(100),
      "omarchy-plugin/Panel.qml": "plugin\n".repeat(100),
      "client/package.json": JSON.stringify({ dependencies: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`lib-${index}`, "99.0.0"])) }, null, 2),
    }, "feat: big dependency bump", base);
    const changes = await history.collect(base, head, config);
    expect(changes.errors).toEqual([]);
    const current = snapshot(changes.facts, head, config);
    expect(current.suggestion).toBe("patch");
    expect(current.findings.filter((finding) => finding.impact === "none").map((finding) => finding.path)).toEqual([".github/workflows/check.yml", "client/source_test.go", "docs/guide.md", "omarchy-plugin/Panel.qml"]);
    const newCategory = history.commit({
      "client/source.go": "old\n",
      "future-category/feature.rs": "source\n".repeat(51),
    }, "New source category", base);
    const added = await history.collect(base, newCategory, config);
    expect(added.errors).toEqual([]);
    expect(added.facts[0].changedLines).toBe(51);
    expect(snapshot(added.facts, newCategory, config).suggestion).toBe("minor");
  } finally { history.close(); }
});

test("source exclusions retain the included side of a rename", () => {
  const config = { ...settings(), source_excludes: ["scripts/**"] };
  for (const [from, to, impact] of [
    ["scripts/old.ts", "new-category/feature.ts", "minor"],
    ["new-category/feature.ts", "scripts/old.ts", "minor"],
    ["scripts/old.ts", "scripts/new.ts", "patch"],
  ] as const) {
    const renamed = { ...file(to), previousPath: from, changeType: "renamed" as const, changedLines: 51 };
    expect(snapshot([renamed], "head", config).suggestion).toBe(impact);
  }
});

test("size heuristics preserve explicit policy and evidence-bound human impacts across upgrades", () => {
  const original = file("src/fix.ts");
  const fact = releaseFact({ ...original, changedLines: 51 });
  expect(fact.id).toBe(original.id);
  const config = settings();
  const initial = snapshot([original]);
  const current = { ...snapshot([fact], "head", config), policyId: "new-policy" };
  expect(current.suggestion).toBe("minor");
  for (const impact of ["none", "patch", "minor", "major"] as const) {
    const explicit = { ...config, overrides: [{ paths: [fact.path], impact, reason: "Explicit consumer policy" }] };
    expect(snapshot([fact], "head", explicit).suggestion).toBe(impact);
    const local = reviewRelease(initial, emptyReleaseReview(), fact.id, impact);
    const accepted = acceptReleaseSnapshot({ ...emptyReleaseCache(), snapshot: initial }, local, current);
    expect(accepted.cache.snapshot?.suggestion).toBe(impact);
    expect(accepted.review.findings).toEqual(local.findings);
  }
  const review = reviewRelease(initial, emptyReleaseReview(), "overall", "patch");
  const accepted = acceptReleaseSnapshot({ ...emptyReleaseCache(), snapshot: initial }, review, current);
  expect(accepted.cache.snapshot?.suggestion).toBe("patch");
  expect(accepted.cache.snapshot?.reviewed).toBe(true);
  expect(accepted.review.overall?.comparisonId).toBe(accepted.cache.snapshot?.comparisonId);
  const changed = releaseFact({ ...fact, after: "different" });
  expect(acceptReleaseSnapshot(accepted.cache, accepted.review, snapshot([changed], "new-head", config)).review.overall).toBeNull();
});

test("upstream shipped files drive patch while upstream docs and tests stay inspectable and quiet", () => {
  const current = snapshot([file("vendor/anti-slop/src/rules/example.ts", "vendor/anti-slop"), file("vendor/anti-slop/src/rules/example.test.ts", "vendor/anti-slop"), file("vendor/anti-slop/README.md", "vendor/anti-slop")]);
  expect(current.findings.map((fact) => fact.impact)).toEqual(["patch", "none", "none"]);
  const overridden = { ...settings(), overrides: [{ submodules: ["vendor/anti-slop"], paths: ["**/example.ts"], impact: "minor" as const, reason: "Explicit new public API" }, { impact: "none" as const, reason: "Quiet remainder" }] };
  expect(snapshot(current.findings, "head", overridden).findings.map((fact) => fact.impact)).toEqual(["minor", "none", "none"]);
  const incomplete = snapshot([{ ...file("vendor/anti-slop"), kind: "submodule", complete: false }]);
  expect(releaseNotificationState(incomplete, emptyReleaseReview(), settings(), false).pending).toBeNull();
});

test("configured local-rule minor and vendored patch policies take precedence over source size", () => {
  const config: ReleaseSettings = { ...settings(), source_excludes: ["scripts/**"], overrides: [
    { paths: ["**/*.test.*"], impact: "none", reason: "Tests are quiet" },
    { paths: ["vendor/anti-slop/src/**"], impact: "patch", reason: "Vendored rules" },
    { paths: ["src/**"], impact: "minor", reason: "Local rules" },
  ] };
  const vendored = { ...file("vendor/anti-slop/src/rule.ts", "vendor/anti-slop"), changedLines: 500 };
  const local = { ...file("src/xyz/rule.ts"), changedLines: 2 };
  expect(snapshot([vendored], "head", config).suggestion).toBe("patch");
  expect(snapshot([local], "head", config).suggestion).toBe("minor");
  expect(snapshot([vendored, local], "head", config).findings.map((finding) => finding.impact)).toEqual(["patch", "minor"]);
  expect(snapshot([{ ...file("src/xyz/rule.test.ts"), changedLines: 100 }], "head", config).suggestion).toBe("none");
  const source = appendGitRepository("schema_version: 2\nrepositories: []\n", { ...repository, releases: config });
  expect(parseDotGitConfigText(source, "fixture.yml").repositories[0].releases).toEqual(config);
  for (const path of ["", "/absolute", "../outside"]) {
    const invalid = appendGitRepository("schema_version: 2\nrepositories: []\n", { ...repository, releases: { ...config, source_excludes: [path] } });
    expect(parseDotGitConfigText(invalid, "fixture.yml").valid).toBe(false);
  }
});

test("runtime lock-only updates, shared reachability and build exceptions remain relevant without semver escalation", () => {
  const config = { ...settings(), policy: "system-bridge" as const };
  const lock = (runtime: string, dev: string) => JSON.stringify({ lockfileVersion: 1, workspaces: { "": { dependencies: { app: "1" }, devDependencies: { lint: "1", vite: "1" } } }, packages: {
    app: ["app@1", "", { dependencies: { shared: "1" } }, "hash"],
    lint: [`lint@${dev}`, "", { dependencies: { shared: "1" } }, "hash"],
    shared: [`shared@${runtime}`, "", {}, "hash"],
    vite: [`vite@${dev}`, "", {}, "hash"],
  } });
  const changes = bunLockChanges("web-client/bun.lock", lock("1", "1"), lock("9", "9"), config);
  expect(changes.errors).toEqual([]);
  const current = snapshot(changes.facts, "head", config);
  expect(current.findings.map((fact) => [fact.dependency, fact.role, fact.impact])).toEqual([["lint", "development", "none"], ["shared", "runtime", "patch"], ["vite", "build", "patch"]]);
  expect(current.suggestion).toBe("patch");
  expect(bunLockChanges("bun.lock", lock("1", "1"), lock("1", "1").replaceAll('"hash"', '"other"'), config).facts).toEqual([]);
  const unresolved = bunLockChanges("bun.lock", null, JSON.stringify({ lockfileVersion: 1, workspaces: { "": {} }, packages: { orphan: ["orphan@1", "", {}] } }), config);
  expect(unresolved.errors.length).toBeGreaterThan(0);
  expect(snapshot(unresolved.facts).complete).toBe(false);
});

test("Go requirements and replacements compare structurally, not by source order or dependency semver", () => {
  const before = "module example.org/app\ngo 1.26\nrequire (\n example.org/a v1.0 // indirect\n example.org/b v1.0\n)\nreplace example.org/a => example.org/fork v1.0\n";
  const reordered = "module example.org/app\ngo 1.26\nrequire example.org/b v1.0\nrequire example.org/a v1.0\nreplace (\n example.org/a => example.org/fork v1.0\n)\n";
  expect(goModuleChanges("go.mod", before, reordered)).toEqual([]);
  const facts = goModuleChanges("go.mod", before, reordered.replace("fork v1.0", "fork v9.0"));
  expect(facts).toHaveLength(1);
  expect(facts[0].detail).toContain("replace");
  expect(snapshot(facts).suggestion).toBe("patch");
});

test("quiet head updates preserve overall review and delivery identity, changed evidence rejects stale actions", () => {
  const relevant = file("src/rule.ts");
  const initial = snapshot([relevant]);
  const review = reviewRelease(initial, emptyReleaseReview(), "overall", "minor");
  const reviewed = applyReleaseReview(initial, review);
  const delivered = { ...review, delivered: reviewed.notificationId };
  const next = applyReleaseReview(snapshot([relevant, file(".github/workflows/check.yml")], "head-two"), delivered);
  expect(next.id).not.toBe(reviewed.id);
  expect(next.comparisonId).toBe(reviewed.comparisonId);
  expect(next.notificationId).toBe(reviewed.notificationId);
  expect(next.suggestion).toBe("minor");
  expect(releaseNotificationState(next, delivered, settings(), false).pending).toBeNull();
  expect(() => assertReleaseSelection(next, reviewed.id)).toThrow("refresh");
  const changed = releaseFact({ ...relevant, after: "100644:different" });
  const later = applyReleaseReview(snapshot([changed], "head-three"), delivered);
  expect(later.suggestion).toBe("patch");
  expect(releaseNotificationState(later, delivered, settings(), false).pending).toBe(later.notificationId);
  const quiet = reviewRelease(initial, emptyReleaseReview(), relevant.id, "none");
  expect(applyReleaseReview(initial, quiet).suggestion).toBe("none");
  expect(applyReleaseReview(snapshot([changed]), quiet).suggestion).toBe("patch");
  expect(applyReleaseReview(initial, reviewRelease(initial, quiet, relevant.id, "auto")).suggestion).toBe("patch");
});

test("atomic locked persistence retains a failed scan's snapshot and concurrent evidence-bound reviews", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-contract-"));
  const paths = releasePaths("example/project", root, root);
  const current = snapshot([file("src/first.ts"), file("src/second.ts")]);
  try {
    await Effect.runPromise(withReleaseLock(paths, saveReleaseDocument(paths.cache, "snapshot.json", { ...emptyReleaseCache(), snapshot: current, error: "Upstream unavailable" })));
    const legacyReview = { ...emptyReleaseReview(), acknowledged: current.notificationId, delivered: current.notificationId };
    await Effect.runPromise(withReleaseLock(paths, saveReleaseDocument(paths.state, "review.json", legacyReview)));
    await Promise.all(current.findings.map((finding) => Effect.runPromise(withReleaseLock(paths, Effect.gen(function* () {
      const { cache, review } = yield* readReleaseState(paths);
      expect(cache.snapshot?.id).toBe(current.id);
      expect(cache.error).toBe("Upstream unavailable");
      yield* Effect.sleep("10 millis");
      yield* saveReleaseDocument(paths.state, "review.json", reviewRelease(current, review, finding.id, "none"));
    })))));
    const saved = await Effect.runPromise(withReleaseLock(paths, readReleaseState(paths)));
    expect(saved.review).not.toHaveProperty("acknowledged");
    expect(saved.review.delivered).toBe(current.notificationId);
    expect(Object.keys(saved.review.findings)).toHaveLength(2);
    expect(saved.cache.snapshot?.id).toBe(current.id);
    expect(releaseNotificationState(current, saved.review, settings(), true).pending).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("delivery retries failures, serialises success, and preserves pending evidence through cooldown without re-fetching", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-delivery-"));
  const paths = releasePaths("example/project", root, root);
  const original = snapshot([file("src/rule.ts")]);
  let now = Date.parse("2026-09-10T12:00:00Z");
  let fail = true;
  const calls: { command: string; args: readonly string[] }[] = [];
  const executor: CommandExecutor["Service"] = {
    run: (command, args) => Effect.gen(function* () {
      calls.push({ command, args });
      if (fail) return yield* new CommandError({ command, exitCode: 1, stderr: "Unavailable ".repeat(100) });
      return "";
    }),
    stream: () => Stream.empty,
    exitCode: () => Effect.die("Unexpected process"),
    inherit: () => Effect.die("Unexpected process"),
  };
  const deliver = (current: ReleaseSnapshot, review: ReleaseReviewState, stale = false, config = settings()) =>
    Clock.clockWith((clock) => deliverReleaseNotification(current, review, config, stale).pipe(
      Effect.provideService(CommandExecutor, executor),
      Effect.provideService(Clock.Clock, {
        sleep: clock.sleep.bind(clock), currentTimeMillis: Effect.succeed(now), currentTimeMillisUnsafe: () => now,
        currentTimeNanos: Effect.succeed(BigInt(now) * 1000000n), currentTimeNanosUnsafe: () => BigInt(now) * 1000000n,
        monotonicTimeNanos: clock.monotonicTimeNanos, monotonicTimeNanosUnsafe: clock.monotonicTimeNanosUnsafe.bind(clock),
      }),
    ));
  const lockedDelivery = (current: ReleaseSnapshot) => Effect.runPromise(withReleaseLock(paths, Effect.gen(function* () {
    const { review } = yield* readReleaseState(paths);
    const next = yield* deliver(current, review);
    yield* saveReleaseDocument(paths.state, "review.json", next);
    return next;
  })));
  try {
    const failed = await lockedDelivery(original);
    expect(failed.pending).toBe(original.notificationId);
    expect(failed.delivered).toBeNull();
    expect(failed.deliveryError?.length).toBeLessThan(300);
    fail = false;
    await Promise.all([lockedDelivery(original), lockedDelivery(original)]);
    expect(calls).toHaveLength(2);
    expect(calls[1].command).toBe("omarchy");
    expect(calls[1].args.slice(0, 6)).toEqual(["notification", "send", "--app-name", "Git releases", "--urgency", "normal"]);
    expect(calls[1].args.slice(-6)).toEqual(["--exec", "dot", "git-releases", "--open", "--repo", "example/project"]);
    const saved = (await Effect.runPromise(readReleaseState(paths))).review;
    expect(saved.deliveredAt).toBe("2026-09-10T12:00:00.000Z");
    expect(saved.deliveryError).toBeNull();
    await lockedDelivery(snapshot([file("src/rule.ts"), file(".github/workflows/ci.yml")], "quiet-head"));
    expect(calls).toHaveLength(2);
    const changed = snapshot([file("src/new-rule.ts")], "new-head");
    now += 59 * 60000;
    expect((await lockedDelivery(changed)).pending).toBe(changed.notificationId);
    expect(calls).toHaveLength(2);
    now += 60000;
    expect((await lockedDelivery(changed)).delivered).toBe(changed.notificationId);
    expect(calls).toHaveLength(3);
    for (const [candidate, state, stale, config] of [
      [original, emptyReleaseReview(), true, settings()],
      [{ ...original, complete: false }, emptyReleaseReview(), false, settings()],
      [snapshot([file(".github/workflows/ci.yml")]), emptyReleaseReview(), false, settings()],
      [original, emptyReleaseReview(), false, { ...settings(), notifications: { ...settings().notifications, minimum_impact: "minor" as const } }],
      [original, emptyReleaseReview(), false, { ...settings(), notifications: { ...settings().notifications, enabled: false } }],
    ] as const) expect((await Effect.runPromise(deliver(candidate, state, stale, config))).pending).toBeNull();
    expect(calls).toHaveLength(3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("large release panel snapshots finish writing to a pipe before the CLI exits", async () => {
  const module = (path: string) => JSON.stringify(join(import.meta.dir, "../../dot", path));
  const child = Bun.spawn(["bun", "--eval", `
    import { Effect } from ${module("node_modules/effect/dist/index.js")};
    import { GitReleases } from ${module("src/git/services/GitReleases.ts")};
    import { releasesQuery } from ${module("src/git/commands/Releases.ts")};
    const repositories = [{ repo: "example/project", snapshot: { findings: Array.from({ length: 4000 }, (_, id) => ({ id, detail: "Evidence ".repeat(40) })) } }];
    await Effect.runPromise(releasesQuery({}, true).pipe(Effect.provideService(GitReleases, { query: () => Effect.succeed(repositories) })));
    process.exit(0);
  `], { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(error).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(output).repositories[0].snapshot.findings).toHaveLength(4000);
});

test("incomplete upstream and manifest collections retain the last complete snapshot and its exact reviews", () => {
  const upstream = file("vendor/anti-slop/src/rules/example.ts", "vendor/anti-slop");
  const complete = snapshot([upstream]);
  let accepted = acceptReleaseSnapshot(emptyReleaseCache(), emptyReleaseReview(), complete);
  const findingReview = reviewRelease(complete, accepted.review, upstream.id, "minor");
  accepted.review = reviewRelease(applyReleaseReview(complete, findingReview), findingReview, "overall", "major");
  for (const detail of ["Upstream fetch unavailable", "package.json: invalid JSON"]) {
    const incomplete = { ...snapshot([{ ...file("vendor/anti-slop"), kind: "submodule" as const, complete: false }], "new-head"), errors: [detail] };
    const failed = acceptReleaseSnapshot(accepted.cache, accepted.review, incomplete);
    expect(failed.cache.snapshot).toBe(accepted.cache.snapshot);
    expect(failed.cache.error).toContain(detail);
    expect(failed.review).toBe(accepted.review);
    const recovered = acceptReleaseSnapshot(failed.cache, failed.review, { ...complete, checkedAt: "2026-09-10T13:00:00Z" });
    expect(recovered.cache.error).toBeNull();
    expect(recovered.cache.snapshot?.findings[0].impact).toBe("minor");
    expect(recovered.cache.snapshot?.suggestion).toBe("major");
    const initialFailure = acceptReleaseSnapshot(emptyReleaseCache(), emptyReleaseReview(), incomplete);
    expect(initialFailure.cache.snapshot?.complete).toBe(false);
    expect(initialFailure.cache.error).toContain(detail);
  }
});

test("preset rename impact considers both boundaries while explicit overrides still match either endpoint", () => {
  const config = { ...settings(), policy: "system-bridge" as const };
  for (const [from, to, impact] of [
    ["web-client/public/logo.svg", "docs/public/logo.svg", "patch"],
    ["docs/public/logo.svg", "web-client/public/logo.svg", "patch"],
    ["web-client/src/icon.ts", "web-client/tests/icon.ts", "patch"],
    ["web-client/tests/icon.ts", "web-client/src/icon.ts", "patch"],
    ["docs/public/logo.svg", "web-client/tests/logo.svg", "none"],
  ] as const) {
    const rename = releaseFact({ ...file(to), previousPath: from, changeType: "renamed" });
    expect(snapshot([rename], "head", config).suggestion).toBe(impact);
    expect(snapshot([rename], "head", { ...config, overrides: [{ paths: [from], impact: "none", reason: "Explicitly quiet this movement" }] }).suggestion).toBe("none");
  }
});

// Immutable test objects live only in a disposable bare repository, without a worktree or user refs.
function gitHistory() {
  const root = mkdtempSync(join(tmpdir(), "release-lineage-"));
  const git = (args: string[], input?: string) => {
    const result = Bun.spawnSync(["git", "-C", root, ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input), env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.org", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.org" } });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  git(["init", "--bare"]);
  const tree = (files: Record<string, string>): string => {
    const directories = new Map<string, Record<string, string>>();
    const entries: string[] = [];
    for (const [path, text] of Object.entries(files)) {
      const slash = path.indexOf("/");
      if (slash === -1) entries.push(`100644 blob ${git(["hash-object", "-w", "--stdin"], text)}\t${path}\0`);
      else {
        const dir = path.slice(0, slash);
        directories.set(dir, { ...directories.get(dir), [path.slice(slash + 1)]: text });
      }
    }
    for (const [name, files] of directories) entries.push(`040000 tree ${tree(files)}\t${name}\0`);
    return git(["mktree", "-z"], entries.sort().join(""));
  };
  return {
    root,
    commit: (files: Record<string, string>, subject: string, parent?: string) => git(["commit-tree", tree(files), ...(parent ? ["-p", parent] : []), "-m", subject]),
    collect: (before: string, after: string, config: ReleaseSettings) => Effect.runPromise(collectReleaseChanges(root, before, after, config, join(root, "cache")).pipe(Effect.provide(CommandExecutor.layer))),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("source intent follows surviving added and removed lines, not a reverted major change in the same file", async () => {
  const history = gitHistory();
  try {
    const source = { "src/api.ts": "export const api = 1;\nexport const label = 'old';\nexport const keep = true;\n" };
    const base = history.commit(source, "Baseline");
    const major = history.commit({ "src/api.ts": source["src/api.ts"].replace("api = 1", "api = 2") }, "major: replace API", base);
    const reverted = history.commit(source, "Revert API replacement", major);
    const patch = history.commit({ "src/api.ts": source["src/api.ts"].replace("'old'", "'new'") }, "fix: label", reverted);
    const config = { ...settings(), overrides: [{ subjects: ["^major:"], impact: "major" as const, reason: "Explicit surviving API change" }, { subjects: ["^chore:"], impact: "none" as const, reason: "Explicitly quiet source update" }] };
    const surviving = await history.collect(base, major, config);
    expect(surviving.errors).toEqual([]);
    expect(snapshot(surviving.facts, major, config).suggestion).toBe("major");
    const current = await history.collect(base, patch, config);
    expect(current.errors).toEqual([]);
    expect(current.facts).toHaveLength(1);
    expect(current.facts[0].subjects).toEqual(["fix: label"]);
    expect(snapshot(current.facts, patch, config).suggestion).toBe("patch");
    const sameLinePatch = history.commit({ "src/api.ts": source["src/api.ts"].replace("api = 1", "api = 3") }, "fix: current API value", reverted);
    const replacedAgain = await history.collect(base, sameLinePatch, config);
    expect(replacedAgain.errors).toEqual([]);
    expect(replacedAgain.facts[0].subjects).toEqual(["fix: current API value"]);
    expect(snapshot(replacedAgain.facts, sameLinePatch, config).suggestion).toBe("patch");
    const removed = history.commit({ "src/api.ts": source["src/api.ts"].replace("export const api = 1;\n", "") }, "major: remove API", base);
    const removal = await history.collect(base, removed, config);
    expect(removal.errors).toEqual([]);
    expect(snapshot(removal.facts, removed, config).suggestion).toBe("major");
    const chore = history.commit({ "src/api.ts": source["src/api.ts"].replace("'old'", "'new'") }, "chore: label", base);
    const quiet = await history.collect(base, chore, config);
    const automatic = await history.collect(base, chore, settings());
    expect(quiet.errors).toEqual([]);
    expect(quiet.facts).toHaveLength(1);
    expect(quiet.facts[0].id).toBe(automatic.facts[0].id);
    expect(snapshot(quiet.facts, chore, config).suggestion).toBe("none");
    const combined = history.commit({ "src/api.ts": source["src/api.ts"].replace("api = 1", "api = 2").replace("'old'", "'new'") }, "chore: label", major);
    const mixed = await history.collect(base, combined, config);
    expect(mixed.errors).toEqual([]);
    expect(mixed.facts).toHaveLength(1);
    expect(mixed.facts[0].subjects).toEqual(["chore: label", "major: replace API"]);
    expect(snapshot(mixed.facts, combined, config).suggestion).toBe("major");
    expect(snapshot(mixed.facts, combined, { ...config, overrides: [...config.overrides].reverse() }).suggestion).toBe("none");
  } finally { history.close(); }
});

test("subject rules classify structured dependency facts once, using each value's unreverted lineage", async () => {
  const history = gitHistory();
  try {
    const manifest = (compiler: string, lib: string) => ({ "package.json": JSON.stringify({ dependencies: { lib }, devDependencies: { compiler } }) });
    const base = history.commit(manifest("1", "1"), "Baseline");
    const major = history.commit(manifest("9", "1"), "major: compiler behaviour", base);
    const reverted = history.commit(manifest("1", "1"), "Revert compiler change", major);
    const chore = history.commit(manifest("2", "1"), "chore: compiler update", reverted);
    const patch = history.commit(manifest("2", "2"), "fix: library update", chore);
    const config = { ...settings(), overrides: [
      { subjects: ["^major:"], impact: "major" as const, reason: "Surviving explicit major intent" },
      { subjects: ["^chore:"], roles: ["development" as const], dependencies: ["compiler"], impact: "minor" as const, reason: "Explicit compiler output change" },
      { subjects: ["^fix:"], roles: ["runtime" as const], dependencies: ["lib"], impact: "none" as const, reason: "Quiet runtime correction" },
    ] };
    const current = await history.collect(base, patch, config);
    expect(current.errors).toEqual([]);
    const classified = snapshot(current.facts, patch, config);
    expect(classified.findings.map((fact) => [fact.dependency, fact.role, fact.impact, fact.subjects])).toEqual([
      ["lib", "runtime", "none", ["fix: library update"]],
      ["compiler", "development", "minor", ["chore: compiler update"]],
    ]);
    const surviving = await history.collect(base, major, config);
    expect(snapshot(surviving.facts, major, config).suggestion).toBe("major");
    const malformed = history.commit({ "package.json": "{" }, "fix: malformed manifest", patch);
    const incomplete = await history.collect(base, malformed, config);
    expect(incomplete.errors.some((error) => error.includes("package.json"))).toBe(true);
    const retained = acceptReleaseSnapshot({ ...emptyReleaseCache(), snapshot: classified }, emptyReleaseReview(), { ...snapshot(incomplete.facts, malformed, config), errors: incomplete.errors });
    expect(retained.cache.snapshot).toBe(classified);
    expect(retained.cache.error).toContain("package.json");
  } finally { history.close(); }
});
