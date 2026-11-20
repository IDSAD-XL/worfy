#!/usr/bin/env bash
# Tests of hooks/session-start.mjs and hooks/after-compact.mjs (SessionStart of the branch compact), and of the SessionEnd hooks of hooks.json for a profile that still
# carries session.retro_reminder_after, a removed field: no hook writes a retrospective log.
# Run: bash harness/hooks/tests/session-hooks.test.sh; exit code 0 means everything passed.
#
# The first checks run with the live registry (read only) and a copy of ~/.claude/profiles in a
# temporary directory (CLAUDE_PROFILES_DIR), so the real state/ of the profiles is not touched. The
# rest run on synthetic registries and profiles with a temporary home folder: a project of several
# repositories below a common directory, profiles without the session field, broken ones.
# JSON is read with node, not jq: Git Bash on Windows has no jq.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; a path like
# /c/… or /tmp/… means nothing to node. Elsewhere there is no -W.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
# The hooks and bin/profile under test are the copies next to this test (harness/); BIN_DIR and
# HOOKS_DIR point it at another copy.
HARNESS="$(cd "$(dirname "$0")/../.." && { pwd -W 2>/dev/null || pwd; })"
BIN="${BIN_DIR:-$HARNESS/bin}"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
START="$HOOKS/session-start.mjs"
export CLAUDE_PROFILE_BIN="$BIN/profile" CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
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

out="$(run "$START" "$T/plain" "$T/plain")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "unregistered dir: session-start silent, exit 0" || bad "unregistered start: rc=$rc"

# --- synthetic registry: a profile without the session field, a broken profile -------------
# From here on the home folder is a temporary one: the hooks shorten a path under it to ~, and the
# temporary directory may lie under the real home (on Windows it does). HOME is the home folder of
# node on macOS and Linux, USERPROFILE on Windows: both are set.
REAL_HOME="$HOME"
mkdir -p "$T/home"
export HOME="$T/home" USERPROFILE="$T/home"

# --- a project of several repositories: suite-api and suite-web below the common directory suite ----
# (not git itself) share the profile suite, which mixes its rules and lessons into the session and still
# carries the removed field session.retro_reminder_after; scratch-tools is someone else's git repository in the
# same directory, not in the registry. The profile acme sets inject_rules false. The profiles lie
# under the home folder, so the hook shows the path of the lessons log as ~/….
SP="$HOME/sp"
W="$T/work/suite"
mkdir -p "$W/suite-api/elt" "$W/suite-web" "$W/scratch-tools" "$T/work/acme" "$SP/suite/lessons" "$SP/acme"
for r in "$W/suite-api" "$W/suite-web" "$W/scratch-tools" "$T/work/acme"; do git -C "$r" init -q; done
echo '{"schema":1,"name":"suite","lessons":"profile","session":{"inject_rules":true,"retro_reminder_after":3}}' >"$SP/suite/profile.json"
printf '## Personal working rules (never commit these to the repos)\nSUITE-RULE\n\n## Sources\nSUITE-SOURCE\n' >"$SP/suite/rules.md"
printf '<!-- One line per lesson -->\n- a lesson\n' >"$SP/suite/lessons/lessons-index.md"
echo '{"schema":1,"name":"acme","session":{"inject_rules":false}}' >"$SP/acme/profile.json"
echo '# acme rules' >"$SP/acme/rules.md"
printf '{"repos":[{"key":"api","match":"%s","profile":"suite"},{"key":"web","match":"%s","profile":"suite"},{"key":"acme","match":"%s","profile":"acme"}]}\n' \
    "$W/suite-api" "$W/suite-web" "$T/work/acme" >"$T/suite.json"
srun() { CLAUDE_GATE_CONFIG="$T/suite.json" CLAUDE_PROFILES_DIR="$SP" run "$@"; }
LOG="$SP/suite/state/pending-retro.log"
R="$W/suite-api"
out="$(srun "$START" "$R" "$R")"; rc=$?
c="$(printf '%s' "$out" | ctx)"
[ "$rc" -eq 0 ] && [ "$(printf '%s' "$out" | field hookEventName)" = SessionStart ] \
    && ok "suite repo: SessionStart JSON, exit 0" || bad "suite repo: rc=$rc out=${out:0:120}"
[[ "$c" == *"## Personal working rules (never commit these to the repos)"$'\n'"SUITE-RULE"* ]] \
    && ok "suite repo: rules.md under profile heading" || bad "suite repo: rules heading missing"
[[ "$c" == *"## Lessons learned so far (one-liners; full log in ~/sp/suite/lessons/lessons.md)"$'\n'"<!-- One line per lesson"* ]] \
    && ok "suite repo: lessons index injected" || bad "suite repo: lessons heading missing"
[[ "$c" != *"## Sources"* && "$c" != *"SUITE-SOURCE"* ]] && ok "suite repo: Sources section stripped" || bad "suite repo: Sources leaked"
[[ "$c" != *"Housekeeping"* ]] && ok "suite repo: no retro reminder without log" || bad "suite repo: reminder without log"
# A log an older Harness left with as many lines as the old threshold: no reminder any more, and the log
# itself stays as it was (it is the user's data; worfy does not delete it).
mkdir -p "$SP/suite/state" && printf 'x\tx\nx\tx\nx\tx\n' >"$LOG"
c="$(srun "$START" "$R" "$R" | ctx)"
[[ "$c" == *"SUITE-RULE"* && "$c" != *"Housekeeping"* && "$c" != *"/retro"* ]] && [ "$(wc -l <"$LOG" | tr -d ' ')" = 3 ] \
    && ok "suite repo: an old pending-retro.log of 3 lines gives no reminder and stays as it was" || bad "suite repo: reminder from an old log: [$c]"
rm -f "$LOG"

# active epic
mkdir -p "$SP/suite/epics/ep1" && echo "MAP-OF-EP1" >"$SP/suite/epics/ep1/map.md"
echo ep1 >"$SP/suite/state/active-epic"
c="$(srun "$START" "$R" "$R" | ctx)"
[[ "$c" == *"## Active epic: ep1"$'\n'"MAP-OF-EP1"* ]] && ok "active epic map injected" || bad "active epic map missing"
# a large epic map is cut to the section limit and names the full file
mkdir -p "$SP/suite/epics/big"
{ echo "BIG-MAP-HEAD"; for i in $(seq 1 3000); do echo "line $i of a very large epic map, padding padding"; done; echo "BIG-MAP-TAIL"; } \
    >"$SP/suite/epics/big/map.md"
echo big >"$SP/suite/state/active-epic"
c="$(srun "$START" "$R" "$R" | ctx)"
sec="${c#*## Active epic: big}"
size="$(printf '%s' "$sec" | wc -c | tr -d ' ')"
[[ "$c" == *"## Active epic: big"$'\n'"BIG-MAP-HEAD"* && "$c" != *"BIG-MAP-TAIL"* ]] && [ "$size" -le 20300 ] \
    && ok "large epic map cut to the section limit ($size bytes)" \
    || bad "large map not capped: section $size bytes"
# on Windows the hook prints the pointer with backslashes
sec_fwd="${sec//\\//}"
[[ "$sec_fwd" == *"truncated, full text: $SP/suite/epics/big/map.md"* ]] \
    && ok "large epic map names the full file" \
    || bad "large map has no pointer to the full file"
rm -rf "$SP/suite/state/active-epic" "$SP/suite/epics/ep1" "$SP/suite/epics/big"
c="$(srun "$START" "$R" "$R" | ctx)"
[[ "$c" != *"truncated, full text"* ]] && ok "normal sections are not capped" || bad "small sections got a cut marker"
# the boundary exactly at the end of a line: the whole line stays; a non-numeric limit means the default 20000
mkdir -p "$SP/suite/epics/edge"; printf 'abc\ndefg\nhij\n' >"$SP/suite/epics/edge/map.md"
echo edge >"$SP/suite/state/active-epic"
c="$(CLAUDE_SESSION_SECTION_CAP=8 srun "$START" "$R" "$R" | ctx)"
[[ "$c" == *"## Active epic: edge"$'\n'"abc"$'\n'"defg"$'\n'"… truncated"* ]] && ok "cut on a line boundary keeps the whole line" \
    || bad "boundary cut lost a line: $(printf '%s' "${c#*Active epic: edge}" | head -c 80)"
c="$(CLAUDE_SESSION_SECTION_CAP=20k srun "$START" "$R" "$R" 2>&1 | ctx)"
[[ "$c" == *"abc"$'\n'"defg"$'\n'"hij"* && "$c" != *"truncated, full text"* ]] && ok "non-numeric cap falls back to the default" || bad "non-numeric cap broke the hook"
rm -rf "$SP/suite/state/active-epic" "$SP/suite/epics/edge"

# the shared directory above the repositories (not git itself) — the same profile
a="$(srun "$START" "$W" "$W")"; b="$(srun "$START" "$R" "$R")"
[ -n "$a" ] && [ "$a" = "$b" ] && ok "suite workspace root: same context as a repo" || bad "suite workspace root differs"

# someone else's git repository in the shared directory that is not in the registry (scratch-tools) —
# "not registered": session-start stays silent
F="$W/scratch-tools"
out="$(srun "$START" "$F" "$F")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "scratch-tools: session-start silent" || bad "scratch-tools start: rc=$rc out=${out:0:120}"

# cwd from the JSON wins over $PWD
c="$(srun "$START" "$T/plain" "$R" | ctx)"
[[ "$c" == *"Personal working rules"* ]] && ok "cwd from hook JSON wins over PWD" || bad "cwd from JSON ignored"
# without the cwd field — $PWD
c="$(srun "$START" "$R" "" | ctx)"
[[ "$c" == *"Personal working rules"* ]] && ok "no cwd in JSON: falls back to PWD" || bad "PWD fallback broken"

# a profile with inject_rules false: session-start prints nothing and writes no state
out="$(srun "$START" "$T/work/acme" "$T/work/acme")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$SP/acme/state" ] && ok "acme: session-start prints nothing (inject_rules false)" \
    || bad "acme: rc=$rc out=${out:0:120}"
mkdir -p "$T/syn/p1" "$T/syn/p2" "$T/sp/quiet" "$T/sp/broken"
git -C "$T/syn/p1" init -q; git -C "$T/syn/p2" init -q
echo '{"schema":1,"name":"quiet","lessons":"profile"}' >"$T/sp/quiet/profile.json"
echo '# quiet rules' >"$T/sp/quiet/rules.md"
echo '{broken' >"$T/sp/broken/profile.json"
cat >"$T/syn.json" <<EOF
{"repos":[{"key":"q","match":"$T/syn/p1","profile":"quiet"},{"key":"b","match":"$T/syn/p2","profile":"broken"}]}
EOF
out="$(CLAUDE_GATE_CONFIG="$T/syn.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/p1" "$T/syn/p1")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$T/sp/quiet/state" ] && ok "session-start.mjs: profile without session field -> nothing" \
    || bad "session-start.mjs: no-session profile rc=$rc out=${out:0:80}"
out="$(CLAUDE_GATE_CONFIG="$T/syn.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/p2" "$T/syn/p2")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "session-start.mjs: broken profile.json -> silent exit 0" || bad "session-start.mjs: broken profile rc=$rc"

# A profile that still carries session.retro_reminder_after (a removed field) and no
# inject_rules: SessionStart prints nothing, as for a profile without the session field, and neither
# SessionStart nor any SessionEnd hook of hooks.json writes state/pending-retro.log. Claude Code and
# Codex run the same hooks.json; each SessionEnd command runs here as the hook runner starts it, with
# CLAUDE_PLUGIN_ROOT set and a Harness home of the test.
mkdir -p "$T/syn/p3" "$T/sp/remind" "$T/hh"; git -C "$T/syn/p3" init -q
echo '{"schema":1,"name":"remind","session":{"retro_reminder_after":1}}' >"$T/sp/remind/profile.json"
echo '# remind rules' >"$T/sp/remind/rules.md"
printf '{"repos":[{"key":"r","match":"%s","profile":"remind"}]}\n' "$T/syn/p3" >"$T/syn3.json"
out="$(CLAUDE_GATE_CONFIG="$T/syn3.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/p3" "$T/syn/p3")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$T/sp/remind/state/pending-retro.log" ] \
    && ok "retro_reminder_after without inject_rules: SessionStart prints nothing, exit 0, no pending-retro.log" \
    || bad "retro_reminder_after without inject_rules: SessionStart rc=$rc out=${out:0:120}"
ends=0 end_rcs=""
while IFS= read -r cmd; do
    [ -n "$cmd" ] || continue
    ends=$((ends + 1))
    (cd "$T/syn/p3" && printf '{"session_id":"t-1","cwd":"%s","hook_event_name":"SessionEnd","reason":"other"}' "$T/syn/p3" \
        | CLAUDE_PLUGIN_ROOT="$(dirname "$HOOKS")" HARNESS_HOME="$T/hh" CLAUDE_GATE_CONFIG="$T/syn3.json" CLAUDE_PROFILES_DIR="$T/sp" \
            bash -c "$cmd" >/dev/null 2>&1)
    end_rcs="$end_rcs $?"
done < <(node -e '
const groups = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).hooks.SessionEnd || []
for (const group of groups) for (const hook of group.hooks || []) console.log(hook.command)' "$HOOKS/hooks.json")
[ "$ends" -ge 1 ] && [ "${end_rcs// 0/}" = "" ] && [ ! -e "$T/sp/remind/state/pending-retro.log" ] \
    && ok "retro_reminder_after: the SessionEnd hooks of hooks.json ($ends) exit 0 and write no pending-retro.log" \
    || bad "retro_reminder_after: SessionEnd hooks ($ends, exit codes:$end_rcs) or a pending-retro.log was written"
[ ! -e "$HOOKS/session-end.mjs" ] && ok "hooks/session-end.mjs is gone" || bad "hooks/session-end.mjs is still there"

# rules.md is mixed in without its sources section, under either heading: `## Sources` or its old Russian form.
mkdir -p "$T/syn/p5" "$T/sp/rules"; git -C "$T/syn/p5" init -q
echo '{"schema":1,"name":"rules","session":{"inject_rules":true}}' >"$T/sp/rules/profile.json"
# The old Russian headings agents look for (Russian input on purpose) are mixed in under their English form,
# a CRLF one too; a heading with more words after it stays as written.
printf '# rules\n\n## Kept\nKEPT-RULE\n\n## Источники\nRU-SOURCE-LINE\n\n## After\nAFTER-RULE\n\n## Обязательное чтение исполнителя\nREAD-RULE\n\n## Ночной прогон и аудит\r\nNIGHT-RULE\n\n## Ночной прогон и аудит (old)\nOLD-RULE\n\n## Sources\nEN-SOURCE-LINE\n' >"$T/sp/rules/rules.md"
printf '{"repos":[{"key":"r5","match":"%s","profile":"rules"}]}\n' "$T/syn/p5" >"$T/syn5.json"
c="$(CLAUDE_GATE_CONFIG="$T/syn5.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/p5" "$T/syn/p5" | ctx)"
[[ "$c" == *"KEPT-RULE"* && "$c" == *"AFTER-RULE"* && "$c" != *"## Источники"* && "$c" != *"RU-SOURCE-LINE"* ]] \
    && ok "synthetic: rules.md without its old Russian sources section" || bad "synthetic: old Russian sources section: [$c]"
[[ "$c" != *"## Sources"* && "$c" != *"EN-SOURCE-LINE"* ]] \
    && ok "synthetic: rules.md without its '## Sources' section" || bad "synthetic: '## Sources' section: [$c]"
[[ "$c" == *$'## Required reading for the implementer\nREAD-RULE'* && "$c" == *$'## Overnight run and audit\r\nNIGHT-RULE'* && "$c" == *$'## Ночной прогон и аудит (old)\nOLD-RULE'* && "$c" != *"## Обязательное чтение исполнителя"* && "$c" != *$'## Ночной прогон и аудит\r'* && "$c" != *$'## Ночной прогон и аудит\n'* ]] \
    && ok "synthetic: the old Russian rules.md headings are mixed in under their English form" || bad "synthetic: rules.md headings: [$c]"
# A copy of the hook without lib/old-words.cjs next to it (hook-stdin.mjs, its reader of stdin, goes along):
# exit 0, one line on stderr, and the rules still mixed in, their headings as written.
mkdir -p "$T/nolib/hooks" && cp "$START" "$HOOKS/hook-stdin.mjs" "$T/nolib/hooks/"
out="$(CLAUDE_PROFILE_BIN="$HARNESS/bin/profile" CLAUDE_GATE_CONFIG="$T/syn5.json" CLAUDE_PROFILES_DIR="$T/sp" run "$T/nolib/hooks/session-start.mjs" "$T/syn/p5" "$T/syn/p5" 2>"$T/nolib.err")"; rc=$?
c="$(printf '%s' "$out" | ctx)"
[ "$rc" -eq 0 ] && [ "$(wc -l <"$T/nolib.err" | tr -d ' ')" = 1 ] && grep -q '^session-start: .*rules.md headings left as written$' "$T/nolib.err" \
    && [[ "$c" == *$'## Обязательное чтение исполнителя\nREAD-RULE'* && "$c" == *"KEPT-RULE"* ]] \
    && ok "without lib/old-words.cjs: exit 0, one stderr line, the rules mixed in as written" \
    || bad "without lib/old-words.cjs: rc=$rc, stderr: [$(cat "$T/nolib.err")], context: [${c:0:200}]"

# --- the workflow mode -----------------------------------------------
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
# Feature pages are the exception to both rules of this message: they read from the working tree and may be edited.
[[ "$c" == *"relative paths of the profile's tickets and docs fields (except \`docs.feature_pages\`, relative to the working tree) are taken from that folder"* ]] \
    && ok "silent: docs.feature_pages is not taken from the Workflow folder" || bad "silent, relative paths: [$c]"
[[ "$c" == *"Documents in the repository are read-only, unless the ticket's own goal is a document for the team and it says so, or the document is a page of \`docs.feature_pages\` (step 5 of ship-ticket)."* ]] \
    && ok "silent: a page of docs.feature_pages is an exception to read-only documents" || bad "silent, read-only documents: [$c]"
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

# --- the home folder, cwd from the hook JSON, Windows paths --------------
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
else
    echo "skip windows paths: not Git Bash on Windows, or BIN_DIR names another bin/profile"
fi

# --- after-compact.mjs: SessionStart of the branch `compact` ------------------------------------------
# A project with tickets: epic ep1 (ep1/01 claimed in this tree, ep1/02 open), epic ep2 (ep2/01 open). The
# main checkout is the Orchestrator's place; a linked worktree on a ticket branch is an implementer's. The real
# bin/profile, epic-status, ticket, stage-lines.mjs and wave-brief run on the synthetic registry; gh is a stand-in
# that lists no PR. The ticket files carry the done section under its Russian heading, as this project's tickets
# do (Russian input on purpose); FAKE_FILL below is a two-byte character (é) for the byte limit of Codex.
AFTER="$HOOKS/after-compact.mjs"
CP="$T/cmp/repo"
mkdir -p "$CP/.scratch/ep1/issues" "$CP/.scratch/ep2/issues" "$T/sp/cmp" "$T/cmp/stubs"
printf '# 01 — first of ep1\n\nStatus: claimed 2026-01-01T00:00Z\n\n## Готово, когда\n\n- [ ] EP1-ONE-DONE\n' >"$CP/.scratch/ep1/issues/01-first.md"
printf '# 02 — second of ep1\n\nStatus: open\n\n## Готово, когда\n\n- [ ] EP1-TWO-DONE\n' >"$CP/.scratch/ep1/issues/02-second.md"
printf '# 01 — first of ep2\n\nStatus: open\n' >"$CP/.scratch/ep2/issues/01-x.md"
echo base >"$CP/file.txt"
gq() { git -c user.email=t@example.invalid -c user.name=t -c init.defaultBranch=main -c core.autocrlf=false "$@"; }
(cd "$CP" && gq init -q && gq add -A && gq commit -q -m base) >/dev/null 2>&1
echo '{"schema":2,"name":"cmp","mode":"full","attribution":"on","worktree":{"base":"main"},"tickets":{"root":".scratch/","path":".scratch/<epic>/issues/NN-*.md","branch":"<epic>/<NN>","done_section":"## Готово, когда"},"workflow":{"finish":"pr-green-ci"}}' >"$T/sp/cmp/profile.json"
printf '{"repos":[{"key":"c","match":"%s","profile":"cmp"}]}\n' "$T/cmp" >"$T/cmp.json"
printf 'process.stdout.write("[]\\n")\n' >"$T/cmp/stubs/gh.mjs"
# A wave-brief stand-in for the limit: a head, a long Land section first, then Waiting and Open PRs.
cat >"$T/cmp/stubs/wave-brief.js" <<'EOF'
const epic = process.argv[2]
const fill = process.env.FAKE_FILL || "x"
const land = Array.from({ length: 200 }, (_, i) => `land line ${i} ` + fill.repeat(60))
process.stdout.write([`# Wave brief: ${epic} · now`, `Stage: /implement · ${epic} 1/3 · STAGE-OF-${epic}`, "Checkout: main", "",
    "## Land", ...land, "", "## Waiting", "02 in work: WAITING-LINE", "", "## Open PRs", "#7 OPEN-PR-LINE", "", "## Next wave", "NEXT-LINE", ""].join("\n"))
EOF
git -C "$CP" worktree add -q -b ep1/02 "$T/cmp/wt-02" >/dev/null 2>&1
# One commit on the ticket branch, then a change not committed and a new file.
echo step >"$T/cmp/wt-02/step.txt"
(cd "$T/cmp/wt-02" && gq add step.txt && gq commit -q -m "ep1/02: STEP-ONE-COMMIT") >/dev/null 2>&1
echo changed >"$T/cmp/wt-02/file.txt"; echo new >"$T/cmp/wt-02/new.txt"
git -C "$CP" worktree add -q --detach "$T/cmp/review" >/dev/null 2>&1
# $1 directory (cwd of the input), $2 source; the rest are variables for the hook. Output in $T/aout, stderr in $T/aerr.
compact() {
    local dir="$1" src="$2"; shift 2
    printf '{"session_id":"t-1","transcript_path":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"%s"}' \
        "${TRANSCRIPT:-$T/t-1.jsonl}" "$dir" "$src" \
        | env CLAUDE_GATE_CONFIG="$T/cmp.json" CLAUDE_PROFILES_DIR="$T/sp" WAVE_BRIEF_GH="$T/cmp/stubs/gh.mjs" CLAUDE_PLUGIN_ROOT="$(dirname "$HOOKS")" "$@" \
            node "$AFTER" >"$T/aout" 2>"$T/aerr"
    arc=$?
}
actx() { ctx <"$T/aout"; }

compact "$CP" compact WORFY_EPIC=ep2
c="$(actx)"
[ "$arc" -eq 0 ] && [[ "$c" == *"# Wave brief: ep2"* && "$c" == *"Stage: "*"ep2 0/1"* && "$c" != *"Wave brief: ep1"* ]] \
    && [ "$(field hookEventName <"$T/aout")" = SessionStart ] \
    && ok "after-compact: the Orchestrator (main checkout) gets wave-brief of WORFY_EPIC" \
    || bad "after-compact: Orchestrator with WORFY_EPIC: rc=$arc err=[$(cat "$T/aerr")] ctx=[${c:0:300}]"
compact "$CP" compact
c="$(actx)"
[[ "$c" == *"# Wave brief: ep1"* ]] && ok "after-compact: without WORFY_EPIC, the first Epic in play (a claimed ticket)" \
    || bad "after-compact: first Epic in play: err=[$(cat "$T/aerr")] ctx=[${c:0:300}]"
compact "$CP" compact WORFY_EPIC=nosuch
c="$(actx)"
[[ "$c" == *"# Wave brief: ep1"* ]] && ok "after-compact: a WORFY_EPIC no ticket has falls back to the Epics in play" \
    || bad "after-compact: unknown WORFY_EPIC: err=[$(cat "$T/aerr")] ctx=[${c:0:300}]"
git -C "$CP" checkout -q -b ep2/01 >/dev/null 2>&1
compact "$CP" compact
c="$(actx)"
[[ "$c" == *"# Wave brief: ep2"* ]] && ok "after-compact: without WORFY_EPIC, the Epic of the checkout's branch comes first" \
    || bad "after-compact: Epic from the branch: err=[$(cat "$T/aerr")] ctx=[${c:0:300}]"
compact "$CP" compact WORFY_EPIC=ep1
c="$(actx)"
[[ "$c" == *"# Wave brief: ep1"* && "$c" != *"Wave brief: ep2"* ]] && ok "after-compact: WORFY_EPIC comes before the Epic of the checkout's branch" \
    || bad "after-compact: WORFY_EPIC over the branch: err=[$(cat "$T/aerr")] ctx=[${c:0:300}]"
git -C "$CP" checkout -q main >/dev/null 2>&1

compact "$T/cmp/wt-02" compact WORFY_EPIC=ep2
c="$(actx)"
[ "$arc" -eq 0 ] && [[ "$c" == *"ep1/02"* && "$c" == *"# 02 — second of ep1"* && "$c" == *"EP1-TWO-DONE"* ]] \
    && [[ "$c" == *" M file.txt"* && "$c" == *"?? new.txt"* && "$c" != *"Wave brief"* ]] \
    && ok "after-compact: an implementer (worktree on its ticket's branch) gets its ticket file and git status --short" \
    || bad "after-compact: implementer: rc=$arc err=[$(cat "$T/aerr")] ctx=[${c:0:400}]"
# What is committed and what is not: the commits of the branch since worktree.base of the
# profile, each with its files, and the diff of the work not committed yet.
[[ "$c" == *"## Commits of ep1/02 since main"* && "$c" == *"ep1/02: STEP-ONE-COMMIT"* && "$c" == *"step.txt"* ]] \
    && [[ "$c" == *"## Not committed: git diff HEAD"* && "$c" == *"+changed"* && "$c" == *"-base"* ]] \
    && ok "after-compact: the implementer gets the commits of its branch with their files and the diff not committed yet" \
    || bad "after-compact: commits and diff: ctx=[${c:0:900}]"
# The text states where the work stands and names no command to run now: an agent told to answer from memory
# read "check each item … before the next step" as an order to open files (eval compaction-state, 2026-11-20).
# The re-check of the done items belongs before the report.
[[ "$c" != *"before the next step"* && "$c" == *"empty box"*"## Готово, когда"* && "$c" == *"Before your report, check each done item"* ]] \
    && ok "after-compact: the implementer text names no command to run now, says what an empty box means and asks for a re-check before the report" \
    || bad "after-compact: implementer header: [${c:0:600}]"
# How the ticket ends, from workflow.finish of the profile (pr-green-ci here).
[[ "${c%%## Commits*}" == *"ends with a pull request"*"workflow.finish pr-green-ci"* ]] \
    && ok "after-compact: the implementer text says how the ticket ends (workflow.finish)" \
    || bad "after-compact: finish: [${c:0:600}]"
claude_impl="$c"
# A long diff is cut to its own share of the limit, after the ticket: the ticket stays whole.
for i in $(seq 1 600); do echo "long diff line $i"; done >"$T/cmp/wt-02/file.txt"
compact "$T/cmp/wt-02" compact
c="$(actx)"
n="$(printf '%s' "$c" | node -e 'process.stdout.write(String([...require("fs").readFileSync(0, "utf8")].length))')"
[ "$n" -le 10000 ] && [[ "$c" == *"EP1-TWO-DONE"* && "$c" == *"+long diff line 1"* && "$c" != *"+long diff line 600"* && "$c" == *"… the diff is cut"* ]] \
    && [[ "${c%%## Not committed: git diff HEAD*}" == *"EP1-TWO-DONE"* ]] \
    && ok "after-compact: a long diff is cut after the ticket ($n characters)" \
    || bad "after-compact: long diff: $n characters, tail [$(printf '%s' "$c" | tail -n 3)]"
echo changed >"$T/cmp/wt-02/file.txt"
TRANSCRIPT="/codex-home/sessions/2026/11/18/rollout-2026-11-18T00-00-00-t1.jsonl" compact "$T/cmp/wt-02" compact WORFY_EPIC=ep2
c="$(actx)"
[ -n "$c" ] && [ "$c" = "$claude_impl" ] && ok "after-compact: Codex sessionStart (compact) gives the implementer the same context" \
    || bad "after-compact: Codex implementer differs: [${c:0:300}]"
TRANSCRIPT="/codex-home/sessions/2026/11/18/rollout-2026-11-18T00-00-00-t1.jsonl" compact "$CP" compact WORFY_EPIC=ep2
c="$(actx | sed 1d | grep -v '^# Wave brief: ')"
compact "$CP" compact WORFY_EPIC=ep2
[ -n "$c" ] && [ "$c" = "$(actx | sed 1d | grep -v '^# Wave brief: ')" ] \
    && ok "after-compact: Codex sessionStart (compact) gives the Orchestrator the same wave-brief (its time aside)" \
    || bad "after-compact: Codex Orchestrator differs"

# A long ticket and a branch of many files: the commits never push the done items out of the limit. The
# ticket's done section ends past character 7 700; one commit adds 45 files with long names, the next one a Cyrillic file.
git -C "$CP" worktree add -q -b ep1/01 "$T/cmp/wt-01" >/dev/null 2>&1
W1="$T/cmp/wt-01"
{
    printf '# 01 — first of ep1\n\nStatus: claimed 2026-01-01T00:00Z\n\n## Что делаем\n\n'
    for i in $(seq 1 90); do echo "Filler line $i of a long ticket, written the way real tickets explain the problem."; done
    printf '\n## Готово, когда\n\n- [ ] LONG-DONE-ONE\n- [ ] LONG-DONE-TWO\n- [ ] LONG-DONE-THREE\n- [ ] LONG-DONE-FOUR\n'
} >"$W1/.scratch/ep1/issues/01-first.md"
mkdir -p "$W1/src/some/rather/long/path/to/the/modules"
for i in $(seq 1 45); do echo "m$i" >"$W1/src/some/rather/long/path/to/the/modules/module-$i-with-a-long-name.ts"; done
(cd "$W1" && gq add -A && gq commit -q -m "ep1/01: MANY-FILES-COMMIT") >/dev/null 2>&1
# Two Cyrillic file names, built from UTF-8 octal escapes so that this file stays ASCII ("fajl" and "novyj").
RU_COMMITTED="$(printf '\321\204\320\260\320\271\320\273-ru.txt')"
RU_NEW="$(printf '\320\275\320\276\320\262\321\213\320\271.txt')"
echo ru >"$W1/$RU_COMMITTED"
(cd "$W1" && gq add -A && gq commit -q -m "ep1/01: CYRILLIC-COMMIT") >/dev/null 2>&1
echo new >"$W1/$RU_NEW"
compact "$W1" compact GIT_CONFIG_NOSYSTEM=1
c="$(actx)"
n="$(printf '%s' "$c" | node -e 'process.stdout.write(String([...require("fs").readFileSync(0, "utf8")].length))')"
[ "$arc" -eq 0 ] && [ "$n" -le 10000 ] && [[ "$c" == *"LONG-DONE-ONE"*"LONG-DONE-TWO"*"LONG-DONE-THREE"*"LONG-DONE-FOUR"* ]] \
    && [[ "$c" == *"ep1/01: MANY-FILES-COMMIT"* ]] \
    && ok "after-compact: a long ticket keeps all its done items next to a commit of many files ($n characters)" \
    || bad "after-compact: long ticket and many files: rc=$arc $n characters, err=[$(cat "$T/aerr")] tail [$(printf '%s' "$c" | tail -n 4)]"
# File names as they are, not as octal escapes (core.quotePath), in the commits and in git status; a short
# ticket now, so the commits fit. The user's git config asks for escapes, so the hook's own setting is what counts.
printf '[core]\n\tquotePath = true\n' >"$T/quoting.gitconfig"
printf '# 01 — first of ep1\n\nStatus: claimed 2026-01-01T00:00Z\n\n## Готово, когда\n\n- [ ] SHORT-DONE\n' >"$W1/.scratch/ep1/issues/01-first.md"
compact "$W1" compact GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$T/quoting.gitconfig"
c="$(actx)"
[[ "$c" == *"$RU_COMMITTED"* && "$c" == *"?? $RU_NEW"* && "$c" != *'\321'* ]] \
    && ok "after-compact: Cyrillic file names stay readable in the commits and in git status" \
    || bad "after-compact: quotePath: [$(printf '%s' "$c" | grep -n 'txt' | head -n 5)]"

# A ticket over the limit by itself, behind a git status of 50 lines and more, with a commit of 45 files: the
# ticket loses lines of its middle, never its done section — last in the ticket, or followed by other sections.
# git status: the 45 committed files changed, and 10 new files beside them.
for i in $(seq 1 45); do echo changed >>"$W1/src/some/rather/long/path/to/the/modules/module-$i-with-a-long-name.ts"; done
for i in $(seq 1 10); do echo u >"$W1/extra-untracked-file-$i.txt"; done
long_ticket() { # $1: what follows the done section
    printf '# 01 — first of ep1\n\nStatus: claimed 2026-01-01T00:00Z\n\n## Что делаем\n\n'
    for i in $(seq 1 140); do echo "Filler line $i of a very long ticket, written the way real tickets explain a problem."; done
    printf '\n## Готово, когда\n\n- [ ] HUGE-DONE-ONE\n- [ ] HUGE-DONE-TWO\n- [ ] HUGE-DONE-THREE\n- [ ] HUGE-DONE-FOUR\n%s' "$1"
}
for tail_kind in last followed; do
    if [ "$tail_kind" = last ]; then long_ticket "" >"$W1/.scratch/ep1/issues/01-first.md"
    else long_ticket "$(printf '\n## Result\n\n'; for i in $(seq 1 60); do echo "Result line $i of the ticket."; done)" >"$W1/.scratch/ep1/issues/01-first.md"; fi
    compact "$W1" compact
    c="$(actx)"
    n="$(printf '%s' "$c" | node -e 'process.stdout.write(String([...require("fs").readFileSync(0, "utf8")].length))')"
    [ "$arc" -eq 0 ] && [ "$n" -le 10000 ] && [[ "$c" == *"Filler line 1 "* && "$c" == *"HUGE-DONE-ONE"*"HUGE-DONE-TWO"*"HUGE-DONE-THREE"*"HUGE-DONE-FOUR"* ]] \
        && [[ "$c" == *" M src/some/rather/long/path/to/the/modules/module-"* && "$c" == *"… more lines: run git status --short"* ]] \
        && [[ "$c" != *"Filler line 140 "* && "$c" != *"Result line 60 "* ]] \
        && ok "after-compact: a ticket over the limit keeps its head and its whole done section ($tail_kind, $n characters)" \
        || bad "after-compact: huge ticket ($tail_kind): rc=$arc $n characters, err=[$(cat "$T/aerr")] tail [$(printf '%s' "$c" | tail -n 4)]"
done
(cd "$W1" && gq checkout -q -- src) >/dev/null 2>&1
rm -f "$W1"/extra-untracked-file-*.txt

# A git diff that fails says so, as git status does: here the blob of a committed file is gone from the
# object store, so git status still works (it hashes the file again) while git diff HEAD cannot read it.
git -C "$CP" worktree add -q "$T/cmp/wt-e2" ep2/01 >/dev/null 2>&1
W2="$T/cmp/wt-e2"
echo "BLOB-ONLY-HERE $RANDOM$RANDOM" >"$W2/gone.txt"
(cd "$W2" && gq add gone.txt && gq commit -q -m "ep2/01: GONE-COMMIT") >/dev/null 2>&1
blob="$(git -C "$W2" rev-parse HEAD:gone.txt)"
rm -f "$CP/.git/objects/${blob:0:2}/${blob:2}"
echo changed >"$W2/gone.txt"
compact "$W2" compact
c="$(actx)"
[ "$arc" -eq 0 ] && [[ "$c" == *" M gone.txt"* && "$c" == *"## Not committed: git diff HEAD"*"(git diff failed: exit "* ]] \
    && ok "after-compact: a git diff that fails is named in the text, not dropped" \
    || bad "after-compact: failed diff: rc=$arc err=[$(cat "$T/aerr")] tail [$(printf '%s' "$c" | tail -n 4)]"

compact "$T/cmp/review" compact
[ "$arc" -eq 0 ] && [ ! -s "$T/aout" ] && [ ! -s "$T/aerr" ] && ok "after-compact: a worktree with no ticket of its own (a reviewer's) — silent" \
    || bad "after-compact: reviewer worktree: rc=$arc out=[$(head -c 200 "$T/aout")] err=[$(cat "$T/aerr")]"
compact "$T/plain" compact WORFY_EPIC=ep1
[ "$arc" -eq 0 ] && [ ! -s "$T/aout" ] && [ ! -s "$T/aerr" ] && ok "after-compact: outside a registered project — silent" \
    || bad "after-compact: unregistered: rc=$arc out=[$(head -c 200 "$T/aout")] err=[$(cat "$T/aerr")]"
compact "$T/no-such-dir" compact WORFY_EPIC=ep1
[ "$arc" -eq 0 ] && [ ! -s "$T/aout" ] && [ "$(grep -c '' "$T/aerr")" -eq 1 ] && grep -q '^after-compact: cwd .* is not a directory$' "$T/aerr" \
    && ok "after-compact: a cwd that is no directory — nothing, one line on stderr, exit 0" \
    || bad "after-compact: bad cwd: rc=$arc out=[$(head -c 200 "$T/aout")] err=[$(cat "$T/aerr")]"
compact "$CP" compact WORFY_SESSION_KIND=product
[ "$arc" -eq 0 ] && [ ! -s "$T/aout" ] && ok "after-compact: a Product Session — silent" || bad "after-compact: Product Session: [$(head -c 200 "$T/aout")]"
loud=""
for src in startup resume clear; do
    compact "$CP" "$src" WORFY_EPIC=ep1
    [ "$arc" -eq 0 ] && [ ! -s "$T/aout" ] && [ ! -s "$T/aerr" ] || loud="$loud $src: rc=$arc [$(head -c 200 "$T/aout")] [$(head -c 200 "$T/aerr")]"
done
[ -z "$loud" ] && ok "after-compact: source startup, resume, clear — silent" || bad "after-compact: other sources printed:$loud"
# hooks.json: the hook runs only on the branch compact; every other SessionStart group keeps no matcher, so the
# start of a Session (source startup) gets what it got before.
got="$(node -e '
const groups = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).hooks.SessionStart
const mine = groups.filter((g) => g.hooks.some((h) => h.command.includes("/hooks/after-compact.mjs")))
const others = groups.filter((g) => !mine.includes(g))
console.log([mine.length, mine.map((g) => g.matcher).join(","), mine[0] && mine[0].hooks.length, others.filter((g) => g.matcher !== undefined).length].join(" "))' "$HOOKS/hooks.json")"
[ "$got" = "1 compact 1 0" ] && ok "hooks.json: after-compact.mjs on SessionStart with matcher compact; the other SessionStart groups unchanged" \
    || bad "hooks.json SessionStart groups: '$got'"

compact "$CP" compact WORFY_EPIC=ep1 CLAUDE_WAVE_BRIEF_BIN="$T/cmp/stubs/wave-brief.js"
c="$(actx)"
n="$(printf '%s' "$c" | node -e 'process.stdout.write(String([...require("fs").readFileSync(0, "utf8")].length))')"
[ "$n" -le 10000 ] && [ "$n" -ge 9000 ] && [[ "$c" == *"STAGE-OF-ep1"* && "$c" == *"WAITING-LINE"* && "$c" == *"OPEN-PR-LINE"* && "$c" == *"land line 0 "* && "$c" != *"land line 199 "* ]] \
    && [[ "${c%%WAITING-LINE*}" != *"land line"* && "${c%%OPEN-PR-LINE*}" != *"land line"* ]] && [[ "$(printf '%s' "$c" | tail -n 1)" == *"wave-brief ep1"* ]] \
    && ok "after-compact: a brief over the limit is cut to $n characters; the Stage line, Waiting and Open PRs come first" \
    || bad "after-compact: long brief: $n characters, ctx head [${c:0:300}] tail [$(printf '%s' "$c" | tail -n 2)]"
# Codex spills a context over about 10,000 bytes (2,500 tokens): with multi-byte text the cut there is by bytes too.
TRANSCRIPT="/codex-home/sessions/2026/11/18/rollout-2026-11-18T00-00-00-t1.jsonl" compact "$CP" compact WORFY_EPIC=ep1 CLAUDE_WAVE_BRIEF_BIN="$T/cmp/stubs/wave-brief.js" FAKE_FILL=é
b="$(actx | head -c 20000 | wc -c | tr -d ' ')"
[ "$b" -le 10001 ] && [ "$b" -ge 8000 ] && [[ "$(actx)" == *"OPEN-PR-LINE"* ]] && ok "after-compact: on Codex a multi-byte brief is cut within 10,000 bytes ($b)" \
    || bad "after-compact: Codex bytes: $b"

home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$home_before") <(printf '%s\n' "$home_after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
