import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import {
  Deferred,
  Effect,
  Fiber,
  Stream,
} from "../../agents/.config/opencode/plugins-v2/node_modules/effect/dist/index.js";
import type {
  Context,
  Plugin as EffectPlugin,
} from "../../agents/.config/opencode/plugins-v2/node_modules/@opencode-ai/plugin/dist/effect/plugin.js";

const root = resolve(import.meta.dir, "../..");
const v1 = resolve(root, "agents/.config/opencode/plugins");
const v2 = resolve(root, "agents/.config/opencode/plugins-v2");

const migrated = [
  "branch-context",
  "commit-context",
  "context-capture",
  "context-zone-warning",
  "env-protection",
  "generated-artifact-guard",
  "mcp-repo-gate",
  "notes-guard",
  "notification",
  "pitchfork-dev-server-guard",
  "readonly-subagent-shell-guard",
  "repo-notes",
  "subagent-chrome-devtools-guard",
  "stack-context",
  "workflow-manifest",
] as const;

const registration = { dispose: Effect.void };

interface GuardEvent {
  readonly tool: string;
  readonly input: Record<string, string>;
}

interface CommandTransformDraft {
  update(
    name: string,
    update: (command: { template: string }) => void,
  ): void;
}

interface SessionContextEvent {}

interface RegisteredTool {
  readonly name: string;
  readonly options?: {
    readonly codemode?: boolean;
    readonly permission?: string;
  };
  readonly execute: (...args: never[]) => object;
}

interface ToolTransformDraft {
  add(definition: RegisteredTool): void;
}

interface RegistrationEvent {
  readonly tool: string;
  readonly sessionID: string;
  readonly agent: string;
  readonly id: string;
  readonly input: Record<string, string>;
  readonly system: readonly { readonly text: string }[];
  readonly tools: Readonly<Record<string, { readonly description: string; readonly input: object }>>;
  readonly messages: readonly object[];
}

interface RegistrationDraft {
  add(definition: RegisteredTool): void;
  update(
    name: string,
    update: (command: { template: string }) => void,
  ): void;
}

type RegisteredCallback = (
  event: RegistrationEvent,
) => Effect.Effect<void, object>;

interface RegistrationHarness {
  readonly context: Partial<Context>;
  readonly callbacks: Map<string, RegisteredCallback>;
  readonly tools: RegisteredTool[];
  readonly commands: Map<string, { template: string }>;
  readonly eventCount: () => number;
}

const runPlugin = (plugin: EffectPlugin, context: Partial<Context>) => {
  // SAFETY: Each test supplies every context domain that the plugin exercises during registration.
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        // SAFETY: Each test supplies every context domain that the plugin exercises during registration.
        yield* plugin.effect(context as Context);
        yield* Effect.yieldNow;
      }),
    ),
  );
};

const createRegistrationHarness = (): RegistrationHarness => {
  const callbacks = new Map<string, RegisteredCallback>();
  const tools: RegisteredTool[] = [];
  const commands = new Map(
    [
      "inject-context",
      "commit",
      "commit-push",
      "commit-push-watch",
      "inject-stack",
      "note-create",
      "note-append",
      "notes-list",
      "notes-search",
      "note-reference",
      "handoff",
      "handoffs-list",
    ].map((name) => [name, { template: name }]),
  );
  let events = 0;
  const register = (domain: string) =>
    (name: string, callback: RegisteredCallback) =>
      Effect.sync(() => {
        callbacks.set(`${domain}:${name}`, callback);
        return registration;
      });
  const transform = (domain: string) =>
    (apply: (draft: RegistrationDraft) => void) =>
      Effect.sync(() => {
        apply({
          add: (definition) => tools.push(definition),
          update: (name, update) => {
            const command = commands.get(name);
            if (command) update(command);
          },
        });
        callbacks.set(`${domain}:transform`, () => Effect.void);
        return registration;
      });

  return {
    callbacks,
    tools,
    commands,
    eventCount: () => events,
    context: {
      command: { transform: transform("command") },
      tool: {
        hook: register("tool"),
        transform: transform("tool"),
      },
      session: {
        hook: register("session"),
        get: () =>
          Effect.succeed({
            location: { directory: root },
            title: "Migration test",
          }),
      },
      shell: { hook: register("shell") },
      event: {
        subscribe: () =>
          Stream.fromIterable([{ type: "config.updated", data: {} }]).pipe(
            Stream.tap(() => Effect.sync(() => (events += 1))),
          ),
      },
      catalog: { model: { list: () => Effect.fail(new Error("unused")) } },
    },
  };
};

const workflowRun = {
  databaseId: 42,
  conclusion: "",
  createdAt: "2026-08-25T00:00:00Z",
  headSha: "abc123",
  name: "Lint",
  status: "queued",
  url: "https://example.test/run/42",
  workflowDatabaseId: 7,
};

describe("OpenCode V1/V2 plugin migration", () => {
  for (const name of migrated) {
    test(`${name} keeps independent V1 and Effect implementations`, async () => {
      const [legacy, effect] = await Promise.all([
        readFile(resolve(v1, `${name}.ts`), "utf8"),
        readFile(resolve(v2, `${name}.ts`), "utf8"),
      ]);
      expect(legacy).toContain("@opencode-ai/plugin");
      expect(legacy).not.toContain("@opencode-ai/plugin/effect");
      expect(legacy).not.toContain("Plugin.define");
      expect(effect).toContain('from "@opencode-ai/plugin/effect"');
      expect(effect).toContain(`id: "${name}"`);
      expect(effect).toContain("effect:");
      expect(effect).not.toMatch(/from\s+["'][^"']*\/plugins\//);
      expect(effect).not.toMatch(/import\s*\([^)]*\/plugins\//);
      expect(effect).not.toContain("PluginInput");
      expect(effect).not.toContain("setup:");
      expect(effect).not.toContain("server:");
    });
  }

  test("Effect modules import with the pinned plugin packages", async () => {
    const packageJson = await readFile(resolve(v2, "package.json"), "utf8");
    expect(packageJson).toContain('"@opencode-ai/plugin": "0.0.0-beta-17823"');
    expect(packageJson).toContain('"effect": "4.0.0-rc.110"');

    for (const name of migrated) {
      const plugin = (await import(resolve(v2, `${name}.ts`))).default;
      expect(plugin.id).toBe(name);
      expect(plugin).toHaveProperty("effect");
    }
  });

  test("repo-notes fails open for session lookup and notes failures", async () => {
    const { collectRepoNoteContext } = await import(resolve(v2, "repo-notes.ts"));
    const lookupWarning = await Effect.runPromise(
      collectRepoNoteContext(
        "notes-list",
        Effect.fail(new Error("session unavailable")),
      ),
    );
    expect(lookupWarning).toContain("<repo-note-context>");
    expect(lookupWarning).toContain("session unavailable");

    const processWarning = await Effect.runPromise(
      collectRepoNoteContext(
        "notes-list",
        Effect.succeed("/repo"),
        () => Promise.reject(new Error("notes unavailable")),
      ),
    );
    expect(processWarning).toContain("<repo-note-context>");
    expect(processWarning).toContain("notes unavailable");
  });

  test("stack-context warns for explicit parse failures and skips automatic absence", async () => {
    const { stackContextFromOutput } = await import(resolve(v2, "stack-context.ts"));
    const renderer = {
      parseStackContextJSON: () => null,
      isEmptyStackContext: () => true,
      renderStackContext: () => "rendered",
    };
    expect(stackContextFromOutput("not-json", true, renderer)).toContain(
      "could not parse",
    );
    expect(stackContextFromOutput("not-json", false, renderer)).toBeUndefined();

    const emptyRenderer = { ...renderer, parseStackContextJSON: () => ({}) };
    expect(stackContextFromOutput("{}", false, emptyRenderer)).toBeUndefined();
    expect(stackContextFromOutput("{}", true, emptyRenderer)).toBe("rendered");
  });

  test("Effect plugins import render helpers from lib, not flattened V1 plugin paths", async () => {
    const { readdir } = await import("node:fs/promises");
    const pluginFiles = (await readdir(v2)).filter((name) => name.endsWith(".ts"));
    for (const name of pluginFiles) {
      const source = await readFile(resolve(v2, name), "utf8");
      expect(source).not.toContain("../plugins/");
      expect(source).not.toContain("../lib/desktop-notification");
      expect(source).not.toContain("../lib/toast");
    }
  });

  test("every migrated server plugin completes native registration and a representative path", async () => {
    const captureEnabled = process.env.DOT_CONTEXT_CAPTURE;
    process.env.DOT_CONTEXT_CAPTURE = "1";
    const captureParent = await mkdtemp(join(tmpdir(), "plugin-v2-capture-"));
    process.env.DOT_CONTEXT_CAPTURE_DIR = captureParent;

    try {
      for (const name of migrated) {
        const plugin = (await import(resolve(v2, `${name}.ts`))).default;
        const harness = createRegistrationHarness();
        await runPlugin(plugin, harness.context);

        expect(
          harness.callbacks.size + harness.tools.length + harness.eventCount(),
          `${name} did not register a native path`,
        ).toBeGreaterThan(0);

        const representative =
          harness.callbacks.get("tool:execute.before") ??
          harness.callbacks.get("shell:create.before") ??
          harness.callbacks.get("session:context");
        if (
          representative &&
          name !== "branch-context" &&
          name !== "repo-notes" &&
          name !== "stack-context"
        ) {
          await Effect.runPromise(
            representative({
              tool: "read",
              sessionID: "session-test",
              agent: "build",
              id: "call-test",
              input: { filePath: resolve(root, "README.md") },
              system: [{ text: "system" }],
              tools: {},
              messages: [],
            }),
          );
        }

        if (name === "context-zone-warning" || name === "notification") {
          expect(harness.eventCount(), `${name} event stream did not execute`).toBe(1);
        }
      }
    } finally {
      if (captureEnabled === undefined) delete process.env.DOT_CONTEXT_CAPTURE;
      else process.env.DOT_CONTEXT_CAPTURE = captureEnabled;
      delete process.env.DOT_CONTEXT_CAPTURE_DIR;
      await rm(captureParent, { recursive: true, force: true });
    }
  });

  test("env-protection registers and executes a native tool hook", async () => {
    const plugin = (await import(resolve(v2, "env-protection.ts"))).default;
    let before: ((event: GuardEvent) => Effect.Effect<void, object>) | undefined;
    const context = {
      tool: {
        hook: (name: string, callback: typeof before) =>
          Effect.sync(() => {
            expect(name).toBe("execute.before");
            before = callback;
            return registration;
          }),
      },
    };

    await runPlugin(plugin, context);
    const hook = before;
    if (!hook) throw new Error("env-protection did not register its tool hook");
    const error = await Effect.runPromise(
      Effect.flip(
        hook({
          tool: "read",
          input: { filePath: "/repo/.env" },
        }),
      ),
    );
    expect(error).toHaveProperty("message", "Do not read .env files");
  });

  test("branch-context registers native command and session hooks", async () => {
    const plugin = (await import(resolve(v2, "branch-context.ts"))).default;
    const commands = new Map([
      ["inject-context", { template: "Review this branch" }],
    ]);
    let sessionHook:
      | ((event: SessionContextEvent) => Effect.Effect<void, object>)
      | undefined;
    const context = {
      command: {
        transform: (transform: (draft: CommandTransformDraft) => void) =>
          Effect.sync(() => {
            transform({
              update: (name: string, update: (command: { template: string }) => void) => {
                const command = commands.get(name);
                if (command) update(command);
              },
            });
            return registration;
          }),
      },
      session: {
        hook: (name: string, callback: typeof sessionHook) =>
          Effect.sync(() => {
            expect(name).toBe("context");
            sessionHook = callback;
            return registration;
          }),
      },
    };

    await runPlugin(plugin, context);
    expect(commands.get("inject-context")?.template).toStartWith(
      "<branch-context-command>inject-context</branch-context-command>",
    );
    expect(sessionHook).toBeDefined();
  });

  test("workflow-manifest registers a native Effect tool", async () => {
    const plugin = (await import(resolve(v2, "workflow-manifest.ts"))).default;
    let tool: RegisteredTool | undefined;
    const context = {
      tool: {
        transform: (transform: (draft: ToolTransformDraft) => void) =>
          Effect.sync(() => {
            transform({ add: (definition: typeof tool) => (tool = definition) });
            return registration;
          }),
      },
    };

    await runPlugin(plugin, context);
    expect(tool?.name).toBe("workflow_manifest");
    expect(tool?.execute).toBeFunction();
    expect(tool?.options).toEqual({
      codemode: false,
      permission: "workflow_manifest",
    });
  });

  test("workflow registration retry is Effect-native and waits for stable runs", async () => {
    const { resolveRunsWithRetryEffect } = await import(
      resolve(v2, "workflow-manifest.ts")
    );
    const responses = [[], [workflowRun], [workflowRun]];
    let attempts = 0;
    const result = await Effect.runPromise(
      resolveRunsWithRetryEffect({
        sha: workflowRun.headSha,
        maxAttempts: responses.length,
        retryIntervalMs: 0,
        listRuns: () => Effect.succeed(responses[attempts++] ?? []),
      }),
    );

    expect(result.status).toBe("resolved");
    expect(result.attempts).toBe(3);
    expect(result.runs).toEqual([workflowRun]);
    expect(attempts).toBe(3);
  });

  test("workflow registration retry preserves Effect failures", async () => {
    const { resolveRunsWithRetryEffect } = await import(
      resolve(v2, "workflow-manifest.ts")
    );
    const error = new Error("gh unavailable");
    const failure = await Effect.runPromise(
      Effect.flip(
        resolveRunsWithRetryEffect({
          sha: workflowRun.headSha,
          retryIntervalMs: 0,
          listRuns: () => Effect.fail(error),
        }),
      ),
    );
    expect(failure).toBe(error);
  });

  test("interrupting workflow registration retry prevents later attempts", async () => {
    const { resolveRunsWithRetryEffect } = await import(
      resolve(v2, "workflow-manifest.ts")
    );
    let attempts = 0;
    const completedAttempts = await Effect.runPromise(
      Effect.gen(function* () {
        const firstAttempt = yield* Deferred.make<void>();
        const fiber = yield* resolveRunsWithRetryEffect({
          sha: workflowRun.headSha,
          retryIntervalMs: 60_000,
          listRuns: () =>
            Effect.gen(function* () {
              attempts += 1;
              yield* Deferred.succeed(firstAttempt, undefined);
              return [];
            }),
        }).pipe(Effect.forkChild);

        yield* Deferred.await(firstAttempt);
        yield* Fiber.interrupt(fiber);
        yield* Effect.sleep(10);
        return attempts;
      }),
    );

    expect(completedAttempts).toBe(1);
  });

  test("commit-context adapts V2 snapshots and tools across paginated descendants", async () => {
    const { collectSessionTree } = await import(
      resolve(v2, "commit-context.ts")
    );
    const pages = new Map([
      ["root:", { data: [{ id: "child-a" }], cursor: { next: "next" } }],
      ["root:next", { data: [{ id: "child-b" }], cursor: {} }],
      ["child-a:", { data: [], cursor: {} }],
      ["child-b:", { data: [], cursor: {} }],
    ]);
    const collection = await Effect.runPromise(
      collectSessionTree(
        {
          export: (sessionID: string) =>
            Effect.succeed({
              info: {
                projectID: "project-a",
                location: { directory: "/repo" },
              },
              messages:
                sessionID === "child-b"
                  ? [
                      {
                        type: "assistant",
                        content: [
                          {
                            type: "tool",
                            name: "edit",
                            state: {
                              status: "completed",
                              input: { filePath: "src/edited.ts" },
                            },
                          },
                        ],
                        snapshot: { files: ["src/snapshot.ts"] },
                      },
                    ]
                  : [],
            }),
          children: (parentID: string, cursor?: string) =>
            Effect.succeed(
              pages.get(`${parentID}:${cursor ?? ""}`) ?? {
                data: [],
                cursor: {},
              },
            ),
        },
        "root",
      ),
    );
    expect(collection.sessions).toHaveLength(3);
    expect(collection.warnings).toEqual([]);
    const { renderCommitContexts, sessionTouchedFiles } = await import(
      resolve(root, "agents/.config/opencode/lib/commit-context.ts")
    );
    const touchedFiles = sessionTouchedFiles(collection.sessions);
    expect(touchedFiles).toEqual([
      "/repo/src/edited.ts",
      "/repo/src/snapshot.ts",
    ]);
    const rendered = renderCommitContexts([
      {
        context: {
          inRepo: true,
          branchMetadata: { repositoryRoot: "/repo", currentBranch: "feature" },
          status: {
            staged: "",
            unstaged: "M\tsrc/edited.ts\nM\tsrc/snapshot.ts",
            untracked: "",
          },
          commits: "abc123 Previous change",
          warnings: [],
          truncations: [],
        },
        sessions: collection.sessions,
        touchedFiles,
        diffStat: "src/edited.ts | 1 +",
      },
    ]);
    expect(rendered).toContain("<commit-context>");
    expect(rendered).toContain("- src/edited.ts");
    expect(rendered).toContain("- src/snapshot.ts");
  });

  test("commit-context marks all three commands for native session injection", async () => {
    const plugin = (await import(resolve(v2, "commit-context.ts"))).default;
    const harness = createRegistrationHarness();
    await runPlugin(plugin, harness.context);
    for (const command of ["commit", "commit-push", "commit-push-watch"]) {
      expect(harness.commands.get(command)?.template).toStartWith(
        `<commit-context-command>${command}</commit-context-command>`,
      );
    }
    expect(harness.callbacks.has("session:context")).toBeTrue();
  });

  test.each([
    {
      name: "service discovery",
      warning: "Could not discover the local OpenCode service: discovery unavailable",
      discover: () => Effect.fail(new Error("discovery unavailable")),
      connect: () => Effect.fail(new Error("unused")),
    },
    {
      name: "authenticated client construction",
      warning:
        "Could not create the authenticated OpenCode client: client unavailable",
      discover: () =>
        Effect.succeed({
          url: "http://127.0.0.1:4096",
          auth: undefined,
        }),
      connect: () => Effect.fail(new Error("client unavailable")),
    },
  ])("commit-context injects partial rendering after $name failure", async (scenario) => {
    const { makeCommitContextPlugin } = await import(
      resolve(v2, "commit-context.ts")
    );
    const harness = createRegistrationHarness();
    await runPlugin(
      makeCommitContextPlugin({
        discover: scenario.discover,
        connect: scenario.connect,
      }),
      harness.context,
    );
    const hook = harness.callbacks.get("session:context");
    if (!hook) throw new Error("commit-context did not register its session hook");
    const system: { text: string }[] = [];
    await Effect.runPromise(
      hook({
        tool: "read",
        sessionID: "session-test",
        agent: "build",
        id: "call-test",
        input: {},
        system,
        tools: {},
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "<commit-context-command>commit</commit-context-command>",
              },
            ],
          },
        ],
      }),
    );
    expect(system[0]?.text).toContain("<commit-context>");
    expect(system[0]?.text).toContain("Status: partial");
    expect(system[0]?.text).toContain(scenario.warning);
  });

  test("mcp-repo-gate filters only gated tools for each session directory", async () => {
    const { filterRepoTools, serverForTool } = await import(
      resolve(v2, "mcp-repo-gate.ts")
    );
    const directory = await mkdtemp(join(tmpdir(), "plugin-v2-mcp-"));
    const plainDirectory = await mkdtemp(join(tmpdir(), "plugin-v2-mcp-plain-"));
    try {
      await mkdir(join(directory, "app"));
      await writeFile(join(directory, "app", "astro.config.mjs"), "");
      const gatedTools = {
        pitchfork_status: {},
        convex_envList: {},
        "astro-docs.search_astro_docs": {},
        chrome_devtools_navigate_page: {},
        github_get_me: {},
      };
      const plainTools = { ...gatedTools };
      filterRepoTools(gatedTools, directory);
      filterRepoTools(plainTools, plainDirectory);
      expect(Object.keys(gatedTools).sort()).toEqual([
        "astro-docs.search_astro_docs",
        "chrome_devtools_navigate_page",
        "github_get_me",
      ]);
      expect(Object.keys(plainTools)).toEqual(["github_get_me"]);
      expect(serverForTool("chrome_devtools_navigate_page")).toBe(
        "chrome-devtools",
      );
      expect(serverForTool("github_get_me")).toBeUndefined();
    } finally {
      await Promise.all([
        rm(directory, { recursive: true, force: true }),
        rm(plainDirectory, { recursive: true, force: true }),
      ]);
    }
  });

  test("mcp-repo-gate removes gated tools when session lookup fails", async () => {
    const plugin = (await import(resolve(v2, "mcp-repo-gate.ts"))).default;
    let hook: RegisteredCallback | undefined;
    await runPlugin(plugin, {
      tool: {
        hook: () => Effect.succeed(registration),
      },
      session: {
        hook: (name: string, callback: RegisteredCallback) =>
          Effect.sync(() => {
            expect(name).toBe("context");
            hook = callback;
            return registration;
          }),
        get: () => Effect.fail(new Error("session unavailable")),
      },
    });
    if (!hook) throw new Error("mcp-repo-gate did not register its session hook");
    const tools = {
      pitchfork_status: { description: "Pitchfork", input: {} },
      convex_envList: { description: "Convex", input: {} },
      "astro-docs.search_astro_docs": { description: "Astro", input: {} },
      chrome_devtools_navigate_page: { description: "Chrome", input: {} },
      github_get_me: { description: "GitHub", input: {} },
    };
    await Effect.runPromise(
      hook({
        tool: "read",
        sessionID: "session-test",
        agent: "build",
        id: "call-test",
        input: {},
        system: [],
        tools,
        messages: [],
      }),
    );
    expect(Object.keys(tools)).toEqual(["github_get_me"]);
  });

  test("mcp-repo-gate blocks code-mode child calls outside matching repositories", async () => {
    const plugin = (await import(resolve(v2, "mcp-repo-gate.ts"))).default;
    const harness = createRegistrationHarness();
    await runPlugin(plugin, harness.context);
    const hook = harness.callbacks.get("tool:execute.before");
    if (!hook) throw new Error("mcp-repo-gate did not register its tool hook");

    const failure = await Effect.runPromise(
      Effect.flip(
        hook({
          tool: "pitchfork_status",
          sessionID: "session-test",
          agent: "build",
          id: "call-test",
          input: {},
          system: [],
          tools: {},
          messages: [],
        }),
      ),
    );
    expect(failure).toHaveProperty("message");
    expect(String(failure.message)).toContain("does not contain the required repository marker");

    await Effect.runPromise(
      hook({
        tool: "github_get_me",
        sessionID: "session-test",
        agent: "build",
        id: "call-test-2",
        input: {},
        system: [],
        tools: {},
        messages: [],
      }),
    );
  });

  test("V2 toast helper routes by directory, authenticates, and swallows failures", async () => {
    const { showToast } = await import(resolve(v2, "lib/toast.ts"));
    let request:
      | import("../../agents/.config/opencode/plugins-v2/node_modules/effect/dist/unstable/http/HttpClientRequest.js").HttpClientRequest
      | undefined;
    await Effect.runPromise(
      showToast(
        "/repo path",
        {
          title: "Warning",
          message: "Context is full",
          variant: "warning",
          duration: 8000,
        },
        {
          discover: () =>
            Effect.succeed({
              url: "http://127.0.0.1:4096",
              auth: { type: "basic", username: "opencode", password: "secret" },
            } as const),
          execute: (value) => {
            request = value;
            return Effect.fail(new Error("TUI unavailable"));
          },
        },
      ),
    );
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("http://127.0.0.1:4096/tui/show-toast");
    expect(request?.urlParams).toMatchObject({
      params: [["directory", "/repo path"]],
    });
    expect(request?.headers).toMatchObject({
      authorization: `Basic ${btoa("opencode:secret")}`,
      "content-type": "application/json",
    });
    expect(JSON.stringify(request?.body)).toContain("Context is full");
  });

  test("TUI plugins retain separate V1 and V2 implementations", async () => {
    for (const name of ["dot-git-diff", "lazygit"]) {
      const [legacy, current] = await Promise.all([
        readFile(resolve(v1, `tui-${name}.ts`), "utf8"),
        readFile(resolve(v2, "tui", `${name}.ts`), "utf8"),
      ]);
      expect(legacy).toContain("TuiPlugin");
      expect(current).toContain("Plugin.Definition");
    }
  });
});
