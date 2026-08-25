import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect, Stream } from "effect";
import { $ } from "bun";

const SOUND_PATH = "/usr/share/sounds/freedesktop/stereo/message.oga";

const createDesktopNotifier = async () => {
  let canNotify: boolean | undefined;
  let originWindowAddress = "";
  const originHerdrTabID = process.env.HERDR_TAB_ID ?? "";

  try {
    const activeWindow = JSON.parse(
      await $`hyprctl activewindow -j`.text(),
    ) as { readonly address?: unknown };
    if (
      typeof activeWindow.address === "string" &&
      /^0x[0-9a-f]+$/i.test(activeWindow.address)
    ) {
      originWindowAddress = activeWindow.address;
    }
  } catch {}

  return async (glyph: string, title: string, body: string) => {
    if (canNotify === undefined) {
      try {
        await $`sh -lc "command -v omarchy >/dev/null 2>&1"`;
        canNotify = true;
      } catch {
        canNotify = false;
      }
    }
    if (!canNotify) return;

    try {
      const focusCommand = originWindowAddress
        ? `hyprctl dispatch 'hl.dsp.focus({ window = "address:${originWindowAddress}" })'${
            /^[a-z0-9_:-]+$/i.test(originHerdrTabID)
              ? ` && herdr tab focus ${originHerdrTabID}`
              : ""
          }`
        : "";
      void $`omarchy notification send -g ${glyph} --app-name OpenCode ${title} ${body} ${focusCommand ? "--exec" : []} ${focusCommand ? focusCommand : []}`.catch(
        () => {},
      );
    } catch {}
  };
};

const sanitizeNotificationText = (value: string, fallback: string) => {
  const sanitized = [...value]
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

export default Plugin.define({
  id: "notification",
  effect: (context) =>
    Effect.gen(function* () {
      const isHerdrSession = process.env.HERDR_ENV === "1";
      const sendDesktopNotification = yield* Effect.promise(() =>
        createDesktopNotifier(),
      );
      let canPlaySound: boolean | undefined;

      const playSound = () =>
        Effect.promise(async () => {
          if (canPlaySound === undefined) {
            try {
              await $`sh -lc "command -v paplay >/dev/null 2>&1"`;
              canPlaySound = true;
            } catch {
              canPlaySound = false;
            }
          }
          if (!canPlaySound) return;

          try {
            await $`paplay ${SOUND_PATH}`;
          } catch {}
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

          yield* Effect.promise(() =>
            sendDesktopNotification(glyph, safeTitle, safeBody),
          );
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
