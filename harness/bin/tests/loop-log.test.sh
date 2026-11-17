#!/usr/bin/env bash
# loop-log (worfy-stuck-agents/07): reads <gate state>/calls/loops.jsonl, which the hook calls.mjs
# writes, prints its would-deny lines (time, Session, pattern, start of the command) and a last line
# `cases: N (revisit at 3)`; --since <YYYY-MM-DD> leaves out the older ones. Exit 0, also without the file.
# Run: bash harness/bin/tests/loop-log.test.sh; exit code 0 means every check passed.
#
# The gate state and HOME are temporary (CLAUDE_GATE_STATE): the test does not touch the live Harness home.
set -u
BIN="${BIN_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"
LOOP_LOG="$BIN/loop-log"
unset HARNESS_HOME EVAL_HARNESS_HOME
T="$(mktemp -d)" || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" USERPROFILE="$T/home"
mkdir -p "$T/home"
export CLAUDE_GATE_STATE="$T/state"

run() { node "$LOOP_LOG" "$@" >"$T/out" 2>"$T/err"; rc=$?; }

# --- No file: no cases ---------------------------------------------------------------------------------
run
[ "$rc" -eq 0 ] && [ "$(cat "$T/out")" = "cases: 0 (revisit at 3)" ] && ok "no loops.jsonl: cases: 0, exit 0" || bad "no file: exit $rc, out: $(cat "$T/out") err: $(cat "$T/err")"

# --- Cases ---------------------------------------------------------------------------------------------
mkdir -p "$T/state/calls"
cat >"$T/state/calls/loops.jsonl" <<'EOF'
{"t":"2026-11-10T08:00:00.000Z","session":"ses-old","agent_id":null,"pattern":"same-failure","level":"would-deny","tool":"Bash","command":"pnpm test","vendor":"claude"}
{"t":"2026-11-18T09:00:00.000Z","session":"ses-1","agent_id":"agent-7","pattern":"same-failure","level":"would-hint","tool":"Bash","command":"pnpm lint","vendor":"claude"}
{"t":"2026-11-18T09:01:00.000Z","session":"ses-1","agent_id":"agent-7","pattern":"same-failure","level":"would-deny","tool":"Bash","command":"pnpm lint\nsecond line","vendor":"claude"}
not json
{"t":"2026-11-19T10:00:00.000Z","session":"ses-2","agent_id":null,"pattern":"edit-back-and-forth","level":"would-deny","tool":"Edit","command":"/work/src/a.ts","vendor":"claude"}

EOF
run
out="$(cat "$T/out")"
[ "$rc" -eq 0 ] && ok "exit 0 with cases" || bad "cases: exit $rc, err: $(cat "$T/err")"
[ "$(printf '%s\n' "$out" | tail -n 1)" = "cases: 3 (revisit at 3)" ] && ok "cases: the would-deny lines, a broken line skipped" || bad "count: $out"
[ "$(printf '%s\n' "$out" | awk 'END { print NR }')" = 4 ] && ok "one line per case, then the count" || bad "lines: $out"
printf '%s\n' "$out" | grep -q 'pnpm lint' && ! printf '%s\n' "$out" | grep -q 'would-hint' && ok "a would-hint is not a case" || bad "hint: $out"
case1="$(printf '%s\n' "$out" | grep 'ses-1')"
case "$case1" in
*2026-11-18T09:01:00*ses-1/agent-7*same-failure*"pnpm lint second line"*) ok "a case: time, Session with agent_id, pattern, the command on one line" ;;
*) bad "case line: $case1" ;;
esac
printf '%s\n' "$out" | grep 'ses-2' | grep -q 'edit-back-and-forth.*/work/src/a.ts' && ok "a Session without agent_id, an edit's file" || bad "ses-2: $out"

# --- --since -------------------------------------------------------------------------------------------
run --since 2026-11-18
out="$(cat "$T/out")"
[ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -n 1)" = "cases: 2 (revisit at 3)" ] && ! printf '%s\n' "$out" | grep -q ses-old \
    && ok "--since drops the older cases, keeps that day's" || bad "since: exit $rc, $out"
run --since 2026-11-20
[ "$rc" -eq 0 ] && [ "$(cat "$T/out")" = "cases: 0 (revisit at 3)" ] && ok "--since after every case: cases: 0" || bad "since late: $(cat "$T/out")"

# --- Arguments -----------------------------------------------------------------------------------------
run --since yesterday
[ "$rc" -eq 2 ] && [ ! -s "$T/out" ] && grep -q 'usage: loop-log' "$T/err" && ok "a date not YYYY-MM-DD: usage on stderr, exit 2" || bad "bad date: exit $rc"
run --since
[ "$rc" -eq 2 ] && ok "--since without a date: exit 2" || bad "no date: exit $rc"
run --what
[ "$rc" -eq 2 ] && ok "an unknown argument: exit 2" || bad "unknown: exit $rc"
run --help
[ "$rc" -eq 0 ] && grep -q 'usage: loop-log' "$T/out" && ok "--help: usage on stdout, exit 0" || bad "help: exit $rc"

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
