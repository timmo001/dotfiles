import { Clock, Effect, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { existsSync } from "fs";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { expandHomePath } from "./paths.js";

class CalendarEventError extends Schema.TaggedError<CalendarEventError>()(
  "CalendarEventError",
  { message: Schema.String },
) {}

const CalendarConfig = Schema.Struct({
  credentials_file: Schema.NonEmptyString,
  calendars: Schema.Array(
    Schema.Struct({
      entity_id: Schema.String.check(
        Schema.isPattern(/^calendar\.[a-z0-9_]+$/),
      ),
      summaries: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    }),
  ),
});

const Credentials = Schema.Struct({
  homeassistant: Schema.Struct({
    url: Schema.NonEmptyString,
    token: Schema.NonEmptyString,
  }),
});

const EventTime = Schema.Union([
  Schema.Struct({
    date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  }),
  Schema.Struct({ dateTime: Schema.String }),
]);

const CalendarEvents = Schema.Array(
  Schema.Struct({
    summary: Schema.String,
    start: EventTime,
    end: EventTime,
  }),
);

const calendarLeave = Effect.fn("workTime.calendarLeave")(function* (
  configPath: string,
) {
  const config = yield* Effect.tryPromise(() =>
    Bun.file(configPath).text(),
  ).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(CalendarConfig)),
  );

  if (config.calendars.length === 0) return false;

  const credentials = yield* Effect.tryPromise(() =>
    Bun.file(expandHomePath(config.credentials_file)).text(),
  ).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(Credentials)),
  );

  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      HttpClientRequest.bearerToken(credentials.homeassistant.token),
    ),
    HttpClient.filterStatusOk,
  );

  const baseUrl = `${credentials.homeassistant.url.replace(/\/$/, "")}/api`;

  const haConfig = yield* client
    .get(`${baseUrl}/config`)
    .pipe(
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(
          Schema.Struct({ time_zone: Schema.String }),
        ),
      ),
    );

  const now = yield* Clock.currentTimeMillis;

  const today = yield* Effect.try(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: haConfig.time_zone }).format(
      new Date(now),
    ),
  );

  for (const calendar of config.calendars) {
    const events = yield* client
      .get(`${baseUrl}/calendars/${calendar.entity_id}`, {
        urlParams: {
          start: new Date(now).toISOString(),
          end: new Date(now + 1000).toISOString(),
        },
      })
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(CalendarEvents)));

    for (const event of events) {
      if (
        calendar.summaries !== undefined &&
        !calendar.summaries.some(
          (summary) =>
            summary.trim().toLowerCase() === event.summary.trim().toLowerCase(),
        )
      )
        continue;

      if ("date" in event.start && "date" in event.end) {
        if (event.start.date <= today && today < event.end.date) return true;
      } else if ("dateTime" in event.start && "dateTime" in event.end) {
        const start = Date.parse(event.start.dateTime);
        const end = Date.parse(event.end.dateTime);

        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          return yield* Effect.fail(
            new CalendarEventError({ message: "Invalid calendar event time" }),
          );
        }

        if (start <= now && now < end) return true;
      } else {
        return yield* Effect.fail(
          new CalendarEventError({
            message: "Inconsistent calendar event times",
          }),
        );
      }
    }
  }

  return false;
});

/** Check shared work hours with optional private calendar leave exclusions. */
export const isWorkTime = Effect.fn("isWorkTime")(function* (
  log: (message: string) => Effect.Effect<void>,
) {
  const executor = yield* CommandExecutor;

  if ((yield* executor.exitCode("is-work-time", [])) !== 0) return false;

  const config = yield* Config;

  if (!config.privateDotfiles) return true;
  const configPath = join(config.privateDotfiles, "workspace-calendar.yml");

  if (!existsSync(configPath)) return true;

  const leave = yield* calendarLeave(configPath).pipe(
    Effect.provide(FetchHttpClient.layer),
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
