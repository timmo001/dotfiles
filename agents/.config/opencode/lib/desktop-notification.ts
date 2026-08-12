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
      const focusCommand = originWindowAddress
        ? `hyprctl dispatch 'hl.dsp.focus({ window = "address:${originWindowAddress}" })'${
            /^[a-z0-9_:-]+$/i.test(originHerdrTabID)
              ? ` && herdr tab focus ${originHerdrTabID}`
              : ""
          }`
        : "";
      void $`omarchy notification send -g ${glyph} --app-name OpenCode ${focusCommand ? "--exec" : []} ${focusCommand ? focusCommand : []} ${title} ${body}`.catch(
        () => {},
      );
    } catch {}
  };
}
