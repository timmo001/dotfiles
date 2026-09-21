import { Effect } from "effect";
import type {
  GitNotificationCategory,
  GitNotificationReview,
} from "../../types.js";
import { cliStyler } from "../../lib/ansi.js";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { OutputLog } from "../../services/OutputLog.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import {
  GitNotifications,
  GitNotificationError,
} from "../services/GitNotifications.js";
import { managedRepoGitHubSlugs } from "../services/repoRelations.js";
import { handleCommandError, writeText } from "./rows.js";
import {
  startNotificationDismissalRun,
  type NotificationDismissalRun,
  type NotificationDismissProgress,
} from "./notificationDismissalRun.js";
import { chooseNotificationAction as choose } from "./notificationPrompt.js";

/** Options for the combined review or one of its two passes. */
export interface NotificationDismissOptions {
  /** Combined review, verified dependencies, or the remaining inbox. */
  readonly scope: "all" | GitNotificationCategory;
  /** Configured repository name/path or GitHub owner/repository. */
  readonly repo?: string;
  /** Automatic dismissal is available only for the dependencies pass. */
  readonly mode?: "all" | "repos";
  /** Print the same review without prompts or mutations. */
  readonly dryRun: boolean;
}

function groups(entries: readonly GitNotificationReview[]) {
  const repos = [...new Set(entries.map((entry) => entry.thread.repo))].sort(
    (a, b) => a.localeCompare(b),
  );

  return repos.map((repo) => ({
    repo,
    entries: entries
      .filter((entry) => entry.thread.repo === repo)
      .toSorted((a, b) =>
        a.thread.webUrl.localeCompare(b.thread.webUrl, undefined, {
          numeric: true,
        }),
      ),
  }));
}

function terminalText(value: string) {
  return value.replace(/\p{Cc}/gu, " ");
}

function threadLabel(entry: GitNotificationReview, index: number) {
  const number = entry.thread.webUrl.match(/\/(?:pull|issues)\/(\d+)$/)?.[1];

  return `${index + 1}. ${number ? `#${number} ` : ""}${terminalText(entry.thread.title)}`;
}

/** Format repository batches with current status, reasons and links before prompting. */
export function formatNotificationReview(
  entries: readonly GitNotificationReview[],
): string {
  const style = cliStyler();

  return (
    groups(entries)
      .map((group) =>
        [
          style.heading(`${group.repo} · ${group.entries.length} unread`),
          ...group.entries.flatMap((entry, index) => [
            `  ${style.label(threadLabel(entry, index))}`,
            `     ${entry.category === "dependencies" ? style.success(terminalText(entry.detail)) : style.warn(terminalText(entry.detail))}`,
            `     ${style.dim(`${entry.thread.reason} · ${entry.thread.webUrl}`)}`,
            "",
          ]),
        ].join("\n"),
      )
      .join("\n\n") + "\n"
  );
}

interface OpenedLink {
  readonly url: string;
  readonly error: string | null;
}

interface NotificationReviewReport {
  readonly selected: readonly GitNotificationReview[];
  readonly progress: NotificationDismissProgress;
  readonly skipped: ReadonlySet<string>;
  readonly opened: readonly OpenedLink[];
  readonly inspectionIssues: readonly GitNotificationReview[];
  readonly stopped: boolean;
}

/** Summarise requested actions, final completions and every unresolved issue by repository. */
export function formatNotificationSummary(
  report: NotificationReviewReport,
): string {
  const style = cliStyler();
  const { outcomes } = report.progress;

  const count = (status: "done" | "skipped" | "failed") =>
    outcomes.filter((outcome) => outcome.status === status).length;

  const lines = [
    "",
    style.heading("Notification Summary"),
    report.stopped
      ? "Review stopped; all queued actions have finished."
      : "Review complete; all queued actions have finished.",
    `Actions: ${report.progress.queued} queued for dismissal · ${report.skipped.size} skipped by choice · ${report.selected.length - outcomes.length - report.skipped.size} not reviewed`,
    `Results: ${count("done")} marked done · ${count("skipped")} left after recheck · ${count("failed")} failed`,
    `GitHub: ${report.opened.filter((link) => !link.error).length} links opened · ${report.opened.filter((link) => link.error).length} failed to open`,
    "",
    style.label("Repositories"),
  ];

  for (const group of groups(report.selected)) {
    const completed = outcomes.filter(
      (outcome) => outcome.entry.thread.repo === group.repo,
    );

    const done = completed.filter(
      (outcome) => outcome.status === "done",
    ).length;

    const failed = completed.filter(
      (outcome) => outcome.status === "failed",
    ).length;

    const changed = completed.filter(
      (outcome) => outcome.status === "skipped",
    ).length;

    const skipped = group.entries.filter((entry) =>
      report.skipped.has(entry.thread.id),
    ).length;

    lines.push(
      `  ${group.repo}: ${done} done · ${changed} left after recheck · ${failed} failed · ${skipped} skipped · ${group.entries.length - completed.length - skipped} not reviewed`,
    );
  }

  const issues = [
    ...outcomes
      .filter((outcome) => outcome.status !== "done")
      .map(
        (outcome) =>
          `${outcome.entry.thread.repo}: ${outcome.entry.thread.title}\n    ${outcome.message}\n    ${outcome.entry.thread.webUrl}`,
      ),
    ...report.inspectionIssues.map(
      (entry) =>
        `${entry.thread.repo}: ${entry.thread.title}\n    ${entry.detail}\n    ${entry.thread.webUrl}`,
    ),
    ...report.opened
      .filter((link) => link.error)
      .map((link) => `Could not open ${link.url}\n    ${link.error}`),
  ];

  lines.push("", style.label(`Issues · ${issues.length}`));

  for (const issue of issues)
    lines.push("  " + issue.split("\n").map(terminalText).join("\n"));

  if (!issues.length) lines.push("  None.");

  return lines.join("\n") + "\n";
}

const openReview = Effect.fn("notifications.openReview")(function* (
  url: string,
  opened: OpenedLink[],
) {
  const executor = yield* CommandExecutor;

  const error = yield* executor.run("dot", ["git-web", "--url", url]).pipe(
    Effect.match({
      onFailure: (error) => error.stderr || error.message,
      onSuccess: () => null,
    }),
  );

  opened.push({ url, error });

  if (error)
    yield* writeText(`Could not open GitHub: ${terminalText(error)}\n`);
});

const selectThread = Effect.fn("notifications.selectThread")(function* (
  entries: readonly GitNotificationReview[],
  run: NotificationDismissalRun,
  opened: OpenedLink[],
) {
  const selected = yield* choose(
    "Open a notification on GitHub",
    [
      ...entries.map((entry, index) => ({
        title: threadLabel(entry, index),
        value: entry.thread.id,
      })),
      { title: "Back", value: "back" },
    ],
    run,
  );

  const entry = entries.find((entry) => entry.thread.id === selected);

  if (entry) yield* openReview(entry.thread.webUrl, opened);

  return selected === "stop";
});

/** Review unread notifications, dependencies first, with explicit manual remaining batches. */
export const notificationsDismiss = Effect.fn("notifications.dismiss")(
  function* (options: NotificationDismissOptions) {
    if (options.mode === "all" && options.scope !== "dependencies")
      return yield* new GitNotificationError({
        message:
          "Automatic dismissal is only available for dismiss dependencies",
      });

    if (
      !options.dryRun &&
      options.mode !== "all" &&
      (!process.stdin.isTTY || !process.stdout.isTTY)
    )
      return yield* new GitNotificationError({
        message:
          "Review requires a terminal; use --dry-run to preview, or dismiss dependencies --mode all",
      });

    const notifications = yield* GitNotifications;
    const config = yield* Config;
    const log = yield* OutputLog;
    const executor = yield* CommandExecutor;
    const style = cliStyler();

    const configured = options.repo
      ? managedGitRepos(config.gitConfig).find((repo) =>
          [repo.name, repo.path, repo.github].some(
            (value) => value.toLowerCase() === options.repo?.toLowerCase(),
          ),
        )
      : undefined;

    const repo = configured?.github ?? options.repo;

    if (repo && !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo))
      return yield* new GitNotificationError({
        message:
          "Use a configured repository name/path or an owner/repository slug",
      });

    const repos =
      configured &&
      options.repo?.toLowerCase() !== configured.github.toLowerCase()
        ? yield* managedRepoGitHubSlugs(configured, executor)
        : repo
          ? [repo]
          : undefined;

    const inspect = notifications.review(repos);

    const entries = yield* process.stdout.isTTY
      ? log.withSpinner("Inspecting unread notifications and CI", inspect)
      : inspect;

    const passes: readonly GitNotificationCategory[] =
      options.scope === "all" ? ["dependencies", "remaining"] : [options.scope];

    const selected = entries.filter((entry) => passes.includes(entry.category));
    yield* writeText(
      `\n${style.heading("Notification Review")}\n${selected.length} unread notification${selected.length === 1 ? "" : "s"} across ${groups(selected).length} repositor${groups(selected).length === 1 ? "y" : "ies"}.\n`,
    );

    for (const category of passes) {
      const batch = selected.filter((entry) => entry.category === category);
      yield* writeText(
        `\n${style.label(category === "dependencies" ? "Merged Dependencies" : "Remaining Notifications")} · ${batch.length}\n`,
      );
      yield* writeText(
        batch.length
          ? formatNotificationReview(batch)
          : "  Nothing to review.\n",
      );
    }

    const unavailable = entries.filter(
      (entry) => entry.inspectionFailed,
    ).length;

    if (unavailable)
      yield* writeText(
        style.warn(
          `\n${unavailable} notifications could not be fully inspected. They only appear in manual review.\n`,
        ),
      );

    if (options.dryRun) {
      yield* writeText("\nPreview only; no notifications changed.\n");

      if (unavailable) process.exitCode = 1;

      return;
    }

    const run = yield* startNotificationDismissalRun(notifications);
    const skipped = new Set<string>();
    const opened: OpenedLink[] = [];
    let stopped = false;

    for (const category of passes) {
      const batch = selected.filter((entry) => entry.category === category);

      if (!batch.length) continue;

      let mode =
        options.mode ??
        (options.repo || groups(batch).length === 1 ? "repos" : undefined);

      while (category === "dependencies" && !mode) {
        const choice = yield* choose(
          "Merged dependencies",
          [
            { title: "Review each repository", value: "repos" },
            {
              title: `Mark all ${batch.length} verified notifications done`,
              value: "all",
            },
            { title: "Open a repository inbox on GitHub", value: "open-group" },
            { title: "Open a notification on GitHub", value: "open-one" },
            { title: "Stop", value: "stop" },
          ],
          run,
        );

        if (choice === "stop") {
          stopped = true;
          break;
        }

        if (choice === "open-one") {
          if (yield* selectThread(batch, run, opened)) {
            stopped = true;
            break;
          }
        } else if (choice === "open-group") {
          const selectedRepo = yield* choose(
            "Open repository inbox",
            [
              ...groups(batch).map((group) => ({
                title: `${group.repo} · ${group.entries.length}`,
                value: group.repo,
              })),
              { title: "Back", value: "back" },
            ],
            run,
          );

          if (selectedRepo === "stop") {
            stopped = true;
            break;
          }

          if (selectedRepo !== "back")
            yield* openReview(
              `https://github.com/notifications?query=${encodeURIComponent(`is:unread repo:${selectedRepo}`)}`,
              opened,
            );
        } else mode = choice === "all" ? "all" : "repos";
      }

      if (stopped) break;

      for (const group of groups(batch)) {
        let action = mode === "all" ? "done" : "";

        while (!action) {
          yield* writeText(
            `\n\n${style.label(category === "dependencies" ? "Merged Dependencies" : "Remaining Notifications")}\n${formatNotificationReview(group.entries)}`,
          );

          const choice = yield* choose(
            `${group.repo}: what next?`,
            [
              {
                title: `Mark these ${group.entries.length} notifications done`,
                value: "done",
              },
              { title: "Open repository inbox on GitHub", value: "open-group" },
              { title: "Open a notification on GitHub", value: "open-one" },
              { title: "Skip this repository", value: "skip" },
              { title: "Stop", value: "stop" },
            ],
            run,
          );

          if (choice === "open-group")
            yield* openReview(
              `https://github.com/notifications?query=${encodeURIComponent(`is:unread repo:${group.repo}`)}`,
              opened,
            );
          else if (choice === "open-one") {
            if (yield* selectThread(group.entries, run, opened))
              action = "stop";
          } else action = choice;
        }

        if (action === "stop") {
          stopped = true;
          break;
        }

        if (action === "skip") {
          for (const entry of group.entries) skipped.add(entry.thread.id);
          continue;
        }

        yield* run.enqueue(group.entries, category);
      }

      if (stopped) break;
    }

    yield* run.close;

    if (process.stdout.isTTY)
      yield* Effect.raceFirst(
        choose(
          stopped
            ? "Review stopped; finishing queued actions"
            : "Finishing queued actions",
          [],
          run,
        ),
        run.finished,
      );
    const progress = yield* run.finished;
    yield* writeText(
      formatNotificationSummary({
        selected,
        progress,
        skipped,
        opened,
        inspectionIssues: entries.filter((entry) => entry.inspectionFailed),
        stopped,
      }),
    );

    const failed = progress.outcomes.filter(
      (outcome) => outcome.status === "failed",
    ).length;

    if (failed || unavailable || opened.some((link) => link.error))
      process.exitCode = 1;
  },
  Effect.scoped,
  Effect.tap(() =>
    Effect.callback<void, GitNotificationError>((resume) => {
      process.stdout.write("", (error) =>
        resume(
          error
            ? Effect.fail(
                new GitNotificationError({
                  message: `Could not write notification summary: ${error.message}`,
                }),
              )
            : Effect.void,
        ),
      );
    }),
  ),
  handleCommandError("dot git-notifications dismiss"),
);
