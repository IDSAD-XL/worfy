#!/bin/sh
# worfy status line bridge: copies the `rate_limits` object that Claude Code passes to the status
# line command into statusline-limits.json in worfy's data folder, where worfy reads its Limits
# (ticket worfy-mvp/22). Claude Code 2.1.284 sends it after the first answer of a session:
#   {"five_hour": {"used_percentage": 29, "resets_at": 1791202800}, "seven_day": {...}}
#
# The data folder is WORFY_DATA_DIR when it is set. Otherwise the file goes to each of the two
# folders that src/main/storage/paths.ts names and that exist: Application Support/worfy (the
# packaged app, such as the stable copy) and Application Support/worfy-dev (`pnpm dev`), so a dev
# run that works next to the stable copy sees the same Limits. A shell script cannot import
# paths.ts; test/contract/statusline-bridge.test.ts keeps the two folder names in step with it.
#
# worfy never installs this script and never edits ~/.claude/settings.json (ADR-0005): the user
# puts it in front of their own status line command, which gets the same stdin and whose output
# is passed through unchanged:
#
#   "statusLine": {"type": "command", "command": "/path/to/statusline-bridge.sh 'bash ~/.claude/statusline.sh'"}
#
# Without an argument the script prints nothing. It writes nothing but that one file per folder,
# only into a folder that exists (worfy has run) and only when jq is available, and never fails
# the status line.
input=$(cat)

# Written beside the target and renamed over it, so worfy never reads half a file.
copy_limits() {
  [ -d "$1" ] || return 0
  tmp="$1/.statusline-limits.json.$$"
  if printf '%s\n' "$limits" >"$tmp" 2>/dev/null; then
    mv -f "$tmp" "$1/statusline-limits.json" 2>/dev/null || rm -f "$tmp"
  fi
}

if command -v jq >/dev/null 2>&1; then
  limits=$(printf '%s' "$input" | jq -c '.rate_limits | select(type == "object")' 2>/dev/null)
  if [ -n "$limits" ]; then
    if [ -n "${WORFY_DATA_DIR:-}" ]; then
      copy_limits "$WORFY_DATA_DIR"
    else
      copy_limits "$HOME/Library/Application Support/worfy"
      copy_limits "$HOME/Library/Application Support/worfy-dev"
    fi
  fi
fi

if [ $# -gt 0 ]; then
  printf '%s' "$input" | sh -c "$1"
fi
