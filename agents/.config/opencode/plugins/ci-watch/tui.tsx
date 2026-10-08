/**
 * @file Shows CI state for the open checkout, on the home screen and in sessions, and waiting CI failures, with user actions to view, fix now or dismiss them.
 */

import type { LocationRef } from "@opencode/client";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { spawn } from "node:child_process";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { debugLog, describe } from "../lib/debug";
import { type CiStatus, CiWatchRpc, type FailedRun, noStatus } from "./rpc";

type Action = "view" | "fix-now" | "dismiss";

const COMMANDS: ReadonlyArray<{ action: Action; slash: string; title: string; description: string }> = [
  { action: "view", slash: "ci-view", title: "CI: view failures", description: "Open the failed workflow runs for this checkout" },
  { action: "fix-now", slash: "ci-fix", title: "CI: fix now", description: "Ask the agent to fix the failed workflow runs, plus any instruction you add" },
  { action: "dismiss", slash: "ci-dismiss", title: "CI: dismiss", description: "Drop the waiting CI failures until different runs fail" },
];

type State = { checkouts: Record<string, CiStatus> };

const initialState: State = { checkouts: {} };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const openUrl = (url: string) => spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();

export default Plugin.define({
  id: "ci-watch",
  setup(context) {
    const rpc = context.client.rpc(CiWatchRpc);

    const [state, setState] = context.storage.memory("status", {
      initial: initialState,
    });

    const update = (status: CiStatus) =>
      setState((draft) => {
        draft.checkouts[status.directory] = status;
      });

    // Each checkout has its own server plugin, so calls must reach the session's location, or the home screen's without one.
    const locate = (sessionID?: string): LocationRef =>
      (sessionID ? context.data.session.get(sessionID)?.location : undefined) ??
      context.location ??
      context.data.location.default();

    const at = (sessionID?: string) => ({ location: locate(sessionID) });

    const status = (sessionID?: string) => {
      const { directory } = locate(sessionID);

      return state.checkouts[directory] ?? noStatus(directory);
    };

    const requested = new Set<string>();

    const load = (location: LocationRef) => {
      if (requested.has(location.directory)) return;

      requested.add(location.directory);

      void rpc
        .status({}, { location })
        .then((loaded) => {
          debugLog("ci-watch", "tui", "status loaded", { directory: location.directory, result: loaded });
          update(loaded);
        })
        .catch((error) => {
          debugLog("ci-watch", "tui", "status failed", { directory: location.directory, error: describe(error) });
          requested.delete(location.directory);
          setTimeout(() => load(location), 10_000);
        });
    };

    const waiting = (sessionID?: string) => {
      const current = status(sessionID);

      return current.state === "failure" && !current.dismissed;
    };

    const [viewing, setViewing] = createSignal(false);

    const closeView = () => {
      if (viewing()) context.ui.dialog.clear();
    };

    const dismiss = async (sessionID?: string) => {
      closeView();

      const options = at(sessionID);

      debugLog("ci-watch", "tui", "dismiss start", {
        sessionID: sessionID ?? null,
        directory: options.location.directory,
        before: status(sessionID),
      });

      const result = await rpc.dismiss({}, options).catch((error) => {
        debugLog("ci-watch", "tui", "dismiss failed", { sessionID: sessionID ?? null, error: describe(error) });

        throw error;
      });

      debugLog("ci-watch", "tui", "dismiss done", { sessionID: sessionID ?? null, result, after: status(sessionID) });

      // Shows whether the server's status event arrived after the call returned.
      setTimeout(
        () => debugLog("ci-watch", "tui", "dismiss settled", { sessionID: sessionID ?? null, after: status(sessionID) }),
        2_000,
      );
    };

    // The home screen has no session yet, so fixing from there starts one in the same checkout.
    const startSession = async (location: LocationRef) => {
      const model = context.ui.model.current();

      const session = await context.client.session.create({
        location: { directory: location.directory },
        model: model ? { id: model.modelID, providerID: model.providerID, variant: model.variant } : undefined,
      });

      context.ui.router.navigate({ type: "session", sessionID: session.id });

      return session.id;
    };

    const fixNow = async (sessionID?: string, instruction = "") => {
      const options = at(sessionID);
      const failures = await rpc.details({}, options);

      if (!failures?.prompt) {
        context.ui.toast.show({ message: "No CI failures to fix", variant: "info" });

        return;
      }

      closeView();

      await rpc.dismiss({}, options);
      await context.client.session.prompt({
        sessionID: sessionID ?? (await startSession(options.location)),
        text: [failures.prompt, instruction.trim()].filter(Boolean).join("\n\n"),
      });
    };

    const view = (sessionID?: string) => {
      if (status(sessionID).state !== "failure") {
        context.ui.toast.show({ message: "No CI failures", variant: "info" });

        return;
      }

      setViewing(true);
      context.ui.dialog.show(() => <View sessionID={sessionID} />, () => setViewing(false));
      context.ui.dialog.set({ size: "xlarge", centered: true });
    };

    const handlers: Record<Action, (sessionID?: string, input?: string) => Promise<void>> = {
      view: async (sessionID) => view(sessionID),
      "fix-now": fixNow,
      dismiss,
    };

    const run = (action: Action, sessionID?: string, input?: string) => {
      void handlers[action](sessionID, input).catch((cause: unknown) =>
        context.ui.toast.show({ message: `CI: ${String(cause)}`, variant: "error" }),
      );
    };

    const events = new AbortController();

    debugLog("ci-watch", "tui", "events subscribed", { location: context.location });

    void (async () => {
      for await (const event of rpc.events.subscribe("status", { signal: events.signal })) {
        debugLog("ci-watch", "tui", "status event", {
          directory: event.data.directory,
          state: event.data.state,
          dismissed: event.data.dismissed,
          location: event.location ?? null,
        });
        update(event.data);
      }

      debugLog("ci-watch", "tui", "events ended", { aborted: events.signal.aborted });
    })().catch((error) =>
      debugLog("ci-watch", "tui", "events failed", { aborted: events.signal.aborted, error: describe(error) }),
    );

    const stopEvents = () => events.abort();

    function Link(props: { label: string; onPress: () => void }) {
      const plugin = usePlugin();
      const [hover, setHover] = createSignal(false);

      return (
        <text
          fg={hover() ? plugin.theme.text.action.secondary.hovered : plugin.theme.text.action.secondary.base}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={props.onPress}
        >
          {props.label}
        </text>
      );
    }

    function Footer(props: { sessionID?: string }) {
      const plugin = usePlugin();
      const current = () => status(props.sessionID);

      createEffect(() => load(locate(props.sessionID)));

      const label = () => {
        switch (current().state) {
          case "loading":
            return "CI …";
          case "running":
            return "CI ↻";
          case "failure":
            return `CI !${current().failures || ""}`;
          case "success":
            return "CI ✓";
          case "unavailable":
            return "CI ?";
          default:
            return "";
        }
      };

      return (
        <Show when={label()}>
          <box flexShrink={0}>
            <text
              fg={current().state === "failure" ? plugin.theme.text.feedback.warning.base : plugin.theme.text.muted}
              onMouseUp={() => run("view", props.sessionID)}
            >
              {label()}
            </text>
          </box>
        </Show>
      );
    }

    function Strip(props: { sessionID?: string }) {
      const plugin = usePlugin();
      const current = () => status(props.sessionID);

      const summary = () =>
        `CI: ${current().failures ? `${plural(current().failures, "run")} failing` : "failing"} on ${(current().sha ?? "").slice(0, 7)}`;

      return (
        <Show when={waiting(props.sessionID)}>
          <box
            flexDirection="row"
            gap={2}
            paddingLeft={2}
            paddingRight={1}
            backgroundColor={plugin.theme.background.raised.base}
          >
            <text fg={plugin.theme.text.feedback.warning.base} wrapMode="none" truncate flexShrink={1} minWidth={0}>
              {summary()}
            </text>
            <Link label="view" onPress={() => run("view", props.sessionID)} />
            <Link label="fix now" onPress={() => run("fix-now", props.sessionID)} />
            <Link label="dismiss" onPress={() => run("dismiss", props.sessionID)} />
          </box>
        </Show>
      );
    }

    function Hint(props: { bind: string; label: string; onPress: () => void }) {
      const theme = context.theme.surface("dialog");

      return (
        <text onMouseUp={props.onPress}>
          <span style={{ fg: theme.text.base }}>
            <b>{props.bind}</b>
          </span>
          <span style={{ fg: theme.text.muted }}>{` ${props.label}`}</span>
        </text>
      );
    }

    function Run(props: { run: FailedRun }) {
      const theme = context.theme.surface("dialog");

      return (
        <box>
          <box flexDirection="row" gap={2}>
            <text fg={theme.text.feedback.error.base} flexShrink={0}>
              ✗
            </text>
            <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexGrow={1} wrapMode="none" truncate>
              {props.run.workflow}
            </text>
            <text fg={theme.text.muted} flexShrink={0}>
              {`attempt ${props.run.attempt}`}
            </text>
          </box>
          <box paddingLeft={3}>
            <text fg={theme.text.muted}>{props.run.url}</text>
            <For each={props.run.jobs}>
              {(job) => (
                <box>
                  <text fg={theme.text.base}>{`${job.name} (${job.conclusion ?? "unknown"})`}</text>
                  <For each={job.failedSteps}>
                    {(step) => <text fg={theme.text.feedback.error.base}>{`  step ${step.number}: ${step.name}`}</text>}
                  </For>
                </box>
              )}
            </For>
            <Show
              when={props.run.logs}
              fallback={
                <text fg={theme.text.muted}>{props.run.logFile ? `Logs saved to ${props.run.logFile}` : "No logs"}</text>
              }
            >
              {(logs) => <For each={logs().split("\n")}>{(line) => <text fg={theme.text.muted}>{line}</text>}</For>}
            </Show>
          </box>
        </box>
      );
    }

    function View(props: { sessionID?: string }) {
      const theme = context.theme.surface("dialog");
      const dimensions = useTerminalDimensions();
      const maxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height * 0.6)));

      // Refetches when the failing runs change while the dialog is open.
      const [failures] = createResource(
        () => ({ location: locate(props.sessionID), sha: status(props.sessionID).sha, failures: status(props.sessionID).failures }),
        (source) => rpc.details({}, { location: source.location }),
      );

      const runs = () => failures()?.runs ?? [];

      const summary = () => {
        const current = status(props.sessionID);

        if (current.state !== "failure") return "No CI failures";

        if (failures.loading || !runs().length) return "Loading failures…";

        return `${plural(runs().length, "run")} failing on ${failures()?.branch} (${(current.sha ?? "").slice(0, 7)})`;
      };

      const open = () => {
        const url = runs()[0]?.url;

        if (url) openUrl(url);
      };

      let scroll: ScrollBoxRenderable | undefined;

      context.keymap.layer(() => ({
        mode: "modal",
        commands: [
          { bind: "f", title: "Fix now", group: "Dialog", run: () => run("fix-now", props.sessionID) },
          { bind: "d", title: "Dismiss", group: "Dialog", run: () => run("dismiss", props.sessionID) },
          { bind: "o", title: "Open run", group: "Dialog", run: open },
        ],
      }));

      useKeyboard((event) => {
        if (!scroll) return;

        if (event.name === "up" || event.name === "k") scroll.scrollBy(-1);
        else if (event.name === "down" || event.name === "j") scroll.scrollBy(1);
        else if (event.name === "pageup") scroll.scrollBy(-maxHeight());
        else if (event.name === "pagedown") scroll.scrollBy(maxHeight());
      });

      return (
        <box gap={1} paddingBottom={1}>
          <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={2}>
            <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexShrink={0}>
              CI
            </text>
            <text fg={theme.text.muted} wrapMode="none" flexGrow={1} truncate>
              {summary()}
            </text>
            <text fg={theme.text.muted} flexShrink={0} onMouseUp={() => context.ui.dialog.clear()}>
              esc
            </text>
          </box>
          <scrollbox
            ref={(element: ScrollBoxRenderable) => (scroll = element)}
            maxHeight={maxHeight()}
            contentOptions={{ minHeight: 0 }}
            backgroundColor={context.theme.background.raised.high}
            scrollbarOptions={{ visible: false }}
          >
            <box gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
              <For each={runs()}>{(value) => <Run run={value} />}</For>
            </box>
          </scrollbox>
          <box flexDirection="row" gap={3} paddingLeft={2} paddingRight={2}>
            <Hint bind="f" label="fix now" onPress={() => run("fix-now", props.sessionID)} />
            <Hint bind="d" label="dismiss" onPress={() => run("dismiss", props.sessionID)} />
            <Hint bind="o" label="open run" onPress={open} />
            <text fg={theme.text.muted}>j/k ↑/↓ scroll</text>
          </box>
        </box>
      );
    }

    const slots = [
      context.ui.slot({
        append: "prompt.footer.status",
        render: (input) => <Footer sessionID={input.sessionID} />,
      }),
      context.ui.slot({
        append: "session.composer.top",
        render: (input) => <Strip sessionID={input.sessionID} />,
      }),
      context.ui.slot({
        before: "home.footer",
        render: () => <Strip />,
      }),
      context.ui.slot({
        append: "app",
        render: () => {
          context.keymap.layer(() => ({
            mode: "global",
            commands: COMMANDS.map((command) => ({
              id: `ci-watch.${command.action}`,
              title: command.title,
              description: command.description,
              group: "Session",
              palette: true,
              slash: command.action === "fix-now" ? { name: command.slash, arguments: true } : { name: command.slash },
              run(input) {
                const route = context.ui.router.current();

                if (route.type === "plugin") {
                  context.ui.toast.show({ message: "Open a session or the home screen first", variant: "warning" });

                  return;
                }

                run(command.action, route.type === "session" ? route.sessionID : undefined, input);
              },
            })),
          }));

          return null;
        },
      }),
    ];

    return () => {
      stopEvents();

      for (const dispose of slots) dispose();
    };
  },
});
