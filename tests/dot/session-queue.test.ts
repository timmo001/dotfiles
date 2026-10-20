import { expect, test } from "bun:test";
import { Effect } from "../../dot/node_modules/effect/dist/index.js";
import { localDirectory, sessionTree } from "../../dot/src/lib/sessionQueue.js";

test("session tree lists every parent before its subagent sessions", async () => {
  const children = new Map([
    ["ses_root", ["ses_a", "ses_b"]],
    ["ses_a", ["ses_a1"]],
    ["ses_b", ["ses_b1", "ses_a"]],
    ["ses_a1", ["ses_a1x"]],
  ]);

  const order = await Effect.runPromise(
    sessionTree("ses_root", (id) => Effect.succeed(children.get(id) ?? [])),
  );

  expect(order).toEqual(["ses_root", "ses_a", "ses_b", "ses_a1", "ses_b1", "ses_a1x"]);
});

test("local directory follows the GitHub slug, not the sender's path", () => {
  const meta = {
    directory: "/home/desktop/src/dotfiles/dot",
    repository: { github: "timmo001/dotfiles", name: "dotfiles", subdirectory: "dot", branch: "main", head: "a1b2c3d", pushed: true },
  };

  const tracked = [
    { github: "timmo001/other", path: "/home/laptop/other", name: "Other" },
    { github: "timmo001/dotfiles", path: "/home/laptop/.config/dotfiles", name: "Dotfiles" },
  ];

  expect(localDirectory(meta, tracked)).toEqual({ directory: "/home/laptop/.config/dotfiles/dot", name: "Dotfiles" });
  expect(localDirectory({ ...meta, repository: { ...meta.repository, github: null } }, tracked)).toEqual({ directory: meta.directory, name: null });
});
