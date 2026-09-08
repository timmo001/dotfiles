import { Effect, Schema } from "effect";
import { Prompt } from "effect/unstable/cli";
import { readFileSync } from "fs";
import { basename, join, resolve } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import {
  normalizeGitHubSlug,
  parseDotGitConfigText,
  type GitManagedRepo,
} from "../services/GitConfig.js";
import {
  appendGitRepository,
  commitGitRepoConfigEdit,
  GitRepoConfigError,
  prepareGitRepoConfigEdit,
  previewGitRepoConfigEdit,
} from "../lib/gitRepoConfig.js";
import { displayPath, expandHomePath } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";

const ScheduledCheck = Schema.Struct({
  enabled: Schema.Boolean,
  schedule: Schema.String,
});
const Preset = Schema.Struct({
  name_prefix: Schema.optionalKey(Schema.String),
  post_update: Schema.NullOr(Schema.String),
  agent_oxlint: Schema.Boolean,
  activity: ScheduledCheck,
  notifications: Schema.Struct({
    enabled: Schema.Boolean,
    schedule: Schema.String,
    bar: Schema.Struct({ ignore_bot_activity: Schema.Boolean }),
  }),
});
const Presets = Schema.Struct({ normal: Preset, "home-assistant": Preset });

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
  /** Activity cron schedule. */
  readonly activitySchedule?: string;
  /** Enable notification checks. */
  readonly notificationsEnabled?: boolean;
  /** Notification cron schedule. */
  readonly notificationsSchedule?: string;
  /** Filter bot-only notification activity. */
  readonly ignoreBotActivity?: boolean;
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
    Prompt.text({
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
  return Prompt.run(Prompt.confirm({ message, initial }));
}

/** Collect, preview and optionally commit a new entry; return null on preview or cancellation. */
export const inductRepository = Effect.fn("repoInduct.run")(
  function* (options: RepoInductOptions) {
    if (!options.noninteractive && !canPromptForInduction()) {
      return yield* new GitRepoConfigError({
        message:
          "Run dot repo-induct in a terminal, or use --noninteractive to preview with flags and --commit after approval",
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
    const log = yield* OutputLog;
    const presets = yield* Effect.try({
      try: () =>
        Bun.YAML.parse(
          readFileSync(join(edit.privateRoot, "dot-git-presets.yml"), "utf-8"),
        ),
      catch: (error) =>
        new GitRepoConfigError({
          message: `Could not read private dot-git-presets.yml: ${formatCause(error)}`,
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Presets)),
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
          Prompt.select({
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
    const remote =
      options.github === undefined
        ? yield* executor
            .run("git", ["remote", "get-url", "origin"], { cwd: root })
            .pipe(Effect.orElseSucceed(() => ""))
        : options.github;
    let answers: GitManagedRepo = {
      name: options.name ?? `${preset.name_prefix ?? ""}${basename(root)}`,
      path: root,
      github: normalizeGitHubSlug(remote.trim()) ?? "",
      aliases: (options.aliases ?? "").split(/[\s,]+/).filter(Boolean),
      postUpdate:
        options.postUpdate === undefined
          ? preset.post_update
          : options.postUpdate.trim() || null,
      agentOxlint: options.agentOxlint ?? preset.agent_oxlint,
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
    };
    while (true) {
      if (!options.noninteractive) {
        answers = {
          name: yield* askText("Friendly name", answers.name),
          path: root,
          github: yield* askText("GitHub owner/repository", answers.github),
          aliases: (yield* askText(
            "Aliases (spaces or commas, blank for none)",
            answers.aliases.join(" "),
            false,
          ))
            .split(/[\s,]+/)
            .filter(Boolean),
          postUpdate:
            (yield* askText(
              "Post-update command (blank for none)",
              answers.postUpdate ?? "",
              false,
            )) || null,
          agentOxlint: yield* askBoolean(
            "Enable agent Oxlint?",
            answers.agentOxlint,
          ),
          activity: {
            enabled: yield* askBoolean(
              "Enable activity checks?",
              answers.activity.enabled,
            ),
            schedule: yield* askText(
              "Activity schedule (five-field cron)",
              answers.activity.schedule,
            ),
          },
          notifications: {
            enabled: yield* askBoolean(
              "Enable notifications?",
              answers.notifications.enabled,
            ),
            schedule: yield* askText(
              "Notification schedule (five-field cron)",
              answers.notifications.schedule,
            ),
            bar: {
              ignoreBotActivity: yield* askBoolean(
                "Ignore bot-only activity?",
                answers.notifications.bar.ignoreBotActivity,
              ),
            },
          },
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
          Prompt.select({
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
