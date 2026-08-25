import { $ } from "bun";
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/effect";
import type { SessionListInput } from "@opencode-ai/client/effect/api";
import { Service } from "@opencode-ai/client/effect/service";
import type { Endpoint } from "@opencode-ai/client/service";
import { Plugin } from "@opencode-ai/plugin/effect";
import type { SessionMessage } from "@opencode-ai/schema/session-message";
import { Effect, Result, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { dirname } from "node:path";
import {
  MAX_COMMIT_CONTEXT_SESSIONS,
  renderCommitContexts,
  sessionTouchedFiles,
  type SessionMessages,
} from "../lib/commit-context";
import { discoverService } from "./lib/service";

const TARGET_COMMANDS = new Set([
  "commit",
  "commit-push",
  "commit-push-watch",
]);
const MARKER = /<commit-context-command>([^<]+)<\/commit-context-command>/;

interface SessionExport {
  readonly info: {
    readonly projectID: string;
    readonly location: { readonly directory: string };
  };
  readonly messages: readonly SessionMessage.Info[];
}

interface SessionPage {
  readonly data: readonly { readonly id: string }[];
  readonly cursor: { readonly next?: string };
}

interface SessionTreeReader {
  readonly export: (sessionID: string) => Effect.Effect<SessionExport, Error>;
  readonly children: (
    parentID: string,
    cursor?: string,
  ) => Effect.Effect<SessionPage, Error>;
}

interface ClientDependencies {
  readonly discover: () => Effect.Effect<Endpoint | undefined, Error>;
  readonly connect: (
    endpoint: Endpoint,
  ) => Effect.Effect<OpenCodeClient, Error>;
}

const errorMessage = (error: Error): string => error.message;

export const adaptPersistedMessages = (
  messages: readonly SessionMessage.Info[],
): readonly { readonly parts: readonly unknown[] }[] =>
  messages.flatMap((message) => {
    if (message.type !== "assistant") return [];
    const parts: unknown[] = message.content.map((part) =>
      part.type === "tool"
        ? { ...part, tool: part.name }
        : part,
    );
    if (message.snapshot?.files?.length) {
      parts.push({ type: "patch", files: message.snapshot.files });
    }
    return [{ parts }];
  });

export const collectSessionTree = (
  reader: SessionTreeReader,
  rootSessionID: string,
) =>
  Effect.gen(function* () {
    const pending = [rootSessionID];
    const visited = new Set<string>();
    const sessions: SessionMessages[] = [];
    const warnings: string[] = [];
    const warnTraversalLimit = () => {
      const warning = `Session traversal stopped after ${MAX_COMMIT_CONTEXT_SESSIONS} sessions.`;
      if (!warnings.includes(warning)) warnings.push(warning);
    };

    while (pending.length > 0) {
      const sessionID = pending.shift();
      if (!sessionID || visited.has(sessionID)) continue;
      if (visited.size >= MAX_COMMIT_CONTEXT_SESSIONS) {
        warnTraversalLimit();
        break;
      }
      visited.add(sessionID);

      const exported = yield* reader.export(sessionID).pipe(Effect.result);
      if (Result.isFailure(exported)) {
        warnings.push(
          `Could not export session ${sessionID}: ${errorMessage(exported.failure)}`,
        );
      } else {
        sessions.push({
          projectID: exported.success.info.projectID,
          directory: exported.success.info.location.directory,
          messages: { data: adaptPersistedMessages(exported.success.messages) },
        });
      }

      let cursor: string | undefined;
      do {
        const page = yield* reader.children(sessionID, cursor).pipe(Effect.result);
        if (Result.isFailure(page)) {
          warnings.push(
            `Could not list child sessions for ${sessionID}: ${errorMessage(page.failure)}`,
          );
          break;
        }
        for (const child of page.success.data) {
          if (visited.has(child.id) || pending.includes(child.id)) continue;
          if (visited.size + pending.length >= MAX_COMMIT_CONTEXT_SESSIONS) {
            warnTraversalLimit();
            cursor = undefined;
            break;
          }
          pending.push(child.id);
        }
        if (visited.size + pending.length < MAX_COMMIT_CONTEXT_SESSIONS) {
          cursor = page.success.cursor.next;
        }
      } while (cursor);
    }

    return { sessions, warnings };
  });

export const discoverClient = (dependencies: ClientDependencies) =>
  Effect.gen(function* () {
    const endpoint = yield* dependencies.discover().pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Could not discover the local OpenCode service: ${error.message}`,
          ),
      ),
    );
    if (!endpoint) return;
    return yield* dependencies.connect(endpoint).pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Could not create the authenticated OpenCode client: ${error.message}`,
          ),
      ),
    );
  });

export const makeCommitContextPlugin = (
  injectedDependencies?: ClientDependencies,
) =>
  Plugin.define({
    id: "commit-context",
    effect: (context) =>
      Effect.gen(function* () {
        yield* context.command.transform((commands) => {
          for (const name of TARGET_COMMANDS) {
            commands.add({
              name,
              execute: (input) =>
                context.session.prompt({
                  sessionID: input.sessionID,
                  text: `<commit-context-command>${name}</commit-context-command>\n\n${input.prompt.text}`,
                  files: input.prompt.files,
                  agents: input.prompt.agents,
                  skills: input.prompt.skills,
                  delivery: input.delivery,
                }).pipe(Effect.asVoid),
            });
          }
        });
  
        const dependencies: ClientDependencies = injectedDependencies ?? {
          discover: discoverService,
          connect: (endpoint) => {
            return Effect.gen(function* () {
              const httpClient = yield* HttpClient.HttpClient;
              const authenticated = Service.headers(endpoint)
                ? HttpClient.mapRequest(
                    httpClient,
                    HttpClientRequest.setHeaders(Service.headers(endpoint) ?? {}),
                  )
                : httpClient;
              return yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
                Effect.provideService(HttpClient.HttpClient, authenticated),
              );
            }).pipe(
              Effect.provide(FetchHttpClient.layer),
              Effect.mapError((error) => new Error(String(error))),
            );
          },
        };
  
        yield* context.session.hook("context", (event) =>
          Effect.gen(function* () {
            const command = event.messages
              .findLast((message) => message.role === "user")
              ?.content.filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
              .match(MARKER)?.[1];
            if (!command || !TARGET_COMMANDS.has(command)) return;
  
            const warnings: string[] = [];
            const current = yield* context.session
              .get({ sessionID: event.sessionID })
              .pipe(Effect.result);
            if (Result.isFailure(current)) {
              event.system.unshift({
                type: "text",
                text: renderCommitContexts([], [
                  `Could not resolve current session location: ${String(current.failure)}`,
                ]),
              });
              return;
            }
  
            const clientResult = yield* discoverClient(dependencies).pipe(
              Effect.result,
            );
            if (Result.isFailure(clientResult)) {
              warnings.push(clientResult.failure.message);
            }
            const client = Result.isSuccess(clientResult)
              ? clientResult.success
              : undefined;
            if (!client && Result.isSuccess(clientResult)) {
              warnings.push("Could not discover the local OpenCode service.");
            }
            const collection = client
              ? yield* collectSessionTree(
                  {
                    export: (sessionID) =>
                      client.session.export({
                        // SAFETY: IDs originate from the current session hook or schema-decoded session list.
                        sessionID: sessionID as Parameters<
                          typeof client.session.export
                        >[0]["sessionID"],
                      }).pipe(Effect.mapError((error) => new Error(String(error)))),
                    children: (parentID, cursor) =>
                      client.session.list({
                        // SAFETY: Parent IDs originate from the current session hook or schema-decoded session list.
                        parentID: parentID as SessionListInput["parentID"],
                        // SAFETY: Cursors originate from the schema-decoded preceding list page.
                        cursor: cursor as SessionListInput["cursor"],
                        limit: MAX_COMMIT_CONTEXT_SESSIONS,
                      }).pipe(Effect.mapError((error) => new Error(String(error)))),
                  },
                  event.sessionID,
                )
              : { sessions: [], warnings: [] };
            warnings.push(...collection.warnings);
  
            const touchedFiles = sessionTouchedFiles(collection.sessions);
            const filesByRoot = new Map<string, string[]>();
            const resolveRoot = (candidate: string) =>
              Effect.tryPromise({
                try: () =>
                  $`git -C ${candidate} rev-parse --show-toplevel`.text(),
                catch: (error) => new Error(String(error)),
              }).pipe(Effect.result);
            const activeRoot = yield* resolveRoot(
              current.success.location.directory,
            );
            if (Result.isFailure(activeRoot)) {
              warnings.push(
                `Could not resolve repository for ${current.success.location.directory}: ${errorMessage(activeRoot.failure)}`,
              );
            } else {
              filesByRoot.set(String(activeRoot.success).trim(), []);
            }
            for (const file of touchedFiles) {
              const candidate = dirname(file);
              const root = yield* resolveRoot(candidate);
              if (Result.isFailure(root)) {
                warnings.push(
                  `Could not resolve repository for ${candidate}: ${errorMessage(root.failure)}`,
                );
                continue;
              }
              const repository = String(root.success).trim();
              filesByRoot.set(repository, [
                ...(filesByRoot.get(repository) ?? []),
                file,
              ]);
            }
  
            const contexts = yield* Effect.all(
              [...filesByRoot]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([root, files]) =>
                  Effect.gen(function* () {
                    const [gitContext, diffStat] = yield* Effect.all([
                      Effect.tryPromise({
                        try: () => $`context git --json --no-pr`.cwd(root).text(),
                        catch: (error) => new Error(String(error)),
                      }).pipe(Effect.result),
                      Effect.tryPromise({
                        try: () =>
                          $`git diff HEAD --stat --no-ext-diff`.cwd(root).text(),
                        catch: (error) => new Error(String(error)),
                      }).pipe(Effect.result),
                    ]);
                    const collectionWarnings = [...warnings];
                    const parsed = Result.isSuccess(gitContext)
                      ? yield* Schema.decodeUnknownEffect(
                          Schema.fromJsonString(Schema.Unknown),
                        )(String(gitContext.success).trim()).pipe(Effect.result)
                      : Result.fail(gitContext.failure);
                    if (Result.isFailure(gitContext)) {
                      collectionWarnings.push(
                        `Could not collect git context: ${errorMessage(gitContext.failure)}`,
                      );
                    } else if (Result.isFailure(parsed)) {
                      collectionWarnings.push(
                        `Could not parse Context CLI output: ${String(parsed.failure)}`,
                      );
                    }
                    if (Result.isFailure(diffStat)) {
                      collectionWarnings.push(
                        `Could not collect diff stat: ${errorMessage(diffStat.failure)}`,
                      );
                    }
                    return {
                      context: Result.isSuccess(parsed) ? parsed.success : null,
                      sessions: collection.sessions,
                      touchedFiles: files,
                      diffStat: Result.isSuccess(diffStat)
                        ? String(diffStat.success).trim()
                        : "",
                      collectionWarnings,
                    };
                  }),
                ),
              { concurrency: "unbounded" },
            );
            event.system.unshift({
              type: "text",
              text: renderCommitContexts(contexts, warnings),
            });
          }),
        );
      }),
  });

export default makeCommitContextPlugin();
