import { Context, Effect, Option } from "effect";
import {
  Argument,
  CliOutput,
  Command,
  Flag,
  GlobalFlag,
  type HelpDoc,
  type Param,
} from "effect/unstable/cli";
import { agentsSync } from "../commands/AgentsSync.js";
import { agentOxlint } from "../commands/AgentOxlint.js";
import { clean } from "../commands/Clean.js";
import { completions } from "../commands/Completions.js";
import { doctor } from "../commands/Doctor.js";
import { herdrRepoOpen } from "../commands/HerdrRepoOpen.js";
import { init } from "../commands/Init.js";
import { install } from "../commands/Install.js";
import { isAgentCommand } from "../commands/IsAgent.js";
import { launchFloatingWebapp } from "../commands/LaunchFloatingWebapp.js";
import { notesCaptureSync } from "../commands/NotesCaptureSync.js";
import { omarchyPlugin } from "../commands/OmarchyPlugin.js";
import { privatePkgPublish } from "../commands/PrivatePkgPublish.js";
import { setupPrivateRepo } from "../commands/SetupPrivateRepo.js";
import { setupPublicRepo } from "../commands/SetupPublicRepo.js";
import { runSkillsMaintenance } from "../commands/Skills.js";
import { stow } from "../commands/Stow.js";
import { update, updateCheck } from "../commands/Update.js";
import { usage } from "../commands/Usage.js";
import { workspaceRelayout } from "../commands/WorkspaceRelayout.js";
import {
  workspaceCapture,
  workspaceRestore,
} from "../commands/WorkspaceSession.js";
import { configureFirewallRules } from "../lib/firewallSetup.js";
import { applyOmarchyShellConfig } from "../lib/omarchyShellConfig.js";
import {
  diffBarJson,
  diffListAll,
  diffListChanged,
  diffPanelJson,
  diffRaw,
} from "../git/commands/Diff.js";
import { gitCommitRaw } from "../git/commands/Commit.js";
import {
  notificationsAction,
  notificationsBarJson,
  notificationsListThreads,
  notificationsMarkBotRead,
  notificationsOpenShell,
  notificationsRaw,
} from "../git/commands/Notifications.js";
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
  Flag.boolean(name).pipe(
    Flag.withDefault(false),
    Flag.withDescription(description),
  );
const text = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.optional, Flag.withDescription(description));
const pathFlag = (
  name: string,
  description: string,
  pathType: "file" | "directory" | "either",
) =>
  Flag.path(name, { pathType }).pipe(
    Flag.optional,
    Flag.withDescription(description),
  );
const integer = (name: string, description: string, value: number) =>
  Flag.integer(name).pipe(
    Flag.withDefault(value),
    Flag.withDescription(description),
  );
const optional = <A>(value: Option.Option<A>): A | undefined =>
  Option.getOrUndefined(value);

/** Effect global flags enabled by the `dot` command runner. */
export const cliBuiltIns = [GlobalFlag.Help] as const;

/** Preserve the legacy unquoted multi-token value accepted by `--since`. */
export function normalizeCliArgs(args: readonly string[]): readonly string[] {
  if (args[0] !== "git-notifications") return args;
  const sinceIndex = args.indexOf("--since");
  if (sinceIndex < 0) return args;
  let end = sinceIndex + 1;
  while (end < args.length && !args[end].startsWith("--")) end++;
  if (end <= sinceIndex + 2) return args;
  return [
    ...args.slice(0, sinceIndex + 1),
    args.slice(sinceIndex + 1, end).join(" "),
    ...args.slice(end),
  ];
}
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
      confirm: bool(
        "confirm",
        "Compatibility flag; accepted but does not suppress prompts",
      ),
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
      pull: bool("pull", "Run the repository pull phase only"),
      stow: bool(
        "stow",
        "Generate completions, sync MCP configs, and stow only",
      ),
      app: bool(
        "app",
        "Install Bun dependencies and rebuild the dot binary only",
      ),
      check: bool("check", "Report core/system repos behind upstream"),
      checkAll: bool("check-all", "Report all tracked repos behind upstream"),
      noSelfUpdate: bool(
        "no-self-update",
        "Skip the internal self-update phase",
      ),
      postHookRepo: text("post-hook-repo", "Internal post-hook repository"),
    },
    ({
      app,
      check,
      checkAll,
      noSelfUpdate,
      postHookRepo,
      pull,
      stow: onlyStow,
    }) =>
      check || checkAll
        ? updateCheck({ all: checkAll })
        : update({
            pull,
            stow: onlyStow,
            app,
            selfUpdate: !noSelfUpdate,
            postHookRepos: Option.isSome(postHookRepo)
              ? [postHookRepo.value]
              : [],
          }),
  ),
  "Self-update, pull repos, stow dotfiles, rebuild. Phase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Internal --no-self-update and --post-hook-repo flags support the active self-update handoff.",
  [],
  {
    description:
      "A full update pulls the public dotfiles, installs Bun dependencies, rebuilds and relaunches dot, then scans and pulls tracked repositories. It trusts tracked mise configs, regenerates completions, installs missing public Arch/AUR packages, runs the required MCP sync, stows, rebuilds again, runs agents sync, backfills the init marker, and starts the resume refresh. It finishes with a summary of updated repositories and completed actions.\n\nPhase flags are inclusive: passing any of --pull, --stow, or --app runs only the selected phases. Scoped runs skip full-update package reconciliation, agents sync, and init-marker backfill. Every mode that reaches the end starts the bounded resume refresh.",
    sections: [
      {
        title: "Exit codes",
        lines: [
          "0   Update completed, or an update check found nothing behind",
          "1   Fatal workflow failure",
          "2   Update check could not scan repositories",
          "10  Update check found repositories behind upstream",
          "11  Legacy Hypr migration is required",
        ],
      },
    ],
  },
).pipe(Command.withAlias("up"));

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
      id: Argument.string("id").pipe(Argument.withDescription("Plugin ID")),
      url: Argument.string("url").pipe(
        Argument.withDescription("Plugin Git remote"),
      ),
      checkout: Argument.path("checkout").pipe(
        Argument.withDescription("Validated live plugin checkout"),
      ),
      section: Flag.choice("section", ["left", "center", "right"]).pipe(
        Flag.optional,
      ),
      before: text("before", "Place before this plugin"),
      after: text("after", "Place after this plugin"),
    },
    (input) =>
      omarchyPlugin({
        _tag: "add",
        ...input,
        section: optional(input.section),
        before: optional(input.before),
        after: optional(input.after),
      }),
  ),
  "Import a validated plugin checkout",
);
const pluginUpdate = describe(
  Command.make(
    "update",
    {
      id: Argument.string("id").pipe(
        Argument.withDescription("Managed plugin ID"),
        Argument.optional,
      ),
      confirm: Argument.choice("confirm", ["0", "1"]).pipe(
        Argument.withDescription("Compatibility confirmation value"),
        Argument.optional,
      ),
      yes: bool("yes", "Update without confirmation"),
    },
    ({ confirm, id, yes }) =>
      omarchyPlugin({
        _tag: "update",
        id: optional(id),
        yes: yes || Option.getOrUndefined(confirm) === "1",
      }),
  ),
  "Update one or all managed plugins",
);
const pluginRemove = describe(
  Command.make(
    "remove",
    {
      id: Argument.string("id").pipe(
        Argument.withDescription("Managed plugin ID"),
      ),
      confirm: Argument.choice("confirm", ["0", "1"]).pipe(
        Argument.withDescription("Compatibility confirmation value"),
        Argument.optional,
      ),
      save: Argument.choice("save", ["0", "1"]).pipe(
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
      omarchyPlugin({
        _tag: "remove",
        id,
        yes: yes || Option.getOrUndefined(confirm) === "1",
        offerCommit: !noCommitOffer && Option.getOrUndefined(save) !== "0",
      }),
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

const gitDiffCommand = describe(
  Command.make(
    "git-diff",
    {
      noFetch: bool("no-fetch", "Skip fetching from remotes"),
      raw: bool("raw", "Text summary output"),
      barJson: bool(
        "bar-json",
        "JSON output for status bars and shell modules",
      ),
      panelJson: bool(
        "panel-json",
        "Full JSON snapshot for the native shell panel",
      ),
      listChanged: bool("list-changed", "Changed repos as rows"),
      listAll: bool("list-all", "All tracked repos as rows"),
    },
    ({ barJson, listAll, listChanged, noFetch, panelJson }) => {
      const options = noFetch ? { noFetch: true } : undefined;
      if (barJson) return diffBarJson(options);
      if (panelJson) return diffPanelJson(options);
      if (listChanged) return diffListChanged(options);
      if (listAll) return diffListAll;
      return diffRaw(options);
    },
  ),
  "Show repository change state across all tracked repositories.",
  [
    "dot git-diff",
    "dot git-diff --raw",
    "dot git-diff --bar-json",
    "dot git-diff --panel-json",
  ],
  {
    modes: [
      "(default)       Text summary of repos with changes",
      "--bar-json      JSON output for status bars",
      "--panel-json    Full JSON panel snapshot",
      "--list-changed  Changed repositories as rows",
      "--list-all      All tracked repositories as rows",
    ],
  },
).pipe(Command.withAlias("diff"));

const gitCommitCommand = describe(
  Command.make(
    "git-commit",
    {
      message: Flag.string("message").pipe(
        Flag.withAlias("m"),
        Flag.optional,
        Flag.withDescription("Single-line commit subject"),
      ),
      paths: Flag.path("path").pipe(
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
        ],
      },
    ],
  },
);

/** Parse an absolute, epoch, or documented relative notification timestamp. */
export function parseSinceValue(value: string, now = Date.now()): string {
  const relative = value.match(
    /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)(?:\s+ago)?$/i,
  );
  const units = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  } as const;
  const unit = relative?.[2].toLowerCase();
  const multiplier = unit?.startsWith("s")
    ? units.s
    : unit?.startsWith("m")
      ? units.m
      : unit?.startsWith("h")
        ? units.h
        : unit?.startsWith("d")
          ? units.d
          : units.w;
  const timestamp = /^\d+$/.test(value)
    ? Number(value) < 10_000_000_000
      ? Number(value) * 1000
      : Number(value)
    : relative
      ? now - Number(relative[1]) * multiplier
      : Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new Error(
      "Expected an ISO/RFC date, epoch timestamp, or relative duration",
    );
  return new Date(timestamp).toISOString();
}

const since = Flag.string("since").pipe(
  Flag.mapTryCatch(parseSinceValue, (error) => String(error)),
  Flag.withDescription("Only include notifications updated after this date"),
  Flag.optional,
);
const gitNotificationsCommand = describe(
  Command.make(
    "git-notifications",
    {
      raw: bool("raw", "Text summary of notification threads"),
      barJson: bool(
        "bar-json",
        "JSON output for status bars and shell modules",
      ),
      listThreads: bool("list-threads", "Notification threads as rows"),
      barFilter: bool("bar-filter", "Apply watched-repo filtering"),
      all: bool("all", "Include read notifications"),
      participating: bool("participating", "Only participating threads"),
      since,
      markRead: text("mark-read", "Mark a thread as read"),
      markDone: text("mark-done", "Mark a thread as done"),
      ignore: text("ignore", "Ignore a thread"),
      unignore: text("unignore", "Stop ignoring a thread"),
      markBotRead: bool("mark-bot-read", "Mark bot notifications as read"),
      dryRun: bool("dry-run", "Preview bot marking"),
    },
    (input) =>
      Effect.gen(function* () {
        const options: GitNotificationQueryOptions | undefined =
          input.all ||
          input.participating ||
          input.barFilter ||
          Option.isSome(input.since)
            ? {
                ...(input.all && { all: true }),
                ...(input.participating && { participating: true }),
                ...(input.barFilter && { barFilter: true }),
                ...(Option.isSome(input.since) && { since: input.since.value }),
              }
            : undefined;
        for (const [value, action] of [
          [input.markRead, "read"],
          [input.markDone, "done"],
          [input.ignore, "ignore"],
          [input.unignore, "unignore"],
        ] as const)
          if (Option.isSome(value))
            return yield* notificationsAction(action, value.value);
        if (input.markBotRead)
          return yield* notificationsMarkBotRead(options, {
            dryRun: input.dryRun,
          });
        if (input.barJson) return yield* notificationsBarJson(options);
        if (input.listThreads) return yield* notificationsListThreads(options);
        if (input.raw || options) return yield* notificationsRaw(options);
        return yield* notificationsOpenShell;
      }),
  ),
  'Open the authenticated GitHub notification inbox. Without machine-output or action flags, this opens the Omarchy shell panel. --since accepts ISO/RFC dates, epoch timestamps, compact durations such as 2d, and quoted durations such as "2 days ago".',
  [
    "dot git-notifications",
    "dot git-notifications --bar-json",
    "dot git-notifications --participating",
    "dot git-notifications --mark-bot-read --dry-run",
    "dot git-notifications --mark-read 12345",
  ],
  {
    modes: [
      "(default)       Open the shell notification panel",
      "--raw           Text summary",
      "--bar-json      Status-bar JSON",
      "--list-threads  Notification rows",
      "--bar-filter    Apply watched-repository filtering",
    ],
  },
);

const simpleCommands = [
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
    Command.make(
      "doctor",
      {
        openOpencode: bool(
          "open-opencode",
          "Save the report and attempt to open it in OpenCode",
        ),
      },
      doctor,
    ),
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
      packageName: Argument.string("package-name").pipe(
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
      name: Argument.string("name").pipe(
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
      configPath: Flag.path("config", { pathType: "file" }).pipe(
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
      shell: Argument.choice("shell", ["bash", "fish", "zsh"]).pipe(
        Argument.withDescription("Shell to generate completions for"),
        Argument.withDefault("zsh"),
      ),
      stdout: bool("stdout", "Print instead of writing"),
    },
    completions,
  ),
  "Generate shell completions",
  [
    "dot completions zsh",
    "dot completions bash --stdout",
    "dot completions fish --stdout",
  ],
  {
    description:
      "Generate shell completions for dot. By default this writes the managed dot and skill-maintenance completion files for the selected shell so the next dot stow installs them. Pass --stdout to print only dot completions.",
  },
);
const isAgent = describe(
  Command.make(
    "is-agent",
    {
      quiet: Flag.boolean("quiet").pipe(
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
const agentOxlintCommand = describe(
  Command.make(
    "agent-oxlint",
    {
      paths: Argument.path("path", { pathType: "either" }).pipe(
        Argument.atLeast(0),
      ),
      all: bool("all", "Lint the complete repository tree"),
    },
    agentOxlint,
  ),
  "Run the advisory generic Oxlint pass for cleanup work in an opted-in repository. Repository-owned Oxlint takes precedence. Pass changed paths normally, or use --all when explicitly requested.",
  [
    "dot agent-oxlint src/example.ts",
    "dot agent-oxlint src/one.ts src/two.ts",
    "dot agent-oxlint --all",
  ],
  {
    description:
      "Run the generic @timmo001/oxlint-rules recommended config from a dot-managed cache without changing the target repository. The current repository must set agent_oxlint: true in private dot-git.yml. Repositories with their own Oxlint config, dependency, script, or local binary are skipped because their local setup takes precedence. Diagnostics are advisory for cleanup work and do not make these personal rules authoritative for the host repository.",
    modes: [
      "<path>...  Lint explicit changed files or directories",
      "--all      Lint the complete repository tree",
    ],
  },
);
const floating = describe(
  Command.make(
    "launch-floating-webapp",
    {
      url: Argument.string("url").pipe(
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
const herdr = describe(
  Command.make(
    "herdr-repo-open",
    {
      pane: bool("pane", "Run in a new pane"),
      label: Argument.string("label").pipe(
        Argument.withDescription("Herdr workspace label"),
      ),
      directory: Argument.path("directory").pipe(
        Argument.withDescription("Repository working directory"),
      ),
      tabLabel: Argument.string("tab-label").pipe(
        Argument.withDescription("Optional command tab label"),
        Argument.withDefault("Shell"),
      ),
      command: Argument.string("command").pipe(
        Argument.withDescription("Optional command to run"),
        Argument.optional,
      ),
    },
    ({ command, ...input }) =>
      herdrRepoOpen({ ...input, command: optional(command) }),
  ),
  "Open or focus a repository workspace in the shared Herdr session. If the server is headless, open a tiled terminal and wait for a foreground client before focusing the workspace.",
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
const relayout = describe(
  Command.make(
    "workspace-relayout",
    { edit: bool("edit", "Capture or overwrite a preset") },
    workspaceRelayout,
  ),
  "Apply or capture a Hyprland workspace layout",
);
const capture = describe(
  Command.make(
    "workspace-capture",
    {
      currentWorkspace: Flag.boolean("current-workspace").pipe(
        Flag.withAlias("current"),
        Flag.withDefault(false),
      ),
      output: pathFlag("output", "Write to this file", "file"),
      stateDir: pathFlag("state-dir", "Capture state directory", "directory"),
    },
    ({ output, stateDir, ...input }) =>
      workspaceCapture({
        ...input,
        output: optional(output),
        stateDir: optional(stateDir),
      }),
  ),
  "Capture Hyprland workspace and window state",
);
const restore = describe(
  Command.make(
    "workspace-restore",
    {
      dryRun: Flag.boolean("dry-run").pipe(
        Flag.withAlias("dryrun"),
        Flag.withDefault(false),
      ),
      file: pathFlag("file", "Restore this capture", "file"),
      stateDir: pathFlag("state-dir", "Capture state directory", "directory"),
      noLaunch: bool("no-launch", "Do not launch missing apps"),
      noMove: bool("no-move", "Do not move matched windows"),
    },
    ({ file, noLaunch, noMove, stateDir, ...input }) =>
      workspaceRestore({
        ...input,
        file: optional(file),
        stateDir: optional(stateDir),
        launchMissing: !noLaunch,
        moveExisting: !noMove,
      }),
  ),
  "Restore a captured Hyprland workspace session",
);
const usageCommand = describe(
  Command.make(
    "usage",
    {
      subcommand: Argument.choice("command", [
        "summary",
        "stale",
        "path",
        "backfill",
      ]).pipe(
        Argument.withDescription("Analytics operation"),
        Argument.withDefault("summary"),
      ),
      days: integer("days", "Window in days", 90),
      format: Flag.choice("format", ["text", "json", "agent-context"]).pipe(
        Flag.withDefault("text"),
      ),
      roots: Flag.path("root").pipe(Flag.atLeast(0)),
      history: bool("history", "Backfill from shell history"),
      apply: bool("apply", "Write backfilled events"),
    },
    (input) =>
      usage(
        { ...input, days: input.days > 0 ? input.days : 90 },
        getCommandNames(),
      ),
  ),
  "Report local-first usage analytics from NDJSON events under $XDG_STATE_HOME/tool-usage. Live events store canonical commands and recognised flag names, never positional values. Set DOT_USAGE_DISABLE=1 to disable live recording or DOT_USAGE_DIR to relocate storage.",
  [],
  {
    modes: [
      "summary   Per-feature usage table (default)",
      "stale     Features not used within the window",
      "path      Print the event storage root",
      "backfill  Import whitelisted shell-history invocations",
    ],
    sections: [
      {
        title: "Privacy",
        lines: [
          "Live dot events never store positional values",
          "Shell-history backfill is a dry run unless --apply is passed",
          "Review history before applying when arguments may contain sensitive text",
        ],
      },
    ],
  },
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
      command: Argument.string("command").pipe(
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
      stowCommand,
      omarchyPluginCommand,
      ...simpleCommands,
      gitDiffCommand,
      gitCommitCommand,
      gitNotificationsCommand,
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
            "Regenerate each active harness's native MCP config from the single private spec (mcp.yml), keeping agent harness MCP configs aligned. Writes into the stowed private source tree; run dot stow after. Some agent harnesses are documented stubs and are not written. OpenCode gated servers also receive a default-off tools gate so their tool schemas stay out of the baseline context until an agent re-enables them.",
        },
      ),
      privatePublishCommand,
      skillsCommand,
      completionsCommand,
      isAgent,
      agentOxlintCommand,
      floating,
      herdr,
      relayout,
      capture,
      restore,
      usageCommand,
      helpCommand,
    ]),
  ),
  "Manage dotfiles and system configuration",
);

/** Canonical top-level command names derived from the executable tree. */
export const commandNames = dotCommand.subcommands.flatMap((group) =>
  group.commands.map((command) => command.name),
);

function getCommandNames(): readonly string[] {
  return dotCommand.subcommands.flatMap((group) =>
    group.commands.map((command) => command.name),
  );
}

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
