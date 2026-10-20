/**
 * @file Rings the terminal bell and plays a sound when an agent finishes or needs permission.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Effect, Stream } from "effect";
import { runText } from "./lib/process";

const SOUND_PATH = "/usr/share/sounds/freedesktop/stereo/message.oga";

export default Plugin.define({
  id: "notification",
  effect: (context) =>
    Effect.gen(function* () {
      // Herdr shows agent attention itself.
      if (process.env.HERDR_ENV === "1") return;

      let canPlaySound: boolean | undefined;

      const notify = Effect.gen(function* () {
        yield* Effect.sync(() => {
          try {
            process.stdout.write("\u0007");
          } catch {}
        });

        if (canPlaySound === undefined) {
          canPlaySound = yield* runText("sh", [
            "-lc",
            "command -v paplay >/dev/null 2>&1",
          ]).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          );
        }

        if (!canPlaySound) return;

        yield* runText("paplay", [SOUND_PATH]).pipe(Effect.ignore);
      });

      yield* context.event.subscribe().pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === "session.idle") {
              const session = yield* context.session
                .get({ sessionID: event.data.sessionID })
                .pipe(Effect.catch(() => Effect.succeed(undefined)));

              if (session?.parentID) return;

              yield* notify;

              return;
            }

            if (event.type === "permission.asked") yield* notify;
          }),
        ),
        Effect.orDie,
        Effect.forkScoped,
      );
    }),
});
