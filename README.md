# ccusage desktop widget

Minimal macOS desktop widget that shows your Claude Code token spend as a bar chart, with a daily/weekly toggle. Runs in [Übersicht](https://tracesof.net/uebersicht/) and reads from [ccusage](https://github.com/ryoppippi/ccusage).

![widget](./screenshot.png)

## What you get

- Today's spend + period total in the header
- 14-day (daily) or 10-week (weekly) bar chart
- Blue→purple bars normally, red→orange when a day crosses $100 (or a week crosses $300)
- Click the pill to switch views
- Data refreshes every 10 minutes in the background via launchd

## Install

Assumes Homebrew, Node, and `npm` are already set up.

```sh
# 1. ccusage (the token-usage reader)
npm install -g ccusage

# 2. Übersicht (the widget host)
brew install --cask ubersicht
open -a "/Applications/Übersicht.app"
```

Grant **Screen Recording** permission to Übersicht when prompted (required on macOS 12+ for widgets to render on the desktop). Toggle it on in `System Settings → Privacy & Security → Screen Recording`, then quit and relaunch Übersicht.

Then:

```sh
# 3. Widget file
cp ccusage.jsx "$HOME/Library/Application Support/Übersicht/widgets/"

# 4. Cache directory + initial seed
mkdir -p "$HOME/.ccusage-widget"
/usr/local/bin/node "$HOME/.npm-global/lib/node_modules/ccusage/dist/index.js" daily -j -O --since $(date -v-90d +%Y%m%d) > "$HOME/.ccusage-widget/data.json"

# 5. launchd agent — refreshes the cache every 10 min
cp com.raegalcha.ccusage-cache.plist "$HOME/Library/LaunchAgents/"
launchctl load "$HOME/Library/LaunchAgents/com.raegalcha.ccusage-cache.plist"
```

The plist has paths hardcoded to `/Users/raegalcha` — update those to match your `$HOME` before loading. Same for the node binary path if yours isn't `/usr/local/bin/node` (check with `which node`).

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

## License

MIT. Take it, fork it, rip the bar chart and put it in your own widget.
