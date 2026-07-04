const RELATIVE_TIME_UNITS: readonly {
  readonly limit: number;
  readonly seconds: number;
  readonly suffix: string | null;
}[] = [
  { limit: 5, seconds: 1, suffix: null },
  { limit: 60, seconds: 1, suffix: "s" },
  { limit: 3600, seconds: 60, suffix: "m" },
  { limit: 86400, seconds: 3600, suffix: "h" },
];

/** Format an ISO timestamp as a compact relative time. */
export function formatRelativeTimeAgo(
  value: string | null,
  now: number = Date.now(),
): string {
  const time = new Date(value ?? "").getTime();
  if (!Number.isFinite(time)) return "unknown";

  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  const unit = RELATIVE_TIME_UNITS.find(
    (candidate) => seconds < candidate.limit,
  );
  return unit
    ? formatRelativeTimeUnit(seconds, unit)
    : formatRelativeDays(seconds);
}

function formatRelativeTimeUnit(
  seconds: number,
  unit: (typeof RELATIVE_TIME_UNITS)[number],
): string {
  return unit.suffix
    ? `${Math.floor(seconds / unit.seconds)}${unit.suffix} ago`
    : "just now";
}

function formatRelativeDays(seconds: number): string {
  return `${Math.floor(seconds / 86400)}d ago`;
}
