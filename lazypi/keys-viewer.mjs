#!/usr/bin/env node

// lazypi keys — Interactive keyboard shortcut reference
// Spawned in a tmux pane by the lazypi extension

const ESC = "\x1b[";
const R = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const INVERSE = `${ESC}7m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const MAGENTA = `${ESC}35m`;
const BLUE = `${ESC}34m`;
const GRAY = `${ESC}90m`;
const WHITE = `${ESC}37m`;
const BG_KEY = `${ESC}48;5;238m${ESC}1m`;

function goto(r, c) { return `${ESC}${r};${c}H`; }
function clearLine() { return `${ESC}2K`; }
function hideCursor() { return `${ESC}?25l`; }
function showCursor() { return `${ESC}?25h`; }

// ─── Data ────────────────────────────────────────────────────────────

const GROUPS = [
	{
		title: "Input",
		color: CYAN,
		keys: [
			["Enter", "Send message"],
			["Shift+Enter", "New line"],
			["Alt+Enter", "Queue follow-up"],
			["Tab", "Autocomplete"],
			["Esc", "Cancel / abort"],
			["Ctrl+C", "Clear editor"],
		],
	},
	{
		title: "Navigation",
		color: GREEN,
		keys: [
			["↑ / ↓", "Move cursor"],
			["← / →", "Move character"],
			["Alt+← / Alt+→", "Move word"],
			["Home / Ctrl+A", "Line start"],
			["End / Ctrl+E", "Line end"],
			["PgUp / PgDn", "Scroll page"],
		],
	},
	{
		title: "Editing",
		color: YELLOW,
		keys: [
			["Ctrl+W", "Delete word ←"],
			["Alt+D", "Delete word →"],
			["Ctrl+U", "Delete to start"],
			["Ctrl+K", "Delete to end"],
			["Ctrl+Y", "Yank (paste)"],
			["Ctrl+-", "Undo"],
		],
	},
	{
		title: "Models & Thinking",
		color: MAGENTA,
		keys: [
			["Ctrl+L", "Model selector"],
			["Ctrl+P", "Cycle model →"],
			["Shift+Ctrl+P", "Cycle model ←"],
			["Shift+Tab", "Cycle thinking"],
			["Ctrl+T", "Toggle thinking"],
		],
	},
	{
		title: "Session",
		color: BLUE,
		keys: [
			["Ctrl+O", "Toggle tool output"],
			["Ctrl+D", "Exit (editor empty)"],
			["Ctrl+Z", "Suspend"],
			["Ctrl+V", "Paste image"],
			["Ctrl+G", "External editor"],
		],
	},
	{
		title: "Commands",
		color: CYAN,
		keys: [
			["/model", "Switch model"],
			["/settings", "Settings"],
			["/new", "New session"],
			["/resume", "Resume session"],
			["/fork", "Fork session"],
			["/tree", "Tree navigator"],
			["/compact", "Compact context"],
			["/reload", "Reload extensions"],
			["/tradeoffs", "Branch analysis"],
			["/goal", "Toggle goals pane"],
			["/safe", "Toggle safe mode"],
			["/mood", "Toggle mood face"],
			["/keys", "Toggle this pane"],
		],
	},
];

// ─── State ───────────────────────────────────────────────────────────

let cols = process.stdout.columns || 40;
let rows = process.stdout.rows || 24;
let scrollY = 0;
let allLines = [];
let mode = "normal";
let searchQuery = "";
let filteredLines = null;

// ─── Build content lines ─────────────────────────────────────────────

function buildLines() {
	allLines = [];
	const keyWidth = 18;

	for (const group of GROUPS) {
		allLines.push("");
		allLines.push(`  ${group.color}${BOLD}${group.title}${R}`);

		for (const [key, desc] of group.keys) {
			const keyStr = `${BG_KEY} ${key} ${R}`;
			const pad = " ".repeat(Math.max(1, keyWidth - key.length - 2));
			allLines.push(`   ${keyStr}${pad}${GRAY}${desc}${R}`);
		}
	}
	allLines.push("");
}

function getDisplayLines() {
	return filteredLines !== null ? filteredLines : allLines;
}

// ─── Filter ──────────────────────────────────────────────────────────

function applyFilter() {
	if (!searchQuery) { filteredLines = null; return; }
	const q = searchQuery.toLowerCase();
	filteredLines = [];
	const keyWidth = 18;

	for (const group of GROUPS) {
		const matching = group.keys.filter(([key, desc]) =>
			key.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
		);
		if (matching.length === 0) continue;

		filteredLines.push("");
		filteredLines.push(`  ${group.color}${BOLD}${group.title}${R}`);
		for (const [key, desc] of matching) {
			const keyStr = `${BG_KEY} ${key} ${R}`;
			const pad = " ".repeat(Math.max(1, keyWidth - key.length - 2));
			filteredLines.push(`   ${keyStr}${pad}${GRAY}${desc}${R}`);
		}
	}

	if (filteredLines.length === 0) {
		filteredLines.push("");
		filteredLines.push(`  ${GRAY}No matches${R}`);
	}
	filteredLines.push("");
}

// ─── Draw ────────────────────────────────────────────────────────────
// Layout: row 1 = header, row 2 = separator, rows 3..rows-1 = content, row rows = status

function draw() {
	const displayLines = getDisplayLines();
	const contentHeight = rows - 3; // rows 3 through rows-1
	const maxScroll = Math.max(0, displayLines.length - contentHeight);
	if (scrollY > maxScroll) scrollY = maxScroll;

	let buf = hideCursor();

	// Row 1: title + key hints (always visible)
	buf += goto(1, 1) + clearLine();
	buf += `  ${BOLD}${CYAN}⌨ pi keys${R}`;
	buf += `  ${INVERSE} j/k ${R}${GRAY} scroll ${R}`;
	buf += `${INVERSE} / ${R}${GRAY} filter ${R}`;
	buf += `${INVERSE} q ${R}${GRAY} close${R}`;

	// Row 2: separator
	buf += goto(2, 1) + clearLine();
	buf += `  ${GRAY}${"─".repeat(Math.min(cols - 4, 50))}${R}`;

	// Content area: rows 3 to rows-1
	for (let i = 0; i < contentHeight; i++) {
		const idx = scrollY + i;
		buf += goto(i + 3, 1) + clearLine();
		if (idx < displayLines.length) {
			buf += displayLines[idx];
		}
	}

	// Last row: status bar
	buf += goto(rows, 1) + clearLine();
	if (mode === "search") {
		buf += `  ${INVERSE} / ${R} ${searchQuery}█`;
	} else {
		const pct = displayLines.length <= contentHeight ? "All" :
			scrollY === 0 ? "Top" :
			scrollY >= maxScroll ? "Bot" :
			`${Math.round((scrollY / maxScroll) * 100)}%`;
		buf += `  ${GRAY}${pct}${R}`;
	}

	process.stdout.write(buf);
}

// ─── Input ───────────────────────────────────────────────────────────

function handleInput(data) {
	const str = data.toString();

	if (mode === "search") {
		if (str === "\r" || str === "\n") {
			mode = "normal";
			applyFilter();
			scrollY = 0;
			draw();
		} else if (str === "\x1b" || str === "\x03") {
			mode = "normal";
			searchQuery = "";
			filteredLines = null;
			scrollY = 0;
			draw();
		} else if (str === "\x7f" || str === "\b") {
			searchQuery = searchQuery.slice(0, -1);
			applyFilter();
			scrollY = 0;
			draw();
		} else if (str.length === 1 && str.charCodeAt(0) >= 32) {
			searchQuery += str;
			applyFilter();
			scrollY = 0;
			draw();
		}
		return;
	}

	const displayLines = getDisplayLines();
	const contentHeight = rows - 3;
	const maxScroll = Math.max(0, displayLines.length - contentHeight);
	const halfPage = Math.floor(contentHeight / 2);

	switch (str) {
		case "q": case "\x03": case "\x1b":
			process.stdout.write(showCursor() + `${ESC}2J` + goto(1, 1));
			process.stdin.setRawMode(false);
			process.exit(0);
			break;
		case "j": case "\x1b[B":
			scrollY = Math.min(maxScroll, scrollY + 1); draw(); break;
		case "k": case "\x1b[A":
			scrollY = Math.max(0, scrollY - 1); draw(); break;
		case "d": case "\x1b[6~":
			scrollY = Math.min(maxScroll, scrollY + halfPage); draw(); break;
		case "u": case "\x1b[5~":
			scrollY = Math.max(0, scrollY - halfPage); draw(); break;
		case "g": case "\x1b[H":
			scrollY = 0; draw(); break;
		case "G": case "\x1b[F":
			scrollY = maxScroll; draw(); break;
		case "/":
			mode = "search"; searchQuery = ""; draw(); break;
		case "c":
			searchQuery = ""; filteredLines = null; scrollY = 0; draw(); break;
	}
}

// ─── Setup ───────────────────────────────────────────────────────────

if (!process.stdin.isTTY) {
	process.stderr.write("Error: requires a TTY\n");
	process.exit(1);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdout.write(hideCursor() + `${ESC}2J`);

process.stdin.on("data", handleInput);
process.stdout.on("resize", () => {
	cols = process.stdout.columns || 40;
	rows = process.stdout.rows || 24;
	buildLines();
	draw();
});
process.on("SIGTERM", () => {
	process.stdout.write(showCursor() + `${ESC}2J` + goto(1, 1));
	process.stdin.setRawMode(false);
	process.exit(0);
});

buildLines();
draw();
