import { Repository } from "@timmo001/effect-gh";
import { Effect, Schema } from "effect";
import { dirname, resolve } from "node:path";
import { launchBrowser, resolveLinkBrowser } from "../../lib/linkBrowser.js";
import { expandHomePath } from "../../lib/paths.js";
import { isWorkTime } from "../../lib/workTime.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import {
  managedGitRepoForPath,
  type GitManagedRepo,
} from "../../services/GitConfig.js";
import { handleCommandError } from "./rows.js";

/** A web action could not resolve its URL or configured browser. */
class GitWebError extends Schema.TaggedError<GitWebError>()("GitWebError", {
  message: Schema.String,
}) {}

/** Open a repository or URL with its configured browser, optionally overridden. */
export const gitWeb = Effect.fn("gitWeb")(function* (options: {
  readonly path?: string;
  readonly url?: string;
  readonly browser?: string;
  readonly workTime?: boolean;
  readonly actions?: boolean;
}) {
  const config = yield* Config;
  const executor = yield* CommandExecutor;

  if (!config.gitConfig.valid && config.gitConfig.present)
    return yield* new GitWebError({
      message: config.gitConfig.diagnostics.join("; "),
    });

  let repo: GitManagedRepo | undefined;

  const cwd = options.path
    ? resolve(expandHomePath(options.path))
    : process.cwd();

  if (options.path || !options.url) {
    const roots = yield* executor.run(
      "git",
      [
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-common-dir",
      ],
      { cwd },
    );

    const [root, common] = roots.trim().split("\n");
    repo =
      managedGitRepoForPath(config.gitConfig, root) ??
      (common
        ? managedGitRepoForPath(config.gitConfig, dirname(common))
        : undefined);
  }

  const url =
    options.url ??
    (repo
      ? `https://github.com/${repo.github}`
      : (yield* Repository.view(undefined, { cwd })).url);

  const parsed = yield* Effect.try({
    try: () => new URL(url),
    catch: () => new GitWebError({ message: "Invalid web URL" }),
  });

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return yield* new GitWebError({
      message: "Web actions require an HTTP or HTTPS URL",
    });

  if (options.actions)
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/actions`;

  const browser =
    options.browser ??
    (yield* resolveLinkBrowser(config.gitConfig, parsed, repo?.browser)) ??
    (options.workTime && (yield* isWorkTime(() => Effect.void))
      ? "work"
      : undefined);

  const target = options.actions ? parsed.toString() : url;

  if (browser) return yield* launchBrowser(config.gitConfig, browser, [target]);

  yield* executor.run("xdg-open", [target]);
}, handleCommandError("git-web"));
