/** Tool names per CLI command, for the commands that have a Code Mode namespace. */
export type CodeModeCatalogue = ReadonlyMap<string, ReadonlySet<string>>;

const SUBCOMMAND = /^[a-z][a-z0-9-]*$/;

/**
 * The Code Mode tools that cover a shell command, such as `tools.gh.release_view` for
 * `gh release view 1.0 --repo x`. Each segment of a chained or piped command is checked, and the
 * longest run of its leading subcommand words that names a tool wins.
 */
export const codeModeTools = (command: string, catalogue: CodeModeCatalogue): readonly string[] => {
  const found = command.split(/&&|\|\||[;|\n]/).flatMap((segment) => {
    const tokens = segment.trim().split(/\s+/).filter((token) => !/^\w+=/.test(token));
    const executable = tokens[0]?.split("/").pop() ?? "";
    const tools = catalogue.get(executable);

    if (!tools) return [];

    const words = tokens
      .slice(1)
      .filter((token) => SUBCOMMAND.test(token))
      .slice(0, 3)
      .map((word) => word.replaceAll("-", "_"));

    for (let length = words.length; length > 0; length--) {
      const name = words.slice(0, length).join("_");

      if (tools.has(name))
        return [/^\w+$/.test(executable) ? `tools.${executable}.${name}` : `tools["${executable}"].${name}`];
    }

    return [];
  });

  return [...new Set(found)];
};
