import { complete, getModel } from "@mariozechner/pi-ai";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Config } from "./config";
import { loadCustomPrompt } from "./config";
import type { BranchData } from "./git";

function buildDefaultPrompt(data: BranchData, focusAreas: string[]): string {
	const commitLog = data.commits
		.map((c) => `  ${c.shortHash} ${c.subject} (${c.author}, ${c.date.split(" ")[0]})`)
		.join("\n");

	const fileStats = data.fileChanges
		.map((f) => {
			const statusIcon =
				f.status === "added" ? "+" : f.status === "deleted" ? "-" : f.status === "renamed" ? "→" : "~";
			const rename = f.oldPath ? ` (from ${f.oldPath})` : "";
			return `  ${statusIcon} ${f.path}${rename}  +${f.insertions} -${f.deletions}`;
		})
		.join("\n");

	const diffSections: string[] = [];
	for (const [path, diff] of data.diffs) {
		diffSections.push(`--- ${path} ---\n${diff}`);
	}

	const focusSection =
		focusAreas.length > 0 ? `\n\nPay special attention to these areas:\n${focusAreas.map((a) => `- ${a}`).join("\n")}` : "";

	return `You are a senior software architect reviewing a feature branch. Analyze the technical tradeoffs and changes, NOT line-by-line code review.

## Branch Context

Branch: ${data.branch.current}
Base: ${data.branch.base}
Merge base: ${data.branch.mergeBase.substring(0, 12)}
Commits: ${data.stats.totalCommits}
Files changed: ${data.stats.totalFiles}
Lines: +${data.stats.totalInsertions} -${data.stats.totalDeletions}
${focusSection}

## Commits

${commitLog}

## File Changes

${fileStats}

## Selected Diffs

${diffSections.join("\n\n")}

---

Produce a structured analysis in markdown with EXACTLY these sections. Be concise but insightful. Focus on the "why" not the "what".

# Summary
One paragraph: what does this branch accomplish?

# Feature Changes
Bullet list of user-facing or API-facing changes. Group by:
- **Added**: New capabilities
- **Modified**: Changed behaviors
- **Removed**: Dropped features

# Technical Tradeoffs
For each significant tradeoff, explain:
- **What was chosen** vs **what was traded away**
- **Why** this is reasonable (or concerning)
Examples: performance vs readability, flexibility vs simplicity, correctness vs speed, coupling vs cohesion

# Architecture Impact
- Structural changes (new modules, changed boundaries, dependency direction)
- Pattern changes (new patterns introduced, patterns broken)
- Scalability implications

# Risk Assessment
- **Breaking changes**: What could break for consumers?
- **Edge cases**: What might not be covered?
- **Migration**: What needs to happen on deploy?

# Dependencies
- New dependencies added
- Changed dependency relationships between modules
- Implicit coupling introduced`;
}

function buildFromTemplate(template: string, data: BranchData, focusAreas: string[]): string {
	const commitLog = data.commits
		.map((c) => `  ${c.shortHash} ${c.subject} (${c.author}, ${c.date.split(" ")[0]})`)
		.join("\n");

	const fileStats = data.fileChanges
		.map((f) => {
			const statusIcon =
				f.status === "added" ? "+" : f.status === "deleted" ? "-" : f.status === "renamed" ? "→" : "~";
			return `  ${statusIcon} ${f.path}  +${f.insertions} -${f.deletions}`;
		})
		.join("\n");

	const diffSections: string[] = [];
	for (const [path, diff] of data.diffs) {
		diffSections.push(`--- ${path} ---\n${diff}`);
	}

	return template
		.replace(/\{\{BRANCH\}\}/g, data.branch.current)
		.replace(/\{\{BASE_BRANCH\}\}/g, data.branch.base)
		.replace(/\{\{COMMITS\}\}/g, commitLog)
		.replace(/\{\{FILE_STATS\}\}/g, fileStats)
		.replace(/\{\{DIFFS\}\}/g, diffSections.join("\n\n"))
		.replace(/\{\{FOCUS_AREAS\}\}/g, focusAreas.length > 0 ? focusAreas.map((a) => `- ${a}`).join("\n") : "(none)");
}

async function resolveModel(
	config: Config,
	ctx: ExtensionCommandContext,
): Promise<{ model: any; apiKey: string; headers?: Record<string, string> } | { error: string }> {
	// Strategy 1: Use the currently active session model (already authenticated)
	if (ctx.model) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth?.ok && auth.apiKey) {
			return { model: ctx.model, apiKey: auth.apiKey, headers: auth.headers };
		}
	}

	// Strategy 2: Try the configured model from config.json (skip if "auto")
	if (config.model.provider && config.model.id && config.model.provider !== "auto") {
		const configModel = getModel(config.model.provider, config.model.id);
		if (configModel) {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(configModel);
			if (auth?.ok && auth.apiKey) {
				return { model: configModel, apiKey: auth.apiKey, headers: auth.headers };
			}
		}

		// Also try finding via registry (handles custom models)
		const registryModel = ctx.modelRegistry.find(config.model.provider, config.model.id);
		if (registryModel) {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(registryModel);
			if (auth?.ok && auth.apiKey) {
				return { model: registryModel, apiKey: auth.apiKey, headers: auth.headers };
			}
		}
	}

	// Strategy 3: Try any available model from the registry
	const available = ctx.modelRegistry.getAvailable();
	for (const m of available) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(m);
		if (auth?.ok && auth.apiKey) {
			return { model: m, apiKey: auth.apiKey, headers: auth.headers };
		}
	}

	return {
		error: `No model with API key available. Current model: ${ctx.model?.provider ?? "none"}/${ctx.model?.id ?? "none"}. Config model: ${config.model.provider}/${config.model.id}. Set up an API key or check config.json.`,
	};
}

export async function analyzeBranch(
	data: BranchData,
	config: Config,
	ctx: ExtensionCommandContext,
): Promise<string | { error: string }> {
	const resolved = await resolveModel(config, ctx);
	if ("error" in resolved) {
		return resolved;
	}

	const { model, apiKey, headers } = resolved;

	const customPrompt = await loadCustomPrompt();
	const prompt = customPrompt
		? buildFromTemplate(customPrompt, data, config.analysis.focusAreas)
		: buildDefaultPrompt(data, config.analysis.focusAreas);

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey,
			headers,
		},
	);

	const analysis = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	if (!analysis.trim()) {
		return { error: "LLM returned empty analysis." };
	}

	return analysis;
}
