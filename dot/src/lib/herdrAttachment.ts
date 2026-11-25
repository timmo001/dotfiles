import { Effect, FileSystem, Schema } from "effect";
import { basename, dirname, extname, join } from "node:path";
import { CommandExecutor } from "../services/CommandExecutor.js";

const ProcessRow = Schema.Tuple([
  Schema.FiniteFromString,
  Schema.FiniteFromString,
  Schema.FiniteFromString,
  Schema.FiniteFromString,
  Schema.String,
]);

class HerdrAttachmentError extends Schema.TaggedError<HerdrAttachmentError>()(
  "HerdrAttachmentError",
  {
    message: Schema.String,
  },
) {}

function interactiveClient(args: readonly string[]): boolean {
  const positional: string[] = [];

  for (let index = 1; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--session") {
      if (!args[++index]) return false;
    } else if (arg.startsWith("--session=")) {
      if (!arg.slice("--session=".length)) return false;
    } else if (arg !== "--handoff") {
      if (arg.startsWith("-")) return false;
      positional.push(arg);
    }
  }

  return (
    positional.length === 0 ||
    (positional.length === 3 &&
      positional[0] === "session" &&
      positional[1] === "attach" &&
      positional[2] !== "")
  );
}

/** The bridge a `herdr --remote` or saved-machine client on another machine attaches through over SSH. */
function remoteClientBridge(args: readonly string[]): boolean {
  return args[1] === "remote-client-bridge";
}

/** Which Herdr clients count as attached. */
export interface HerdrAttachmentOptions {
  /** Also count a client attached from another machine through `herdr remote-client-bridge`. */
  readonly remote?: boolean;
}

/**
 * Check for a local foreground Herdr terminal connected to this API socket's
 * client peer, or with `remote`, a client attached from another machine.
 */
export const localHerdrAttachment = Effect.fn("localHerdrAttachment")(
  function* (socketPath: string, options: HerdrAttachmentOptions = {}) {
    const executor = yield* CommandExecutor;
    const fs = yield* FileSystem.FileSystem;

    const clientSocket = join(
      dirname(socketPath),
      `${basename(socketPath, extname(socketPath))}-client.sock`,
    );

    const connections = yield* executor.run("ss", [
      "-xHn",
      "state",
      "connected",
      "src",
      clientSocket,
    ]);

    const peers = new Set<string>();

    for (const line of connections.trim().split("\n").filter(Boolean)) {
      const match =
        /^u_str\s+ESTAB\s+\d+\s+\d+\s+(.+)\s+\d+\s+\*\s+(\d+)\s*$/.exec(line);

      if (!match || match[1].trim() !== clientSocket)
        return yield* new HerdrAttachmentError({
          message: "Cannot read Herdr client socket connections",
        });
      peers.add(`socket:[${match[2]}]`);
    }

    if (peers.size === 0) return false;

    const processes = yield* executor
      .run("ps", ["-C", "herdr", "-o", "pid=,pgid=,tpgid=,euid=,tty="])
      .pipe(
        Effect.catchTag("CommandError", (error) =>
          error.exitCode === 1 && !error.stderr.trim()
            ? Effect.succeed("")
            : Effect.fail(error),
        ),
      );

    for (const line of processes.trim().split("\n").filter(Boolean)) {
      const [pid, group, foreground, uid, tty] =
        yield* Schema.decodeUnknownEffect(ProcessRow)(line.trim().split(/\s+/));

      if (uid !== process.getuid?.()) continue;

      // A remote client's bridge runs under sshd with no terminal of its own.
      const local = group === foreground && tty !== "?";

      if (!local && !options.remote) continue;

      const attached = yield* Effect.gen(function* () {
        const executable = yield* fs.readLink(`/proc/${pid}/exe`);

        if (basename(executable.replace(/ \(deleted\)$/, "")) !== "herdr")
          return false;

        const args = (yield* fs.readFileString(`/proc/${pid}/cmdline`))
          .split("\0")
          .filter(Boolean);

        const client =
          args.length > 0 &&
          ((local && interactiveClient(args)) ||
            (options.remote === true && remoteClientBridge(args)));

        if (!client) return false;

        for (const fd of yield* fs.readDirectory(`/proc/${pid}/fd`)) {
          const link = yield* fs
            .readLink(`/proc/${pid}/fd/${fd}`)
            .pipe(
              Effect.catchReason("PlatformError", "NotFound", () =>
                Effect.succeed(""),
              ),
            );

          if (peers.has(link)) return true;
        }

        return false;
      }).pipe(
        Effect.catchReason("PlatformError", "NotFound", () =>
          Effect.succeed(false),
        ),
      );

      if (attached) return true;
    }

    return false;
  },
);
