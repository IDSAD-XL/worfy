#!/bin/sh
# worfy status line bridge, entry: the work is done by statusline-bridge.mjs next to this file (Node,
# worfy-windows ticket 08). It copies the `rate_limits` object of the status line JSON into
# statusline-limits.json of worfy's data folders and passes stdin to the user's own status line
# command, whose output and exit code come through unchanged.
#
# This file stays at its path: the user's `statusLine` names it, as the Harness migration form wrote
# it (ADR-0040, ADR-0047), and an update of the .app must not break it:
#
#   "statusLine": {"type": "command", "command": "/Applications/worfy.app/Contents/Resources/statusline-bridge.sh 'bash ~/.claude/statusline.sh'"}
#
# Both files ship in Contents/Resources (electron-builder.yml). Without node on PATH there are no
# Limits from the terminal, but the user's own status line still runs, as it did without jq.
case $0 in
  */*) here=${0%/*} ;;
  *) here=. ;;
esac
if command -v node >/dev/null 2>&1 && [ -f "$here/statusline-bridge.mjs" ]; then
  exec node "$here/statusline-bridge.mjs" "$@"
fi
if [ $# -gt 0 ]; then
  exec sh -c "$1"
fi
cat >/dev/null
