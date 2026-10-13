#!/usr/bin/env bash
# Tests of the gate's code 3 ("could not verify") and its delivery through stop.sh:
#   - a broken or missing registry: the resolver exits non-zero, the gate with code 3
#     «резолвер … завершился» (the resolver exited), not «не зарегистрирован» (not registered); stop.sh still holds the turn
#     on the red marker of a registered project;
#   - the resolver crashed: code 3, not 0;
#   - the stop.sh message is said at most once per session per repository;
#   - a marker is delivered only to its own session and its own tree; a marker without a session
#     ("anon") only if it is newer than the start of the session.
# Run: bash harness/hooks/tests/gate-notverified.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; a path like
# /c/… or /tmp/… means nothing to node. Elsewhere there is no -W.
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # the hooks next to this test (harness/hooks)
GATE="$HOOKS/gate.mjs"
STOP="$HOOKS/stop.sh"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
unset CLAUDE_CODE_SESSION_ID
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
check() { # $1 = description, the rest is the condition
    local d="$1"; shift
    if "$@"; then ok "$d"; else bad "$d (rc=$rc, out: ${out:0:300})"; fi
}
# node, not shasum: Git Bash has shasum only where perl is on PATH.
tag() { node -e 'process.stdout.write(require("node:crypto").createHash("sha1").update(process.argv[1]).digest("hex").slice(0, 8))' "$1"; }
sp() { printf '{"session_id":"%s"%s}' "$1" "${2:+,\"transcript_path\":\"$2\"}"; }

export CLAUDE_GATE_STATE="$T/state" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$T/state" "$T/reg" "$T/unreg" "$T/home"
for r in reg unreg; do
    git -C "$T/$r" init -q && git -C "$T/$r" commit -q --allow-empty -m init
done
git -C "$T/unreg" worktree add -q "$T/unreg-wt" 2>/dev/null
GOOD_CFG="$(printf '{"repos":[{"key":"t","match":"%s","pm":"npm","root":{},"workspace":{}}]}' "$T/reg")"
echo "$GOOD_CFG" >"$CLAUDE_GATE_CONFIG"
RED="$T/state/red-t-$(tag "$T/reg")"

# --- 1. Broken registry -----------------------------------------------------------
echo '{"repos": [ broken' >"$CLAUDE_GATE_CONFIG"
out="$(node "$CLAUDE_GATE_RESOLVE" --which "$T/reg" 2>&1)"; rc=$?
check "resolver: unparseable config -> non-zero exit" [ "$rc" -ne 0 ]
rm -f "$CLAUDE_GATE_CONFIG"
out="$(node "$CLAUDE_GATE_RESOLVE" --which "$T/reg" 2>&1)"; rc=$?
check "resolver: missing config -> non-zero exit" [ "$rc" -ne 0 ]
echo '{"Repos": []}' >"$CLAUDE_GATE_CONFIG"
out="$(node "$CLAUDE_GATE_RESOLVE" --which "$T/reg" 2>&1)"; rc=$?
check "resolver: config without 'repos' array -> non-zero exit" [ "$rc" -ne 0 ]
echo '{"repos": [ broken' >"$CLAUDE_GATE_CONFIG"

out="$(cd "$T/reg" && sp s1 | node "$GATE" fast 2>&1)"; rc=$?
check "gate: broken config -> exit 3" [ "$rc" -eq 3 ]
check "gate: broken config -> 'ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер', not 'не зарегистрирован'" \
    bash -c '[[ "$1" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер"* && "$1" != *"не зарегистрирован"* ]]' _ "$out"

date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && sp s1 | bash "$STOP" 2>&1)"; rc=$?
check "stop: broken config + red marker -> still blocks (exit 2)" [ "$rc" -eq 2 ]
check "stop: broken config + red marker -> red message" bash -c '[[ "$1" == *"The quality gate is red"* ]]' _ "$out"
check "stop: broken config + red marker -> block message names the gate-3 reason" \
    bash -c '[[ "$1" == *"Also:"*"резолвер"* ]]' _ "$out"
out="$(cd "$T/reg" && sp s1 | bash "$STOP" 2>&1)"; rc=$?
check "stop: gate-3 reason already said in this session -> not repeated" \
    bash -c '[ "$2" -eq 2 ] && [[ "$1" != *"Also:"* ]]' _ "$out" "$rc"
rm -f "$RED" "$T/state/stop-blocks/"*

(cd "$T/reg" && sp s1b | node "$GATE" fast >/dev/null 2>&1)
out="$(cd "$T/reg" && sp s1b | bash "$STOP" 2>&1)"; rc=$?
check "stop: broken config, no red -> exit 0, says 'not verified' once" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *additionalContext* && "$1" == *"not verified"* ]]' _ "$out" "$rc"
check "stop: additionalContext output is valid JSON" node -e 'JSON.parse(process.argv[1])' "$out"
echo "Profile fast, repository t. Could not verify: docker" >"$T/state/unverified-t-$(tag "$T/reg")"
out="$(cd "$T/reg" && sp s1u | bash "$STOP" 2>&1)"; rc=$?
check "stop: broken config + unverified marker of this tree -> said once, exit 0" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *"could not verify the work"* ]]' _ "$out" "$rc"
rm -f "$T/state/unverified-t-"*

# Red and a code-3 marker together: the turn is held, the code-3 reason is in the same message.
(cd "$T/reg" && sp s1r | node "$GATE" fast >/dev/null 2>&1)
date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && sp s1r | bash "$STOP" 2>&1)"; rc=$?
check "stop: red + gate-3 marker -> blocks and names the gate-3 reason" \
    bash -c '[ "$2" -eq 2 ] && [[ "$1" == *"The quality gate is red"* && "$1" == *"резолвер"* ]]' _ "$out" "$rc"
(cd "$T/reg" && sp s1r | bash "$STOP" >/dev/null 2>&1)
out="$(cd "$T/reg" && sp s1r | bash "$STOP" 2>&1)"; rc=$?
check "stop: red past MAX_BLOCKS -> exit 0 with 'still red'" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *"still red"* ]]' _ "$out" "$rc"
out="$(cd "$T/reg" && sp s1r | bash "$STOP" 2>&1)"; rc=$?
check "stop: red past MAX_BLOCKS again -> silent (once per session)" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
rm -f "$RED" "$T/state/stop-blocks/"*
echo "$GOOD_CFG" >"$CLAUDE_GATE_CONFIG"

# --- 10. No node / the resolver crashed -------------------------------------------
# The gate has no "node not found" case any more (worfy-windows ticket 03): it is a Node script,
# so without node it does not start, says nothing and leaves no marker — see the header of
# gate.mjs. What stays is stop.sh, still bash: without node it holds the turn on the red marker.
# stop.sh adds /opt/homebrew/bin itself: if node is there, "no node" cannot be simulated.
if [ -x /opt/homebrew/bin/node ]; then echo "skip node-missing check: /opt/homebrew/bin/node exists"; else
date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && sp s10 | HOME="$T/home" USERPROFILE="$T/home" PATH=/usr/bin:/bin bash "$STOP" 2>&1)"; rc=$?
check "stop without node + red marker -> blocks (exit 2)" [ "$rc" -eq 2 ]
rm -f "$RED" "$T/state/stop-blocks/"*
fi

printf '#!/usr/bin/env node\nthrow new Error("boom")\n' >"$T/crash.mjs"
out="$(cd "$T/reg" && sp s10b | CLAUDE_GATE_RESOLVE="$T/crash.mjs" node "$GATE" fast 2>&1)"; rc=$?
check "gate: resolver crash -> exit 3 + 'ПРОВЕРИТЬ НЕ УДАЛОСЬ'" \
    bash -c '[ "$2" -eq 3 ] && [[ "$1" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер"* ]]' _ "$out" "$rc"

# --- 3. At most one message per session per repository ---------------------------
U="$T/unreg"; UM="$T/state/nokey-unregistered-$(tag "$U")"
(cd "$U" && sp s3 | node "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp s3 | bash "$STOP" 2>&1)"; rc=$?
check "stop: first notice in session -> said" bash -c '[[ "$1" == *"не зарегистрирован"* ]]' _ "$out"
(cd "$U" && sp s3 | node "$GATE" fast >/dev/null 2>&1)
check "gate: second run writes marker again" [ -s "$UM-s3" ]
out="$(cd "$U" && sp s3 | bash "$STOP" 2>&1)"; rc=$?
check "stop: second gate run, same session -> silent exit 0 (once per session)" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
check "stop: silent run still consumes the marker" [ ! -e "$UM-s3" ]

# --- 4. A marker goes only to its own session and its own tree --------------------
(cd "$U" && sp sA | node "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp sB | bash "$STOP" 2>&1)"; rc=$?
check "stop in session B: marker of session A not delivered" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
check "marker of session A left for A" [ -s "$UM-sA" ]
out="$(cd "$U" && sp sA | bash "$STOP" 2>&1)"
check "stop in session A: gets its marker" bash -c '[[ "$1" == *"не зарегистрирован"* ]]' _ "$out"

(cd "$T/unreg-wt" && sp sW | node "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp sW | bash "$STOP" 2>&1)"
check "stop in main tree: marker of another worktree not delivered" bash -c '[ -z "$1" ]' _ "$out"
out="$(cd "$T/unreg-wt" && sp sW | bash "$STOP" 2>&1)"
check "stop in that worktree: gets its marker" bash -c '[[ "$1" == *"не зарегистрирован"* ]]' _ "$out"

# Without a session (run from a terminal): an anon marker, taken only by a session that started earlier.
(cd "$U" && node "$GATE" fast </dev/null >/dev/null 2>&1)
AM="$UM-anon"
check "gate without session -> anon marker" [ -s "$AM" ]
touch -t 202001010000 "$AM"
: >"$T/new.jsonl"
out="$(cd "$U" && sp sNew "$T/new.jsonl" | bash "$STOP" 2>&1)"
check "stop: anon marker older than session start -> not delivered" bash -c '[ -z "$1" ] && [ -e "$2" ]' _ "$out" "$AM"
touch "$AM"
out="$(cd "$U" && sp sNew "$T/new.jsonl" | bash "$STOP" 2>&1)"
check "stop: anon marker newer than session start -> delivered" bash -c '[[ "$1" == *"не зарегистрирован"* ]]' _ "$out"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
