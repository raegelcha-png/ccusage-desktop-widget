# ccusage desktop widget

Minimal macOS desktop widget that shows your Claude Code token spend as a bar chart, with a daily/weekly toggle. Runs in [Übersicht](https://tracesof.net/uebersicht/) and reads from [ccusage](https://github.com/ryoppippi/ccusage).

![widget](./screenshot.png)

## What you get

- Today's spend + period total in the header
- Four views via pill toggle:
  - **Daily** — 7-day bar chart with Mon–Fri toggle
  - **Weekly** — sparkline + mini histogram, last 12 weeks
  - **Hotspot** — day × hour activity heatmap with peak callout
  - **Friends** — optional leaderboard ranked by 7-day tokens
- Avg, EOM projection, cache-hit % in the footer
- Bars turn orange when a day crosses $100 (or a week crosses $300)
- Drag the header to move, drag the bottom-right corner to resize — position and size persist
- Data refreshes every 10 minutes in the background via launchd

## Install

Prereqs: Homebrew, Node, `gh` (authenticated via `gh auth login`), Übersicht.

```sh
brew install --cask ubersicht
brew install gh
gh auth login
```

Then clone this repo and run the installer:

```sh
git clone <this-repo>
cd ccusage-desktop-widget
./install.sh --repo=owner/ccusage-leaderboard
```

That's it. The installer:

- Auto-detects your GitHub handle, node binary path, and `$HOME`
- Installs `ccusage` globally if missing
- Writes `~/.ccusage-widget/{refresh.js, leaderboard.config.json}`
- Copies the widget to Übersicht's widget directory
- Writes and loads a launchd agent that refreshes every 10 min
- Runs an initial refresh so data is ready when Übersicht opens

Grant **Screen Recording** permission to Übersicht when prompted (required on macOS 12+ for widgets to render on the desktop). Toggle it on in `System Settings → Privacy & Security → Screen Recording`, then quit and relaunch Übersicht.

### Re-installing / updating

Re-running `./install.sh` is safe — it overwrites the widget, refresh.js, and plist, then reloads the launchd agent. No manual cleanup needed.

### Uninstall

```sh
launchctl unload ~/Library/LaunchAgents/com.ccusage-widget.refresh.plist
rm ~/Library/LaunchAgents/com.ccusage-widget.refresh.plist
rm -rf ~/.ccusage-widget
rm "$HOME/Library/Application Support/Übersicht/widgets/ccusage.jsx"
```

## Why the cache file?

ccusage scans `~/.claude/projects/**/*.jsonl` and takes ~15-20s to run on a large history. Übersicht would re-run the command on every refresh, which is wasteful and blocks the widget.

The launchd agent runs ccusage in the background every 10 min and writes to `~/.ccusage-widget/data.json`. The widget just `cat`s that file — instant render, no shell-env or PATH issues inside Übersicht.

## Widget gotchas

Two non-obvious Übersicht behaviors that bit me:

1. **`render(state, dispatch)` — two args, not one.** If you destructure `dispatch` from the first argument, you get `undefined` and onClick handlers silently no-op.
2. **If you define `updateState`, you own `UB/COMMAND_RAN` too.** Otherwise Übersicht's own output/error events get dropped and the widget stays stuck on whatever `initialState` has.

Both are handled in `ccusage.jsx`.

## Tweak

- `refreshFrequency` (ms) in the widget controls how often it re-reads the cache file. 10 min is plenty.
- `hotThreshold` in the render function controls when bars turn red ($100/day, $300/week by default).
- Position via `top`/`right` in the `className` template literal at the top of the widget.

## Leaderboard (optional)

Friends-only ranking on the "Friends" tab — all participants' widgets pull from a shared private GitHub repo and show each other's 7-day token totals.

### Set up your own group

1. Create a private repo (any name):
   ```sh
   gh repo create ccusage-leaderboard --private
   ```
2. Create the config at `~/.ccusage-widget/leaderboard.config.json`:
   ```json
   {
     "handle": "your-github-handle",
     "repo": "your-handle/ccusage-leaderboard"
   }
   ```
3. Trigger a refresh — your stats file pushes automatically:
   ```sh
   /usr/local/bin/node ~/.ccusage-widget/refresh.js
   ```
4. Invite friends as collaborators:
   ```sh
   gh repo edit your-handle/ccusage-leaderboard --add-collaborator friend-handle
   ```
5. Friends follow steps 2–3 with their own handle and your repo path.

### What gets shared

Each participant's `stats/{handle}.json`:

- `handle`, `last7dMsgs`, `last30dMsgs`, `totalMsgs`, `streak`
- `last7dTokens`, `last30dTokens`, `totalTokens`
- `peakDay` (0=Sun) and `peakHour` (0–23)
- `updatedAt`

**Not shared:** cost, project names, prompt/completion content. The widget never reads message content from `~/.claude/projects/**` — only timestamps; token counts come from ccusage's per-day totals.

### Redact fields

If any of the above feel too exposing (e.g. `peakHour` reveals your work schedule), add a `redact` array to the config:

```json
{
  "handle": "your-handle",
  "repo": "your-handle/ccusage-leaderboard",
  "redact": ["peakHour", "peakDay"]
}
```

`handle` is protected — everything else is strippable.

### Security notes

- Keep the repo **private**. Usage metadata reveals your working hours.
- Collaborators can clone the repo and keep a copy forever, even after removal — treat invites as permanent.
- `refresh.js` uses `gh` for auth — your token has full `repo` scope. Only edit `refresh.js` yourself; never `curl | bash` a modified version.

## License

MIT. Take it, fork it, rip the bar chart and put it in your own widget.
