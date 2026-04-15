/**
 * Pi Splash Screen — opencode-style full-screen entry with centered art and text input.
 * Takes over the screen on startup. Type your first message and press Enter to begin.
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { VERSION } from "@mariozechner/pi-coding-agent";
import { Input, visibleWidth } from "@mariozechner/pi-tui";

const PIE_ART = [
	"███████████████████████████████████████████████████",
	"████████████████████████████████████████████  █████",
	"██████████ ▓███████   ▓▓▓▓▓▓▓▓  ███████████████████",
	"▓ ████████████    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓    ██████████████",
	"██████████▓ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▓▓▓▓▓▓ ▓██████ ███",
	"█████▓ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ██████",
	"█████ ▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓ █████",
	"███  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ███",
	"██ ▓▓▓▓▓▓▓▓▓▓▓▓   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ▓▓▓▓▓▓▓▓▓▓▓▓ ██",
	"█ ▓▓▓▓▓▓▓▓▓▓▓▓▓   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ▓▓▓▓▓▓▓▓▓▓▓▓▓ █",
	"█ ▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▓▓▓▓  ▓▓▓  ▓▓▓▓▓▒▒▒▓▓▓▓▓▓▓▓▓▓▓  █",
	"█  ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ▒░  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░▓▓▒▒▒ █",
	"████  ▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒ ████",
	"█████  ▒  ▓  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ▒▒▒▒  █████",
	"██████ ▓▒  ▒▒ ▒▓▓▓▓▓ ▒▒▒▓▓▓▓▓▓▓▒ ▓▓▓▓ ▒  ▒▒▒ ░█████",
	"██████▓  ▓▓▒▒▒▒     ░▒▒  ▒▒▒▒  ▒     ▒▒▒ ▒▒▒ ██████",
	"████████  ▓▓▓▓▓▓▓▓▓▓ ▒▒▒▒▒▒▒▒▒▒▓▒▒▒▒▒▒▒▒▒▒  ███████",
	"█████████▓ ▓ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒   █████████",
	"█████████████   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ▒▒▒▒  █████████████",
	"███████████████████▓           ▓███████████████████",
	"███████████████████████████████████████████████████",
];

function colorPie(row: string, theme: Theme): string {
	let colored = "";
	for (const ch of row) {
		if (ch === "█") colored += " ";
		else if (ch === "▓") colored += theme.fg("accent", "▓");
		else if (ch === "▒") colored += theme.fg("dim", "▒");
		else if (ch === "░") colored += theme.fg("dim", "░");
		else colored += ch;
	}
	return colored;
}

function centerLine(line: string, visLen: number, width: number): string {
	const pad = Math.max(0, Math.floor((width - visLen) / 2));
	return " ".repeat(pad) + line;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.reason !== "startup") return;

		// Clear screen and hide header/footer for clean splash
		process.stdout.write("\x1b[2J\x1b[H");
		ctx.ui.setHeader((_tui, _theme) => ({
			render() { return []; },
			invalidate() {},
		}));
		ctx.ui.setFooter((_tui, _theme, _fd) => ({
			render() { return []; },
			invalidate() {},
		}));

		const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const input = new Input();
			input.focused = true;

			input.onSubmit = (value: string) => {
				done(value.trim() || null);
			};
			input.onEscape = () => {
				done(null);
			};

			const dim = (t: string) => theme.fg("dim", t);
			const muted = (t: string) => theme.fg("muted", t);
			const accent = (t: string) => theme.fg("accent", t);

			const artColored = PIE_ART.map(row => colorPie(row, theme));
			const piChar = accent("π");
			const subtitle = `${muted("coding agent")}  ${dim(`v${VERSION}`)}`;
			const subVisLen = "coding agent".length + 2 + `v${VERSION}`.length;
			const inputWidth = 50;

			return {
				render(width: number): string[] {
					const rows = process.stdout.rows || 24;
					const lines: string[] = [];

					const contentH = artColored.length + 1 + 1 + 1 + 3 + 3 + 1;
					const topPad = Math.max(1, Math.floor((rows - contentH) / 2));

					for (let i = 0; i < topPad; i++) lines.push("");

					// Pie art
					for (let i = 0; i < artColored.length; i++) {
						lines.push(centerLine(artColored[i], PIE_ART[i].length, width));
					}
					lines.push("");

					// π character + subtitle
					lines.push(centerLine(piChar, 1, width));
					lines.push(centerLine(subtitle, subVisLen, width));
					lines.push("");
					lines.push("");

					// Input box
					const boxWidth = Math.min(inputWidth, width - 4);
					const boxPad = Math.max(0, Math.floor((width - boxWidth) / 2));
					const sp = " ".repeat(boxPad);

					lines.push(sp + dim("┌" + "─".repeat(boxWidth - 2) + "┐"));

					const inputLines = input.render(boxWidth - 4);
					const inputLine = inputLines[0] || "";
					const promptStr = dim("› ");
					const innerWidth = boxWidth - 5;
					const padding = Math.max(0, innerWidth - visibleWidth(inputLine));
					lines.push(sp + dim("│ ") + promptStr + inputLine + " ".repeat(padding) + dim("│"));

					lines.push(sp + dim("└" + "─".repeat(boxWidth - 2) + "┘"));

					lines.push("");
					lines.push(centerLine(dim("Enter to start · Esc to skip"), 28, width));

					return lines;
				},
				invalidate() {
					input.invalidate();
				},
				handleInput(data: string) {
					input.handleInput(data);
					tui.requestRender();
				},
				get focused() { return true; },
				set focused(_v: boolean) { input.focused = true; },
			};
		});

		// Restore header and footer
		ctx.ui.setHeader(undefined);
		ctx.ui.setFooter(undefined);

		if (result) {
			pi.sendUserMessage(result);
		}

		pi.events.emit("splash:done", {});
	});
}
