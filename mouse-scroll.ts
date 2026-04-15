/**
 * Mouse Scroll Extension
 *
 * Two-layer scroll fix:
 *
 * 1. tmux with `mouse on`  → tmux handles scroll natively, nothing to do.
 * 2. tmux with `mouse off` → extension enables SGR mouse reporting and
 *    forwards scroll-up to `tmux copy-mode -u` so you can browse scrollback.
 *    Press q / Enter to leave copy mode.
 * 3. Not in tmux           → extension enables SGR mouse reporting so the
 *    terminal emulator can handle scrollback natively.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";
const IN_TMUX = Boolean(process.env.TMUX);

function parseSGRMouse(data: string): { button: number; press: boolean } | null {
	const m = data.match(/^\x1b\[<(\d+);\d+;\d+([Mm])$/);
	if (!m) return null;
	return { button: parseInt(m[1]!), press: m[4] === "M" };
}

async function isTmuxMouseOn(): Promise<boolean> {
	if (!IN_TMUX) return false;
	try {
		const result = await new Promise<string>((resolve) => {
			let out = "";
			const { spawn } = require("child_process");
			const proc = spawn("tmux", ["show-options", "-gv", "mouse"]);
			proc.stdout?.on("data", (d: Buffer) => (out += d.toString()));
			proc.on("close", () => resolve(out.trim()));
		});
		return result === "on";
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	let unsub: (() => void) | undefined;
	let mouseEnabled = false;

	pi.on("session_start", async (_event, ctx) => {
		// If tmux has mouse on, it already handles scroll — stay out of the way.
		if (await isTmuxMouseOn()) return;

		process.stdout.write(MOUSE_ON);
		mouseEnabled = true;

		unsub = ctx.ui.onTerminalInput((data) => {
			const ev = parseSGRMouse(data);
			if (!ev?.press) return;

			if (ev.button === 64 /* scroll up */ && IN_TMUX) {
				void pi.exec("tmux", ["copy-mode", "-u"]);
			}
		});
	});

	pi.on("session_shutdown", () => {
		if (mouseEnabled) {
			process.stdout.write(MOUSE_OFF);
			mouseEnabled = false;
		}
		unsub?.();
		unsub = undefined;
	});
}
