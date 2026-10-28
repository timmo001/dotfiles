import {
  type PageState,
  isGitHubPage,
  isPullRequestPage,
  resolvePage,
  sendToDot,
} from "./dot";

/** One thing the popup offers for the page, and why it's unavailable when it is. */
interface PageOption {
  readonly label: string;
  readonly detail: string;
  readonly unavailable?: string;
  /** Shown instead of closing the popup, for options that carry on in the background. */
  readonly done?: string;
  readonly run: () => Promise<void>;
}

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id);

  if (!(found instanceof type)) throw new Error(`Missing #${id}`);

  return found;
};

const options = element("options", HTMLUListElement);
const status = element("status", HTMLParagraphElement);

function showStatus(message: string, state: "info" | "error" = "info"): void {
  status.textContent = message;
  status.dataset.state = state;
}

const itemName = (url: string) =>
  /\/issues\/\d+/.test(new URL(url).pathname) ? "issue" : "pull request";

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

const isNotificationsPage = (url: string) =>
  new URL(url).pathname.startsWith("/notifications");

async function runOption(
  option: PageOption,
  url: string,
  state: PageState | Error | undefined,
): Promise<void> {
  try {
    await option.run();
  } catch (error: unknown) {
    showStatus(error instanceof Error ? error.message : String(error), "error");
    render(url, state);

    return;
  }

  if (!option.done) {
    window.close();

    return;
  }

  showStatus(option.done);
  render(url, state);
}

function render(url: string, state: PageState | Error | undefined): void {
  const checkout =
    state instanceof Error || !state?.checkout ? "its checkout" : state.checkout;

  const pageOptions: PageOption[] = [
    {
      label: "Open in the Git panel",
      detail: "Show it in the Git panel in the bar.",
      unavailable: gitPanelReason(url, state),
      run: async () => {
        await sendToDot({ type: "open", url });
      },
    },
    {
      label: "Review in Plannotator",
      detail: "Review the diff, then post the review to GitHub.",
      unavailable: isPullRequestPage(url)
        ? undefined
        : "Only pull requests can be reviewed in Plannotator.",
      run: async () => {
        await sendToDot({ type: "review", url });
      },
    },
    {
      label: "Start an agent",
      detail: `Start OpenCode in ${checkout} on this ${itemName(url)}, using the repository's skills. The prompt depends on whether it's yours.`,
      unavailable: agentReason(url, state),
      run: async () => {
        await sendToDot({ type: "agent", url });
      },
    },
    {
      label: "Clear dependency notifications",
      detail:
        "Run the dependency notification clean-up now instead of waiting for its timer.",
      unavailable: isNotificationsPage(url)
        ? undefined
        : "Only on the notifications page.",
      done: "Clearing merged dependency updates in the background. Reload the page in a minute.",
      run: async () => {
        await sendToDot({ type: "clear-deps", url });
      },
    },
  ];

  options.replaceChildren(
    ...pageOptions.map((option) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const label = document.createElement("span");
      const detail = document.createElement("span");

      label.className = "label";
      label.textContent = option.label;
      detail.className = "detail";
      detail.textContent = option.unavailable ?? option.detail;

      button.type = "button";
      button.disabled = option.unavailable !== undefined;
      button.append(label, detail);
      button.addEventListener("click", () => {
        showStatus(`${option.label}…`);

        for (const other of options.querySelectorAll("button"))
          other.disabled = true;

        void runOption(option, url, state);
      });

      item.append(button);

      return item;
    }),
  );
}

async function start(): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  const url = tab?.url;

  if (!isGitHubPage(url)) {
    showStatus("dot links only works on GitHub pages.");

    return;
  }

  render(url, undefined);

  let state: PageState | Error;

  try {
    state = await resolvePage(url);
  } catch (error: unknown) {
    state = error instanceof Error ? error : new Error(String(error));
  }

  render(url, state);
}

void start();
