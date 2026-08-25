import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  "context-capture",
  "context-zone-warning",
  "env-protection",
  "generated-artifact-guard",
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

  test("v2 MCP transforms lack the location contract required by mcp-repo-gate", async () => {
    const mcpTypes = await readFile(
      resolve(v2, "node_modules/@opencode-ai/plugin/dist/effect/mcp.d.ts"),
      "utf8",
    );
    expect(mcpTypes).toContain("readonly transform: Transform<MCPDraft>");
    expect(mcpTypes).not.toMatch(/session|project|directory|location/i);
    expect(await Bun.file(resolve(v2, "mcp-repo-gate.ts")).exists()).toBeFalse();
  });

  test("v2 sessions lack the traversal contract required by commit-context", async () => {
    const sessionTypes = await readFile(
      resolve(v2, "node_modules/@opencode-ai/plugin/dist/effect/session.d.ts"),
      "utf8",
    );
    expect(sessionTypes).toContain("type SessionDomain = Pick<");
    expect(sessionTypes).not.toContain('"messages"');
    expect(sessionTypes).not.toContain('"children"');
    expect(await Bun.file(resolve(v2, "commit-context.ts")).exists()).toBeFalse();
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
