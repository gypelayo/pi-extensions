/**
 * Show Shortcuts Extension
 *
 * Displays keyboard shortcuts via a scrollable select dialog.
 *
 * Usage:
 *   - Type /shortcuts in the prompt  (or /?)
 *   - Press ctrl+/ at any time
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ────────────────────────────────────────────────────────────────────────────
// Data
// ────────────────────────────────────────────────────────────────────────────

const GROUPS: { title: string; entries: { key: string; description: string }[] }[] = [
	{
		title: "Application",
		entries: [
			{ key: "Escape", description: "Cancel / abort" },
			{ key: "Ctrl+C", description: "Clear editor" },
			{ key: "Ctrl+D", description: "Exit (when editor is empty)" },
			{ key: "Ctrl+Z", description: "Suspend to background" },
			{ key: "Ctrl+G", description: "Open in external editor" },
			{ key: "Ctrl+V / Alt+V", description: "Paste image from clipboard" },
		],
	},
	{
		title: "Cursor Movement",
		entries: [
			{ key: "Up / Down", description: "Move cursor up / down" },
			{ key: "Left / Right  |  Ctrl+B/F", description: "Move cursor left / right" },
			{ key: "Alt+Left / Alt+Right", description: "Move cursor word left / right" },
			{ key: "Home / Ctrl+A", description: "Move to line start" },
			{ key: "End / Ctrl+E", description: "Move to line end" },
			{ key: "Ctrl+]", description: "Jump forward to character" },
			{ key: "Ctrl+Alt+]", description: "Jump backward to character" },
			{ key: "PageUp / PageDown", description: "Scroll by page" },
		],
	},
	{
		title: "Editing",
		entries: [
			{ key: "Backspace", description: "Delete character backward" },
			{ key: "Delete / Ctrl+D", description: "Delete character forward" },
			{ key: "Ctrl+W / Alt+Backspace", description: "Delete word backward" },
			{ key: "Alt+D / Alt+Delete", description: "Delete word forward" },
			{ key: "Ctrl+U", description: "Delete to line start" },
			{ key: "Ctrl+K", description: "Delete to line end" },
			{ key: "Ctrl+Y", description: "Yank (paste killed text)" },
			{ key: "Alt+Y", description: "Cycle through killed text" },
			{ key: "Ctrl+-", description: "Undo last edit" },
		],
	},
	{
		title: "Input & Clipboard",
		entries: [
			{ key: "Enter", description: "Submit message" },
			{ key: "Shift+Enter", description: "Insert new line" },
			{ key: "Tab", description: "Autocomplete" },
			{ key: "Ctrl+C", description: "Copy selection" },
			{ key: "Alt+Enter", description: "Queue follow-up message" },
			{ key: "Alt+Up", description: "Restore queued messages to editor" },
		],
	},
	{
		title: "Models & Thinking",
		entries: [
			{ key: "Ctrl+L", description: "Open model selector" },
			{ key: "Ctrl+P", description: "Cycle to next model" },
			{ key: "Ctrl+Shift+P", description: "Cycle to previous model" },
			{ key: "Shift+Tab", description: "Cycle thinking level" },
			{ key: "Ctrl+T", description: "Collapse / expand thinking blocks" },
		],
	},
	{
		title: "Session",
		entries: [
			{ key: "Ctrl+P", description: "Toggle path display" },
			{ key: "Ctrl+S", description: "Toggle sort mode" },
			{ key: "Ctrl+N", description: "Toggle named-only filter" },
			{ key: "Ctrl+R", description: "Rename session" },
			{ key: "Ctrl+D", description: "Delete session" },
			{ key: "Ctrl+Backspace", description: "Delete session (query empty)" },
		],
	},
	{
		title: "Tree Navigation",
		entries: [
			{ key: "Ctrl+Left / Alt+Left", description: "Fold or jump to previous" },
			{ key: "Ctrl+Right / Alt+Right", description: "Unfold or jump to next" },
			{ key: "Shift+L", description: "Edit label on selected node" },
			{ key: "Shift+T", description: "Toggle label timestamps" },
		],
	},
	{
		title: "Display",
		entries: [{ key: "Ctrl+O", description: "Collapse / expand tool output" }],
	},
	{
		title: "Commands",
		entries: [
			{ key: "/shortcuts  (or /?)", description: "Show this list" },
			{ key: "/new", description: "Start a new session" },
			{ key: "/fork", description: "Fork current session" },
			{ key: "/resume", description: "Open session resume picker" },
			{ key: "/tree", description: "Open session tree navigator" },
			{ key: "/compact", description: "Compact the conversation" },
			{ key: "/model", description: "Open model selector" },
			{ key: "/settings", description: "Open settings" },
			{ key: "/reload", description: "Reload extensions / skills / themes" },
		],
	},
];

function buildSelectItems(): string[] {
	const items: string[] = [];
	for (const g of GROUPS) {
		items.push(`── ${g.title} ──`);
		for (const e of g.entries) {
			// Pad key to ~30 chars for alignment
			const keyPad = e.key + " ".repeat(Math.max(1, 30 - e.key.length));
			items.push(`  ${keyPad}  ${e.description}`);
		}
	}
	return items;
}

const SELECT_ITEMS = buildSelectItems();

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

async function showShortcuts(ctx: ExtensionContext | ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) return;
	await ctx.ui.select("Keyboard Shortcuts  (Esc to close)", SELECT_ITEMS);
}

export default function (pi: ExtensionAPI) {
	// registerCommand handler signature is (args, ctx) — different from shortcut (ctx)
	const cmdHandler = (_args: string, ctx: ExtensionCommandContext) => showShortcuts(ctx);
	pi.registerCommand("shortcuts", { description: "Show keyboard shortcuts", handler: cmdHandler });
	pi.registerCommand("?", { description: "Show keyboard shortcuts", handler: cmdHandler });
}
