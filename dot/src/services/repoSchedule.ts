import { basename, dirname } from "node:path";
import type { ExtraRepo } from "./Config.js";

/** Check if a single cron field matches a value (supports *, ranges, lists, and steps). */
function cronFieldMatches(
  value: number,
  expr: string,
  min: number,
  max: number,
): boolean {
  const trimmed = expr.trim();
  if (trimmed === "*" || trimmed === "?") return true;
  return trimmed
    .split(",")
    .some((part) => cronFieldPartMatches(value, part, min, max));
}

/** Check if a five-field cron expression matches the given time. */
function cronScheduleActive(schedule: string, now: Date = new Date()): boolean {
  if (!schedule.trim()) return true;

  const fields = schedule.trim().split(/\s+/);
  if (fields.length < 5) return true;

  const checks: readonly [
    value: number,
    expr: string,
    min: number,
    max: number,
  ][] = [
    [now.getMinutes(), fields[0], 0, 59],
    [now.getHours(), fields[1], 0, 23],
    [now.getDate(), fields[2], 1, 31],
    [now.getMonth() + 1, fields[3], 1, 12],
    [now.getDay(), fields[4], 0, 6],
  ];
  return checks.every(([value, expr, min, max]) =>
    cronFieldMatches(value, expr, min, max),
  );
}

/** Check if an extra repo is currently visible based on its schedule. */
export function extraRepoVisible(
  repo: ExtraRepo,
  now: Date = new Date(),
): boolean {
  return cronScheduleActive(repo.schedule, now);
}

/** Check if a watched GitHub slug should be visible under matching extra-repo schedules. */
export function workflowSlugVisible(
  slug: string,
  extraRepos: readonly ExtraRepo[],
  now: Date = new Date(),
): boolean {
  const repo = extraRepos.find((extraRepo) =>
    extraRepoScheduleMatchesGithubSlug(extraRepo, slug),
  );
  return repo ? extraRepoVisible(repo, now) : true;
}

/** Return the extra-repo checkout matching a watched GitHub slug, if configured. */
export function findWorkflowExtraRepo(
  slug: string,
  extraRepos: readonly ExtraRepo[],
): ExtraRepo | undefined {
  return extraRepos.find((extraRepo) =>
    extraRepoMatchesGithubSlug(extraRepo, slug),
  );
}

function extraRepoMatchesGithubSlug(repo: ExtraRepo, slug: string): boolean {
  const parsed = parseOwnerRepo(slug);
  if (!parsed) return false;

  const repoName = normalizeSlug(repo.name);
  if (repoName === parsed.slug) return true;

  return repoPathSlug(repo.path) === parsed.slug;
}

function extraRepoScheduleMatchesGithubSlug(
  repo: ExtraRepo,
  slug: string,
): boolean {
  const parsed = parseOwnerRepo(slug);
  if (!parsed) return false;

  const repoName = normalizeSlug(repo.name);
  return (
    repoName === `${parsed.owner}/*` || extraRepoMatchesGithubSlug(repo, slug)
  );
}

function cronFieldPartMatches(
  value: number,
  part: string,
  min: number,
  max: number,
): boolean {
  const [rangePart, stepStr] = part.split("/", 2);
  const step = stepStr ? parseInt(stepStr, 10) : 1;
  const range = parseCronRange(rangePart, min, max);
  return rangeMatches(value, range.start, range.end, step);
}

function parseCronRange(
  rangePart: string,
  min: number,
  max: number,
): { readonly start: number; readonly end: number } {
  if (rangePart === "*") return { start: min, end: max };
  if (!rangePart.includes("-")) {
    const value = parseInt(rangePart, 10);
    return { start: value, end: value };
  }

  const [startStr, endStr] = rangePart.split("-", 2);
  return { start: parseInt(startStr, 10), end: parseInt(endStr, 10) };
}

function rangeMatches(
  value: number,
  start: number,
  end: number,
  step: number,
): boolean {
  return [
    step > 0,
    Number.isFinite(start),
    Number.isFinite(end),
    value >= start,
    value <= end,
    (value - start) % step === 0,
  ].every(Boolean);
}

function repoPathSlug(path: string): string {
  const pathName = normalizeSlug(basename(path));
  const pathOwner = normalizeSlug(basename(dirname(path)));
  return `${pathOwner}/${pathName}`;
}

function parseOwnerRepo(
  value: string,
): { readonly owner: string; readonly slug: string } | null {
  const slug = normalizeSlug(value);
  const [owner, name] = slug.split("/", 2);
  return owner && name ? { owner, slug } : null;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .replace(/^extra:/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}
