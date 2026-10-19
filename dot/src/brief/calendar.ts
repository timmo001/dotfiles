import {
  BridgeClient,
  getCalendarEvents,
  resolveSocketPath,
} from "@timmo001/effect-ha-bridge";
import { Effect, Option } from "effect";
import { readWorkSchedule } from "../lib/workTime.js";

/** A day's timed meetings, such as `Today` or `Wednesday`. */
export interface WorkDay {
  readonly label: string;
  readonly events: readonly {
    readonly time: string;
    readonly summary: string;
  }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (ms: number) => {
  const date = new Date(ms);

  date.setHours(0, 0, 0, 0);

  return date.getTime();
};

/**
 * Timed events on `entity` for today and the next working day, in local time.
 * Empty when the calendar is unset or Home Assistant can't be reached.
 */
export const workDayEvents = Effect.fn("brief.workDayEvents")(function* (
  entity: string | undefined,
  now: number,
) {
  if (!entity) return [];

  const schedule = yield* readWorkSchedule(() => Effect.void);
  const today = startOfDay(now);

  const nextDay = [1, 2, 3, 4, 5, 6, 7]
    .map((offset) => startOfDay(today + offset * DAY_MS + DAY_MS / 2))
    .find((day) =>
      (schedule?.work_hours.days ?? [1, 2, 3, 4, 5]).includes(
        new Date(day).getDay() || 7,
      ),
    );

  const days = nextDay === undefined ? [today] : [today, nextDay];
  const end = startOfDay((days.at(-1) ?? today) + DAY_MS * 1.5);

  const events = yield* resolveSocketPath(Option.none()).pipe(
    Effect.flatMap((socketPath) =>
      getCalendarEvents(
        { entity_id: [entity] },
        { start: new Date(now), end: new Date(end) },
      ).pipe(Effect.provide(BridgeClient.layer(socketPath))),
    ),
    Effect.map((byCalendar) => byCalendar[entity] ?? []),
    Effect.timeout("5 seconds"),
    Effect.orElseSucceed(() => []),
  );

  const timed = events
    .filter((event) => event.start.includes("T"))
    .map((event) => ({
      start: Date.parse(event.start),
      summary: event.summary,
    }))
    .filter((event) => Number.isFinite(event.start))
    .sort((a, b) => a.start - b.start);

  return days.flatMap((day, index): WorkDay[] => {
    const dayEvents = timed.filter((event) => startOfDay(event.start) === day);

    return dayEvents.length > 0
      ? [
          {
            label:
              index === 0
                ? "Today"
                : new Date(day).toLocaleDateString("en-GB", {
                    weekday: "long",
                  }),
            events: dayEvents.map((event) => ({
              time: new Date(event.start).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              summary: event.summary.trim(),
            })),
          },
        ]
      : [];
  });
});
