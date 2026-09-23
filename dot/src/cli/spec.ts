import { Context, Duration, Effect, Option, Schema } from "effect";
import {
  Argument,
  CliError,
  CliOutput,
  Command,
  Flag,
  GlobalFlag,
  type HelpDoc,
  type Param,
} from "effect/unstable/cli";
import { agentsSync } from "../commands/AgentsSync.js";
import { agentOxlint } from "../commands/AgentOxlint.js";
import { repoInduct } from "../commands/RepoInduct.js";
import { clean } from "../commands/Clean.js";
import { completions } from "../commands/Completions.js";
import { doctor } from "../commands/Doctor.js";
import {
  importRenovate,
  previewDependencies,
} from "../commands/Dependencies.js";
import { herdrRepoOpen } from "../commands/HerdrRepoOpen.js";
import { installedHerdrAgents } from "../commands/HerdrAgents.js";
import { herdrContext } from "../commands/HerdrContext.js";
import { herdrServerAction, herdrStart } from "../commands/HerdrServer.js";
import { init } from "../commands/Init.js";
import { install } from "../commands/Install.js";
import { isAgentCommand } from "../commands/IsAgent.js";
import { launchFloatingWebapp } from "../commands/LaunchFloatingWebapp.js";
import { notesCaptureSync } from "../commands/NotesCaptureSync.js";
import {
  omarchyPlugin,
  OmarchyPluginInput,
} from "../commands/OmarchyPlugin.js";
import { updatesRefresh, updatesStatus } from "../commands/Updates.js";
import { privatePkgPublish } from "../commands/PrivatePkgPublish.js";
import { prQueue } from "../commands/PrQueue.js";
import { prWatch } from "../commands/PrWatch.js";
import { setupPrivateRepo } from "../commands/SetupPrivateRepo.js";
import { setupPublicRepo } from "../commands/SetupPublicRepo.js";
import { runSkillsMaintenance } from "../commands/Skills.js";
import { runCommand } from "../commands/Run.js";
import { stow } from "../commands/Stow.js";
import { snapshot } from "../commands/Snapshot.js";
import { systemUpdate } from "../commands/SystemUpdate.js";
import { update, updateCheck, updateRepositories } from "../commands/Update.js";
import { workspaceRelayout } from "../commands/WorkspaceRelayout.js";
import { workspaceSetup } from "../commands/WorkspaceSetup.js";
import { configureFirewallRules } from "../lib/firewallSetup.js";
import { applyOmarchyShellConfig } from "../lib/omarchyShellConfig.js";
import { diffBarJson, diffPanelJson, diffRaw } from "../git/commands/Diff.js";
import { gitCommitRaw } from "../git/commands/Commit.js";
import { gitWeb } from "../git/commands/Web.js";
import {
  releasesAction,
  releasesPublish,
  releasesQuery,
  releasesOpenShell,
} from "../git/commands/Releases.js";
import {
  notificationsBarJson,
  notificationsMarkRead,
  notificationsOpenShell,
} from "../git/commands/Notifications.js";
import { notificationsDismiss } from "../git/commands/NotificationDismiss.js";
import type { GitNotificationQueryOptions } from "../types.js";
import { resolve } from "path";

/** Additional documentation sections attached to executable commands. */
export interface CliDocs {
  /** Substantive command reference prose beyond the terminal summary. */
  readonly description?: string;
  /** Named command modes rendered as preformatted lines. */
  readonly modes?: readonly string[];
  /** Extra named help sections such as exit and safety contracts. */
  readonly sections?: readonly {
    readonly title: string;
    readonly lines: readonly string[];
  }[];
}

/** Command annotation key for generated documentation extensions. */
export class CliDocsAnnotation extends Context.Service<
  CliDocsAnnotation,
  CliDocs
>()("dot/cli/CliDocs") {}

const bool = (name: string, description: string) =>
  Flag.Boolean(name).pipe(
    Flag.withDefault(false),
    Flag.withDescription(description),
  );

const text = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.optional, Flag.withDescription(description));

const optionalBool = (name: string, description: string) =>
  Flag.Boolean(name).pipe(Flag.optional, Flag.withDescription(description));

const pathFlag = (
  name: string,
  description: string,
  pathType: "file" | "directory" | "either",
) =>
  Flag.Path(name, { pathType }).pipe(
    Flag.optional,
    Flag.withDescription(description),
  );

const integer = (name: string, description: string, value: number) =>
  Flag.Int(name).pipe(
    Flag.withDefault(value),
    Flag.withDescription(description),
  );

const optional = <A>(value: Option.Option<A>): A | undefined =>
  Option.getOrUndefined(value);

/** Effect global flags enabled by the `dot` command runner. */
export const cliBuiltIns = [GlobalFlag.Help] as const;

const describe = <C extends Command.Command.Any>(
  command: C,
  description: string,
  examples: readonly string[] = [],
  docs?: CliDocs,
): C => {
  const described = command.pipe(
    Command.withDescription(description),
    Command.withShortDescription(description.split("\n", 1)[0]),
    Command.withExamples(examples.map((example) => ({ command: example }))),
  );

  // SAFETY: Metadata and annotation combinators preserve command input, error, and service types.
  return (
    docs ? described.pipe(Command.annotate(CliDocsAnnotation, docs)) : described
  ) as C;
};

const initCommand = describe(
  Command.make(
    "init",
    {
      noninteractive: bool(
        "noninteractive",
        "Skip the Hypr host questionnaire for this run",
      ),
      interactive: bool(
        "interactive",
        "Enable the Hypr host questionnaire when no host is selected",
      ),
      force: bool("force", "Re-run init even if the machine looks initialised"),
      host: text("host", "Hypr host to link before stow"),
      log: pathFlag(
        "log",
        "Init log path (default: ~/.local/state/dot/init.log)",
        "file",
      ),
    },
    (input) =>
      init({ ...input, host: optional(input.host), log: optional(input.log) }),
  ),
  "Run one-time first-use machine setup",
  [
    "dot init --noninteractive",
    "dot init --host laptop --noninteractive",
    "dot init --force --noninteractive",
  ],
  {
    description:
      "Run the one-time first-use setup workflow for a fresh machine. Init prepares repos, stow links, mise tools, packages, and machine hooks. After init completes, reboot so the Omarchy session picks up host env, then run dot doctor. Before the bounded workflow starts, init updates or clones the optional private overlay according to DOT_ALLOW_PRIVATE. Use dot update for ongoing maintenance.",
  },
);

const installCommand = describe(
  Command.make("install", {}, () => install),
  "Ensure prerequisites, then backup/adopt dotfiles",
);

const updateCommand = describe(
  Command.make(
    "update",
    {
      repo: Flag.String("repo").pipe(
        Flag.atLeast(0),
        Flag.withDescription(
          "Fast-forward this repository when local work can be preserved, then run its post-update command; repeat for a batch. Changed dotfiles also rebuild and stow",
        ),
      ),
      pull: bool("pull", "Run the repository pull phase only"),
      stow: bool(
        "stow",
        "Generate completions, sync MCP configs, and stow only",
      ),
      app: bool(
        "app",
        "Install Bun dependencies and rebuild the dot binary only",
      ),
      check: bool(
        "check",
        "Report dotfiles pulls, pending pins and stow changes, skipping local work",
      ),
      checkAll: bool(
        "check-all",
        "Also check development repos for pulls, skipping local work",
      ),
      noSelfUpdate: bool(
        "no-self-update",
        "Skip the internal self-update phase",
      ),
      noReload: bool("no-reload", "Skip shell reload and UI resume refresh"),
      postHookRepo: Flag.String("post-hook-repo").pipe(
        Flag.atLeast(0),
        Flag.withDescription("Internal post-hook repository"),
      ),
    },
    ({
      app,
      check,
      checkAll,
      noSelfUpdate,
      noReload,
      postHookRepo,
      pull,
      repo,
      stow: onlyStow,
    }) =>
      Effect.gen(function* () {
        if (repo.length > 0) {
          if (
            check ||
            checkAll ||
            pull ||
            onlyStow ||
            app ||
            noSelfUpdate ||
            postHookRepo.length > 0
          )
            return yield* new CliError.InvalidValue({
              option: "repo",
              value: repo.join(", "),
              kind: "flag",
              expected: "--repo without update phase, check or internal flags",
            });

          return yield* updateRepositories(repo, !noReload);
        }

        if (check || checkAll) return yield* updateCheck({ all: checkAll });

        return yield* update({
          pull,
          stow: onlyStow,
          app,
          selfUpdate: !noSelfUpdate,
          reload: !noReload,
          postHookRepos: postHookRepo,
        });
      }),
  ),
  "Self-update, pull repos, stow dotfiles, rebuild. Phase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Internal --no-self-update and --post-hook-repo flags support the active self-update handoff.",
  [],
  {
    description:
      "A full update pulls the public dotfiles, installs Bun dependencies, rebuilds and relaunches dot, then scans and pulls tracked repositories. Pulls are fast-forward-only and never stash or rebase: Git refuses an update if local edits would be overwritten or histories have diverged. It trusts tracked mise configs, regenerates completions, installs missing public Arch/AUR packages, runs the required MCP sync, stows, rebuilds again, runs agents sync, backfills the init marker, and starts the resume refresh. It finishes with a summary of updated repositories and completed actions.\n\nPhase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Scoped runs skip full-update package reconciliation, agents sync, and init-marker backfill.\n\nUse --repo PATH (repeatable) to pull selected repositories, restore their pinned submodules and run configured post-update commands after HEAD changes. Changed public or private dotfiles also rebuild, stow and sync agent instructions once per batch. Herdr plugins are refreshed only inside Herdr. The Git panel uses --no-reload to skip shell reload and UI resume refresh.",
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0   Update completed, or no actionable updates were found",
          "1   Fatal workflow failure",
          "2   Update check could not finish",
          "10  Update check found pulls, pending pins or stow changes",
          "11  Legacy Hypr migration is required",
        ],
      },
    ],
  },
).pipe(Command.withAlias("up"));

const systemUpdateCommand = describe(
  Command.make(
    "system-update",
    { yes: bool("yes", "Select every update without prompting") },
    (input) => systemUpdate(input),
  ),
  "Select and run Dotfiles, Omarchy, and Topgrade updates",
  ["dot system-update", "dot system-update --yes"],
  {
    description:
      "Select maintenance steps interactively, then run them in order: Dotfiles, Omarchy, and Topgrade. Interactive runs pre-select Dotfiles and Omarchy; extra Topgrade steps start unselected. Non-interactive runs and --yes select every step. Cancelling the prompt exits without running updates.",
  },
);

const runDuration = (name: string, description: string) =>
  Flag.String(name).pipe(
    Flag.withSchema(Schema.DurationFromString),
    Flag.map(Duration.toMillis),
    Flag.filter(
      (value) => Number.isFinite(value) && value > 0,
      () => "Duration must be finite and positive",
    ),
    Flag.withDescription(description),
  );

const dependenciesCommand = describe(
  Command.make(
    "deps",
    {
      repository: Argument.String("repository").pipe(Argument.withDefault("")),
      dryRun: bool(
        "dry-run",
        "Discover updates without running scripts, installing packages or publishing",
      ),
      all: bool(
        "all",
        "Bypass open-PR inventory and exclusion only; leave PRs untouched",
      ),
      target: Flag.String("target").pipe(
        Flag.withDefault(""),
        Flag.withDescription(
          "Remote target branch (default: repository default branch)",
        ),
      ),
      timeout: runDuration(
        "timeout",
        "Deadline per command/provider lookup (default: 30 seconds)",
      ).pipe(Flag.withDefault(30000)),
      concurrency: Flag.Int("concurrency").pipe(
        Flag.withDefault(4),
        Flag.filter(
          (value) => value >= 1 && value <= 16,
          () => "Concurrency must be between 1 and 16",
        ),
        Flag.withDescription(
          "Maximum concurrent groups, lookups, PR inspections or check commands, 1-16 (default: 4)",
        ),
      ),
    },
    (input) =>
      previewDependencies({
        ...input,
        directory: process.cwd(),
        ...(input.repository
          ? { repository: input.repository }
          : { repository: undefined }),
        ...(input.target ? { target: input.target } : { target: undefined }),
      }),
  ).pipe(
    Command.withSubcommands([
      describe(
        Command.make(
          "import-renovate",
          {
            directory: Argument.String("directory").pipe(
              Argument.withDefault("."),
            ),
            source: Flag.String("source").pipe(
              Flag.withDefault("renovate.json"),
              Flag.withDescription(
                "Repository-relative Renovate JSON file (default: renovate.json)",
              ),
            ),
            timeout: runDuration(
              "timeout",
              "Deadline per import pass (default: 5 minutes)",
            ).pipe(Flag.withDefault(5 * 60 * 1000)),
          },
          importRenovate,
        ),
        "Import Renovate policy into dot-deps.yml with an editor schema",
        [
          "dot deps import-renovate",
          "dot deps import-renovate /path/to/repository",
        ],
        {
          description:
            "Create dot-deps.yml and its editor schema from a repository's JSON Renovate config, migrating an existing dot-deps.json policy. The first import resolves presets with an isolated, pinned Renovate runtime. Later imports replace explicit override sections, including edits within them, while preserving the native base policy and local check mappings. Unsupported settings are recorded as publication blockers. Importing creates no commits or PRs. Ordinary previews use the saved native policy without running Renovate or refreshing presets.",
        },
      ),
    ]),
  ),
  "Validate and publish grouped native dependency updates",
  [
    "dot deps --dry-run",
    "dot deps owner/repository --dry-run",
    "dot deps --dry-run --all --target main",
  ],
  {
    description:
      "Read native policy and manifests from a pinned remote target, preserving the caller's checkout. Exclude whole groups covered by any open dependency PR, including failed, pending and draft PRs. --all bypasses only PR inventory and exclusion. --dry-run discovers updates without repository scripts, installs, checks or writes to Git. Bare dot deps starts groups by priority and prepares and validates them concurrently in isolated worktrees, bounded by --concurrency. Check commands share the same concurrency cap across groups; setup and shared Git operations are serialised. The first ready group takes the publication slot and publishes one checked commit without creating PRs or waiting for hosted CI. Host permissions are read from $XDG_CONFIG_HOME/dot/dependencies.json (default ~/.config/dot/dependencies.json), keyed by owner/repository with trusted and allowBypass booleans. Required hosted checks must have equivalent validation.checks mappings; protected direct pushes require explicit allowBypass permission and existing account rights. Workflow edits require a credential with workflow write access. Unsupported policy remains blocking. Publication is serialised per repository/target; target movement rebuilds and revalidates, up to three attempts per group. Failed work and per-group logs remain under $XDG_STATE_HOME/dot/dependencies. Clean published worktrees are removed, including submodules. Setup/check mutations and commit-hook mutations prevent publication. Independent groups continue after failures, including groups sharing files; a partial run exits non-zero. A normal invocation authorises passing updates, regardless of Renovate automerge policy.",
  },
);

const runCommandSpec = describe(
  Command.make(
    "run",
    {
      timeout: runDuration(
        "timeout",
        "Execution deadline, for example '5 minutes' or '30 seconds'",
      ),
      killAfter: runDuration(
        "kill-after",
        "Cleanup grace period before SIGKILL (default: 5 seconds)",
      ).pipe(Flag.withDefault(5000)),
      command: Argument.String("command").pipe(
        Argument.withDescription("Executable to run after --"),
      ),
      args: Argument.String("args").pipe(
        Argument.variadic(),
        Argument.withDescription("Arguments passed unchanged to the command"),
      ),
    },
    ({ command, args, ...options }) => runCommand(command, args, options),
  ),
  "Run a command with a deadline and process-group cleanup",
  [
    "dot run --timeout '5 minutes' -- opencode2 run --standalone 'Process this capture'",
  ],
  {
    description:
      "Pass the executable and its arguments after --. Standard input, output and errors are inherited. Completion, timeout and SIGINT/SIGTERM/SIGHUP all release the owned process group, first with SIGTERM and then SIGKILL after the cleanup grace period. Use foreground commands: processes that deliberately leave the group or send work to an existing server are outside this ownership. For isolated OpenCode jobs, pass run --standalone.",
    sections: [
      {
        title: "Exit codes",
        lines: [
          "Child exit code on completion",
          "124  Execution deadline exceeded",
          "125  Process execution failed",
          "128 + signal number on interruption",
        ],
      },
    ],
  },
);

const updateRefreshFlags = {
  packageFile: pathFlag(
    "package-file",
    "Watched package list (default: public dotfiles manifest)",
    "file",
  ),
  cacheDir: pathFlag(
    "cache-dir",
    "Status cache directory (default: XDG status-bar cache)",
    "directory",
  ),
  timeout: integer(
    "timeout",
    "Maximum seconds for each external check",
    120,
  ).pipe(
    Flag.filter(
      (value) => value > 0,
      () => "Timeout must be positive",
    ),
  ),
};

const updatesCommand = describe(
  Command.make("updates").pipe(
    Command.withSubcommands([
      describe(
        Command.make("status", {}, () => updatesStatus()),
        "Print cached status-bar JSON and refresh stale data in the background",
        ["dot updates status"],
      ),
      describe(
        Command.make(
          "refresh",
          {
            ...updateRefreshFlags,
            scheduled: bool("scheduled", "Respect the AUR request backoff"),
            dotOnly: bool(
              "dot-only",
              "Refresh only Dotfiles status, keeping cached package status",
            ),
          },
          (input) =>
            updatesRefresh(
              {
                ...input,
                packageFile: optional(input.packageFile),
                cacheDir: optional(input.cacheDir),
              },
              input.scheduled,
              input.dotOnly,
            ),
        ),
        "Refresh package and Dotfiles status and notify the shell",
        ["dot updates refresh", "dot updates refresh --dot-only"],
      ),
    ]),
  ),
  "Check watched package and Dotfiles updates for the status bar",
  ["dot updates status", "dot updates refresh"],
  {
    description:
      "Read cached status immediately and refresh it in the background after 15 minutes. Refresh checks watched repository/AUR packages and all dot-managed repositories, writes the cache atomically under a shared lock, and notifies the Omarchy shell. Scheduled refreshes respect AUR HTTP-error backoff; manual refreshes retry immediately. Use --package-file, --cache-dir, --timeout, and status --cache-max-age to override defaults.",
  },
);

const stowCommand = describe(
  Command.make(
    "stow",
    {
      publicOnly: bool("public", "Stow public dotfiles only"),
      privateOnly: bool("private", "Stow private dotfiles only"),
    },
    ({ privateOnly, publicOnly }) =>
      stow({ publicOnly, privateOnly }).pipe(Effect.asVoid),
  ),
  "Re-stow public/private dotfiles",
);

const pluginAdd = describe(
  Command.make(
    "add",
    {
      id: Argument.String("id").pipe(Argument.withDescription("Plugin ID")),
      url: Argument.String("url").pipe(
        Argument.withDescription("Plugin Git remote"),
      ),
      checkout: Argument.Path("checkout").pipe(
        Argument.withDescription("Validated live plugin checkout"),
      ),
      section: Flag.Literals("section", ["left", "center", "right"]).pipe(
        Flag.optional,
      ),
      before: text("before", "Place before this plugin"),
      after: text("after", "Place after this plugin"),
    },
    (input) =>
      omarchyPlugin(
        OmarchyPluginInput.add({
          ...input,
          section: optional(input.section),
          before: optional(input.before),
          after: optional(input.after),
        }),
      ),
  ),
  "Import a validated plugin checkout",
);

const pluginUpdate = describe(
  Command.make(
    "update",
    {
      id: Argument.String("id").pipe(
        Argument.withDescription("Managed plugin ID"),
        Argument.optional,
      ),
      confirm: Argument.Literals("confirm", ["0", "1"]).pipe(
        Argument.withDescription("Compatibility confirmation value"),
        Argument.optional,
      ),
      yes: bool("yes", "Update without confirmation"),
    },
    ({ confirm, id, yes }) =>
      omarchyPlugin(
        OmarchyPluginInput.update({
          id: optional(id),
          yes: yes || Option.getOrUndefined(confirm) === "1",
        }),
      ),
  ),
  "Update one or all managed plugins",
);

const pluginRemove = describe(
  Command.make(
    "remove",
    {
      id: Argument.String("id").pipe(
        Argument.withDescription("Managed plugin ID"),
      ),
      confirm: Argument.Literals("confirm", ["0", "1"]).pipe(
        Argument.withDescription("Compatibility confirmation value"),
        Argument.optional,
      ),
      save: Argument.Literals("save", ["0", "1"]).pipe(
        Argument.withDescription("Compatibility commit-offer value"),
        Argument.optional,
      ),
      yes: bool("yes", "Remove without confirmation"),
      noCommitOffer: bool(
        "no-commit-offer",
        "Do not offer the optional git-commit handoff",
      ),
    },
    ({ confirm, id, noCommitOffer, save, yes }) =>
      omarchyPlugin(
        OmarchyPluginInput.remove({
          id,
          yes: yes || Option.getOrUndefined(confirm) === "1",
          offerCommit: !noCommitOffer && Option.getOrUndefined(save) !== "0",
        }),
      ),
  ),
  "Remove a managed plugin",
);

const omarchyPluginCommand = describe(
  Command.make("omarchy-plugin").pipe(
    Command.withSubcommands([pluginAdd, pluginUpdate, pluginRemove]),
  ),
  "Manage Omarchy plugin submodules. The manage-omarchy-plugin compatibility wrapper may pass trailing 0/1 confirmation and commit-offer values to update and remove.",
  [
    "dot omarchy-plugin update timmo.clock --yes",
    "dot omarchy-plugin remove timmo.clock",
  ],
  {
    description:
      "Import, update, or remove Omarchy plugins managed as dotfiles submodules. The Omarchy plugin lifecycle hook calls this command through the manage-omarchy-plugin compatibility wrapper.",
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0   Managed operation completed or was skipped",
          "1   Managed operation failed",
          "20  Plugin is unmanaged; continue with Omarchy's normal operation",
        ],
      },
    ],
  },
);

const gitWebCommand = describe(
  Command.make(
    "git-web",
    {
      path: text(
        "path",
        "Repository directory; defaults to the current directory when no URL is supplied",
      ),
      url: text("url", "Web URL; defaults to the repository's GitHub page"),
      browser: text(
        "browser",
        "Override the repository browser with a name from dot-git.yml",
      ),
    },
    ({ path, url, browser }) =>
      gitWeb({
        path: optional(path),
        url: optional(url),
        browser: optional(browser),
      }),
  ),
  "Open a Git web action using the repository's configured browser",
  [
    "dot git-web",
    "dot git-web --browser work",
    "dot git-web --url https://github.com/example/project/issues/1",
  ],
  {
    description:
      "Resolves repository browser settings from dot-git.yml, including linked worktrees. URL-only actions use the GitHub repository in the URL. Named browsers are argument lists under browsers; each repository can select one with browser. Without a selection, uses the desktop default. --browser overrides the selection. The Git panel uses the work browser override for Alt+Enter and Alt+click on web actions.",
  },
);

const gitDiffCommand = describe(
  Command.make(
    "git-diff",
    {
      barJson: bool(
        "bar-json",
        "JSON output for status bars and shell modules",
      ),
      panelJson: bool(
        "panel-json",
        "Full JSON snapshot for the native shell panel",
      ),
    },
    ({ barJson, panelJson }) => {
      if (barJson) return diffBarJson();

      if (panelJson) return diffPanelJson();

      return diffRaw();
    },
  ),
  "Show repository change state across all tracked repositories.",
  ["dot git-diff", "dot git-diff --bar-json", "dot git-diff --panel-json"],
  {
    modes: [
      "(default)       Text summary of repos with changes",
      "--bar-json      JSON output for status bars",
      "--panel-json    Full JSON panel snapshot",
    ],
  },
).pipe(Command.withAlias("diff"));

const releaseActionFlags = {
  repo: Flag.String("repo").pipe(
    Flag.withDescription("Configured repository name or GitHub slug"),
  ),
  snapshot: Flag.String("snapshot").pipe(
    Flag.withDescription(
      "Exact displayed snapshot ID; stale selections are rejected",
    ),
  ),
  panelJson: bool("panel-json", "Return the updated complete JSON snapshot"),
};

const gitReleasesCommand = describe(
  Command.make(
    "git-releases",
    {
      repo: text("repo", "Select an enabled repository by name or GitHub slug"),
      scheduled: bool(
        "scheduled",
        "Check only in a due cron minute, once per minute",
      ),
      refresh: bool("refresh", "Fetch now, bypassing the schedule and cache"),
      notify: bool(
        "notify",
        "Send eligible desktop notifications with review actions",
      ),
      open: bool("open", "Open the release review in the Omarchy shell"),
      panelJson: bool(
        "panel-json",
        "Complete JSON review snapshots, including quiet changes and errors",
      ),
    },
    ({ repo, scheduled, refresh, notify, open, panelJson }) =>
      Effect.gen(function* () {
        if (open) return yield* releasesOpenShell(optional(repo));

        return yield* releasesQuery(
          { repo: optional(repo), scheduled, refresh, notify },
          panelJson,
        );
      }),
  ).pipe(
    Command.withSubcommands([
      describe(
        Command.make(
          "review",
          {
            ...releaseActionFlags,
            finding: Flag.String("finding").pipe(
              Flag.withDefault("overall"),
              Flag.withDescription(
                "Finding ID, or overall for the current release-relevant comparison",
              ),
            ),
            impact: Flag.Literals("impact", [
              "none",
              "patch",
              "minor",
              "major",
              "auto",
            ]).pipe(
              Flag.withDescription(
                "Local release impact; auto clears the override",
              ),
            ),
          },
          ({ repo, snapshot, finding, impact, panelJson }) =>
            releasesAction(
              { repo, snapshot, target: finding, impact },
              panelJson,
            ),
        ),
        "Review exact local release evidence without publishing anything",
      ),
      describe(
        Command.make(
          "publish",
          {
            ...releaseActionFlags,
            interactive: bool(
              "interactive",
              "Explain, confirm and run the release in this terminal, with an optional log pager",
            ),
            panelJson: bool(
              "panel-json",
              "Stream JSON progress and the final plan or release result",
            ),
            confirm: text(
              "confirm",
              "Execute the exact plan ID returned by the preview",
            ),
          },
          ({ repo, snapshot, confirm, panelJson, interactive }) =>
            releasesPublish(
              { repo, snapshot, confirm: optional(confirm) },
              panelJson,
              interactive,
            ),
        ),
        "Preview version changes, validation, pushes and generated release notes. --interactive explains and confirms in the terminal; --confirm PLAN executes a reviewed plan with live progress.",
        [],
        {
          description:
            "Requires an explicit private releases.publish recipe. The preview is read-only. Confirmation binds the reviewed snapshot, version files, commands and target. Preparation runs in an isolated worktree. Only agreed version changes are committed through dot git-commit, then the version commit and tag are pushed atomically. GitHub release notes are generated from the previous stable release. Progress includes command output and a saved log. Release creation does not wait for GitHub publication jobs; follow the returned Actions URL. Failed preparation is retained for inspection. Refresh and preview again after resolving a failure.",
        },
      ),
    ]),
  ),
  "Compare enabled repositories with their latest published stable release, explain impact and retain local reviews.",
  [
    "dot git-releases",
    "dot git-releases --refresh --panel-json",
    "dot git-releases --scheduled --notify --panel-json",
    "dot git-releases --open --repo example/project",
    "dot git-releases review --repo example/project --snapshot ID --finding FINDING --impact patch",
    "dot git-releases review --repo example/project --snapshot ID --impact auto",
  ],
  {
    description:
      "Read the last local snapshot, collecting one on first use. --refresh fetches immutable release and branch refs immediately; --scheduled follows each repository's local-time cron and records attempted minutes. Draft and prerelease releases are excluded. Failed checks retain previous evidence marked stale. Quiet changes remain inspectable. Desktop notifications require --notify and honour configured minimum impact and cooldown. --open opens the release review, optionally selected by --repo, without fetching.\n\nLocal reviews require the displayed snapshot ID. Finding overrides follow exact evidence; an overall override follows the release-relevant comparison. Changed evidence invalidates its review. Use --impact auto to clear an override. Extra CI-only commits do not repeat delivery. Incomplete or stale evidence cannot be reviewed.",
    sections: [
      {
        title: "Policy",
        lines: [
          "Optional releases config selects oxlint-rules or system-bridge and a watched branch.",
          "Private overrides precede preset rules; the first match wins for each fact.",
          "Match paths with globs, change_types, exact dependencies, roles, submodules or explicit subjects regexes.",
          "Selectors are ANDed; values within each selector are ORed. Explicit path overrides match either rename endpoint.",
          "Preset rename impact is the highest affected old/new boundary; both endpoints must be quiet for a quiet rename.",
          "Subject selectors follow surviving source lines or individual structured values, excluding reverted intent.",
          "Each net fact is classified once; any attributed subject can match the first applicable ordered rule.",
          "Every override supplies impact (none/patch/minor/major) and a readable reason.",
          "Dependency versions never imply consumer minor or major changes.",
          "Notification enabled/minimum_impact/cooldown_minutes are stored for future explicit delivery.",
        ],
      },
    ],
  },
);

const gitCommitCommand = describe(
  Command.make(
    "git-commit",
    {
      message: Flag.String("message").pipe(
        Flag.withAlias("m"),
        Flag.optional,
        Flag.withDescription("Single-line commit subject"),
      ),
      paths: Flag.Path("path").pipe(
        Flag.atLeast(0),
        Flag.withDescription("Commit only this file; repeatable"),
      ),
      amend: bool("amend", "Amend the previous commit"),
      push: bool("push", "Push after committing"),
      dryRun: bool("dry-run", "Preview without changing anything"),
    },
    ({ amend, dryRun, message, paths, push }) =>
      gitCommitRaw({ message: optional(message), paths, amend, push, dryRun }),
  ),
  "Commit staged changes through the guarded gateway. Subjects must be one line, have no trailing full stop, and stay within the hard length limit. Explicit --path scopes never imply git add -A; --amend keeps the existing message unless --message is supplied.",
  [
    'dot git-commit -m "Add commit gateway"',
    'dot git-commit -m "Scope to one file" --path src/git/commands/Status.ts',
    'dot git-commit -m "Commit and push" --push',
    "dot git-commit --amend",
    'dot git-commit --amend -m "Reword the previous commit"',
    'dot git-commit -m "Preview only" --dry-run',
  ],
  {
    description:
      "Create a commit through dot's guarded gateway instead of raw git commit. The subject is validated as a single line with no trailing full stop and a length limit, then the staged set (or an explicit --path scope) is committed. It never runs git add -A.\n\nPass --amend to rewrite the previous commit instead of creating a new one; it keeps the existing message unless you pass --message. With --push, an amend force-pushes with --force-with-lease, never a plain force. Agents are routed here by the git-commit skill and blocked from raw git commit in the OpenCode permission config.",
    modes: [
      "(default)  Commit the staged set",
      "--path     Commit only named files",
      "--amend    Rewrite the previous commit",
      "--dry-run  Preview the plan without changes",
    ],
    sections: [
      {
        title: "Message guards",
        lines: [
          "Single line      Rejects multi-line messages",
          "No em/en-dash    Rejects em/en-dashes; use a hyphen",
          "No full stop     Rejects a trailing full stop",
          "Warn over 60     Warns on stderr, still commits",
          "Reject over 120  Fails; shorten the subject",
        ],
      },
      {
        title: "Base branch guard",
        lines: [
          "Refuses commits to the base branch of a repo you do not own.",
          "Owners you control are listed in git config dot.owner. Work on a feature branch.",
          "For a maintained fork with an owned origin, opt in one exact branch with git config --local dot.maintainedForkBranch <branch>.",
          "The exception requires owned origin fetch and push targets; global settings are ignored.",
        ],
      },
    ],
  },
);

const notificationReviewFlags = {
  repo: text(
    "repo",
    "Configured repository name/path or GitHub owner/repository",
  ),
  dryRun: bool(
    "dry-run",
    "Print repository batches and reasons without changing notifications",
  ),
};

const notificationDismissCommand = describe(
  Command.make("dismiss", notificationReviewFlags, ({ repo, dryRun }) =>
    notificationsDismiss({ scope: "all", repo: optional(repo), dryRun }),
  ).pipe(
    Command.withSubcommands([
      describe(
        Command.make(
          "dependencies",
          {
            ...notificationReviewFlags,
            mode: Flag.Literals("mode", ["all", "repos"]).pipe(
              Flag.withDescription(
                "Mark all verified dependencies done, or prompt per repository; omit to choose",
              ),
              Flag.optional,
            ),
          },
          ({ repo, dryRun, mode }) =>
            notificationsDismiss({
              scope: "dependencies",
              repo: optional(repo),
              dryRun,
              mode: optional(mode),
            }),
        ),
        "Review unread merged Renovate/Dependabot updates regardless of CI results. All-mode excludes unverifiable CI. Opening GitHub returns to the review without dismissing anything.",
      ),
      describe(
        Command.make("remaining", notificationReviewFlags, ({ repo, dryRun }) =>
          notificationsDismiss({
            scope: "remaining",
            repo: optional(repo),
            dryRun,
          }),
        ),
        "Review all other unread notifications per repository, including PRs with unresolved CI and their reasons. This pass always requires a choice before dismissal.",
      ),
    ]),
  ),
  "Show a coloured repository summary, then review merged dependencies followed by remaining unread notifications. Done queues work in the background while progress appears above the next choices. Every repository offers Done, Open on GitHub, Skip and Stop. Stop ends the questions and finishes queued work before a completion and issues summary. --repo selects a single notification stack. Bar hiding preferences do not restrict this inbox.",
  [
    "dot git-notifications dismiss",
    "dot git-notifications dismiss --repo owner/repository",
    "dot git-notifications dismiss --dry-run",
    "dot git-notifications dismiss dependencies --mode all",
    "dot git-notifications dismiss remaining",
  ],
);

const gitNotificationsCommand = describe(
  Command.make(
    "git-notifications",
    {
      barJson: bool(
        "bar-json",
        "JSON output for status bars and shell modules",
      ),
      all: bool("all", "Include read notifications"),
      participating: bool("participating", "Only participating threads"),
      markRead: text("mark-read", "Mark a thread as read"),
    },
    (input) =>
      Effect.gen(function* () {
        const options: GitNotificationQueryOptions | undefined =
          input.all || input.participating
            ? {
                ...(input.all && { all: true }),
                ...(input.participating && { participating: true }),
              }
            : undefined;

        if (Option.isSome(input.markRead))
          return yield* notificationsMarkRead(input.markRead.value);

        if (input.barJson || options)
          return yield* notificationsBarJson(options);

        return yield* notificationsOpenShell;
      }),
  ).pipe(Command.withSubcommands([notificationDismissCommand])),
  "Open the authenticated GitHub notification inbox. Without output, query or action flags, this opens the Omarchy shell panel. --all and --participating return filtered bar JSON.",
  [
    "dot git-notifications",
    "dot git-notifications --bar-json",
    "dot git-notifications --participating",
    "dot git-notifications dismiss --dry-run",
    "dot git-notifications --mark-read 12345",
  ],
  {
    modes: [
      "(default)       Open the shell notification panel",
      "--bar-json      Status-bar JSON",
    ],
  },
);

const simpleCommands = [
  describe(
    Command.make(
      "snapshot",
      {
        sort: Flag.Literals("sort", ["cpu", "mem"]).pipe(
          Flag.withDefault("mem"),
          Flag.withDescription(
            "Sort the process tree and JSON process list by CPU or memory",
          ),
        ),
        limit: integer(
          "limit",
          "Maximum visible tree processes, including parents, and entries per ranking table",
          40,
        ).pipe(
          Flag.filter(
            (value) => Number.isSafeInteger(value) && value > 0,
            () => "Limit must be a positive integer",
          ),
        ),
        minMemoryMib: Flag.Finite("min-memory-mib").pipe(
          Flag.withDefault(80),
          Flag.filter(
            (value) => Number.isFinite(value) && value >= 0,
            () => "Memory cutoff must be finite and non-negative",
          ),
          Flag.withDescription(
            "Minimum measured subtree PSS in MiB for memory sorting (default: 80)",
          ),
        ),
        minCpu: Flag.Finite("min-cpu").pipe(
          Flag.withDefault(1),
          Flag.filter(
            (value) => Number.isFinite(value) && value >= 0,
            () => "CPU cutoff must be finite and non-negative",
          ),
          Flag.withDescription(
            "Minimum measured subtree CPU percentage for CPU sorting (default: 1; 100% = one core)",
          ),
        ),
      },
      snapshot,
    ),
    "Save a CPU and memory snapshot with process rankings",
    [
      "dot snapshot",
      "dot snapshot --sort cpu",
      "dot snapshot --limit 40",
      "dot snapshot --min-memory-mib 50",
    ],
    {
      description:
        "Print a Markdown CPU and memory summary with a usage-filtered process tree. --sort mem defaults to an 80 MiB measured subtree PSS cutoff; --sort cpu defaults to 1% of one core. Adjust these with --min-memory-mib and --min-cpu. Each tree row shows aligned memory and CPU totals beside the process name. Totals include hidden children, so small workers can qualify together; parent and child totals overlap. Expand the largest remaining qualifying branch until --limit visible processes are reached (default: 40, including ancestors). Zero-usage branches are omitted. The saved report adds CPU, memory and process-name rankings with the same cutoffs and per-table limit, plus pressure measurements. Interactive human runs open it in $EDITOR (vi if unset). The internal dot is-agent check automatically selects JSON. JSON retains all sampled processes and the complete processTree, and reportSelection identifies visible PIDs, cutoffs, the limit and omitted count. Missing measurements are null; unavailable parents are marked. CPU is sampled over approximately one second; 100% per process means one logical CPU. PSS divides shared pages between processes. Reports are saved in the system temporary directory ($TMPDIR, normally /tmp), named dot-snapshot-<timestamp>.md or .json. Existing output files are never overwritten.",
    },
  ),
  describe(
    Command.make("omarchy-shell-config", {}, () =>
      applyOmarchyShellConfig.pipe(Effect.asVoid),
    ),
    "Regenerate the Omarchy shell layout",
    ["dot omarchy-shell-config"],
    {
      description:
        "Regenerate ~/.config/omarchy/shell.json from Omarchy's shipped default and the host-specific dotfiles layout without running the full stow flow.",
    },
  ),
  describe(
    Command.make("firewall", {}, () => configureFirewallRules),
    "Reconcile managed ufw firewall rules",
    ["dot firewall"],
    {
      description:
        "Ensure the managed ufw allow rules are present with their exact source, destination, interface/direction, and purpose comment. Missing rules are added, stale-comment rules are deleted and re-added, then ufw is reloaded once. A source-restricted rule does not satisfy a managed any-source rule.",
    },
  ),
  describe(
    Command.make("doctor", {}, () => doctor()),
    "Run parallel health checks for dependencies, repositories, stow integrity, services, packages, browser configuration, hardware video, firewall rules, and OpenCode/Herdr integration. A timestamped report is always written under ~/.local/state/dot/logs/.",
    [],
    {
      description:
        "Run health checks on the dotfiles system. All checks run in parallel and each section streams to the terminal as it finishes, followed by a grouped summary. A timestamped log is always written under ~/.local/state/dot/logs/.",
      sections: [
        {
          title: "Checks performed",
          lines: [
            "Dependencies and configured gh extensions",
            "Repositories, origin HEAD, git config, and stow integrity",
            "OpenCode, Herdr, notifications, timers, and UWSM integration",
            "Omarchy host links, browser flags/extensions, and hardware video",
            "Public/private packages, pacman hooks, and managed firewall rules",
          ],
        },
        {
          title: "Exit codes",
          lines: [
            "0  No critical errors (warnings may still be present)",
            "1  One or more critical errors found",
          ],
        },
      ],
    },
  ),
  describe(
    Command.make("clean", {}, () => clean),
    "Unstow managed dotfiles",
  ),
  describe(
    Command.make("agents-sync", {}, () => agentsSync),
    "Mirror AGENTS.md to agent harness instruction files",
  ),
  describe(
    Command.make("notes-capture-sync", {}, () => notesCaptureSync),
    "Sync watched repositories to the notes capture picker",
    ["dot notes-capture-sync"],
    {
      description:
        "Regenerate the notes capture repository picker from repositories with GitHub notifications enabled in the private dot-git.yml configuration. Updates only CAPTURE_REPOSITORIES in the ignored capture/wrangler.local.jsonc file, creating it from the deploy template when needed. Mirrors non-secret settings from the active Worker, then deploys when the live picker differs.",
    },
  ),
  describe(
    Command.make("setup-private-repo", {}, () => setupPrivateRepo),
    "Sync and register the private pacman repository",
    ["dot setup-private-repo"],
    {
      description:
        "Sync the private Arch package repo mirror, write the private pacman repo snippet, and add the Include line to /etc/pacman.conf when it is missing. This repairs Omarchy pacman.conf refreshes that remove local repository includes. Privileged writes prefer pkexec and fall back to sudo.",
    },
  ),
  describe(
    Command.make("setup-public-repo", {}, () => setupPublicRepo),
    "Trust and register the public timmo pacman repository",
    ["dot setup-public-repo"],
    {
      description:
        "Download the public signing key, require its pinned full fingerprint, locally sign it in pacman's keyring, and register the signed [timmo] repository before the other package repositories. The command fails before changing trust or pacman configuration when the repository is unavailable or the downloaded fingerprint does not match.",
    },
  ),
] as const;

const privatePublishCommand = describe(
  Command.make(
    "private-pkg-publish",
    {
      packageName: Argument.String("package-name").pipe(
        Argument.withDescription("Mapped private package name"),
      ),
      noGit: bool("no-git", "Skip package repo commit and push"),
      skipBuild: bool("skip-build", "Publish an existing artifact"),
      install: bool("install", "Install after publishing"),
    },
    ({ install, noGit, packageName, skipBuild }) =>
      privatePkgPublish({
        packageName,
        publishGit: !noGit,
        buildPackage: !skipBuild,
        installPackage: install,
      }),
  ),
  "Build and publish a private package",
  [
    "dot private-pkg-publish twitch-notifications --install",
    "dot private-pkg-publish --skip-build --no-git twitch-notifications",
  ],
  {
    description:
      "Build and publish a mapped private package into the private pacman repo.",
  },
);

const skillsValidate = describe(
  Command.make("validate", {}, () => runSkillsMaintenance(["validate"])),
  "Validate the standalone skills repository",
);

const skillsImport = describe(
  Command.make(
    "import",
    {
      name: Argument.String("name").pipe(
        Argument.withDescription("Imported skill name"),
      ),
      apply: bool("apply", "Apply a clean imported snapshot"),
      metadataOnly: bool("metadata-only", "Materialise metadata only"),
      reviewedSha: text("reviewed-sha", "Set the reviewed upstream SHA"),
    },
    ({ apply, metadataOnly, name, reviewedSha }) =>
      runSkillsMaintenance([
        "import",
        name,
        ...(apply ? ["--apply"] : []),
        ...(metadataOnly ? ["--metadata-only"] : []),
        ...(Option.isSome(reviewedSha)
          ? ["--reviewed-sha", reviewedSha.value]
          : []),
      ]),
  ),
  "Import or refresh a reviewed skill snapshot",
);

const skillsUpdates = describe(
  Command.make(
    "updates",
    {
      check: bool("check", "Check only"),
      update: bool("update", "Apply clean updates"),
      json: bool("json", "Report as JSON"),
      skill: text("skill", "Limit to one skill"),
      noCommit: bool("no-commit", "Apply without committing"),
      skipReview: bool("skip-review", "Skip local-edit review"),
    },
    ({ check, json, noCommit, skill, skipReview, update }) =>
      runSkillsMaintenance([
        "updates",
        ...(check ? ["--check"] : []),
        ...(update ? ["--update"] : []),
        ...(json ? ["--json"] : []),
        ...(Option.isSome(skill) ? ["--skill", skill.value] : []),
        ...(noCommit ? ["--no-commit"] : []),
        ...(skipReview ? ["--skip-review"] : []),
      ]),
  ),
  "Check/apply imported skill updates",
  [
    "dot skills updates --json",
    "dot skills updates --update --skill browser-control --no-commit",
  ],
);

const skillsCheck = describe(
  Command.make(
    "check",
    {
      openOpencode: bool("open-opencode", "Attempt OpenCode analysis"),
      diffOrigin: bool("diff-origin", "Diff against upstream origins"),
      skill: text("skill", "Check one skill"),
    },
    ({ diffOrigin, openOpencode, skill }) =>
      runSkillsMaintenance([
        "check",
        ...(Option.isSome(skill) ? ["--skill", skill.value] : []),
        ...(diffOrigin ? ["--diff-origin"] : []),
        ...(openOpencode ? ["--open-opencode"] : []),
      ]),
  ),
  "Check adapted imports against upstream",
  ["dot skills check --skill browser-control"],
);

const skillsAgentGitHub = describe(
  Command.make(
    "github",
    {
      skillsDir: pathFlag(
        "skills-dir",
        "Use this Skills checkout",
        "directory",
      ),
    },
    ({ skillsDir }) =>
      runSkillsMaintenance([
        "updates-agent",
        "github",
        ...(Option.isSome(skillsDir)
          ? ["--skills-dir", resolve(skillsDir.value)]
          : []),
      ]),
  ),
  "Run GitHub skill update automation",
);

const skillsAgentDevice = describe(
  Command.make(
    "device",
    {
      configPath: Flag.Path("config", { pathType: "file" }).pipe(
        Flag.withDescription("Use this YAML config"),
      ),
      runId: text("run-id", "Wait for this workflow run"),
    },
    ({ configPath, runId }) =>
      runSkillsMaintenance([
        "updates-agent",
        "device",
        "--config",
        resolve(configPath),
        ...(Option.isSome(runId) ? ["--run-id", runId.value] : []),
      ]),
  ),
  "Run local device skill update automation",
);

const skillsUpdatesAgent = describe(
  Command.make("updates-agent").pipe(
    Command.withSubcommands([skillsAgentGitHub, skillsAgentDevice]),
  ),
  "Run skill update automation",
);

const skillsCommand = describe(
  Command.make("skills").pipe(
    Command.withSubcommands([
      skillsValidate,
      skillsImport,
      skillsUpdates,
      skillsCheck,
      skillsUpdatesAgent,
    ]),
  ),
  "Maintain imported agent skills",
);

const completionsCommand = describe(
  Command.make(
    "completions",
    {
      shell: Argument.Literals("shell", ["bash", "fish", "zsh"]).pipe(
        Argument.withDescription("Shell to generate completions for"),
        Argument.withDefault("zsh"),
      ),
    },
    completions,
  ),
  "Generate shell completions",
  ["dot completions zsh", "dot completions bash", "dot completions fish"],
  {
    description:
      "Generate the managed dot and skill-maintenance completion files for the selected shell so the next dot stow installs them.",
  },
);

const isAgent = describe(
  Command.make(
    "is-agent",
    {
      quiet: Flag.Boolean("quiet").pipe(
        Flag.withAlias("q"),
        Flag.withDefault(false),
      ),
      json: bool("json", "Print JSON"),
    },
    isAgentCommand,
  ),
  "Detect whether an AI coding agent is running dot",
  [
    "dot is-agent",
    "dot is-agent --quiet",
    "dot is-agent --json",
    "dot is-agent && echo running under an agent",
  ],
  {
    description:
      "Detect whether dot is running under an agent harness from agent environment variables, falling back to a Linux /proc process-ancestry check. Exits 0 when an agent is detected and 1 otherwise, so scripts can branch with `if dot is-agent`. Set DOT_AGENT=1 to force detection on or DOT_AGENT=0 to force it off.",
    modes: [
      "(default)  Print the detected agent, or a no-agent message",
      "--quiet    Print only the provider id (nothing when no agent)",
      "--json     Print the detection result as JSON",
    ],
  },
);

const repoInductCommand = describe(
  Command.make(
    "repo-induct",
    {
      path: Argument.Path("path", { pathType: "directory" }).pipe(
        Argument.optional,
      ),
      preset: Flag.Literals("preset", ["normal", "home-assistant"]).pipe(
        Flag.optional,
        Flag.withDescription("Private preset (default: normal)"),
      ),
      name: text("name", "Friendly repository label"),
      github: text(
        "github",
        "GitHub owner/repository (default: origin remote)",
      ),
      aliases: text(
        "aliases",
        "Space- or comma-separated aliases; empty for none",
      ),
      postUpdate: text("post-update", "Post-update command; empty for none"),
      agentOxlint: optionalBool(
        "agent-oxlint",
        "Enable agent Oxlint; --no-agent-oxlint disables it",
      ),
      activityEnabled: optionalBool(
        "activity-enabled",
        "Enable activity checks; --no-activity-enabled disables them",
      ),
      activitySchedule: text(
        "activity-schedule",
        "Activity schedule: five-field cron or work",
      ),
      notificationsEnabled: optionalBool(
        "notifications-enabled",
        "Enable notifications; --no-notifications-enabled disables them",
      ),
      notificationsSchedule: text(
        "notifications-schedule",
        "Notification schedule: five-field cron or work",
      ),
      ignoreBotActivity: optionalBool(
        "ignore-bot-activity",
        "Filter bot-only activity; --no-ignore-bot-activity shows it",
      ),
      noninteractive: bool(
        "noninteractive",
        "Use flags and preset defaults without questions; preview by default",
      ),
      commit: bool(
        "commit",
        "Commit the proposed entry with --noninteractive after reviewing its preview",
      ),
    },
    (input) =>
      repoInduct({
        path: optional(input.path),
        preset: optional(input.preset),
        name: optional(input.name),
        github: optional(input.github),
        aliases: optional(input.aliases),
        postUpdate: optional(input.postUpdate),
        agentOxlint: optional(input.agentOxlint),
        activityEnabled: optional(input.activityEnabled),
        activitySchedule: optional(input.activitySchedule),
        notificationsEnabled: optional(input.notificationsEnabled),
        notificationsSchedule: optional(input.notificationsSchedule),
        ignoreBotActivity: optional(input.ignoreBotActivity),
        noninteractive: input.noninteractive,
        commit: input.commit,
      }),
  ),
  "Induct a local repository into private dot git config with a preview before committing",
  [
    "dot repo-induct",
    "dot repo-induct ~/repos/example --noninteractive --preset normal --name Example --aliases example",
    "dot repo-induct ~/repos/example --noninteractive --preset normal --name Example --aliases example --commit",
  ],
  {
    description:
      "The terminal wizard asks for Normal (first and default) or Home Assistant, then every repository field using private dot-git-presets.yml defaults and local Git identity. Flags prefill the wizard. With --noninteractive, flags override preset defaults and the command only previews; repeat the reviewed options with --commit to save. Each run validates the complete config and shows the exact diff. The config must be tracked and clean; active commit hooks are refused. Existing entries and formatting are preserved. Commits through dot git-commit without pushing or including unrelated staged files. Repositories already inducted are rejected; use agent-oxlint --opt-in to enable their agent pass.",
  },
);

const prWatchCommand = describe(
  Command.make(
    "pr-watch",
    {
      prs: Argument.Int("pr").pipe(
        Argument.atLeast(0),
        Argument.withDescription(
          "Pull request numbers (default: the current branch's pull request)",
        ),
      ),
      repo: text("repo", "Repository slug when the PRs are elsewhere"),
      stopOn: Flag.Literals("stop-on", ["failure", "review"]).pipe(
        Flag.atLeast(0),
        Flag.withDescription(
          "Stop early on a failed job or check, or a new review with open threads; repeatable",
        ),
      ),
      timeout: runDuration(
        "timeout",
        "Overall watch deadline (default: 60 minutes)",
      ).pipe(Flag.withDefault(60 * 60 * 1000)),
      interval: integer("interval", "Seconds between polls", 20).pipe(
        Flag.filter(
          (value) => value >= 5,
          () => "Interval must be at least 5 seconds",
        ),
      ),
      logLines: integer(
        "log-lines",
        "Trailing failed-log lines kept per job; 0 keeps everything",
        200,
      ).pipe(
        Flag.filter(
          (value) => value >= 0,
          () => "Log lines must not be negative",
        ),
      ),
      output: pathFlag(
        "output",
        "Report path (default: ~/.local/state/dot/pr-watch/<repo>-<prs>-<time>.md)",
        "file",
      ),
    },
    (input) =>
      prWatch({
        ...input,
        repo: optional(input.repo),
        output: optional(input.output),
      }),
  ),
  "Watch pull request runs, checks and reviews, streaming progress and a full report",
  [
    "dot pr-watch",
    "dot pr-watch --stop-on failure",
    "dot pr-watch 54322 54325 54328 --repo home-assistant/frontend",
  ],
  {
    description:
      "Follow every GitHub Actions run on each pull request's head commit, including Copilot code review runs, plus external status checks. Superseded runs of the same workflow on the same commit are ignored, and a new push moves the watch to the new head. Progress streams to stdout one line per event; failed job logs and the final review dump go to a Markdown report whose path is printed first and last. Failed jobs are reported as soon as they finish, even while the rest of the run continues. The watch ends after two settled polls, waiting up to five more minutes for requested bot reviews. The review dump lists reviews newest first, unresolved threads with every comment in full, and resolved or minimized threads with only their replies. The command never changes the pull request. Designed for OpenCode 2 background shells: the completion notification carries the short summary and the report holds the detail.",
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0    Everything finished and passed",
          "1    A job or check failed, or the watch could not start",
          "3    Stopped early by --stop-on while other work was still pending",
          "124  Timed out",
        ],
      },
    ],
  },
);

const prQueueCommand = describe(
  Command.make(
    "pr-queue",
    {
      repo: text("repo", "Repository slug (default: the current checkout)"),
      search: text(
        "search",
        "Pull request search overriding review_search from private dot-git.yml",
      ),
      since: Flag.String("since").pipe(
        Flag.withDefault("today"),
        Flag.withDescription(
          "Activity window start: today, yesterday, YYYY-MM-DD (local midnight), an ISO timestamp, or an age such as 12h, 3d or 1w",
        ),
      ),
      sort: Flag.Literals("sort", [
        "effort",
        "updated",
        "created",
        "size",
      ]).pipe(
        Flag.withDefault("effort"),
        Flag.withDescription(
          "Queue order: effort groups (small, medium, large, not ready), or one table by updated, created or size",
        ),
      ),
      only: Flag.Literals("only", ["queue", "activity"]).pipe(
        Flag.optional,
        Flag.withDescription(
          "Print only the review queue or only the activity window",
        ),
      ),
      limit: integer("limit", "Maximum queue pull requests", 200).pipe(
        Flag.filter(
          (value) => value > 0,
          () => "Limit must be positive",
        ),
      ),
      json: bool("json", "Print JSON instead of Markdown"),
    },
    (input) =>
      prQueue({
        ...input,
        repo: optional(input.repo),
        search: optional(input.search),
        only: optional(input.only),
      }),
  ),
  "List reviewable pull requests and what was opened, merged or closed recently",
  [
    "dot pr-queue",
    "dot pr-queue --only activity --since 2026-09-19",
    "dot pr-queue --sort updated --since 3d --json",
  ],
  {
    description:
      "Run the repository's review_search from private dot-git.yml (or --search) and classify each pull request deterministically: size from changed lines, failing and pending checks, latest reviews, review decision, labels, comment count and first-time contributors. Effort groups are small (up to 150 changed lines), medium (up to 400) and large; a failing check or requested changes makes a pull request not ready. The activity window lists every pull request merged, closed without merging or opened since --since, newest first, with size and labels, plus the net change in open pull requests. Read-only.",
  },
);

const agentOxlintCommand = describe(
  Command.make(
    "agent-oxlint",
    {
      paths: Argument.Path("path", { pathType: "either" }).pipe(
        Argument.atLeast(0),
      ),
      all: bool("all", "Lint the complete repository tree"),
      optIn: bool(
        "opt-in",
        "Enable the existing private config entry and commit the single-line change",
      ),
      force: bool(
        "force",
        "Run even if the repository is not opted in or already has Oxlint",
      ),
    },
    agentOxlint,
  ),
  "Run the advisory generic Oxlint pass for cleanup work in an opted-in repository. Repository-owned Oxlint takes precedence. Pass changed paths normally, or use --all when explicitly requested. Pass --force to run despite those skips.",
  [
    "dot agent-oxlint src/example.ts",
    "dot agent-oxlint src/one.ts src/two.ts",
    "dot agent-oxlint --all",
    "dot agent-oxlint --force src/example.ts",
    "dot agent-oxlint --opt-in",
  ],
  {
    description:
      "Run the generic @timmo001/oxlint-rules recommended config from a dot-managed cache without changing the target repository. The current repository must set agent_oxlint: true in private dot-git.yml. Repositories with their own Oxlint config, dependency, script, or local binary are skipped because their local setup takes precedence. Pass --force to run anyway. Diagnostics are advisory for cleanup work and do not make these personal rules authoritative for the host repository.",
    modes: [
      "<path>...  Lint explicit changed files or directories",
      "--all      Lint the complete repository tree",
      "--force    Run even if opt-in or repository Oxlint would skip",
      "--opt-in   Enable and commit the existing config entry; add paths or --all to also lint",
    ],
    sections: [
      {
        title: "Opt-in",
        lines: [
          "--opt-in adds or sets only agent_oxlint: true in an existing private repository entry, preserving all other bytes. If the entry is missing, it offers the repo-induct wizard with agent Oxlint prefilled as enabled. Without a terminal it prints induction instructions. The config must be tracked and clean. Active commit hooks are refused rather than bypassed so formatters cannot expand the change. Commits through dot git-commit without pushing; unrelated staged files are excluded. An existing opt-in creates no commit.",
        ],
      },
    ],
  },
);

const floating = describe(
  Command.make(
    "launch-floating-webapp",
    {
      url: Argument.String("url").pipe(
        Argument.withDescription("Webapp URL to launch"),
        Argument.optional,
      ),
      monitor: text("monitor", "Target monitor"),
      workspace: text("workspace", "Target workspace"),
      width: integer("width", "Window width", 380),
      height: integer("height", "Window height", 500),
      rightMargin: integer("right-margin", "Right margin", 16),
      bottomMargin: integer("bottom-margin", "Bottom margin", 6),
      address: text("address", "Existing window address"),
    },
    (input) =>
      launchFloatingWebapp({
        ...input,
        url: optional(input.url),
        monitor: optional(input.monitor),
        workspace: optional(input.workspace),
        address: optional(input.address),
      }),
  ),
  "Launch one Omarchy webapp and place its new window in the target monitor's bottom-right corner, or reposition an existing window with --address. Width and height must be positive integers; margins must be non-negative.",
  [],
  {
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0  Window placed and its address printed",
          "1  Launch detection, Hyprland query, or placement failed",
          "2  Invalid arguments",
        ],
      },
    ],
  },
);

const herdrRepoOpenCommand = describe(
  Command.make(
    "repo-open",
    {
      layout: Flag.Literals("layout", [
        "auto",
        "vertical",
        "horizontal",
        "tab",
      ]).pipe(
        Flag.withDescription(
          "Auto reuses an idle shell pane, otherwise splits right; vertical splits right, horizontal splits below, tab opens a new tab",
        ),
        Flag.optional,
      ),
      modifiers: Flag.Int("modifiers").pipe(
        Flag.withSchema(
          Schema.Int.check(
            Schema.isBetween({ minimum: 0, maximum: 0x7fffffff }),
          ),
        ),
        Flag.withDescription(
          "Qt keyboard modifier bitmask: Ctrl new tab, Alt split below, Shift split right, otherwise auto",
        ),
        Flag.optional,
      ),
      prompt: Flag.String("prompt").pipe(
        Flag.withDescription(
          "Initial prompt to send through Herdr after the agent is ready",
        ),
        Flag.optional,
      ),
      agentKind: Flag.String("agent-kind").pipe(
        Flag.withDescription(
          "Expected Herdr agent kind for an explicit command",
        ),
        Flag.optional,
      ),
      agent: text(
        "agent",
        "Installed launcher from dot herdr agents, such as opencode2",
      ),
      agentName: text(
        "agent-name",
        "Unique Herdr agent name, assigned before prompting",
      ),
      noFocus: bool(
        "no-focus",
        "Keep the current view focused without opening a terminal client",
      ),
      json: bool(
        "json",
        "Print resource IDs, creation flags, agent details and prompt status as JSON",
      ),
      label: Argument.String("label").pipe(
        Argument.withDescription("Herdr workspace label"),
      ),
      directory: Argument.Path("directory").pipe(
        Argument.withDescription("Repository working directory"),
      ),
      tabLabel: Argument.String("tab-label").pipe(
        Argument.withDescription(
          "Optional command tab label; defaults to the selected agent label or Shell",
        ),
        Argument.optional,
      ),
      command: Argument.String("command").pipe(
        Argument.withDescription("Optional command to run"),
        Argument.optional,
      ),
    },
    ({
      command,
      prompt,
      agentKind,
      agent,
      agentName,
      tabLabel,
      layout,
      modifiers,
      ...input
    }) =>
      herdrRepoOpen({
        ...input,
        layout: optional(layout),
        modifiers: optional(modifiers),
        command: optional(command),
        prompt: optional(prompt),
        agentKind: optional(agentKind),
        agent: optional(agent),
        agentName: optional(agentName),
        tabLabel: optional(tabLabel),
      }),
  ),
  "Open or focus a repository workspace in the shared Herdr session, attaching a tiled terminal when needed. Commands reuse an idle shell pane by default, checking the focused pane, other panes in its tab, then other tabs before splitting right. --layout vertical always splits right, horizontal splits below, and tab always opens a new tab. --modifiers selects the same behaviour from Qt click/Enter modifiers, with Ctrl taking priority over Alt, then Shift. Placement flags are mutually exclusive. Use --agent to resolve the launcher, label and kind from dot herdr agents; it cannot be combined with a command or --agent-kind. Agent launches wait for readiness and verify the selected kind before naming or prompting. --no-focus leaves the current view alone. --json reports resource IDs, creation flags, agent details and whether the prompt was sent. Without a command or --agent, focus the workspace; an empty command opens a shell using the selected layout.",
  [],
  {
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0  Repository workspace focused or opened",
          "1  Herdr operation failed",
          "2  Invalid arguments",
        ],
      },
    ],
  },
);

const herdrStartCommand = describe(
  Command.make("start", {}, () => herdrStart),
  "Start the default Herdr server with the desktop autostart launch context",
);

const herdrRestartCommand = describe(
  Command.make(
    "restart",
    { check: bool("check", "Report blockers without restarting") },
    (options) => herdrServerAction("restart", options),
  ),
  "Restart the default Herdr server only when its panes are idle shells. Run outside Herdr; --check also works inside it. Lists active agents, commands, and background jobs, then exits if blocked.",
  ["dot herdr restart --check", "dot herdr restart"],
);

const herdrStopCommand = describe(
  Command.make(
    "stop",
    { check: bool("check", "Report blockers without stopping") },
    (options) => herdrServerAction("stop", options),
  ),
  "Stop the default Herdr server only when its panes are idle shells. Run outside Herdr; --check also works inside it. Lists active agents, commands, and background jobs, then exits if blocked.",
  ["dot herdr stop --check", "dot herdr stop"],
);

const herdr = describe(
  Command.make("herdr").pipe(
    Command.withSubcommands([
      herdrStartCommand,
      herdrStopCommand,
      herdrRestartCommand,
      herdrRepoOpenCommand,
      describe(
        Command.make(
          "context",
          {
            json: bool("json", "Emit attached-session context as JSON"),
            watch: bool(
              "watch",
              "Watch context changes as newline-delimited JSON",
            ),
            session: text(
              "session",
              "Select a Herdr session (use default for the default socket)",
            ),
          },
          ({ json, session, watch }) =>
            herdrContext({ json, session: optional(session), watch }),
        ),
        "Show context for a locally attached Herdr terminal",
        [
          "dot herdr context",
          "dot herdr context --json",
          "dot herdr context --watch --json",
          "dot herdr context --session default",
        ],
        {
          description:
            "Shows the selected workspace, tab, pane, directory and Git repository while a local foreground terminal client is connected to the selected Herdr session. Desktop window focus is not required. JSON uses attached: false and null context fields when no terminal is attached. Without --session, uses the SDK's HERDR_SOCKET_PATH, HERDR_SESSION and default socket selection. Local Linux process and socket checks do not detect remote clients. Probe failures exit non-zero with an error on stderr. --watch emits changed context as newline-delimited JSON, following workspace, tab and pane events with a 30-second fallback. Send refresh followed by a newline on stdin to collect and emit context even when unchanged. Watch failures emit null and an error on stderr; dropped connections reconnect automatically.",
        },
      ),
      describe(
        Command.make("agents", {}, () =>
          installedHerdrAgents.pipe(
            Effect.tap((agents) =>
              Effect.sync(() => console.log(JSON.stringify(agents))),
            ),
          ),
        ),
        "List installed agent targets shared by repository and release pickers",
      ),
    ]),
  ),
  "Manage the shared Herdr server and repository workspaces",
);

const relayout = describe(
  Command.make(
    "workspace-relayout",
    { edit: bool("edit", "Capture or overwrite a preset") },
    workspaceRelayout,
  ),
  "Apply or capture a Hyprland workspace layout",
);

const setupWorkspace = describe(
  Command.make(
    "workspace-setup",
    {
      sleep: Flag.Finite("sleep").pipe(
        Flag.withDefault(0),
        Flag.withDescription("Wait before running setup logic"),
      ),
      mode: Flag.Literals("mode", ["work", "normal"]).pipe(
        Flag.optional,
        Flag.withDescription(
          "Use the work or normal layout instead of detecting work time",
        ),
      ),
    },
    ({ mode, sleep }) =>
      workspaceSetup({
        startupDelay: sleep,
        mode: optional(mode),
      }),
  ),
  "Launch or reuse desktop apps and rebuild the workspace layout",
  [
    "dot workspace-setup",
    "dot workspace-setup --mode=work",
    "dot workspace-setup --mode=normal",
  ],
);

function showHelp(command: Option.Option<string>): Effect.Effect<void> {
  return Effect.gen(function* () {
    const target = Option.isSome(command)
      ? getCliCommand(command.value)
      : dotCommand;

    const formatter = yield* CliOutput.Formatter;

    const path =
      target === dotCommand ? ["dot"] : ["dot", target?.name ?? "help"];

    process.stdout.write(
      `${formatter.formatHelpDoc(commandHelp(target ?? helpCommand, path))}\n`,
    );
  });
}

const helpCommand = describe(
  Command.make(
    "help",
    {
      command: Argument.String("command").pipe(
        Argument.withDescription("Command to show help for"),
        Argument.optional,
      ),
    },
    ({ command }) => showHelp(command),
  ),
  "Show this help menu",
);

/** Executable `dot` command tree and single source of CLI truth. */
export const dotCommand = describe(
  Command.make("dot").pipe(
    Command.withSubcommands([
      initCommand,
      installCommand,
      updateCommand,
      systemUpdateCommand,
      dependenciesCommand,
      runCommandSpec,
      updatesCommand,
      stowCommand,
      omarchyPluginCommand,
      ...simpleCommands,
      gitDiffCommand,
      gitWebCommand,
      gitCommitCommand,
      gitNotificationsCommand,
      gitReleasesCommand,
      describe(
        Command.make("mcp-sync", {}, () =>
          Effect.promise(() => import("../mcp/commands/McpSync.js")).pipe(
            Effect.flatMap((module) => module.mcpSync),
          ),
        ),
        "Regenerate MCP configs for all harnesses from the spec",
        ["dot mcp-sync"],
        {
          description:
            "Regenerate each active harness's native MCP config from the private spec (mcp.yml). Repository opencode_mcp lists in dot-git.yml opt into named servers using generated, Git-ignored .opencode/opencode.jsonc files; removing an opt-in removes its generated config. Existing unowned or tracked configs are preserved and reported as conflicts. Global configs are written into the stowed private source tree; run dot stow after. Some agent harnesses are documented stubs and are not written.",
        },
      ),
      privatePublishCommand,
      skillsCommand,
      completionsCommand,
      isAgent,
      repoInductCommand,
      agentOxlintCommand,
      prQueueCommand,
      prWatchCommand,
      floating,
      herdr,
      setupWorkspace,
      relayout,
      helpCommand,
    ]),
  ),
  "Manage dotfiles and system configuration",
);

/** Canonical top-level command names derived from the executable tree. */
export const commandNames = dotCommand.subcommands.flatMap((group) =>
  group.commands.map((command) => command.name),
);

/** Resolve a top-level command by canonical name or alias. */
export function getCliCommand(name: string): Command.Command.Any | undefined {
  return dotCommand.subcommands
    .flatMap((group) => group.commands)
    .find((command) => command.name === name || command.alias === name);
}

/** Runtime structural view exposed by Effect commands for generated consumers. */
export interface InspectableCommand extends Command.Command.Any {
  /** Build structured help for a command path. */
  readonly buildHelpDoc: (path: ReadonlyArray<string>) => HelpDoc.HelpDoc;
  /** Parsed command parameter configuration. */
  readonly config: {
    readonly flags: ReadonlyArray<Param.AnyFlag>;
    readonly arguments: ReadonlyArray<Param.AnyArgument>;
  };
}

/** Read Effect's structured help directly from the executable command tree. */
export function commandHelp(
  command: Command.Command.Any,
  path: ReadonlyArray<string>,
): HelpDoc.HelpDoc {
  // SAFETY: Effect command instances expose buildHelpDoc on their runtime implementation.
  const help = (command as InspectableCommand).buildHelpDoc(path);

  return {
    ...help,
    globalFlags: [
      {
        name: "help",
        aliases: ["-h"],
        type: "boolean",
        description: Option.some("Show help information"),
        required: false,
      },
    ],
  };
}

/** Read the parsed parameter configuration from an Effect command. */
export function commandConfig(
  command: Command.Command.Any,
): InspectableCommand["config"] {
  // SAFETY: Effect command instances expose config on their runtime implementation.
  return (command as InspectableCommand).config;
}

/** Read optional generated-documentation extensions from a command annotation. */
export function commandDocs(command: Command.Command.Any): CliDocs | undefined {
  return Option.getOrUndefined(
    Context.getOption(command.annotations, CliDocsAnnotation),
  );
}
