import { Effect, Schema } from "effect";
import type {
  GitNotificationReview,
  GitNotificationThread,
} from "../../types.js";
import type { GitHubService } from "./GitHub.js";
import { formatGhError } from "./record.js";

class NotificationEvidenceError extends Schema.TaggedError<NotificationEvidenceError>()(
  "NotificationEvidenceError",
  { message: Schema.String },
) {}

const PullRequest = Schema.Struct({
  state: Schema.Literals(["open", "closed"]),
  merged: Schema.Boolean,
  merged_at: Schema.NullOr(Schema.NonEmptyString),
  draft: Schema.Boolean,
  user: Schema.Struct({ login: Schema.NonEmptyString }),
  head: Schema.Struct({
    sha: Schema.NonEmptyString,
    ref: Schema.NonEmptyString,
  }),
});

const CheckPage = Schema.Struct({
  total_count: Schema.Int,
  check_runs: Schema.Array(
    Schema.Struct({
      name: Schema.NonEmptyString,
      status: Schema.NonEmptyString,
      conclusion: Schema.NullOr(Schema.String),
    }),
  ),
});

const StatusPage = Schema.Struct({
  state: Schema.NonEmptyString,
  total_count: Schema.Int,
  statuses: Schema.Array(
    Schema.Struct({
      context: Schema.NonEmptyString,
      state: Schema.NonEmptyString,
    }),
  ),
});

const Issue = Schema.Struct({ state: Schema.NonEmptyString });

const Workflow = Schema.Struct({
  status: Schema.NonEmptyString,
  conclusion: Schema.NullOr(Schema.String),
});

/** Inspect current evidence without letting lookup failures qualify for bulk dismissal. */
export const inspectNotification = Effect.fn("notifications.inspect")(
  function* (thread: GitNotificationThread, github: GitHubService) {
    const base: GitNotificationReview = {
      thread,
      category: "remaining",
      detail: `${thread.type} · ${thread.reason}`,
      headSha: null,
      inspectionFailed: false,
    };

    return yield* Effect.gen(function* () {
      if (
        thread.type !== "PullRequest" &&
        thread.type !== "Issue" &&
        thread.type !== "WorkflowRun" &&
        thread.type !== "CheckSuite"
      )
        return base;

      const url = yield* Effect.try(() => new URL(thread.subjectApiUrl ?? ""));

      if (
        url.origin !== "https://api.github.com" ||
        !url.pathname.startsWith(`/repos/${thread.repo}/`)
      )
        return yield* new NotificationEvidenceError({
          message: "Invalid notification subject URL",
        });

      const payload = yield* github.json([
        "api",
        "--method",
        "GET",
        url.pathname,
      ]);

      if (thread.type === "Issue") {
        const issue = yield* Schema.decodeUnknownEffect(Issue)(payload);

        return { ...base, detail: `Issue ${issue.state} · ${thread.reason}` };
      }

      if (thread.type === "WorkflowRun" || thread.type === "CheckSuite") {
        const workflow = yield* Schema.decodeUnknownEffect(Workflow)(payload);

        return {
          ...base,
          detail: `CI ${workflow.conclusion ?? workflow.status} · ${thread.reason}`,
        };
      }

      const pr = yield* Schema.decodeUnknownEffect(PullRequest)(payload);

      const dependency =
        pr.head.ref !== "renovate/configure" &&
        (["renovate[bot]", "dependabot[bot]", "renovate"].includes(
          pr.user.login.toLowerCase(),
        ) ||
          pr.head.ref.startsWith("renovate/") ||
          pr.head.ref.startsWith("dependabot/"));

      const merged = pr.merged && pr.merged_at !== null && !pr.draft;

      const state = pr.draft
        ? "Draft PR"
        : merged
          ? "Merged PR"
          : pr.state === "open"
            ? "Open PR"
            : "Closed without merging";

      const prefix = `${state}${dependency ? " · Dependency update" : ""}`;

      return yield* Effect.gen(function* () {
        const ref = `repos/${thread.repo}/commits/${encodeURIComponent(pr.head.sha)}`;

        const [checkPages, statusPages] = yield* Effect.all(
          [
            github
              .json([
                "api",
                "--method",
                "GET",
                `${ref}/check-runs?filter=latest&per_page=100`,
                "--paginate",
                "--slurp",
              ])
              .pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(Schema.Array(CheckPage)),
                ),
              ),
            github
              .json([
                "api",
                "--method",
                "GET",
                `${ref}/status?per_page=100`,
                "--paginate",
                "--slurp",
              ])
              .pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(Schema.Array(StatusPage)),
                ),
              ),
          ],
          { concurrency: 2 },
        );

        const checks = checkPages.flatMap((page) => page.check_runs);
        const statuses = statusPages.flatMap((page) => page.statuses);

        if (
          !checkPages.length ||
          !statusPages.length ||
          checkPages.some((page) => page.total_count > checks.length) ||
          statusPages.some((page) => page.total_count > statuses.length)
        )
          return yield* new NotificationEvidenceError({
            message: "Incomplete CI response",
          });

        const problems = [
          ...checks
            .filter(
              (check) =>
                check.status !== "completed" ||
                !["success", "neutral", "skipped"].includes(
                  check.conclusion ?? "",
                ),
            )
            .map(
              (check) =>
                `${check.name}: ${check.status === "completed" ? (check.conclusion ?? "unknown") : check.status}`,
            ),
          ...statuses
            .filter((status) => status.state !== "success")
            .map((status) => `${status.context}: ${status.state}`),
        ];

        if (
          statuses.length &&
          statusPages.some((page) => page.state !== "success") &&
          !problems.length
        )
          problems.push(
            `Combined status: ${statusPages[0]?.state ?? "unknown"}`,
          );

        const successful =
          checks.some(
            (check) =>
              check.status === "completed" && check.conclusion === "success",
          ) || statuses.some((status) => status.state === "success");

        const passed = successful && !problems.length;

        const ci = problems.length
          ? problems.join("; ")
          : passed
            ? "passed"
            : "no successful checks reported";

        return {
          ...base,
          category:
            dependency && merged && passed
              ? ("dependencies" as const)
              : ("remaining" as const),
          detail: `${prefix} · CI: ${ci}`,
          headSha: pr.head.sha,
        };
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            ...base,
            headSha: pr.head.sha,
            detail: `${prefix} · CI unavailable: ${formatGhError(error)}`,
            inspectionFailed: true,
          }),
        ),
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          ...base,
          detail: `${base.detail} · Inspection unavailable: ${formatGhError(error)}`,
          inspectionFailed: true,
        }),
      ),
    );
  },
);
