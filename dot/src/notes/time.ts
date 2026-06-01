import { formatISO, intlFormat } from "date-fns";

/** Format a date as a full ISO timestamp for note frontmatter. */
export function formatNoteTimestamp(date: Date): string {
  return formatISO(date, { representation: "complete" });
}

/** Format a date in the user's local timezone for note UI labels. */
function formatLocalNoteDateTime(date: Date): string {
  return intlFormat(date, { dateStyle: "medium", timeStyle: "medium" });
}

/** Format an epoch-second timestamp in the user's local timezone. */
export function formatLocalNoteDateTimeFromEpochSeconds(
  epochSeconds: number,
): string {
  return formatLocalNoteDateTime(new Date(epochSeconds * 1000));
}
