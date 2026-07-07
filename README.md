# pi-extensions

Personal extensions and configuration for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent).

Each extension is a standalone TypeScript module that hooks into pi's `ExtensionAPI`.
Drop them into `~/.pi/agent/extensions/` (or symlink this repo there) and they load automatically on startup.

## Installation

```bash
git clone https://github.com/gypelayo/pi-extensions.git
# copy or symlink the extensions you want into pi's extensions dir
cp -r pi-extensions/* ~/.pi/agent/extensions/
```

`settings.json` is a sample pi configuration (default provider/model, thinking level,
goals-tracking system prompt). Copy it to `~/.pi/agent/settings.json` to use it.

## Extensions

| Extension | Command | Description |
|-----------|---------|-------------|
| `bash-timestamps.ts` | — | Stamps bash tool results with wall-clock time and duration (`░ 14:32:05 · 1.2s`). |
| `lazypi/` | — | Status-bar widget showing model, context usage, and effort/cost indicators. |
| `mood/` | `/mood` | Animated mood indicator for the agent. |
| `goals/` | `/goals` | Zero-cost goal/step tracker driven by an invisible response marker. |
| `safe-mode.ts` | `/safe [on\|off]` | Confirmation gate for destructive shell commands; shows a 🛡 footer indicator. |
| `show-shortcuts.ts` | `/shortcuts`, `/?`, `ctrl+/` | Scrollable list of keyboard shortcuts. |
| `mouse-scroll.ts` | — | Fixes mouse-wheel scrolling in/out of tmux (forwards scroll to tmux copy-mode). |
| `splash.ts` | — | Full-screen opencode-style splash entry screen on startup. |
| `slack-search.ts` | — | `search_slack` tool backed by the Slack search API (see config below). |
| `branch-tradeoffs/` | `/tradeoffs` | Analyzes architectural tradeoffs of a branch vs its parent in a tmux split pane. See its [README](branch-tradeoffs/README.md). |

## Configuration

### slack-search
Requires two environment variables (no secrets are stored in this repo):

```bash
export SLACK_TOKEN='xoxc-...'   # user token with search:read scope
export SLACK_COOKIE='xoxd-...'  # the d= session cookie value
```

Export them before launching pi.

### branch-tradeoffs
Requires pi to be running inside a **tmux** session. See [`branch-tradeoffs/README.md`](branch-tradeoffs/README.md) for details and configuration.

## Notes

- Some extensions require tmux (`mouse-scroll`, `branch-tradeoffs`).
- The `shared/` directory holds helpers (e.g. tmux pane management) used by multiple extensions.
- No credentials, session history, or private configuration are included in this repo.
