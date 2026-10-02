import {
  BridgeClient,
  getCalendarEvents,
  resolveSocketPath,
} from "@timmo001/effect-ha-bridge";
import { Clock, Effect, FileSystem, Option, Schema } from "effect";
import { join } from "path";
import { Config } from "../services/Config.js";
import { pathExists } from "./fsProbe.js";

class CalendarEventError extends Schema.TaggedError<CalendarEventError>()(
  "CalendarEventError",
  { message: Schema.String },
) {}

const CalendarConfig = Schema.Struct({
  work_hours: Schema.Struct({
    days: Schema.Array(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 7 })),
    ),
    start: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
    end: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
  }),
  calendars: Schema.Array(
    Schema.Struct({
      entity_id: Schema.TemplateLiteral(["calendar.", Schema.String]).check(
        Schema.isPattern(/^calendar\.[a-z0-9_]+$/),
      ),
      summaries: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
      summaries_contain: Schema.optionalKey(
        Schema.Array(Schema.NonEmptyString),
      ),
    }),
  ),
});

// All-day events use ISO dates; timed events use date-times.
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const calendarLeave = Effect.fn("workTime.calendarLeave")(function* (
  config: typeof CalendarConfig.Type,
) {
  if (config.calendars.length === 0) return false;

  const client = yield* BridgeClient;
  const haConfig = yield* client.GetConfig();
  const now = yield* Clock.currentTimeMillis;

  const today = yield* Effect.try(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: haConfig.time_zone }).format(
      new Date(now),
    ),
  );

  const eventsByCalendar = yield* getCalendarEvents(
    { entity_id: config.calendars.map((calendar) => calendar.entity_id) },
    { start: new Date(now), end: new Date(now + 1000) },
  );

  for (const calendar of config.calendars) {
    const events = eventsByCalendar[calendar.entity_id] ?? [];

    for (const event of events) {
      const title = event.summary.trim().toLowerCase();

      if (
        (calendar.summaries !== undefined ||
          calendar.summaries_contain !== undefined) &&
        !calendar.summaries?.some(
          (summary) => summary.trim().toLowerCase() === title,
        ) &&
        !calendar.summaries_contain?.some((part) =>
          title.includes(part.trim().toLowerCase()),
        )
      )
        continue;

      if (isDate(event.start) && isDate(event.end)) {
        if (event.start <= today && today < event.end) return true;
      } else if (!isDate(event.start) && !isDate(event.end)) {
        const start = Date.parse(event.start);
        const end = Date.parse(event.end);

        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          return yield* new CalendarEventError({
            message: "Invalid calendar event time",
          });
        }

        if (start <= now && now < end) return true;
      } else {
        return yield* new CalendarEventError({
          message: "Inconsistent calendar event times",
        });
      }
    }
  }

  return false;
});

/** Check private work hours with calendar leave exclusions. */
export const isWorkTime = Effect.fn("isWorkTime")(function* (
  log: (message: string) => Effect.Effect<void>,
) {
  const config = yield* Config;

  if (!config.privateDotfiles) return false;
  const configPath = join(config.privateDotfiles, "workspace-calendar.yml");

  if (!(yield* pathExists(configPath))) return false;

  const fs = yield* FileSystem.FileSystem;

  const schedule = yield* fs.readFileString(configPath).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(CalendarConfig)),
    Effect.catch(() => log("Work schedule unavailable").pipe(Effect.as(null))),
  );

  if (!schedule) return false;

  const now = new Date(yield* Clock.currentTimeMillis);
  const day = now.getDay() || 7;
  const minutes = now.getHours() * 60 + now.getMinutes();

  const toMinutes = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

  if (
    !schedule.work_hours.days.includes(day) ||
    minutes < toMinutes(schedule.work_hours.start) ||
    minutes >= toMinutes(schedule.work_hours.end)
  )
    return false;

  const leave = yield* resolveSocketPath(Option.none()).pipe(
    Effect.flatMap((socketPath) =>
      calendarLeave(schedule).pipe(
        Effect.provide(BridgeClient.layer(socketPath)),
      ),
    ),
    Effect.timeout("5 seconds"),
    Effect.catch(() =>
      log("Calendar check unavailable; using work hours").pipe(
        Effect.as(false),
      ),
    ),
  );

  if (leave) yield* log("Calendar leave is active; work schedule is inactive");

  return !leave;
});
