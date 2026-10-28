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

export async function sendToDot(message: {
  readonly type: "resolve" | "open" | "review" | "agent" | "clear-deps";
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
