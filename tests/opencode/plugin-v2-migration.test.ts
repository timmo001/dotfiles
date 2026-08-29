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

interface RegisteredCommand {
  readonly name: string;
  readonly execute: (input: {
    readonly sessionID: string;
    readonly prompt: { readonly text: string };
    readonly delivery: "immediate";
  }) => Effect.Effect<void, unknown>;
}

interface CommandTransformDraft {
  add(definition: RegisteredCommand): void;
}

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
}

type RegisteredCallback = (
  event: RegistrationEvent,
) => Effect.Effect<void, object>;

interface RegistrationHarness {
  readonly context: Partial<Context>;
  readonly callbacks: Map<string, RegisteredCallback>;
  readonly tools: RegisteredTool[];
  readonly commands: Map<string, RegisteredCommand>;
  readonly prompts: { readonly text: string }[];
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
  const commands = new Map<string, RegisteredCommand>();
  const prompts: { readonly text: string }[] = [];
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
        apply({ add: (definition) => tools.push(definition) });
        callbacks.set(`${domain}:transform`, () => Effect.void);
        return registration;
      });
  const commandTransform = (apply: (draft: CommandTransformDraft) => void) =>
    Effect.sync(() => {
      apply({ add: (definition) => commands.set(definition.name, definition) });
      callbacks.set("command:transform", () => Effect.void);
      return registration;
    });

  return {
    callbacks,
    tools,
    commands,
    prompts,
    eventCount: () => events,
    context: {
      command: { transform: commandTransform },
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
        prompt: (input: { readonly text: string }) =>
          Effect.sync(() => {
            prompts.push(input);
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

  test("Effect modules import with coordinated pinned dependencies", async () => {
    const packageJson = await readFile(resolve(v2, "package.json"), "utf8");
    const versions = ["client", "plugin", "schema"].map(
      (name) =>
        packageJson.match(
          new RegExp(`"@opencode-ai/${name}": "(0\\.0\\.0-beta-[0-9]{5,6})"`),
        )?.[1],
    );
    expect(versions.every((version) => version !== undefined)).toBe(true);
    expect(new Set(versions).size).toBe(1);

    const pluginPackageJson = await readFile(
      resolve(v2, "node_modules/@opencode-ai/plugin/package.json"),
      "utf8",
    );
    const effectVersion = packageJson.match(
      /"effect": "(4\.0\.0-rc\.[0-9]+)"/,
    )?.[1];
    const pluginEffectVersion = pluginPackageJson.match(
      /"effect": "(4\.0\.0-rc\.[0-9]+)"/,
    )?.[1];
    expect(effectVersion).toBeDefined();
    expect(effectVersion).toBe(pluginEffectVersion);

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
    const harness = createRegistrationHarness();
    await runPlugin(plugin, harness.context);
    const command = harness.commands.get("inject-context");
    expect(command).toBeDefined();
    if (!command) throw new Error("inject-context command was not registered");
    await Effect.runPromise(
      command.execute({
        sessionID: "session-1",
        prompt: { text: "Review this branch" },
        delivery: "immediate",
      }),
    );
    expect(harness.prompts[0]?.text).toStartWith(
      "<branch-context-command>inject-context</branch-context-command>",
    );
    expect(harness.callbacks.has("session:context")).toBeTrue();
  });

  test("inject-context command uses the visible hook trigger without leaking markers", async () => {
    const command = await readFile(
      resolve(root, "agents/.config/opencode/commands/inject-context.md"),
      "utf8",
    );
    expect(command).toContain(
      "Branch context and codebase stack context have been injected above.",
    );
    expect(command).not.toContain("<branch-context-command>");
    expect(command).not.toContain("<stack-context-command>");
  });

  test("inject-context prose triggers both context hooks", async () => {
    const message = {
      role: "user",
      content: [
        {
          type: "text",
          text: "Branch context and codebase stack context have been injected above.",
        },
      ],
    };
    for (const [name, tag] of [
      ["branch-context", "<branch-context>"],
      ["stack-context", "<stack-context>"],
    ] as const) {
      const plugin = (await import(resolve(v2, `${name}.ts`))).default;
      const harness = createRegistrationHarness();
      await runPlugin(plugin, harness.context);
      const hook = harness.callbacks.get("session:context");
      if (!hook) throw new Error(`${name} did not register a session hook`);
      const system: { text: string }[] = [];
      await Effect.runPromise(
        hook({
          tool: "",
          sessionID: "session-1",
          agent: "build",
          id: "message-1",
          input: {},
          system,
          tools: {},
          messages: [message],
        }),
      );
      expect(system.some((part) => part.text.includes(tag))).toBeTrue();
    }
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
      const definition = harness.commands.get(command);
      expect(definition).toBeDefined();
      if (!definition) throw new Error(`${command} command was not registered`);
      await Effect.runPromise(
        definition.execute({
          sessionID: "session-1",
          prompt: { text: command },
          delivery: "immediate",
        }),
      );
      expect(harness.prompts.at(-1)?.text).toStartWith(
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

  test("every migrated V1 server plugin has a default export", async () => {
    for (const name of migrated) {
      const plugin = await import(resolve(v1, `${name}.ts`));
      expect(plugin.default).toBeDefined();
    }
  });

  test("V1 context plugin render helpers remain private", async () => {
    const [branchContext, stackContext] = await Promise.all([
      import(resolve(v1, "branch-context.ts")),
      import(resolve(v1, "stack-context.ts")),
    ]);

    expect(Object.keys(branchContext).sort()).toEqual([
      "BranchContextPlugin",
      "default",
    ]);
    expect(Object.keys(stackContext).sort()).toEqual([
      "StackContextPlugin",
      "default",
    ]);
  });
});
