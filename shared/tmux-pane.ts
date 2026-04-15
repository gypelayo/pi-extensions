/**
 * Shared tmux pane management utilities.
 * Used by branch-tradeoffs, lazypi, and goals extensions.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export async function isInTmux(pi: ExtensionAPI): Promise<boolean> {
	const r = await pi.exec("tmux", ["display-message", "-p", "#{session_id}"], { timeout: 3000 });
	return r.code === 0;
}

export async function isPaneAlive(pi: ExtensionAPI, paneId: string): Promise<boolean> {
	const r = await pi.exec("tmux", ["has-session", "-t", paneId], { timeout: 3000 });
	return r.code === 0;
}

export async function killPane(pi: ExtensionAPI, paneId: string): Promise<void> {
	await pi.exec("tmux", ["kill-pane", "-t", paneId], { timeout: 3000 });
}

export async function openSplitPane(
	pi: ExtensionAPI,
	command: string,
	widthPercent: number = 40,
): Promise<string | null> {
	const result = await pi.exec("tmux", [
		"split-window", "-h", "-l", `${widthPercent}%`, "-P", "-F", "#{pane_id}",
		command,
	], { timeout: 5000 });

	if (result.code !== 0) return null;
	return result.stdout.trim() || null;
}

export async function setWindowName(pi: ExtensionAPI, name: string): Promise<void> {
	await pi.exec("tmux", ["rename-window", name], { timeout: 2000 });
}

/**
 * Manages a single tmux pane lifecycle.
 */
export class TmuxPane {
	private pi: ExtensionAPI;
	private paneId: string | null = null;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	get id(): string | null { return this.paneId; }
	get isOpen(): boolean { return this.paneId !== null; }

	async isAlive(): Promise<boolean> {
		if (!this.paneId) return false;
		const alive = await isPaneAlive(this.pi, this.paneId);
		if (!alive) this.paneId = null;
		return alive;
	}

	async open(command: string, widthPercent: number = 40): Promise<boolean> {
		if (await this.isAlive()) return true;
		this.paneId = await openSplitPane(this.pi, command, widthPercent);
		return this.paneId !== null;
	}

	async close(): Promise<void> {
		if (this.paneId) {
			try { await killPane(this.pi, this.paneId); } catch {}
			this.paneId = null;
		}
	}

	async toggle(command: string, widthPercent: number = 40): Promise<boolean> {
		if (await this.isAlive()) {
			await this.close();
			return false;
		}
		return this.open(command, widthPercent);
	}
}
