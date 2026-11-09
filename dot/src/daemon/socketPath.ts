import { join } from "path";
import { ENV, envString } from "../lib/env.js";

/** The dot daemon's runtime directory, in the user's runtime directory. */
const DAEMON_DIRECTORY = join(
  envString(ENV.XDG_RUNTIME_DIR) ?? `/run/user/${process.getuid?.() ?? 1000}`,
  "dot",
);

/** The dot daemon's socket. */
export const DAEMON_SOCKET_PATH = join(DAEMON_DIRECTORY, "daemon.sock");

/** Where the dot daemon mirrors its status for file watchers. */
export const STATUS_DIRECTORY = join(DAEMON_DIRECTORY, "status");
