import { join } from "path";
import { ENV, envString } from "../lib/env.js";

/** The dot daemon's socket, in the user's runtime directory. */
export const DAEMON_SOCKET_PATH = join(
  envString(ENV.XDG_RUNTIME_DIR) ?? `/run/user/${process.getuid?.() ?? 1000}`,
  "dot",
  "daemon.sock",
);
