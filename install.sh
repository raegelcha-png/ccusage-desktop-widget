#!/usr/bin/env bash
# ccusage-widget installer — idempotent, one-command setup.
# Usage:
#   ./install.sh --repo=owner/name [--handle=yourhandle]
# Or pipe:
#   curl -fsSL .../install.sh | bash -s -- --repo=owner/name
set -euo pipefail

REPO=""
HANDLE=""
for arg in "$@"; do
  case "$arg" in
    --repo=*)   REPO="${arg#*=}" ;;
    --handle=*) HANDLE="${arg#*=}" ;;
    -h|--help)
      sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="$HOME/.ccusage-widget"
WIDGETS_DIR="$HOME/Library/Application Support/Übersicht/widgets"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_LABEL="com.ccusage-widget.refresh"
PLIST_PATH="$LAUNCH_AGENTS/${PLIST_LABEL}.plist"

say() { printf '\033[1m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# --- pre-flight ---
say "checking prerequisites"
NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || die "node not found — install from https://nodejs.org"
GH_BIN="$(command -v gh || true)"
[[ -n "$GH_BIN" ]] || die "gh not found — install with: brew install gh"
gh auth status >/dev/null 2>&1 || die "gh not authenticated — run: gh auth login"
[[ -d "/Applications/Übersicht.app" ]] || die "Übersicht not installed — brew install --cask ubersicht"

# --- ccusage ---
if ! node -e "require('ccusage')" >/dev/null 2>&1 \
   && [[ ! -f "$HOME/.npm-global/lib/node_modules/ccusage/dist/index.js" ]] \
   && [[ ! -f "/usr/local/lib/node_modules/ccusage/dist/index.js" ]] \
   && [[ ! -f "/opt/homebrew/lib/node_modules/ccusage/dist/index.js" ]]; then
  say "installing ccusage globally"
  npm install -g ccusage
fi

# --- args ---
if [[ -z "$REPO" ]]; then
  read -r -p "leaderboard repo (owner/name): " REPO
fi
[[ -n "$REPO" ]] || die "--repo is required"
[[ "$REPO" =~ ^[^/]+/[^/]+$ ]] || die "repo must be owner/name, got: $REPO"

if [[ -z "$HANDLE" ]]; then
  HANDLE="$(gh api user --jq .login 2>/dev/null || true)"
fi
[[ -n "$HANDLE" ]] || die "could not determine GitHub handle — pass --handle=..."

# --- files ---
say "writing $CACHE_DIR"
mkdir -p "$CACHE_DIR"
cp "$SCRIPT_DIR/refresh.js" "$CACHE_DIR/refresh.js"
chmod +x "$CACHE_DIR/refresh.js"

cat > "$CACHE_DIR/leaderboard.config.json" <<JSON
{
  "handle": "$HANDLE",
  "repo": "$REPO"
}
JSON

say "writing widget to Übersicht"
mkdir -p "$WIDGETS_DIR"
cp "$SCRIPT_DIR/ccusage.jsx" "$WIDGETS_DIR/ccusage.jsx"

# --- launchd ---
say "writing launchd agent ($PLIST_LABEL)"
mkdir -p "$LAUNCH_AGENTS"
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${CACHE_DIR}/refresh.js</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key><string>${HOME}</string>
        <key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>CCUSAGE_NODE</key><string>${NODE_BIN}</string>
    </dict>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/ccusage-cache.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/ccusage-cache.out</string>
</dict>
</plist>
PLIST

# unload any old variant (including Raegel's original label)
for old in "com.raegalcha.ccusage-cache" "${PLIST_LABEL}"; do
  launchctl unload "$LAUNCH_AGENTS/${old}.plist" 2>/dev/null || true
done
# remove Raegel's stale plist if it exists alongside the new one
[[ -f "$LAUNCH_AGENTS/com.raegalcha.ccusage-cache.plist" && "$PLIST_LABEL" != "com.raegalcha.ccusage-cache" ]] \
  && rm "$LAUNCH_AGENTS/com.raegalcha.ccusage-cache.plist"

say "running initial refresh (this can take 15-30s)"
"$NODE_BIN" "$CACHE_DIR/refresh.js" || die "refresh.js failed — check output above"

say "loading launchd agent"
launchctl load "$PLIST_PATH"
# launchctl list is eventually-consistent; poll briefly before giving up
for i in 1 2 3 4 5; do
  if launchctl list | grep -q "$PLIST_LABEL"; then loaded=1; break; fi
  sleep 0.3
done
[[ "${loaded:-0}" == "1" ]] || die "launchd load failed — check: launchctl list | grep ccusage"

say "done"
printf "\n"
printf "  handle:        %s\n" "$HANDLE"
printf "  repo:          %s\n" "$REPO"
printf "  cache:         %s\n" "$CACHE_DIR/data.json"
printf "  refresh every: 1 hour (launchd)\n"
printf "  widget:        %s/ccusage.jsx\n" "$WIDGETS_DIR"
printf "\n"
printf "open Übersicht (or restart it) to see the widget.\n"
printf "grant Screen Recording permission if prompted.\n"
