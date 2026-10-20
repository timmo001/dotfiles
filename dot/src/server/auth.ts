import { Clock, Console, Duration, Effect, FileSystem, Option } from "effect";
import { HttpServerRequest, HttpServerResponse, UrlParams } from "effect/http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { CONFIG_DIR } from "../lib/paths.js";

/** File holding the dashboard login token, written from 1Password by a secret file. */
export const TOKEN_PATH = join(CONFIG_DIR, "dot", "server", "token");

const COOKIE = "dot-server-session";
const SESSION_LENGTH = Duration.days(30);

const digest = (value: string) => createHash("sha256").update(value).digest();

const loginPage = (failed: boolean) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Log in - dot server</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #1a1b26; color: #c0caf5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
      form { display: grid; gap: 0.75rem; width: min(20rem, 90vw); }
      input, button { font: inherit; padding: 0.5rem 0.75rem; border-radius: 0.375rem; border: 1px solid #414868; background: #24283b; color: inherit; }
      button { background: #7aa2f7; color: #1a1b26; border: none; cursor: pointer; }
      p { margin: 0; color: #f7768e; }
    </style>
  </head>
  <body>
    <form method="post" action="/login">
      <h1>dot server</h1>
      <input type="hidden" name="username" autocomplete="username" value="dot-server" />
      <label for="token">Token</label>
      <input id="token" type="password" name="token" autocomplete="current-password" required autofocus />
      ${failed ? "<p>That token didn't match.</p>" : ""}
      <button type="submit">Log in</button>
    </form>
  </body>
</html>
`;

const html = (body: string, status = 200) =>
  HttpServerResponse.text(body, {
    status,
    contentType: "text/html; charset=utf-8",
  });

/**
 * Build the middleware that puts the dashboard and its API behind a token
 * login. The health check stays open for pitchfork. Sessions live in memory,
 * so restarting the server logs everyone out.
 */
export const loginMiddleware = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const token = yield* fs.readFileString(TOKEN_PATH).pipe(
    Effect.map((text) => text.trim()),
    Effect.option,
    Effect.map(Option.filter((text) => text.length > 0)),
  );

  if (Option.isNone(token))
    yield* Console.error(
      `[WARN] No login token in ${TOKEN_PATH}; every login will fail until it exists.`,
    );

  const expected = Option.map(token, digest);
  const sessions = new Map<string, number>();

  const validSession = (id: string | undefined, now: number) => {
    if (id === undefined) return false;

    const expires = sessions.get(id);

    if (expires === undefined) return false;

    if (expires > now) return true;

    sessions.delete(id);

    return false;
  };

  return <E, R>(
    app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = new URL(request.url, "http://localhost").pathname;
      const now = yield* Clock.currentTimeMillis;

      if (path === "/api/health") return yield* app;

      if (path === "/login" && request.method === "POST") {
        const params = yield* request.urlParamsBody.pipe(
          Effect.orElseSucceed(() => UrlParams.empty),
        );

        const given = Option.getOrElse(
          UrlParams.getFirst(params, "token"),
          () => "",
        );

        const matches = Option.match(expected, {
          onNone: () => false,
          onSome: (hash) => timingSafeEqual(hash, digest(given)),
        });

        if (!matches) return html(loginPage(true), 401);

        const id = randomBytes(32).toString("base64url");
        sessions.set(id, now + Duration.toMillis(SESSION_LENGTH));

        return yield* HttpServerResponse.redirect("/", { status: 303 }).pipe(
          HttpServerResponse.setCookie(COOKIE, id, {
            httpOnly: true,
            sameSite: "strict",
            path: "/",
            maxAge: SESSION_LENGTH,
          }),
          Effect.orDie,
        );
      }

      if (path === "/logout" && request.method === "POST") {
        sessions.delete(request.cookies[COOKIE] ?? "");

        return yield* HttpServerResponse.redirect("/login", {
          status: 303,
        }).pipe(
          HttpServerResponse.expireCookie(COOKIE, { path: "/" }),
          Effect.orDie,
        );
      }

      if (path === "/login") return html(loginPage(false));

      if (validSession(request.cookies[COOKIE], now)) return yield* app;

      return path.startsWith("/api/")
        ? HttpServerResponse.text("Log in first", { status: 401 })
        : HttpServerResponse.redirect("/login", { status: 303 });
    });
});
