import { expect, test } from "bun:test";
import { Deferred, Effect, Queue, Stream } from "../../dot/node_modules/effect/dist/index.js";
import { GitNotifications } from "../../dot/src/git/services/GitNotifications.js";
import { GitHub } from "../../dot/src/git/services/GitHub.js";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor.js";
import { Config } from "../../dot/src/services/Config.js";
import { emptyDotGitConfig } from "../../dot/src/services/GitConfig.js";
import { emptyMcpConfig } from "../../dot/src/mcp/sync/loadSpec.js";
import { formatNotificationReview, formatNotificationSummary } from "../../dot/src/git/commands/NotificationDismiss.js";
import { startNotificationDismissalRun } from "../../dot/src/git/commands/notificationDismissalRun.js";

function thread(id: string, type = "PullRequest", repo = "example/project") {
  return { id, unread: true, reason: "subscribed", updated_at: "2026-09-21T10:00:00Z", last_read_at: null,
    url: `https://api.github.com/notifications/threads/${id}`,
    repository: { full_name: repo, html_url: `https://github.com/${repo}` },
    subject: { title: `Update dependency ${id}`, type, url: `https://api.github.com/repos/${repo}/${type === "Issue" ? "issues" : "pulls"}/${id}`, latest_comment_url: null },
  };
}

function pull(id: string) {
  return { state: "closed", merged: true, merged_at: "2026-09-21T09:00:00Z", draft: false,
    user: { login: "renovate[bot]" }, head: { sha: `sha-${id}`, ref: `renovate/update-${id}` } };
}

function check(name: string, conclusion: string | null = "success", status = "completed") {
  return { name, conclusion, status };
}

function fixture(pages: ReturnType<typeof thread>[][]) {
  const reads: string[][] = [];
  const writes: string[][] = [];
  const responses = new Map<string, unknown>();

  for (const item of pages.flat()) {
    responses.set(`notifications/threads/${item.id}`, item);
    const subject = item.subject.url.replace("https://api.github.com/", "");
    responses.set(subject, item.subject.type === "Issue" ? { state: "open" } : pull(item.id));
    const ref = `repos/${item.repository.full_name}/commits/sha-${item.id}`;
    responses.set(`${ref}/check-runs?filter=latest&per_page=100`, [{ total_count: 1, check_runs: [check("Build")] }]);
    responses.set(`${ref}/status?per_page=100`, [{ state: "pending", total_count: 0, statuses: [] }]);
  }

  const github = GitHub.of({
    isAvailable: () => Effect.succeed(true),
    api: () => Effect.die("Unexpected API call"),
    json: (args) => Effect.sync(() => {
      reads.push([...args]);
      const endpoint = args.find((arg) => /^(\/?repos\/|notifications)/.test(arg))?.replace(/^\//, "");

      if (endpoint === "notifications?per_page=100" || endpoint === "repos/example/project/notifications?per_page=100") return pages;

      if (!endpoint || !responses.has(endpoint)) throw new Error(`Unexpected read: ${args.join(" ")}`);

      return responses.get(endpoint);
    }),
    run: (args, options) => Effect.sync(() => {
      expect(options?.retries).toBe(0);
      writes.push([...args]);

      return "";
    }),
  });

  const executor = CommandExecutor.of({ run: () => Effect.die("Unexpected command"), stream: () => Stream.empty,
    exitCode: () => Effect.succeed(0), inherit: () => Effect.succeed(0) });

  const config = Config.of({ publicDotfiles: "/example/dotfiles", privateDotfiles: null, canUsePrivate: false, privateReason: "fixture",
    notesDir: "/example/notes", omarchy: { repoBase: "/example", diffRepos: [], worktreeRepos: [], worktreeBranches: [], expectedBranches: {}, enabled: false },
    gitConfig: emptyDotGitConfig("fixture.yml"), mcpConfig: emptyMcpConfig("fixture.yml"), cacheDir: "/example/cache", stateDir: "/example/state", logDir: "/example/log" });

  const run = <A, E>(program: Effect.Effect<A, E, GitNotifications>) => Effect.runPromise(program.pipe(
    Effect.provide(GitNotifications.layer), Effect.provideService(GitHub, github),
    Effect.provideService(Config, config), Effect.provideService(CommandExecutor, executor),
  ));

  return { run, responses, reads, writes };
}

const review = Effect.flatMap(GitNotifications, (service) => service.review());

test("all pages are classified before dismissal and failed checks never enter the dependency pass", async () => {
  const first = Array.from({ length: 50 }, (_, index) => thread(String(index + 1)));
  const f = fixture([first, [thread("51"), thread("52"), thread("53", "Issue"), { ...thread("54"), unread: false }]]);
  f.responses.set("repos/example/project/commits/sha-52/check-runs?filter=latest&per_page=100", [
    { total_count: 2, check_runs: [check("Build")] }, { total_count: 2, check_runs: [check("Tests", "failure")] },
  ]);
  const entries = await f.run(review);
  expect(entries).toHaveLength(53);
  expect(entries.filter((entry) => entry.category === "dependencies")).toHaveLength(51);
  expect(entries.find((entry) => entry.thread.id === "52")?.detail).toContain("Tests: failure");
  expect(entries.find((entry) => entry.thread.id === "53")?.detail).toContain("Issue open");
  expect(f.reads.filter((args) => args.some((arg) => arg.includes("per_page"))).every((args) => args.includes("--paginate") && args.includes("--slurp"))).toBe(true);
  expect(f.writes).toEqual([]);
  const outcomes = await f.run(Effect.flatMap(GitNotifications, (service) => service.dismiss(entries, "dependencies")));
  expect(outcomes.filter((outcome) => outcome.status === "done")).toHaveLength(51);
  expect(f.writes.some((args) => args.includes("notifications/threads/52") || args.includes("notifications/threads/53"))).toBe(false);
});

test("manual remaining pass includes unresolved PR reasons and requires its own explicit selections", async () => {
  const f = fixture([[thread("1"), thread("2"), thread("3"), thread("4"), thread("5"), thread("6"), thread("7")]]);
  f.responses.set("repos/example/project/pulls/1", { ...pull("1"), state: "open", merged: false, merged_at: null });
  f.responses.set("repos/example/project/pulls/2", { ...pull("2"), merged: false, merged_at: null });
  f.responses.set("repos/example/project/pulls/3", { ...pull("3"), user: { login: "github-actions[bot]" }, head: { sha: "sha-3", ref: "release" } });
  f.responses.set("repos/example/project/commits/sha-4/check-runs?filter=latest&per_page=100", [{ total_count: 1, check_runs: [check("Tests", null, "in_progress")] }]);
  f.responses.set("repos/example/project/commits/sha-5/check-runs?filter=latest&per_page=100", { message: "Forbidden" });
  f.responses.set("repos/example/project/commits/sha-6/check-runs?filter=latest&per_page=100", [{ total_count: 0, check_runs: [] }]);
  f.responses.set("repos/example/project/pulls/7", { ...pull("7"), head: { sha: "sha-7", ref: "renovate/configure" } });
  const entries = await f.run(review);
  expect(entries.every((entry) => entry.category === "remaining")).toBe(true);
  expect(entries[0].detail).toContain("Open PR");
  expect(entries[1].detail).toContain("Closed without merging");
  expect(entries[3].detail).toContain("Tests: in_progress");
  expect(entries[4].inspectionFailed).toBe(true);
  expect(entries[5].detail).toContain("no successful checks");
  expect(f.writes).toEqual([]);
  const outcomes = await f.run(Effect.flatMap(GitNotifications, (service) => service.dismiss([entries[3]], "remaining")));
  expect(outcomes[0].status).toBe("done");
  expect(f.writes).toHaveLength(1);
});

test("latest successful runs qualify but failing legacy statuses and incomplete evidence do not", async () => {
  const f = fixture([[thread("1"), thread("2"), thread("3")]]);
  f.responses.set("repos/example/project/commits/sha-1/check-runs?filter=latest&per_page=100", [{ total_count: 3, check_runs: [check("Build"), check("Optional", "skipped"), check("Advice", "neutral")] }]);
  f.responses.set("repos/example/project/commits/sha-2/status?per_page=100", [{ state: "failure", total_count: 1, statuses: [{ context: "External CI", state: "failure" }] }]);
  f.responses.set("repos/example/project/commits/sha-3/check-runs?filter=latest&per_page=100", [{ total_count: 2, check_runs: [check("Build")] }]);
  const entries = await f.run(review);
  expect(entries.map((entry) => entry.category)).toEqual(["dependencies", "remaining", "remaining"]);
  expect(entries[1].detail).toContain("External CI: failure");
  expect(entries[2].detail).toContain("Incomplete CI response");
});

test("revalidation leaves changed/read notifications and reports partial failures", async () => {
  const f = fixture([[thread("1"), thread("2"), thread("3"), thread("4"), thread("5")]]);
  const entries = await f.run(review);
  f.responses.set("notifications/threads/1", { ...thread("1"), unread: false });
  f.responses.set("notifications/threads/2", { ...thread("2"), updated_at: "2026-09-21T11:00:00Z" });
  f.responses.set("repos/example/project/commits/sha-3/check-runs?filter=latest&per_page=100", [{ total_count: 1, check_runs: [check("Build", "failure")] }]);
  f.responses.set("notifications/threads/4", { message: "Not found" });
  const outcomes = await f.run(Effect.flatMap(GitNotifications, (service) => service.dismiss(entries, "dependencies")));
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["skipped", "skipped", "skipped", "failed", "done"]);
  expect(f.writes).toEqual([["api", "-X", "DELETE", "notifications/threads/5"]]);
});

test("repo-scoped unread review uses the repository endpoint and prints evidence before any writes", async () => {
  const f = fixture([[thread("1")]]);
  const entries = await f.run(Effect.flatMap(GitNotifications, (service) => service.review(["example/project"])));
  expect(f.reads[0]).toContain("repos/example/project/notifications?per_page=100");
  const preview = formatNotificationReview(entries);
  expect(preview).toContain("example/project · 1 unread");
  expect(preview).toContain("Update dependency 1");
  expect(preview).toContain("CI: passed");
  expect(preview).toContain("https://github.com/example/project/pull/1");
  expect(f.writes).toEqual([]);
});

test("background dismissal returns immediately, limits concurrency and drains queued work with partial failures", async () => {
  const f = fixture([[thread("1"), thread("2"), thread("3"), thread("4")]]);
  const entries = await f.run(review);
  await Effect.runPromise(Effect.gen(function* () {
    const started = yield* Queue.unbounded<string>();
    const release = yield* Deferred.make<void>();

    const run = yield* startNotificationDismissalRun({
      dismiss: (batch) => Effect.gen(function* () {
        for (const entry of batch) yield* Queue.offer(started, entry.thread.id);
        yield* Deferred.await(release);

        return batch.map((entry) => {
          if (entry.thread.id === "2") return { entry, status: "failed" as const, message: "API unavailable" };

          if (entry.thread.id === "3") return { entry, status: "skipped" as const, message: "Evidence changed" };

          return { entry, status: "done" as const, message: "Marked done" };
        });
      }),
    });

    yield* run.enqueue(entries.slice(0, 3), "dependencies");
    expect(new Set([yield* Queue.take(started), yield* Queue.take(started)]).size).toBe(2);
    yield* run.enqueue(entries.slice(3), "dependencies");
    const pending = yield* run.snapshot;
    expect(pending.queued).toBe(4);
    expect(pending.active).toHaveLength(2);
    expect(pending.outcomes).toEqual([]);
    yield* run.close;
    yield* Deferred.succeed(release, undefined);
    const progress = yield* run.finished;
    expect(progress.active).toEqual([]);
    expect(progress.outcomes).toHaveLength(4);
    expect(new Set(progress.outcomes.map((outcome) => outcome.entry.thread.id)).size).toBe(4);
    const summary = formatNotificationSummary({ selected: entries, progress, skipped: new Set(), opened: [], inspectionIssues: [], stopped: true });
    expect(summary).toContain("Review stopped; all queued actions have finished.");
    expect(summary).toContain("2 marked done · 1 left after recheck · 1 failed");
    expect(summary).toContain("0 not reviewed");
    expect(summary).toContain("API unavailable");
    expect(summary).toContain("Evidence changed");
  }).pipe(Effect.scoped, Effect.timeout("5 seconds")));
});
