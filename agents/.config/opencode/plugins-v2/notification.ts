import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect, Stream } from "effect";
import { $ } from "bun";

const SOUND_PATH = "/usr/share/sounds/freedesktop/stereo/message.oga";

const sanitizeNotificationText = (value: string, fallback: string) => {
  const sanitized = Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        character === ";"
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return sanitized || fallback;
};

const createDesktopNotifier = Effect.gen(function* () {
  const originWindowAddress = yield* Effect.tryPromise(() =>
    $`hyprctl activewindow -j | jq -r .address`.text(),
  ).pipe(
    Effect.map((address) => address.trim()),
    Effect.catch(() => Effect.succeed("")),
  );
  const originHerdrTabID = process.env.HERDR_TAB_ID ?? "";
  let canNotify: boolean | undefined;

  return (glyph: string, title: string, body: string) =>
    Effect.gen(function* () {
      if (canNotify === undefined) {
        canNotify = yield* Effect.tryPromise(() =>
          $`sh -lc "command -v omarchy >/dev/null 2>&1"`,
        ).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
      }
      if (!canNotify) return;

      const focusCommand = /^0x[0-9a-f]+$/i.test(originWindowAddress)
        ? `hyprctl dispatch 'hl.dsp.focus({ window = "address:${originWindowAddress}" })'${
            /^[a-z0-9_:-]+$/i.test(originHerdrTabID)
              ? ` && herdr tab focus ${originHerdrTabID}`
              : ""
          }`
        : "";
      yield* Effect.tryPromise(() =>
        $`omarchy notification send -g ${glyph} --app-name OpenCode ${title} ${body} ${focusCommand ? "--exec" : []} ${focusCommand ? focusCommand : []}`,
      ).pipe(Effect.ignore, Effect.forkScoped);
    });
});

export default Plugin.define({
  id: "notification",
  effect: (context) =>
    Effect.gen(function* () {
      const isHerdrSession = process.env.HERDR_ENV === "1";
      const sendDesktopNotification = yield* createDesktopNotifier;
      let canPlaySound: boolean | undefined;

      const playSound = () =>
        Effect.gen(function* () {
          if (canPlaySound === undefined) {
            canPlaySound = yield* Effect.tryPromise(() =>
              $`sh -lc "command -v paplay >/dev/null 2>&1"`,
            ).pipe(
              Effect.as(true),
              Effect.catch(() => Effect.succeed(false)),
            );
          }
          if (!canPlaySound) return;

          yield* Effect.tryPromise(() => $`paplay ${SOUND_PATH}`).pipe(
            Effect.ignore,
          );
        });

      const notify = (glyph: string, title: string, body: string) =>
        Effect.gen(function* () {
          const safeTitle = sanitizeNotificationText(title, "OpenCode");
          const safeBody = sanitizeNotificationText(body, "Attention required");

          if (!isHerdrSession) {
            yield* Effect.sync(() => {
              try {
                process.stdout.write("\u0007");
              } catch {}
            });
          }

          yield* sendDesktopNotification(glyph, safeTitle, safeBody);
          if (!isHerdrSession) yield* playSound();
        });

      const getSession = (
        sessionID: Parameters<typeof context.session.get>[0]["sessionID"],
      ) =>
        context.session
          .get({ sessionID })
          .pipe(Effect.catch(() => Effect.succeed(undefined)));

      yield* context.event.subscribe().pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === "session.idle") {
              const session = yield* getSession(event.data.sessionID);
              if (session?.parentID) return;

              yield* notify(
                "✓",
                "OpenCode: Task complete",
                session?.title ?? "OpenCode session",
              );
              return;
            }

            if (event.type === "permission.asked") {
              const session = yield* getSession(event.data.sessionID);
              const sessionTitle = session?.title ?? "OpenCode session";
              yield* notify(
                "🔒",
                "OpenCode: Permission required",
                `${sessionTitle} needs permission: ${event.data.action}`,
              );
            }
          }),
        ),
        Effect.orDie,
        Effect.forkScoped,
      );
    }),
});
