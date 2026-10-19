import { Effect, Fiber, Option } from "effect";
import {
  formatCommandError,
  handleCommandError,
} from "../git/commands/rows.js";
import {
  gitItemGitHubUrl,
  openGitItemInPanel,
  parseGitItemLink,
} from "../git/itemLinks.js";
import {
  launchBrowser,
  LinkBrowserError,
  linkSiteRule,
  resolveLinkBrowser,
} from "../lib/linkBrowser.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

/**
 * Show an "Opening link" notification until the scope closes, which is once
 * the browser has the link. The notification is shown without waiting for it,
 * and expires on its own if closing it fails.
 */
const showOpeningLink = Effect.fn("showOpeningLink")(function* (link: string) {
  const executor = yield* CommandExecutor;

  // The notification body is markup, so escape the link's `&`, `<` and `>`.
  // Zero-width spaces let a long link wrap rather than being cut off.
  const body = link
    .replace(/([/?&])(?!\/)/g, "$1\u200B")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  yield* Effect.acquireRelease(
    executor
      .run("notify-send", [
        "--print-id",
        "--app-name=dot",
        "--expire-time=10000",
        "--hint=boolean:transient:true",
        "Opening link",
        body,
      ])
      .pipe(Effect.option, Effect.forkChild),
    (notification) =>
      Fiber.join(notification).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (id) =>
              executor.run("gdbus", [
                "call",
                "--session",
                "--dest=org.freedesktop.Notifications",
                "--object-path=/org/freedesktop/Notifications",
                "--method=org.freedesktop.Notifications.CloseNotification",
                id.trim(),
              ]),
          }),
        ),
        Effect.ignore,
      ),
  );
});

/**
 * Open a link in the browser chosen by `links` in dot-git.yml. Anything other
 * than a single HTTP or HTTPS link, such as no arguments or `--incognito`, goes
 * to the personal browser unchanged, so this can stand in as the desktop's
 * default browser. A `dot://git/...` link opens its item in the Git panel when
 * the panel lists it, and its GitHub page otherwise.
 */
export const linkOpen = Effect.fn("linkOpen")(
  function* (args: readonly string[], background = false) {
    const [link] = args;

    const deepLink = args.length === 1 && link && /^dot:/i.test(link);

    if (
      !background &&
      args.length === 1 &&
      link &&
      /^(dot|https?):/i.test(link)
    )
      yield* showOpeningLink(link);

    const item = deepLink ? parseGitItemLink(link) : undefined;

    if (deepLink && !item)
      return yield* new LinkBrowserError({
        message: `Unsupported dot link: ${link}`,
      });

    if (item && (yield* openGitItemInPanel(item))) return;

    const { gitConfig } = yield* Config;

    if (!gitConfig.links)
      return yield* new LinkBrowserError({
        message: gitConfig.valid
          ? "Set links.personal in dot-git.yml to route links"
          : `dot-git.yml is invalid: ${gitConfig.diagnostics.join("; ")}`,
      });

    const target = item ? [gitItemGitHubUrl(item)] : args;

    const [first] = target;

    const url =
      target.length === 1 && first && /^https?:\/\//i.test(first)
        ? URL.parse(first)
        : null;

    const browser =
      (url && (yield* resolveLinkBrowser(gitConfig, url))) ??
      gitConfig.links.personal;

    yield* launchBrowser(gitConfig, browser, target, {
      workspace: url ? linkSiteRule(gitConfig, url)?.workspace : undefined,
      background,
    });
  },
  Effect.scoped,
  // Links usually open from other apps, where nobody sees stderr.
  Effect.tapError((error) =>
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;

      yield* executor
        .run("notify-send", ["Could not open link", formatCommandError(error)])
        .pipe(Effect.ignore);
    }),
  ),
  handleCommandError("link-open"),
);
