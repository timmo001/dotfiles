// Run one of the focused folder's local mise tasks in a new tab.

import { exec, focused, spaces, run } from "herdr";
import { ListPicker } from "./list.js";

export default class Tasks extends ListPicker {
  get title() {
    return "Run a mise task";
  }

  get placeholder() {
    return "Type to filter tasks";
  }

  get empty() {
    return `No local mise tasks in ${this.folder}`;
  }

  async load() {
    const now = focused();
    const space = spaces().find((space) => space.id === now?.space);
    this.folder = now?.cwd || space?.folder || ".";
    this.machine = space?.machine ?? null;
    const result = await exec("mise", ["tasks", "--json", "--local"], { cwd: this.folder, on: this.machine });

    if (result.code !== 0) throw new Error(`No trusted mise configuration in ${this.folder}`);

    this.items = JSON.parse(result.stdout).map((task) => ({ id: task.name, label: task.name, detail: task.description }));
  }

  pick(item) {
    run("tab.new", { name: item.id, folder: this.folder, argv: ["mise", "run", item.id] });
  }
}
