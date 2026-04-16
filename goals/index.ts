import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isInTmux, TmuxPane } from "../shared/tmux-pane";

const extDir = dirname(fileURLToPath(import.meta.url));

// Marker the model embeds in its response text:
//   <!--GOALS goal="..." steps='[{"text":"...","done":false}]' -->
const GOALS_RE = /<!--GOALS goal="((?:[^"\\]|\\.)*)" steps='(\[.*?\])'\s*-->/s;

interface Step { text: string; done: boolean }
interface GoalsData { goal: string; steps: Step[] }

export default function (pi: ExtensionAPI) {
	let goalsData: GoalsData = { goal: "", steps: [] };
	let tmpDir: string | null = null;
	let pendingExtract = false;   // set by /goals — inject extraction request on next turn (kept for manual /goals trigger)
	const pane = new TmuxPane(pi);

	async function ensureTmpDir(): Promise<string> {
		if (!tmpDir) tmpDir = await mkdtemp(join(tmpdir(), "pi-goals-"));
		return tmpDir;
	}

	async function writeGoals(): Promise<void> {
		const dir = await ensureTmpDir();
		await writeFile(join(dir, "goals.json"), JSON.stringify(goalsData, null, 2), "utf8");
	}

	async function ensurePane(): Promise<void> {
		if (await pane.isAlive()) return;
		const dir = await ensureTmpDir();
		const viewerPath = join(extDir, "goals-viewer.mjs");
		const filePath = join(dir, "goals.json");
		await pane.open(`node '${viewerPath}' '${filePath}'`, 35);
		if (pane.id) pi.events.emit("goals:pane", { paneId: pane.id });
	}

	function parseGoalsMarker(text: string): GoalsData | null {
		const m = GOALS_RE.exec(text);
		if (!m) return null;
		try {
			const goal = m[1].replace(/\\"/g, '"');
			const steps: Step[] = JSON.parse(m[2]);
			return { goal, steps };
		} catch {
			return null;
		}
	}

	function scanHistoryForGoals(ctx: Parameters<Parameters<typeof pi.on>[1]>[1]): GoalsData | null {
		let latest: GoalsData | null = null;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				for (const block of entry.message.content) {
					if (block.type === "text") {
						const parsed = parseGoalsMarker(block.text);
						if (parsed) latest = parsed;
					}
				}
			}
			if (entry.type === "custom" && entry.customType === "goals-state" && entry.data?.goal) {
				latest = { goal: entry.data.goal, steps: entry.data.steps || [] };
			}
		}
		return latest;
	}

	// On every turn: inject current goals state + extraction request if /goals was called
	pi.on("before_agent_start", async (_event) => {
		const pending = goalsData.steps.filter(s => !s.done).map(s => s.text);
		const done = goalsData.steps.filter(s => s.done).map(s => s.text);
		const summary = goalsData.goal
			? `Current goal: "${goalsData.goal}"\nDone: ${done.join(", ") || "none"}\nPending: ${pending.join(", ") || "none"}`
			: "No goal set yet.";

		let content = `[GOALS STATE]\n${summary}`;

		if (pendingExtract) {
			pendingExtract = false;
			content +=
				"\n\n[GOALS EXTRACTION REQUESTED]\n" +
				"Based on this conversation, identify the current goal and steps. " +
				"Include this marker anywhere in your response (it will not be displayed):\n" +
				"  <!--GOALS goal=\"<goal>\" steps='[{\"text\":\"step\",\"done\":false}]' -->\n" +
				"Use done:true for completed steps. If no clear goal exists, use goal=\"\" and steps=[].";
		}

		return {
			message: {
				customType: "goals-state",
				content,
				display: false,
			},
		};
	});

	// After each turn: parse marker from response and update sidebar
	pi.on("turn_end", async (_event, ctx) => {
		const found = scanHistoryForGoals(ctx);
		if (found && (found.goal !== goalsData.goal || JSON.stringify(found.steps) !== JSON.stringify(goalsData.steps))) {
			goalsData = found;
			await writeGoals();
		}
	});

	// /goals — request extraction on next turn (zero extra requests)
	pi.registerCommand("goals", {
		description: "Extract goals from conversation on next request. /goals <text> to set manually.",
		handler: async (args, ctx) => {
			if (!(await isInTmux(pi))) {
				ctx.ui.notify("Not inside tmux.", "error");
				return;
			}

			const text = (args || "").trim();

			if (text) {
				// Manual override
				goalsData = { goal: text, steps: [] };
				pi.appendEntry("goals-state", goalsData);
				await writeGoals();
				await ensurePane();
				ctx.ui.notify(`Goal set: ${text}`, "info");
				return;
			}

			// Flag extraction for next turn
			pendingExtract = true;
			await ensurePane();
			ctx.ui.notify("Goals will be extracted on your next message.", "info");
		},
	});

	// Session start — always open pane
	pi.on("session_start", async (event, ctx) => {
		goalsData = { goal: "", steps: [] };
		const found = scanHistoryForGoals(ctx);
		if (found) goalsData = found;

		if (await isInTmux(pi)) {
			await writeGoals();
			const open = async () => { await writeGoals(); await ensurePane(); };
			if (event.reason === "resume" || event.reason === "fork" || event.reason === "reload") {
				await open();
			} else {
				pi.events.on("splash:done", open);
			}
		}
	});

	pi.on("session_shutdown", async () => {
		await pane.close();
		if (tmpDir) {
			try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
		}
		tmpDir = null;
		goalsData = { goal: "", steps: [] };
	});
}
