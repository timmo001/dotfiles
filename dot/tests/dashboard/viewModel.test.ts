import { describe, expect, test } from "bun:test";
import type {
  DiffRepo,
  GitNotificationState,
  GitNotificationThread,
  RepoState,
} from "../../src/types.js";
import type {
  DashboardBarModuleId,
  DashboardBarValue,
  DashboardSourceState,
} from "../../src/dashboard/types.js";
import { buildDashboardState } from "../../src/dashboard/viewModel.js";

const barIds: readonly DashboardBarModuleId[] = [
  "twitch",
  "temperature",
  "co2",
  "voc",
  "calendar",
  "todo_my_tasks",
  "todo_work",
];

const barValue = (
  id: DashboardBarModuleId,
  overrides: Partial<DashboardBarValue> = {},
): DashboardBarValue => ({
  id,
  status: "hidden",
  text: "",
  tooltip: "",
  className: "",
  updatedAt: new Date("2026-07-10T10:00:00Z"),
  ...overrides,
});

const sourceState = (
  overrides: Partial<DashboardSourceState> = {},
): DashboardSourceState => ({
  diffRepos: [],
  bar: Object.fromEntries(barIds.map((id) => [id, barValue(id)])) as Record<
    DashboardBarModuleId,
    DashboardBarValue
  >,
  lastChecked: new Date("2026-07-10T11:00:00Z"),
  loading: false,
  loaded: true,
  ...overrides,
});

const repoState = (overrides: Partial<RepoState> = {}): RepoState => ({
  changed: [],
  unchanged: [],
  lastChecked: new Date("2026-07-10T10:00:00Z"),
  ...overrides,
});

const notificationThread = (
  overrides: Partial<GitNotificationThread> = {},
): GitNotificationThread => ({
  id: "1",
  repo: "owner/repo",
  repoUrl: "https://github.com/owner/repo",
  title: "Review this",
  type: "PullRequest",
  reason: "subscribed",
  unread: true,
  updatedAt: "2026-07-10T12:00:00Z",
  lastReadAt: null,
  webUrl: "https://github.com/owner/repo/pull/1",
  apiUrl: "https://api.github.com/notifications/threads/1",
  subjectApiUrl: null,
  latestCommentApiUrl: null,
  ...overrides,
});

const notifications = (
  overrides: Partial<GitNotificationState> = {},
): GitNotificationState => ({
  threads: [],
  hiddenThreadIds: [],
  lastChecked: new Date("2026-07-10T12:00:00Z"),
  loading: false,
  loaded: true,
  query: {},
  ...overrides,
});

const diffRepo = (overrides: Partial<DiffRepo> = {}): DiffRepo => ({
  name: "dotfiles",
  path: "/tmp/dotfiles",
  category: "dotfiles",
  isDirty: false,
  modified: 0,
  ahead: 0,
  behind: 0,
  ...overrides,
});

describe("buildDashboardState", () => {
  test("builds calm sections in stable order and keeps the freshest timestamp", () => {
    const state = buildDashboardState({
      repoState: repoState(),
      sourceState: sourceState({
        bar: {
          ...sourceState().bar,
          calendar: barValue("calendar", { status: "missing" }),
        },
      }),
      notifications: notifications(),
    });

    expect(state.summaryHeadline).toBe("All tracked sources look calm");
    expect(state.summaryTone).toBe("ok");
    expect(state.sections.map(({ title }) => title)).toEqual([
      "Overview",
      "Git",
      "Todos",
      "Environment",
    ]);
    expect(state.sections[0].cards.map(({ id }) => id)).toEqual([
      "updates",
      "live",
    ]);
    expect(state.lastChecked).toEqual(new Date("2026-07-10T12:00:00Z"));
    expect(state.loading).toBe(false);
  });

  test("aggregates attention signals across updates, git, GitHub, and environment", () => {
    const changedRepo = {
      name: "dotfiles",
      path: "/tmp/dotfiles",
      locked: false,
    };
    const source = sourceState({
      diffRepos: [
        diffRepo({ isDirty: true, modified: 2, ahead: 1, behind: 3 }),
      ],
      bar: {
        ...sourceState().bar,
        temperature: barValue("temperature", {
          status: "ok",
          text: "31",
          className: "critical",
          unit: "C",
        }),
      },
    });
    const state = buildDashboardState({
      repoState: repoState({ changed: [changedRepo] }),
      sourceState: source,
      notifications: notifications({
        threads: [notificationThread({ reason: "review_requested" })],
      }),
    });

    expect(state.summaryHeadline).toBe("4 attention signals");
    expect(state.summaryLines[0]).toBe(
      "Needs action: Updates, Git Diff, Git Notifications, Temperature",
    );
    expect(
      state.sections[0].cards.find(({ id }) => id === "updates"),
    ).toMatchObject({
      headline: "1 core update",
      command: "dot update",
      commandMode: "exit",
    });
    expect(state.sections[1].cards[1]).toMatchObject({
      headline: "1 important notification",
      tone: "attention",
    });
  });

  test("normalises module text, tooltip lines, units, and todo counts", () => {
    const state = buildDashboardState({
      repoState: repoState(),
      sourceState: sourceState({
        bar: {
          ...sourceState().bar,
          twitch: barValue("twitch", {
            status: "ok",
            text: "\uE000 2 Channel One",
            tooltip:
              " Channel One   playing\nChannel Two\tplaying\nfine\nignored",
          }),
          todo_my_tasks: barValue("todo_my_tasks", {
            status: "ok",
            text: "\uE000 1",
          }),
          temperature: barValue("temperature", {
            status: "ok",
            text: "\uE000 21.5",
            unit: "C",
            name: "Office sensor",
          }),
        },
      }),
      notifications: notifications(),
    });
    const cards = state.sections.flatMap(({ cards }) => cards);

    expect(cards.find(({ id }) => id === "live")).toMatchObject({
      headline: "Channel One",
      lines: ["Channel One playing", "Channel Two playing", "fine"],
      tone: "active",
      command: "omarchy-shell shell summon timmo.twitch '{}'",
      commandMode: "exit",
      actionLabel: "Open Twitch Panel",
    });
    expect(cards.find(({ id }) => id === "my-tasks")?.headline).toBe(
      "1 active item",
    );
    expect(
      cards.find(({ id }) => id === "environment-temperature"),
    ).toMatchObject({
      headline: "21.5 C",
      lines: ["Office sensor"],
    });
  });

  test("surfaces unavailable sources and aggregate loading state", () => {
    const state = buildDashboardState({
      repoState: repoState(),
      sourceState: sourceState({
        loading: true,
        bar: {
          ...sourceState().bar,
          co2: barValue("co2", { status: "error" }),
        },
      }),
      notifications: notifications({ message: "GitHub unavailable" }),
    });
    const cards = state.sections.flatMap(({ cards }) => cards);

    expect(state.loading).toBe(true);
    expect(cards.find(({ id }) => id === "github")).toMatchObject({
      headline: "Notifications unavailable",
      tone: "attention",
    });
    expect(cards.find(({ id }) => id === "environment-co2")).toMatchObject({
      headline: "Unavailable",
      tone: "attention",
    });
  });
});
