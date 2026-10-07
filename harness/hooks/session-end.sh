#!/usr/bin/env bash
# SessionEnd: records that a project session ended without a retrospective, so that
# hooks/session-start.sh reminds about /retro (the threshold is the profile's session.retro_reminder_after).
#
# The project is found by bin/profile of this plugin from the session directory (the `cwd` field of the hook JSON, else $PWD).
# Writes only for a profile with the session.retro_reminder_after field: a line "time<TAB>directory"
# into <profile>/state/pending-retro.log (the state/ directory is not in git). The /retro skill clears the log.
# Otherwise nothing, code 0. Nothing is written into the repository.
#
# For tests: CLAUDE_PROFILE_BIN, CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR — as with session-start.sh.

set -uo pipefail

if ! command -v node >/dev/null 2>&1; then
    for d in "$HOME"/.nvm/versions/node/*/bin; do
        [ -d "$d" ] && PATH="$d:$PATH"
    done
fi
PATH="/opt/homebrew/bin:$PATH"
export PATH

# bin/profile of this plugin: the folder above hooks/, found from this script's real file.
PROFILE_BIN="${CLAUDE_PROFILE_BIN:-$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/.." && pwd -P)/bin/profile}"

input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd="$PWD"

json="$("$PROFILE_BIN" -C "$cwd" --json 2>/dev/null)" || exit 0
after="$(printf '%s' "$json" | jq -r '.session.retro_reminder_after // empty')"
dir="$(printf '%s' "$json" | jq -r '._resolved.dir // empty')"
[ -n "$after" ] && [ -n "$dir" ] && [ -d "$dir" ] || exit 0

mkdir -p "$dir/state"
printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$cwd" >>"$dir/state/pending-retro.log"
exit 0
