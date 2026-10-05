#!/usr/bin/env bash
# Spike for ticket worfy-mvp/06, question 4: PATH of an app started from Finder, and the Agent SDK
# binary inside an Electron package.
#
# Run from anywhere, one command (builds the throwaway app, asks Finder to open it, as a
# double-click does, waits for its result and prints it):
#
#   bash scripts/spikes/path-probe/run.sh
#
# Finder, not `open`: `open` hands the caller's environment (PATH, CLAUDE_* of a parent Claude
# Code session) to the app, and the point is the environment a Finder launch gets from launchd.
# Each run makes three short model calls (haiku). Output: ~/Library/Application
# Support/worfy-path-probe/result.json, printed at the end.
set -euo pipefail
cd "$(dirname "$0")/../../.."

rm -rf scripts/spikes/path-probe/dist
pnpm exec electron-builder --config scripts/spikes/path-probe/electron-builder.yml --mac dir

app="$(cd "$(ls -d scripts/spikes/path-probe/dist/mac*/worfy-path-probe.app | head -n 1)" && pwd)"
result="$HOME/Library/Application Support/worfy-path-probe/result.json"
rm -f "$result"
osascript -e "tell application \"Finder\" to open (POSIX file \"$app\" as alias)" >/dev/null
for _ in $(seq 1 180); do
    [ -s "$result" ] && break
    sleep 1
done
cat "$result"
