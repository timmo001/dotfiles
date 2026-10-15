import { Deferred, Effect, Exit, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { createConnection } from "node:net";
import { CommandExecutor } from "../services/CommandExecutor.js";
import {
  managedGitRepoForGitHub,
  type DotGitConfig,
  type LinkSiteRule,
  WORK_TIME_BROWSER,
} from "../services/GitConfig.js";
import { isWorkTime } from "./workTime.js";

/** A link browser could not be resolved or started. */
export class LinkBrowserError extends Schema.TaggedError<LinkBrowserError>()(
  "LinkBrowserError",
  { message: Schema.String },
) {}

/** Whether a `host[/path]` site pattern, as used by link site rules, matches a URL. */
export function siteMatches(
  rule: Pick<LinkSiteRule, "match">,
  url: URL,
): boolean {
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
 * The browser name a link is configured for, before `work-time` is resolved:
 * site rules first, then the browser of the tracked repository it belongs to.
 * Returns undefined when neither applies.
 */
export function linkBrowserName(
  gitConfig: DotGitConfig,
  url: URL,
  repoBrowser?: string,
): string | undefined {
  return (
    gitConfig.links?.sites?.find((rule) => siteMatches(rule, url))?.browser ??
    repoBrowser ??
    (url.hostname === "github.com"
      ? managedGitRepoForGitHub(
          gitConfig,
          url.pathname.split("/").slice(1, 3).join("/"),
        )?.browser
      : undefined)
  );
}

/**
 * Choose the browser name for a link. Site rules come first, then the browser
 * of the tracked repository the link belongs to, then `links.personal`.
 * Returns undefined when nothing applies and links are not routed by dot.
 */
export const resolveLinkBrowser = Effect.fn("resolveLinkBrowser")(function* (
  gitConfig: DotGitConfig,
  url: URL,
  repoBrowser?: string,
) {
  const { links } = gitConfig;
  const browser = linkBrowserName(gitConfig, url, repoBrowser);

  if (browser !== WORK_TIME_BROWSER) return browser ?? links?.personal;

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
  const activation = yield* watchActivationRequest;

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

  if (!activation) return;

  const address = yield* Deferred.await(activation).pipe(
    Effect.timeoutOption("3 seconds"),
  );

  if (Option.isNone(address) || !address.value) return;

  const executor = yield* CommandExecutor;

  yield* executor
    .run("hyprctl", [
      "dispatch",
      `hl.dsp.focus({ window = "address:0x${address.value}" })`,
    ])
    .pipe(Effect.ignore);
}, Effect.scoped);

/**
 * Hyprland declines activation requests (`misc.focus_on_activate = false`) so
 * agents driving the browser can't steal focus. A link opened in a running
 * browser makes the same request, so listen for the `urgent` event it raises
 * and focus that window ourselves. A new window takes focus on its own and
 * resolves with no address. Returns undefined outside Hyprland.
 */
const watchActivationRequest = Effect.gen(function* () {
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  const runtimeDir = process.env.XDG_RUNTIME_DIR;

  if (!signature || !runtimeDir) return undefined;

  const activation = yield* Deferred.make<string | undefined>();

  const socket = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createConnection(`${runtimeDir}/hypr/${signature}/.socket2.sock`),
    ),
    (socket) => Effect.sync(() => socket.destroy()),
  );

  let buffered = "";

  socket.setEncoding("utf8");
  socket.on("error", () =>
    Deferred.doneUnsafe(activation, Exit.succeed(undefined)),
  );
  socket.on("data", (chunk: string) => {
    const lines = (buffered + chunk).split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      const [event, data = ""] = line.split(">>", 2);

      if (event === "urgent")
        Deferred.doneUnsafe(activation, Exit.succeed(data));
      else if (event === "openwindow")
        Deferred.doneUnsafe(activation, Exit.succeed(undefined));
    }
  });

  yield* Effect.callback<void>((resume) => {
    socket.once("connect", () => resume(Effect.void));
    socket.once("error", () => resume(Effect.void));
  });

  return activation;
}).pipe(Effect.withSpan("watchActivationRequest"));
