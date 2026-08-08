import type { PluginInput } from "@opencode-ai/plugin";

type Shell = PluginInput["$"];

export async function createDesktopNotifier($: Shell) {
  let canNotify: boolean | undefined;
  let originWindowAddress = "";
  const originHerdrTabID = process.env.HERDR_TAB_ID ?? "";

  try {
    const activeWindow = JSON.parse(
      await $`hyprctl activewindow -j`.text(),
    ) as {
      readonly address?: unknown;
    };
    if (
      typeof activeWindow.address === "string" &&
      /^0x[0-9a-f]+$/i.test(activeWindow.address)
    ) {
      originWindowAddress = activeWindow.address;
    }
  } catch {}

  return async (glyph: string, title: string, body: string) => {
    if (canNotify === undefined) {
      try {
        await $`sh -lc "command -v omarchy >/dev/null 2>&1"`;
        canNotify = true;
      } catch {
        canNotify = false;
      }
    }
    if (!canNotify) return;

    try {
      void $`omarchy notification send ${glyph} ${title} ${body} --app-name=OpenCode --action=default=Open`
        .text()
        .then(async (action) => {
          if (action.trim() === "default" && originWindowAddress) {
            await $`hyprctl dispatch focuswindow address:${originWindowAddress}`;
            if (originHerdrTabID) {
              await $`herdr tab focus ${originHerdrTabID}`;
            }
          }
        })
        .catch(() => {});
    } catch {}
  };
}
