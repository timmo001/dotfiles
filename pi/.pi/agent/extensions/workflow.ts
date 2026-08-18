import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

type CreatedTab = {
	result?: {
		tab?: {
			tab_id?: string;
		};
		root_pane?: {
			pane_id?: string;
		};
	};
};

const buildContinuationPrompt = (reason: "manual" | "threshold" | "overflow") =>
	`Compaction has completed (${reason}). Reconstruct the active task from the summary and retained context, reconcile it with the current worktree, then immediately continue the next unfinished step. Briefly state the recovered context before continuing. Do not wait for another user prompt unless the task is genuinely ambiguous or blocked.`;

const runHerdr = async (...args: string[]) =>
	execFileAsync("herdr", args, {
		cwd: process.cwd(),
		env: process.env,
	});

export default function workflow(pi: ExtensionAPI) {
	const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

	pi.on("session_compact", (event) => {
		if (event.reason === "overflow" && event.willRetry) return;

		const timer = setTimeout(() => {
			pendingTimers.delete(timer);
			pi.sendUserMessage(buildContinuationPrompt(event.reason), {
				deliverAs: "followUp",
			});
		}, 0);
		pendingTimers.add(timer);
	});

	pi.on("session_shutdown", () => {
		for (const timer of pendingTimers) clearTimeout(timer);
		pendingTimers.clear();
	});

	pi.registerCommand("research-tab", {
		description: "Open a background Pi research tab in the current Herdr workspace",
		handler: async (args, ctx) => {
			const topic = args.trim();
			const workspaceId = process.env.HERDR_WORKSPACE_ID;

			if (!topic) {
				ctx.ui.notify("Usage: /research-tab <topic>", "warning");
				return;
			}

			if (process.env.HERDR_ENV !== "1" || !workspaceId) {
				ctx.ui.notify("Research tabs require Pi to run inside Herdr", "error");
				return;
			}

			let createdTabId: string | undefined;
			try {
				const created = await runHerdr(
					"tab",
					"create",
					"--workspace",
					workspaceId,
					"--cwd",
					process.cwd(),
					"--label",
					`Research: ${topic.slice(0, 48)}`,
					"--no-focus",
				);
// SAFETY: Herdr's create-tab JSON contract is represented by CreatedTab.
const createdTab = JSON.parse(created.stdout) as CreatedTab;
				createdTabId = createdTab.result?.tab?.tab_id;
				const paneId = createdTab.result?.root_pane?.pane_id;

				if (!paneId) throw new Error("Herdr did not return the new tab's root pane");

				const name = `research_${Date.now().toString(36)}`;
				await runHerdr("agent", "start", name, "--kind", "pi", "--pane", paneId);
				await runHerdr(
					"agent",
					"prompt",
					name,
					`Research this topic using primary sources. Return concise findings with citations, material caveats, and the smallest useful next step. Do not modify files.\n\nTopic: ${topic}`,
				);

				ctx.ui.notify(`Research started in background tab: ${name}`, "info");
			} catch (error) {
				if (createdTabId) await runHerdr("tab", "close", createdTabId).catch(() => undefined);
				ctx.ui.notify(
					error instanceof Error ? `Could not start research tab: ${error.message}` : "Could not start research tab",
					"error",
				);
			}
		},
	});
}
