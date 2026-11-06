import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// `dot up` writes a new stamp here when skills or plugins changed. Reloading
// through the extension API leaves the editor alone, so a half-typed prompt
// survives, and a busy session waits until it settles.
const REQUEST = join(
	process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
	"dot",
	"agent-reload",
);

const readStamp = () => {
	try {
		return readFileSync(REQUEST, "utf8").trim();
	} catch {
		return "";
	}
};

export default function dotReload(pi: ExtensionAPI) {
	let seen = readStamp();
	let pending = false;
	let idle = true;

	const reload = () => {
		pending = false;
		pi.sendUserMessage("/dot-reload", { expandPromptTemplates: true });
	};

	const check = () => {
		const stamp = readStamp();

		if (stamp === "" || stamp === seen) return;

		seen = stamp;
		pending = true;

		if (idle) reload();
	};

	pi.registerCommand("dot-reload", {
		description: "Reload extensions, skills, prompts and context files after dot up",
		handler: async (_args, ctx) => {
			await ctx.reload();

			return;
		},
	});

	pi.on("agent_start", () => {
		idle = false;
	});

	pi.on("agent_settled", () => {
		idle = true;

		if (pending) reload();
	});

	watchFile(REQUEST, { interval: 2000 }, check);

	pi.on("session_shutdown", () => {
		unwatchFile(REQUEST, check);
	});
}
