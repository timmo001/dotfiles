const log = (msg: string) => console.error(`[dot:OpenCodeServer] ${msg}`);

/** State for the OpenCode server lifecycle */
interface ServerState {
  client: import("@opencode-ai/sdk/v2").OpencodeClient;
  close: (() => void) | undefined;
  managedByUs: boolean;
}

let serverState: ServerState | undefined;

/** Ensure the OpenCode server is running, starting it if needed */
export async function ensureServer(): Promise<Pick<ServerState, "client">> {
  if (serverState) return serverState;

  // Try connecting to an existing server first
  const { createOpencodeClient, createOpencode } =
    await import("@opencode-ai/sdk/v2");

  try {
    log("Checking for existing OpenCode server on port 4096...");
    const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });
    // Health check
    const resp = await fetch("http://localhost:4096/health");
    if (resp.ok) {
      log("Connected to existing OpenCode server");
      serverState = { client, close: undefined, managedByUs: false };
      return serverState;
    }
  } catch {
    // Server not running, start one
  }

  log("Starting OpenCode server...");
  const { client, server } = await createOpencode({
    port: 4096,
  });
  log("OpenCode server started on port 4096");
  serverState = {
    client,
    close: () => server.close(),
    managedByUs: true,
  };
  return serverState;
}

/** Stop the OpenCode server if we started it */
export function shutdownServer(): void {
  if (serverState?.managedByUs && serverState.close) {
    log("Shutting down OpenCode server (started by us)");
    serverState.close();
    serverState = undefined;
  }
}
