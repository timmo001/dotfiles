/**
 * @file Keep stdout for one JSON document. Commands with `--json` send their
 * log lines, and the output of the commands they run, to stderr instead, then
 * print the result on the real stdout.
 */

let realStdout: ((text: string) => boolean) | null = null;

/** Whether stdout is reserved for a JSON result. */
export const stdoutReserved = (): boolean => realStdout !== null;

/** Send everything written to stdout to stderr until the JSON is printed. */
export function reserveStdout(): void {
  if (realStdout) return;

  const write = process.stdout.write.bind(process.stdout);
  realStdout = (text) => write(text);
  Reflect.set(
    process.stdout,
    "write",
    process.stderr.write.bind(process.stderr),
  );
}

/** Print a JSON document on the real stdout. */
export function printJson(json: string): void {
  const text = `${json}\n`;

  if (realStdout) realStdout(text);
  else process.stdout.write(text);
}
