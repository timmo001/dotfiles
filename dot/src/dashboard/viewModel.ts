import type {
  GitNotificationState,
  RepoState,
  WorkflowState,
} from "../types.js";
import type {
  DashboardBarValue,
  DashboardCard,
  DashboardSection,
  DashboardSourceState,
  DashboardState,
  DashboardTone,
} from "./types.js";
import { notificationReasonIsImportant } from "../git/services/notificationStatus.js";
import { workflowRunCounts } from "../git/services/workflowStatus.js";

/** Inputs used to compose the dashboard view model. */
export interface DashboardStateInput {
  /** Current git diff watcher state. */
  readonly repoState: RepoState;
  /** Dashboard source state for repo enrichment and bar-compatible modules. */
  readonly sourceState: DashboardSourceState;
  /** Current GitHub notification state. */
  readonly notifications: GitNotificationState;
  /** Current watched workflow run state. */
  readonly workflows: WorkflowState;
}

/** Compose dashboard cards from live source snapshots. */
export function buildDashboardState(
  input: DashboardStateInput,
): DashboardState {
  const cards = {
    updates: updatesCard(input.sourceState),
    gitDiff: gitDiffCard(input.repoState, input.sourceState),
    gitNotifications: gitNotificationsCard(
      input.notifications,
      input.workflows,
    ),
    live: liveCard(input.sourceState.bar.twitch),
    environment: environmentCard(input.sourceState),
    myTasks: todoCard(
      "my-tasks",
      "My Tasks",
      input.sourceState.bar.todo_my_tasks,
      "home-assistant-tui todo todo.my_tasks",
    ),
    workTasks: todoCard(
      "work-tasks",
      "Work Tasks",
      input.sourceState.bar.todo_work,
      "home-assistant-tui todo todo.work",
    ),
  };
  const nextHour = nextHourCard(input.sourceState.bar.calendar);
  const overviewCards = nextHour ? [nextHour, cards.updates] : [cards.updates];
  const attentionCards = Object.values(cards).filter(
    (card) => card.tone === "attention",
  );
  const activeCards = Object.values(cards).filter(
    (card) => card.tone === "active",
  );
  const summaryLines = [
    attentionCards.length > 0
      ? `Needs action: ${attentionCards.map((card) => card.title).join(", ")}`
      : "Needs action: none",
    activeCards.length > 0
      ? `Active: ${activeCards.map((card) => card.title).join(", ")}`
      : "Active: no live alerts",
    healthySummary(Object.values(cards)),
  ];

  return {
    summaryHeadline:
      attentionCards.length > 0
        ? `${attentionCards.length} attention signal${plural(attentionCards.length)}`
        : "All tracked sources look calm",
    summaryTone: attentionCards.length > 0 ? "attention" : "ok",
    summaryLines,
    sections: [
      { title: "Overview", cards: overviewCards },
      { title: "Git", cards: [cards.gitDiff, cards.gitNotifications] },
      { title: "Todos", cards: [cards.myTasks, cards.workTasks] },
      { title: "Home", cards: [cards.live, cards.environment] },
    ],
    lastChecked: latestDate([
      input.repoState.lastChecked,
      input.sourceState.lastChecked,
      input.notifications.lastChecked,
      input.workflows.lastChecked,
    ]),
    loading:
      input.sourceState.loading ||
      input.notifications.loading ||
      input.workflows.loading,
  };
}

function updatesCard(source: DashboardSourceState): DashboardCard {
  const behind = source.diffRepos.filter((repo) => repo.behind > 0);
  const coreBehind = behind.filter((repo) =>
    ["dotfiles", "omarchy"].includes(repo.category),
  );
  const dirty = source.diffRepos.filter((repo) => repo.isDirty);
  const lines = [
    coreBehind.length > 0
      ? `Core behind: ${repoNames(coreBehind)}`
      : "Core repos up to date",
    behind.length > coreBehind.length
      ? `Other behind: ${behind.length - coreBehind.length}`
      : "Other tracked repos current",
    dirty.length > 0
      ? `Dirty repos: ${dirty.length}`
      : "No dirty update blockers",
  ];
  const hasUpdate = coreBehind.length > 0;
  return {
    id: "updates",
    section: "Overview",
    title: "Updates",
    headline:
      coreBehind.length > 0
        ? `${coreBehind.length} core update${plural(coreBehind.length)}`
        : behind.length > 0
          ? `${behind.length} repo update${plural(behind.length)}`
          : "Tracked repos up to date",
    tone: hasUpdate ? "attention" : behind.length > 0 ? "active" : "ok",
    lines: lines.filter((line) => !line.startsWith("No ")),
    ...(hasUpdate && {
      command: "dot update",
      commandMode: "exit" as const,
      actionLabel: "Run Update",
    }),
  };
}

function gitDiffCard(
  repoState: RepoState,
  source: DashboardSourceState,
): DashboardCard {
  const changed = repoState.changed.length;
  const dirty = source.diffRepos.filter((repo) => repo.isDirty).length;
  const ahead = source.diffRepos.filter((repo) => repo.ahead > 0).length;
  const behind = source.diffRepos.filter((repo) => repo.behind > 0).length;
  return {
    id: "git",
    section: "Git",
    title: "Git Diff",
    headline:
      changed > 0
        ? `${changed} repo${plural(changed)} changed`
        : "Working trees clean",
    tone: dirty > 0 || ahead > 0 ? "attention" : changed > 0 ? "active" : "ok",
    lines: [
      dirty > 0
        ? `${dirty} dirty worktree${plural(dirty)}`
        : "No dirty worktrees",
      ahead > 0
        ? `${ahead} branch${plural(ahead, "es")} ahead`
        : "No unpushed branches",
      behind > 0
        ? `${behind} repo${plural(behind)} behind`
        : "Nothing behind upstream",
    ],
    viewId: "git-diff",
    actionLabel: "Open Git Diff",
  };
}

function gitNotificationsCard(
  notifications: GitNotificationState,
  workflows: WorkflowState,
): DashboardCard {
  const unread = notifications.threads.filter((thread) => thread.unread).length;
  const important = notifications.threads.filter(
    (thread) => thread.unread && notificationReasonIsImportant(thread.reason),
  ).length;
  const workflowCounts = workflows.repos.map(workflowRunCounts);
  const failed = workflowCounts.reduce((sum, counts) => sum + counts.failed, 0);
  const running = workflowCounts.reduce(
    (sum, counts) => sum + counts.running,
    0,
  );
  const workflowErrors = workflows.repos.filter((repo) => repo.error).length;
  const errorMessage = notifications.message;
  const workflowMessage = workflows.message;
  return {
    id: "github",
    section: "Git",
    title: "Git Notifications",
    headline: errorMessage
      ? "Notifications unavailable"
      : workflowErrors > 0
        ? `${workflowErrors} workflow repo${plural(workflowErrors)} unavailable`
        : important > 0
          ? `${important} important notification${plural(important)}`
          : unread > 0
            ? `${unread} unread notification${plural(unread)}`
            : failed > 0
              ? `${failed} workflow failure${plural(failed)}`
              : "Inbox and workflows calm",
    tone:
      errorMessage || workflowErrors > 0 || important > 0 || failed > 0
        ? "attention"
        : unread > 0 || running > 0
          ? "active"
          : "ok",
    lines: [
      errorMessage ?? `${unread} unread, ${important} important`,
      failed > 0
        ? `${failed} workflow failure${plural(failed)}`
        : workflowErrors > 0
          ? `${workflowErrors} workflow repo${plural(workflowErrors)} unavailable`
          : "No workflow failures",
      running > 0
        ? `${running} workflow${plural(running)} running`
        : workflowMessage || "No active workflow runs",
    ].filter((line): line is string => Boolean(line)),
    viewId: "git-notifications",
    actionLabel: "Open Notifications",
  };
}

function liveCard(twitch: DashboardBarValue): DashboardCard {
  const visible = barVisible(twitch);
  return {
    id: "live",
    section: "Home",
    title: "Live Channels",
    headline: visible
      ? liveHeadline(twitch.text)
      : statusHeadline(twitch, "No channels live"),
    tone: visible ? "active" : toneForBarValue(twitch, "ok"),
    lines: barLines(twitch),
    command: "twitch-menu",
    actionLabel: "Open Twitch Menu",
  };
}

function todoCard(
  id: string,
  title: string,
  value: DashboardBarValue,
  command: string,
): DashboardCard {
  const visible = barVisible(value);
  return {
    id,
    section: "Todos",
    title,
    headline: visible
      ? todoHeadline(value.text)
      : statusHeadline(value, "No active items"),
    tone: visible ? "active" : toneForBarValue(value, "ok"),
    lines: barLines(value),
    command,
    commandMode: "suspend",
    actionLabel: `Open ${title}`,
  };
}

function environmentCard(source: DashboardSourceState): DashboardCard {
  const values = [source.bar.temperature, source.bar.co2, source.bar.voc];
  const attention = values.filter((value) =>
    ["warning", "critical"].includes(value.className),
  );
  const visible = values.filter(barVisible);
  const temperature = cleanText(source.bar.temperature.text);
  return {
    id: "environment",
    section: "Home",
    title: "Environment",
    headline:
      attention.length > 0
        ? `${attention.length} air quality alert${plural(attention.length)}`
        : temperature
          ? `${temperature} C and air OK`
          : "Environment sources calm",
    tone:
      attention.length > 0
        ? "attention"
        : visible.length > 0
          ? "ok"
          : toneForBarValue(values[0], "muted"),
    lines: [
      source.bar.temperature.tooltip || source.bar.temperature.message,
      source.bar.co2.tooltip || source.bar.co2.message,
      source.bar.voc.tooltip || source.bar.voc.message,
    ]
      .filter((line): line is string => Boolean(line))
      .map(firstTooltipLine),
  };
}

function nextHourCard(calendar: DashboardBarValue): DashboardCard | null {
  if (calendar.status === "missing") return null;
  const visible = barVisible(calendar);
  return {
    id: "next-hour",
    section: "Overview",
    title: "Events in the next hour",
    headline: visible
      ? cleanText(calendar.text)
      : statusHeadline(calendar, "No events in the next hour"),
    tone: visible ? "active" : toneForBarValue(calendar, "ok"),
    lines: barLines(calendar),
  };
}

function barVisible(value: DashboardBarValue): boolean {
  return (
    value.status === "ok" && (value.text.length > 0 || value.tooltip.length > 0)
  );
}

function barLines(
  value: DashboardBarValue,
  fallback: readonly string[] = [],
): readonly string[] {
  if (value.tooltip)
    return value.tooltip.split("\n").slice(0, 3).map(firstTooltipLine);
  return fallback;
}

function statusHeadline(value: DashboardBarValue, fallback: string): string {
  if (value.status === "missing") return "Not configured";
  if (value.status === "error") return "Unavailable";
  if (value.status === "loading") return "Loading";
  return fallback;
}

function toneForBarValue(
  value: DashboardBarValue,
  fallback: DashboardTone,
): DashboardTone {
  if (value.status === "error") return "attention";
  if (value.status === "missing") return "muted";
  if (["warning", "critical"].includes(value.className)) return "attention";
  return fallback;
}

function cleanText(text: string): string {
  const ascii = text.replace(/[^\x20-\x7e]/g, "").trim();
  return ascii || text.replace(/[\uE000-\uF8FF]/g, "").trim() || text.trim();
}

function liveHeadline(text: string): string {
  const cleaned = cleanText(text)
    .replace(/^\d+\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Live channels active";
}

function todoHeadline(text: string): string {
  const cleaned = cleanText(text).replace(/^\D+/, "").trim();
  return cleaned
    ? `${cleaned} active item${cleaned === "1" ? "" : "s"}`
    : "Active items";
}

function firstTooltipLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function healthySummary(cards: readonly DashboardCard[]): string {
  const healthy = cards.filter((card) => card.tone === "ok");
  return healthy.length > 0
    ? `Healthy: ${healthy.map((card) => card.title).join(", ")}`
    : "Healthy: waiting for live sources";
}

function repoNames(repos: readonly { readonly name: string }[]): string {
  return repos
    .slice(0, 3)
    .map((repo) => repo.name)
    .join(", ");
}

function plural(count: number, suffix = "s"): string {
  return count === 1 ? "" : suffix;
}

function latestDate(dates: readonly Date[]): Date {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}
