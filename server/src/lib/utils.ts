import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes, later ones winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "short",
  timeStyle: "short",
});

/** An epoch-millisecond time for the page, or an empty string. */
export function formatTime(time: number | undefined): string {
  return time === undefined ? "" : dateTime.format(time);
}
