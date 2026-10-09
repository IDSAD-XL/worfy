#!/bin/sh
# worfy status line bridge, entry: copies the `rate_limits` object that Claude Code passes to the
# status line command into statusline-limits.json in worfy's data folders, where worfy reads its
# Limits (ticket worfy-mvp/22), and passes stdin to the user's own status line command, whose output
# and exit code come through unchanged.
#
# This file stays at its path: the user's `statusLine` names it, as the Harness migration form wrote
# it (ADR-0040, ADR-0047), and an update of the .app must not break it:
#
#   "statusLine": {"type": "command", "command": "/Applications/worfy.app/Contents/Resources/statusline-bridge.sh 'bash ~/.claude/statusline.sh'"}
#
# The Limits are written by statusline-bridge.mjs next to this file (Node, worfy-windows ticket 08),
# with its output and exit code ignored. When node is missing or fails (a version manager's shim with
# no version, a Node too old for the script), they are written as before through jq, which macOS 15
# ships as /usr/bin/jq. The user's command is run here, never by the Node script: whatever happens to
# the Limits, the user's status line keeps its output and exit code (Claude Code shows the line only
# on exit 0). Both files ship in Contents/Resources (electron-builder.yml).
#
# Without an argument it prints nothing. It writes nothing but that one file per folder, only into
# a folder that exists (worfy has run), and never fails the status line.
case $0 in
  */*) here=${0%/*} ;;
  *) here=. ;;
esac

# stdin as it is, trailing newlines included.
input=$(cat; printf x)
input=${input%x}

limits_by_node() {
  command -v node >/dev/null 2>&1 && [ -f "$here/statusline-bridge.mjs" ] || return 1
  printf '%s' "$input" | node "$here/statusline-bridge.mjs" >/dev/null 2>&1
}

# Written beside the target and renamed over it, so worfy never reads half a file.
copy_limits() {
  [ -d "$1" ] || return 0
  tmp="$1/.statusline-limits.json.$$"
  if printf '%s\n' "$limits" >"$tmp" 2>/dev/null; then
    mv -f "$tmp" "$1/statusline-limits.json" 2>/dev/null || rm -f "$tmp"
  fi
}

limits_by_jq() {
  command -v jq >/dev/null 2>&1 || return 0
  limits=$(printf '%s' "$input" | jq -c '.rate_limits | select(type == "object")' 2>/dev/null)
  [ -n "$limits" ] || return 0
  if [ -n "${WORFY_DATA_DIR:-}" ]; then
    copy_limits "$WORFY_DATA_DIR"
  else
    copy_limits "$HOME/Library/Application Support/worfy"
    copy_limits "$HOME/Library/Application Support/worfy-dev"
  fi
}

limits_by_node || limits_by_jq

if [ $# -gt 0 ]; then
  printf '%s' "$input" | sh -c "$1"
fi
