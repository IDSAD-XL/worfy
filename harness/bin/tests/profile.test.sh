#!/usr/bin/env bash
# Tests of harness/bin/profile. Run: bash harness/bin/tests/profile.test.sh; exit code 0 — everything passed.
#
# Some checks run against the live registry (gate/config.json) and the projects registered there;
# the others against a synthetic repository in a temporary directory with its own config, to
# check a worktree OUTSIDE the match prefix (identification via git common dir). Schema 2 and the
# profile's place on the machine: profile-schema2.test.sh, profile-attribution.test.sh and profile-user.test.sh.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/profile-world.sh"

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
# A crash that does not depend on what the resolver accepts in the registry: a TypeError with
# properties is told by any Error name, not only a bare "Error", and the lines after it are not kept.
printf '%s\n' "throw Object.assign(new TypeError('stand-in broke'), { code: 'ERR_STAND_IN' })" >"$T/resolver-type-error.mjs"
check "resolver TypeError with error properties -> its Error line" 0 "" bash -c \
    'err=$(CLAUDE_GATE_RESOLVE="$0" "$1" -C "$2" 2>&1 >/dev/null); rc=$?; [ "$rc" -eq 1 ] && [[ "$err" == *"project not determined: TypeError: stand-in broke" ]]' \
    "$T/resolver-type-error.mjs" "$PROFILE" "$T/repo"
# A caret line last, with no Error line: the caret is not the reason; the line before it is.
printf '%s\n' "process.stderr.write('gate-resolve: the registry names no repos\\n    ^\\n'); process.exit(1)" >"$T/resolver-caret.mjs"
check "resolver message then a caret line -> the message" 0 "" bash -c \
    'err=$(CLAUDE_GATE_RESOLVE="$0" "$1" -C "$2" 2>&1 >/dev/null); rc=$?; [ "$rc" -eq 1 ] && [[ "$err" == *"project not determined: gate-resolve: the registry names no repos" ]]' \
    "$T/resolver-caret.mjs" "$PROFILE" "$T/repo"

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
