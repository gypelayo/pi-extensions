import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isInTmux } from "../shared/tmux-pane";

const extDir = dirname(fileURLToPath(import.meta.url));

type Mood = "idle" | "thinking" | "working";

export default function (pi: ExtensionAPI) {
	let tmpDir: string | null = null;
	let currentMood: Mood = "idle";
	let paneId: string | null = null;
	let goalsPaneId: string | null = null;

	async function ensureTmpDir(): Promise<string> {
		if (!tmpDir) tmpDir = await mkdtemp(join(tmpdir(), "pi-mood-"));
		return tmpDir;
	}

	async function setMood(mood: Mood, message?: string): Promise<void> {
		currentMood = mood;
		const dir = await ensureTmpDir();
		await writeFile(
			join(dir, "mood.json"),
			JSON.stringify({ mood, message: message || "" }),
			"utf8",
		);
	}

	async function isPaneAlive(): Promise<boolean> {
		if (!paneId) return false;
		const r = await pi.exec("tmux", ["has-session", "-t", paneId], { timeout: 3000 });
		if (r.code !== 0) { paneId = null; return false; }
		return true;
	}

	async function openPane(): Promise<void> {
		if (await isPaneAlive()) return;

		const dir = await ensureTmpDir();
		const viewerPath = join(extDir, "mood-viewer.mjs");
		const filePath = join(dir, "mood.json");
		const cmd = `node '${viewerPath}' '${filePath}'`;

		// Split below the goals pane if we know its ID
		const targetPane = goalsPaneId || "";
		let args: string[];
		if (targetPane) {
			// Split vertically (below) the goals pane, 30% height
			args = ["split-window", "-v", "-t", targetPane, "-l", "30%", "-P", "-F", "#{pane_id}", cmd];
		} else {
			// Fallback: split right side, small
			args = ["split-window", "-h", "-l", "20%", "-P", "-F", "#{pane_id}", cmd];
		}

		const result = await pi.exec("tmux", args, { timeout: 5000 });
		if (result.code === 0) {
			paneId = result.stdout.trim() || null;
		}
	}

	async function closePane(): Promise<void> {
		if (paneId) {
			try { await pi.exec("tmux", ["kill-pane", "-t", paneId], { timeout: 3000 }); } catch {}
			paneId = null;
		}
	}

	// Listen for goals pane ID
	pi.events.on("goals:pane", (data: any) => {
		goalsPaneId = data?.paneId || null;
	});

	// --- Mood: thinking → working → thinking → idle ---

	pi.on("agent_start", async () => {
		await setMood("thinking");
	});

	pi.on("tool_execution_start", async () => {
		await setMood("working");
	});

	pi.on("tool_execution_end", async () => {
		await setMood("thinking");
	});

	pi.on("agent_end", async () => {
		await setMood("idle");
	});

	// --- Pane management ---

	pi.on("session_start", async (event) => {
		await setMood("idle");

		if (await isInTmux(pi)) {
			if (event.reason === "resume" || event.reason === "fork" || event.reason === "reload") {
				// Wait a tick for goals pane to emit its ID
				setTimeout(async () => { await openPane(); }, 500);
			} else {
				pi.events.on("splash:done", async () => {
					// Wait for goals pane to open first
					setTimeout(async () => { await openPane(); }, 500);
				});
			}
		}
	});

	pi.registerCommand("mood", {
		description: "Toggle the agent mood face pane",
		handler: async (_args, ctx) => {
			if (!(await isInTmux(pi))) {
				ctx.ui.notify("Not inside tmux.", "error");
				return;
			}
			if (await isPaneAlive()) {
				await closePane();
			} else {
				await setMood(currentMood);
				await openPane();
			}
		},
	});

	pi.on("session_shutdown", async () => {
		await closePane();
		if (tmpDir) {
			try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
		}
		tmpDir = null;
	});
}
