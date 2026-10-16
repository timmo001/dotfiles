import { Effect } from "effect";
import {
  gitItemFromGitHubUrl,
  gitItemKey,
  gitItemLink,
  gitItemPanelMarkdown,
  listedGitItems,
} from "../git/itemLinks.js";
import { isAgent } from "../lib/agent.js";

/**
 * `dot link git`: the `dot://` link for each GitHub issue or pull request URL,
 * whether the Git panel lists it, and the icon link to put after the GitHub
 * link when it does. Prints JSON with `json` or under an AI agent.
 */
export const linkGit = Effect.fn("linkGit")(function* (options: {
  readonly urls: readonly string[];
  readonly json: boolean;
}) {
  const parsed = options.urls.map((url) => ({
    url,
    item: gitItemFromGitHubUrl(url),
  }));

  const listed = yield* listedGitItems(
    parsed.flatMap(({ item }) => (item ? [item] : [])),
  );

  const results = parsed.map(({ url, item }) => {
    const inPanel = item !== undefined && listed.has(gitItemKey(item));

    return {
      url,
      link: item ? gitItemLink(item) : null,
      listed: inPanel,
      markdown: item && inPanel ? gitItemPanelMarkdown(item) : null,
    };
  });

  if (options.json || isAgent()) {
    process.stdout.write(`${JSON.stringify(results)}\n`);

    return;
  }

  for (const result of results)
    process.stdout.write(
      `${result.url}  ${
        result.markdown ??
        (result.link
          ? "not listed in the Git panel"
          : "not a GitHub issue or pull request")
      }\n`,
    );
});
