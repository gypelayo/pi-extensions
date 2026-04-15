#!/usr/bin/env node

// lazypi - Interactive branch tradeoffs viewer
// Spawned by the branch-tradeoffs pi extension in a tmux pane

import { readFileSync, watchFile, unwatchFile } from "node:fs";

const filePath = process.argv[2];
if (!filePath) {
	process.stderr.write("Usage: viewer.mjs <file>\n");
	process.exit(1);
}

// ─── State ───────────────────────────────────────────────────────────

let lines = [];        // rendered ANSI lines
let rawLines = [];     // raw markdown lines (for search)
let sections = [];     // { lineIndex, title } for heading navigation
let scrollY = 0;
let cols = process.stdout.columns || 80;
let rows = process.stdout.rows || 24;
let mode = "normal";   // "normal" | "help" | "search"
let searchQuery = "";
let searchMatches = []; // line indices
let searchIndex = -1;
let currentSection = 0;
let message = "";      // transient status message
let messageTimer = null;

// ─── ANSI helpers ────────────────────────────────────────────────────

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;
const INVERSE = `${ESC}7m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const MAGENTA = `${ESC}35m`;
const BLUE = `${ESC}34m`;
const GRAY = `${ESC}90m`;
const WHITE = `${ESC}37m`;
const BG_GRAY = `${ESC}48;5;236m`;
const BG_BLUE = `${ESC}48;5;24m`;
const BG_DARK = `${ESC}48;5;235m`;

function goto(r, c) { return `${ESC}${r};${c}H`; }
function clearScreen() { return `${ESC}2J${ESC}H`; }
function hideCursor() { return `${ESC}?25l`; }
function showCursor() { return `${ESC}?25h`; }

// ─── ANSI-aware word wrap ────────────────────────────────────────────

function visibleLength(str) {
	// Strip ANSI escape sequences to get visible character count
	return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function wrapLine(line, width) {
	if (width <= 4) return [line];
	if (visibleLength(line) <= width) return [line];

	// Split into tokens: ANSI sequences and visible characters
	const result = [];
	let currentLine = "";
	let currentVisible = 0;
	let activeStyles = ""; // track open ANSI styles

	// Split into words (preserving leading whitespace)
	const leadingSpace = line.match(/^(\s*)/)?.[0] || "";
	const words = line.trimStart().split(/( +)/);
	const indent = "  "; // continuation indent

	for (const word of words) {
		const wordVisible = visibleLength(word);

		if (currentVisible + wordVisible > width && currentVisible > 0) {
			// Wrap: finish current line, start new one
			result.push(currentLine + RESET);
			currentLine = activeStyles + indent;
			currentVisible = indent.length;
		}

		currentLine += word;
		currentVisible += wordVisible;

		// Track ANSI style state
		const ansiMatches = word.matchAll(/\x1b\[([0-9;]*)m/g);
		for (const m of ansiMatches) {
			if (m[1] === "0" || m[1] === "") {
				activeStyles = "";
			} else {
				activeStyles += m[0];
			}
		}
	}

	if (currentLine) result.push(currentLine);
	return result.length > 0 ? result : [line];
}

// ─── Markdown → ANSI rendering ──────────────────────────────────────

function renderMarkdown(text) {
	const mdLines = text.split("\n");
	rawLines = mdLines;
	const rendered = [];
	sections.length = 0;
	let inCodeBlock = false;
	let codeBlockLang = "";

	for (let i = 0; i < mdLines.length; i++) {
		let line = mdLines[i];

		// Code blocks
		if (line.startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			if (inCodeBlock) {
				codeBlockLang = line.slice(3).trim();
				rendered.push(`${GRAY}${"─".repeat(Math.min(60, cols - 4))}${RESET}`);
			} else {
				rendered.push(`${GRAY}${"─".repeat(Math.min(60, cols - 4))}${RESET}`);
			}
			continue;
		}

		if (inCodeBlock) {
			rendered.push(`${DIM}  ${line}${RESET}`);
			continue;
		}

		// Headings
		const h1Match = line.match(/^# (.+)/);
		const h2Match = line.match(/^## (.+)/);
		const h3Match = line.match(/^### (.+)/);

		if (h1Match) {
			sections.push({ lineIndex: rendered.length, title: h1Match[1] });
			rendered.push("");
			rendered.push(`${BOLD}${CYAN}█ ${h1Match[1].toUpperCase()}${RESET}`);
			rendered.push(`${CYAN}${"─".repeat(Math.min(h1Match[1].length + 2, cols - 2))}${RESET}`);
			continue;
		}
		if (h2Match) {
			sections.push({ lineIndex: rendered.length, title: h2Match[1] });
			rendered.push("");
			rendered.push(`${BOLD}${YELLOW}▌ ${h2Match[1]}${RESET}`);
			continue;
		}
		if (h3Match) {
			sections.push({ lineIndex: rendered.length, title: h3Match[1] });
			rendered.push(`${BOLD}${GREEN}  ▸ ${h3Match[1]}${RESET}`);
			continue;
		}

		// Horizontal rule
		if (line.match(/^---+$/) || line.match(/^\*\*\*+$/)) {
			rendered.push(`${GRAY}${"─".repeat(Math.min(60, cols - 4))}${RESET}`);
			continue;
		}

		// Bullet points
		const bulletMatch = line.match(/^(\s*)[*-] (.+)/);
		if (bulletMatch) {
			const indent = bulletMatch[1];
			const content = renderInline(bulletMatch[2]);
			const bullet = indent.length > 1 ? "◦" : "•";
			rendered.push(`${indent}${CYAN}${bullet}${RESET} ${content}`);
			continue;
		}

		// Blockquotes
		if (line.startsWith("> ")) {
			rendered.push(`${GRAY}│${RESET} ${ITALIC}${renderInline(line.slice(2))}${RESET}`);
			continue;
		}

		// Regular text with inline formatting
		rendered.push(renderInline(line));
	}

	// Word-wrap all lines to fit pane width
	const wrapped = [];
	for (const line of rendered) {
		const w = wrapLine(line, cols - 2);
		for (const wl of w) wrapped.push(wl);
	}

	lines = wrapped;
}

function renderInline(text) {
	return text
		// Bold + italic
		.replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD}${ITALIC}$1${RESET}`)
		// Bold
		.replace(/\*\*(.+?)\*\*/g, `${BOLD}${WHITE}$1${RESET}`)
		// Italic
		.replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`)
		// Inline code
		.replace(/`([^`]+)`/g, `${BG_DARK}${GREEN} $1 ${RESET}`)
		// Links
		.replace(/\[(.+?)\]\((.+?)\)/g, `${UNDERLINE}${BLUE}$1${RESET}`);
}

// ─── Load file ───────────────────────────────────────────────────────

function loadFile() {
	try {
		const content = readFileSync(filePath, "utf8");
		renderMarkdown(content);
		// Clamp scroll
		const maxScroll = Math.max(0, lines.length - viewHeight());
		if (scrollY > maxScroll) scrollY = maxScroll;
	} catch (e) {
		lines = [`${RED}Error reading file: ${e.message}${RESET}`];
		rawLines = [e.message];
		sections.length = 0;
	}
}

// ─── Drawing ─────────────────────────────────────────────────────────

function viewHeight() {
	return rows - 2; // reserve 2 lines for status bar
}

function draw() {
	let buf = hideCursor() + goto(1, 1);
	const vh = viewHeight();

	// Content area
	for (let i = 0; i < vh; i++) {
		const lineIdx = scrollY + i;
		buf += goto(i + 1, 1) + `${ESC}2K`; // clear line
		if (lineIdx < lines.length) {
			// Highlight search matches
			let line = lines[lineIdx];
			if (searchMatches.includes(lineIdx)) {
				line = `${BG_BLUE}${line}${RESET}`;
			}
			buf += `  ${line}`;
		}
	}

	// Status bar (2 lines from bottom)
	buf += drawStatusBar();

	process.stdout.write(buf);
}

function drawStatusBar() {
	let buf = "";
	const y1 = rows - 1;
	const y2 = rows;

	// Line 1: section indicator + scroll position
	buf += goto(y1, 1) + `${ESC}2K`;
	const sectionName = getCurrentSectionName();
	const scrollPct = lines.length <= viewHeight() ? "All" :
		scrollY === 0 ? "Top" :
		scrollY >= lines.length - viewHeight() ? "Bot" :
		`${Math.round((scrollY / (lines.length - viewHeight())) * 100)}%`;
	const leftInfo = `${BG_GRAY}${BOLD} ${sectionName} ${RESET}`;
	const rightInfo = `${BG_GRAY} ${scrollPct} · ${scrollY + 1}/${lines.length} ${RESET}`;

	if (message) {
		const mid = `${BG_GRAY}${YELLOW} ${message} ${RESET}`;
		buf += `${leftInfo} ${mid}`;
	} else {
		buf += leftInfo;
	}
	// Right-align scroll info
	buf += goto(y1, Math.max(1, cols - 20)) + rightInfo;

	// Line 2: key hints
	buf += goto(y2, 1) + `${ESC}2K`;

	if (mode === "search") {
		buf += `${INVERSE} / ${RESET} ${searchQuery}█`;
	} else {
		const hints = [
			`${INVERSE} j/k ${RESET} scroll`,
			`${INVERSE} n/p ${RESET} section`,
			`${INVERSE} / ${RESET} search`,
			`${INVERSE} ? ${RESET} help`,
			`${INVERSE} q ${RESET} quit`,
		];
		buf += hints.join("  ");
	}

	return buf;
}

function getCurrentSectionName() {
	if (sections.length === 0) return "Tradeoffs";
	let name = sections[0].title;
	for (const s of sections) {
		if (s.lineIndex <= scrollY + 2) {
			name = s.title;
		} else {
			break;
		}
	}
	return name;
}

function showMessage(msg) {
	message = msg;
	if (messageTimer) clearTimeout(messageTimer);
	messageTimer = setTimeout(() => { message = ""; draw(); }, 2000);
	draw();
}

// ─── Help screen ─────────────────────────────────────────────────────

function drawHelp() {
	const helpLines = [
		"",
		`  ${BOLD}${CYAN}lazypi — Branch Tradeoffs Viewer${RESET}`,
		"",
		`  ${BOLD}Navigation${RESET}`,
		`  ${YELLOW}j / ↓${RESET}          Scroll down`,
		`  ${YELLOW}k / ↑${RESET}          Scroll up`,
		`  ${YELLOW}d / Page Down${RESET}   Half page down`,
		`  ${YELLOW}u / Page Up${RESET}    Half page up`,
		`  ${YELLOW}g / Home${RESET}       Go to top`,
		`  ${YELLOW}G / End${RESET}        Go to bottom`,
		"",
		`  ${BOLD}Sections${RESET}`,
		`  ${YELLOW}n / Tab${RESET}        Next section`,
		`  ${YELLOW}p / Shift+Tab${RESET}  Previous section`,
		`  ${YELLOW}1-9${RESET}            Jump to section N`,
		"",
		`  ${BOLD}Search${RESET}`,
		`  ${YELLOW}/${RESET}              Start search`,
		`  ${YELLOW}Enter${RESET}          Confirm search`,
		`  ${YELLOW}Escape${RESET}         Cancel search`,
		`  ${YELLOW}N${RESET}              Next match`,
		`  ${YELLOW}Shift+N${RESET}        Previous match`,
		"",
		`  ${BOLD}Other${RESET}`,
		`  ${YELLOW}r${RESET}              Reload file`,
		`  ${YELLOW}?${RESET}              Toggle this help`,
		`  ${YELLOW}q / Escape${RESET}     Quit`,
		"",
		`  ${GRAY}Press any key to close${RESET}`,
		"",
	];

	let buf = clearScreen() + hideCursor();
	const startRow = Math.max(1, Math.floor((rows - helpLines.length) / 2));

	for (let i = 0; i < helpLines.length && startRow + i <= rows; i++) {
		buf += goto(startRow + i, 1) + helpLines[i];
	}

	process.stdout.write(buf);
}

// ─── Search ──────────────────────────────────────────────────────────

function executeSearch() {
	searchMatches = [];
	searchIndex = -1;
	if (!searchQuery) return;

	const q = searchQuery.toLowerCase();
	for (let i = 0; i < rawLines.length; i++) {
		if (rawLines[i].toLowerCase().includes(q)) {
			// Find corresponding rendered line index (approximate)
			searchMatches.push(Math.min(i, lines.length - 1));
		}
	}

	if (searchMatches.length > 0) {
		searchIndex = 0;
		scrollToLine(searchMatches[0]);
		showMessage(`${searchMatches.length} match${searchMatches.length > 1 ? "es" : ""}`);
	} else {
		showMessage("No matches");
	}
}

function nextMatch() {
	if (searchMatches.length === 0) return;
	searchIndex = (searchIndex + 1) % searchMatches.length;
	scrollToLine(searchMatches[searchIndex]);
	showMessage(`Match ${searchIndex + 1}/${searchMatches.length}`);
}

function prevMatch() {
	if (searchMatches.length === 0) return;
	searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length;
	scrollToLine(searchMatches[searchIndex]);
	showMessage(`Match ${searchIndex + 1}/${searchMatches.length}`);
}

// ─── Scroll helpers ──────────────────────────────────────────────────

function scrollToLine(line) {
	const vh = viewHeight();
	scrollY = Math.max(0, Math.min(line - Math.floor(vh / 3), lines.length - vh));
}

function nextSection() {
	if (sections.length === 0) return;
	for (const s of sections) {
		if (s.lineIndex > scrollY + 2) {
			scrollToLine(s.lineIndex);
			return;
		}
	}
	// Wrap to first
	scrollToLine(sections[0].lineIndex);
}

function prevSection() {
	if (sections.length === 0) return;
	for (let i = sections.length - 1; i >= 0; i--) {
		if (sections[i].lineIndex < scrollY) {
			scrollToLine(sections[i].lineIndex);
			return;
		}
	}
	// Wrap to last
	scrollToLine(sections[sections.length - 1].lineIndex);
}

function jumpToSection(n) {
	if (n >= 0 && n < sections.length) {
		scrollToLine(sections[n].lineIndex);
	}
}

// ─── Input handling ──────────────────────────────────────────────────

function handleInput(data) {
	const str = data.toString();

	if (mode === "help") {
		mode = "normal";
		draw();
		return;
	}

	if (mode === "search") {
		if (str === "\r" || str === "\n") {
			mode = "normal";
			executeSearch();
			draw();
		} else if (str === "\x1b" || str === "\x03") {
			mode = "normal";
			searchQuery = "";
			draw();
		} else if (str === "\x7f" || str === "\b") {
			searchQuery = searchQuery.slice(0, -1);
			draw();
		} else if (str.length === 1 && str.charCodeAt(0) >= 32) {
			searchQuery += str;
			draw();
		}
		return;
	}

	const maxScroll = Math.max(0, lines.length - viewHeight());
	const halfPage = Math.floor(viewHeight() / 2);

	// Normal mode
	switch (str) {
		case "q": case "\x03": // q or Ctrl+C
			cleanup();
			process.exit(0);
			break;
		case "\x1b": // Escape
			if (searchMatches.length > 0) {
				searchMatches = [];
				searchIndex = -1;
				draw();
			} else {
				cleanup();
				process.exit(0);
			}
			break;

		// Scroll
		case "j": case "\x1b[B": // down
			scrollY = Math.min(maxScroll, scrollY + 1);
			draw();
			break;
		case "k": case "\x1b[A": // up
			scrollY = Math.max(0, scrollY - 1);
			draw();
			break;
		case "d": case "\x1b[6~": // half page down / Page Down
			scrollY = Math.min(maxScroll, scrollY + halfPage);
			draw();
			break;
		case "u": case "\x1b[5~": // half page up / Page Up
			scrollY = Math.max(0, scrollY - halfPage);
			draw();
			break;
		case "g": case "\x1b[H": // top / Home
			scrollY = 0;
			draw();
			break;
		case "G": case "\x1b[F": // bottom / End
			scrollY = maxScroll;
			draw();
			break;

		// Sections
		case "n": case "\t": // next section
			nextSection();
			draw();
			break;
		case "p": case "\x1b[Z": // prev section (Shift+Tab)
			prevSection();
			draw();
			break;

		// Section jump 1-9
		case "1": case "2": case "3": case "4": case "5":
		case "6": case "7": case "8": case "9":
			jumpToSection(parseInt(str) - 1);
			draw();
			break;

		// Search
		case "/":
			mode = "search";
			searchQuery = "";
			draw();
			break;
		case "N":
			nextMatch();
			draw();
			break;
		case "P":
			prevMatch();
			draw();
			break;

		// Help
		case "?":
			mode = "help";
			drawHelp();
			break;

		// Reload
		case "r":
			loadFile();
			showMessage("Reloaded");
			break;
	}
}

// ─── Terminal setup ──────────────────────────────────────────────────

function setup() {
	if (!process.stdin.isTTY) {
		process.stderr.write("Error: viewer requires a TTY (run inside tmux)\n");
		process.exit(1);
	}
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding("utf8");
	process.stdout.write(hideCursor() + clearScreen());

	process.stdin.on("data", handleInput);

	process.stdout.on("resize", () => {
		cols = process.stdout.columns || 80;
		rows = process.stdout.rows || 24;
		loadFile(); // re-render for new width
		draw();
	});

	// Watch for file changes
	watchFile(filePath, { interval: 1000 }, () => {
		loadFile();
		showMessage("Updated");
	});
}

function cleanup() {
	unwatchFile(filePath);
	process.stdout.write(showCursor() + clearScreen() + goto(1, 1));
	process.stdin.setRawMode(false);
}

process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT", () => { cleanup(); process.exit(0); });

// ─── Main ────────────────────────────────────────────────────────────

setup();
loadFile();
draw();
