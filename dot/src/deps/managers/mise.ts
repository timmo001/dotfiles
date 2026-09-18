import { Effect, Schema, Predicate, Record } from "effect";
import { parse } from "smol-toml";
import {
  DependencyDiscoveryError,
  type Dependency,
  type Extraction,
} from "../model.js";

const Tools = Schema.Struct({
  tools: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const Pin = Schema.Union([
  Schema.String,
  Schema.Struct({ version: Schema.String }),
]);

const upstreams = {
  bun: "oven-sh/bun",
  deno: "denoland/deno",
  go: "golang/go",
  node: "nodejs/node",
  uv: "astral-sh/uv",
  gh: "cli/cli",
  gum: "charmbracelet/gum",
  watchexec: "watchexec/watchexec",
  rust: "rust-lang/rust",
  python: "python/cpython",
  bat: "sharkdp/bat",
  eza: "eza-community/eza",
  fd: "sharkdp/fd",
  fzf: "junegunn/fzf",
  gdu: "dundee/gdu",
  jq: "jqlang/jq",
  lazygit: "jesseduffield/lazygit",
  pitchfork: "jdx/pitchfork",
  ripgrep: "BurntSushi/ripgrep",
  shellcheck: "koalaman/shellcheck",
  shfmt: "mvdan/sh",
  starship: "starship/starship",
  yarn: "yarnpkg/berry",
  usage: "jdx/usage",
  yq: "mikefarah/yq",
  zig: "ziglang/zig",
  zls: "zigtools/zls",
  zoxide: "ajeetdsouza/zoxide",
  just: "casey/just",
  hunk: "modem-dev/hunk",
};

/** Read backend-specific mise pins without executing mise or repository hooks. */
export const extractMise = Effect.fn("Dependencies.extractMise")(function* (
  file: string,
  text: string,
): Effect.fn.Return<Extraction, DependencyDiscoveryError> {
  const parsed = yield* Effect.try({
    try: () => parse(text),
    catch: () =>
      new DependencyDiscoveryError({ message: `Invalid mise TOML: ${file}` }),
  });

  const config = yield* Schema.decodeUnknownEffect(Tools)(parsed).pipe(
    Effect.mapError(
      () =>
        new DependencyDiscoveryError({
          message: `Invalid mise tools: ${file}`,
        }),
    ),
  );

  const dependencies: Dependency[] = [];
  const blockers: string[] = [];

  for (const [name, value] of Object.entries(config.tools ?? {})) {
    if (!Schema.is(Pin)(value)) {
      blockers.push(`${file}: unsupported mise pin for ${name}`);
      continue;
    }

    const current = Schema.is(Schema.String)(value) ? value : value.version;
    const [backend, ...parts] = name.split(":");
    const tool = parts.join(":");

    if (
      backend === "cargo" &&
      /^https:\/\/(?:github\.com|codeberg\.org)\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(
        tool,
      )
    ) {
      const digest = /^rev:([a-f\d]{7,40})$/i.exec(current)?.[1];
      dependencies.push({
        manager: "mise",
        file,
        name,
        package: tool,
        datasource: "git-refs",
        current: digest ? "HEAD" : current.replace(/^(?:branch|tag):/, ""),
        dependencyType: "tools",
        sourceUrl: tool.replace(/\.git$/, ""),
        ...Record.filter({ digest }, Predicate.isNotUndefined),
      });
      continue;
    }

    const repository = ["aqua", "github"].includes(backend)
      ? tool
      : Object.entries(upstreams).find(([tool]) => tool === name)?.[1];

    const crate = backend === "cargo" && !tool.includes(":");
    dependencies.push({
      manager: "mise",
      file,
      name,
      package: backend === "npm" || crate ? tool : (repository ?? name),
      datasource:
        backend === "npm"
          ? "npm"
          : crate
            ? "crate"
            : repository
              ? ["go", "python"].includes(name)
                ? "github-tags"
                : "github-releases"
              : name === "android-sdk"
                ? "android-sdk"
                : "unsupported-mise",
      current,
      dependencyType: "tools",
      ...Record.filter(
        {
          sourceUrl: repository
            ? `https://github.com/${repository}`
            : undefined,
          extractVersion: repository
            ? "(?:^|[^0-9])v?(?<version>[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$"
            : undefined,
        },
        Predicate.isNotUndefined,
      ),
    });
  }

  return { dependencies, blockers };
});
