import { Effect } from "effect";
import {
  formatCommandError,
  handleCommandError,
} from "../git/commands/rows.js";
import {
  launchBrowser,
  LinkBrowserError,
  resolveLinkBrowser,
} from "../lib/linkBrowser.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

/**
 * Open a link in the browser chosen by `links` in dot-git.yml. Anything other
 * than a single HTTP or HTTPS link, such as no arguments or `--incognito`, goes
 * to the personal browser unchanged, so this can stand in as the desktop's
 * default browser.
 */
export const linkOpen = Effect.fn("linkOpen")(
  function* (args: readonly string[]) {
    const { gitConfig } = yield* Config;

    if (!gitConfig.links)
      return yield* new LinkBrowserError({
        message: gitConfig.valid
          ? "Set links.personal in dot-git.yml to route links"
          : `dot-git.yml is invalid: ${gitConfig.diagnostics.join("; ")}`,
      });

    const [link] = args;

    const url =
      args.length === 1 && link && /^https?:\/\//i.test(link)
        ? URL.parse(link)
        : null;

    const browser =
      (url && (yield* resolveLinkBrowser(gitConfig, url))) ??
      gitConfig.links.personal;

    yield* launchBrowser(gitConfig, browser, args);
  },
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
