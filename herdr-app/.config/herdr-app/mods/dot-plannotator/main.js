// Plannotator for the focused agent: review the folder's changes or annotate
// the agent's last response. The runner waits on Plannotator in a background
// hc terminal and sends the feedback back to the agent.

import { focused, hc, home, notify } from "herdr";
import { ListPicker } from "./list.js";

export default class Plannotator extends ListPicker {
  get title() {
    return "Plannotator";
  }

  get placeholder() {
    return "Type to filter";
  }

  get empty() {
    return "Focus an agent's terminal first";
  }

  async load() {
    const terminal = focused()?.terminal;

    if (!terminal) return;

    const result = await hc(["get", terminal, "--json"]);

    if (result.code !== 0) throw new Error(result.stderr.trim() || `hc couldn't read ${terminal}`);

    const info = JSON.parse(result.stdout);
    this.terminal = info.address;
    this.cwd = info.cwd;
    this.session = Object.entries(info.records ?? {}).find(([, record]) => record.app === "opencode")?.[0];
    this.items = [
      { id: "review", label: "Review changes", detail: this.cwd },
      { id: "last", label: "Annotate the last response", detail: info.status?.title ?? "" },
    ];
  }

  pick(item) {
    const runner = `${home()}/.local/share/herdr-plugins/plannotator/runner.ts`;
    const args = [item.id, "--terminal", this.terminal];

    if (item.id === "last" && this.session) args.push("--session", this.session);

    void hc(["run", "--bg", "--rm", "--no-parent", "--cwd", this.cwd, "--", "bun", "run", runner, ...args]).then((result) => {
      if (result.code !== 0) notify({ title: "Plannotator didn't start", body: result.stderr.trim(), level: "error" });
    });
  }
}
