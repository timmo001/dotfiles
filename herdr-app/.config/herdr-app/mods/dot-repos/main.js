// Open or go to a repository's space, from the list `dot stow` caches.

import { readTextFile, home, spaces, run } from "herdr";
import { ListPicker } from "./list.js";

export default class Repos extends ListPicker {
  get title() {
    return "Open a repository";
  }

  get placeholder() {
    return "Type to filter repositories";
  }

  get empty() {
    return "No repositories cached. Run: dot stow";
  }

  async load() {
    const root = home();
    const cached = await readTextFile(`${root}/.cache/dot/repo-picker.json`);
    const repos = cached ? JSON.parse(cached) : [];
    const seen = new Set();

    this.items = [
      { name: "Home", path: root },
      { name: "Dump", path: `${root}/dump` },
      { name: "Repos", path: `${root}/repos` },
      ...repos,
    ].flatMap((repo) => {
      if (seen.has(repo.path)) return [];

      seen.add(repo.path);

      return [{ id: repo.path, label: repo.name, detail: repo.path.replace(root, "~") }];
    });
  }

  pick(item) {
    const local = spaces().filter((space) => !space.machine);
    const space = local.find((space) => space.name === item.label) ?? local.find((space) => space.folder === item.id);

    if (space) run("space.select", { id: space.id });
    else run("space.new", { name: item.label, folder: item.id, machine: "" });
  }
}
