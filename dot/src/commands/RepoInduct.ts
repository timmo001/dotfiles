import { Effect, FileSystem, Schema } from "effect";
import { Prompt } from "effect/cli";
import { basename, join, resolve } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import {
  normalizeGitHubSlug,
  parseDotGitConfigText,
  type AgentLintSettings,
  type GitManagedRepo,
} from "../services/GitConfig.js";
import { ReleaseSettings } from "../git/release/types.js";
import {
  appendGitRepository,
  commitGitRepoConfigEdit,
  GitRepoConfigError,
  prepareGitRepoConfigEdit,
  previewGitRepoConfigEdit,
} from "../lib/gitRepoConfig.js";
import { displayPath, expandHomePath } from "../lib/paths.js";
import { writeRepoPicker } from "../lib/repoShortcuts.js";
import { formatCause } from "../lib/schema.js";

const ScheduledCheck = Schema.Struct({
  enabled: Schema.Boolean,
  schedule: Schema.String,
});

const Preset = Schema.Struct({
  name_prefix: Schema.optionalKey(Schema.String),
  post_update: Schema.NullOr(Schema.String),
  agent_oxlint: Schema.Boolean,
  agent_lint: Schema.optionalKey(Schema.NullOr(Schema.String)),
  browser: Schema.optionalKey(Schema.NullOr(Schema.String)),
  opencode_mcp: Schema.optionalKey(Schema.Array(Schema.String)),
  pull_requests: Schema.optionalKey(Schema.Boolean),
  issues: Schema.optionalKey(Schema.Boolean),
  release_template: Schema.optionalKey(Schema.NullOr(Schema.String)),
  activity: ScheduledCheck,
  notifications: Schema.Struct({
    enabled: Schema.Boolean,
    schedule: Schema.String,
    bar: Schema.Struct({ ignore_bot_activity: Schema.Boolean }),
  }),
});

const ReleaseTemplate = Schema.Struct({
  ...ReleaseSettings.fields,
  branch: Schema.optionalKey(Schema.String),
});

const Presets = Schema.Struct({
  normal: Preset,
  "home-assistant": Preset,
  release_templates: Schema.optionalKey(
    Schema.Record(Schema.String, ReleaseTemplate),
  ),
});

/** Terminal questionnaire defaults and non-interactive repository overrides. */
export interface RepoInductOptions {
  /** Repository directory; defaults to the current directory. */
  readonly path?: string;
  /** Private preset; Normal is first and the default. */
  readonly preset?: "normal" | "home-assistant";
  /** Friendly repository label. */
  readonly name?: string;
  /** GitHub owner/repository; otherwise inferred from origin. */
  readonly github?: string;
  /** Space- or comma-separated aliases; an empty string means none. */
  readonly aliases?: string;
  /** Post-update command; an empty string means none. */
  readonly postUpdate?: string;
  /** Enable the advisory agent Oxlint pass. */
  readonly agentOxlint?: boolean;
  /** Enable activity checks. */
  readonly activityEnabled?: boolean;
  /** Activity cron or shared work schedule. */
  readonly activitySchedule?: string;
  /** Enable notification checks. */
  readonly notificationsEnabled?: boolean;
  /** Notification cron or shared work schedule. */
  readonly notificationsSchedule?: string;
  /** Filter bot-only notification activity. */
  readonly ignoreBotActivity?: boolean;
  /** Show open pull requests in the Git panel. */
  readonly pullRequests?: boolean;
  /** Show open issues in the Git panel; defaults to the preset for your own repositories with GitHub issues enabled. */
  readonly issues?: boolean;
  /** Named browser for web actions; an empty string means the desktop default. */
  readonly browser?: string;
  /** Herdr workspace this repository opens after; an empty string means none. */
  readonly herdrAfter?: string;
  /** Git remote used by notes; an empty string means none. */
  readonly notesRemote?: string;
  /** Agent lint command split on whitespace; an empty string means none. */
  readonly agentLint?: string;
  /** Space- or comma-separated OpenCode MCP servers; an empty string means none. */
  readonly opencodeMcp?: string;
  /** Private release template name, or `none`. */
  readonly releaseTemplate?: string;
  /** Branch compared with the published release; defaults to the template's, then origin's default branch. */
  readonly releaseBranch?: string;
  /** Use defaults and flags without terminal prompts; preview unless commit is set. */
  readonly noninteractive?: boolean;
  /** Commit the previewed entry in non-interactive mode. */
  readonly commit?: boolean;
}

/** Whether the current process can display the induction questionnaire. */
export function canPromptForInduction(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

const repositoryRoot = Effect.fn("repoInduct.root")(function* (path: string) {
  const executor = yield* CommandExecutor;

  return (yield* executor
    .run("git", ["rev-parse", "--show-toplevel"], {
      cwd: resolve(expandHomePath(path)),
    })
    .pipe(
      Effect.mapError(
        (error) =>
          new GitRepoConfigError({
            message: `Not a local Git repository: ${error.stderr}`,
          }),
      ),
    )).trim();
});

function askText(message: string, value: string, required = true) {
  return Prompt.run(
    Prompt.String({
      message,
      default: value,
      validate: (input) =>
        required && !input.trim()
          ? Effect.fail("Enter a value")
          : Effect.succeed(input.trim()),
    }),
  );
}

function askBoolean(message: string, initial: boolean) {
  return Prompt.run(Prompt.Confirm({ message, initial }));
}

const splitList = (value: string) => value.split(/[\s,]+/).filter(Boolean);

/** Collect, preview and optionally commit a new entry; return null on preview or cancellation. */
export const inductRepository = Effect.fn("repoInduct.run")(
  function* (options: RepoInductOptions) {
    if (!options.noninteractive && !canPromptForInduction()) {
      return yield* new GitRepoConfigError({
        message:
          "Run dot repo induct in a terminal, or use --noninteractive to preview with flags and --commit after approval",
      });
    }

    if (options.commit && !options.noninteractive) {
      return yield* new GitRepoConfigError({
        message:
          "--commit requires --noninteractive; the terminal wizard asks before committing",
      });
    }

    const edit = yield* prepareGitRepoConfigEdit();
    const executor = yield* CommandExecutor;
    const fs = yield* FileSystem.FileSystem;
    const log = yield* OutputLog;

    const rawPresets = yield* fs
      .readFileString(join(edit.privateRoot, "dot-git-presets.yml"))
      .pipe(
        Effect.flatMap((source) => Effect.try(() => Bun.YAML.parse(source))),
        Effect.mapError(
          (error) =>
            new GitRepoConfigError({
              message: `Could not read private dot-git-presets.yml: ${formatCause(error)}`,
            }),
        ),
      );

    const presets = yield* Schema.decodeUnknownEffect(Presets)(rawPresets).pipe(
      Effect.mapError(
        (error) =>
          new GitRepoConfigError({
            message: `Invalid induction presets: ${formatCause(error)}`,
          }),
      ),
    );

    const presetName = options.noninteractive
      ? (options.preset ?? "normal")
      : yield* Prompt.run(
          Prompt.Select({
            message: "Repository preset",
            choices: [
              {
                title: "Normal",
                value: "normal",
                selected: options.preset !== "home-assistant",
              },
              {
                title: "Home Assistant",
                value: "home-assistant",
                selected: options.preset === "home-assistant",
              },
            ],
          }),
        );

    const preset = presets[presetName];
    let root = yield* repositoryRoot(options.path ?? process.cwd());

    if (!options.noninteractive) {
      root = yield* repositoryRoot(
        yield* askText("Repository path", displayPath(root)),
      );
    }

    if (edit.config.repositories.some((repo) => repo.path === root)) {
      return yield* new GitRepoConfigError({
        message:
          "Repository is already inducted; use dot agent-oxlint --opt-in to enable its agent pass",
      });
    }

    const gitLine = (args: readonly string[]) =>
      executor.run("git", args, { cwd: root }).pipe(
        Effect.map((output) => output.trim()),
        Effect.orElseSucceed(() => ""),
      );

    const remote =
      options.github ?? (yield* gitLine(["remote", "get-url", "origin"]));

    const defaultBranch = (yield* gitLine([
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ])).replace(/^origin\//, "");

    const templates = presets.release_templates ?? {};
    const templateNames = Object.keys(templates);

    let releaseTemplate =
      options.releaseTemplate === undefined
        ? (preset.release_template ?? null)
        : options.releaseTemplate === "none"
          ? null
          : options.releaseTemplate.trim() || null;

    if (releaseTemplate !== null && !Object.hasOwn(templates, releaseTemplate))
      return yield* new GitRepoConfigError({
        message: `Unknown release template: ${releaseTemplate}. Choose ${["none", ...templateNames].join(", ")}`,
      });

    let releaseBranch = options.releaseBranch ?? "";

    const templateBranch = (name: string) =>
      releaseBranch || templates[name]?.branch || defaultBranch || "main";

    const releasesFor = (name: string | null): ReleaseSettings | undefined => {
      if (name === null) return undefined;

      const {
        branch: _branch,
        enabled,
        schedule,
        ...template
      } = templates[name];

      return { enabled, schedule, branch: templateBranch(name), ...template };
    };

    const agentLintFor = (command: string): AgentLintSettings | undefined => {
      const [first, ...rest] = command.trim().split(/\s+/).filter(Boolean);

      return first
        ? { commands: [{ name: "Check", run: [first, ...rest] }] }
        : undefined;
    };

    const optionalText = (value: string | undefined | null) =>
      value?.trim() ? value.trim() : undefined;

    const previousInPreset = preset.name_prefix
      ? edit.config.repositories.findLast((repo) =>
          repo.name.startsWith(preset.name_prefix ?? ""),
        )?.name
      : undefined;

    const upstream = yield* gitLine(["remote", "get-url", "upstream"]);

    const github = normalizeGitHubSlug(remote.trim()) ?? "";

    // Default issue tracking on only for your own repositories with GitHub issues enabled.
    const issuesDefault =
      (preset.issues ?? false) &&
      github !== "" &&
      (yield* Effect.all([
        executor.run("gh", [
          "api",
          `repos/${github}`,
          "--jq",
          '"\\(.has_issues) \\(.owner.login)"',
        ]),
        executor.run("gh", ["api", "user", "--jq", ".login"]),
      ]).pipe(
        Effect.map(
          ([repo, login]) =>
            repo.trim().toLowerCase() === `true ${login.trim().toLowerCase()}`,
        ),
        Effect.orElseSucceed(() => false),
      ));

    let answers: GitManagedRepo = {
      name: options.name ?? `${preset.name_prefix ?? ""}${basename(root)}`,
      path: root,
      github,
      aliases: splitList(options.aliases ?? ""),
      herdrAfter: optionalText(options.herdrAfter ?? previousInPreset),
      browser: optionalText(
        options.browser === undefined ? preset.browser : options.browser,
      ),
      notesRemote: optionalText(
        options.notesRemote ?? (upstream ? "upstream" : undefined),
      ),
      postUpdate:
        options.postUpdate === undefined
          ? preset.post_update
          : options.postUpdate.trim() || null,
      agentOxlint: options.agentOxlint ?? preset.agent_oxlint,
      agentLint: agentLintFor(options.agentLint ?? preset.agent_lint ?? ""),
      opencodeMcp:
        options.opencodeMcp === undefined
          ? (preset.opencode_mcp ?? [])
          : splitList(options.opencodeMcp),
      pullRequests:
        (options.pullRequests ?? preset.pull_requests ?? false)
          ? { enabled: true }
          : undefined,
      issues: (options.issues ?? issuesDefault) ? { enabled: true } : undefined,
      activity: {
        enabled: options.activityEnabled ?? preset.activity.enabled,
        schedule: options.activitySchedule ?? preset.activity.schedule,
      },
      notifications: {
        enabled: options.notificationsEnabled ?? preset.notifications.enabled,
        schedule:
          options.notificationsSchedule ?? preset.notifications.schedule,
        bar: {
          ignoreBotActivity:
            options.ignoreBotActivity ??
            preset.notifications.bar.ignore_bot_activity,
        },
      },
      releases: releasesFor(releaseTemplate),
    };

    const browserNames = Object.keys(edit.config.browsers);

    while (true) {
      if (!options.noninteractive) {
        const name = yield* askText("Friendly name", answers.name);

        const github = yield* askText(
          "GitHub owner/repository",
          answers.github,
        );

        const aliases = splitList(
          yield* askText(
            "Aliases (spaces or commas, blank for none)",
            answers.aliases.join(" "),
            false,
          ),
        );

        const browser = browserNames.length
          ? yield* Prompt.run(
              Prompt.Select({
                message: "Browser for web actions",
                choices: [
                  {
                    title: "Desktop default",
                    value: "",
                    selected: !answers.browser,
                  },
                  ...browserNames.map((value) => ({
                    title: value,
                    value,
                    selected: answers.browser === value,
                  })),
                ],
              }),
            )
          : "";

        const herdrAfter = yield* askText(
          "Open Herdr workspace after (blank for none)",
          answers.herdrAfter ?? "",
          false,
        );

        const notesRemote = yield* askText(
          "Notes remote (blank for none)",
          answers.notesRemote ?? "",
          false,
        );

        const postUpdate = yield* askText(
          "Post-update command (blank for none)",
          answers.postUpdate ?? "",
          false,
        );

        const agentOxlint = yield* askBoolean(
          "Enable agent Oxlint?",
          answers.agentOxlint,
        );

        const agentLint = yield* askText(
          "Agent lint command, such as mise run check (blank for none)",
          answers.agentLint?.commands[0].run.join(" ") ?? "",
          false,
        );

        const opencodeMcp = splitList(
          yield* askText(
            "OpenCode MCP servers (spaces or commas, blank for none)",
            (answers.opencodeMcp ?? []).join(" "),
            false,
          ),
        );

        const pullRequests = yield* askBoolean(
          "Show open pull requests in the Git panel?",
          answers.pullRequests?.enabled ?? false,
        );

        const issues = yield* askBoolean(
          "Show open issues in the Git panel?",
          answers.issues?.enabled ?? false,
        );

        const activity = {
          enabled: yield* askBoolean(
            "Enable activity checks?",
            answers.activity.enabled,
          ),
          schedule: yield* askText(
            "Activity schedule (five-field cron or work)",
            answers.activity.schedule,
          ),
        };

        const notifications = {
          enabled: yield* askBoolean(
            "Enable notifications?",
            answers.notifications.enabled,
          ),
          schedule: yield* askText(
            "Notification schedule (five-field cron or work)",
            answers.notifications.schedule,
          ),
          bar: {
            ignoreBotActivity: yield* askBoolean(
              "Ignore bot-only activity?",
              answers.notifications.bar.ignoreBotActivity,
            ),
          },
        };

        if (templateNames.length) {
          releaseTemplate = yield* Prompt.run(
            Prompt.Select<string | null>({
              message: "Release watching template",
              choices: [
                {
                  title: "None",
                  value: null,
                  selected: releaseTemplate === null,
                },
                ...templateNames.map((value) => ({
                  title: value,
                  value,
                  selected: releaseTemplate === value,
                })),
              ],
            }),
          );
        }

        if (releaseTemplate !== null)
          releaseBranch = yield* askText(
            "Release branch",
            templateBranch(releaseTemplate),
          );

        answers = {
          name,
          path: root,
          github,
          aliases,
          herdrAfter: optionalText(herdrAfter),
          browser: optionalText(browser),
          notesRemote: optionalText(notesRemote),
          postUpdate: postUpdate || null,
          agentOxlint,
          agentLint: agentLintFor(agentLint),
          opencodeMcp,
          pullRequests: pullRequests ? { enabled: true } : undefined,
          issues: issues ? { enabled: true } : undefined,
          activity,
          notifications,
          releases: releasesFor(releaseTemplate),
        };
      }

      const updated = yield* Effect.try({
        try: () => appendGitRepository(edit.source, answers),
        catch: (error) =>
          new GitRepoConfigError({ message: formatCause(error) }),
      });

      const parsed = parseDotGitConfigText(updated, edit.file);

      if (!parsed.valid) {
        if (options.noninteractive)
          return yield* new GitRepoConfigError({
            message: parsed.diagnostics.join("\n"),
          });
        yield* log.warn(parsed.diagnostics.join("\n"));

        if (yield* askBoolean("Correct these answers?", true)) continue;

        return null;
      }

      yield* previewGitRepoConfigEdit(edit, updated);

      if (options.noninteractive && !options.commit) {
        yield* log.info(
          "Preview only. After approval, repeat these options with --commit to save this entry.",
        );

        return null;
      }

      if (!options.noninteractive) {
        const action = yield* Prompt.run(
          Prompt.Select({
            message: "Save this repository entry?",
            choices: [
              { title: "Cancel", value: "cancel" },
              { title: "Edit answers", value: "edit" },
              { title: "Commit", value: "commit" },
            ],
          }),
        );

        if (action === "cancel") return null;

        if (action === "edit") continue;
      }

      yield* commitGitRepoConfigEdit(
        edit,
        updated,
        "Induct repository into dot git config",
      );
      const config = yield* Config;
      yield* Effect.try({
        try: () =>
          writeRepoPicker(config.cacheDir, [
            ...parsed.repositories,
            ...parsed.shortcuts,
          ]),
        catch: (error) =>
          new GitRepoConfigError({
            message: `Repository committed, but the Herdr picker could not be refreshed: ${formatCause(error)}. Run dot stow to retry.`,
          }),
      });
      yield* log.info("Refreshed Herdr repository picker");

      return parsed.repositories.find((repo) => repo.path === root) ?? null;
    }
  },
  Effect.catchTag("QuitError", () => Effect.succeed(null)),
);

/** CLI entry point for the repository induction wizard and flag-based preview/commit flow. */
export const repoInduct = Effect.fn("repoInduct.command")(function* (
  options: RepoInductOptions,
) {
  yield* inductRepository(options);
});
