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
import { currentOmarchyHost } from "./omarchyHost.js";
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
 * The first site rule that matches a link and applies on this host, going by
 * `OMARCHY_HOST`. Rules limited to hosts never apply when it is unset.
 */
export function linkSiteRule(
  gitConfig: DotGitConfig,
  url: URL,
): LinkSiteRule | undefined {
  const host = currentOmarchyHost();

  return gitConfig.links?.sites?.find(
    (rule) =>
      (!rule.hosts || (host !== null && rule.hosts.includes(host))) &&
      siteMatches(rule, url),
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
    linkSiteRule(gitConfig, url)?.browser ??
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

/** Hyprland windows, as `hyprctl clients -j` lists them. */
const HyprlandClients = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      address: Schema.String,
      class: Schema.String,
      workspace: Schema.Struct({ id: Schema.Finite }),
      focusHistoryID: Schema.Finite,
    }),
  ),
);

/** The focused Hyprland window, as `hyprctl activewindow -j` reports it. */
const HyprlandActiveWindow = Schema.fromJsonString(
  Schema.Struct({
    address: Schema.optional(Schema.String),
    class: Schema.optional(Schema.String),
  }),
);

/** The cursor position, as `hyprctl cursorpos -j` reports it. */
const HyprlandCursor = Schema.fromJsonString(
  Schema.Struct({ x: Schema.Finite, y: Schema.Finite }),
);

/** Where and how {@link launchBrowser} opens a link. */
export interface LaunchBrowserOptions {
  /** Hyprland workspace to open the link on. */
  readonly workspace?: number;
  /** Hand focus and the cursor back once the link has opened on the workspace. */
  readonly background?: boolean;
}

/**
 * Start a named browser with extra arguments, detached so the caller returns
 * straight away. With a workspace, the link opens there: in the browser's
 * window on it that was focused last, or else in a new window moved to it.
 * Placement needs the browser's `links.window_classes` pattern and Hyprland;
 * without either, the browser opens the link wherever it would anyway. In the
 * background, a placed link leaves focus and the cursor where they were.
 */
export const launchBrowser = Effect.fn("launchBrowser")(function* (
  gitConfig: DotGitConfig,
  browser: string,
  args: readonly string[],
  { workspace, background = false }: LaunchBrowserOptions = {},
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

  const windowClasses = gitConfig.links?.window_classes ?? {};
  const executor = yield* CommandExecutor;

  const placement =
    workspace !== undefined && Object.hasOwn(windowClasses, browser)
      ? yield* executor.run("hyprctl", ["clients", "-j"]).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(HyprlandClients)),
          Effect.map((clients) => {
            const windowClass = new RegExp(windowClasses[browser]);

            const windows = clients
              .filter((client) => windowClass.test(client.class))
              .sort((a, b) => a.focusHistoryID - b.focusHistoryID);

            return {
              workspace,
              windowClass,
              known: new Set(clients.map((client) => client.address)),
              focused: clients.find((client) => client.focusHistoryID === 0)
                ?.address,
              window: windows.find(
                (client) => client.workspace.id === workspace,
              )?.address,
              last: windows[0]?.address,
            };
          }),
          Effect.orElseSucceed(() => undefined),
        )
      : undefined;

  const cursor =
    background && placement
      ? yield* executor
          .run("hyprctl", ["cursorpos", "-j"])
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(HyprlandCursor)),
            Effect.option,
          )
      : Option.none();

  // A browser puts a link in its window that was focused last, so focus the
  // one on the workspace first. In the background that is only needed when
  // another of its windows was used since. With none there, ask for a new
  // window.
  if (placement?.window && (!background || placement.window !== placement.last))
    yield* executor
      .run("hyprctl", [
        "dispatch",
        `hl.dsp.focus({ window = "address:${placement.window}" })`,
      ])
      .pipe(Effect.ignore);

  const newWindow = placement !== undefined && !placement.window;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const activation =
    background && !placement
      ? undefined
      : yield* watchActivationRequest(
          placement?.windowClass,
          background ? placement?.window : undefined,
        );

  yield* spawner
    .spawn(
      ChildProcess.make(
        executable,
        [...browserArgs, ...(newWindow ? ["--new-window"] : []), ...args],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          detached: true,
        },
      ),
    )
    .pipe(
      Effect.flatMap((child) => child.unref),
      Effect.asVoid,
      Effect.scoped,
    );

  if (!activation) return;

  // A browser that isn't running yet takes longer to open its first window.
  const address = yield* Deferred.await(activation).pipe(
    Effect.timeoutOption(newWindow ? "10 seconds" : "3 seconds"),
  );

  const window =
    Option.isSome(address) && address.value ? `0x${address.value}` : undefined;

  // The browser, or a launcher script in front of it, may have taken focus.
  // Hand it back unless you have moved on to another window since.
  const active =
    background && placement?.focused
      ? yield* executor.run("hyprctl", ["activewindow", "-j"]).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(HyprlandActiveWindow)),
          Effect.orElseSucceed(() => undefined),
        )
      : undefined;

  // A new window asks for focus before Hyprland reports it open, so tell new
  // windows apart by the ones that were there before the launch.
  if (window && placement && !placement.known.has(window))
    yield* executor
      .run("hyprctl", [
        "dispatch",
        `hl.dsp.window.move({ workspace = "${placement.workspace}", window = "address:${window}", follow = ${!background} })`,
      ])
      .pipe(Effect.ignore);
  else if (window && !background)
    yield* executor
      .run("hyprctl", [
        "dispatch",
        `hl.dsp.focus({ window = "address:${window}" })`,
      ])
      .pipe(Effect.ignore);

  if (
    !placement?.focused ||
    !active?.address ||
    active.address === placement.focused ||
    !placement.windowClass.test(active.class ?? "")
  )
    return;

  yield* executor
    .run("hyprctl", [
      "dispatch",
      `hl.dsp.focus({ window = "address:${placement.focused}" })`,
    ])
    .pipe(Effect.ignore);

  if (Option.isSome(cursor))
    yield* executor
      .run("hyprctl", [
        "dispatch",
        `hl.dsp.cursor.move({ x = ${cursor.value.x}, y = ${cursor.value.y} })`,
      ])
      .pipe(Effect.ignore);
}, Effect.scoped);

/**
 * Hyprland declines activation requests (`misc.focus_on_activate = false`) so
 * agents driving the browser can't steal focus. A link opened in a running
 * browser makes the same request, so listen for the `urgent` event it raises
 * and resolve with that window's address, without its `0x` prefix. A new
 * window takes focus on its own and resolves with no address, unless a window
 * class is given: then a new window of that class resolves with its address,
 * so it can be moved. A focused window makes no request, so a title change in
 * `titleWindow` also resolves, with no address, as its new tab opens. Returns
 * undefined outside Hyprland.
 */
const watchActivationRequest = Effect.fn("watchActivationRequest")(function* (
  windowClass?: RegExp,
  titleWindow?: string,
) {
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
      else if (
        event === "windowtitlev2" &&
        titleWindow &&
        data.startsWith(`${titleWindow.replace(/^0x/, "")},`)
      )
        Deferred.doneUnsafe(activation, Exit.succeed(undefined));
      else if (event === "openwindow") {
        // ADDRESS,WORKSPACENAME,CLASS,TITLE
        const [address = "", , className = ""] = data.split(",");

        if (!windowClass)
          Deferred.doneUnsafe(activation, Exit.succeed(undefined));
        else if (windowClass.test(className))
          Deferred.doneUnsafe(activation, Exit.succeed(address));
      }
    }
  });

  yield* Effect.callback<void>((resume) => {
    socket.once("connect", () => resume(Effect.void));
    socket.once("error", () => resume(Effect.void));
  });

  return activation;
});
