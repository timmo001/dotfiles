/** Wait for one keypress, restoring the previous stdin raw-mode state. */
export function waitForKeypress(message: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stdout.write(message);
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve();
    });
  });
}
