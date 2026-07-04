/**
 * @file Pull request collection for the branch-context producer.
 *
 * Fetches the pull request associated with the current branch via `gh pr view`
 * (one call covering summary, description, comments, reviews, review decision,
 * and labels) plus an optional `gh pr checks` call. Every failure (missing gh,
 * no PR for the branch, network error) resolves to `null` with a warning so the
 * branch-context snapshot never fails on the pull request lookup.
 */
import { Effect } from "effect";
import { GitHub } from "../services/GitHub.js";
import type {
  BranchContextOptions,
  PullRequestComment,
  PullRequestData,
  PullRequestReview,
  PullRequestSummary,
} from "./model.js";

/** Result of a pull request collection attempt: data and any warnings. */
export interface PullRequestResult {
  /** Collected pull request data, or `null` when none applies. */
  readonly data: PullRequestData | null;
  /** Non-fatal warnings raised during collection. */
  readonly warnings: readonly string[];
}

/** Narrow an unknown value to a record for safe field access. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Read a string field, defaulting to empty. */
function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

/** Read a boolean field, defaulting to false. */
function booleanField(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  return typeof value === "boolean" ? value : false;
}

/** Read a `gh` author object's login, defaulting to `(unknown)`. */
function authorLogin(value: unknown): string {
  if (isRecord(value)) {
    const login = value.login;
    if (typeof login === "string" && login) return login;
  }
  return "(unknown)";
}

/** Parse the always-on summary fields from a `gh pr view` record. */
function parseSummary(
  record: Record<string, unknown>,
): PullRequestSummary | null {
  const number = record.number;
  const title = record.title;
  if (typeof number !== "number" || typeof title !== "string") return null;
  const comments = record.comments;
  return {
    number,
    state: stringField(record, "state"),
    title,
    commentCount: Array.isArray(comments) ? comments.length : 0,
    reviewDecision: stringField(record, "reviewDecision"),
    url: stringField(record, "url"),
    isDraft: booleanField(record, "isDraft"),
    mergeStateStatus: stringField(record, "mergeStateStatus"),
    headRefName: stringField(record, "headRefName"),
    baseRefName: stringField(record, "baseRefName"),
  };
}

/** Parse conversation comments from a `gh pr view` record. */
function parseComments(value: unknown): readonly PullRequestComment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((comment) => ({
    author: authorLogin(comment.author),
    createdAt: stringField(comment, "createdAt"),
    body: stringField(comment, "body"),
  }));
}

/** Parse review submissions from a `gh pr view` record. */
function parseReviews(value: unknown): readonly PullRequestReview[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((review) => ({
    author: authorLogin(review.author),
    state: stringField(review, "state"),
    submittedAt: stringField(review, "submittedAt"),
    body: stringField(review, "body"),
  }));
}

/** Parse label names from a `gh pr view` record. */
function parseLabels(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((label) => stringField(label, "name"))
    .filter(Boolean);
}

/** Build the `--json` field list for `gh pr view` based on enabled sections. */
function prViewFields(options: BranchContextOptions): string {
  const fields = [
    "number",
    "state",
    "title",
    "url",
    "isDraft",
    "mergeStateStatus",
    "headRefName",
    "baseRefName",
    "reviewDecision",
    "body",
    "comments",
  ];
  if (options.labels) fields.push("labels");
  if (options.reviews) fields.push("reviews");
  return fields.join(",");
}

/**
 * Collect the pull request for the current branch. Skips entirely (returns
 * `null`, no warning) when the pull request section is disabled. Resolves to
 * `null` with no warning when there is simply no PR for the branch, and to
 * `null` with a warning on an unexpected failure.
 */
export function collectPullRequest(
  options: BranchContextOptions,
): Effect.Effect<PullRequestResult, never, GitHub> {
  return Effect.gen(function* () {
    if (!options.pullRequest) return { data: null, warnings: [] };

    const github = yield* GitHub;
    const viewResult = yield* github
      .json(["pr", "view", "--json", prViewFields(options)], {
        checkRateLimit: false,
        retries: 0,
      })
      .pipe(
        Effect.matchEffect({
          onSuccess: (value) => Effect.succeed({ ok: true as const, value }),
          onFailure: (error) => Effect.succeed({ ok: false as const, error }),
        }),
      );

    if (!viewResult.ok) {
      // A missing PR is the common, expected case and not worth a warning.
      const stderr = viewResult.error.stderr.toLowerCase();
      if (stderr.includes("no pull requests found")) {
        return { data: null, warnings: [] };
      }
      return {
        data: null,
        warnings: [
          `Unable to read PR details: ${viewResult.error.stderr.trim() || viewResult.error.command}`,
        ],
      };
    }

    if (!isRecord(viewResult.value)) return { data: null, warnings: [] };
    const summary = parseSummary(viewResult.value);
    if (!summary) return { data: null, warnings: [] };

    const warnings: string[] = [];
    const record = viewResult.value;

    let checks: string | undefined;
    if (options.checks) {
      const checksResult = yield* github
        .run(["pr", "checks", String(summary.number)], {
          checkRateLimit: false,
          retries: 0,
        })
        .pipe(
          Effect.matchEffect({
            onSuccess: (value) => Effect.succeed({ ok: true as const, value }),
            onFailure: (error) => Effect.succeed({ ok: false as const, error }),
          }),
        );
      // `gh pr checks` exits non-zero when checks are pending or failing, so its
      // stdout is still useful; keep it and only warn when there is no output.
      if (checksResult.ok) {
        checks = checksResult.value.trim();
      } else {
        checks = checksResult.error.stderr.trim();
        if (!checks) warnings.push("Unable to read PR checks.");
      }
    }

    const data: PullRequestData = {
      summary,
      ...(options.description
        ? { description: stringField(record, "body") }
        : {}),
      ...(options.labels ? { labels: parseLabels(record.labels) } : {}),
      ...(options.comments ? { comments: parseComments(record.comments) } : {}),
      ...(options.reviews ? { reviews: parseReviews(record.reviews) } : {}),
      ...(checks !== undefined ? { checks } : {}),
    };
    return { data, warnings };
  });
}
