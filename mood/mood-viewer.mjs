#!/usr/bin/env node

// Agent mood face viewer — scaled ASCII art faces for small panes

import { readFileSync, watchFile } from "node:fs";

const filePath = process.argv[2];
if (!filePath) { process.stderr.write("Usage: mood-viewer.mjs <file>\n"); process.exit(1); }

const ESC = "\x1b[";
const R = `${ESC}0m`;
const DIM = `${ESC}2m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const MAGENTA = `${ESC}35m`;

function goto(r, c) { return `${ESC}${r};${c}H`; }
function clearLine() { return `${ESC}2K`; }
function hideCursor() { return `${ESC}?25l`; }
function showCursor() { return `${ESC}?25h`; }

function colorFace(lines, color) {
	return lines.map(row => {
		let out = "";
		for (const ch of row) {
			if (ch === "▓") out += " ";
			else if (ch === " ") out += " ";
			else out += color + ch + R;
		}
		return out;
	});
}

const RAW = {
	success: [
		"▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▓▓▓▓▓▓▓▓▓▓▓",
		"▓▓▓▓▓▒▒▓▓▓▓▓▓▓▓▓▓▓▒▒▓▓▓▓▓",
		"▓▓▓▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▓▓▓▓",
		"▓▓▓▒▓▓▓▓▓▒▓▓▓▓▓▓▒▓▓▓▓▓▒▓▓▓",
		"▓▓▒▒▒▓▓▓░░░░▓▓░░░░▓▓▓▒▒▒▓▓",
		"▓▓▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▓▓",
		"▓▓▒▒▒▒▒  ░▒▒▒▒▒▒░  ▒▒▒▒▒▓▓",
		"▓▓▓▒▒▒░ ▓▓▓▓▓▓▓▓▓▓ ░▒▒░▓▓▓",
		"▓▓▓▓░▒▒▒ ▓▓▓▓▓▓▓▓ ▒▒▒░▓▓▓▓",
		"▓▓▓▓▓▓░▒▒▒▒▒░░▓▒▒▒▒░▓▓▓▓▓▓",
		"▓▓▓▓▓▓▓▓▓▒░▒▒▒▒░▒▓▓▓▓▓▓▓▓▓",
	],
	error: [
		"          ▒▓▓▓▓▒          ",
		"      ▓▓▓▓▓▓▓▓▓▓▓▓▓▒      ",
		"    ▓▓▓▓░░▓▓▓▓▓▓░▒▓▓▓▒    ",
		"   ▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒   ",
		"  ▒▒▒▓▓░▓▓░▓▓▓▓░▓▓░▓▒▒▒▒  ",
		" ▒▒▒▒▒▒▒░░▓▓▓▓▓▓░░▒▒▒▒▒▒▒ ",
		" ▒▒▒▒▒▒░▒▒▒░▒▒░▒▒▒░▒▒▒▒▒▒ ",
		"  ▒▒▒▒▒▒▒▒▒▒░░▒▒▒▒▒▒▒▒▒▒  ",
		"  ▒▒▒▒▒▒▒▒░░░░░░▒▒▒▒▒▒▒▒  ",
		"   ▒▒▒▒▒▒▒░░░░░░▒▒▒▒▒▒▒   ",
		"     ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒     ",
		"       ▒▒▒▒▒▒▒▒▒▒▒▒       ",
	],
	idle: [
		"          ▒▒▒▒▒▒▒         ",
		"     ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▒▒     ",
		"   ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒   ",
		"  ▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒  ",
		" ▒▒▓▓▓▓▓▓ ▓▓▓▓▓▓ ▓▓▓▓▓▓▒▒ ",
		"▒▒▓▓▓▓▓▓░░▓▓▓▓▓▓░░▓▓▓▓▓▓▒▒",
		"▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒",
		"░▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒░",
		" ▒▒▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒ ",
		" ░▒▒▒▒▒▒▓░░░▓▓░░░▓▒▒▒▒▒▒░ ",
		"   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   ",
		"    ░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░    ",
		"       ░▒▒▒▒▒▒▒▒▒▒░       ",
	],
	surprised: [
		"          ▒▒▒▒▒▒▒         ",
		"     ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▒▒     ",
		"   ▒▒▓░░░░▓▓▓▓▓▓░░░░▓▒▒   ",
		"  ▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒  ",
		" ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒ ",
		"▒▒▓▓▓▓▓▓░░░▓▓▓▓░░░▓▓▓▓▓▓▒▒",
		"▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒",
		"░▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒░",
		" ▒▒▒▒▒▓▓▓▓▓▒▓▓░▓▓▓▓▓▒▒▒▒▒ ",
		" ░▒▒▒▒▒▒▓▓░░░░░░▓▓▒▒▒▒▒▒░ ",
		"  ▓▒▒▒▒▒▒▒░░░░░░▒▒▒▒▒▒▒▒  ",
		"    ░▒▒▒▒▒▒▒░░▒▒▒▒▒▒▒░    ",
		"       ░▒▒▒▒▒▒▒▒▒▒░       ",
	],
	thinking: [
		"          ▓▓▓▓▓▓▓         ",
		"      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓      ",
		"    ▓▓▓░▓▓▓▓░▓▓▓▓▓▓▓▓▓    ",
		"   ▓▓▓▓▓▓░░▓▓▓░░░░░░▓▓▓   ",
		"  ▓▓▓▓▓▓▓░░▓▓▓▓▓░░░▓▓▓▓▓  ",
		"  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ",
		"  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ",
		"  ▓▓▓▓▓▒▒▒▓▓▓▓░░▓▓▓▓▓▓▓▓  ",
		"   ▓▓▓▓▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓   ",
		"    ▓▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▓▓    ",
		"    ▒▒▒▒▒▒▒▒▒▒▓▓▓▓▓▓      ",
		"     ▒▒▒▒▒▒▒▒▒▓▓▓         ",
		"      ▒▒▒▒▒▒▒             ",
	],
	working: [
		"         ▓▓▓▓▓▓▓▓         ",
		"      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓      ",
		"    ▓▓▓▒▓▓░░▓▓░░░░░░▓▓    ",
		"   ▓▓▓▓▓▓░░▓▓░▓▓▓▓▓▓░▓▓   ",
		"   ▓▓▓▓▓░░░▓░░▓▓▓▓▓▓░░░   ",
		"   ▓▓▓▓▓▓▓▓▓▓░░▓▓▓▓░░ ▓   ",
		"   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ▓   ",
		"    ▓▓▓▓▓▓▓▓░░▓▓▓▓▓▓▓     ",
		"     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     ",
		"       ▓▓▓▓▓▓▓▓▓▓▓▓       ",
	],
	reading: [
		"           ▒▒▒▒           ",
		"      ▒▒▓▓▓▓▓▓▓▓▓▓▒▒      ",
		"    ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒    ",
		"   ▒▓▓▓▓▓▓      ▓▓▓▓▓▓▒   ",
		"   ▓▓▓▓░  ▓ ▓▓ ▓ ░ ▓▓▓▓   ",
		" ▒ ▓▓▓▓  ░▒ ▓▓ ░   ▓▓▓▓ ▒ ",
		" ▒▒   ░▒   ▓▓▓▓   ▒░   ▒▒ ",
		"  ▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒  ",
		"  ▒▒▓▓▓▓▓       ▒▓▓▓▓▓▒▒  ",
		"   ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒   ",
		"     ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▒▒     ",
		"         ▒▒▒▒▒▒▒▒         ",
	],
};

const COLORS = {
	success: GREEN,
	error: RED,
	idle: CYAN,
	surprised: YELLOW,
	thinking: YELLOW,
	working: MAGENTA,
	reading: CYAN,
};

const FACES = {};
for (const [key, lines] of Object.entries(RAW)) {
	FACES[key] = {
		art: colorFace(lines, COLORS[key]),
		rawLen: lines.map(r => r.length),
		label: key === "success" ? "success!" : key,
	};
}

let cols = process.stdout.columns || 20;
let rows = process.stdout.rows || 10;
let mood = "idle";

function loadFile() {
	try {
		const raw = readFileSync(filePath, "utf8").trim();
		if (!raw) return;
		const data = JSON.parse(raw);
		mood = data.mood || "idle";
	} catch {}
}

function draw() {
	const face = FACES[mood] || FACES.idle;
	const artLines = face.art;
	const rawLen = face.rawLen;

	const contentH = artLines.length + 2;
	const topPad = Math.max(0, Math.floor((rows - contentH) / 2));

	let buf = hideCursor();
	for (let i = 1; i <= rows; i++) buf += goto(i, 1) + clearLine();

	let row = topPad + 1;
	for (let i = 0; i < artLines.length; i++) {
		if (row > rows - 1) break;
		const pad = Math.max(0, Math.floor((cols - rawLen[i]) / 2));
		buf += goto(row, 1) + " ".repeat(pad) + artLines[i];
		row++;
	}

	row++;
	if (row <= rows) {
		const labelPad = Math.max(0, Math.floor((cols - face.label.length) / 2));
		buf += goto(row, 1) + " ".repeat(labelPad) + `${DIM}${face.label}${R}`;
	}

	process.stdout.write(buf);
}

if (!process.stdin.isTTY) { process.stderr.write("Error: requires a TTY\n"); process.exit(1); }
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdout.write(hideCursor() + `${ESC}2J`);

process.stdin.on("data", (str) => {
	if (str === "q" || str === "\x03") {
		process.stdout.write(showCursor() + `${ESC}2J` + goto(1, 1));
		process.stdin.setRawMode(false);
		process.exit(0);
	}
});

process.stdout.on("resize", () => {
	cols = process.stdout.columns || 20;
	rows = process.stdout.rows || 10;
	draw();
});

process.on("SIGTERM", () => {
	process.stdout.write(showCursor() + `${ESC}2J` + goto(1, 1));
	process.stdin.setRawMode(false);
	process.exit(0);
});

watchFile(filePath, { interval: 300 }, () => { loadFile(); draw(); });
loadFile();
draw();
