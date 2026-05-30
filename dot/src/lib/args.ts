/** Return whether an option is present as `--flag` or `--flag=value`. */
export function hasOption(args: readonly string[], name: string): boolean {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
}

/** Return an option value from `--flag value` or `--flag=value` forms. */
export function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsArg = args.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsArg) return equalsArg.slice(equalsPrefix.length);

  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}
