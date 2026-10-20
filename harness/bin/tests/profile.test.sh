#!/usr/bin/env bash
# Tests of harness/bin/profile. Run: bash harness/bin/tests/profile.test.sh; exit code 0 — everything passed.
#
# Some checks run against the live registry (gate/config.json) and the projects registered there;
# most against a synthetic repository in a temporary directory with its own config, to
# check a worktree OUTSIDE the match prefix (identification via git common dir).
set -u
# The scripts under test are the copies next to this test (harness/); BIN_DIR and HOOKS_DIR
# point it at another copy. Live checks run only when the live gate registry exists, and only for
# the registered projects whose directories exist: $HARNESS_HOME/gate/config.json, or during the
# transition the legacy ~/.claude/gate/config.json, which profile reads when the new one is missing.
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
PROFILE="$BIN/profile"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
LIVE_GATE="${HARNESS_HOME:-$HOME/.claude/worfy-harness}/gate/config.json"
[ -f "$LIVE_GATE" ] || LIVE_GATE="$HOME/.claude/gate/config.json"
pass=0
fail=0
# The real ~/.claude (the Harness parts) and ~/.claude/worfy-harness: compared at the end (real-home.sh).
. "$(dirname "$0")/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME")"

check() { # $1 name, $2 expected exit code, $3 expected stdout substring (or ""), then the command
    local name="$1" want_rc="$2" want_out="$3"
    shift 3
    local got rc
    got="$("$@" 2>/tmp/profile-test-err.$$)"
    rc=$?
    if [ "$rc" -eq "$want_rc" ] && { [ -z "$want_out" ] || [[ "$got" == *"$want_out"* ]]; }; then
        pass=$((pass + 1))
        echo "ok   $name (exit $rc)"
    else
        fail=$((fail + 1))
        echo "FAIL $name: exit $rc (want $want_rc); stdout: ${got:0:200}; stderr: $(head -c 200 /tmp/profile-test-err.$$)"
    fi
}

# --- live registry ----------------------------------------------------------------
# Every project of the live registry whose directory exists: profile recognises its repositories,
# a worktree of one of them, the same directory spelled in lower case on a case-insensitive file
# system, and the common directory above the repositories of a project of several repositories.
# The expected values come from the registry itself, so the checks hold for anyone's projects.
if [ -f "$LIVE_GATE" ]; then
    lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
    # TSV: profile \t match, one line per entry with a profile and an existing directory
    live="$(node -e '
const fs = require("fs")
const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
for (const r of c.repos || []) if (r && r.profile && r.match && fs.existsSync(r.match)) console.log(r.profile + "\t" + r.match)
' "$LIVE_GATE" 2>/dev/null)"
    [ -n "$live" ] || echo "skip live registry checks: no registered project with an existing directory in $LIVE_GATE"
    while IFS=$'\t' read -r prof dir; do
        [ -n "$prof" ] || continue
        check "live $prof: --name" 0 "$prof" "$PROFILE" -C "$dir" --name
        check "live $prof: --field absent -> 4" 4 "" "$PROFILE" -C "$dir" --field no.such.field
        check "live $prof: --json is JSON" 0 "" bash -c "'$PROFILE' -C '$dir' --json | node -e 'JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"))'"
        wt="$(git -C "$dir" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}' | grep -v "^$dir\$" | while read -r d; do [ -d "$d" ] && echo "$d" && break; done)"
        if [ -n "$wt" ]; then
            check "live $prof: worktree --name" 0 "$prof" "$PROFILE" -C "$wt" --name
            check "live $prof: worktree in_worktree" 0 "true" "$PROFILE" -C "$wt" --field _resolved.in_worktree
        fi
        if [ "$(lc "$dir")" != "$dir" ] && [ -d "$(lc "$dir")" ]; then
            check "live $prof: case-insensitive FS: profile -C lowercased" 0 "$prof" "$PROFILE" -C "$(lc "$dir")" --name
        fi
    done <<<"$live"
    # The common parent of the repositories of one profile with two or more entries, when it is not
    # git itself and not $HOME: a workspace of that profile.
    while IFS=$'\t' read -r prof ws; do
        [ -n "$prof" ] && [ "$ws" != "$HOME" ] && ! git -C "$ws" rev-parse --git-dir >/dev/null 2>&1 || continue
        check "live $prof: workspace root -> $prof" 0 "$prof" "$PROFILE" -C "$ws" --name
        check "live $prof: workspace root _resolved.workspace" 0 "$ws" "$PROFILE" -C "$ws" --field _resolved.workspace
        check "live $prof: workspace briefing names workspace" 0 "workspace: $ws" "$PROFILE" -C "$ws"
    done < <(printf '%s\n' "$live" | node -e '
const path = require("path")
const by = {}
for (const l of require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean)) {
  const [p, d] = l.split("\t"); (by[p] = by[p] || []).push(d)
}
for (const [p, ds] of Object.entries(by)) {
  if (ds.length < 2) continue
  let c = ds[0].split("/")
  for (const d of ds.slice(1)) { const s = d.split("/"); let i = 0; while (i < c.length && c[i] === s[i]) i++; c = c.slice(0, i) }
  if (c.length > 1) console.log(p + "\t" + c.join("/"))
}')
else
    echo "skip live registry checks: $LIVE_GATE missing"
fi

# --- synthetic ----------------------------------------------------------------------
T="$(mktemp -d)"
# node's spelling of the path (C:/… in Git Bash on Windows, pwd -P elsewhere): it goes into the registries.
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
# A path as profile prints it: with backslashes on Windows (cygpath exists there), unchanged elsewhere.
printed() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
# The same inside a JSON string: each backslash doubled (a no-op where there are none).
json_printed() { printed "$1" | sed 's/\\/\\\\/g'; }
trap 'rm -rf "$T" /tmp/profile-test-err.$$' EXIT
mkdir -p "$T/repo/sub" "$T/profiles/demo" "$T/plain" "$T/repo2"
git -C "$T/repo" init -q -b main
git -C "$T/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$T/repo" worktree add -q --detach "$T/elsewhere-wt" 2>/dev/null
git -C "$T/repo2" init -q -b main
printf '{"schema":1,"name":"demo","language":"en","commands":{"test":"make test"},"parallel":"single","modules":{"heavy":{"pkg/a":2}},"tests":{"globs":["*_test.go"]}}\n' >"$T/profiles/demo/profile.json"
printf '# demo rules\n' >"$T/profiles/demo/rules.md"
cat >"$T/config.json" <<EOF
{"repos":[
 {"key":"demo","match":"$T/repo","profile":"demo"},
 {"key":"noprof","match":"$T/repo2"}
]}
EOF
export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
# The user's personalization file ($HARNESS_HOME/user.json) would override language.reports: these
# checks run with an empty Harness state folder, and the real one is restored after them.
HARNESS_HOME_WAS="${HARNESS_HOME-unset}"
export HARNESS_HOME="$T/hh-synthetic"
# --- letter case in the path: on a case-insensitive FS (APFS by default) ----------------------
# ~/work/acme in lower case is the same directory as ~/Work/Acme; the resolver and profile must
# recognise it, not answer "not registered". Windows has its own case rule (gate-unregistered.test.sh).
mkdir -p "$T/CaseRepo/apps" && git -C "$T/CaseRepo" init -q -b main
printf '{"repos":[{"key":"case","match":"%s","profile":"demo"}]}\n' "$T/CaseRepo" >"$T/case-config.json"
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
if ! command -v cygpath >/dev/null 2>&1 && [ -d "$(lc "$T/CaseRepo")" ]; then
    check "case-insensitive FS: resolver --which lowercased path" 0 "case"$'\t'"$T/CaseRepo" \
        env CLAUDE_GATE_CONFIG="$T/case-config.json" node "$HOOKS/gate-resolve.mjs" --which "$(lc "$T/CaseRepo")/apps"
    check "case-insensitive FS: profile -C lowercased path" 0 "demo" \
        env CLAUDE_GATE_CONFIG="$T/case-config.json" "$PROFILE" -C "$(lc "$T/CaseRepo")/apps" --name
else
    echo "skip case-insensitive checks: case-sensitive filesystem or Windows"
fi
check "synthetic root --field" 0 "make test" "$PROFILE" -C "$T/repo" --field commands.test
# The summary without a flag ends with the profile's rules.md under its own heading.
check "synthetic default briefing: rules.md section" 0 $'--- rules.md\n# demo rules' "$PROFILE" -C "$T/repo"
# the old form of language is a string: read as {reports, team} with one language
check "legacy string language -> language.team" 0 "en" "$PROFILE" -C "$T/repo" --field language.team
check "legacy string language -> language.reports" 0 "en" "$PROFILE" -C "$T/repo" --field language.reports
check "synthetic modules.heavy" 0 '"pkg/a": 2' "$PROFILE" -C "$T/repo" --field modules.heavy
check "synthetic tests.globs" 0 '"*_test.go"' "$PROFILE" -C "$T/repo" --field tests.globs
check "synthetic absent github.account -> 4" 4 "" "$PROFILE" -C "$T/repo" --field github.account
check "synthetic absent modules.deep -> 4" 4 "" "$PROFILE" -C "$T/repo" --field modules.deep
check "worktree outside match prefix" 0 "demo" "$PROFILE" -C "$T/elsewhere-wt" --name
check "worktree flagged" 0 "true" "$PROFILE" -C "$T/elsewhere-wt" --field _resolved.in_worktree
check "root not flagged" 0 "false" "$PROFILE" -C "$T/repo" --field _resolved.in_worktree
check "unregistered dir -> 3" 3 "" "$PROFILE" -C "$T/plain"
# -C <dir> resolves as if profile were run from <dir>, regardless of cwd
check "-C from unregistered cwd" 0 "demo" bash -c "cd '$T/plain' && '$PROFILE' -C '$T/repo' --name"
check "-C relative to cwd" 0 "demo" bash -c "cd '$T' && '$PROFILE' -C repo/sub --name"
check "-C overrides registered cwd -> 3" 3 "" bash -c "cd '$T/repo' && '$PROFILE' -C '$T/plain' --name"
check "-C subdir == cd subdir (--json)" 0 "" bash -c "a=\$(cd '$T/repo/sub' && '$PROFILE' --json) && b=\$(cd / && '$PROFILE' -C '$T/repo/sub' --json) && [ \"\$a\" = \"\$b\" ]"
check "-C worktree from other cwd" 0 "true" bash -c "cd '$T/plain' && '$PROFILE' -C '$T/elsewhere-wt' --field _resolved.in_worktree"
check "-C after mode flag" 0 "make test" "$PROFILE" --field commands.test -C "$T/repo"
check "-C empty -> 2" 2 "" "$PROFILE" -C ""
check "-C without value -> 2" 2 "" "$PROFILE" -C
check "-C file, not dir -> 2" 2 "" "$PROFILE" -C "$T/config.json"
check "registered without profile -> 3" 3 "" "$PROFILE" -C "$T/repo2"
check "no such dir -> 2" 2 "" "$PROFILE" -C "$T/nope"
check "unknown flag -> 2" 2 "" "$PROFILE" --bogus
check "two modes -> 2" 2 "" "$PROFILE" --json --dir
check "--field without path -> 2" 2 "" "$PROFILE" --field
rm "$T/profiles/demo/profile.json"
check "profile dir missing file -> 3" 3 "" "$PROFILE" -C "$T/repo"
echo '{broken' >"$T/profiles/demo/profile.json"
check "broken profile.json -> 1" 1 "" "$PROFILE" -C "$T/repo"
# A registry the resolver cannot read: exit 1, and stderr keeps the resolver's own line, which names it.
check "unreadable registry -> 1, stderr names the registry" 0 "" bash -c \
    'err=$(CLAUDE_GATE_CONFIG="$0" "$1" -C "$2" 2>&1 >/dev/null); rc=$?; [ "$rc" -eq 1 ] && [[ "$err" == *"project not determined: gate-resolve: registry $0 cannot be read"* ]]' \
    "$T/no-registry.json" "$PROFILE" "$T/repo"
# A registry the resolver crashes on: stderr keeps its Error line, not the "Node.js vNN" line node prints last.
echo '{"repos":[null]}' >"$T/null-entry.json"
check "resolver crash -> 1, stderr ends with its Error line" 0 "" bash -c \
    'err=$(CLAUDE_GATE_CONFIG="$0" "$1" -C "$2" 2>&1 >/dev/null); rc=$?; [ "$rc" -eq 1 ] && [[ "$err" == *"project not determined: TypeError: Cannot read properties of null"* ]] && [[ "$err" != *"Node.js v"* ]]' \
    "$T/null-entry.json" "$PROFILE" "$T/repo"
# Stand-in resolvers: an Error with properties (node prints them after the Error line), and two
# lines of its own followed by a stack line and a version line: the last of its own lines is kept.
# The registry itself is fine.
printf '%s\n' "throw Object.assign(new Error('resolver exploded'), { code: 'ERR_STAND_IN' })" >"$T/resolver-props.mjs"
printf '%s\n' "process.stderr.write('gate-resolve: reading the registry\\ngate-resolve: the registry names no repos\\n    at read (/r.mjs:1:1)\\n\\nNode.js v24.19.0\\n'); process.exit(1)" >"$T/resolver-note.mjs"
check "resolver crash with error properties -> its Error line, not the closing brace" 0 "" bash -c \
    'err=$(CLAUDE_GATE_RESOLVE="$0" "$1" -C "$2" 2>&1 >/dev/null); rc=$?; [ "$rc" -eq 1 ] && [[ "$err" == *"project not determined: Error: resolver exploded" ]]' \
    "$T/resolver-props.mjs" "$PROFILE" "$T/repo"
check "resolver message, stack and version lines -> the message" 0 "" bash -c \
    'err=$(CLAUDE_GATE_RESOLVE="$0" "$1" -C "$2" 2>&1 >/dev/null); rc=$?; [ "$rc" -eq 1 ] && [[ "$err" == *"project not determined: gate-resolve: the registry names no repos" ]]' \
    "$T/resolver-note.mjs" "$PROFILE" "$T/repo"

# common directory (workspace): the parent of all repositories of one profile, not a repo itself
mkdir -p "$T/ws/a" "$T/ws/b" "$T/ws/notes" "$T/ws/c" "$T/profiles/multi" "$T/profiles/multi2" "$T/mixed/x" "$T/mixed/y" "$T/mixed/z"
for d in ws/a ws/b ws/c mixed/x mixed/y mixed/z; do git -C "$T/$d" init -q -b main; done
printf '{"schema":1,"name":"multi","commands":{"test":"yarn test"}}\n' >"$T/profiles/multi/profile.json"
printf '{"schema":1,"name":"multi2"}\n' >"$T/profiles/multi2/profile.json"
printf '{"schema":1,"name":"demo"}\n' >"$T/profiles/demo/profile.json"
printf '{"repos":[{"key":"a","match":"%s","profile":"multi"},{"key":"b","match":"%s","profile":"multi"},{"key":"x","match":"%s","profile":"multi2"},{"key":"y","match":"%s","profile":"multi2"},{"key":"z","match":"%s","profile":"demo"}]}\n' \
    "$T/ws/a" "$T/ws/b" "$T/mixed/x" "$T/mixed/y" "$T/mixed/z" >"$T/ws.json"
export CLAUDE_GATE_CONFIG="$T/ws.json"
check "workspace root -> profile" 0 "multi" "$PROFILE" -C "$T/ws" --name
check "workspace non-git subdir -> profile" 0 "multi" "$PROFILE" -C "$T/ws/notes" --name
# another git repository in the common directory that is not in the registry is not the profile's project (exit 3);
# only directories outside git get the common directory's profile
check "workspace: unregistered git repo inside -> 3" 3 "" "$PROFILE" -C "$T/ws/c" --name
mkdir -p "$T/ws/c/deep"
check "workspace: subdir of unregistered git repo -> 3" 3 "" "$PROFILE" -C "$T/ws/c/deep" --name
check "workspace: gate_key null" 0 "null" "$PROFILE" -C "$T/ws" --field _resolved.gate_key
check "workspace: in_worktree false at workspace root" 0 "false" "$PROFILE" -C "$T/ws" --field _resolved.in_worktree
check "registered repo inside workspace: own key" 0 "a" "$PROFILE" -C "$T/ws/a" --field _resolved.gate_key
check "parent holding another profile's repo -> 3" 3 "" "$PROFILE" -C "$T/mixed"
check "parent of the workspace -> 3" 3 "" "$PROFILE" -C "$T"
# the common directory itself became a git repository (git init in it): it and its directories outside nested
# repositories are still a workspace; an unregistered nested repository — exit 3
git -C "$T/ws" init -q -b main
check "workspace root that is itself git -> profile" 0 "multi" "$PROFILE" -C "$T/ws/notes" --name
check "workspace root that is git: nested foreign repo -> 3" 3 "" "$PROFILE" -C "$T/ws/c" --name
rm -rf "$T/ws/.git"
# a match with a trailing slash covers its own folder, as one without does (before, it matched nothing)
printf '{"repos":[{"key":"a","match":"%s/","profile":"multi"},{"key":"b","match":"%s","profile":"multi"}]}\n' "$T/ws/a" "$T/ws/b" >"$T/ws-slash.json"
check "match with trailing slash covers its own folder -> profile" 0 "multi" env CLAUDE_GATE_CONFIG="$T/ws-slash.json" "$PROFILE" -C "$T/ws/a" --name
# The home folder is never a workspace: with two repositories of one profile right under HOME, a
# directory in HOME is not that project. USERPROFILE with HOME, which node reads on Windows.
mkdir -p "$T/hw/a" "$T/hw/b" "$T/hw/notes" "$T/hw-other"
for d in a b; do git -C "$T/hw/$d" init -q -b main; done
printf '{"repos":[{"key":"a","match":"%s","profile":"multi"},{"key":"b","match":"%s","profile":"multi"}]}\n' "$T/hw/a" "$T/hw/b" >"$T/hw.json"
check "common parent of a profile's repos, not HOME -> workspace" 0 "multi" \
    env CLAUDE_GATE_CONFIG="$T/hw.json" HOME="$T/hw-other" USERPROFILE="$T/hw-other" "$PROFILE" -C "$T/hw/notes" --name
check "common parent of a profile's repos is HOME -> 3, not a workspace" 3 "" \
    env CLAUDE_GATE_CONFIG="$T/hw.json" HOME="$T/hw" USERPROFILE="$T/hw" "$PROFILE" -C "$T/hw/notes" --name
unset CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR
if [ "$HARNESS_HOME_WAS" = unset ]; then unset HARNESS_HOME; else export HARNESS_HOME="$HARNESS_HOME_WAS"; fi

# --- schema 2 and the profile's place on the machine ---------------------------------
# Temporary HOME and HARNESS_HOME, the registry in $HARNESS_HOME/gate/config.json, no
# CLAUDE_GATE_CONFIG / CLAUDE_PROFILES_DIR: the lookup goes the way it goes on a machine.
# A profile lives in $HARNESS_HOME/projects/<name>/; a schema 1 one in ~/.claude/profiles/<name>/
# is read during the transition; with both, $HARNESS_HOME wins.
H="$T/home" HH="$T/hh"
BINREAL="$(cd "$BIN" && pwd -P)"
BINOUT="$(printed "$BINREAL")" # the bin folder as profile prints it
mkdir -p "$H/.claude/profiles" "$HH/projects" "$HH/gate" "$T/r"
for n in demo legacy both nomode badmode bare schema3 nofile absbin notobj; do git -C "$T/r" init -q -b main "$n"; done
{
    printf '{"repos":['
    sep=""
    for n in demo legacy both nomode badmode bare schema3 nofile absbin notobj; do printf '%s{"key":"%s","match":"%s","profile":"%s"}' "$sep" "$n" "$T/r/$n" "$n"; sep=","; done
    printf ']}\n'
} >"$HH/gate/config.json"
newp() { mkdir -p "$HH/projects/$1" && printf '%s\n' "$2" >"$HH/projects/$1/profile.json"; }
oldp() { mkdir -p "$H/.claude/profiles/$1" && printf '%s\n' "$2" >"$H/.claude/profiles/$1/profile.json"; }
# demo still names stale Harness paths: schema 2 does not take them from the file.
newp demo '{"schema":2,"name":"demo","mode":"silent","attribution":"off","language":{"reports":"ru","team":"en","docs":"ru"},"mcp":{"allowed":["qmd","worfy-canvas","github"]},"tickets":{"status_tool":"/elsewhere/ticket","epic_status":"/elsewhere/epic-status"},"workflow":{"preflight":null},"numbering":{"reserve_with":"/elsewhere/preflight"}}'
printf '# demo v2 rules\n' >"$HH/projects/demo/rules.md"
oldp legacy '{"schema":1,"name":"legacy","language":"ru","tickets":{"status_tool":"~/.claude/bin/ticket","epic_status":"~/.claude/bin/epic-status"},"workflow":{"preflight":"~/.claude/bin/preflight --epic <эпик>"},"numbering":{"reserve_with":null}}' # schema 1
newp both '{"schema":2,"name":"both","title":"from harness home","mode":"full"}'
oldp both '{"schema":1,"name":"both","title":"from legacy dir"}'
newp nomode '{"schema":2,"name":"nomode"}'
newp badmode '{"schema":2,"name":"badmode","mode":"other"}'
newp bare '{"schema":2,"name":"bare","mode":"full","language":{"reports":"en","team":"en"}}'
newp schema3 '{"schema":3,"name":"schema3","mode":"full"}'
# schema 1 with the absolute form of the old place: <HOME>/.claude/bin/<script>, spelled the way this
# OS spells it (C:\…\.claude\bin\ on Windows, escaped for JSON)
ABS_BIN="$(json_printed "$H/.claude/bin/")"
oldp absbin "{\"schema\":1,\"name\":\"absbin\",\"tickets\":{\"status_tool\":\"${ABS_BIN}ticket\"},\"workflow\":{\"preflight\":\"${ABS_BIN}preflight --epic <эпик>\"}}"
# valid JSON, but not an object
newp notobj '["schema",2]'
# Silent mode: a Workflow folder given with ~/, a relative one (broken), and a
# project of two repositories without workflow.folder (the folder above them).
mkdir -p "$T/r/multi"
for n in home relwf; do git -C "$T/r" init -q -b main "$n"; done
for n in m1 m2; do git -C "$T/r/multi" init -q -b main "$n"; done
jq --arg r "$T/r" '.repos += [{key: "home", match: ($r + "/home"), profile: "home"}, {key: "relwf", match: ($r + "/relwf"), profile: "relwf"},
    {key: "m1", match: ($r + "/multi/m1"), profile: "ms"}, {key: "m2", match: ($r + "/multi/m2"), profile: "ms"}]' "$HH/gate/config.json" >"$T/cfg.json" \
    && mv "$T/cfg.json" "$HH/gate/config.json"
newp home '{"schema":2,"name":"home","mode":"silent","workflow":{"folder":"~/wf"},"tickets":{"root":".scratch/"}}'
newp relwf '{"schema":2,"name":"relwf","mode":"silent","workflow":{"folder":"wf"}}'
newp ms '{"schema":2,"name":"ms","mode":"silent","workflow":{"folder":null}}'
# The default of `attribution` follows the mode: profiles that spell the value against that default.
for n in silenton fulloff; do git -C "$T/r" init -q -b main "$n"; done
jq --arg r "$T/r" '.repos += [{key: "silenton", match: ($r + "/silenton"), profile: "silenton"}, {key: "fulloff", match: ($r + "/fulloff"), profile: "fulloff"}]' \
    "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
newp silenton '{"schema":2,"name":"silenton","mode":"silent","attribution":"on"}'
newp fulloff '{"schema":2,"name":"fulloff","mode":"full","attribution":"off"}'
# `attribution` with a value that is neither "on" nor "off", one profile per value and mode: null reads as
# "not set", anything else is a broken profile. And schema 1 profiles: one that names a mode (schema 1 has
# none: it is read as Full), one with a broken value.
ATTR_BAD=(empty:'""' upper:'"OFF"' zero:0 false:false word:'"yes"')
attr_names=(silentnull fullnull legacysilent legacybad)
for v in "${ATTR_BAD[@]}"; do attr_names+=("silent${v%%:*}" "full${v%%:*}"); done
for n in "${attr_names[@]}"; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
newp silentnull '{"schema":2,"name":"silentnull","mode":"silent","attribution":null}'
newp fullnull '{"schema":2,"name":"fullnull","mode":"full","attribution":null}'
for v in "${ATTR_BAD[@]}"; do
    newp "silent${v%%:*}" "{\"schema\":2,\"name\":\"silent${v%%:*}\",\"mode\":\"silent\",\"attribution\":${v#*:}}"
    newp "full${v%%:*}" "{\"schema\":2,\"name\":\"full${v%%:*}\",\"mode\":\"full\",\"attribution\":${v#*:}}"
done
oldp legacysilent '{"schema":1,"name":"legacysilent","mode":"silent"}'
oldp legacybad '{"schema":1,"name":"legacybad","attribution":"OFF"}'
# The gate before a merge: workflow.merge_gate and workflow.e2e_lock, valid and broken values.
GATE_PROFILES=(mgwave mgeach mgnull mgbad mgnum lockrel lockhome locknum lockempty cipr cibatch cinull cibad cinorun cirunnum cirunempty)
for n in "${GATE_PROFILES[@]}"; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
newp mgwave '{"schema":2,"name":"mgwave","mode":"full","workflow":{"merge_gate":"wave","e2e_lock":"/tmp/worfy-e2e.lock"}}'
newp mgeach '{"schema":2,"name":"mgeach","mode":"full","workflow":{"merge_gate":"each","e2e_lock":null}}'
newp mgnull '{"schema":2,"name":"mgnull","mode":"full","workflow":{"merge_gate":null}}'
newp mgbad '{"schema":2,"name":"mgbad","mode":"full","workflow":{"merge_gate":"always"}}'
newp mgnum '{"schema":2,"name":"mgnum","mode":"full","workflow":{"merge_gate":1}}'
newp lockrel '{"schema":2,"name":"lockrel","mode":"full","workflow":{"e2e_lock":"tmp/e2e.lock"}}'
newp lockhome '{"schema":2,"name":"lockhome","mode":"full","workflow":{"e2e_lock":"~/e2e.lock"}}'
newp locknum '{"schema":2,"name":"locknum","mode":"full","workflow":{"e2e_lock":5}}'
newp lockempty '{"schema":2,"name":"lockempty","mode":"full","workflow":{"e2e_lock":""}}'
# Where GitHub CI runs: workflow.ci and workflow.ci_batch_run.
newp cipr '{"schema":2,"name":"cipr","mode":"full","workflow":{"ci":"pr"}}'
newp cibatch '{"schema":2,"name":"cibatch","mode":"full","workflow":{"ci":"batch","ci_batch_run":"gh workflow run ci.yml --ref $ref -f job=check"}}'
newp cinull '{"schema":2,"name":"cinull","mode":"full","workflow":{"ci":null}}'
newp cibad '{"schema":2,"name":"cibad","mode":"full","workflow":{"ci":"nightly"}}'
newp cinorun '{"schema":2,"name":"cinorun","mode":"full","workflow":{"ci":"batch"}}'
newp cirunnum '{"schema":2,"name":"cirunnum","mode":"full","workflow":{"ci":"pr","ci_batch_run":5}}'
newp cirunempty '{"schema":2,"name":"cirunempty","mode":"full","workflow":{"ci":"batch","ci_batch_run":"  "}}'
# The cross-machine gate: cross_machine_gate, valid and broken values.
CMG_PROFILES=(cmreq cmserve cmnull cmrole cmnolabel cmnosection cmservenocheck cmexemptbs cmexemptstr cmobj)
for n in "${CMG_PROFILES[@]}"; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
cmg() { newp "$1" "{\"schema\":2,\"name\":\"$1\",\"mode\":\"full\",\"cross_machine_gate\":$2}"; }
cmg cmreq '{"label": "needs-mac-gate", "role": "request", "exempt": [".scratch/", "docs/"], "checks_section": "Mac checks"}'
cmg cmserve '{"label": "needs-mac-gate", "role": "serve", "check": "GATE_SCOPE=all gate full", "checks_section": "Mac checks"}'
cmg cmnull null
cmg cmrole '{"label": "needs-mac-gate", "role": "merge", "checks_section": "Mac checks"}'
cmg cmnolabel '{"role": "request", "checks_section": "Mac checks"}'
cmg cmnosection '{"label": "needs-mac-gate", "role": "request"}'
cmg cmservenocheck '{"label": "needs-mac-gate", "role": "serve", "checks_section": "Mac checks"}'
cmg cmexemptbs '{"label": "needs-mac-gate", "role": "request", "exempt": ["docs\\\\adr\\\\"], "checks_section": "Mac checks"}'
cmg cmexemptstr '{"label": "needs-mac-gate", "role": "request", "exempt": "docs/", "checks_section": "Mac checks"}'
cmg cmobj '["needs-mac-gate"]'
# The Pipeline of the project: workflow.pipeline from the catalogue of Stage kinds. A valid one,
# null (the default), and one profile per rule it breaks: "<name>|<pipeline JSON>|<substring of the reason>".
PL_GOOD='[{"kind":"queued"},{"kind":"implementing","stuck_after":"12h"},{"kind":"ci","stuck_after":"45m"},{"kind":"agent-review","label":"Review"},{"kind":"check","name":"windows","label":"Windows"},{"kind":"check","name":"a11y"},{"kind":"gate-merge"},{"kind":"deploy","environment":"stable"},{"kind":"closing"},{"kind":"done"}]'
PL_BAD=(
    'plobj|{"kind":"queued"}|workflow.pipeline is a list'
    'plempty|[]|workflow.pipeline is a list of Stage kinds, got an empty list'
    'plitem|[{"kind":"queued"},"ci",{"kind":"done"}]|workflow.pipeline[1] is an object'
    'plkind|[{"kind":"queued"},{"kind":"review"},{"kind":"done"}]|workflow.pipeline[1].kind "review" is not a Stage kind'
    'plnokind|[{"kind":"queued"},{"label":"x"},{"kind":"done"}]|workflow.pipeline[1].kind'
    'plkey|[{"kind":"queued"},{"kind":"ci","when":"always"},{"kind":"done"}]|workflow.pipeline[1] has an unknown field "when"'
    'plfirst|[{"kind":"implementing"},{"kind":"queued"},{"kind":"done"}]|the first Stage is queued'
    'pllast|[{"kind":"queued"},{"kind":"done"},{"kind":"closing"}]|the last Stage is done'
    'pldup|[{"kind":"queued"},{"kind":"ci"},{"kind":"ci"},{"kind":"done"}]|"ci" more than once'
    'plcheckdup|[{"kind":"queued"},{"kind":"check","name":"windows"},{"kind":"check","name":"windows"},{"kind":"done"}]|check "windows" more than once'
    'plchecknoname|[{"kind":"queued"},{"kind":"check"},{"kind":"done"}]|workflow.pipeline[1]: check needs a name'
    'plcheckbadname|[{"kind":"queued"},{"kind":"check","name":"Win dows"},{"kind":"done"}]|workflow.pipeline[1].name'
    'plname|[{"kind":"queued"},{"kind":"ci","name":"x"},{"kind":"done"}]|workflow.pipeline[1]: name is only for check'
    'plenv|[{"kind":"queued"},{"kind":"ci","environment":"prod"},{"kind":"done"}]|workflow.pipeline[1]: environment is only for deploy'
    'plboth|[{"kind":"queued"},{"kind":"gate-merge"},{"kind":"awaiting-merge"},{"kind":"done"}]|gate-merge and awaiting-merge'
    'plstuck|[{"kind":"queued"},{"kind":"ci","stuck_after":"2 days"},{"kind":"done"}]|workflow.pipeline[1].stuck_after is "<number>h" or "<number>m"'
    'plstucknum|[{"kind":"queued"},{"kind":"ci","stuck_after":2},{"kind":"done"}]|workflow.pipeline[1].stuck_after'
    'plstuckzero|[{"kind":"queued"},{"kind":"ci","stuck_after":"0h"},{"kind":"done"}]|workflow.pipeline[1].stuck_after'
    'pllabel|[{"kind":"queued"},{"kind":"ci","label":""},{"kind":"done"}]|workflow.pipeline[1].label'
)
for n in plgood plnull; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
newp plgood "{\"schema\":2,\"name\":\"plgood\",\"mode\":\"full\",\"workflow\":{\"pipeline\":$PL_GOOD}}"
newp plnull '{"schema":2,"name":"plnull","mode":"full","workflow":{"pipeline":null}}'
for spec in "${PL_BAD[@]}"; do
    n="${spec%%|*}"; rest="${spec#*|}"; pl="${rest%|*}"
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
    newp "$n" "{\"schema\":2,\"name\":\"$n\",\"mode\":\"full\",\"workflow\":{\"pipeline\":$pl}}"
done
# The names of the document sections code parses: tickets.done_section, tickets.manual_mark and
# docs.adr_status_label (tickets.trail_section stays as written: null there means "no such section").
# Values of a project whose documents are not in English, nulls (the defaults), null groups, and one
# malformed value per field.
HD_PROFILES=(hdset hdnull hdgroupsnull hddonenum hddoneempty hdmanuallist hdstatusnum)
for n in "${HD_PROFILES[@]}"; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
hd() { newp "$1" "{\"schema\":2,\"name\":\"$1\",\"mode\":\"full\",$2}"; }
hd hdset '"tickets":{"trail_section":"## Fichiers","done_section":"## Fini quand","manual_mark":"à la main"},"docs":{"adr_dir":"docs/adr","adr_status_label":"Statut"}'
hd hdnull '"tickets":{"trail_section":null,"done_section":null,"manual_mark":null},"docs":{"adr_status_label":null}'
hd hdgroupsnull '"tickets":null,"docs":null'
hd hddonenum '"tickets":{"done_section":5}'
hd hddoneempty '"tickets":{"done_section":"  "}'
hd hdmanuallist '"tickets":{"manual_mark":["manual"]}'
hd hdstatusnum '"docs":{"adr_status_label":1}'
cat >"$T/p2" <<EOF
#!/usr/bin/env bash
exec env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR HOME="$H" USERPROFILE="$H" HARNESS_HOME="$HH" "$PROFILE" "\$@"
EOF
chmod +x "$T/p2"
P2="$T/p2"
# The same as a node script: ticket starts it with its own node (process.execPath), so it runs on Windows
# too, where node cannot start a shell script. Paths in node's spelling, escaped for a JS string.
cat >"$T/p2node" <<EOF
#!/usr/bin/env node
const env = { ...process.env, HOME: "$(json_printed "$H")", USERPROFILE: "$(json_printed "$H")", HARNESS_HOME: "$(json_printed "$HH")" }
delete env.CLAUDE_GATE_CONFIG
delete env.CLAUDE_PROFILES_DIR
const r = require("child_process").spawnSync(process.execPath, ["$(json_printed "$PROFILE")", ...process.argv.slice(2)], { env, stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
chmod +x "$T/p2node"
P2NODE="$T/p2node"
snapshot() { find "$H" "$HH" | LC_ALL=C sort && find "$H" "$HH" -type f -exec cksum {} + | LC_ALL=C sort; }
before="$(snapshot)"
eq() { # $1 name, $2 expected stdout exactly, then the command (exit code must be 0)
    local name="$1" want="$2"
    shift 2
    check "$name" 0 "" bash -c 'got="$("$@")" && [ "$got" = "$0" ]' "$want" "$@"
}
fails_with() { # $1 name, $2 exit code, $3 substring of stderr, then the command
    local name="$1" rc="$2" sub="$3"
    shift 3
    check "$name" 0 "" bash -c 'e="$("${@:2}" 2>&1 >/dev/null)"; r=$?; [ "$r" -eq "$0" ] && [[ "$e" == *"$1"* ]]' "$rc" "$sub" "$@"
}
eq "schema 2: in HARNESS_HOME/projects: --name" demo "$P2" -C "$T/r/demo" --name
eq "schema 2: in HARNESS_HOME/projects: --dir" "$(printed "$HH/projects/demo")" "$P2" -C "$T/r/demo" --dir
eq "schema 2: in HARNESS_HOME/projects: _resolved.dir" "$(printed "$HH/projects/demo")" "$P2" -C "$T/r/demo" --field _resolved.dir
eq "schema 2: --field mode from the file" silent "$P2" -C "$T/r/demo" --field mode
eq "schema 2: --rules from HARNESS_HOME" "# demo v2 rules" "$P2" -C "$T/r/demo" --rules
eq "schema 1: only in ~/.claude/profiles: --name" legacy "$P2" -C "$T/r/legacy" --name
eq "schema 1: only in ~/.claude/profiles: --dir" "$(printed "$H/.claude/profiles/legacy")" "$P2" -C "$T/r/legacy" --dir
eq "in both places: HARNESS_HOME wins (--dir)" "$(printed "$HH/projects/both")" "$P2" -C "$T/r/both" --dir
eq "in both places: HARNESS_HOME wins (field)" "from harness home" "$P2" -C "$T/r/both" --field title
fails_with "schema 2: without mode -> 1 with the reason" 1 '"mode"' "$P2" -C "$T/r/nomode" --name
fails_with "schema 2: with mode other -> 1 with the reason" 1 '"other"' "$P2" -C "$T/r/badmode" --field schema
fails_with "unknown schema 3 -> 1 with the reason" 1 'schema' "$P2" -C "$T/r/schema3" --name
fails_with "profile in neither place -> 3 naming both" 3 "$(printed "$HH/projects/nofile/profile.json")" "$P2" -C "$T/r/nofile" --name
eq "schema 1: --field mode -> full" full "$P2" -C "$T/r/legacy" --field mode
# `attribution` absent: the default follows the mode — `off` in Silent mode, `on` in Full mode (schema 1 is
# always Full). A value written in the file wins in both modes. --json carries the same resolved value.
attr_json=(bash -c 'set -o pipefail; "$@" --json | jq -r .attribution' _ "$P2" -C)
eq "--field attribution absent, Full mode -> on (schema 2)" on "$P2" -C "$T/r/bare" --field attribution
eq "--field attribution absent -> on (schema 1)" on "$P2" -C "$T/r/legacy" --field attribution
eq "--field attribution absent, Silent mode -> off" off "$P2" -C "$T/r/home" --field attribution
eq "--field attribution from the file" off "$P2" -C "$T/r/demo" --field attribution
eq "--field attribution: an explicit on in Silent mode wins" on "$P2" -C "$T/r/silenton" --field attribution
eq "--field attribution: an explicit off in Full mode wins" off "$P2" -C "$T/r/fulloff" --field attribution
eq "--json attribution absent, Full mode -> on" on "${attr_json[@]}" "$T/r/bare"
eq "--json attribution absent (schema 1) -> on" on "${attr_json[@]}" "$T/r/legacy"
# --- workflow.merge_gate and workflow.e2e_lock ---------------------------------
eq "--field workflow.merge_gate wave" wave "$P2" -C "$T/r/mgwave" --field workflow.merge_gate
eq "--field workflow.merge_gate each" each "$P2" -C "$T/r/mgeach" --field workflow.merge_gate
eq "--field workflow.merge_gate null" null "$P2" -C "$T/r/mgnull" --field workflow.merge_gate
check "--field workflow.merge_gate absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field workflow.merge_gate
fails_with "workflow.merge_gate \"always\" -> 1 with the reason" 1 'workflow.merge_gate is "each", "wave" or null, got "always"' "$P2" -C "$T/r/mgbad" --name
fails_with "workflow.merge_gate 1 -> 1 with the reason" 1 "workflow.merge_gate" "$P2" -C "$T/r/mgnum" --field workflow
eq "--field workflow.e2e_lock path" /tmp/worfy-e2e.lock "$P2" -C "$T/r/mgwave" --field workflow.e2e_lock
eq "--field workflow.e2e_lock null" null "$P2" -C "$T/r/mgeach" --field workflow.e2e_lock
check "--field workflow.e2e_lock absent -> 4" 4 "" "$P2" -C "$T/r/mgnull" --field workflow.e2e_lock
eq "--field workflow.e2e_lock with ~/ is expanded" "$(printed "$H/e2e.lock")" "$P2" -C "$T/r/lockhome" --field workflow.e2e_lock
fails_with "workflow.e2e_lock relative -> 1 with the reason" 1 "workflow.e2e_lock is an absolute path or null" "$P2" -C "$T/r/lockrel" --name
fails_with "workflow.e2e_lock 5 -> 1 with the reason" 1 "workflow.e2e_lock" "$P2" -C "$T/r/locknum" --name
fails_with "workflow.e2e_lock empty -> 1 with the reason" 1 "workflow.e2e_lock" "$P2" -C "$T/r/lockempty" --name
eq "--json carries workflow.merge_gate" wave bash -c 'set -o pipefail; "$@" --json | jq -r .workflow.merge_gate' _ "$P2" -C "$T/r/mgwave"
# --- workflow.ci and workflow.ci_batch_run --------------------------------------------------------
eq "--field workflow.ci absent -> pr" pr "$P2" -C "$T/r/mgwave" --field workflow.ci
eq "--field workflow.ci null -> pr" pr "$P2" -C "$T/r/cinull" --field workflow.ci
eq "--field workflow.ci pr" pr "$P2" -C "$T/r/cipr" --field workflow.ci
eq "--field workflow.ci batch" batch "$P2" -C "$T/r/cibatch" --field workflow.ci
eq "--field workflow.ci_batch_run as written" 'gh workflow run ci.yml --ref $ref -f job=check' "$P2" -C "$T/r/cibatch" --field workflow.ci_batch_run
eq "--json carries the resolved workflow.ci" pr bash -c 'set -o pipefail; "$@" --json | jq -r .workflow.ci' _ "$P2" -C "$T/r/mgwave"
check "--field workflow.ci_batch_run absent -> 4" 4 "" "$P2" -C "$T/r/cipr" --field workflow.ci_batch_run
fails_with "workflow.ci \"nightly\" -> 1 with the reason" 1 'workflow.ci is "pr", "batch" or null, got "nightly"' "$P2" -C "$T/r/cibad" --name
fails_with "workflow.ci batch without ci_batch_run -> 1 with the reason" 1 'workflow.ci "batch" needs workflow.ci_batch_run' "$P2" -C "$T/r/cinorun" --name
fails_with "workflow.ci batch with a blank ci_batch_run -> 1" 1 'workflow.ci "batch" needs workflow.ci_batch_run' "$P2" -C "$T/r/cirunempty" --name
fails_with "workflow.ci_batch_run 5 -> 1 with the reason" 1 'workflow.ci_batch_run is a command string or null' "$P2" -C "$T/r/cirunnum" --name
# --- cross_machine_gate -------------------------------------------------------------------------------------------
eq "--field cross_machine_gate.role request" request "$P2" -C "$T/r/cmreq" --field cross_machine_gate.role
eq "--field cross_machine_gate.label" needs-mac-gate "$P2" -C "$T/r/cmreq" --field cross_machine_gate.label
eq "--field cross_machine_gate.checks_section" "Mac checks" "$P2" -C "$T/r/cmreq" --field cross_machine_gate.checks_section
eq "--field cross_machine_gate.exempt: one path a line, as the label block of ship-ticket reads it" $'.scratch/\ndocs/' \
    bash -c 'set -o pipefail; "$@" | sed -n '"'"'s/^ *"\(.*\)",\{0,1\}$/\1/p'"'" _ "$P2" -C "$T/r/cmreq" --field cross_machine_gate.exempt
eq "--field cross_machine_gate.role serve" serve "$P2" -C "$T/r/cmserve" --field cross_machine_gate.role
eq "--field cross_machine_gate.check with serve" "GATE_SCOPE=all gate full" "$P2" -C "$T/r/cmserve" --field cross_machine_gate.check
check "--field cross_machine_gate absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field cross_machine_gate
check "--field cross_machine_gate.role absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field cross_machine_gate.role
check "--field cross_machine_gate.exempt absent with serve -> 4" 4 "" "$P2" -C "$T/r/cmserve" --field cross_machine_gate.exempt
eq "--field cross_machine_gate null" null "$P2" -C "$T/r/cmnull" --field cross_machine_gate
check "--field cross_machine_gate.role under null -> 4" 4 "" "$P2" -C "$T/r/cmnull" --field cross_machine_gate.role
fails_with "cross_machine_gate.role \"merge\" -> 1 with the reason" 1 'cross_machine_gate.role is "request" or "serve", got "merge"' "$P2" -C "$T/r/cmrole" --name
fails_with "cross_machine_gate without label -> 1 with the reason" 1 'cross_machine_gate.label is the name of the GitHub label, got no label' "$P2" -C "$T/r/cmnolabel" --name
fails_with "cross_machine_gate without checks_section -> 1 with the reason" 1 'cross_machine_gate.checks_section is the heading' "$P2" -C "$T/r/cmnosection" --name
fails_with "cross_machine_gate serve without check -> 1 with the reason" 1 'cross_machine_gate: role "serve" needs check' "$P2" -C "$T/r/cmservenocheck" --name
fails_with "cross_machine_gate.exempt with a backslash -> 1 with the reason" 1 'cross_machine_gate.exempt is a list of paths' "$P2" -C "$T/r/cmexemptbs" --name
fails_with "cross_machine_gate.exempt a string -> 1 with the reason" 1 'cross_machine_gate.exempt is a list of paths' "$P2" -C "$T/r/cmexemptstr" --name
fails_with "cross_machine_gate a list -> 1 with the reason" 1 'cross_machine_gate is an object' "$P2" -C "$T/r/cmobj" --field cross_machine_gate
# --- the names of the document sections code parses -------------------------------------------
eq "--field tickets.trail_section as written" "## Fichiers" "$P2" -C "$T/r/hdset" --field tickets.trail_section
eq "--field tickets.done_section as written" "## Fini quand" "$P2" -C "$T/r/hdset" --field tickets.done_section
eq "--field tickets.manual_mark as written" "à la main" "$P2" -C "$T/r/hdset" --field tickets.manual_mark
eq "--field docs.adr_status_label as written" "Statut" "$P2" -C "$T/r/hdset" --field docs.adr_status_label
eq "--field docs.adr_dir is kept beside the label" "docs/adr" "$P2" -C "$T/r/hdset" --field docs.adr_dir
# trail_section has no default: null says the tickets have no file-list section, and skills skip that step.
eq "--field tickets.trail_section null stays null" null "$P2" -C "$T/r/hdnull" --field tickets.trail_section
check "--field tickets.trail_section absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field tickets.trail_section
for p in bare hdnull hdgroupsnull legacy; do
    eq "$p: tickets.done_section absent or null -> ## Done when" "## Done when" "$P2" -C "$T/r/$p" --field tickets.done_section
    eq "$p: tickets.manual_mark absent or null -> manual" manual "$P2" -C "$T/r/$p" --field tickets.manual_mark
    eq "$p: docs.adr_status_label absent or null -> Status" Status "$P2" -C "$T/r/$p" --field docs.adr_status_label
done
eq "--json carries the three names, resolved" $'## Done when\nmanual\nStatus' \
    bash -c 'set -o pipefail; "$@" --json | jq -r ".tickets.done_section, .tickets.manual_mark, .docs.adr_status_label" | tr -d "\r"' _ "$P2" -C "$T/r/bare"
# A malformed value is one warning on stderr, with the profile's path, and the default: the project is still read.
for spec in "hddonenum|tickets.done_section|## Done when|got 5" "hddoneempty|tickets.done_section|## Done when|got \"  \"" \
    "hdmanuallist|tickets.manual_mark|manual|got [\"manual\"]" "hdstatusnum|docs.adr_status_label|Status|got 1"; do
    IFS='|' read -r p f want got <<<"$spec"
    eq "$p: a malformed $f -> the default" "$want" "$P2" -C "$T/r/$p" --field "$f"
    fails_with "$p: a malformed $f -> exit 0 and one warning with the path" 0 "profile: $(printed "$HH/projects/$p/profile.json"): $f must be a non-empty string or null, $got — ignored" "$P2" -C "$T/r/$p" --name
done
# --- workflow.pipeline ------------------------------------------------------------------------
PL_DEFAULT='[{"kind":"queued"},{"kind":"implementing"},{"kind":"ci"},{"kind":"agent-review"},{"kind":"gate-merge"},{"kind":"closing"},{"kind":"done"}]'
eq "no workflow.pipeline -> _resolved.pipeline is the default Pipeline" "$PL_DEFAULT" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/bare" --field _resolved.pipeline
eq "workflow.pipeline null -> the default Pipeline" "$PL_DEFAULT" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/plnull" --field _resolved.pipeline
eq "schema 1 -> the default Pipeline" "$PL_DEFAULT" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/legacy" --field _resolved.pipeline
eq "a valid workflow.pipeline -> _resolved.pipeline is that Pipeline" "$(jq -c . <<<"$PL_GOOD")" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/plgood" --field _resolved.pipeline
eq "a valid workflow.pipeline: --field workflow.pipeline as written" "$(jq -c . <<<"$PL_GOOD")" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/plgood" --field workflow.pipeline
eq "--json carries _resolved.pipeline" "queued implementing ci agent-review gate-merge closing done" bash -c 'set -o pipefail; "$@" --json | jq -r "[._resolved.pipeline[].kind] | join(\" \")"' _ "$P2" -C "$T/r/bare"
check "the default Pipeline is not written into workflow" 4 "" "$P2" -C "$T/r/bare" --field workflow.pipeline
for spec in "${PL_BAD[@]}"; do
    n="${spec%%|*}"; reason="${spec##*|}"
    fails_with "workflow.pipeline ($n) -> 1: $reason" 1 "$reason" "$P2" -C "$T/r/$n" --name
done
fails_with "a broken workflow.pipeline names the profile and says broken profile" 1 "$(printed "$HH/projects/pldup/profile.json"): workflow.pipeline" "$P2" -C "$T/r/pldup" --name
fails_with "a broken workflow.pipeline: broken profile" 1 "— broken profile" "$P2" -C "$T/r/plfirst" --name
eq "--json attribution absent, Silent mode -> off" off "${attr_json[@]}" "$T/r/home"
eq "--json attribution: an explicit on in Silent mode wins" on "${attr_json[@]}" "$T/r/silenton"
eq "--json attribution: an explicit off in Full mode wins" off "${attr_json[@]}" "$T/r/fulloff"
# Schema 1 has no mode: a "mode" written there does not turn the default to off.
eq "--field attribution absent, schema 1 that names mode silent -> on" on "$P2" -C "$T/r/legacysilent" --field attribution
eq "schema 1 that names mode silent: --field mode -> full" full "$P2" -C "$T/r/legacysilent" --field mode
# null is "not set": the default of the mode.
eq "--field attribution null, Silent mode -> off" off "$P2" -C "$T/r/silentnull" --field attribution
eq "--field attribution null, Full mode -> on" on "$P2" -C "$T/r/fullnull" --field attribution
eq "--json attribution null, Silent mode -> off" off "${attr_json[@]}" "$T/r/silentnull"
eq "--json attribution null, Full mode -> on" on "${attr_json[@]}" "$T/r/fullnull"
# Any other value is a broken profile, exit 1 with the value named, in every way of asking — as with "mode".
for v in "${ATTR_BAD[@]}"; do
    for m in silent full; do
        fails_with "attribution ${v#*:}, $m -> 1 with the reason (--field)" 1 "\"attribution\" is \"on\" or \"off\", got ${v#*:} — broken profile" "$P2" -C "$T/r/$m${v%%:*}" --field attribution
        fails_with "attribution ${v#*:}, $m -> 1 (--json)" 1 '"attribution"' "$P2" -C "$T/r/$m${v%%:*}" --json
        fails_with "attribution ${v#*:}, $m -> 1 (--name)" 1 '"attribution"' "$P2" -C "$T/r/$m${v%%:*}" --name
        check "attribution ${v#*:}, $m: nothing on stdout" 1 "" bash -c '[ -n "$("$@" 2>/dev/null)" ]' _ "$P2" -C "$T/r/$m${v%%:*}" --field attribution
    done
done
fails_with "schema 1: attribution \"OFF\" -> 1 with the reason" 1 'got "OFF"' "$P2" -C "$T/r/legacybad" --field attribution
# The summary agents read prints the resolved profile: a Silent project without the field shows off there.
check "summary of a Silent profile without attribution names off" 0 '"attribution": "off"' "$P2" -C "$T/r/home"
check "summary of a Full profile without attribution names on" 0 '"attribution": "on"' "$P2" -C "$T/r/bare"
eq "--field language.docs absent -> en" en "$P2" -C "$T/r/bare" --field language.docs
eq "--field language.docs of a string language (schema 1) is that language" ru "$P2" -C "$T/r/legacy" --field language.docs
eq "--field language.docs from the file" ru "$P2" -C "$T/r/demo" --field language.docs
check "--field mcp.allowed is a JSON list from the file" 0 "" bash -c '[ "$("$@" | node -e "console.log(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")).join(\",\"))")" = qmd,worfy-canvas,github ]' _ "$P2" -C "$T/r/demo" --field mcp.allowed
check "--field mcp.allowed absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field mcp.allowed
# The four Harness paths: answered with this Harness's own scripts, never from a schema 2 file.
eq "schema 2: tickets.status_tool -> bin next to profile" "$BINOUT/ticket" "$P2" -C "$T/r/demo" --field tickets.status_tool
eq "schema 2: tickets.epic_status -> bin next to profile" "$BINOUT/epic-status" "$P2" -C "$T/r/demo" --field tickets.epic_status
eq "schema 2: numbering.reserve_with -> bin next to profile" "$BINOUT/preflight" "$P2" -C "$T/r/demo" --field numbering.reserve_with
eq "schema 2: workflow.preflight -> bin next to profile" "$BINOUT/preflight --epic <эпик>" "$P2" -C "$T/r/demo" --field workflow.preflight
eq "schema 2: without the fields: tickets.status_tool still answered" "$BINOUT/ticket" "$P2" -C "$T/r/bare" --field tickets.status_tool
eq "schema 1: ~/.claude/bin/ticket -> the same path as v2" "$BINOUT/ticket" "$P2" -C "$T/r/legacy" --field tickets.status_tool
eq "schema 1: ~/.claude/bin/epic-status -> bin next to profile" "$BINOUT/epic-status" "$P2" -C "$T/r/legacy" --field tickets.epic_status
eq "schema 1: ~/.claude/bin/preflight --epic -> bin next to profile" "$BINOUT/preflight --epic <эпик>" "$P2" -C "$T/r/legacy" --field workflow.preflight
eq "schema 1: null stays null" null "$P2" -C "$T/r/legacy" --field numbering.reserve_with
eq "schema 1: <HOME>/.claude/bin/ticket -> bin next to profile" "$BINOUT/ticket" "$P2" -C "$T/r/absbin" --field tickets.status_tool
eq "schema 1: <HOME>/.claude/bin/preflight --epic -> bin next to profile" "$BINOUT/preflight --epic <эпик>" "$P2" -C "$T/r/absbin" --field workflow.preflight
fails_with "profile.json that is not an object -> 1 with the reason" 1 "not a JSON object" "$P2" -C "$T/r/notobj" --name
check "schema 1: --json and briefing name no ~/.claude/bin" 0 "" bash -c 'o="$("$@" --json && "$@")" && [[ "$o" == *"$0"* && "$o" != *"~/.claude/bin"* ]]' "$(json_printed "$BINREAL")/ticket" "$P2" -C "$T/r/legacy"
eq "schema 1: string language -> language.reports" ru "$P2" -C "$T/r/legacy" --field language.reports
eq "schema 1: string language -> language.team" ru "$P2" -C "$T/r/legacy" --field language.team
# --- User personalization: $HARNESS_HOME/user.json -------------------------------------------------
# language.reports comes from the user's file first, then (for one release) from the profile, then en.
# language.team and language.docs stay in the profile; unset they are en. A broken user.json is one line
# on stderr and the next value in that order, never a failure. Each case has its own Harness state
# folder; the registry and the profiles are the ones above.
# pu <Harness state folder> <profile arguments…>
cat >"$T/pu" <<EOF
#!/usr/bin/env bash
hu="\$1"
shift
exec env CLAUDE_GATE_CONFIG="$HH/gate/config.json" CLAUDE_PROFILES_DIR="$HH/projects" HOME="$H" USERPROFILE="$H" HARNESS_HOME="\$hu" "$PROFILE" "\$@"
EOF
chmod +x "$T/pu"
pu="$T/pu"
uj() { mkdir -p "$T/u/$1" && printf '%s' "$2" >"$T/u/$1/user.json"; } # $1 case, $2 the file's text
mkdir -p "$T/u/none"
uj ru '{"language":{"reports":"ru","team":"de","docs":"de"}}'
uj notjson '{"language":'
uj array '["ru"]'
uj numeric '{"language":{"reports":5}}'
uj empty '{}'
uj blank ''
mkdir -p "$T/u/bom" && printf '\357\273\277%s' '{"language":{"reports":"ru"}}' >"$T/u/bom/user.json" # PowerShell 5 Set-Content -Encoding UTF8
eq "user.json ru, profile en -> ru" ru "$pu" "$T/u/ru" -C "$T/r/bare" --field language.reports
eq "user.json ru, profile without language -> ru" ru "$pu" "$T/u/ru" -C "$T/r/both" --field language.reports
eq "user.json does not set language.team (profile en)" en "$pu" "$T/u/ru" -C "$T/r/bare" --field language.team
eq "user.json does not set language.docs (profile ru)" ru "$pu" "$T/u/ru" -C "$T/r/demo" --field language.docs
check "user.json ru: the summary shows reports ru" 0 '"reports": "ru"' "$pu" "$T/u/ru" -C "$T/r/bare"
check "user.json ru: --json shows reports ru" 0 '"reports": "ru"' "$pu" "$T/u/ru" -C "$T/r/bare" --json
eq "no user.json -> the profile's language.reports (ru)" ru "$pu" "$T/u/none" -C "$T/r/demo" --field language.reports
eq "no user.json -> the profile's language.reports (en)" en "$pu" "$T/u/none" -C "$T/r/bare" --field language.reports
eq "no user.json, no language in the profile -> reports en" en "$pu" "$T/u/none" -C "$T/r/both" --field language.reports
eq "no language in the profile -> team en" en "$pu" "$T/u/none" -C "$T/r/both" --field language.team
eq "no language in the profile -> docs en" en "$pu" "$T/u/none" -C "$T/r/both" --field language.docs
eq "profile without language.docs -> docs en" en "$pu" "$T/u/none" -C "$T/r/bare" --field language.docs
eq "user.json {} -> the profile's value" ru "$pu" "$T/u/empty" -C "$T/r/demo" --field language.reports
check "user.json {}: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/empty" -C "$T/r/demo" --field language.reports
check "no user.json: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/none" -C "$T/r/demo" --field language.reports
eq "user.json with a byte order mark is read -> ru" ru "$pu" "$T/u/bom" -C "$T/r/bare" --field language.reports
check "user.json with a byte order mark: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/bom" -C "$T/r/bare" --field language.reports
eq "empty user.json -> the profile's value" ru "$pu" "$T/u/blank" -C "$T/r/demo" --field language.reports
check "empty user.json: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/blank" -C "$T/r/demo" --field language.reports
for c in notjson array numeric; do
    eq "broken user.json ($c), no language in the profile -> en, exit 0" en "$pu" "$T/u/$c" -C "$T/r/both" --field language.reports
    eq "broken user.json ($c), profile ru -> ru" ru "$pu" "$T/u/$c" -C "$T/r/demo" --field language.reports
    check "broken user.json ($c): one stderr line naming the file" 0 "" bash -c \
        'e="$("${@:2}" 2>&1 >/dev/null)"; [ "$(printf "%s\n" "$e" | wc -l | tr -d " ")" = 1 ] && [[ "$e" == *"$1"* ]]' \
        _ "$(printed "$T/u/$c/user.json")" "$pu" "$T/u/$c" -C "$T/r/both" --field language.reports
done
# CLAUDE_PROFILES_DIR (tests) overrides both places.
mkdir -p "$T/override/both"
printf '{"schema":2,"name":"both","title":"override","mode":"full"}\n' >"$T/override/both/profile.json"
eq "CLAUDE_PROFILES_DIR overrides both places" "$(printed "$T/override/both")" env CLAUDE_PROFILES_DIR="$T/override" HOME="$H" USERPROFILE="$H" HARNESS_HOME="$HH" "$PROFILE" -C "$T/r/both" --dir
# --- Silent mode: _resolved.mode, workflow_folder, repos -----------------
eq "silent: _resolved.mode" silent "$P2" -C "$T/r/demo" --field _resolved.mode
eq "silent without workflow.folder, one repository -> HARNESS_HOME/projects/<name>/workflow" "$(printed "$HH/projects/demo/workflow")" "$P2" -C "$T/r/demo" --field _resolved.workflow_folder
eq "silent: workflow.folder with ~/ is expanded" "$(printed "$H/wf")" "$P2" -C "$T/r/home" --field _resolved.workflow_folder
fails_with "silent: a relative workflow.folder -> 1 with the reason" 1 "not an absolute path" "$P2" -C "$T/r/relwf" --name
eq "silent, two repositories, no folder -> the folder above them" "$(printed "$T/r/multi")" "$P2" -C "$T/r/multi/m1" --field _resolved.workflow_folder
eq "silent, two repositories: _resolved.repos lists both" "m1 $(printed "$T/r/multi/m1") m1|m2 $(printed "$T/r/multi/m2") m2" \
    bash -c '"$@" | jq -r "map(\"\(.name) \(.path) \(.gate_key)\") | join(\"|\")"' _ "$P2" -C "$T/r/multi/m2" --field _resolved.repos
eq "silent, the common directory itself: the same Workflow folder" "$(printed "$T/r/multi")" "$P2" -C "$T/r/multi" --field _resolved.workflow_folder
eq "full: _resolved.mode" full "$P2" -C "$T/r/both" --field _resolved.mode
eq "schema 1: _resolved.mode full" full "$P2" -C "$T/r/legacy" --field _resolved.mode
eq "full: the Workflow folder is the working tree" "$(printed "$(cd "$T/r/both" && pwd -P)")" "$P2" -C "$T/r/both" --field _resolved.workflow_folder
eq "full: _resolved.repos of one repository" '[{"name":"both","gate_key":"both"}]' \
    bash -c '"$@" | jq -c "map({name, gate_key})"' _ "$P2" -C "$T/r/both" --field _resolved.repos
check "silent summary names the mode and the Workflow folder" 0 "mode: silent   workflow folder: $(printed "$H/wf")" "$P2" -C "$T/r/home"
check "full summary has no mode line" 0 "" bash -c '! "$@" | grep -q "^mode: "' _ "$P2" -C "$T/r/both"
# The relative tickets.root of a Silent profile is taken from the Workflow folder (bin/ticket applies the rule).
# ticket itself keeps the real HOME: only the profile it reads sees the sandbox. A shell script as
# CLAUDE_PROFILE_BIN cannot start on Windows (node runs no #! line there), so that form is POSIX-only.
case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) echo "skip tickets.root through a shell-script profile: node on Windows cannot start a shell script" ;;
    *)
        eq "silent: a relative tickets.root is taken from the Workflow folder" "$(printed "$H/wf/.scratch")" \
            env CLAUDE_PROFILE_BIN="$P2" bash -c 'cd "$0" && node "$1" root' "$T/r/home" "$BIN/ticket"
        eq "full: a relative tickets.root is still taken from the working tree" "$(printed "$(cd "$T/r/both" && pwd -P)/.scratch")" \
            env CLAUDE_PROFILE_BIN="$P2" bash -c 'cd "$0" && node "$1" root' "$T/r/both" "$BIN/ticket"
        ;;
esac
eq "silent: a relative tickets.root is taken from the Workflow folder (node profile script)" "$(printed "$H/wf/.scratch")" \
    env CLAUDE_PROFILE_BIN="$P2NODE" bash -c 'cd "$0" && node "$1" root' "$T/r/home" "$BIN/ticket"
eq "full: a relative tickets.root is still taken from the working tree (node profile script)" "$(printed "$(cd "$T/r/both" && pwd -P)/.scratch")" \
    env CLAUDE_PROFILE_BIN="$P2NODE" bash -c 'cd "$0" && node "$1" root' "$T/r/both" "$BIN/ticket"

after="$(snapshot)"
check "profile writes nothing into HOME or HARNESS_HOME" 0 "" test "$before" = "$after"
if [ -f "$LIVE_GATE" ]; then
    check "live registry: unregistered dir -> 3" 3 "" "$PROFILE" -C "$T/plain"
else
    echo "skip live registry check: $LIVE_GATE missing"
fi

home_after="$(real_home_snapshot "$REAL_HOME")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" 0 "" test "$home_before" = "$home_after"
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
