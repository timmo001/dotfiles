import type { Extraction, Dependency, TreeEntry } from "../model.js";

/** Extract gitlinks and their configured branch without initialising submodules. */
export function extractSubmodules(
  file: string,
  text: string,
  tree: readonly TreeEntry[],
): Extraction {
  const dependencies: Dependency[] = [];
  const blockers: string[] = [];

  for (const section of text.split(/(?=^\s*\[submodule\s)/m)) {
    const path = /^\s*path\s*=\s*(.+)$/m.exec(section)?.[1]?.trim();
    const url = /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1]?.trim();

    if (!path || !url) continue;

    const repository =
      /^(?:https:\/\/github\.com\/|git@github\.com:)(.+?)(?:\.git)?$/.exec(
        url,
      )?.[1];

    const digest = tree.find(
      (entry) => entry.path === path && entry.mode === "160000",
    )?.sha;

    const branch =
      /^\s*branch\s*=\s*(.+)$/m.exec(section)?.[1]?.trim() ?? "HEAD";

    if (!repository || !digest || branch === ".") {
      blockers.push(
        `${file}: unresolved submodule source or gitlink for ${path}`,
      );
      continue;
    }

    dependencies.push({
      manager: "git-submodules",
      file: path,
      name: path,
      package: url,
      datasource: "git-refs",
      current: branch,
      digest,
      sourceUrl: `https://github.com/${repository}`,
      dependencyType: "submodule",
    });
  }

  return { dependencies, blockers };
}
