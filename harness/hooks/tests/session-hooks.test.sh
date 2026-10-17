#!/usr/bin/env bash
# Tests of hooks/session-start.mjs and hooks/session-end.mjs.
# Run: bash harness/hooks/tests/session-hooks.test.sh; exit code 0 means everything passed.
#
# The registry is the live one (read only; this test looks for it at $HOME/.claude/gate/config.json,
# the legacy place the hooks fall back to when $HARNESS_HOME/gate/config.json is missing), the profiles
# are a copy of ~/.claude/profiles in a temporary directory (CLAUDE_PROFILES_DIR), so the real
# state/pending-retro.log is not touched. Plus a synthetic registry for edge cases, run with a
# temporary home folder. JSON is read with node, not jq: Git Bash on Windows has no jq.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; a path like
# /c/… or /tmp/… means nothing to node. Elsewhere there is no -W.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
# The hooks and bin/profile under test are the copies next to this test (harness/); BIN_DIR and
# HOOKS_DIR point it at another copy. Checks on live repositories need the live registry too.
HARNESS="$(cd "$(dirname "$0")/../.." && { pwd -W 2>/dev/null || pwd; })"
BIN="${BIN_DIR:-$HARNESS/bin}"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
START="$HOOKS/session-start.mjs"
END="$HOOKS/session-end.mjs"
export CLAUDE_PROFILE_BIN="$BIN/profile" CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
LIVE_GATE="$HOME/.claude/gate/config.json"
ATAKAMA="$HOME/Work/Atakama"
AUCTION="$HOME/Work/Auction"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
. "$HARNESS/bin/tests/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
if [ -d "$HOME/.claude/profiles" ]; then
    cp -Rp "$HOME/.claude/profiles" "$T/profiles"
    rm -rf "$T"/profiles/*/state
else
    mkdir -p "$T/profiles"
fi
mkdir -p "$T/plain"
export CLAUDE_PROFILES_DIR="$T/profiles"

# $1 hook, $2 directory to run in ($PWD), $3 cwd in the JSON (empty means no cwd field)
run() {
    local payload='{"session_id":"t-1","hook_event_name":"X"}'
    [ -n "$3" ] && payload="{\"session_id\":\"t-1\",\"cwd\":\"$3\",\"hook_event_name\":\"X\"}"
    (cd "$2" && printf '%s' "$payload" | node "$1")
}
# A field of the hook output on stdin ("" when it is not JSON or has no such field).
field() {
    node -e '
let o
try { o = JSON.parse(require("fs").readFileSync(0, "utf8")) } catch { process.exit(0) }
const v = (o && o.hookSpecificOutput || {})[process.argv[1]]
if (typeof v === "string") process.stdout.write(v + "\n")' "$1" 2>/dev/null
}
ctx() { field additionalContext; }

LOG="$T/profiles/atakama/state/pending-retro.log"

if [ -d "$ATAKAMA/Atakama-Browser-Server" ] && [ -f "$LIVE_GATE" ]; then
    R="$ATAKAMA/Atakama-Browser-Server"
    out="$(run "$START" "$R" "$R")"; rc=$?
    c="$(printf '%s' "$out" | ctx)"
    [ "$rc" -eq 0 ] && [ "$(printf '%s' "$out" | field hookEventName)" = SessionStart ] \
        && ok "atakama repo: SessionStart JSON, exit 0" || bad "atakama repo: rc=$rc out=${out:0:120}"
    [[ "$c" == *"## Personal working rules (Alexey only — never commit these to the repos)"* ]] \
        && ok "atakama repo: rules.md under profile heading" || bad "atakama repo: rules heading missing"
    [[ "$c" == *"## Lessons learned so far (one-liners; full log in ${T/#$HOME/~}/profiles/atakama/lessons/lessons.md)"$'\n'"<!-- One line per lesson"* ]] \
        && ok "atakama repo: lessons index injected" || bad "atakama repo: lessons heading missing"
    [[ "$c" != *"## Sources"* ]] && ok "atakama repo: Sources section stripped" || bad "atakama repo: Sources leaked"
    [[ "$c" != *"Housekeeping"* ]] && ok "atakama repo: no retro reminder without log" || bad "atakama repo: reminder without log"

    # session-end writes into the profile's state; at the third line session-start reminds
    for d in "$ATAKAMA" "$R" "$R/elt"; do [ -d "$d" ] && run "$END" "$d" "$d" >/dev/null; done
    n="$(wc -l <"$LOG" 2>/dev/null | tr -d ' ')"
    [ "${n:-0}" -ge 2 ] && grep -q $'\t'"$R"'$' "$LOG" && ok "session-end appends time<TAB>cwd ($n lines)" \
        || bad "session-end: log has ${n:-0} lines"
    printf 'x\tx\nx\tx\nx\tx\n' >"$LOG"
    c="$(run "$START" "$R" "$R" | ctx)"
    [[ "$c" == *"## Housekeeping"$'\n'"3 sessions have ended without a retrospective."* ]] \
        && ok "retro reminder at 3 pending sessions" || bad "retro reminder missing"

    # active epic
    mkdir -p "$T/profiles/atakama/epics/ep1" && echo "MAP-OF-EP1" >"$T/profiles/atakama/epics/ep1/map.md"
    echo ep1 >"$T/profiles/atakama/state/active-epic"
    c="$(run "$START" "$R" "$R" | ctx)"
    [[ "$c" == *"## Active epic: ep1"$'\n'"MAP-OF-EP1"* ]] && ok "active epic map injected" || bad "active epic map missing"
    # a large epic map is cut to the section limit and names the full file
    mkdir -p "$T/profiles/atakama/epics/big"
    { echo "BIG-MAP-HEAD"; for i in $(seq 1 3000); do echo "line $i of a very large epic map, padding padding"; done; echo "BIG-MAP-TAIL"; } \
        >"$T/profiles/atakama/epics/big/map.md"
    echo big >"$T/profiles/atakama/state/active-epic"
    c="$(run "$START" "$R" "$R" | ctx)"
    sec="${c#*## Active epic: big}"
    [[ "$c" == *"## Active epic: big"$'\n'"BIG-MAP-HEAD"* && "$c" != *"BIG-MAP-TAIL"* \
        && "$sec" == *"truncated, full text: $T/profiles/atakama/epics/big/map.md"* ]] && [ "$(printf '%s' "$sec" | wc -c)" -le 20300 ] \
        && ok "large epic map capped with a pointer to the full file ($(printf '%s' "$sec" | wc -c | tr -d ' ') bytes)" \
        || bad "large map not capped: section $(printf '%s' "$sec" | wc -c) bytes"
    rm -rf "$T/profiles/atakama/state/active-epic" "$T/profiles/atakama/epics/ep1" "$T/profiles/atakama/epics/big"
    c="$(run "$START" "$R" "$R" | ctx)"
    [[ "$c" != *"truncated, full text"* ]] && ok "normal sections are not capped" || bad "small sections got a cut marker"
    # the boundary exactly at the end of a line: the whole line stays; a non-numeric limit means the default 20000
    mkdir -p "$T/profiles/atakama/epics/edge"; printf 'abc\ndefg\nhij\n' >"$T/profiles/atakama/epics/edge/map.md"
    echo edge >"$T/profiles/atakama/state/active-epic"
    c="$(CLAUDE_SESSION_SECTION_CAP=8 run "$START" "$R" "$R" | ctx)"
    [[ "$c" == *"## Active epic: edge"$'\n'"abc"$'\n'"defg"$'\n'"… truncated"* ]] && ok "cut on a line boundary keeps the whole line" \
        || bad "boundary cut lost a line: $(printf '%s' "${c#*Active epic: edge}" | head -c 80)"
    c="$(CLAUDE_SESSION_SECTION_CAP=20k run "$START" "$R" "$R" 2>&1 | ctx)"
    [[ "$c" == *"abc"$'\n'"defg"$'\n'"hij"* && "$c" != *"truncated, full text"* ]] && ok "non-numeric cap falls back to the default" || bad "non-numeric cap broke the hook"
    rm -rf "$T/profiles/atakama/state/active-epic" "$T/profiles/atakama/epics/edge"

    # the shared directory above three repositories (not git itself) — the same profile
    a="$(run "$START" "$ATAKAMA" "$ATAKAMA")"; b="$(run "$START" "$R" "$R")"
    [ -n "$a" ] && [ "$a" = "$b" ] && ok "atakama workspace root: same context as a repo" || bad "atakama workspace root differs"

    # someone else's git repository in the shared directory that is not in the registry (flux-config-platform) —
    # "not registered": session-start stays silent, session-end writes nothing
    F="$ATAKAMA/flux-config-platform"
    if [ -d "$F/.git" ]; then
        : >"$LOG"
        out="$(run "$START" "$F" "$F")"; rc=$?
        [ "$rc" -eq 0 ] && [ -z "$out" ] && ok "flux-config-platform: session-start silent" || bad "flux start: rc=$rc out=${out:0:120}"
        out="$(run "$END" "$F" "$F")"; rc=$?
        [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -s "$LOG" ] && ok "flux-config-platform: session-end writes nothing" \
            || bad "flux end: rc=$rc log=$(wc -l <"$LOG")"
    fi

    # cwd from the JSON wins over $PWD
    c="$(run "$START" "$T/plain" "$R" | ctx)"
    [[ "$c" == *"Personal working rules"* ]] && ok "cwd from hook JSON wins over PWD" || bad "cwd from JSON ignored"
    # without the cwd field — $PWD
    c="$(run "$START" "$R" "" | ctx)"
    [[ "$c" == *"Personal working rules"* ]] && ok "no cwd in JSON: falls back to PWD" || bad "PWD fallback broken"
else
    echo "skip atakama checks: $ATAKAMA or $LIVE_GATE missing"
fi

if [ -d "$AUCTION" ] && [ -f "$LIVE_GATE" ]; then
    out="$(run "$START" "$AUCTION" "$AUCTION")"; rc=$?
    [ "$rc" -eq 0 ] && [ -z "$out" ] && ok "auction: session-start prints nothing (inject_rules false)" \
        || bad "auction: rc=$rc out=${out:0:120}"
    out="$(run "$END" "$AUCTION" "$AUCTION")"; rc=$?
    [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$T/profiles/auction/state" ] \
        && ok "auction: session-end writes nothing" || bad "auction: session-end rc=$rc or wrote state"
else
    echo "skip auction checks: $AUCTION or $LIVE_GATE missing"
fi

out="$(run "$START" "$T/plain" "$T/plain")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "unregistered dir: session-start silent, exit 0" || bad "unregistered start: rc=$rc"
before="$(find "$T/profiles" -name pending-retro.log -exec cat {} + 2>/dev/null | wc -l)"
out="$(run "$END" "$T/plain" "$T/plain")"; rc=$?
after="$(find "$T/profiles" -name pending-retro.log -exec cat {} + 2>/dev/null | wc -l)"
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ "$before" = "$after" ] && ok "unregistered dir: session-end silent, writes nothing" \
    || bad "unregistered end: rc=$rc before=$before after=$after"

# --- synthetic registry: a profile without the session field, a broken profile -------------
# From here on the home folder is a temporary one: the hooks shorten a path under it to ~, and the
# temporary directory may lie under the real home (on Windows it does). HOME is the home folder of
# node on macOS and Linux, USERPROFILE on Windows: both are set.
REAL_HOME="$HOME"
mkdir -p "$T/home"
export HOME="$T/home" USERPROFILE="$T/home"
mkdir -p "$T/syn/p1" "$T/syn/p2" "$T/sp/quiet" "$T/sp/broken"
git -C "$T/syn/p1" init -q; git -C "$T/syn/p2" init -q
echo '{"schema":1,"name":"quiet","lessons":"profile"}' >"$T/sp/quiet/profile.json"
echo '# quiet rules' >"$T/sp/quiet/rules.md"
echo '{broken' >"$T/sp/broken/profile.json"
cat >"$T/syn.json" <<EOF
{"repos":[{"key":"q","match":"$T/syn/p1","profile":"quiet"},{"key":"b","match":"$T/syn/p2","profile":"broken"}]}
EOF
for hook in "$START" "$END"; do
    h="$(basename "$hook")"
    out="$(CLAUDE_GATE_CONFIG="$T/syn.json" CLAUDE_PROFILES_DIR="$T/sp" run "$hook" "$T/syn/p1" "$T/syn/p1")"; rc=$?
    [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$T/sp/quiet/state" ] && ok "$h: profile without session field -> nothing" \
        || bad "$h: no-session profile rc=$rc out=${out:0:80}"
    out="$(CLAUDE_GATE_CONFIG="$T/syn.json" CLAUDE_PROFILES_DIR="$T/sp" run "$hook" "$T/syn/p2" "$T/syn/p2")"; rc=$?
    [ "$rc" -eq 0 ] && [ -z "$out" ] && ok "$h: broken profile.json -> silent exit 0" || bad "$h: broken profile rc=$rc"
done

# a reminder about /retro without mixing in rules.md (no inject_rules, retro_reminder_after present)
mkdir -p "$T/syn/p3" "$T/sp/remind"; git -C "$T/syn/p3" init -q
echo '{"schema":1,"name":"remind","session":{"retro_reminder_after":1}}' >"$T/sp/remind/profile.json"
echo '# remind rules' >"$T/sp/remind/rules.md"
printf '{"repos":[{"key":"r","match":"%s","profile":"remind"}]}\n' "$T/syn/p3" >"$T/syn3.json"
CLAUDE_GATE_CONFIG="$T/syn3.json" CLAUDE_PROFILES_DIR="$T/sp" run "$END" "$T/syn/p3" "$T/syn/p3" >/dev/null
c="$(CLAUDE_GATE_CONFIG="$T/syn3.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/p3" "$T/syn/p3" | ctx)"
[[ "$c" == *"## Housekeeping"* && "$c" != *"remind rules"* ]] && ok "reminder-only profile: reminder without rules" \
    || bad "reminder-only profile: [$c]"

# --- the workflow mode (worfy-harness ticket 22) -----------------------------------------------
# Silent mode and attribution off are said in every session of the project, whatever session.inject_rules
# says; a Full project with attribution on gets the same output as before (nothing, without inject_rules).
mkdir -p "$T/syn/s1" "$T/syn/f1" "$T/syn/f2" "$T/sp/silent" "$T/sp/fullon" "$T/sp/fulloff" "$T/wf"
for r in s1 f1 f2; do git -C "$T/syn/$r" init -q; done
printf '{"schema":2,"name":"silent","mode":"silent","attribution":"off","workflow":{"folder":"%s"}}\n' "$T/wf" >"$T/sp/silent/profile.json"
echo '{"schema":2,"name":"fullon","mode":"full","attribution":"on"}' >"$T/sp/fullon/profile.json"
echo '{"schema":2,"name":"fulloff","mode":"full","attribution":"off"}' >"$T/sp/fulloff/profile.json"
printf '{"repos":[{"key":"s","match":"%s","profile":"silent"},{"key":"f","match":"%s","profile":"fullon"},{"key":"o","match":"%s","profile":"fulloff"}]}\n' \
    "$T/syn/s1" "$T/syn/f1" "$T/syn/f2" >"$T/syn4.json"
c="$(CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/s1" "$T/syn/s1" | ctx)"
if [[ "$c" == *"## Workflow mode (profile silent)"* && "$c" == *"This project works in Silent mode"* && "$c" == *"Workflow folder $T/wf,"* ]] \
   && [[ "$c" == *"no epic names, ticket or ADR numbers"* && "$c" == *"Attribution is off for this project"* ]]; then
    ok "silent + attribution off: the mode and attribution lines are mixed in without inject_rules"
else bad "silent session context: [$c]"; fi
out="$(CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/f1" "$T/syn/f1")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "full + attribution on: output as before (nothing)" || bad "full on: rc=$rc out=${out:0:200}"
c="$(CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/f2" "$T/syn/f2" | ctx)"
[[ "$c" == *"Attribution is off"* && "$c" != *"Silent mode"* ]] && ok "full + attribution off: only the attribution line" || bad "full off: [$c]"
# The profile does not set `attribution`: off in Silent mode, on in Full mode; a value written in the profile wins.
printf '{"schema":2,"name":"silent","mode":"silent","workflow":{"folder":"%s"}}\n' "$T/wf" >"$T/sp/silent/profile.json"
echo '{"schema":2,"name":"fullon","mode":"full"}' >"$T/sp/fullon/profile.json"
c="$(CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/s1" "$T/syn/s1" | ctx)"
[[ "$c" == *"This project works in Silent mode"* && "$c" == *"Attribution is off for this project"* ]] \
    && ok "silent, attribution not set: the attribution line is mixed in" || bad "silent, attribution not set: [$c]"
out="$(CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/f1" "$T/syn/f1")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "full, attribution not set: nothing is mixed in" || bad "full, attribution not set: rc=$rc out=${out:0:200}"
printf '{"schema":2,"name":"silent","mode":"silent","attribution":"on","workflow":{"folder":"%s"}}\n' "$T/wf" >"$T/sp/silent/profile.json"
c="$(CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/s1" "$T/syn/s1" | ctx)"
[[ "$c" == *"This project works in Silent mode"* && "$c" != *"Attribution is off"* ]] \
    && ok "silent with an explicit attribution on: the mode lines without the attribution line" || bad "silent, explicit on: [$c]"

# --- the home folder, cwd from the hook JSON, Windows paths (worfy-windows ticket 04) --------------
# A Workflow folder under the home folder is shown as ~/…, with / after the ~ on every system. The
# home folder is os.homedir(): on Windows that is USERPROFILE, so there HOME points elsewhere and
# must not count; on macOS and Linux os.homedir() is HOME, and both name the same folder.
if [ "$WIN" -eq 1 ]; then tilde_home="$T/home"; else tilde_home="$T"; fi
c="$(HOME="$tilde_home" USERPROFILE="$T" CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/s1" "$T/syn/s1" | ctx)"
[[ "$c" == *"Workflow folder ~/wf,"* ]] && ok "Workflow folder under the home folder (os.homedir()) is shown as ~/wf" \
    || bad "Workflow folder under the home folder: $(printf '%s' "$c" | grep -o 'Workflow folder [^,]*')"

# cwd from the hook JSON wins over $PWD (the hook runs in a folder outside the registry).
c="$(CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/plain" "$T/syn/s1" | ctx)"
[[ "$c" == *"This project works in Silent mode"* ]] && ok "synthetic: cwd from the hook JSON wins over PWD" || bad "synthetic: cwd from the JSON ignored: [$c]"

# Claude Code on Windows sends cwd as C:\… with backslashes and gives CLAUDE_PLUGIN_ROOT as C:/…;
# bin/profile is the one next to the hooks (no CLAUDE_PROFILE_BIN), run from a folder outside the
# registry, so only the cwd of the JSON can find the project.
if [ "$WIN" -eq 1 ] && [ -z "${BIN_DIR:-}" ]; then
    wcwd="$(cygpath -w "$T/syn/s1")"; wjson="${wcwd//\\/\\\\}"
    c="$(cd "$T/plain" && printf '{"session_id":"t-1","cwd":"%s","hook_event_name":"SessionStart"}' "$wjson" \
        | env -u CLAUDE_PROFILE_BIN CLAUDE_PLUGIN_ROOT="$HARNESS" CLAUDE_GATE_CONFIG="$T/syn4.json" CLAUDE_PROFILES_DIR="$T/sp" node "$START" | ctx)"
    [[ "$c" == *"This project works in Silent mode"* ]] && ok "windows: cwd C:\\… with backslashes finds the project" \
        || bad "windows: cwd $wcwd not used: [$c]"
    wcwd3="$(cygpath -w "$T/syn/p3")"; : >"$T/sp/remind/state/pending-retro.log"
    (cd "$T/plain" && printf '{"session_id":"t-1","cwd":"%s","hook_event_name":"SessionEnd"}' "${wcwd3//\\/\\\\}" \
        | env -u CLAUDE_PROFILE_BIN CLAUDE_PLUGIN_ROOT="$HARNESS" CLAUDE_GATE_CONFIG="$T/syn3.json" CLAUDE_PROFILES_DIR="$T/sp" node "$END")
    last="$(tail -n 1 "$T/sp/remind/state/pending-retro.log" 2>/dev/null)"
    [ "${last#*$'\t'}" = "$wcwd3" ] && ok "windows: session-end writes the cwd C:\\… as the hook got it" \
        || bad "windows: session-end log line: [$last]"
else
    echo "skip windows paths: not Git Bash on Windows, or BIN_DIR names another bin/profile"
fi

home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$home_before") <(printf '%s\n' "$home_after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
