/**
 * Auto-compact — triggers /compact when context usage exceeds a threshold.
 *
 * Configurable via TOP of this file:
 *   THRESHOLD_PCT  — compact when context window is this % full (default: 70)
 *   COOLDOWN_MS    — minimum ms between compactions (default: 60s)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ─── Config ──────────────────────────────────────────────────────────

const THRESHOLD_PCT = 70;   // Compact when context is 70% full (140k on Sonnet's 200k window)
const THRESHOLD_TOKENS = 100_000; // Or compact when absolute tokens exceed this
const COOLDOWN_MS   = 60_000; // Don't compact more than once per minute

// ─── Extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let lastCompactAt = 0;
	let compacting = false;

	pi.on("turn_end", async (_event, ctx) => {
		if (compacting) return;

		const usage = ctx.getContextUsage();
		if (!usage) return;

		const overPct = usage.percent !== null && usage.percent >= THRESHOLD_PCT;
		const overTokens = usage.tokens !== null && usage.tokens >= THRESHOLD_TOKENS;

		if (!overPct && !overTokens) return;

		const reason = overTokens
			? `${(usage.tokens! / 1000).toFixed(0)}k tokens`
			: `${usage.percent!.toFixed(0)}% of context window`;

		const now = Date.now();
		if (now - lastCompactAt < COOLDOWN_MS) return;

		compacting = true;
		lastCompactAt = now;

		ctx.ui.notify(
			`Context at ${reason} — auto-compacting…`,
			"warning",
		);

		ctx.compact({
			customInstructions: "Summarize concisely. Preserve current goal, key decisions, and any pending work.",
			onComplete: () => {
				compacting = false;
				ctx.ui.notify("Auto-compact complete.", "info");
			},
			onError: (err) => {
				compacting = false;
				ctx.ui.notify(`Auto-compact failed: ${err.message}`, "error");
			},
		});
	});
}
