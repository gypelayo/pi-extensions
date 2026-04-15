#!/usr/bin/env node

// Goals viewer — persistent sidebar showing current goal and progress
// Watched file format: JSON { goal, steps: [{ text, done }] }

import { readFileSync, watchFile, unwatchFile } from "node:fs";

const filePath = process.argv[2];
if (!filePath) { process.stderr.write("Usage: goals-viewer.mjs <file>\n"); process.exit(1); }

const ESC = "\x1b[";
const R = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const GRAY = `${ESC}90m`;
const WHITE = `${ESC}37m`;
const STRIKETHROUGH = `${ESC}9m`;
const BG_DARK = `${ESC}48;5;235m`;

function goto(r, c) { return `${ESC}${r};${c}H`; }
function clearLine() { return `${ESC}2K`; }
function hideCursor() { return `${ESC}?25l`; }
function showCursor() { return `${ESC}?25h`; }

let cols = process.stdout.columns || 40;
let rows = process.stdout.rows || 24;
let scrollY = 0;
let data = { goal: "", steps: [] };
let lines = [];

function loadFile() {
	try {
		const raw = readFileSync(filePath, "utf8").trim();
		if (!raw) { data = { goal: "", steps: [] }; }
		else { data = JSON.parse(raw); }
	} catch {
		data = { goal: "", steps: [] };
	}
	buildLines();
}

function wrapText(text, width, indent) {
	if (text.length <= width) return [text];
	const result = [];
	const words = text.split(/( +)/);
	let line = "";
	let lineLen = 0;
	for (const word of words) {
		if (lineLen + word.length > width && lineLen > 0) {
			result.push(line);
			line = indent;
			lineLen = indent.length;
		}
		line += word;
		lineLen += word.length;
	}
	if (line) result.push(line);
	return result.length ? result : [text];
}

function buildLines() {
	lines = [];
	const w = cols - 4;

	// Header
	lines.push("");

	if (!data.goal) {
		lines.push(`  ${GRAY}No goal set${R}`);
		lines.push(`  ${GRAY}Use /goal <description>${R}`);
		lines.push("");
		return;
	}

	// Goal
	const goalLines = wrapText(data.goal, w, "  ");
	for (const gl of goalLines) {
		lines.push(`  ${BOLD}${WHITE}${gl}${R}`);
	}
	lines.push("");

	// Progress bar
	if (data.steps.length > 0) {
		const done = data.steps.filter(s => s.done).length;
		const total = data.steps.length;
		const pct = Math.round((done / total) * 100);
		const barWidth = Math.min(w - 8, 30);
		const filled = Math.round((done / total) * barWidth);
		const bar = `${GREEN}${"█".repeat(filled)}${GRAY}${"░".repeat(barWidth - filled)}${R}`;
		lines.push(`  ${bar} ${WHITE}${pct}%${R}`);
		lines.push(`  ${GRAY}${done}/${total} steps${R}`);
		lines.push("");
	}

	// Steps
	const currentIdx = data.steps.findIndex(s => !s.done);

	for (let i = 0; i < data.steps.length; i++) {
		const step = data.steps[i];
		const isCurrent = i === currentIdx;

		let prefix, style;
		if (step.done) {
			prefix = `${GREEN}✓${R}`;
			style = `${GRAY}${STRIKETHROUGH}`;
		} else if (isCurrent) {
			prefix = `${YELLOW}▸${R}`;
			style = `${BOLD}${WHITE}`;
		} else {
			prefix = `${GRAY}○${R}`;
			style = `${GRAY}`;
		}

		const stepLines = wrapText(step.text, w - 4, "      ");
		lines.push(`  ${prefix} ${style}${stepLines[0]}${R}`);
		for (let j = 1; j < stepLines.length; j++) {
			lines.push(`    ${style}${stepLines[j]}${R}`);
		}
	}

	lines.push("");
}

function draw() {
	const contentHeight = rows - 3;
	const maxScroll = Math.max(0, lines.length - contentHeight);
	if (scrollY > maxScroll) scrollY = maxScroll;

	let buf = hideCursor();

	// Header
	buf += goto(1, 1) + clearLine();
	buf += `  ${BOLD}${CYAN}◎ Goal${R}  ${GRAY}/goal toggle  q close  j/k scroll${R}`;

	buf += goto(2, 1) + clearLine();
	buf += `  ${GRAY}${"─".repeat(Math.min(cols - 4, 50))}${R}`;

	// Content
	for (let i = 0; i < contentHeight; i++) {
		const idx = scrollY + i;
		buf += goto(i + 3, 1) + clearLine();
		if (idx < lines.length) buf += lines[idx];
	}

	// Status
	buf += goto(rows, 1) + clearLine();
	if (data.steps.length > 0) {
		const done = data.steps.filter(s => s.done).length;
		buf += `  ${GRAY}${done}/${data.steps.length} done${R}`;
	}

	process.stdout.write(buf);
}

function handleInput(data) {
	const str = data.toString();
	const contentHeight = rows - 3;
	const maxScroll = Math.max(0, lines.length - contentHeight);

	switch (str) {
		case "q": case "\x03":
			process.stdout.write(showCursor() + `${ESC}2J` + goto(1, 1));
			process.stdin.setRawMode(false);
			process.exit(0);
			break;
		case "j": case "\x1b[B":
			scrollY = Math.min(maxScroll, scrollY + 1); draw(); break;
		case "k": case "\x1b[A":
			scrollY = Math.max(0, scrollY - 1); draw(); break;
		case "g":
			scrollY = 0; draw(); break;
		case "G":
			scrollY = maxScroll; draw(); break;
		case "r":
			loadFile(); draw(); break;
	}
}

// Setup
if (!process.stdin.isTTY) { process.stderr.write("Error: requires a TTY\n"); process.exit(1); }

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

watchFile(filePath, { interval: 500 }, () => { loadFile(); draw(); });

loadFile();
draw();
