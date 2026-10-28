import {
  type PageState,
  isGitHubPage,
  resolvePage as askDot,
  sendToDot,
} from "./dot";

const MENU_ID = "open-in-git-panel";

const REVIEW_MENU_ID = "review-in-plannotator";

const GITHUB_PAGES = "https://github.com/*";

const GITHUB_PULL_PAGES = "https://github.com/*/*/pull/*";

const CACHE_MS = 60_000;

const cache = new Map<string, { state: PageState; at: number }>();

async function resolvePage(url: string): Promise<PageState> {
  const cached = cache.get(url);

  if (cached && Date.now() - cached.at < CACHE_MS) return cached.state;

  const state = await askDot(url);

  cache.set(url, { state, at: Date.now() });

  return state;
}

function pageTitle(state: PageState | undefined): string {
  if (!state?.link) return "No Git panel link for this page";

  return state.listed ? "Open in the Git panel" : "Not in the Git panel";
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

  let state: PageState | undefined;

  try {
    state = await resolvePage(tab.url);
  } catch (error: unknown) {
    console.error("Could not ask dot about the page.", error);
  }

  if (tab.active)
    await chrome.contextMenus.update(MENU_ID, {
      enabled: state?.listed === true,
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

async function reviewInPlannotator(
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (!isGitHubPage(tab?.url)) return;

  try {
    await sendToDot({ type: "review", url: tab.url });
  } catch (error: unknown) {
    console.error("Could not open the pull request in Plannotator.", error);
  }
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

    chrome.contextMenus.create({
      id: REVIEW_MENU_ID,
      title: "Review in Plannotator",
      contexts: ["page", "frame", "selection", "link"],
      documentUrlPatterns: [GITHUB_PULL_PAGES],
    });

    void refreshActiveTab();
  });

  void chrome.action.disable();
}

chrome.runtime.onInstalled.addListener(setUp);

chrome.runtime.onStartup.addListener(setUp);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) void openInPanel(tab);

  if (info.menuItemId === REVIEW_MENU_ID) void reviewInPlannotator(tab);
});

chrome.tabs.onActivated.addListener(() => void refreshActiveTab());

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.url !== undefined || change.status === "complete")
    void refreshTab(tab);
});

chrome.windows.onFocusChanged.addListener(() => void refreshActiveTab());
