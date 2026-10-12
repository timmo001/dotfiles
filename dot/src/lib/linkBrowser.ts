import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  managedGitRepoForGitHub,
  type DotGitConfig,
  type LinkSiteRule,
} from "../services/GitConfig.js";
import { isWorkTime } from "./workTime.js";

/** A link browser could not be resolved or started. */
export class LinkBrowserError extends Schema.TaggedError<LinkBrowserError>()(
  "LinkBrowserError",
  { message: Schema.String },
) {}

function siteMatches(rule: LinkSiteRule, url: URL): boolean {
  const [host = "", ...path] = rule.match.toLowerCase().split("/");
  const prefix = path.length > 0 ? `/${path.join("/")}`.replace(/\/$/, "") : "";
  const target = host.includes(":") ? url.host : url.hostname;
  const pathname = url.pathname.toLowerCase();

  return (
    (host.startsWith("*.")
      ? target.endsWith(host.slice(1))
      : target === host) &&
    (prefix === "" || pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

/**
 * Choose the browser name for a link. Site rules come first, then the browser
 * of the tracked repository the link belongs to, then the work time rule.
 * Returns undefined when nothing applies and links are not routed by dot.
 */
export const resolveLinkBrowser = Effect.fn("resolveLinkBrowser")(function* (
  gitConfig: DotGitConfig,
  url: URL,
  repoBrowser?: string,
) {
  const { links } = gitConfig;
  const site = links?.sites?.find((rule) => siteMatches(rule, url));

  if (site) return site.browser;

  const browser =
    repoBrowser ??
    (url.hostname === "github.com"
      ? managedGitRepoForGitHub(
          gitConfig,
          url.pathname.split("/").slice(1, 3).join("/"),
        )?.browser
      : undefined);

  if (browser) return browser;

  if (!links) return undefined;

  return links.work && (yield* isWorkTime(() => Effect.void))
    ? links.work
    : links.personal;
});

/** Start a named browser with extra arguments, detached so the caller returns straight away. */
export const launchBrowser = Effect.fn("launchBrowser")(function* (
  gitConfig: DotGitConfig,
  browser: string,
  args: readonly string[],
) {
  const [executable, ...browserArgs] = Object.hasOwn(
    gitConfig.browsers,
    browser,
  )
    ? gitConfig.browsers[browser]
    : [];

  if (!executable)
    return yield* new LinkBrowserError({
      message: `Unknown browser: ${browser}`,
    });

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  yield* spawner
    .spawn(
      ChildProcess.make(executable, [...browserArgs, ...args], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
      }),
    )
    .pipe(
      Effect.flatMap((child) => child.unref),
      Effect.asVoid,
      Effect.scoped,
    );
});
