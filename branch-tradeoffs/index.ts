import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { analyzeBranch } from "./analysis";
import { loadConfig } from "./config";
import type { BranchData } from "./git";
import { gatherBranchData } from "./git";
import { isInTmux, TmuxPane } from "../shared/tmux-pane";

const extDir = dirname(fileURLToPath(import.meta.url));

function parseArgs(args: string): { branch?: string; base?: string; close?: boolean } {
	const result: { branch?: string; base?: string; close?: boolean } = {};
	const trimmed = args.trim();
	if (!trimmed) return result;
	const parts = trimmed.split(/\s+/);

	for (let i = 0; i < parts.length; i++) {
		if (parts[i] === "--base" && i + 1 < parts.length) {
			result.base = parts[i + 1];
			i++;
		} else if (parts[i] === "--close" || parts[i] === "-c") {
			result.close = true;
		} else if (!parts[i]!.startsWith("--") && !result.branch) {
			result.branch = parts[i];
		}
	}
	return result;
}

function formatHeader(branchData: BranchData): string {
	const branch = branchData.branch;
	const stats = branchData.stats;
	return [
		`\x1b[1;36m⎇ Branch Tradeoffs\x1b[0m`,
		`\x1b[33m${branch.current}\x1b[0m ← \x1b[33m${branch.base}\x1b[0m`,
		`\x1b[32m+${stats.totalInsertions}\x1b[0m \x1b[31m-${stats.totalDeletions}\x1b[0m · ${stats.totalFiles} files · ${stats.totalCommits} commits`,
		`\x1b[90m${"─".repeat(60)}\x1b[0m`,
		"",
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	let analysis: string | null = null;
	let branchData: BranchData | null = null;
	let tmpDir: string | null = null;
	const pane = new TmuxPane(pi);

	async function ensureTmpDir(): Promise<string> {
		if (!tmpDir) tmpDir = await mkdtemp(join(tmpdir(), "pi-tradeoffs-"));
		return tmpDir;
	}

	async function writeAnalysisFile(): Promise<string> {
		const dir = await ensureTmpDir();
		const filePath = join(dir, "tradeoffs.md");
		const content = formatHeader(branchData!) + analysis!;
		await writeFile(filePath, content, "utf8");
		return filePath;
	}

	function viewerCommand(filePath: string): string {
		const viewerPath = join(extDir, "viewer.mjs");
		return `node '${viewerPath}' '${filePath}'`;
	}

	pi.registerCommand("tradeoffs", {
		description: "Analyze branch tradeoffs in a tmux split pane (toggles if already open)",
		handler: async (args, ctx) => {
			if (!(await isInTmux(pi))) {
				ctx.ui.notify("Not inside tmux. Start pi in a tmux session first.", "error");
				return;
			}

			const parsed = parseArgs(args || "");

			// /tradeoffs --close
			if (parsed.close) {
				await pane.close();
				ctx.ui.notify("Tradeoffs pane closed.", "info");
				return;
			}

			// Toggle if no new args and pane is alive
			if (!parsed.branch && !parsed.base && await pane.isAlive()) {
				await pane.close();
				ctx.ui.notify("Tradeoffs pane closed.", "info");
				return;
			}

			// Reopen with cached analysis if no new args
			if (analysis && branchData && !parsed.branch && !parsed.base) {
				const filePath = await writeAnalysisFile();
				await pane.open(viewerCommand(filePath), 50);
				ctx.ui.notify("Tradeoffs pane reopened.", "info");
				return;
			}

			// Run fresh analysis
			const config = await loadConfig();

			const result = await ctx.ui.custom<{ analysis: string; branchData: BranchData } | null>(
				(tui, theme, _kb, done) => {
					const loader = new BorderedLoader(tui, theme, "Analyzing branch tradeoffs...");
					loader.onAbort = () => done(null);

					(async () => {
						try {
							const bd = await gatherBranchData(pi, ctx.cwd, config, parsed.branch, parsed.base);
							if ("error" in bd) {
								done(null);
								setTimeout(() => ctx.ui.notify(bd.error, "error"), 100);
								return;
							}
							const a = await analyzeBranch(bd, config, ctx);
							if (typeof a !== "string") {
								done(null);
								setTimeout(() => ctx.ui.notify(a.error, "error"), 100);
								return;
							}
							done({ analysis: a, branchData: bd });
						} catch (err: any) {
							done(null);
							setTimeout(() => ctx.ui.notify(`Analysis failed: ${err.message}`, "error"), 100);
						}
					})();

					return loader;
				},
			);

			if (!result) return;

			analysis = result.analysis;
			branchData = result.branchData;

			await pane.close();
			const filePath = await writeAnalysisFile();
			await pane.open(viewerCommand(filePath), 50);
			ctx.ui.notify(
				`Tradeoffs: ${result.branchData.branch.current} ← ${result.branchData.branch.base} · Press ? in pane for help`,
				"info",
			);
		},
	});

	pi.on("session_shutdown", async () => {
		await pane.close();
		if (tmpDir) {
			try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
		}
		tmpDir = null;
		analysis = null;
		branchData = null;
	});
}
