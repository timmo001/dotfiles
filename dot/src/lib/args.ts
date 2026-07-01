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

/**
 * Collect every value for a repeatable option, accepting both `--flag value`
 * and `--flag=value` forms. Order is preserved and empty values are dropped.
 */
export function optionValues(
  args: readonly string[],
  name: string,
): readonly string[] {
  const equalsPrefix = `${name}=`;
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === name) {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        values.push(next);
        index++;
      }
    } else if (arg.startsWith(equalsPrefix)) {
      const value = arg.slice(equalsPrefix.length);
      if (value) values.push(value);
    }
  }
  return values;
}
