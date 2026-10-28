import {
  type PageOption,
  type PageState,
  isGitHubPage,
  pageOptions,
  resolvePage,
  sendToDot,
} from "./dot";

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

async function runOption(
  option: PageOption,
  url: string,
  state: PageState | Error | undefined,
): Promise<void> {
  try {
    await sendToDot({ type: option.action, url });
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
  options.replaceChildren(
    ...pageOptions(url, state).map((option) => {
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
