/**
 * Tool Timestamps — Shows when bash commands ran and how long they took.
 * Only stamps bash results to minimize LLM token waste.
 *
 *   ░ 14:32:05 · 1.2s
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const startTimes = new Map<string, number>();

	pi.on("tool_execution_start", async (event) => {
		if (event.toolName === "bash") {
			startTimes.set(event.toolCallId, Date.now());
		}
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "bash") return;

		const now = Date.now();
		const startTime = startTimes.get(event.toolCallId);
		startTimes.delete(event.toolCallId);

		const time = new Date(now).toLocaleTimeString("en-GB", { hour12: false });

		let dur = "";
		if (startTime) {
			const elapsed = (now - startTime) / 1000;
			dur = elapsed < 1
				? ` · ${Math.round(elapsed * 1000)}ms`
				: elapsed < 60
					? ` · ${elapsed.toFixed(1)}s`
					: ` · ${Math.floor(elapsed / 60)}m${Math.round(elapsed % 60)}s`;
		}

		const timeLine = `░ ${time}${dur}`;

		const content = event.content.map((c) => {
			if (c.type === "text") {
				return { ...c, text: `${timeLine}\n${c.text}` };
			}
			return c;
		});

		return { content };
	});
}
