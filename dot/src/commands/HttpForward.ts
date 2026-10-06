import { Console, Effect, Schema } from "effect";

/** Invalid `dot http-forward` arguments or a port that cannot be bound. */
export class HttpForwardError extends Schema.TaggedError<HttpForwardError>()(
  "HttpForwardError",
  { message: Schema.String },
) {}

/** Options for {@link httpForward}. */
export interface HttpForwardOptions {
  /** Local port to listen on, bound to 127.0.0.1. */
  readonly port: number;
  /** Origin to forward to, for example `http://homeassistant.local:8123`. */
  readonly target: string;
}

interface SocketData {
  readonly url: string;
  readonly protocols: readonly string[];
  readonly queue: (string | Uint8Array<ArrayBuffer>)[];
  upstream?: WebSocket;
}

// Proxy and hop-by-hop headers. Dropping the X-Forwarded-* family lets a
// target that doesn't trust this machine as a proxy accept the request.
const droppedRequestHeaders = new Set([
  "connection",
  "forwarded",
  "host",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);

const droppedResponseHeaders = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
]);

const isSendableCloseCode = (code: number) =>
  code === 1000 || (code >= 3000 && code <= 4999);

/**
 * Forward HTTP requests and websockets from a local port to another server,
 * without proxy headers, so a local HTTPS proxy can front a plain HTTP server
 * elsewhere on the network.
 */
export const httpForward = Effect.fn("HttpForward")(function* (
  options: HttpForwardOptions,
) {
  const target = yield* Effect.try({
    try: () => new URL(options.target),
    catch: () =>
      new HttpForwardError({ message: `Invalid --target ${options.target}` }),
  });

  if (target.protocol !== "http:" && target.protocol !== "https:")
    return yield* new HttpForwardError({
      message: "--target must be an http:// or https:// URL",
    });

  const socketTarget = new URL(target);
  socketTarget.protocol = target.protocol === "https:" ? "wss:" : "ws:";

  const server = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.serve<SocketData>({
          hostname: "127.0.0.1",
          port: options.port,
          async fetch(request, server) {
            const url = new URL(request.url);
            const path = url.pathname + url.search;

            if (request.headers.get("upgrade")?.toLowerCase() === "websocket")
              return server.upgrade(request, {
                data: {
                  url: new URL(path, socketTarget).href,
                  protocols:
                    request.headers
                      .get("sec-websocket-protocol")
                      ?.split(",")
                      .map((protocol) => protocol.trim())
                      .filter((protocol) => protocol.length > 0) ?? [],
                  queue: [],
                },
              })
                ? undefined
                : new Response("Websocket upgrade failed", { status: 400 });

            const headers = new Headers();

            for (const [name, value] of request.headers)
              if (!droppedRequestHeaders.has(name)) headers.set(name, value);

            headers.set("accept-encoding", "identity");

            try {
              const response = await fetch(new URL(path, target), {
                method: request.method,
                headers,
                body:
                  request.method === "GET" || request.method === "HEAD"
                    ? undefined
                    : await request.arrayBuffer(),
                redirect: "manual",
              });

              const responseHeaders = new Headers();

              for (const [name, value] of response.headers)
                if (!droppedResponseHeaders.has(name))
                  responseHeaders.append(name, value);

              return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
              });
            } catch {
              return new Response(`Could not reach ${target.origin}`, {
                status: 502,
              });
            }
          },
          websocket: {
            open(socket) {
              const upstream = new WebSocket(socket.data.url, [
                ...socket.data.protocols,
              ]);

              upstream.binaryType = "arraybuffer";
              socket.data.upstream = upstream;

              upstream.addEventListener("open", () => {
                for (const message of socket.data.queue) upstream.send(message);

                socket.data.queue.length = 0;
              });
              upstream.addEventListener(
                "message",
                (event: MessageEvent<string | ArrayBuffer>) => {
                  socket.send(event.data);
                },
              );
              upstream.addEventListener("close", (event) => {
                socket.close(
                  isSendableCloseCode(event.code) ? event.code : 1000,
                  event.reason,
                );
              });
              upstream.addEventListener("error", () => {
                socket.close(1011, "Upstream websocket error");
              });
            },
            message(socket, message) {
              const upstream = socket.data.upstream;

              const data =
                message instanceof Buffer ? new Uint8Array(message) : message;

              if (upstream?.readyState === WebSocket.OPEN) upstream.send(data);
              else socket.data.queue.push(data);
            },
            close(socket) {
              socket.data.upstream?.close();
            },
          },
        }),
      catch: (error) =>
        new HttpForwardError({
          message: `Could not listen on 127.0.0.1:${options.port}: ${String(error)}`,
        }),
    }),
    (server) => Effect.promise(() => server.stop(true)),
  );

  yield* Console.log(
    `Forwarding http://127.0.0.1:${server.port} to ${target.origin}`,
  );

  return yield* Effect.never;
}, Effect.scoped);
