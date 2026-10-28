import { expect, test } from "bun:test";

// OpenCode gives plugins its own Effect at runtime and refuses any other copy,
// so the plugins must build against the same version or their imports drift.
const plugins = "agents/.config/opencode/plugins";

test("OpenCode plugins pin the Effect packages OpenCode runs", async () => {
  const manifest: { devDependencies: Record<string, string> } = await Bun.file(
    `${plugins}/package.json`,
  ).json();

  const lock: {
    packages: Record<
      string,
      [string, string, { dependencies?: Record<string, string> }]
    >;
  } = Bun.JSONC.parse(await Bun.file(`${plugins}/bun.lock`).text());

  const hostDependency = (owner: string, name: string) =>
    lock.packages[owner]?.[2].dependencies?.[name];

  expect(manifest.devDependencies.effect).toBe(
    hostDependency("@opencode/plugin", "effect"),
  );
  expect(manifest.devDependencies["@effect/platform-node"]).toBe(
    hostDependency("@opencode/util", "@effect/platform-node"),
  );

  // A dependency with its own Effect gets a nested copy that loads at runtime
  // against the host's, which typecheck can't catch, so overrides pin them.
  const nested = Object.keys(lock.packages).filter((key) =>
    /.\/(effect|@effect\/[^/]+)$/.test(key),
  );

  expect(nested).toEqual([]);
});
