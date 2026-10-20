#!/usr/bin/env bash
# The launcher of the quality gate, under the old name of the gate. The gate is gate.mjs, run by
# node. This file does three things and decides nothing else:
#   1. it finds a node that can run gate.mjs — version NODE_MIN or newer, checked by starting it:
#      the one on PATH; only when PATH has none such, the places a hook with a bare PATH misses —
#      /opt/homebrew/bin, then /usr/local/bin (where the installer of nodejs.org puts node; a
#      program started from Finder has neither folder on PATH), then the versions of nvm
#      (~/.nvm/versions/node/v*/bin), newest version first: v24 before v9, not the order of
#      the names as text;
#   2. it starts gate.mjs with the same arguments and stdin and ends with its exit code;
#   3. with no such node anywhere it answers as the bash gate did before gate.mjs: the line «[gate]
#      not verified: node not found», exit code 3, the marker nokey-broken-<tag>-<session>
#      for stop.mjs and an "unverified" verdict file in place of the one of the run before. When
#      a node was found but failed the check, the line says «no node 18 or newer: <its path> is
#      older or did not start» instead, with the same code, marker and file.
#      Outside a git worktree it says nothing and exits with 0, as the gate does.
#
# Who calls it:
#   - hooks.json (TaskCompleted, TeammateIdle), by its path. A hook command that named `node`
#     fails with code 127 where node is not on PATH, before anything can replace the verdict
#     file, and worfy goes on showing the outcome of an earlier run — a green one too;
#   - a profile that names this file in commands.verify and in rules.md ("bash
#     ~/.claude/worfy-harness/plugin/hooks/gate.sh full"), as profiles moved from the old Harness
#     do; agents run that line as it is written. It stays a working spelling: where node is not on
#     PATH it answers «node not found» with code 3, where `node …/gate.mjs` fails with 127. Rules,
#     skills, agents and bin/ name gate.mjs, and so does a new profile.
#
# This file departs from two rules of the Harness: a hook command names `node`, not a script
# started by its first line; and nothing outside tests needs bash. It exists because nothing else
# can replace a stale verdict when node is missing. That this file is the entry point of the hook
# was decided on 2026-10-14.
set -u

# The oldest node the launcher starts gate.mjs with: 18 has all gate.mjs uses (top-level await,
# String.replaceAll, fs.rmSync). An older node would fail on gate.mjs and leave a stale verdict.
NODE_MIN=18
# usable <file>: an executable file that runs as node NODE_MIN or newer. It is started to say so.
# The first executable file that fails the check is kept in `refused`, for the answer below.
refused=""
usable() {
    [ -f "$1" ] && [ -x "$1" ] || return 1
    "$1" -e "process.exit(Number(process.versions.node.split('.')[0]) >= $NODE_MIN ? 0 : 1)" </dev/null >/dev/null 2>&1 && return 0
    [ -n "$refused" ] || refused="$1"
    return 1
}
node=""
candidate="$(command -v node 2>/dev/null)" && usable "$candidate" && node="$candidate"
if [ -z "$node" ]; then
    for d in /opt/homebrew/bin /usr/local/bin; do
        usable "$d/node" && { node="$d/node"; break; }
    done
fi
if [ -z "$node" ]; then
    # The versions of nvm, newest first: each folder v<major>.<minor>.<patch> as one number to sort by.
    re_version='/v([0-9]+)\.([0-9]+)\.([0-9]+)/bin$'
    versions=""
    for d in "${HOME:-}"/.nvm/versions/node/v*/bin; do
        [[ "$d" =~ $re_version ]] || continue
        versions+="$(( 10#${BASH_REMATCH[1]} * 1000000 + 10#${BASH_REMATCH[2]} * 1000 + 10#${BASH_REMATCH[3]} )) $d"$'\n'
    done
    if [ -n "$versions" ]; then
        while IFS=' ' read -r _ d; do
            [ -n "$d" ] && usable "$d/node" && { node="$d/node"; break; }
        done < <(printf '%s' "$versions" | sort -rn)
    fi
fi
if [ -n "$node" ]; then
    # `pwd -W` is Git Bash on Windows: C:/…, a path node reads with no help from the shell.
    # ${1+"$@"}: some versions of bash take "$@" without arguments for an unset variable under set -u.
    exec "$node" "$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && { pwd -W 2>/dev/null || pwd -P; })/gate.mjs" ${1+"$@"}
fi

# --- no node --------------------------------------------------------------------------------
# The rest is the answer of the bash gate, cut down to this one case. The state folder, the tag
# and the fields of the verdict file are the ones of gate-paths.mjs and gate.mjs: stop.mjs and
# worfy look for the marker and the verdict file by those names.
PROFILE="${1:-fast}"

# The git of an eval run: EVAL_GIT, else git from PATH (eval-env.cjs says the same for node).
git() { command "${EVAL_GIT:-git}" "$@"; }

# What is checked is the worktree. Outside git, or without git, there is nothing to say.
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0

# The home folder as node gives it (os.homedir): USERPROFILE on Windows, HOME elsewhere.
home="${HOME:-}"
case "${OSTYPE:-}" in msys* | cygwin*) home="${USERPROFILE:-$home}" ;; esac
# The Harness state: HARNESS_HOME, else EVAL_HARNESS_HOME of an eval run (a relative one from the
# git common directory), else ~/.claude/worfy-harness — the rule of eval-env.cjs, here without node.
hh="${HARNESS_HOME:-}"
if [ -z "$hh" ] && [ -n "${EVAL_HARNESS_HOME:-}" ]; then
    case "$EVAL_HARNESS_HOME" in
        /* | [A-Za-z]:[\\/]*) hh="$EVAL_HARNESS_HOME" ;;
        *) common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" && [ -n "$common" ] && hh="$common/$EVAL_HARNESS_HOME" ;;
    esac
fi
STATE="${CLAUDE_GATE_STATE:-${hh:-$home/.claude/worfy-harness}/gate/state}"
mkdir -p "$STATE" 2>/dev/null

# The tag of the worktree: the first 8 hex digits of the SHA-1 of its root as git prints it.
# Linux and Git Bash have sha1sum, macOS has shasum. With neither there is no tag, and no file
# can be named: only the line and the exit code are left.
if command -v sha1sum >/dev/null 2>&1; then sum="$(printf '%s' "$repo" | sha1sum 2>/dev/null)"
else sum="$(printf '%s' "$repo" | shasum 2>/dev/null)"; fi
tag="${sum:0:8}"
re_tag='^[0-9a-f]{8}$'
[[ "$tag" =~ $re_tag ]] || tag=""

# Whose session this is: session_id from the hook JSON, else CLAUDE_CODE_SESSION_ID (a run by
# hand from the Bash tool has it). Hooks send JSON on stdin and close it; a run by hand may leave
# stdin open and empty, so a line is waited for no longer than two seconds. On a terminal there
# is nothing to read.
hook_in=""
if [ ! -t 0 ]; then
    while :; do
        line=""
        IFS= read -r -t 2 line 2>/dev/null
        r=$?
        hook_in+="$line"
        [ "$r" -eq 0 ] || break
        hook_in+=$'\n'
    done
fi
SESSION=""
re_sid='"session_id"[[:space:]]*:[[:space:]]*"([^"]+)"'
[[ "$hook_in" =~ $re_sid ]] && SESSION="${BASH_REMATCH[1]}"
[ -n "$SESSION" ] || SESSION="${CLAUDE_CODE_SESSION_ID:-}"
SESSION="${SESSION//[^A-Za-z0-9_-]/_}"

# A JSON string literal of $1: backslash, quote and control characters escaped. Character by
# character, with single-quoted literals only: ${s//\\/…} treats backslashes in the replacement
# differently across bash versions (3.2 on macOS, 5.2 with patsub_replacement on Linux).
json_str() {
    local s="$1" out="" ch code i
    for ((i = 0; i < ${#s}; i++)); do
        ch="${s:i:1}"
        case "$ch" in
            '\') out+='\\' ;;
            '"') out+='\"' ;;
            $'\n') out+='\n' ;;
            $'\r') out+='\r' ;;
            $'\t') out+='\t' ;;
            *)
                printf -v code '%d' "'$ch" 2>/dev/null || code=32
                if [ "$code" -ge 0 ] && [ "$code" -lt 32 ]; then
                    printf -v ch '\\u%04x' "$code"
                fi
                out+="$ch"
                ;;
        esac
    done
    printf '"%s"' "$out"
}

text="node not found"
reason="node not found"
explain="Repository: $repo. The gate does not work without node — this is not green: the work was not verified by the gate."
# A node was found but did not pass the check: older than NODE_MIN, or it did not start. Said so,
# with its path: "node not found" would be wrong while node is there.
if [ -n "$refused" ]; then
    text="no node $NODE_MIN or newer: $refused is older or did not start"
    reason="$text"
    explain="Repository: $repo. The gate needs node $NODE_MIN or newer — this is not green: the work was not verified by the gate."
fi
if [ -n "$tag" ]; then
    # The marker is per tree and per session; with no session it is "anon" (see notVerified in gate.mjs).
    printf '%s. %s\n' "$text" "$explain" >"$STATE/nokey-broken-$tag-${SESSION:-anon}" 2>/dev/null || true
    # The verdict file is written whole or not at all: a temporary file in the same folder, then
    # mv. When that fails, the file of the run before is removed: it must not tell an older outcome.
    verdict="$STATE/verdict-$tag.json"
    head="$(git -C "$repo" rev-parse -q --verify HEAD 2>/dev/null)" || head=""
    [ -n "$head" ] && head="$(json_str "$head")" || head="null"
    tmp="$(mktemp "$STATE/.verdict-$tag.XXXXXX" 2>/dev/null)" || tmp=""
    if [ -z "$tmp" ] ||
        ! printf '{"version":1,"outcome":"unverified","profile":%s,"worktree":%s,"key":null,"head":%s,"exit":3,"at":"%s","reason":%s}\n' \
            "$(json_str "$PROFILE")" "$(json_str "$repo")" "$head" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(json_str "$reason")" >"$tmp" 2>/dev/null ||
        ! mv -f "$tmp" "$verdict" 2>/dev/null; then
        [ -n "$tmp" ] && rm -f "$tmp" 2>/dev/null
        rm -f "$verdict" 2>/dev/null
    fi
fi
{
    echo "[gate] not verified: $text"
    echo "$explain"
} >&2
exit 3
