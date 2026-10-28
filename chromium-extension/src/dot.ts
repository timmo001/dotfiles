const HOST_NAME = "dev.timmo.dot_links";

/** What dot knows about a page: its `dot://` link, whether the Git panel lists it, and its tracked checkout. */
export interface PageState {
  readonly link: string | null;
  readonly listed: boolean;
  readonly checkout: string | null;
}

/** The reply `dot link native-host` sends; dot owns both ends of this contract. */
type DotReply =
  | {
      readonly ok: true;
      readonly link?: string | null;
      readonly listed?: boolean;
      readonly checkout?: string | null;
    }
  | { readonly ok: false; readonly error: string };

export const isGitHubPage = (url: string | undefined): url is string =>
  url?.startsWith("https://github.com/") === true;

/** A pull request page, on any of its tabs, such as `/changes`. */
export const isPullRequestPage = (url: string | undefined): url is string =>
  url !== undefined &&
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#]|$)/.test(url);

/** A request dot runs for a page when one of its options is picked. */
export type PageAction = "open" | "review" | "agent" | "clear-deps";

/** One thing dot offers for a page, and why it's unavailable when it is. */
export interface PageOption {
  readonly action: PageAction;
  readonly label: string;
  readonly detail: string;
  readonly unavailable?: string;
  /** Shown instead of closing the popup, for options that carry on in the background. */
  readonly done?: string;
}

const itemName = (url: string) =>
  /\/issues\/\d+/.test(new URL(url).pathname) ? "issue" : "pull request";

const isNotificationsPage = (url: string) =>
  new URL(url).pathname.startsWith("/notifications");

function gitPanelReason(
  url: string,
  state: PageState | Error | undefined,
): string | undefined {
  if (state === undefined) return "Checking with dot…";

  if (state instanceof Error) return `Couldn't ask dot: ${state.message}`;

  if (!state.link) return "Only issues and pull requests open in the Git panel.";

  if (!state.listed)
    return `The Git panel doesn't list this ${itemName(url)}. It only shows items from repositories tracked in dot-git.yml.`;

  return undefined;
}

function agentReason(
  url: string,
  state: PageState | Error | undefined,
): string | undefined {
  if (state === undefined) return "Checking with dot…";

  if (state instanceof Error) return `Couldn't ask dot: ${state.message}`;

  if (!state.link) return "Agents start from issues and pull requests.";

  if (!state.checkout) {
    const [, owner, repo] = new URL(url).pathname.split("/");

    return `No tracked checkout of ${owner}/${repo} on this machine. Track it with dot repo induct first.`;
  }

  return undefined;
}

/** Everything dot offers for a GitHub page, shared by the popup and the right-click menu. */
export function pageOptions(
  url: string,
  state: PageState | Error | undefined,
): readonly PageOption[] {
  const checkout =
    state instanceof Error || !state?.checkout ? "its checkout" : state.checkout;

  return [
    {
      action: "open",
      label: "Open in the Git panel",
      detail: "Show it in the Git panel in the bar.",
      unavailable: gitPanelReason(url, state),
    },
    {
      action: "review",
      label: "Review in Plannotator",
      detail: "Review the diff, then post the review to GitHub.",
      unavailable: isPullRequestPage(url)
        ? undefined
        : "Only pull requests can be reviewed in Plannotator.",
    },
    {
      action: "agent",
      label: "Start an agent",
      detail: `Start OpenCode in ${checkout} on this ${itemName(url)}, using the repository's skills. The prompt depends on whether it's yours.`,
      unavailable: agentReason(url, state),
    },
    {
      action: "clear-deps",
      label: "Clear dependency notifications",
      detail:
        "Run the dependency notification clean-up now instead of waiting for its timer.",
      unavailable: isNotificationsPage(url)
        ? undefined
        : "Only on the notifications page.",
      done: "Clearing merged dependency updates in the background. Reload the page in a minute.",
    },
  ];
}

export async function sendToDot(message: {
  readonly type: "resolve" | PageAction;
  readonly url: string;
}): Promise<Extract<DotReply, { ok: true }>> {
  const reply: DotReply | undefined = await chrome.runtime.sendNativeMessage(
    HOST_NAME,
    message,
  );

  if (!reply) throw new Error("dot sent no reply");

  if (!reply.ok) throw new Error(reply.error);

  return reply;
}

export async function resolvePage(url: string): Promise<PageState> {
  const reply = await sendToDot({ type: "resolve", url });

  return {
    link: reply.link ?? null,
    listed: reply.listed === true,
    checkout: reply.checkout ?? null,
  };
}
