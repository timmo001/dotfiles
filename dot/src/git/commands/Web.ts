import { Gh } from "@timmo001/effect-gh";
import { Effect, Schema } from "effect";
import { dirname, resolve } from "node:path";
import { ghOutput } from "../../lib/gh.js";
import { expandHomePath } from "../../lib/paths.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import {
  managedGitRepoForGitHub,
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
    (yield* ghOutput(
      yield* Gh,
      ["repo", "view", "--json", "url", "--jq", ".url"],
      { cwd },
    )).trim();

  const parsed = yield* Effect.try({
    try: () => new URL(url),
    catch: () => new GitWebError({ message: "Invalid web URL" }),
  });

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return yield* new GitWebError({
      message: "Web actions require an HTTP or HTTPS URL",
    });

  if (!repo && parsed.hostname === "github.com")
    repo = managedGitRepoForGitHub(
      config.gitConfig,
      parsed.pathname.split("/").slice(1, 3).join("/"),
    );

  const browser = options.browser ?? repo?.browser;

  const command =
    browser && Object.hasOwn(config.gitConfig.browsers, browser)
      ? config.gitConfig.browsers[browser]
      : undefined;

  if (browser && !command)
    return yield* new GitWebError({ message: `Unknown browser: ${browser}` });
  const [executable, ...args] = command ?? ["xdg-open"];
  yield* executor.run(executable, [...args, url]);
}, handleCommandError("git-web"));
