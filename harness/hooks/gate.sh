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
#      Outside a git worktree it says nothing and exits with 0, as the gate does. Before all of
#      that it checks the profile argument as gate.mjs does: `--help` / `-h` print the usage
#      (exit 0), an unknown profile prints it on stderr (exit 2), and neither writes anything.
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

# The profile argument, checked as gate.mjs checks it (see "The profile argument" there) and before
# anything is read from stdin or written: `--help` and `-h` print the usage and exit with 0; a
# profile that is not fast, full or an own key of root or workspace in some entry of the registry
# prints the usage on stderr and exits with 2. The usage is a copy of USAGE in gate.mjs:
# gate-shim.test.sh compares the answers of the two files.
usage='usage: node gate.mjs [<profile>]   profile: fast (the default), full, or a key of root or workspace in the gate registry'
case "${1-}" in --help | -h) printf '%s\n' "$usage"; exit 0 ;; esac
PROFILE="${1:-fast}"

# The git of an eval run: EVAL_GIT, else git from PATH (eval-env.cjs says the same for node).
git() { command "${EVAL_GIT:-git}" "$@"; }

# The home folder as node gives it (os.homedir): USERPROFILE on Windows, HOME elsewhere.
home="${HOME:-}"
case "${OSTYPE:-}" in msys* | cygwin*) home="${USERPROFILE:-$home}" ;; esac
# The Harness state: HARNESS_HOME, else EVAL_HARNESS_HOME of an eval run (a relative one from the
# git common directory; outside git, the default), else ~/.claude/worfy-harness — the rule of
# eval-env.cjs, here without node.
hh="${HARNESS_HOME:-}"
if [ -z "$hh" ] && [ -n "${EVAL_HARNESS_HOME:-}" ]; then
    case "$EVAL_HARNESS_HOME" in
        /* | [A-Za-z]:[\\/]*) hh="$EVAL_HARNESS_HOME" ;;
        *) common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" && [ -n "$common" ] && hh="$common/$EVAL_HARNESS_HOME" ;;
    esac
fi

# Whether the registry names the profile: awk reads it as JSON.parse would and exits with 10 when
# it is a valid registry with a `repos` list and no entry has the profile as an own key of its
# `root` or `workspace` (an object, or a list: its indexes and `length`). Any other end — not JSON,
# no `repos` list, a file that cannot be read, no awk — says nothing against the name, as in
# gate.mjs: the run goes on and reports what it finds. The same keys win as in JSON.parse: the
# last `repos` of the registry, the last `root` and `workspace` of an entry. Escapes in keys are
# decoded to UTF-8 bytes and compared with the bytes of the argument; a key with \u0000 or a lone
# surrogate equals no argument.
# shortcut: bytes that are not valid UTF-8 are compared as they are, where node reads U+FFFD; redo
# when a registry is written by anything other than JSON.stringify (which writes valid UTF-8 only).
registry_names() {
    LC_ALL=C GATE_PROFILE_NAME="$1" awk '
        function err() { bad = 1; p = n + 1 }
        function ws(   c) {
            while (p <= n) {
                c = substr(s, p, 1)
                if (c != " " && c != "\t" && c != "\n" && c != "\r") return
                p++
            }
        }
        # four hex digits at p, or -1
        function hex4(   i, d, v) {
            v = 0
            for (i = 0; i < 4; i++) {
                if (p + i > n) return -1
                d = index("0123456789abcdef", tolower(substr(s, p + i, 1)))
                if (d == 0) return -1
                v = v * 16 + d - 1
            }
            p += 4
            return v
        }
        function utf8(cp) {
            if (cp < 128) return sprintf("%c", cp)
            if (cp < 2048) return sprintf("%c%c", 192 + int(cp / 64), 128 + cp % 64)
            if (cp < 65536) return sprintf("%c%c%c", 224 + int(cp / 4096), 128 + int(cp / 64) % 64, 128 + cp % 64)
            return sprintf("%c%c%c%c", 240 + int(cp / 262144), 128 + int(cp / 4096) % 64, 128 + int(cp / 64) % 64, 128 + cp % 64)
        }
        # a string at p (on its quote); strok is 0 when it can equal no argument
        function str(   out, c, e, cp, lo) {
            p++
            out = ""
            strok = 1
            while (p <= n) {
                c = substr(s, p, 1)
                if (c == "\"") { p++; return out }
                if (c != "\\") {
                    if (index(ctl, c)) { err(); return "" }
                    out = out c
                    p++
                    continue
                }
                e = substr(s, p + 1, 1)
                p += 2
                if (e == "\"" || e == "\\" || e == "/") out = out e
                else if (e == "b") out = out "\b"
                else if (e == "f") out = out "\f"
                else if (e == "n") out = out "\n"
                else if (e == "r") out = out "\r"
                else if (e == "t") out = out "\t"
                else if (e == "u") {
                    cp = hex4()
                    if (cp < 0) { err(); return "" }
                    # a high surrogate and the \u escape after it: a pair, or else cp stays a lone
                    # surrogate and the key equals no argument, whatever that escape is
                    if (cp >= 55296 && cp < 56320 && substr(s, p, 2) == "\\u") {
                        p += 2
                        lo = hex4()
                        if (lo < 0) { err(); return "" }
                        if (lo >= 56320 && lo < 57344) cp = 65536 + (cp - 55296) * 1024 + (lo - 56320)
                    }
                    if (cp == 0 || (cp >= 55296 && cp < 57344)) strok = 0
                    else out = out utf8(cp)
                } else { err(); return "" }
            }
            err()
            return ""
        }
        function num(   q, t) {
            q = p
            while (p <= n && index("+-0123456789.eE", substr(s, p, 1))) p++
            t = substr(s, q, p - q)
            if (t !~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/) err()
        }
        # one value at p; ctx says where it is: "top", "repos" (the value of repos), "entry" (an
        # element of that list), "table" (the value of root or workspace of an entry), or "".
        # Returns 1 when the value names the profile for its context; vtype is its kind.
        function value(ctx,   c) {
            ws()
            if (p > n) { err(); return 0 }
            c = substr(s, p, 1)
            if (c == "{") return obj(ctx)
            if (c == "[") return arr(ctx)
            vtype = "scalar"
            if (c == "\"") str()
            else if (substr(s, p, 4) == "true" || substr(s, p, 4) == "null") p += 4
            else if (substr(s, p, 5) == "false") p += 5
            else num()
            return 0
        }
        function obj(ctx,   c, k, kok, h, has, r_has, w_has) {
            p++
            ws()
            has = 0; r_has = 0; w_has = 0
            if (substr(s, p, 1) == "}") p++
            else while (1) {
                ws()
                if (substr(s, p, 1) != "\"") { err(); return 0 }
                k = str(); kok = strok
                ws()
                if (bad || substr(s, p, 1) != ":") { err(); return 0 }
                p++
                if (ctx == "top" && kok && k == "repos") { h = value("repos"); repos_list = (vtype == "array"); repos_has = h }
                else if (ctx == "entry" && kok && k == "root") r_has = value("table")
                else if (ctx == "entry" && kok && k == "workspace") w_has = value("table")
                else value("")
                if (bad) return 0
                if (ctx == "table" && kok && k == NAME) has = 1
                ws()
                c = substr(s, p, 1)
                if (c == ",") { p++; continue }
                if (c == "}") { p++; break }
                err()
                return 0
            }
            vtype = "object"
            if (ctx == "entry") return r_has || w_has
            return has
        }
        function arr(ctx,   c, count, has) {
            p++
            ws()
            count = 0; has = 0
            if (substr(s, p, 1) == "]") p++
            else while (1) {
                if (value(ctx == "repos" ? "entry" : "") && ctx == "repos") has = 1
                if (bad) return 0
                count++
                ws()
                c = substr(s, p, 1)
                if (c == ",") { p++; continue }
                if (c == "]") { p++; break }
                err()
                return 0
            }
            vtype = "array"
            if (ctx == "table") return NAME == "length" || (NAME ~ /^(0|[1-9][0-9]*)$/ && NAME + 0 < count)
            return has
        }
        BEGIN {
            NAME = ENVIRON["GATE_PROFILE_NAME"] ""
            for (i = 1; i < 32; i++) ctl = ctl sprintf("%c", i)
        }
        { s = s $0 "\n" }
        END {
            n = length(s); p = 1
            value("top")
            ws()
            if (bad || p <= n || !repos_list) exit 0
            exit repos_has ? 0 : 10
        }'
}
if [ "$PROFILE" != fast ] && [ "$PROFILE" != full ]; then
    # The registry of gate.mjs (gateConfigFile in gate-paths.mjs): CLAUDE_GATE_CONFIG, else
    # gate/config.json of the Harness home; the old ~/.claude/gate/config.json only when that one
    # is missing and the old one is there.
    config="${CLAUDE_GATE_CONFIG:-}"
    if [ -z "$config" ]; then
        config="${hh:-$home/.claude/worfy-harness}/gate/config.json"
        [ ! -e "$config" ] && [ -e "$home/.claude/gate/config.json" ] && config="$home/.claude/gate/config.json"
    fi
    if [ -f "$config" ] && [ -r "$config" ]; then
        # A NUL byte makes the file no JSON for JSON.parse, and awks read it differently (one cuts
        # the line, another keeps the byte): such a file says nothing against the name. Without tr
        # the sizes differ and the name stands; without wc both are empty and awk decides.
        size="$(wc -c 2>/dev/null <"$config")"
        size_no_nul="$(tr -d '\000' 2>/dev/null <"$config" | wc -c 2>/dev/null)"
        if [ "$((size + 0))" -eq "$((size_no_nul + 0))" ]; then
            registry_names "$PROFILE" 2>/dev/null <"$config"
            if [ $? -eq 10 ]; then
                printf '[gate] unknown profile: %s\n%s\n' "$PROFILE" "$usage" >&2
                exit 2
            fi
        fi
    fi
fi

# What is checked is the worktree. Outside git, or without git, there is nothing to say.
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0

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
