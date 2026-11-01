#!/usr/bin/env bash
# Tests of the gate's code 3 ("could not verify") and its delivery through the Stop hook stop.mjs:
#   - a broken or missing registry: the resolver exits non-zero, the gate with code 3
#     «the registry resolver … exited», not «not registered»; stop.mjs still holds the turn
#     on the red marker of a registered project;
#   - the resolver crashed: code 3, not 0;
#   - the stop.mjs message is said at most once per session per repository;
#   - a marker is delivered only to its own session and its own tree; a marker without a session
#     ("anon") only if it is newer than the start of the session.
# Run: bash harness/hooks/tests/gate-notverified.test.sh; exit code 0 means everything passed.
# HOOKS_DIR runs the test on another copy of the hooks (for example, on the version before an edit).
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; a path like
# /c/… or /tmp/… means nothing to node. Elsewhere there is no -W.
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # the hooks next to this test (harness/hooks)
GATE="$HOOKS/gate.mjs"
STOP="$HOOKS/stop.mjs"
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
check "gate: broken config -> 'not verified: the registry resolver', not 'not registered'" \
    bash -c '[[ "$1" == *"[gate] not verified: the registry resolver"* && "$1" != *"not registered"* ]]' _ "$out"

date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && sp s1 | node "$STOP" 2>&1)"; rc=$?
check "stop: broken config + red marker -> still blocks (exit 2)" [ "$rc" -eq 2 ]
check "stop: broken config + red marker -> red message" bash -c '[[ "$1" == *"The quality gate is red"* ]]' _ "$out"
check "stop: broken config + red marker -> block message names the gate-3 reason" \
    bash -c '[[ "$1" == *"Also:"*"the registry resolver"* ]]' _ "$out"
out="$(cd "$T/reg" && sp s1 | node "$STOP" 2>&1)"; rc=$?
check "stop: gate-3 reason already said in this session -> not repeated" \
    bash -c '[ "$2" -eq 2 ] && [[ "$1" != *"Also:"* ]]' _ "$out" "$rc"
rm -f "$RED" "$T/state/stop-blocks/"*

(cd "$T/reg" && sp s1b | node "$GATE" fast >/dev/null 2>&1)
out="$(cd "$T/reg" && sp s1b | node "$STOP" 2>&1)"; rc=$?
check "stop: broken config, no red -> exit 0, says 'not verified' once" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *additionalContext* && "$1" == *"not verified"* ]]' _ "$out" "$rc"
check "stop: additionalContext output is valid JSON" node -e 'JSON.parse(process.argv[1])' "$out"
echo "Profile fast, repository t. Could not verify: docker" >"$T/state/unverified-t-$(tag "$T/reg")"
out="$(cd "$T/reg" && sp s1u | node "$STOP" 2>&1)"; rc=$?
check "stop: broken config + unverified marker of this tree -> said once, exit 0" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *"could not verify the work"* ]]' _ "$out" "$rc"
rm -f "$T/state/unverified-t-"*

# Red and a code-3 marker together: the turn is held, the code-3 reason is in the same message.
(cd "$T/reg" && sp s1r | node "$GATE" fast >/dev/null 2>&1)
date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && sp s1r | node "$STOP" 2>&1)"; rc=$?
check "stop: red + gate-3 marker -> blocks and names the gate-3 reason" \
    bash -c '[ "$2" -eq 2 ] && [[ "$1" == *"The quality gate is red"* && "$1" == *"the registry resolver"* ]]' _ "$out" "$rc"
(cd "$T/reg" && sp s1r | node "$STOP" >/dev/null 2>&1)
out="$(cd "$T/reg" && sp s1r | node "$STOP" 2>&1)"; rc=$?
check "stop: red past MAX_BLOCKS -> exit 0 with 'still red'" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *"still red"* ]]' _ "$out" "$rc"
out="$(cd "$T/reg" && sp s1r | node "$STOP" 2>&1)"; rc=$?
check "stop: red past MAX_BLOCKS again -> silent (once per session)" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
rm -f "$RED" "$T/state/stop-blocks/"*
echo "$GOOD_CFG" >"$CLAUDE_GATE_CONFIG"

# --- 2. Stdin that is not JSON ---------------------------------------------------------
# The red marker still holds the turn: a hook input it cannot parse must not let the turn end.
date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && printf 'not json' | node "$STOP" 2>&1)"; rc=$?
check "stop: red marker + stdin not JSON -> blocks (exit 2) with the red message" \
    bash -c '[ "$2" -eq 2 ] && [[ "$1" == *"The quality gate is red"* ]]' _ "$out" "$rc"
rm -f "$RED" "$T/state/stop-blocks/"*

# --- 10. No node / the resolver crashed -------------------------------------------
# gate.mjs is a Node script and cannot say "node not found": the launcher gate.sh says it, with
# code 3, and leaves the marker that stop.mjs delivers. NONODE is a PATH with git and the tools
# gate.sh needs, and no node: the folders of Git Bash on Windows, elsewhere a folder of links to
# the tools. gate.sh looks for node in /opt/homebrew/bin and /usr/local/bin itself: with node
# there a copy of gate.sh that does not look there runs, as in gate-shim.test.sh.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
NONODE="" why="" LAUNCHER="$HOOKS/gate.sh"
if [ -x /opt/homebrew/bin/node ] || [ -x /usr/local/bin/node ]; then
    LAUNCHER="$T/gate-no-usual-node.sh"
    sed 's#/opt/homebrew/bin /usr/local/bin#/worfy-test-no-such-folder-a /worfy-test-no-such-folder-b#' "$HOOKS/gate.sh" >"$LAUNCHER"
    grep -q '/worfy-test-no-such-folder-a /worfy-test-no-such-folder-b' "$LAUNCHER" || bad "gate.sh no longer names /opt/homebrew/bin and /usr/local/bin in one line: the test cannot take them out"
fi
if [ "$WIN" -eq 1 ]; then NONODE="/usr/bin:$(dirname "$(command -v git)")"
else
    mkdir -p "$T/bin"
    for t in bash env git sha1sum shasum mkdir mktemp date mv rm; do
        p="$(command -v "$t" 2>/dev/null)" && [ "${p#/}" != "$p" ] && ln -sf "$p" "$T/bin/$t"
    done
    NONODE="$T/bin"
fi
if [ -n "$NONODE" ] && (PATH="$NONODE"; command -v node >/dev/null 2>&1); then why="node is in $NONODE, next to git and the shell tools"; NONODE=""; fi
if [ -n "$NONODE" ] && ! (PATH="$NONODE"; command -v git >/dev/null 2>&1); then
    # Git Bash always has git, so a skip here would hide a wrong NONODE.
    [ "$WIN" -eq 1 ] && bad "git is not in $NONODE"
    why="git is not in $NONODE"; NONODE=""
fi
if [ -z "$NONODE" ]; then echo "skip node-missing checks of the gate: $why"; else
out="$(cd "$T/reg" && sp s10 | HOME="$T/home" USERPROFILE="$T/home" PATH="$NONODE" "$BASH" "$LAUNCHER" fast 2>&1)"; rc=$?
check "gate: node missing -> exit 3 (not 0)" [ "$rc" -eq 3 ]
check "gate: node missing -> 'not verified: node not found'" \
    bash -c '[[ "$1" == *"[gate] not verified: node not found"* ]]' _ "$out"
check "gate: node missing -> marker of this tree and session" [ -s "$T/state/nokey-broken-$(tag "$T/reg")-s10" ]
# The Stop hook delivers that marker in the next turn, once node is there again.
out="$(cd "$T/reg" && sp s10 | HOME="$T/home" USERPROFILE="$T/home" node "$STOP" 2>&1)"; rc=$?
check "stop: gate's node-missing marker -> exit 0, says 'not verified'" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *"node not found"* && "$1" == *"not verified"* ]]' _ "$out" "$rc"
rm -f "$T/state/stop-blocks/"*
fi
# The Stop hook itself is a Node script now, run as `node …/stop.mjs`:
# without node Claude Code cannot start it and shows the hook error without holding the turn, as
# with the gate. There is no "stop without node" case any more.

printf '#!/usr/bin/env node\nthrow new Error("boom")\n' >"$T/crash.mjs"
out="$(cd "$T/reg" && sp s10b | CLAUDE_GATE_RESOLVE="$T/crash.mjs" node "$GATE" fast 2>&1)"; rc=$?
check "gate: resolver crash -> exit 3 + 'not verified'" \
    bash -c '[ "$2" -eq 3 ] && [[ "$1" == *"[gate] not verified: the registry resolver"* ]]' _ "$out" "$rc"

# --- 3. At most one message per session per repository ---------------------------
U="$T/unreg"; UM="$T/state/nokey-unregistered-$(tag "$U")"
(cd "$U" && sp s3 | node "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp s3 | node "$STOP" 2>&1)"; rc=$?
check "stop: first notice in session -> said" bash -c '[[ "$1" == *"not registered"* ]]' _ "$out"
(cd "$U" && sp s3 | node "$GATE" fast >/dev/null 2>&1)
check "gate: second run writes marker again" [ -s "$UM-s3" ]
out="$(cd "$U" && sp s3 | node "$STOP" 2>&1)"; rc=$?
check "stop: second gate run, same session -> silent exit 0 (once per session)" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
check "stop: silent run still consumes the marker" [ ! -e "$UM-s3" ]

# --- 4. A marker goes only to its own session and its own tree --------------------
(cd "$U" && sp sA | node "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp sB | node "$STOP" 2>&1)"; rc=$?
check "stop in session B: marker of session A not delivered" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
check "marker of session A left for A" [ -s "$UM-sA" ]
out="$(cd "$U" && sp sA | node "$STOP" 2>&1)"
check "stop in session A: gets its marker" bash -c '[[ "$1" == *"not registered"* ]]' _ "$out"

(cd "$T/unreg-wt" && sp sW | node "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp sW | node "$STOP" 2>&1)"
check "stop in main tree: marker of another worktree not delivered" bash -c '[ -z "$1" ]' _ "$out"
out="$(cd "$T/unreg-wt" && sp sW | node "$STOP" 2>&1)"
check "stop in that worktree: gets its marker" bash -c '[[ "$1" == *"not registered"* ]]' _ "$out"

# Without a session (run from a terminal): an anon marker, taken only by a session that started earlier.
(cd "$U" && node "$GATE" fast </dev/null >/dev/null 2>&1)
AM="$UM-anon"
check "gate without session -> anon marker" [ -s "$AM" ]
touch -t 202001010000 "$AM"
: >"$T/new.jsonl"
out="$(cd "$U" && sp sNew "$T/new.jsonl" | node "$STOP" 2>&1)"
check "stop: anon marker older than session start -> not delivered" bash -c '[ -z "$1" ] && [ -e "$2" ]' _ "$out" "$AM"
touch "$AM"
out="$(cd "$U" && sp sNew "$T/new.jsonl" | node "$STOP" 2>&1)"
check "stop: anon marker newer than session start -> delivered" bash -c '[[ "$1" == *"not registered"* ]]' _ "$out"
# A birth time of 0 (the file system does not know it) is no session start: an anon marker is not
# taken then. No file system here reports 0, so the rule is checked on the function stop.mjs uses.
check "stop: birth time 0 -> no session start; a known birth time -> whole seconds; not a file -> none" node -e '
import(require("node:url").pathToFileURL(process.argv[1]).href).then(({ sessionStart }) => {
    const st = (birthtimeMs, file = true) => ({ birthtimeMs, isFile: () => file })
    process.exit(sessionStart(st(0)) === null && sessionStart(st(1500.7)) === 1 && sessionStart(st(1500, false)) === null ? 0 : 1)
})' "$STOP"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
