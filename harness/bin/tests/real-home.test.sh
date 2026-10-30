#!/usr/bin/env bash
# Tests of real-home.sh on a temporary home, on every OS: a write into a volatile folder (gate/state,
# worktree-sessions, profiles/<name>/state, worfy-harness/projects/<name>/state, skills/synced) is not a difference unless the file names the
# marker (as node spells it, and with \ on Windows); a write anywhere else in the Harness parts is one;
# real_home_diff prints at most 10 differing lines.
# Run: bash harness/bin/tests/real-home.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HERE/real-home.sh"
. "$HERE/gh-stand-in.sh" # on_windows, node_path
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

H="$T/home" MK="$T/test-tmp"
mkdir -p "$H/.claude/worfy-harness/worktree-sessions" "$H/.claude/gate/state" "$H/.claude/profiles/p/state" "$H/.claude/skills/synced/s" "$MK"
echo base >"$H/.claude/worfy-harness/keep"
# The marker as a test's own files hold it: node's spelling (C:/… on Windows), and with \ (cygpath -w).
MK_NODE="$(node_path "$MK")"; MK_BACK="$(cygpath -w "$MK" 2>/dev/null || printf '%s' "$MK")"

# changed <name> <want: same|differs> <file> <content>: snapshot, write the file, snapshot again
changed() {
    local before after
    before="$(real_home_snapshot "$H" "$MK")"
    mkdir -p "$(dirname "$3")" && printf '%s\n' "$4" >"$3"
    after="$(real_home_snapshot "$H" "$MK")"
    if { [ "$2" = same ] && [ "$before" = "$after" ]; } || { [ "$2" = differs ] && [ "$before" != "$after" ]; }; then ok "$1"
    else bad "$1: want $2; diff: $(real_home_diff "$before" "$after")"; fi
}
changed "gate/state: a write without the marker is no difference" same "$H/.claude/gate/state/red-x" "verdict"
changed "worktree-sessions: a write without the marker is no difference" same "$H/.claude/worfy-harness/worktree-sessions/lock" "pid 1"
changed "profiles/<name>/state: a write without the marker is no difference" same "$H/.claude/profiles/p/state/retro.log" "row"
changed "worfy-harness/projects/<name>/state: a code map written by a scout is no difference" same "$H/.claude/worfy-harness/projects/p/state/code-map/repo.md" "## src"
changed "worfy-harness/projects/<name> outside state: any write is a difference" differs "$H/.claude/worfy-harness/projects/p/profile.json" "{}"
changed "skills/synced: a write without the marker is no difference" same "$H/.claude/skills/synced/s/manifest.json" "{}"
changed "gate/state: a file naming the marker (node's spelling) is a difference" differs "$H/.claude/gate/state/mine" "repo $MK_NODE"
changed "worktree-sessions: a file naming the marker with \\ (Windows) or / is a difference" differs "$H/.claude/worfy-harness/worktree-sessions/mine" "tree $MK_BACK"
changed "skills/synced: a file naming the marker is a difference" differs "$H/.claude/skills/synced/s/mine" "$MK_NODE"
changed "worfy-harness: any write is a difference" differs "$H/.claude/worfy-harness/x" "x"
changed "skills outside synced: any write is a difference" differs "$H/.claude/skills/mine/SKILL.md" "x"
changed "gate outside state: any write is a difference" differs "$H/.claude/gate/config.json" "{}"
# a rewrite of a watched file (another size) is a difference too
changed "worfy-harness: a rewritten file is a difference" differs "$H/.claude/worfy-harness/keep" "base and more"
# on Windows the snapshot walks paths joined with \: the volatile folders are still matched
if on_windows; then
    s="$(real_home_snapshot "$H" "$MK")"
    [[ "$s" == *'\.claude\worfy-harness\keep'* ]] && [[ "$s" != *'gate\state\red-x'* ]] \
        && ok "Windows: paths with \\ are listed, the volatile ones left out" || bad "Windows paths: $s"
fi

# real_home_diff: at most 10 lines, indented, < before and > after
before="$(real_home_snapshot "$H" "$MK")"
for i in $(seq 1 12); do echo "$i" >"$H/.claude/worfy-harness/many-$i"; done
after="$(real_home_snapshot "$H" "$MK")"
d="$(real_home_diff "$before" "$after")"
[ "$(printf '%s\n' "$d" | wc -l | tr -d ' ')" = 10 ] && [ "$(printf '%s\n' "$d" | grep -c '^    > ')" = 10 ] \
    && ok "real_home_diff prints at most 10 differing lines, indented" || bad "real_home_diff: [$d]"
[ -z "$(real_home_diff "$after" "$after")" ] && ok "real_home_diff prints nothing for equal snapshots" || bad "real_home_diff of equal snapshots printed something"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
