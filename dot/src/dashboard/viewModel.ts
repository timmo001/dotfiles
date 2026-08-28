import type { GitNotificationState, RepoState } from "../types.js";
import type {
  DashboardBarValue,
  DashboardCard,
  DashboardSourceState,
  DashboardState,
  DashboardTone,
} from "./types.js";
import { notificationReasonIsImportant } from "../git/services/notificationStatus.js";

/** Inputs used to compose the dashboard view model. */
export interface DashboardStateInput {
  /** Current git diff watcher state. */
  readonly repoState: RepoState;
  /** Dashboard source state for repo enrichment and bar-compatible modules. */
  readonly sourceState: DashboardSourceState;
  /** Current GitHub notification state. */
  readonly notifications: GitNotificationState;
}

/** Compose dashboard cards from live source snapshots. */
export function buildDashboardState(
  input: DashboardStateInput,
): DashboardState {
  const cards = {
    updates: updatesCard(input.sourceState),
    gitDiff: gitDiffCard(input.repoState, input.sourceState),
    gitNotifications: gitNotificationsCard(input.notifications),
    live: liveCard(input.sourceState.bar.twitch),
    temperature: environmentCard(
      "environment-temperature",
      "Temperature",
      input.sourceState.bar.temperature,
      "No temperature reading",
    ),
    co2: environmentCard(
      "environment-co2",
      "CO2",
      input.sourceState.bar.co2,
      "No CO2 reading",
    ),
    voc: environmentCard(
      "environment-voc",
      "VOC",
      input.sourceState.bar.voc,
      "No VOC reading",
    ),
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
  const overviewCards = [
    ...(nextHour ? [nextHour] : []),
    cards.updates,
    cards.live,
  ];
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
      {
        title: "Environment",
        cards: [cards.temperature, cards.co2, cards.voc],
      },
    ],
    lastChecked: latestDate([
      input.repoState.lastChecked,
      input.sourceState.lastChecked,
      input.notifications.lastChecked,
    ]),
    loading: input.sourceState.loading || input.notifications.loading,
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
  };
}

function gitNotificationsCard(
  notifications: GitNotificationState,
): DashboardCard {
  const unread = notifications.threads.filter((thread) => thread.unread).length;
  const important = notifications.threads.filter(
    (thread) => thread.unread && notificationReasonIsImportant(thread.reason),
  ).length;
  const errorMessage = notifications.message;
  return {
    id: "github",
    section: "Git",
    title: "Git Notifications",
    headline: errorMessage
      ? "Notifications unavailable"
      : important > 0
        ? `${important} important notification${plural(important)}`
        : unread > 0
          ? `${unread} unread notification${plural(unread)}`
          : "Inbox calm",
    tone:
      errorMessage || important > 0
        ? "attention"
        : unread > 0
          ? "active"
          : "ok",
    lines: [errorMessage ?? `${unread} unread, ${important} important`].filter(
      (line): line is string => Boolean(line),
    ),
    command: `omarchy-shell shell summon timmo.git '{"view":"notifications"}'`,
    commandMode: "exit",
    actionLabel: "Open Notifications",
  };
}

function liveCard(twitch: DashboardBarValue): DashboardCard {
  const visible = barVisible(twitch);
  return {
    id: "live",
    section: "Overview",
    title: "Live Channels",
    headline: visible
      ? liveHeadline(twitch.text)
      : statusHeadline(twitch, "No channels live"),
    tone: visible ? "active" : toneForBarValue(twitch, "ok"),
    lines: barLines(twitch),
    command: "omarchy-shell shell summon timmo.twitch '{}'",
    commandMode: "exit",
    actionLabel: "Open Twitch Panel",
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

function environmentCard(
  id: string,
  title: string,
  value: DashboardBarValue,
  fallback: string,
): DashboardCard {
  const attention = ["warning", "critical"].includes(value.className);
  const visible = barVisible(value);
  const reading = cleanText(value.text);
  const headline =
    visible && reading
      ? value.unit
        ? `${reading} ${value.unit}`
        : reading
      : statusHeadline(value, fallback);
  return {
    id,
    section: "Environment",
    title,
    headline,
    tone: attention
      ? "attention"
      : visible
        ? "ok"
        : toneForBarValue(value, "muted"),
    lines: value.name ? [value.name] : [],
    ...(value.openCommand && {
      command: value.openCommand,
      commandMode: "silent" as const,
      actionLabel: "Open in Home Assistant",
    }),
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
