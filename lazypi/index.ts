import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isInTmux, setWindowName, TmuxPane } from "../shared/tmux-pane";

const extDir = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────

// ─── Key hints ───────────────────────────────────────────────────────

interface KeyHint { key: string; label: string }

const HINTS_IDLE: KeyHint[] = [
	{ key: "Enter", label: "send" },
	{ key: "Tab", label: "complete" },
	{ key: "Ctrl+L", label: "model" },
	{ key: "/keys", label: "shortcuts" },
];

const HINTS_STREAMING: KeyHint[] = [
	{ key: "Esc", label: "stop" },
	{ key: "/keys", label: "shortcuts" },
];

function renderHints(hints: KeyHint[], theme: any, width: number): string {
	const parts: string[] = [];
	let totalWidth = 0;
	for (const h of hints) {
		const rendered = `${theme.fg("accent", ` ${h.key} `)} ${theme.fg("dim", h.label)}`;
		const w = h.key.length + 2 + h.label.length + 2;
		if (totalWidth + w > width - 2) break;
		parts.push(rendered);
		totalWidth += w;
	}
	return parts.join(" ");
}

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

// ─── Monthly usage scanner ───────────────────────────────────────────

// Copilot billing multipliers for paid plans (April 2024, from official docs)
const COPILOT_PAID_REQUEST_MULTIPLIER: Record<string, number> = {
  // Claude
  "claude haiku 4.5": 0.33,
  "claude-opus-4.5": 3,
  "claude opus 4.5": 3,
  "claude-opus-4.6": 3,
  "claude opus 4.6": 3,
  "claude-opus-4.6-fast": 30,
  "claude opus 4.6 (fast mode) (preview)": 30,
  "claude-sonnet-4": 1,
  "claude sonnet 4": 1,
  "claude-sonnet-4.5": 1,
  "claude sonnet 4.5": 1,
  "claude-sonnet-4.6": 1,
  "claude sonnet 4.6": 1,
  // Gemini
  "gemini-2.5-pro": 1,
  "gemini 2.5 pro": 1,
  "gemini-3-flash": 0.33,
  "gemini 3 flash": 0.33,
  "gemini-3.1-pro": 1,
  "gemini 3.1 pro": 1,
  // GPT family
  "gpt-4.1": 0,
  "gpt 4 1": 0,
  "gpt-4o": 0,
  "gpt-5 mini": 0,
  "gpt-5.2": 1,
  "gpt-5.2-codex": 1,
  "gpt-5.3-codex": 1,
  "gpt-5.4": 1,
  "gpt-5.4 mini": 0.33,
  // Grok
  "grok code fast 1": 0.25,
  // Raptor/Goldeneye
  "raptor mini": 0,
  // (Goldeneye: Not Yet Billable)
};
function getCopilotMultiplier(model: string|undefined|null): number {
  if (!model) return 1;
  model = model.toLowerCase().replace(/[_.-]+/g, " ").replace(/\s+/g, " ").trim();
  for (const key of Object.keys(COPILOT_PAID_REQUEST_MULTIPLIER)) {
    if (model === key) return COPILOT_PAID_REQUEST_MULTIPLIER[key];
    // Fuzzy
    if (model.includes(key)) return COPILOT_PAID_REQUEST_MULTIPLIER[key];
    if (key.includes(model)) return COPILOT_PAID_REQUEST_MULTIPLIER[key];
  }
  // fallback: treat unlisted models as 1
  return 1;
}

async function scanMonthlyUsage(provider: string): Promise<{ requests: number }> {
	const currentMonth = new Date().toISOString().slice(0, 7);
	const sessionsBase = join(homedir(), ".pi", "agent", "sessions");
	let requests = 0;

	try {
		const sessionDirs = await readdir(sessionsBase, { withFileTypes: true });
		for (const dir of sessionDirs) {
			if (!dir.isDirectory()) continue;
			const dirPath = join(sessionsBase, dir.name);
			const files = await readdir(dirPath).catch(() => []);
			for (const file of files) {
				if (!file.endsWith(".jsonl")) continue;
				if (!file.startsWith(currentMonth)) continue;
				try {
					const content = await readFile(join(dirPath, file), "utf8");
					for (const line of content.split("\n")) {
						if (!line.includes(`"${provider}"`)) continue;
						try {
							const entry = JSON.parse(line);
							if (entry.type !== "message") continue;
							const msg = entry.message;
							if (msg?.role === "assistant" && msg?.provider === provider) {
  const mult = getCopilotMultiplier(msg.model || msg.modelId || "");
  requests += mult;
}
						} catch {}
					}
				} catch {}
			}
		}
	} catch {}

	return { requests };
}

// ─── Greek mythology names ───────────────────────────────────────────

const GREEK_NAMES = [
	"achilles", "odysseus", "athena", "apollo", "artemis", "hermes", "perseus",
	"orpheus", "icarus", "theseus", "medusa", "cassandra", "pandora", "prometheus",
	"narcissus", "echo", "ariadne", "calypso", "circe", "daphne", "electra",
	"hector", "ajax", "patroclus", "penelope", "andromeda", "eurydice", "atalanta",
	"minos", "daedalus", "phaedra", "antigone", "aeneas", "nestor", "telemachus",
	"io", "syrinx", "arachne", "niobe", "leda", "ganymede", "tantalus",
	"sisyphus", "chiron", "cerberus", "hydra", "sphinx", "minotaur", "pegasus",
	"phoenix", "typhon", "helios", "selene", "eos", "iris", "nemesis",
];

function pickGreekName(): string {
	return GREEK_NAMES[Math.floor(Math.random() * GREEK_NAMES.length)];
}

// ─── Extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let streaming = false;
	const keysPane = new TmuxPane(pi);

	// Session token stats
	let sessionRequests = 0;

	// Context window usage
	let contextPct: number | null = null;
	let contextTokens: number | null = null;
	let contextWindow: number | null = null;

	// Monthly usage
	let monthlyRequests = 0;
	const MONTHLY_ALLOWANCE = 1000; // Copilot Enterprise per seat

	function recomputeSessionTokens(ctx: { sessionManager: any }) {
		sessionRequests = 0;
		for (const e of ctx.sessionManager.getBranch()) {
			if (e.type === "message" && e.message.role === "assistant") {
				sessionRequests++;
			}
		}
	}

	async function updateMonthlyUsage(provider: string) {
		const usage = await scanMonthlyUsage(provider);
		monthlyRequests = usage.requests;
	}

	pi.on("agent_start", async () => { streaming = true; });
	pi.on("agent_end", async (_event, ctx) => {
		streaming = false;
		recomputeSessionTokens(ctx);
		const usage = ctx.getContextUsage();
		contextPct = usage?.percent ?? null;
		contextTokens = usage?.tokens ?? null;
		contextWindow = usage?.contextWindow ?? null;
		if (ctx.model?.provider) {
			await updateMonthlyUsage(ctx.model.provider);
		}
	});

	// Reset session counter after compaction
	pi.on("session_compact", async () => {
		sessionRequests = 0;
		contextPct = null;
		contextTokens = null;
		contextWindow = null;
	});

	pi.on("session_start", async (_event, ctx) => {
		recomputeSessionTokens(ctx);

		// Scan monthly usage — use current model provider or default to github-copilot
		const provider = ctx.model?.provider || "github-copilot";
		await updateMonthlyUsage(provider);

		// tmux window name
		if (await isInTmux(pi)) {
			await setWindowName(pi, `π-${pickGreekName()}`);
		}

		// Token usage widget above editor
		ctx.ui.setWidget("token-usage", (_tui, theme) => ({
			render() {
				const lines: string[] = [];
				const BAR_WIDTH = 18;
				const PCT_SLOT = 4;
				const COMPACT_LABEL = " COMPACT ";
				const BAR_PREFIX_LEN = 1 + BAR_WIDTH + 1 + COMPACT_LABEL.length;

				// Row 1: req/month
				if (monthlyRequests > 0) {
					const pct = (monthlyRequests / MONTHLY_ALLOWANCE) * 100;
					const pctColor = pct > 100 ? "error" : pct > 80 ? "warning" : "success";
					const pctStr = `${pct.toFixed(0)}%`.padStart(PCT_SLOT);
					const reqNum = String(sessionRequests || 0);
					const fixedLeft = "req ";
					const fixedRight = "  .  month ";
					const prefixLen = fixedLeft.length + reqNum.length + fixedRight.length;
					const pad = " ".repeat(Math.max(0, BAR_PREFIX_LEN - prefixLen));
					lines.push(
						theme.fg("dim", fixedLeft) +
						theme.fg("accent", reqNum) +
						theme.fg("dim", fixedRight) +
						pad +
						theme.fg(pctColor, pctStr)
					);
				}

				// Row 2: COMPACT bar
				if (contextTokens !== null && contextWindow !== null) {
					const compactAt = contextWindow * (70 / 100);
					const barPct = Math.min(100, (contextTokens / compactAt) * 100);
					const filled = Math.max(barPct > 0 ? 1 : 0, Math.round((barPct / 100) * BAR_WIDTH));
					const barColor = barPct >= 100 ? "error" : barPct > 75 ? "warning" : "success";
					const bar =
						theme.fg("dim", "[") +
						theme.fg(barColor, "█".repeat(filled)) +
						theme.fg("dim", "░".repeat(BAR_WIDTH - filled)) +
						theme.fg("dim", "]");
					if (barPct >= 100) {
						lines.push(bar + theme.fg("error", `${COMPACT_LABEL}⚠`));
					} else {
						const pctStr = `${barPct.toFixed(0)}%`.padStart(PCT_SLOT);
						lines.push(bar + theme.fg("dim", COMPACT_LABEL) + theme.fg(barColor, pctStr));
					}
				}

				return lines;
			},
			invalidate() {},
		}));

		// Footer
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();
					const modelName = ctx.model?.id ?? "no model";

					const infoParts: string[] = [];
					infoParts.push(theme.fg("dim", ctx.cwd.replace(process.env.HOME || "", "~")));
					infoParts.push(theme.fg("accent", modelName));
					if (branch) infoParts.push(theme.fg("muted", `⎇ ${branch}`));
					for (const [, text] of footerData.getExtensionStatuses())
						infoParts.push(text);

					const infoLine = truncateToWidth(infoParts.join(theme.fg("dim", " · ")), width);
					const hints = streaming ? HINTS_STREAMING : HINTS_IDLE;
					const hintsLine = renderHints(hints, theme, width);
					return [infoLine, hintsLine];
				},
			};
		});
	});

	// /keys command
	pi.registerCommand("keys", {
		description: "Toggle keyboard shortcuts pane (tmux split)",
		handler: async (_args, ctx) => {
			if (!(await isInTmux(pi))) {
				ctx.ui.notify("Not inside tmux.", "error");
				return;
			}
			const viewerPath = join(extDir, "keys-viewer.mjs");
			await keysPane.toggle(`node '${viewerPath}'`, 40);
		},
	});

	// Cleanup
	pi.on("session_shutdown", async () => {
		await keysPane.close();
	});
}
