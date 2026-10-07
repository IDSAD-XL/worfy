#!/usr/bin/env bash
# Quality gate. Runs lint and tests where files changed relative to the
# merge-base with origin/main, and when the base is doubtful (there is none, HEAD is detached,
# the branch is far from origin/main) — in every package; it prints the chosen scope and the reason
# as a line "[gate] scope …". Caches green results by a fingerprint of the
# content (a hit is printed as «[gate] зелено (…): … (кэш)») and exits
# with code 2 on red («[gate] красно (…): …»).
#
#   gate.sh fast   -> the per-ticket profile (TaskCompleted / TeammateIdle)
#   gate.sh full   -> everything (by hand or when an epic closes)
#
# The repository is identified by its common git directory, not by its path: worktrees
# live both inside the repository and next to it (Auction-arch, Auction-sale-loop).
#
# The main rule: «ничего не прогналось» (nothing ran) is not «зелено» (green). The red marker
# is removed only by a run that actually checked something.
#
# Exit codes:
#   0 — green, «ничего не прогналось», «ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение
#       недоступно» (the unverified marker) or a directory outside git — they are told apart by
#       the "[gate] …" line, not by the code;
#   2 — red (TaskCompleted / TeammateIdle do not let the work finish on this code);
#   3 — not verified: neither green nor red. The line «[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: …»
#       names the reason: the project is not registered in gate/config.json; the registry
#       cannot be read or the resolver crashed; node was not found. The code does not block hooks
#       (only 2 blocks). The gate leaves a marker per tree and session; stop.sh
#       tells the model about it at most once per session per repository
#       (through additionalContext — that costs the model an extra turn, hence only once)
#       and does not hold the turn. Agents put code 3 into not_verified, skills do not merge on it.
#
# The verdict file (ticket worfy-harness/09, ADR-0044: the machine contract carries no language).
# Every run inside a git worktree overwrites $STATE/verdict-<tag>.json (the same folder and tag as
# the markers) with the outcome of that run; worfy reads it instead of the "[gate] …" line. A
# directory outside git leaves no file. The markers, the "[gate] …" lines and the exit codes stay
# as they are: stop.sh, skills and agents read them. The file is one JSON object:
#   version  — 1;
#   outcome  — "green" | "red" | "unverified" | "none" (none = nothing ran, which is not green);
#   profile  — the profile argument ("fast" | "full");
#   worktree — the worktree root (git rev-parse --show-toplevel);
#   key      — the key of the gate registry entry, or null when the project was not determined;
#   head     — the SHA of HEAD, or null;
#   exit     — the exit code of this run (green 0, red 2, unverified 0 or 3, none 0);
#   at       — the time of the run, UTC, ISO 8601 (2026-10-07T12:00:00Z);
#   reason   — one line in English for "unverified" and "none", else null.
# It is written whole or not at all: a temporary file in the same folder, then mv. A run that
# could not write it removes the previous file, so the file never tells an older run's outcome.
# Bash writes it, not node: a missing node is one of the "unverified" cases.

set -uo pipefail

PROFILE="${1:-fast}"
# The scripts next to this one: the folder of its real file, not of a symlink to it.
HERE="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd -P)"
# The Harness state on this machine (ADR-0040 item 5): the gate registry and markers.
HARNESS_HOME="${HARNESS_HOME:-$HOME/.claude/worfy-harness}"
CONFIG="${CLAUDE_GATE_CONFIG:-$HARNESS_HOME/gate/config.json}"
# Transition: with no registry in HARNESS_HOME but one in the old place, read the old one.
# Only read it — the state is always written under HARNESS_HOME.
if [ -z "${CLAUDE_GATE_CONFIG:-}" ] && [ ! -e "$CONFIG" ] && [ -e "$HOME/.claude/gate/config.json" ]; then
    CONFIG="$HOME/.claude/gate/config.json"
fi
export CLAUDE_GATE_CONFIG="$CONFIG"
STATE="${CLAUDE_GATE_STATE:-$HARNESS_HOME/gate/state}"   # override for tests
CACHE="$STATE/cache"
RESOLVE="${CLAUDE_GATE_RESOLVE:-$HERE/gate-resolve.mjs}"

mkdir -p "$CACHE" "$STATE/stop-blocks"

# Hooks send JSON on stdin and close it — drain it. When run by hand from the
# Bash tool, stdin is open and empty, and `cat` would wait for EOF forever (that is how the gate
# "hung" until the owner asked «Ты подвис?» — "Are you stuck?"): read line by line, no longer than two
# seconds per line, and do not wait beyond that. On a terminal (stdin is a TTY) there is nothing to read.
hook_in=""
if [ ! -t 0 ]; then
    while :; do
        _line=""
        IFS= read -r -t 2 _line 2>/dev/null
        r=$?
        hook_in+="$_line"
        [ "$r" -eq 0 ] || break
        hook_in+=$'\n'
    done
fi

# Whose session this is: session_id from the hook JSON, else CLAUDE_CODE_SESSION_ID (a
# manual run from the Bash tool sees it; subagents have the same one as their parent).
# Needed so that the "could not verify" marker without a project key is delivered only to
# the session that ran the gate, not to a neighbouring one in the same tree.
SESSION=""
re_sid='"session_id"[[:space:]]*:[[:space:]]*"([^"]+)"'
[[ "$hook_in" =~ $re_sid ]] && SESSION="${BASH_REMATCH[1]}"
[ -n "$SESSION" ] || SESSION="${CLAUDE_CODE_SESSION_ID:-}"
SESSION="${SESSION//[^A-Za-z0-9_-]/_}"

# The hook shell starts with a bare PATH; make node and the package managers reachable.
if ! command -v node >/dev/null 2>&1; then
    for d in "$HOME"/.nvm/versions/node/*/bin; do
        [ -d "$d" ] && PATH="$d:$PATH"
    done
fi
PATH="/opt/homebrew/bin:$PATH:$HOME/.local/share/pnpm"
export PATH

# What is checked is the worktree; what is identified is the repository as a whole.
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0
common="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$common" in
    /*) ;;
    *) common="$repo/$common" ;;
esac
canon="$(cd "$(dirname "$common")" 2>/dev/null && pwd)" || canon="$repo"
tag="$(printf '%s' "$repo" | shasum | awk '{print $1}' | cut -c1-8)"
KEY=""   # the registry key; set once the resolver has named the project

# The verdict file tells the outcome of the last run or nothing: a run that ends without writing
# it (mktemp, printf or mv failed — a full disk — or any exit before write_verdict) removes the
# previous run's file, or worfy would show that outcome over what this run printed.
VERDICT_FILE="$STATE/verdict-$tag.json"
VERDICT_WRITTEN=0
trap '[ "$VERDICT_WRITTEN" -eq 1 ] || rm -f "$VERDICT_FILE" 2>/dev/null' EXIT

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

# Writes $STATE/verdict-<tag>.json (see the header). $1 — outcome, $2 — exit code, $3 — reason
# (empty = null). A failed write changes nothing else: the markers, the line and the code stay; the
# EXIT trap above removes the previous file.
write_verdict() {
    local head key reason tmp
    head="$(git -C "$repo" rev-parse -q --verify HEAD 2>/dev/null)" || head=""
    [ -n "$head" ] && head="$(json_str "$head")" || head="null"
    [ -n "$KEY" ] && key="$(json_str "$KEY")" || key="null"
    [ -n "$3" ] && reason="$(json_str "${3//$'\n'/ }")" || reason="null"
    tmp="$(mktemp "$STATE/.verdict-$tag.XXXXXX" 2>/dev/null)" || return 0
    if printf '{"version":1,"outcome":"%s","profile":%s,"worktree":%s,"key":%s,"head":%s,"exit":%s,"at":"%s","reason":%s}\n' \
        "$1" "$(json_str "$PROFILE")" "$(json_str "$repo")" "$key" "$head" "$2" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$reason" >"$tmp" 2>/dev/null &&
        mv -f "$tmp" "$VERDICT_FILE" 2>/dev/null; then
        VERDICT_WRITTEN=1
        return 0
    fi
    rm -f "$tmp" 2>/dev/null
    return 0
}

# Markers without a project key (project not determined) older than a week are garbage from
# abandoned sessions and deleted worktrees.
find "$STATE" -maxdepth 1 -name 'nokey-*' -mtime +7 -delete 2>/dev/null
find "$STATE/stop-blocks" -maxdepth 1 -name '*__*' -mtime +7 -delete 2>/dev/null   # stop.sh counters and "once" files

# "Could not verify" without a project key: code 3, the line «[gate] ПРОВЕРИТЬ НЕ
# УДАЛОСЬ: …» and a marker for stop.sh. The marker is per tree and per session
# (nokey-<kind>-<tree>-<session>); with no session it is "anon", and stop.sh takes such a
# marker only if it is newer than the start of its own session.
#   $1 — kind (unregistered | broken), $2 — the text after «ПРОВЕРИТЬ НЕ УДАЛОСЬ: »,
#   $3 — an explanation for the model. Both go into the marker: "$2. $3".
#   $4 — the reason in English for the verdict file.
not_verified() {
    printf '%s. %s\n' "$2" "$3" >"$STATE/nokey-$1-$tag-${SESSION:-anon}" 2>/dev/null || true
    write_verdict unverified 3 "$4"
    {
        echo "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: $2"
        echo "$3"
    } >&2
    exit 3
}

command -v node >/dev/null 2>&1 ||
    not_verified broken "node не найден" \
        "Repository: $repo. The gate does not work without node — this is not green: the work was not verified by the gate." \
        "node not found"

which="$(node "$RESOLVE" --which "$canon" 2>"$STATE/.resolve-err-$$")"
rc=$?
rerr="$(head -n 1 "$STATE/.resolve-err-$$" 2>/dev/null)"   # the whole line: cutting by bytes splits a UTF-8 letter
rm -f "$STATE/.resolve-err-$$"
if [ "$rc" -ne 0 ]; then
    # A crashed resolver (broken registry, broken node) is not "a directory outside
    # the repositories" and not "not registered". Staying silent and exiting with 0 is not allowed either.
    not_verified broken "резолвер gate-resolve.mjs завершился с кодом $rc" \
        "Repository: $repo. ${rerr:+Reason: $rerr. }Project not determined, nothing was checked — this is not green." \
        "the registry resolver gate-resolve.mjs exited with code $rc${rerr:+: $rerr}"
fi
# A repository outside the registry: there used to be a silent `exit 0` here, and "the gate is silent"
# read as "the gate is happy". Now it is loud, with code 3.
if [ -z "$which" ]; then
    tilde='~'
    not_verified unregistered "проект не зарегистрирован в ${CONFIG/#$HOME/$tilde}" \
        "Repository $repo is not registered in $CONFIG — the gate checked nothing. This is not green: the work was not verified by the gate." \
        "the project is not registered in $CONFIG"
fi
# Parsing TSV without `IFS=$'\t' read`: tab is an IFS whitespace character, two tabs in a row
# collapse, and an empty field disappears (that is how the root line ".\t\tlint" lost
# the script name, and the root lint never ran at all). Split by hand.
split3() { # $1 = the line; puts the fields into F1 F2 F3, empty fields are kept
    local line="$1" rest
    F1="${line%%$'\t'*}"
    rest="${line#*$'\t'}"
    [ "$rest" = "$line" ] && rest=""
    F2="${rest%%$'\t'*}"
    F3="${rest#*$'\t'}"
    [ "$F3" = "$rest" ] && F3=""
}
split3 "$which"
KEY="$F1" MATCH="$F2" PM="$F3"
# Plan lines longer than three fields (fingerprint paths, "added from") — split all fields
# into the FLD array the same way, keeping empty ones.
splitn() { # $1 = the line
    local line="$1"
    FLD=()
    while :; do
        FLD+=("${line%%$'\t'*}")
        [ "$line" = "${line#*$'\t'}" ] && break
        line="${line#*$'\t'}"
    done
}

# Markers are per worktree (tag above): Auction has a couple of dozen of them, and
# red in one must not stop the turn from finishing in another.
RED_MARKER="$STATE/red-$KEY-$tag"
UNVERIFIED_MARKER="$STATE/unverified-$KEY-$tag"

# --- which scope to check -------------------------------------------------------
# Narrowing by the diff from the merge-base with origin/main is right only for an ordinary branch
# forked recently. In every other case the diff errs on the small side, and
# the gate silently checked one or two packages. Hence: no base, the merge-base cannot
# be found, HEAD is detached or the branch is far from origin/main — check everything.
# GATE_SCOPE=all forces the full scope.
MAX_AHEAD="${GATE_MAX_AHEAD:-50}"
MAX_BEHIND="${GATE_MAX_BEHIND:-300}"
SCOPE_ALL=0
SCOPE_WHY=""
base_ref="$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
if [ -z "$base_ref" ] && git -C "$repo" rev-parse --verify -q refs/remotes/origin/main >/dev/null 2>&1; then
    base_ref="origin/main"
fi
mb=""
[ -n "$base_ref" ] && mb="$(git -C "$repo" merge-base HEAD "$base_ref" 2>/dev/null || true)"
if [ "${GATE_SCOPE:-}" = "all" ]; then
    SCOPE_ALL=1 SCOPE_WHY="set by GATE_SCOPE=all"
elif [ -z "$base_ref" ]; then
    SCOPE_ALL=1 SCOPE_WHY="neither origin/HEAD nor origin/main exists — no base for a diff"
elif [ -z "$mb" ]; then
    SCOPE_ALL=1 SCOPE_WHY="no merge-base of HEAD with $base_ref"
elif ! git -C "$repo" symbolic-ref -q HEAD >/dev/null 2>&1; then
    SCOPE_ALL=1 SCOPE_WHY="HEAD is detached — unknown which branch is being checked"
else
    counts="$(git -C "$repo" rev-list --left-right --count "$base_ref...HEAD" 2>/dev/null || true)"
    behind="${counts%%[[:space:]]*}"
    ahead="${counts##*[[:space:]]}"
    if ! [[ "$behind" =~ ^[0-9]+$ && "$ahead" =~ ^[0-9]+$ ]]; then
        SCOPE_ALL=1 SCOPE_WHY="could not count the divergence from $base_ref"
    elif [ "$ahead" -gt "$MAX_AHEAD" ]; then
        SCOPE_ALL=1 SCOPE_WHY="the branch is $ahead commits ahead of $base_ref (threshold GATE_MAX_AHEAD=$MAX_AHEAD) — a long-lived branch"
    elif [ "$behind" -gt "$MAX_BEHIND" ]; then
        SCOPE_ALL=1 SCOPE_WHY="the branch is $behind commits behind $base_ref (threshold GATE_MAX_BEHIND=$MAX_BEHIND)"
    fi
fi

changed_paths() {
    {
        # the worktree and the index, with rename arrows removed
        git -C "$repo" -c core.quotePath=false status --porcelain 2>/dev/null | sed 's/^...//; s/.* -> //'
        # everything the branch added on top of its base
        [ -n "$mb" ] && git -C "$repo" -c core.quotePath=false diff --name-only "$mb"...HEAD 2>/dev/null
    } | sed 's/^"//; s/"$//; /^$/d' | sort -u
}

# A fingerprint without HEAD is a fingerprint of nothing, that is, an eternal constant: such a thing
# must not be cached.
# The paths are the package itself and its workspace dependencies: an uncommitted edit in
# packages/shared must change the fingerprint of every package that depends on it.
fingerprint() { # $@ = paths inside the repository
    local head
    head="$(git -C "$repo" rev-parse HEAD 2>/dev/null)" || return 1
    [ -n "$head" ] || return 1
    {
        echo "$head"
        echo "scope: $*"
        git -C "$repo" diff HEAD -- "$@" 2>/dev/null
        git -C "$repo" ls-files --others --exclude-standard -- "$@" 2>/dev/null |
            while read -r f; do shasum "$repo/$f" 2>/dev/null; done
    } | shasum | awk '{print $1}'
}

run_script() { # $1 = package name (empty = root), $2 = script
    local pkg="$1" script="$2"
    if [ -n "$pkg" ]; then
        case "$PM" in
            pnpm) (cd "$repo" && pnpm --filter "$pkg" run "$script" 2>&1) ;;
            yarn) (cd "$repo" && yarn workspace "$pkg" run "$script" 2>&1) ;;
            *) (cd "$repo" && npm run "$script" --workspace "$pkg" 2>&1) ;;
        esac
    else
        (cd "$repo" && "$PM" run "$script" 2>&1)
    fi
}

# A missing environment is not a defect in the code. It must not block, but it must
# not count as green either: such work stays unverified.
UNVERIFIABLE='command not found|Cache entry required but missing|ENOENT.*node_modules'
UNVERIFIABLE+='|Cannot connect to the Docker daemon|Could not find a working container runtime'
UNVERIFIABLE+='|docker daemon is not running|ECONNREFUSED.*:5432|could not connect to server'

# An environment line can also turn up in the stack trace of a real test failure.
# The sign of a live run matters more: if the tests reported, it is a failure, not the environment.
real_failure() {
    printf '%s' "$1" | grep -qE 'Tests?[[:space:]]+[0-9]+[[:space:]]+(failed|passed)|^ *FAIL |AssertionError|✗|Expected .* to'
}

FAILED=0
REPORT=""
RAN=""
CACHED=""
FAILED_LABELS=""
ENV_BROKEN=""

changed="$(changed_paths)"
nchanged=0
[ -n "$changed" ] && nchanged="$(printf '%s\n' "$changed" | wc -l | tr -d ' ')"
if [ "$SCOPE_ALL" -eq 0 ] && [ -z "$changed" ]; then
    write_verdict none 0 "no changes relative to the merge-base ${mb:0:8} with $base_ref"
    echo "[gate] ничего не прогналось ($PROFILE): нет изменений относительно merge-base ${mb:0:8} с $base_ref. Это не «зелено»."
    exit 0
fi

plan="$(printf '%s\n' "$changed" | GATE_ALL="$SCOPE_ALL" node "$RESOLVE" "$repo" "$PROFILE" "$KEY")"
rc=$?
if [ "$rc" -ne 0 ]; then
    # A crashed resolver would give an empty plan, and an empty plan reads as "nothing
    # touched". That is not so: verification failed. The red marker is left alone.
    printf 'Profile %s, repository %s. Could not verify: the plan resolver exited with code %s.\n' \
        "$PROFILE" "$KEY" "$rc" >"$UNVERIFIED_MARKER"
    write_verdict unverified 3 "the plan resolver gate-resolve.mjs exited with code $rc"
    echo "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер плана gate-resolve.mjs завершился с кодом $rc — ничего не проверено, это не «зелено»." >&2
    exit 3
fi

# The scope is always printed: it shows whether the gate narrowed and why.
plan_dirs=""
plan_added=""
while IFS= read -r line; do
    [ -n "$line" ] || continue
    splitn "$line"
    plan_dirs+=" ${FLD[0]}"
    [ -n "${FLD[4]:-}" ] && plan_added+="${plan_added:+, }${FLD[0]} (from ${FLD[4]//,/, })"
done <<<"$plan"
if [ "$SCOPE_ALL" -eq 1 ]; then
    echo "[gate] scope ($PROFILE): all packages —${plan_dirs:- none} (reason: $SCOPE_WHY)"
else
    echo "[gate] scope ($PROFILE): narrowed by the diff from merge-base ${mb:0:8} with $base_ref (branch ahead by $ahead, behind by $behind; files changed: $nchanged) —${plan_dirs:- none}${plan_added:+; added as dependents: $plan_added}. Full scope: GATE_SCOPE=all"
fi
if [ -z "$plan_dirs" ]; then
    write_verdict none 0 "the changes touch no checked package"
    echo "[gate] ничего не прогналось ($PROFILE): изменения не затрагивают проверяемые пакеты. Это не «зелено»."
    exit 0
fi

while IFS= read -r line; do
    [ -n "$line" ] || continue
    splitn "$line"
    wsdir="${FLD[0]}" pkgname="${FLD[1]:-}" scripts="${FLD[2]:-}" fpscope="${FLD[3]:-}"
    [ -n "$scripts" ] || continue
    [ -n "$fpscope" ] || fpscope="$wsdir"

    # The key includes the set of scripts too: the profile was widened — the old green does not count.
    shash="$(printf '%s' "$scripts" | shasum | awk '{print $1}' | cut -c1-8)"
    key="$CACHE/${KEY}__${tag}__${wsdir//\//_}__${PROFILE}__${shash}"
    # shellcheck disable=SC2086 # workspace paths have no spaces, split on purpose
    fp="$(fingerprint $fpscope)" || fp=""
    if [ -n "$fp" ] && [ -f "$key" ] && [ "$(cat "$key")" = "$fp" ]; then
        # Unchanged since it turned green. Only green is cached:
        # red is always run again, so that a flaky test does not stick.
        for script in $scripts; do CACHED+=" $KEY/$wsdir:$script"; done
        continue
    fi

    ws_ok=1
    for script in $scripts; do
        label="$KEY/$wsdir:$script"
        out="$(run_script "$pkgname" "$script" </dev/null)" # the loop's stdin is the plan, do not hand it to pnpm
        rc=$?
        if [ "$rc" -eq 0 ]; then
            RAN+=" $label"
        elif printf '%s' "$out" | grep -qE "$UNVERIFIABLE" && ! real_failure "$out"; then
            ws_ok=0
            ENV_BROKEN+=$'\n'"  $label: $(printf '%s\n' "$out" | grep -m1 -E "$UNVERIFIABLE")"
        else
            ws_ok=0
            FAILED=1
            FAILED_LABELS+=" $label"
            REPORT+=$'\n'"--- FAILED: $label"$'\n'"$(printf '%s\n' "$out" | tail -n 40)"$'\n'
        fi
    done

    [ "$ws_ok" -eq 1 ] && [ -n "$fp" ] && echo "$fp" >"$key"
done <<<"$plan"

if [ "$FAILED" -eq 1 ]; then
    date -u +%Y-%m-%dT%H:%M:%SZ >"$RED_MARKER"
    write_verdict red 2 ""
    {
        echo "[gate] красно ($PROFILE):$FAILED_LABELS${RAN:+ (прошло:$RAN)}"
        echo "The quality gate did not pass (profile: $PROFILE, repository: $KEY)."
        echo "This must be fixed before reporting the work as done."
        echo "$REPORT"
    } >&2
    exit 2
fi

if [ -n "$ENV_BROKEN" ]; then
    {
        printf 'Profile %s, repository %s. Could not verify:%s\n' "$PROFILE" "$KEY" "$ENV_BROKEN"
    } >"$UNVERIFIED_MARKER"
    write_verdict unverified 0 "the environment is unavailable:$(printf '%s' "$ENV_BROKEN" | tr '\n' ' ' | tr -s ' ')"
    {
        echo "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно:"
        echo "$ENV_BROKEN"
        echo "This is not a green result. Say so: the work is not verified — instead of a success report."
    } >&2
elif [ -n "$RAN$CACHED" ]; then
    # Clear only on the result of a check that actually checked something:
    # a fresh run or a cache entry written by a green run of the same content.
    # Otherwise a red state could be washed away by editing a document.
    rm -f "$RED_MARKER" "$UNVERIFIED_MARKER"
    rm -f "$STATE/stop-blocks/"*"__${KEY}-${tag}" 2>/dev/null
    write_verdict green 0 ""
    # The line «[gate] зелено (<profile>): …» is the only sign of green, and
    # on a cache hit it is printed too, marked «(кэш)».
    if [ -z "$RAN" ]; then
        echo "[gate] зелено ($PROFILE):$CACHED (кэш)"
    elif [ -n "$CACHED" ]; then
        echo "[gate] зелено ($PROFILE):$RAN (кэш:$CACHED)"
    else
        echo "[gate] зелено ($PROFILE):$RAN"
    fi
else
    write_verdict none 0 "the selected packages have no scripts of the profile"
    echo "[gate] ничего не прогналось ($PROFILE): у выбранных пакетов нет скриптов профиля. Это не «зелено»."
fi

exit 0
