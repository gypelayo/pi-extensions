#!/usr/bin/env node

import { readFileSync, watchFile } from "node:fs";

const filePath = process.argv[2];
if (!filePath) { process.stderr.write("Usage: mood-viewer.mjs <file>\n"); process.exit(1); }

const ESC = "\x1b[";
const R   = `${ESC}0m`;
const DIM = `${ESC}2m`;
const CYAN    = `${ESC}36m`;
const GREEN   = `${ESC}32m`;
const YELLOW  = `${ESC}33m`;
const RED     = `${ESC}31m`;
const MAGENTA = `${ESC}35m`;

function goto(r, c)  { return `${ESC}${r};${c}H`; }
function clearLine() { return `${ESC}2K`; }
function hideCursor(){ return `${ESC}?25l`; }
function showCursor(){ return `${ESC}?25h`; }

function colorFace(lines, color) {
	return lines.map(row => {
		let out = "";
		for (const ch of row) {
			if (ch === "▓" || ch === " ") out += " ";
			else out += color + ch + R;
		}
		return out;
	});
}

// ─── Idle animation ────────────────────────────────────────────────────────

// Write characters into a 21-char inner buffer, return bordered row
function makeRow(placements) {
	const inner = Array(21).fill(" ");
	for (const [pos, str] of placements) {
		for (let i = 0; i < str.length; i++) {
			if (pos + i >= 0 && pos + i < 21) inner[pos + i] = str[i];
		}
	}
	return "█" + inner.join("") + "█";
}

// shift > 0 = look right, shift < 0 = look left
// The entire box is padded left/right so it visually shifts
function applyShift(row, shift) {
    // Keeps border walls (█) at both ends
    if (row.length < 3) return row;
    const L = row[0], R = row[row.length-1];
    const body = row.slice(1, -1);
    if (shift > 0)
        return L + ' '.repeat(shift) + body.slice(0, 21-shift) + R;
    if (shift < 0)
        return L + body.slice(-shift) + ' '.repeat(-shift) + R;
    return row;
}

function buildIdleFrame(shift, eyeTop, eyeBot) {
	const LE = 6 + shift;
	const RE = 12 + shift;
	return [
		"███████████████████████",
		"█                     █",
		"█                     █",
		makeRow([[LE, eyeTop], [RE, eyeTop]]),
		makeRow([[LE, eyeBot], [RE, eyeBot]]),
		"█                     █",
		"█                     █",
		makeRow([[16 + shift, "██"]]),
		makeRow([[14 + shift, "███"]]),
		makeRow([[7  + shift, "████████"]]),
		"█                     █",
		"█                     █",
		"███████████████████████",
	];
}

// [shift, eyeTop, eyeBot, ms]
const IDLE_SEQ = [
	[ 0, "██", "██", 2200],
	[ 2, "██", "██",  700],
	[ 0, "██", "██",  400],
	[ 0, "▄▄", "  ",   80],
	[ 0, "  ", "  ",  120],
	[ 0, "▄▄", "  ",   80],
	[ 0, "██", "██", 2800],
	[ 0, "  ", "██",  600],
	[ 0, "██", "██",  400],
	[-2, "██", "██",  700],
	[ 0, "██", "██",  400],
	[ 0, "▄▄", "  ",   80],
	[ 0, "  ", "  ",  100],
	[ 0, "▄▄", "  ",   80],
	[ 0, "██", "██", 1800],
];

const IDLE_FRAMES = IDLE_SEQ.map(([shift, eyeTop, eyeBot, duration]) => ({
	art: colorFace(buildIdleFrame(shift, eyeTop, eyeBot), CYAN),
	rawLen: buildIdleFrame(shift, eyeTop, eyeBot).map(r => r.length),
	label: "idle",
	duration,
}));

// ─── Static faces ──────────────────────────────────────────────────────────

const RAW = {
	thinking: [
		// Frame 1
		[
		"███████████████████████",
		"█                     █",
		"█    ▀▀▀▀▀▀           █",
		"█      ██   ▀██▀▀     █",
		"█      ██    ██       █",
		"█                     █",
		"█                ▄    █",
		"█          ███████    █",
		"█      ██             █",
		"█   █████████         █",
		"█    ██████           █",
		"█                     █",
		"███████████████████████",
		],
		// Frame 2
		[
		"███████████████████████",
		"█                     █",
		"█    ▀▀▀▀▀▀           █",
		"█      ██   ▀██▀▀     █",
		"█      ██    ██       █",
		"█                     █",
		"█                ▄    █",
		"█          ███████    █",
		"█      ██             █",
		"█   ████████          █",
		"█    █████            █",
		"█                     █",
		"███████████████████████",
		],
	],
	working: [
		// Frame 1 — at desk
		[
		"███████████████████████",
		"█                     █",
		"█                     █",
		"█     ▀██▀  ▀██▀      █",
		"█      ██    ██       █",
		"█                     █",
		"█          ▒       ▒  █",
		"█                     █",
		"█              ▒   ▒  █",
		"█         █████████████",
		"█                     █",
		"█                     █",
		"███████████████████████",
		],
		// Frame 2 — leaning in
		[
		"███████████████████████",
		"█                     █",
		"█                     █",
		"█     ▀██▀  ▀██▀      █",
		"█      ██    ██     ███",
		"█                ████ █",
		"█              ██     █",
		"█           ███       █",
		"█          ██         █",
		"█        ██           █",
		"█                     █",
		"█                     █",
		"███████████████████████",
		],
	],
};

const COLORS = {
	idle: CYAN,
	thinking: YELLOW,
	working: MAGENTA,
};

const FACES = {};
for (const [key, lines] of Object.entries(RAW)) {
	if ((key === "thinking" || key === "working") && Array.isArray(lines[0])) {
		FACES[key] = lines.map(frame => ({
			art: colorFace(frame, COLORS[key] || CYAN),
			rawLen: frame.map(r => r.length),
			label: key,
		}));
	} else {
		FACES[key] = {
			art: colorFace(lines, COLORS[key] || CYAN),
			rawLen: lines.map(r => r.length),
			label: key === "success" ? "success!" : key,
		};
	}
}

// ─── State ─────────────────────────────────────────────────────────────────

let cols = process.stdout.columns || 40;
let rows = process.stdout.rows || 20;
let mood = "idle";
let idleFrameIdx = 0;
let animTimer = null;

// ─── Animation ─────────────────────────────────────────────────────────────

function scheduleNextFrame() {
	if (animTimer) clearTimeout(animTimer);
	if (mood === "idle") {
		const frame = IDLE_FRAMES[idleFrameIdx];
		animTimer = setTimeout(() => {
			idleFrameIdx = (idleFrameIdx + 1) % IDLE_FRAMES.length;
			draw();
			scheduleNextFrame();
		}, frame.duration);
	} else if (mood === "thinking" && Array.isArray(FACES.thinking)) {
		animTimer = setTimeout(() => {
			thinkingFrameIdx = (thinkingFrameIdx + 1) % FACES.thinking.length;
			draw();
			scheduleNextFrame();
		}, 600);
	} else if (mood === "working" && Array.isArray(FACES.working)) {
		animTimer = setTimeout(() => {
			workingFrameIdx = (workingFrameIdx + 1) % FACES.working.length;
			draw();
			scheduleNextFrame();
		}, 900);
	}
}

function startAnim() {
	idleFrameIdx = 0;
	scheduleNextFrame();
}

function stopAnim() {
	if (animTimer) { clearTimeout(animTimer); animTimer = null; }
}

// ─── Render ────────────────────────────────────────────────────────────────

let thinkingFrameIdx = 0;
let workingFrameIdx = 0;

function draw() {
	let face;
	let idleShift = 0;
	if (mood === "idle") {
		face = IDLE_FRAMES[idleFrameIdx];
		const F = IDLE_SEQ[IDLE_FRAMES[idleFrameIdx]?._seqIdx ?? idleFrameIdx];
		if (F) idleShift = F[0];
	} else if (mood === "thinking" && Array.isArray(FACES.thinking)) {
		face = FACES.thinking[thinkingFrameIdx];
	} else if (mood === "working" && Array.isArray(FACES.working)) {
		face = FACES.working[workingFrameIdx];
	} else {
		face = FACES.thinking[0];
	}

	const artLines = face.art;
	const rawLen   = face.rawLen;
	const contentH = artLines.length + 2;
	const topPad   = Math.max(0, Math.floor((rows - contentH) / 2));

	let buf = hideCursor();
	for (let i = 1; i <= rows; i++) buf += goto(i, 1) + clearLine();

	let row = topPad + 1;
	for (let i = 0; i < artLines.length; i++) {
		if (row > rows - 1) break;
		const pad = Math.max(0, Math.floor((cols - rawLen[i]) / 2));
		buf += goto(row, 1) + " ".repeat(pad) + (idleShift > 0 ? ' '.repeat(idleShift) : '') + artLines[i] + (idleShift < 0 ? ' '.repeat(-idleShift) : '');
		row++;
	}

	row++;
	if (row <= rows) {
		const lbl = face.label;
		const lblPad = Math.max(0, Math.floor((cols - lbl.length) / 2));
		buf += goto(row, 1) + " ".repeat(lblPad) + `${DIM}${lbl}${R}`;
	}

	process.stdout.write(buf);
}

// ─── Init ──────────────────────────────────────────────────────────────────

function loadFile() {
	try {
		const raw = readFileSync(filePath, "utf8").trim();
		if (!raw) return;
		const data = JSON.parse(raw);
		const newMood = data.mood || "idle";
		if (newMood !== mood) {
			mood = newMood;
			if (mood === "idle" || mood === "thinking" || mood === "working") startAnim();
			else stopAnim();
		}
	} catch {}
}

if (!process.stdin.isTTY) { process.stderr.write("Error: requires a TTY\n"); process.exit(1); }
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdout.write(hideCursor() + `${ESC}2J`);

process.stdin.on("data", (str) => {
	if (str === "q" || str === "\x03") {
		stopAnim();
		process.stdout.write(showCursor() + `${ESC}2J` + goto(1, 1));
		process.stdin.setRawMode(false);
		process.exit(0);
	}
});

process.stdout.on("resize", () => {
	cols = process.stdout.columns || 40;
	rows = process.stdout.rows || 20;
	draw();
});

process.on("SIGTERM", () => {
	stopAnim();
	process.stdout.write(showCursor() + `${ESC}2J` + goto(1, 1));
	process.stdin.setRawMode(false);
	process.exit(0);
});

watchFile(filePath, { interval: 300 }, () => { loadFile(); draw(); });
loadFile();
draw();
startAnim();
