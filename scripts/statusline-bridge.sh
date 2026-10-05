#!/bin/sh
# worfy status line bridge: copies the `rate_limits` object that Claude Code passes to the status
# line command into <WORFY_DATA_DIR>/statusline-limits.json, where worfy reads its Limits
# (ticket worfy-mvp/22). Claude Code 2.1.284 sends it after the first answer of a session:
#   {"five_hour": {"used_percentage": 29, "resets_at": 1791202800}, "seven_day": {...}}
#
# worfy never installs this script and never edits ~/.claude/settings.json (ADR-0005): the user
# puts it in front of their own status line command, which gets the same stdin and whose output
# is passed through unchanged:
#
#   "statusLine": {"type": "command", "command": "/path/to/statusline-bridge.sh 'bash ~/.claude/statusline.sh'"}
#
# Without an argument the script prints nothing. It writes nothing but that one file, only when
# the data directory exists (worfy has run) and jq is available, and never fails the status line.
input=$(cat)

dir=${WORFY_DATA_DIR:-"$HOME/Library/Application Support/worfy"}
if [ -d "$dir" ] && command -v jq >/dev/null 2>&1; then
  limits=$(printf '%s' "$input" | jq -c '.rate_limits | select(type == "object")' 2>/dev/null)
  if [ -n "$limits" ]; then
    # Written beside the target and renamed over it, so worfy never reads half a file.
    tmp="$dir/.statusline-limits.json.$$"
    if printf '%s\n' "$limits" >"$tmp" 2>/dev/null; then
      mv -f "$tmp" "$dir/statusline-limits.json" 2>/dev/null || rm -f "$tmp"
    fi
  fi
fi

if [ $# -gt 0 ]; then
  printf '%s' "$input" | sh -c "$1"
fi
