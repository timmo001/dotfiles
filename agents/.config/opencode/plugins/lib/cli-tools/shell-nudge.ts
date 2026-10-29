/** Tool names per CLI command, for the commands that have a Code Mode namespace, and whether each takes a directory input. */
export type CodeModeCatalogue = ReadonlyMap<string, ReadonlyMap<string, boolean>>;

/** One command in a pipeline: its executable, the words after it, the stage's raw text and whether its statement follows `||`. */
interface Stage {
  readonly executable: string;
  readonly args: readonly string[];
  readonly text: string;
  readonly fallback: boolean;
}

const SUBCOMMAND = /^[a-z][a-z0-9-]*$/;

/**
 * Split a shell command into statements (joined by `&&`, `||`, `;` or newlines), each a pipeline
 * of stages. Quoted strings are blanked first, so their contents never look like shell syntax, and
 * a heredoc's body is dropped.
 */
const parse = (command: string): readonly (readonly Stage[])[] => {
  const head = command.includes("<<") ? command.split("\n")[0] ?? "" : command;
  const unquoted = head.replaceAll(/'[^']*'/g, "''").replaceAll(/"(?:\\.|[^"\\])*"/g, '""');

  // Splitting on a capture group keeps each separator just before the statement it introduces.
  const parts = unquoted.split(/(&&|\|\||[;\n])/);

  return parts
    .flatMap((statement, index) => (index % 2 === 0 ? [{ statement, fallback: parts[index - 1] === "||" }] : []))
    .map(({ statement, fallback }) =>
      statement
        .split("|")
        .map((text) => {
          const tokens = text.trim().split(/\s+/).filter((token) => token !== "" && !/^\w+=/.test(token));

          return { executable: tokens[0]?.split("/").pop() ?? "", args: tokens.slice(1), text, fallback };
        })
        .filter((stage) => stage.executable !== ""),
    )
    .filter((stages) => stages.length > 0);
};

const toolPath = (namespace: string, tool: string) =>
  /^\w+$/.test(namespace) ? `tools.${namespace}.${tool}` : `tools["${namespace}"].${tool}`;

const SYSTEMCTL = new Map([
  ["status", "unit_status"],
  ["is-active", "unit_status"],
  ["is-enabled", "unit_status"],
  ["is-failed", "unit_status"],
  ["show", "unit_show"],
  ["cat", "unit_cat"],
  ["start", "unit_start"],
  ["stop", "unit_stop"],
  ["restart", "unit_restart"],
  ["enable", "unit_enable"],
  ["disable", "unit_disable"],
  ["list-units", "unit_list"],
  ["list-unit-files", "unit_files"],
  ["list-timers", "timer_list"],
  ["daemon-reload", "daemon_reload"],
]);

// `pacman -Q` flags in the order they decide the tool; plain queries list packages.
const PACMAN_QUERY = [
  ["o", "owner"],
  ["s", "search"],
  ["l", "files"],
  ["u", "outdated"],
  ["i", "info"],
] as const;

const HYPRLAND_STATE = new Set([
  "activewindow",
  "activeworkspace",
  "binds",
  "clients",
  "configerrors",
  "devices",
  "getoption",
  "layers",
  "monitors",
  "workspaces",
]);

const PACKAGE_MANAGERS = new Set(["pnpm", "bun", "npm", "aube", "yarn"]);

/** Shorthand executables for one package manager tool. */
const PACKAGE_MANAGER_SHORTHANDS = new Map<string, readonly [string, string]>([
  ["npx", ["npm", "exec"]],
  ["bunx", ["bun", "exec"]],
  ["aubr", ["aube", "run"]],
  ["aubx", ["aube", "exec"]],
]);

const PACKAGE_MANAGER_COMMANDS = new Map([
  ["i", "install"],
  ["ci", "install"],
  ["rm", "remove"],
  ["un", "remove"],
  ["uninstall", "remove"],
  ["explain", "why"],
  ["run-script", "run"],
  ["x", "exec"],
]);

/** The tool for commands whose tool names don't follow their subcommand words. */
const aliasTool = ({ executable, args }: Stage): readonly [string, string] | undefined => {
  const word = args.find((arg) => SUBCOMMAND.test(arg));

  if (executable === "systemctl" && args.includes("--user"))
    return ["systemd", word === undefined ? "unit_list" : (SYSTEMCTL.get(word) ?? "")];

  if (executable === "journalctl" && args.some((arg) => arg.startsWith("--user"))) return ["systemd", "logs"];

  if (executable === "pacman") {
    const operation = args.find((arg) => /^-[QS][a-zA-Z]*$/.test(arg));

    if (operation?.startsWith("-S"))
      return /s/.test(operation) ? ["pacman", "search"] : /i/.test(operation) ? ["pacman", "info"] : undefined;

    if (operation?.startsWith("-Q")) {
      const tool = PACMAN_QUERY.find(([flag]) => operation.slice(2).includes(flag));

      return ["pacman", tool?.[1] ?? "list"];
    }
  }

  if (executable === "hyprctl" && word !== undefined) {
    if (HYPRLAND_STATE.has(word)) return ["system-bridge", "hyprland"];

    if (word === "keyword") return ["system-bridge", "hyprland_set_option"];
  }

  const shorthand = PACKAGE_MANAGER_SHORTHANDS.get(executable);

  if (shorthand !== undefined) return shorthand;

  if (PACKAGE_MANAGERS.has(executable)) {
    const first = args.find((arg) => !arg.startsWith("-"));

    if (first === undefined) return undefined;

    // `bun test` is bun's own test runner; elsewhere `test` and `lint:types` run scripts.
    if (executable !== "bun" && (first === "test" || first === "t" || first.includes(":"))) return [executable, "run"];

    const tool = PACKAGE_MANAGER_COMMANDS.get(first);

    if (tool !== undefined) return [executable, tool];
  }

  return undefined;
};

/** One Code Mode tool that covers a shell command. */
interface Covering {
  readonly path: string;
  readonly directory: boolean;
}

/** The tool named by the longest run of a stage's leading subcommand words, such as `release_view` for `gh release view`. */
const subcommandTool = (stage: Stage, tools: ReadonlyMap<string, boolean>): string | undefined => {
  const words = stage.args
    .filter((arg) => SUBCOMMAND.test(arg))
    .slice(0, 3)
    .map((word) => word.replaceAll("-", "_"));

  for (let length = words.length; length > 0; length--) {
    const name = words.slice(0, length).join("_");

    if (tools.has(name)) return name;
  }

  return undefined;
};

/**
 * The Code Mode tools that cover a shell command, such as `tools.gh.release_view` for
 * `gh release view 1.0 --repo x`. Each stage of a chained or piped command is checked: known
 * aliases first, then the longest run of its leading subcommand words that names a tool.
 */
const codeModeTools = (stages: readonly Stage[], catalogue: CodeModeCatalogue): readonly Covering[] => {
  const found = stages.flatMap((stage): Covering[] => {
    const alias = aliasTool(stage);

    if (alias !== undefined) {
      const directory = catalogue.get(alias[0])?.get(alias[1]);

      return directory === undefined ? [] : [{ path: toolPath(...alias), directory }];
    }

    const tools = catalogue.get(stage.executable);
    const name = tools === undefined ? undefined : subcommandTool(stage, tools);

    return name === undefined ? [] : [{ path: toolPath(stage.executable, name), directory: tools?.get(name) ?? false }];
  });

  return [...new Map(found.map((tool) => [tool.path, tool])).values()];
};

// A redirect to a file, not to another descriptor or /dev/null.
const FILE_REDIRECT = /(?:^|[^>])>{1,2}(?!&)\s*(?!\/dev\/null)\S/;

const SEARCH = new Set(["rg", "grep", "egrep", "find", "fd", "ls", "tree"]);
const READ = new Set(["cat", "head", "tail", "less", "more", "bat"]);
const PRINT = new Set(["echo", "printf"]);

const isFileWrite = ({ executable, args, text }: Stage) =>
  (executable === "sed" && args.some((arg) => /^-\w*i|^--in-place/.test(arg))) ||
  (executable === "perl" && args.some((arg) => /^-\w*i/.test(arg))) ||
  executable === "tee" ||
  ((READ.has(executable) || PRINT.has(executable)) && FILE_REDIRECT.test(text));

const isFileRead = ({ executable, args }: Stage) =>
  (READ.has(executable) && !args.some((arg) => /^-[fF]$|^--follow/.test(arg))) ||
  (executable === "sed" && args.includes("-n"));

/** The AGENTS.md shell rules a command breaks, as short hints. */
const shellRuleHints = (statements: readonly (readonly Stage[])[]): readonly string[] => {
  const stages = statements.flat();
  const first = statements.flatMap((pipeline) => pipeline.slice(0, 1));
  const piped = statements.flatMap((pipeline) => pipeline.slice(1));
  const writes = stages.filter(isFileWrite);

  return [
    first.some((stage) => SEARCH.has(stage.executable)) &&
      "search and list with the grep, glob and read tools, not rg, grep, find or ls",
    first.some((stage) => !isFileWrite(stage) && isFileRead(stage)) &&
      "read files with the read tool, not cat, head, tail or sed -n",
    writes.length > 0 && "change files with edit or write, not sed -i, perl -pi or shell redirects",
    statements.length > 1 && first[0]?.executable === "cd" && "set the workdir parameter instead of cd x &&",
    statements.length > 1 &&
      first.some((stage) => PRINT.has(stage.executable) && !stage.fallback && !isFileWrite(stage)) &&
      "make separate tool calls instead of gluing commands together with echo",
    (piped.some((stage) => stage.executable === "head" || stage.executable === "tail") ||
      stages.some((stage) => !writes.includes(stage) && FILE_REDIRECT.test(stage.text))) &&
      "let output print: the harness shortens long output, so don't cut it with head or tail or redirect it to a file",
  ].filter((hint) => hint !== false);
};

/**
 * The note to add to a shell command's output when Code Mode or a dedicated tool covers it.
 * `directory` is the shell's workdir when it isn't the session's: only tools that take a directory
 * can run there, so those are suggested with it and the rest are left out.
 */
export const shellNudge = (
  command: string,
  catalogue: CodeModeCatalogue,
  directory?: string,
): string | undefined => {
  const statements = parse(command);
  const tools = codeModeTools(statements.flat(), catalogue).filter((tool) => directory === undefined || tool.directory);
  const hints = shellRuleHints(statements);

  const lines = [
    tools.length > 0 &&
      `cli-tools: Code Mode covers this command (${tools.map((tool) => tool.path).join(", ")}${
        directory === undefined ? "" : ` with directory: ${JSON.stringify(directory)}`
      }). Call it through execute instead of the shell next time, even when a skill or prompt quotes the CLI.`,
    hints.length > 0 && `cli-tools: next time, ${hints.join("; ")}.`,
  ].filter((line) => line !== false);

  return lines.length > 0 ? lines.join("\n") : undefined;
};

/** Whether a shell command runs `dot update`, which reloads the OpenCode service running the shell. */
export const runsDotUpdate = (command: string) =>
  parse(command).some((pipeline) =>
    pipeline.some(
      ({ executable, args }) =>
        executable === "dot" && args[0] === "update" && !args.includes("--help") && !args.includes("-h"),
    ),
  );

/** The long flags, without their `--`, that each dot Code Mode tool takes, by tool name. */
export type DotToolFlags = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * The Code Mode tools for the dot commands in a shell command, such as `tools.dot.repo_list` for
 * `dot repo list`. A help request, or a flag the tool doesn't take, leaves that command to the
 * shell.
 */
export const dotCommandTools = (command: string, catalogue: CodeModeCatalogue, flags: DotToolFlags): readonly string[] => {
  const tools = catalogue.get("dot");

  if (tools === undefined) return [];

  const found = parse(command)
    .flat()
    .flatMap((stage) => {
      if (stage.executable !== "dot") return [];

      const name = subcommandTool(stage, tools);
      const accepted = name === undefined ? undefined : flags.get(name);

      if (name === undefined || accepted === undefined) return [];

      const covered = stage.args
        .filter((arg) => arg.startsWith("-"))
        .every((arg) => arg.startsWith("--") && accepted.has(arg.slice(2).split("=")[0] ?? ""));

      return covered ? [toolPath("dot", name)] : [];
    });

  return [...new Set(found)];
};
