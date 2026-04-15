# Branch Tradeoffs Navigator

A pi extension that analyzes technical tradeoffs and feature changes in a branch compared to its parent branch. Instead of showing code diffs, it surfaces **what changed architecturally**, **what tradeoffs were made**, and **what the implications are**.

The analysis opens in a **tmux split pane** beside pi, giving you a true side-by-side view where both pi and the tradeoffs panel stay fully interactive.

## Requirements

- **tmux** — pi must be running inside a tmux session

## Usage

### Commands

- `/tradeoffs` — Analyze current branch and open tradeoffs pane (toggles if already open)
- `/tradeoffs <branch>` — Analyze a specific branch against its parent
- `/tradeoffs --base <branch>` — Override the base branch for comparison
- `/tradeoffs --close` — Close the tradeoffs pane

### Workflow

1. Start pi inside a **tmux session**
2. Check out your feature branch
3. Run `/tradeoffs` in pi
4. The extension will:
   - Detect your branch and its parent (merge-base)
   - Gather commits, file changes, and key diffs
   - Send context to an LLM for structured analysis
   - Open a **tmux split pane** on the right (50% width) with an interactive viewer
5. Run `/tradeoffs` again to toggle the pane closed
6. Run `/tradeoffs` with new args to refresh the analysis
7. Inside the viewer, press `?` for all keybindings

## Viewer Keybindings

| Key | Action |
|-----|--------|
| `j` / `↓` | Scroll down |
| `k` / `↑` | Scroll up |
| `d` / `Page Down` | Half page down |
| `u` / `Page Up` | Half page up |
| `g` / `Home` | Go to top |
| `G` / `End` | Go to bottom |
| `n` / `Tab` | Next section |
| `p` / `Shift+Tab` | Previous section |
| `1`-`9` | Jump to section N |
| `/` | Search |
| `N` | Next search match |
| `P` | Previous search match |
| `r` | Reload file |
| `?` | Toggle help screen |
| `q` / `Esc` | Quit viewer |

## What It Analyzes

The analysis produces structured sections:

- **Summary** — One-line description of what the branch does
- **Feature Changes** — New capabilities, modified behaviors, removed features
- **Technical Tradeoffs** — Performance vs readability, coupling vs flexibility, etc.
- **Architecture Impact** — Structural changes to the codebase
- **Risk Assessment** — What could break, edge cases, migration concerns
- **Dependencies** — New deps, changed deps, implicit coupling

## Configuration

Edit `~/.pi/agent/extensions/branch-tradeoffs/config.json`:

```json
{
  "model": {
    "provider": "auto",
    "id": "auto"
  },
  "analysis": {
    "maxCommits": 100,
    "maxDiffFiles": 30,
    "maxDiffBytes": 50000,
    "includeDiffPatterns": ["*.ts", "*.tsx", "*.js", "*.py", "*.go", "*.rs", "*.java"],
    "excludeDiffPatterns": ["*.lock", "*.generated.*", "package-lock.json", "yarn.lock"],
    "focusAreas": []
  }
}
```

### Configuration Options

#### `model`
Which LLM to use for analysis. Set to `"auto"`/`"auto"` (default) to use the same model as your current pi session. Set a specific provider/id to always use that model.

#### `analysis.maxCommits`
Maximum number of commits to include in the analysis context. Default: `100`.

#### `analysis.maxDiffFiles`
Maximum number of changed files to include full diffs for. Files are prioritized by relevance (source code > config > generated). Default: `30`.

#### `analysis.maxDiffBytes`
Maximum total bytes of diff content to send. Prevents token overflow on large branches. Default: `50000`.

#### `analysis.includeDiffPatterns`
Glob patterns for files to include full diffs. Default covers common source files.

#### `analysis.excludeDiffPatterns`
Glob patterns for files to always exclude from diffs (lockfiles, generated code). Default excludes lockfiles.

#### `analysis.focusAreas`
Optional list of areas to emphasize in analysis. Examples:
```json
{
  "focusAreas": ["security", "performance", "API changes", "database schema"]
}
```

## Customizing the Analysis Prompt

The analysis prompt can be customized by creating a file at:

```
~/.pi/agent/extensions/branch-tradeoffs/prompt.md
```

This file replaces the default analysis prompt. Use these placeholders:

- `{{BRANCH}}` — Current branch name
- `{{BASE_BRANCH}}` — Base branch name
- `{{COMMITS}}` — Formatted commit log
- `{{FILE_STATS}}` — File change statistics
- `{{DIFFS}}` — Selected file diffs
- `{{FOCUS_AREAS}}` — Configured focus areas (if any)

## Extending

### Adding New Analysis Sections

Edit `prompt.md` and add new sections to the expected output format.

### Changing the Diff Strategy

Modify `config.json` patterns to control which files get full diffs vs just stats. This lets you tune the signal-to-noise ratio for your codebase.

### Focus Areas

Use `focusAreas` to steer the analysis toward what matters for your team:

```json
{
  "analysis": {
    "focusAreas": [
      "API backward compatibility",
      "database migration safety",
      "error handling completeness",
      "test coverage gaps"
    ]
  }
}
```
