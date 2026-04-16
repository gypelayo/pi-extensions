import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ─── Config ─────────────────────────────────────────────────────────────────

// Free (0x) models — prefer these when frugal
const CHEAP_MODELS = ["gpt-4.1", "gpt-4o", "raptor mini"];

// Heavy model to upgrade to when the prompt signals complexity
const HEAVY_MODEL = "claude-sonnet-4.6";

// Keywords/patterns that signal a heavy task
const HEAVY_SIGNALS = [
	/\brefactor\b/i,
	/\barchitect/i,
	/\bdesign\b/i,
	/\bexplain\b/i,
	/\bdebug\b/i,
	/\banalyse\b|\banalyze\b/i,
	/\breview\b/i,
	/\boptimize\b|\boptimise\b/i,
	/\bwrite tests?\b/i,
	/\bimplement\b/i,
	/\bwhy\b/i,
	/\bhow does\b/i,
	/\bfix this\b/i,
	/\bmigrate\b/i,
	/\bunderstand\b/i,
];

// Prompt length above this char count is treated as heavy
const HEAVY_LENGTH_THRESHOLD = 300;

function isHeavyPrompt(prompt: string): boolean {
	if (prompt.length > HEAVY_LENGTH_THRESHOLD) return true;
	for (const re of HEAVY_SIGNALS) {
		if (re.test(prompt)) return true;
	}
	return false;
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let enabled = true; // on by default — /frugal toggles off

	// Model we were on before a temporary upgrade, so we can revert after
	let modelBeforeUpgrade: string | null = null;
	let upgradedThisTurn = false;

	function isCheap(modelId: string): boolean {
		const id = modelId.toLowerCase();
		return CHEAP_MODELS.some(m => id.includes(m.toLowerCase()));
	}

	async function switchToCheap(ctx: any) {
		const model = ctx.modelRegistry.find("github-copilot", CHEAP_MODELS[0])
			?? ctx.modelRegistry.find("github-copilot", CHEAP_MODELS[1]);
		if (model && ctx.model?.id !== model.id) {
			await pi.setModel(model);
		}
	}

	async function switchToHeavy(ctx: any) {
		const model = ctx.modelRegistry.find("github-copilot", HEAVY_MODEL);
		if (!model) {
			ctx.ui.notify(`frugal: heavy model ${HEAVY_MODEL} not found`, "warning");
			return false;
		}
		if (ctx.model?.id === model.id) return false; // already on it
		modelBeforeUpgrade = ctx.model?.id ?? null;
		await pi.setModel(model);
		return true;
	}

	// ─── before_agent_start ──────────────────────────────────────────────────

	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled) return;

		upgradedThisTurn = false;
		const prompt = event.prompt ?? "";

		if (isHeavyPrompt(prompt)) {
			// Only upgrade if currently on a cheap model
			if (isCheap(ctx.model?.id ?? "")) {
				const upgraded = await switchToHeavy(ctx);
				if (upgraded) {
					upgradedThisTurn = true;
					ctx.ui.notify(`frugal: upgraded → ${HEAVY_MODEL} for this turn`, "info");
				}
			}
		} else {
			// Light prompt — make sure we're on a cheap model
			if (!isCheap(ctx.model?.id ?? "")) {
				// Only auto-downgrade if the current model was set by us (i.e. modelBeforeUpgrade exists)
				// Otherwise respect user's manual choice
				if (modelBeforeUpgrade) {
					await switchToCheap(ctx);
					ctx.ui.notify(`frugal: back to cheap model`, "info");
					modelBeforeUpgrade = null;
				}
			}
		}
	});

	// ─── agent_end — revert after heavy turn ────────────────────────────────

	pi.on("agent_end", async (_event, ctx) => {
		if (!enabled || !upgradedThisTurn) return;
		upgradedThisTurn = false;
		// Revert to previous cheap model
		const prevId = modelBeforeUpgrade ?? CHEAP_MODELS[0];
		modelBeforeUpgrade = null;
		const model = ctx.modelRegistry.find("github-copilot", prevId)
			?? ctx.modelRegistry.find("github-copilot", CHEAP_MODELS[0]);
		if (model && ctx.model?.id !== model.id) {
			await pi.setModel(model);
			ctx.ui.notify(`frugal: reverted → ${model.id}`, "info");
		}
	});

	// ─── /frugal toggle ─────────────────────────────────────────────────────

	pi.registerCommand("frugal", {
		description: "Toggle frugal mode off/on (auto cheap→heavy→cheap switching)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				ctx.ui.notify("frugal mode ON — using cheap models, upgrading only when needed", "info");
				// Immediately switch to cheap model
				await switchToCheap(ctx);
			} else {
				ctx.ui.notify("frugal mode OFF — model unchanged", "info");
				modelBeforeUpgrade = null;
				upgradedThisTurn = false;
			}
			pi.events.emit("frugal:change", { enabled });
		},
	});

	// ─── status for footer ───────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Start on cheap model if frugal is active
		if (enabled) await switchToCheap(ctx);

		ctx.ui.addStatus("frugal", () => {
			if (!enabled) return "";
			return "💰 frugal";
		});
	});
}
