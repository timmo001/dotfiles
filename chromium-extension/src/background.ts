const HOST_NAME = "dev.timmo.dot_links";

const MENU_ID = "open-in-git-panel";

const GITHUB_PAGES = "https://github.com/*";

const CACHE_MS = 60_000;

/** What dot knows about a page: its `dot://` link and whether the Git panel lists it. */
interface PageState {
  readonly link: string | null;
  readonly listed: boolean;
}

const cache = new Map<string, { state: PageState; at: number }>();

const isGitHubPage = (url: string | undefined): url is string =>
  url?.startsWith("https://github.com/") === true;

/** The reply `dot link native-host` sends; dot owns both ends of this contract. */
type DotReply =
  | {
      readonly ok: true;
      readonly link?: string | null;
      readonly listed?: boolean;
    }
  | { readonly ok: false; readonly error: string };

async function sendToDot(message: {
  readonly type: "resolve" | "open";
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

async function resolvePage(url: string): Promise<PageState> {
  const cached = cache.get(url);

  if (cached && Date.now() - cached.at < CACHE_MS) return cached.state;

  const reply = await sendToDot({ type: "resolve", url });

  const state: PageState = {
    link: reply.link ?? null,
    listed: reply.listed === true,
  };

  cache.set(url, { state, at: Date.now() });

  return state;
}

function pageTitle(state: PageState | undefined): string {
  if (!state?.link) return "No Git panel link for this page";

  return state.listed ? "Open in the Git panel" : "Not in the Git panel";
}

async function refreshTab(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (tab?.id === undefined) return;

  let state: PageState | undefined;

  if (isGitHubPage(tab.url))
    try {
      state = await resolvePage(tab.url);
    } catch (error: unknown) {
      console.error("Could not ask dot about the page.", error);
    }

  const enabled = state?.listed === true;

  await (enabled
    ? chrome.action.enable(tab.id)
    : chrome.action.disable(tab.id));
  await chrome.action.setTitle({ tabId: tab.id, title: pageTitle(state) });

  if (tab.active)
    await chrome.contextMenus.update(MENU_ID, {
      enabled,
      title: pageTitle(state),
    });
}

async function refreshActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  await refreshTab(tab);
}

async function openInPanel(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!isGitHubPage(tab?.url)) return;

  cache.delete(tab.url);

  try {
    await sendToDot({ type: "open", url: tab.url });
  } catch (error: unknown) {
    console.error("Could not open the page in the Git panel.", error);
  }

  await refreshTab(tab);
}

function setUp(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Open in the Git panel",
      contexts: ["page", "frame", "selection", "link"],
      documentUrlPatterns: [GITHUB_PAGES],
      enabled: false,
    });

    void refreshActiveTab();
  });

  void chrome.action.disable();
}

chrome.runtime.onInstalled.addListener(setUp);

chrome.runtime.onStartup.addListener(setUp);

chrome.action.onClicked.addListener((tab) => void openInPanel(tab));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) void openInPanel(tab);
});

chrome.tabs.onActivated.addListener(() => void refreshActiveTab());

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.url !== undefined || change.status === "complete")
    void refreshTab(tab);
});

chrome.windows.onFocusChanged.addListener(() => void refreshActiveTab());
