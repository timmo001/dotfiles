import {
  type PageAction,
  type PageState,
  isGitHubPage,
  pageOptions,
  resolvePage as askDot,
  sendToDot,
} from "./dot";

const GITHUB_PAGES = "https://github.com/*";

const CACHE_MS = 60_000;

const cache = new Map<string, { state: PageState; at: number }>();

/** The popup's options, whose labels don't depend on the page, used as the right-click menu items. */
const MENU_OPTIONS = pageOptions("https://github.com/", undefined);

const isPageAction = (id: string | number): id is PageAction =>
  MENU_OPTIONS.some((option) => option.action === id);

async function resolvePage(url: string): Promise<PageState> {
  const cached = cache.get(url);

  if (cached && Date.now() - cached.at < CACHE_MS) return cached.state;

  const state = await askDot(url);

  cache.set(url, { state, at: Date.now() });

  return state;
}

async function refreshTab(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (tab?.id === undefined) return;

  if (!isGitHubPage(tab.url)) {
    await chrome.action.disable(tab.id);
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "dot links only works on GitHub pages",
    });

    return;
  }

  await chrome.action.enable(tab.id);
  await chrome.action.setTitle({ tabId: tab.id, title: "dot links" });

  let state: PageState | Error;

  try {
    state = await resolvePage(tab.url);
  } catch (error: unknown) {
    console.error("Could not ask dot about the page.", error);
    state = error instanceof Error ? error : new Error(String(error));
  }

  if (!tab.active) return;

  await Promise.all(
    pageOptions(tab.url, state).map((option) =>
      chrome.contextMenus.update(option.action, {
        visible: option.unavailable === undefined,
      }),
    ),
  );
}

async function refreshActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  await refreshTab(tab);
}

async function runAction(
  action: PageAction,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (!isGitHubPage(tab?.url)) return;

  if (action === "open") cache.delete(tab.url);

  try {
    await sendToDot({ type: action, url: tab.url });
  } catch (error: unknown) {
    console.error(`Could not run ${action} for the page.`, error);
  }

  if (action === "open") await refreshTab(tab);
}

function setUp(): void {
  chrome.contextMenus.removeAll(() => {
    for (const option of MENU_OPTIONS)
      chrome.contextMenus.create({
        id: option.action,
        title: option.label,
        contexts: ["page", "frame", "selection", "link"],
        documentUrlPatterns: [GITHUB_PAGES],
        visible: false,
      });

    void refreshActiveTab();
  });

  void chrome.action.disable();
}

chrome.runtime.onInstalled.addListener(setUp);

chrome.runtime.onStartup.addListener(setUp);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (isPageAction(info.menuItemId)) void runAction(info.menuItemId, tab);
});

chrome.tabs.onActivated.addListener(() => void refreshActiveTab());

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.url !== undefined || change.status === "complete")
    void refreshTab(tab);
});

chrome.windows.onFocusChanged.addListener(() => void refreshActiveTab());
