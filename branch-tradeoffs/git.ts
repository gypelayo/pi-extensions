import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Config } from "./config";
import { basename } from "node:path";

export interface BranchInfo {
	current: string;
	base: string;
	mergeBase: string;
}

export interface CommitInfo {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	subject: string;
}

export interface FileChange {
	path: string;
	insertions: number;
	deletions: number;
	status: "added" | "modified" | "deleted" | "renamed";
	oldPath?: string;
}

export interface BranchData {
	branch: BranchInfo;
	commits: CommitInfo[];
	fileChanges: FileChange[];
	diffs: Map<string, string>;
	stats: {
		totalFiles: number;
		totalInsertions: number;
		totalDeletions: number;
		totalCommits: number;
	};
}

async function exec(
	pi: ExtensionAPI,
	cmd: string,
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return pi.exec(cmd, args, { cwd, timeout: 15000 });
}

export async function getCurrentBranch(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const result = await exec(pi, "git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	if (result.code !== 0) return null;
	return result.stdout.trim();
}

export async function detectBaseBranch(pi: ExtensionAPI, cwd: string, currentBranch: string, candidates: string[] = ["main", "master", "develop", "dev", "trunk"]): Promise<string | null> {
	// Strategy: find the most likely parent branch
	// 1. Check reflog for branch creation point
	// 2. Fall back to configurable base branch names

	// Try to find fork point from candidate base branches
	for (const candidate of candidates) {
		if (candidate === currentBranch) continue;

		const check = await exec(pi, "git", ["rev-parse", "--verify", candidate], cwd);
		if (check.code === 0) {
			const mergeBase = await exec(pi, "git", ["merge-base", currentBranch, candidate], cwd);
			if (mergeBase.code === 0) {
				return candidate;
			}
		}
	}

	// Try to find from reflog
	const reflog = await exec(
		pi,
		"git",
		["reflog", "show", "--format=%gs", currentBranch, "-n", "50"],
		cwd,
	);
	if (reflog.code === 0) {
		const lines = reflog.stdout.trim().split("\n");
		for (const line of lines) {
			const match = line.match(/branch: Created from (.+)/);
			if (match) {
				const parentRef = match[1]!.trim();
				// Could be a branch name or a commit hash
				const verify = await exec(pi, "git", ["rev-parse", "--verify", parentRef], cwd);
				if (verify.code === 0) {
					// Check if it's a branch name
					const branchCheck = await exec(pi, "git", ["rev-parse", "--abbrev-ref", parentRef], cwd);
					if (branchCheck.code === 0 && branchCheck.stdout.trim() !== "HEAD") {
						return branchCheck.stdout.trim();
					}
					return parentRef.substring(0, 12);
				}
			}
		}
	}

	return null;
}

export async function getMergeBase(
	pi: ExtensionAPI,
	cwd: string,
	branch: string,
	base: string,
): Promise<string | null> {
	const result = await exec(pi, "git", ["merge-base", branch, base], cwd);
	if (result.code !== 0) return null;
	return result.stdout.trim();
}

export async function getCommits(
	pi: ExtensionAPI,
	cwd: string,
	mergeBase: string,
	branch: string,
	maxCommits: number,
): Promise<CommitInfo[]> {
	const result = await exec(
		pi,
		"git",
		["log", `${mergeBase}..${branch}`, `--max-count=${maxCommits}`, "--format=%H|%h|%an|%ai|%s"],
		cwd,
	);
	if (result.code !== 0) return [];

	return result.stdout
		.trim()
		.split("\n")
		.filter((l) => l.length > 0)
		.map((line) => {
			const [hash, shortHash, author, date, ...subjectParts] = line.split("|");
			return {
				hash: hash!,
				shortHash: shortHash!,
				author: author!,
				date: date!,
				subject: subjectParts.join("|"),
			};
		});
}

export async function getFileChanges(
	pi: ExtensionAPI,
	cwd: string,
	mergeBase: string,
	branch: string,
): Promise<FileChange[]> {
	const result = await exec(pi, "git", ["diff", "--numstat", "--diff-filter=ADMR", mergeBase, branch], cwd);
	if (result.code !== 0) return [];

	const statusResult = await exec(pi, "git", ["diff", "--name-status", "--diff-filter=ADMR", mergeBase, branch], cwd);
	const statusMap = new Map<string, string>();
	if (statusResult.code === 0) {
		for (const line of statusResult.stdout.trim().split("\n").filter((l) => l.length > 0)) {
			const parts = line.split("\t");
			const status = parts[0]!;
			const path = parts.length === 3 ? parts[2]! : parts[1]!;
			const oldPath = parts.length === 3 ? parts[1] : undefined;
			statusMap.set(path!, `${status}|${oldPath ?? ""}`);
		}
	}

	return result.stdout
		.trim()
		.split("\n")
		.filter((l) => l.length > 0)
		.map((line) => {
			const parts = line.split("\t");
			const ins = parts[0] === "-" ? 0 : parseInt(parts[0]!, 10);
			const del = parts[1] === "-" ? 0 : parseInt(parts[1]!, 10);
			const path = parts[2]!;

			const statusInfo = statusMap.get(path) ?? "M|";
			const [statusChar, oldPath] = statusInfo.split("|");

			let status: FileChange["status"] = "modified";
			if (statusChar!.startsWith("A")) status = "added";
			else if (statusChar!.startsWith("D")) status = "deleted";
			else if (statusChar!.startsWith("R")) status = "renamed";

			return { path, insertions: ins, deletions: del, status, oldPath: oldPath || undefined };
		});
}

function simpleGlobMatch(filename: string, pattern: string): boolean {
	// Simple glob: supports *.ext and exact matches against basename
	const base = basename(filename);
	if (pattern.startsWith("*.")) {
		const ext = pattern.slice(1); // e.g. ".ts"
		return base.endsWith(ext);
	}
	if (pattern.includes("*")) {
		const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
		return regex.test(base);
	}
	return base === pattern;
}

function shouldIncludeDiff(path: string, config: Config): boolean {
	const matchesInclude =
		config.analysis.includeDiffPatterns.length === 0 ||
		config.analysis.includeDiffPatterns.some((p) => simpleGlobMatch(path, p));

	const matchesExclude = config.analysis.excludeDiffPatterns.some((p) => simpleGlobMatch(path, p));

	return matchesInclude && !matchesExclude;
}

export async function getDiffs(
	pi: ExtensionAPI,
	cwd: string,
	mergeBase: string,
	branch: string,
	fileChanges: FileChange[],
	config: Config,
): Promise<Map<string, string>> {
	const diffs = new Map<string, string>();
	let totalBytes = 0;

	// Prioritize: source files first, then config, then others
	const prioritized = [...fileChanges].filter((f) => shouldIncludeDiff(f.path, config));

	// Sort by relevance: more changes = more relevant
	prioritized.sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions));

	const filesToDiff = prioritized.slice(0, config.analysis.maxDiffFiles);

	for (const file of filesToDiff) {
		if (totalBytes >= config.analysis.maxDiffBytes) break;

		const result = await exec(pi, "git", ["diff", mergeBase, branch, "--", file.path], cwd);
		if (result.code === 0 && result.stdout.length > 0) {
			const diffContent = result.stdout;
			if (totalBytes + diffContent.length <= config.analysis.maxDiffBytes) {
				diffs.set(file.path, diffContent);
				totalBytes += diffContent.length;
			} else {
				// Truncate this diff to fit
				const remaining = config.analysis.maxDiffBytes - totalBytes;
				if (remaining > 200) {
					diffs.set(file.path, diffContent.substring(0, remaining) + "\n... [truncated]");
					totalBytes = config.analysis.maxDiffBytes;
				}
				break;
			}
		}
	}

	return diffs;
}

export async function gatherBranchData(
	pi: ExtensionAPI,
	cwd: string,
	config: Config,
	targetBranch?: string,
	baseBranchOverride?: string,
): Promise<BranchData | { error: string }> {
	const current = targetBranch ?? (await getCurrentBranch(pi, cwd));
	if (!current) return { error: "Not in a git repository or cannot determine current branch." };

	const base = baseBranchOverride ?? (await detectBaseBranch(pi, cwd, current, config.analysis.baseBranchCandidates));
	if (!base) {
		return {
			error: `Cannot detect base branch for '${current}'. Use '/tradeoffs --base <branch>' to specify.`,
		};
	}

	const mergeBase = await getMergeBase(pi, cwd, current, base);
	if (!mergeBase) return { error: `Cannot find merge base between '${current}' and '${base}'.` };

	// Check if there are any changes
	const headCommit = await exec(pi, "git", ["rev-parse", current], cwd);
	if (headCommit.code === 0 && headCommit.stdout.trim() === mergeBase) {
		return { error: `Branch '${current}' has no commits ahead of '${base}'.` };
	}

	const commits = await getCommits(pi, cwd, mergeBase, current, config.analysis.maxCommits);
	const fileChanges = await getFileChanges(pi, cwd, mergeBase, current);
	const diffs = await getDiffs(pi, cwd, mergeBase, current, fileChanges, config);

	const totalInsertions = fileChanges.reduce((s, f) => s + f.insertions, 0);
	const totalDeletions = fileChanges.reduce((s, f) => s + f.deletions, 0);

	return {
		branch: { current, base, mergeBase },
		commits,
		fileChanges,
		diffs,
		stats: {
			totalFiles: fileChanges.length,
			totalInsertions,
			totalDeletions,
			totalCommits: commits.length,
		},
	};
}
