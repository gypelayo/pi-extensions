import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isInTmux, TmuxPane } from "../shared/tmux-pane";

const extDir = dirname(fileURLToPath(import.meta.url));

interface Step { text: string; done: boolean }
interface GoalsData { goal: string; steps: Step[] }

export default function (pi: ExtensionAPI) {
	// All state inside closure — safe across hot reloads
	let goalsData: GoalsData = { goal: "", steps: [] };
	let tmpDir: string | null = null;
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
		// Emit pane ID so other extensions can split relative to it
		if (pane.id) pi.events.emit("goals:pane", { paneId: pane.id });
	}

	// Register set_goals tool
	pi.registerTool({
		name: "set_goals",
		label: "Set Goals",
		description: "Update the goals sidebar with the current objective and steps. Call this when the user states a goal, when you break it into steps, or when you complete a step.",
		promptSnippet: "Update the goals sidebar with current objective and progress",
		promptGuidelines: [
			"When the user gives you a task or goal, call set_goals to set the goal and break it into steps.",
			"After completing a step, call set_goals to mark it done.",
			"When the plan changes or new steps emerge, call set_goals to reflect the current state.",
			"Keep step descriptions short and concrete.",
			"Do not call set_goals for trivial one-shot questions that don't need tracking.",
			"When making function calls using tools that accept array or object parameters ensure those are structured using JSON.",
		],
		parameters: Type.Object({
			goal: Type.String({ description: "The current high-level goal or objective" }),
			steps: Type.Array(
				Type.Object({
					text: Type.String({ description: "Short description of this step" }),
					done: Type.Boolean({ description: "Whether this step is completed" }),
				}),
				{ description: "Ordered list of steps to achieve the goal" },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			goalsData = { goal: params.goal, steps: params.steps };
			await writeGoals();

			if (await isInTmux(pi)) {
				await ensurePane();
			}

			const done = params.steps.filter(s => s.done).length;
			const total = params.steps.length;
			return {
				content: [{ type: "text", text: `${done}/${total} steps done` }],
				details: { goal: params.goal, steps: params.steps },
			};
		},
	});

	// Goal state injection — use message for higher model attention
	pi.on("before_agent_start", async (event) => {
		if (!goalsData.goal) {
			return;
		}
		const pending = goalsData.steps.filter(s => !s.done).map(s => s.text);
		const done = goalsData.steps.filter(s => s.done).map(s => s.text);
		return {
			message: {
				customType: "goals-state",
				content: `Current goal: "${goalsData.goal}"\nDone: ${done.join(", ") || "none"}\nPending: ${pending.join(", ") || "none"}\nCall set_goals after completing steps or when the plan changes.`,
				display: false,
			},
		};
	});

	// /goal command — also stores via appendEntry for manual goals
	pi.registerCommand("goal", {
		description: "Toggle goals pane, or set goal: /goal <description>",
		handler: async (args, ctx) => {
			if (!(await isInTmux(pi))) {
				ctx.ui.notify("Not inside tmux.", "error");
				return;
			}

			const text = (args || "").trim();

			if (!text) {
				if (await pane.isAlive()) {
					await pane.close();
				} else {
					await writeGoals();
					await ensurePane();
				}
				return;
			}

			// Manual goal set — persist via appendEntry
			goalsData = { goal: text, steps: [] };
			pi.appendEntry("goals-state", goalsData);
			await writeGoals();
			await ensurePane();
			ctx.ui.notify(`Goal: ${text}`, "info");
		},
	});

	// Restore goals + auto-open pane
	pi.on("session_start", async (event, ctx) => {
		goalsData = { goal: "", steps: [] };

		// Restore from session: check tool results first, then manual entries
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message"
				&& entry.message.role === "toolResult"
				&& entry.message.toolName === "set_goals"
				&& entry.message.details?.goal) {
				goalsData = {
					goal: entry.message.details.goal,
					steps: entry.message.details.steps || [],
				};
			}
			if (entry.type === "custom" && entry.customType === "goals-state" && entry.data?.goal) {
				goalsData = {
					goal: entry.data.goal,
					steps: entry.data.steps || [],
				};
			}
		}

		if (await isInTmux(pi)) {
			await writeGoals();
			// Defer pane opening — wait for splash to finish if it's active
			// Check if this is a fresh session (splash shows) or a resume (no splash)
			if (event.reason === "resume" || event.reason === "fork" || event.reason === "reload") {
				await ensurePane();
			} else {
				// Fresh session: wait for splash:done event before opening pane
				pi.events.on("splash:done", async () => {
					await writeGoals();
					await ensurePane();
				});
			}
		}
	});

	// Cleanup
	pi.on("session_shutdown", async () => {
		await pane.close();
		if (tmpDir) {
			try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
		}
		tmpDir = null;
		goalsData = { goal: "", steps: [] };
	});
}
