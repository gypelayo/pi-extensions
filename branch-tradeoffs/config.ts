import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));

export interface Config {
	model: {
		provider: string;
		id: string;
	};
	analysis: {
		maxCommits: number;
		maxDiffFiles: number;
		maxDiffBytes: number;
		includeDiffPatterns: string[];
		excludeDiffPatterns: string[];
		focusAreas: string[];
		baseBranchCandidates: string[];
	};
}

const DEFAULT_CONFIG: Config = {
	model: { provider: "auto", id: "auto" },
	analysis: {
		maxCommits: 100,
		maxDiffFiles: 30,
		maxDiffBytes: 50000,
		includeDiffPatterns: ["*.ts", "*.tsx", "*.js", "*.py", "*.go", "*.rs", "*.java"],
		excludeDiffPatterns: ["*.lock", "*.generated.*", "package-lock.json", "yarn.lock"],
		focusAreas: [],
		baseBranchCandidates: ["main", "master", "develop", "dev", "trunk"],
	},
};

export async function loadConfig(): Promise<Config> {
	const configPath = join(baseDir, "config.json");
	try {
		const raw = await readFile(configPath, "utf8");
		const parsed = JSON.parse(raw);
		return {
			model: { ...DEFAULT_CONFIG.model, ...parsed.model },
			analysis: { ...DEFAULT_CONFIG.analysis, ...parsed.analysis },
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}

export async function loadCustomPrompt(): Promise<string | null> {
	const promptPath = join(baseDir, "prompt.md");
	try {
		return await readFile(promptPath, "utf8");
	} catch {
		return null;
	}
}
