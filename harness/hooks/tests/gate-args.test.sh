#!/usr/bin/env bash
# Tests of the profile argument of gate.mjs: `--help` / `-h` print the usage and exit with 0, an
# unknown profile exits with 2, and neither writes, makes or removes anything in the state folder.
# Run: bash harness/hooks/tests/gate-args.test.sh; exit code 0 means everything passed.
#
# HOME and HARNESS_HOME are temporary: the registry is $HARNESS_HOME/gate/config.json and the state
# folder $HARNESS_HOME/gate/state, as on a real machine, so the test sees what a run would leave in
# the real state folder of whoever started it.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling node reads. Elsewhere there is no -W.
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # HOOKS_DIR runs the test on another copy of the hooks
GATE="$HOOKS/gate.mjs"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
unset CLAUDE_CODE_SESSION_ID CLAUDE_GATE_STATE CLAUDE_GATE_CONFIG EVAL_HARNESS_HOME GATE_SCOPE
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()   { pass=$((pass + 1)); echo "ok   $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$T/hh"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
STATE="$HARNESS_HOME/gate/state"
mkdir -p "$T/home" "$HARNESS_HOME/gate" "$T/repo"
git -C "$T/repo" init -q && git -C "$T/repo" commit -q --allow-empty -m init
# A registry entry with one profile of its own and none of `fast`/`full`: no script ever runs here.
printf '{"repos":[{"key":"t","match":"%s","pm":"npm","root":{"p_custom":[]},"workspace":{"p_ws":[]}}]}\n' "$T/repo" >"$HARNESS_HOME/gate/config.json"
# The listing of the state folder, or "absent": what a run left there.
listing() { if [ -d "$STATE" ]; then (cd "$STATE" && find . | LC_ALL=C sort | tr '\n' ' '); else echo absent; fi; }
gate() { (cd "$T/repo" && node "$GATE" "$@" </dev/null >"$T/out" 2>"$T/err"); }

# 1. --help and -h: the usage on stdout, code 0, and no state folder made.
for flag in --help -h; do
    gate "$flag"; rc=$?
    if [ "$rc" -eq 0 ] && grep -q '^usage: node gate.mjs' "$T/out" && [ ! -s "$T/err" ]; then ok "$flag -> usage, exit 0"
    else bad "$flag: exit $rc, out: $(head -c 300 "$T/out"), err: $(head -c 300 "$T/err")"; fi
    [ "$(listing)" = absent ] && ok "$flag -> no state folder made" || bad "$flag left in the state folder: $(listing)"
done

# 2. An unknown profile: code 2, the name and the usage on stderr, no state folder made.
for name in nosuch --verbose; do
    gate "$name"; rc=$?
    if [ "$rc" -eq 2 ] && grep -qxF "[gate] unknown profile: $name" "$T/err" && grep -q '^usage: node gate.mjs' "$T/err" && [ ! -s "$T/out" ]; then ok "unknown profile $name -> exit 2"
    else bad "unknown profile $name: exit $rc, out: $(head -c 300 "$T/out"), err: $(head -c 300 "$T/err")"; fi
    [ "$(listing)" = absent ] && ok "unknown profile $name -> no state folder made" || bad "unknown profile $name left in the state folder: $(listing)"
done

# 3. A profile of the registry runs: it writes its verdict file. `fast` runs even with no entry
#    naming it (the hooks run it in every project) and replaces that file.
gate p_custom; rc=$?
verdict="$(find "$STATE" -maxdepth 1 -name 'verdict-*.json' 2>/dev/null | head -1)"
if [ "$rc" -eq 0 ] && [ -n "$verdict" ] && grep -q '"profile": *"p_custom"' "$verdict"; then ok "registry profile p_custom -> a run with a verdict file"
else bad "registry profile p_custom: exit $rc, verdict: ${verdict:-none}, out: $(head -c 300 "$T/out")"; fi
gate p_ws; rc=$?
[ "$rc" -eq 0 ] && grep -q '"profile": *"p_ws"' "$verdict" && ok "workspace profile p_ws -> a run" || bad "workspace profile p_ws: exit $rc, err: $(head -c 300 "$T/err")"
gate; rc=$?
[ "$rc" -eq 0 ] && grep -q '"profile": *"fast"' "$verdict" && ok "no argument -> fast runs" || bad "no argument: exit $rc, err: $(head -c 300 "$T/err")"
gate full; rc=$?
[ "$rc" -eq 0 ] && grep -q '"profile": *"full"' "$verdict" && ok "full -> runs" || bad "full: exit $rc, err: $(head -c 300 "$T/err")"

# 4. After a run the state folder has a verdict file: --help and an unknown profile leave it as it is.
before="$(listing)"; kept="$(cat "$verdict")"
gate --help; gate nosuch; rc=$?
[ "$rc" -eq 2 ] && [ "$(listing)" = "$before" ] && [ "$(cat "$verdict" 2>/dev/null)" = "$kept" ] && ok "--help and an unknown profile leave the verdict file of the run before" || bad "after a run: exit $rc, state: $(listing), was: $before"

# 5. A registry that cannot be read says nothing against the name: the run reports the registry (code 3).
printf '{ not json' >"$HARNESS_HOME/gate/config.json"
gate nosuch; rc=$?
[ "$rc" -eq 3 ] && grep -q 'gate-resolve.mjs' "$T/err" && ok "unreadable registry -> the run reports it (exit 3)" || bad "unreadable registry: exit $rc, out: $(head -c 300 "$T/out"), err: $(head -c 300 "$T/err")"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
