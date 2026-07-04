import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  t,
  fg,
} from "@opentui/core";
import type {
  GitNotificationAction,
  GitNotificationState,
  GitNotificationThread,
} from "../../types.js";
import type { Theme } from "../../theme.js";
import { formatBreadcrumb } from "../../tui/breadcrumb.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "../../tui/helpBar.js";
import { StatusList, type StatusListItem } from "../../tui/StatusList.js";
import {
  formatNotificationIcon,
  formatNotificationThreadDetail,
  formatNotificationTimeAgo,
  notificationReasonIsImportant,
} from "../services/notificationStatus.js";

/** Help entries for the GitHub notifications view. */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Enter", action: "open" },
  { key: "w", action: "web inbox" },
  { key: "r", action: "refresh" },
  { key: "m", action: "read" },
  { key: "d", action: "done" },
  { key: "i/u", action: "ignore/unignore" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

const ACTION_PROGRESS_LABEL: Record<GitNotificationAction, string> = {
  read: "Marking read",
  done: "Marking done",
  ignore: "Ignoring",
  unignore: "Unignoring",
};

/** Configuration callbacks for the GitHub notifications view. */
export interface GitNotificationsViewOptions {
  /** Called when the user requests a notification refresh. */
  readonly onRefresh: () => void;
  /** Called when the user opens a notification thread in the browser. */
  readonly onOpenThread: (thread: GitNotificationThread) => void;
  /** Called when the user opens the GitHub notifications inbox in the browser. */
  readonly onOpenInbox: () => void;
  /** Called when the user applies a mutating action to a notification thread. */
  readonly onAction: (
    action: GitNotificationAction,
    thread: GitNotificationThread,
  ) => void;
  /** Called when the user navigates back. */
  readonly onBack: () => void;
}

/** One-pane GitHub notification inbox view with thread actions. */
export class GitNotificationsView {
  private renderer: CliRenderer;
  private callbacks: GitNotificationsViewOptions;
  private theme: Theme;
  private root: BoxRenderable;
  private threadList: StatusList<GitNotificationThread>;
  private title: TextRenderable;
  private statusBar: TextRenderable;
  private threads: readonly GitNotificationThread[] = [];
  private openedThreadIds = new Set<string>();
  private openedThreads = new Map<string, GitNotificationThread>();
  private hiddenThreadIds = new Set<string>();
  private pendingHiddenThreadIds = new Set<string>();
  private state: GitNotificationState | null = null;
  private isVisible = false;
  private requestedInitialRefresh = false;
  private keyHandlers: Readonly<Record<string, () => void>>;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    callbacks: GitNotificationsViewOptions,
  ) {
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.theme = theme;
    this.keyHandlers = {
      r: () => this.refresh(),
      w: () => this.callbacks.onOpenInbox(),
      m: () => this.applyAction("read"),
      d: () => this.applyAction("done"),
      i: () => this.applyAction("ignore"),
      u: () => this.applyAction("unignore"),
      escape: () => this.callbacks.onBack(),
      backspace: () => this.callbacks.onBack(),
    };

    this.root = new BoxRenderable(renderer, {
      id: "notifications-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    this.title = new TextRenderable(renderer, {
      id: "notifications-title-bar",
      content: formatBreadcrumb(
        theme,
        ["Dot", "Notifications"],
        "GitHub inbox",
      ),
      marginBottom: 1,
    });
    this.root.add(this.title);

    this.threadList = new StatusList(renderer, {
      id: "notifications-thread-list",
      theme,
      onSelect: (item) => this.openThread(item.value),
    });
    this.root.add(this.threadList);

    this.statusBar = new TextRenderable(renderer, {
      id: "notifications-status-bar",
      content: t`${fg(theme.fgMuted)("Loading...")}`,
      marginTop: 1,
    });
    this.root.add(this.statusBar);

    addResponsiveHelpBar(renderer, this.root, {
      id: "notifications-help-bar",
      theme,
      entries: HELP,
    });

    renderer.root.add(this.root);
    renderer.keyInput.on("keypress", (key) => this.handleKeyPress(key));
    this.threadList.setActive(true);
  }

  /** Update the list and status bar with a new notification state snapshot. */
  update(state: GitNotificationState): void {
    this.state = state;
    this.syncHiddenThreads(state);
    this.threads = this.mergeOpenedThreads(state.threads);
    this.updateThreadList();
    this.updateTitle();
    this.updateStatusBar();
  }

  /** Show or hide the notifications view. */
  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.root.visible = visible;
    if (!visible || this.requestedInitialRefresh) return;
    this.requestedInitialRefresh = true;
    this.refresh();
  }

  /** Give keyboard focus to the notification list. */
  focus(): void {
    this.threadList.setActive(true);
  }

  /** Remove the notifications view from the render tree. */
  destroy(): void {
    this.renderer.root.remove(this.root);
  }

  private handleKeyPress(key: KeyEvent): void {
    if (!this.isVisible) return;
    this.keyHandlers[key.name]?.();
  }

  private refresh(): void {
    this.statusBar.content = t`${fg(this.theme.yellow)("Refreshing notifications...")}`;
    this.callbacks.onRefresh();
  }

  private applyAction(action: GitNotificationAction): void {
    const thread = this.threadList.getSelectedItem()?.value;
    if (!thread) {
      this.statusBar.content = t`${fg(this.theme.fgMuted)("No notification selected")}`;
      return;
    }

    this.statusBar.content = t`${fg(this.theme.yellow)(actionInProgress(action, thread.id))}`;
    if (action === "done") this.hideThread(thread);
    this.callbacks.onAction(action, thread);
  }

  private openThread(thread: GitNotificationThread): void {
    const key = threadKey(thread);
    this.openedThreadIds.add(key);
    this.openedThreads.set(key, thread);
    this.updateThreadList(key);
    this.updateTitle();
    this.updateStatusBar();
    this.callbacks.onOpenThread(thread);
  }

  private updateThreadList(preferredId?: string): void {
    this.threadList.setItems(
      this.threads.map((thread) => this.threadListItem(thread)),
      preferredId,
    );
  }

  private mergeOpenedThreads(
    threads: readonly GitNotificationThread[],
  ): readonly GitNotificationThread[] {
    const visibleThreads = threads.filter(
      (thread) => !this.hiddenThreadIds.has(threadKey(thread)),
    );
    const ids = new Set(visibleThreads.map(threadKey));
    const openedOnly = [...this.openedThreads.entries()]
      .filter(([id]) => !ids.has(id) && !this.hiddenThreadIds.has(id))
      .map(([, thread]) => thread);
    return [...visibleThreads, ...openedOnly];
  }

  private hideThread(thread: GitNotificationThread): void {
    const id = threadKey(thread);
    this.hiddenThreadIds.add(id);
    this.pendingHiddenThreadIds.add(id);
    this.openedThreadIds.delete(id);
    this.openedThreads.delete(id);
    this.threads = this.threads.filter((item) => threadKey(item) !== id);
    this.updateThreadList();
    this.updateTitle();
    this.updateStatusBar();
  }

  private syncHiddenThreads(state: GitNotificationState): void {
    const confirmedHiddenThreadIds = new Set(state.hiddenThreadIds);
    for (const id of confirmedHiddenThreadIds) {
      this.pendingHiddenThreadIds.delete(id);
    }
    if (!state.loading && state.loaded) {
      const visibleThreadIds = new Set(state.threads.map(threadKey));
      for (const id of this.pendingHiddenThreadIds) {
        if (!confirmedHiddenThreadIds.has(id) && visibleThreadIds.has(id)) {
          this.pendingHiddenThreadIds.delete(id);
        }
      }
    }
    this.hiddenThreadIds = new Set([
      ...confirmedHiddenThreadIds,
      ...this.pendingHiddenThreadIds,
    ]);
    for (const id of this.hiddenThreadIds) {
      this.openedThreadIds.delete(id);
      this.openedThreads.delete(id);
    }
  }

  private threadListItem(
    thread: GitNotificationThread,
  ): StatusListItem<GitNotificationThread> {
    return {
      id: threadKey(thread),
      title: `${formatNotificationIcon(thread)} ${thread.repo}: ${thread.title}`,
      description: formatNotificationThreadDetail(thread),
      color: this.threadColor(thread),
      value: thread,
    };
  }

  private threadColor(thread: GitNotificationThread): string {
    if (this.openedThreadIds.has(threadKey(thread))) return this.theme.green;
    if (!thread.unread) return this.theme.green;
    return notificationReasonIsImportant(thread.reason)
      ? this.theme.red
      : this.theme.yellow;
  }

  private updateTitle(): void {
    const unread = this.threads.filter((thread) =>
      this.isUnread(thread),
    ).length;
    const opened = this.visibleOpenedCount();
    const read = this.threads.filter((thread) => !this.isUnread(thread)).length;
    const subtitle =
      unread > 0
        ? `${unread} unread`
        : opened > 0
          ? `${opened} opened`
          : read > 0
            ? `${read} read`
            : "inbox clear";
    this.title.content = formatBreadcrumb(
      this.theme,
      ["Dot", "Notifications"],
      subtitle,
    );
  }

  private updateStatusBar(): void {
    if (!this.state) return;
    const th = this.theme;

    if (this.state.loading) {
      this.statusBar.content = t`${fg(th.yellow)("Refreshing notifications...")}`;
      return;
    }

    if (this.state.message) {
      this.statusBar.content = t`${fg(th.yellow)(this.state.message)}`;
      return;
    }

    if (this.threads.length === 0) {
      this.statusBar.content = t`${fg(th.green)("No GitHub notifications")}`;
      return;
    }

    const unread = this.threads.filter((thread) =>
      this.isUnread(thread),
    ).length;
    const opened = this.visibleOpenedCount();
    const read = this.threads.filter((thread) => !this.isUnread(thread)).length;
    const important = this.threads.filter(
      (thread) =>
        this.isUnread(thread) && notificationReasonIsImportant(thread.reason),
    ).length;
    const dot = important > 0 ? fg(th.red)("●") : fg(th.yellow)("●");
    const filters = notificationFilterText(this.state);
    this.statusBar.content = t`${fg(th.fgMuted)(`Last checked: ${formatNotificationTimeAgo(this.state.lastChecked.toISOString())}`)}${fg(th.fgMuted)(filters)}    ${dot}  ${fg(unread > 0 ? th.yellow : th.green)(`${unread} unread, ${read} read, ${opened} opened, ${important} important, ${this.threads.length} shown`)}`;
  }

  private isUnread(thread: GitNotificationThread): boolean {
    return thread.unread && !this.openedThreadIds.has(threadKey(thread));
  }

  private visibleOpenedCount(): number {
    return this.threads.filter((thread) =>
      this.openedThreadIds.has(threadKey(thread)),
    ).length;
  }
}

function threadKey(thread: GitNotificationThread): string {
  return thread.id || thread.webUrl;
}

function notificationFilterText(state: GitNotificationState): string {
  const parts = [
    state.query.all ? "all" : null,
    state.query.participating ? "participating" : null,
    state.query.since
      ? `since ${formatNotificationTimeAgo(state.query.since)}`
      : null,
    state.query.barFilter ? "bar filtered" : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? ` • ${parts.join(", ")}` : "";
}

function actionInProgress(
  action: GitNotificationAction,
  threadId: string,
): string {
  return `${ACTION_PROGRESS_LABEL[action]}: ${threadId}`;
}
