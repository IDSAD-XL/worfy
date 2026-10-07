#!/usr/bin/env bash
# A cheap Stop gate: it runs nothing itself (otherwise it would fire on every turn).
# It only stops the turn from finishing while the last gate run is known to be red,
# and once per session it speaks up about an unverified state.
#
# Self-limit: it blocks at most MAX_BLOCKS times per session. Without that,
# a red state the model cannot fix (a broken environment,
# missing dependencies) turns into an endless loop, and a headless run of
# `claude -p` simply goes silent. The counter is cleared by a green gate run.
#
# Messages to the model go through additionalContext: the turn is not held, but the model
# gets an extra turn to answer them. So each such message is said
# at most once per session per repository ("once" files in stop-blocks).
#
# The script works without node too: node is needed only by the registry resolver. If the registry
# cannot be read or there is no node, the red marker of this tree still holds the turn.

set -uo pipefail

# The scripts next to this one: the folder of its real file, not of a symlink to it.
HERE="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd -P)"
HARNESS_HOME="${HARNESS_HOME:-$HOME/.claude/worfy-harness}"
STATE="${CLAUDE_GATE_STATE:-$HARNESS_HOME/gate/state}"   # override for tests
RESOLVE="${CLAUDE_GATE_RESOLVE:-$HERE/gate-resolve.mjs}"
MAX_BLOCKS=2

payload="$(cat 2>/dev/null || true)"

if ! command -v node >/dev/null 2>&1; then
    for d in "$HOME"/.nvm/versions/node/*/bin; do
        [ -d "$d" ] && PATH="$d:$PATH"
    done
fi
PATH="/opt/homebrew/bin:$PATH"
export PATH

repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0
common="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$common" in
    /*) ;;
    *) common="$repo/$common" ;;
esac
canon="$(cd "$(dirname "$common")" 2>/dev/null && pwd)" || canon="$repo"

json_field() { # $1 = the name of a top-level string field of the hook JSON
    local re="\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\""
    [[ "$payload" =~ $re ]] && printf '%s' "${BASH_REMATCH[1]}"
}
json_esc() {
    local s
    # LC_ALL=C: byte by byte — a UTF-8 letter cut in the middle does not crash tr with "Illegal byte sequence"
    s="$(printf '%s' "$1" | LC_ALL=C tr -d '\000-\010\013\014\016-\037')"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\r'/\\r}"
    printf '%s' "$s"
}
say() { # prints context for the model without blocking the turn
    printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}' "$(json_esc "$1")"
}

session="$(json_field session_id)"
[ -n "$session" ] || session="unknown"
safe="${session//[^A-Za-z0-9_-]/_}"
transcript="$(json_field transcript_path)"
counter_dir="$STATE/stop-blocks"
mkdir -p "$counter_dir"

# The same tree key as the gate's: red in a neighbouring worktree is none of our business.
tag="$(printf '%s' "$repo" | shasum | awk '{print $1}' | cut -c1-8)"
# The key of the whole repository (all its worktrees) — for "once per session per repository".
rtag="$(printf '%s' "$canon" | shasum | awk '{print $1}' | cut -c1-8)"

fstat() { # $1 = birth | mtime, $2 = file -> epoch seconds; BSD (macOS) and GNU stat
    local f
    if [ "$(uname)" = Darwin ]; then
        [ "$1" = birth ] && f=%B || f=%m
        stat -f "$f" "$2" 2>/dev/null
    else
        [ "$1" = birth ] && f=%W || f=%Y
        stat -c "$f" "$2" 2>/dev/null
    fi
}

NOTES=""
note() { NOTES+="${NOTES:+ }$1"; }

# Gate markers without a project key (code 3: not registered, the registry cannot be read,
# no node). Take only our own: of this tree and this session. A marker without a session
# ("anon" — the gate was run outside a session) — only if it is newer than the start of our
# session (the birth time of the transcript); otherwise it is someone else's work. Other markers are left
# alone: their own session will take them, or the gate will clean them up after a week.
consume_nokey() {
    local m kind msg once start="" mtime
    if [ -n "$transcript" ] && [ -f "$transcript" ]; then
        start="$(fstat birth "$transcript")"
        [ "$start" = "0" ] && start=""
    fi
    for m in "$STATE"/nokey-*-"$tag"-"$safe" "$STATE"/nokey-*-"$tag"-anon; do
        [ -f "$m" ] || continue
        if [ "${m##*-}" = "anon" ]; then
            [ -n "$start" ] || continue
            mtime="$(fstat mtime "$m")"
            [ -n "$mtime" ] && [ "$mtime" -ge "$start" ] 2>/dev/null || continue
        fi
        kind="${m#"$STATE"/nokey-}"
        kind="${kind%%-*}"
        msg="$(tr '\n' ' ' <"$m")"
        rm -f "$m"
        # "Not registered" goes stale: the repository may have been added to the registry after
        # the gate run. The resolver now finds it — drop the marker silently, otherwise
        # the model would hear "not verified" about a project that is already registered.
        [ "$kind" = unregistered ] && [ "$resolved" -eq 1 ] && [ -n "$KEY" ] && continue
        once="$counter_dir/${safe}__nokey-${kind}__${rtag}"
        [ -f "$once" ] && continue
        : >"$once"
        note "The quality gate exited with code 3 (not verified): ${msg}"
    done
}

flush_notes() {
    [ -n "$NOTES" ] && say "$NOTES This is not a green result — say \"not verified\", not \"done\"."
    exit 0
}

# The project key. The resolver's exit code is looked at before an empty key is taken as "not
# registered": a broken registry gives empty output, but the project may be
# registered and red.
KEY=""
resolved=0
if command -v node >/dev/null 2>&1; then
    which="$(node "$RESOLVE" --which "$canon" 2>/dev/null)" && resolved=1
    KEY="${which%%$'\t'*}"
fi
if [ "$resolved" -eq 0 ]; then
    # The project cannot be determined. Look for this tree's markers by file name:
    # red-<key>-<tree> (first — it holds the turn), then unverified-<key>-<tree>;
    # the tree is ours, so the marker is ours too.
    for m in "$STATE"/red-*-"$tag" "$STATE"/unverified-*-"$tag"; do
        [ -s "$m" ] || continue
        KEY="${m#"$STATE"/}"
        KEY="${KEY#*-}"
        KEY="${KEY%-"$tag"}"
        break
    done
fi
if [ -z "$KEY" ]; then
    # Outside the registry (or the registry cannot be read and there is no red): do not hold the turn —
    # there is nothing for the model to fix — but say the gate's code-3 marker once.
    consume_nokey
    flush_notes
fi
RED_MARKER="$STATE/red-$KEY-$tag"
UNVERIFIED_MARKER="$STATE/unverified-$KEY-$tag"

# Before red: if the gate cannot work (code 3 — registry, node), the model must learn
# the reason on a red turn too, otherwise it fixes the code and the gate still does not turn green.
consume_nokey

if [ -s "$RED_MARKER" ]; then
    counter="$counter_dir/${safe}__${KEY}-${tag}"
    count=0
    [ -f "$counter" ] && count="$(cat "$counter" 2>/dev/null || echo 0)"
    count=$((count + 1))
    echo "$count" >"$counter"

    if [ "$count" -gt "$MAX_BLOCKS" ]; then
        # Enough hammering, but the unverified state must be named out loud —
        # once per session per tree, not on every turn.
        giveup="$counter_dir/${safe}__redgiveup__${KEY}-${tag}"
        if [ ! -f "$giveup" ]; then
            : >"$giveup"
            note "The quality gate is still red and was not cleared in $MAX_BLOCKS attempts. Do not describe this work as verified — say plainly that the gate fails."
        fi
        [ -n "$NOTES" ] && say "$NOTES"
        exit 0
    fi

    echo "The quality gate is red (failed at $(cat "$RED_MARKER")). Run \`bash $HERE/gate.sh fast\` and fix what it points to before finishing. If it cannot be fixed here, say so instead of reporting the work as done.${NOTES:+ Also: $NOTES}" >&2
    exit 2
fi

if [ -s "$UNVERIFIED_MARKER" ]; then
    # Do not block: an unavailable Docker or unbuilt dependencies cannot be fixed
    # by the model. But this must not pass silently either — otherwise "not verified"
    # turns into "done".
    once="$counter_dir/${safe}__unv__${KEY}-${tag}"
    if [ ! -f "$once" ]; then
        : >"$once"
        note "The last gate run could not verify the work: $(tr '\n' ' ' <"$UNVERIFIED_MARKER")."
    fi
fi

flush_notes
