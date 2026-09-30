/**
 * @file Shows fallback lint progress and waiting lint problems, with user actions to view, send now or dismiss them.
 */

import type { SessionInboxInfo, SessionInboxSynthetic } from "@opencode/client";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { AgentLintRpc, idleStatus, LintCheck, type LintStatus, SOURCE } from "./rpc";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type Action = "view" | "fix-now" | "dismiss";

const COMMANDS: ReadonlyArray<{ action: Action; slash: string; title: string; description: string }> = [
  { action: "view", slash: "lint-view", title: "Lint: view problems", description: "Open the waiting lint output" },
  { action: "fix-now", slash: "lint-fix", title: "Lint: fix now", description: "Ask the agent to fix the waiting lint problems, plus any instruction you add" },
  { action: "dismiss", slash: "lint-dismiss", title: "Lint: dismiss", description: "Drop the waiting lint problems" },
];

type State = { sessions: Record<string, LintStatus> };

const initialState: State = { sessions: {} };

const decodeCount = Schema.decodeUnknownOption(Schema.Int.check(Schema.isGreaterThan(0)));

const decodeChecks = Schema.decodeUnknownOption(Schema.Array(LintCheck));

// Package-manager noise around a script's own output.
const RUNNER_LINE = /^(\$ .*|error: script ".*" exited with code \d+|\s*ELIFECYCLE .*)$/;

const outputLines = (output: string) => output.split("\n").filter((line) => !RUNNER_LINE.test(line));

const countMatches = (lines: readonly string[], pattern: RegExp) =>
  lines.filter((line) => pattern.test(line)).length;

const ERROR = /\berror\b/i;

const WARNING = /\bwarning\b/i;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const isLintItem = (item: SessionInboxInfo): item is SessionInboxSynthetic =>
  item.type === "synthetic" && item.payload.metadata?.source === SOURCE;

export default Plugin.define({
  id: "agent-lint",
  setup(context) {
    const rpc = context.client.rpc(AgentLintRpc);

    const [state, setState] = context.storage.memory("status", {
      initial: initialState,
    });

    const update = (status: LintStatus) =>
      setState((draft) => {
        draft.sessions[status.sessionID] = status;
      });

    const status = (sessionID: string) => state.sessions[sessionID] ?? idleStatus(sessionID);

    const load = (sessionID: string) => {
      if (state.sessions[sessionID]) return;

      void rpc
        .status({ sessionID })
        .then((loaded) => {
          if (!state.sessions[sessionID]) update(loaded);
        })
        .catch(() => undefined);
    };

    const waitingAll = (sessionID: string) =>
      context.data.session.pending.list(sessionID).filter(isLintItem);

    const waiting = (sessionID: string) => waitingAll(sessionID)[0];

    const problemCount = (item: SessionInboxSynthetic) =>
      Option.getOrElse(decodeCount(item.payload.metadata?.problems), () => 1);

    const cancelAll = (sessionID: string) =>
      Promise.all(
        waitingAll(sessionID).map((item) =>
          context.client.session.inbox.cancel({ sessionID, inboxID: item.id }),
        ),
      );

    const [viewing, setViewing] = createSignal(false);

    const closeView = () => {
      if (viewing()) context.ui.dialog.clear();
    };

    const dismiss = async (sessionID: string) => {
      update({ ...status(sessionID), timedOut: [] });
      closeView();

      await cancelAll(sessionID);
    };

    const fixNow = async (sessionID: string, instruction = "") => {
      const item = waiting(sessionID);

      if (!item) {
        context.ui.toast.show({ message: "No lint problems waiting", variant: "info" });

        return;
      }

      closeView();

      await cancelAll(sessionID);
      await context.client.session.prompt({
        sessionID,
        text: [item.payload.text, instruction.trim()].filter(Boolean).join("\n\n"),
      });
    };

    const view = (sessionID: string) => {
      if (!waiting(sessionID) && !status(sessionID).timedOut.length) {
        context.ui.toast.show({ message: "No lint problems waiting", variant: "info" });

        return;
      }

      setViewing(true);
      context.ui.dialog.show(() => <View sessionID={sessionID} />, () => setViewing(false));
      context.ui.dialog.set({ size: "xlarge", centered: true });
    };

    const handlers: Record<Action, (sessionID: string, input?: string) => Promise<void>> = {
      view: async (sessionID) => view(sessionID),
      "fix-now": fixNow,
      dismiss,
    };

    const run = (action: Action, sessionID: string, input?: string) => {
      void handlers[action](sessionID, input).catch((cause: unknown) =>
        context.ui.toast.show({ message: `Lint: ${String(cause)}`, variant: "error" }),
      );
    };

    const stopEvents = rpc.events.on("status", (event) => update(event.data));

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

    function Footer(props: { sessionID: string }) {
      const plugin = usePlugin();
      const [frame, setFrame] = createSignal(0);

      createEffect(() => load(props.sessionID));

      createEffect(() => {
        if (!status(props.sessionID).running) return;

        const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER.length), 80);

        onCleanup(() => clearInterval(timer));
      });

      const current = () => status(props.sessionID);
      const item = () => waiting(props.sessionID);

      return (
        <box flexShrink={0}>
          <Show when={current().running}>
            <text fg={plugin.theme.text.muted}>{`${SPINNER[frame()]} lint`}</text>
          </Show>
          <Show when={!current().running && item()}>
            {(found) => (
              <text fg={plugin.theme.text.feedback.warning.base}>{`lint ${problemCount(found())}`}</text>
            )}
          </Show>
          <Show when={!current().running && !item() && current().timedOut.length}>
            <text fg={plugin.theme.text.feedback.warning.base}>lint timeout</text>
          </Show>
          <Show when={!current().running && !item() && !current().timedOut.length && current().clean}>
            <text fg={plugin.theme.text.muted}>lint ✓</text>
          </Show>
        </box>
      );
    }

    function Strip(props: { sessionID: string }) {
      const plugin = usePlugin();
      const item = () => waiting(props.sessionID);
      const timedOut = () => status(props.sessionID).timedOut;

      const summary = () => {
        const found = item();

        const parts = [
          found ? `${problemCount(found)} failing` : "",
          timedOut().length ? `${timedOut().join(", ")} timed out` : "",
        ].filter(Boolean);

        return `Lint: ${parts.join(", ")}`;
      };

      return (
        <Show when={item() || timedOut().length}>
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
            <Show when={item()}>
              <Link label="fix now" onPress={() => run("fix-now", props.sessionID)} />
            </Show>
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

    function Check(props: { check: LintCheck }) {
      const theme = context.theme.surface("dialog");
      const lines = () => outputLines(props.check.output);

      const counts = () =>
        [
          [countMatches(lines(), ERROR), "error"] as const,
          [countMatches(lines(), WARNING), "warning"] as const,
        ]
          .flatMap(([count, word]) => (count > 0 ? [plural(count, word)] : []))
          .join(", ");

      const colour = (line: string) => {
        if (ERROR.test(line)) return theme.text.feedback.error.base;

        if (WARNING.test(line)) return theme.text.feedback.warning.base;

        return theme.text.muted;
      };

      return (
        <box>
          <box flexDirection="row" gap={2}>
            <text fg={theme.text.feedback.error.base} flexShrink={0}>
              ✗
            </text>
            <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexGrow={1} wrapMode="none" truncate>
              {props.check.command}
            </text>
            <text fg={theme.text.muted} flexShrink={0}>
              {counts()}
            </text>
          </box>
          <box paddingLeft={3}>
            <For each={lines()}>{(line) => <text fg={colour(line)}>{line}</text>}</For>
          </box>
        </box>
      );
    }

    function View(props: { sessionID: string }) {
      const theme = context.theme.surface("dialog");
      const dimensions = useTerminalDimensions();
      const maxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height * 0.6)));
      const item = () => waiting(props.sessionID);
      const timedOut = () => status(props.sessionID).timedOut;

      const checks = () => {
        const found = item();

        return found ? Option.getOrElse(decodeChecks(found.payload.metadata?.checks), () => []) : [];
      };

      const summary = () =>
        [
          checks().length ? `${plural(checks().length, "check")} failing` : "",
          timedOut().length ? `${timedOut().join(", ")} timed out` : "",
        ]
          .filter(Boolean)
          .join(", ") || "Nothing waiting";

      let scroll: ScrollBoxRenderable | undefined;

      context.keymap.layer(() => ({
        mode: "modal",
        commands: [
          { bind: "f", title: "Fix now", group: "Dialog", run: () => run("fix-now", props.sessionID) },
          { bind: "d", title: "Dismiss", group: "Dialog", run: () => run("dismiss", props.sessionID) },
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
              /lint
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
              <For each={checks()}>{(check) => <Check check={check} />}</For>
              <For each={timedOut()}>
                {(name) => (
                  <box flexDirection="row" gap={2}>
                    <text fg={theme.text.feedback.warning.base}>⏱</text>
                    <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
                      {name}
                    </text>
                    <text fg={theme.text.muted}>timed out, not sent to the agent</text>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>
          <box flexDirection="row" gap={3} paddingLeft={2} paddingRight={2}>
            <Show when={item()}>
              <Hint bind="f" label="fix now" onPress={() => run("fix-now", props.sessionID)} />
            </Show>
            <Hint bind="d" label="dismiss" onPress={() => run("dismiss", props.sessionID)} />
            <text fg={theme.text.muted}>j/k ↑/↓ scroll</text>
          </box>
        </box>
      );
    }

    const slots = [
      context.ui.slot({
        append: "prompt.footer.status",
        render: (input) => <Show when={input.sessionID}>{(id) => <Footer sessionID={id()} />}</Show>,
      }),
      context.ui.slot({
        append: "session.composer.top",
        render: (input) => <Strip sessionID={input.sessionID} />,
      }),
      context.ui.slot({
        append: "app",
        render: () => {
          context.keymap.layer(() => ({
            mode: "global",
            commands: COMMANDS.map((command) => ({
              id: `agent-lint.${command.action}`,
              title: command.title,
              description: command.description,
              group: "Session",
              palette: true,
              slash: command.action === "fix-now" ? { name: command.slash, arguments: true } : { name: command.slash },
              run(input) {
                const route = context.ui.router.current();

                if (route.type !== "session") {
                  context.ui.toast.show({ message: "Open a session first", variant: "warning" });

                  return;
                }

                run(command.action, route.sessionID, input);
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
