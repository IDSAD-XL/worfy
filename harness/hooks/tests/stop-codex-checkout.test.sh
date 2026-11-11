#!/usr/bin/env bash
# The Stop hook stop.mjs on Codex in the main checkout and in a linked worktree:
#   - a Codex Stop in the main checkout runs no gate (no verdict file) and lets a turn without a red
#     marker end;
#   - a Codex SubagentStop in the main checkout runs the gate, and its red marker holds the next Stop
#     there (exit 2), which still runs no gate of its own;
#   - a Codex Stop in a linked worktree runs the gate: red holds the turn, green lets it end;
#   - a Claude Code Stop in either runs no gate, as before.
# Run: bash harness/hooks/tests/stop-codex-checkout.test.sh; exit code 0 means every check passed.
#
# The registry, the gate state, both trees and HOME are temporary (CLAUDE_GATE_CONFIG,
# CLAUDE_GATE_STATE): the test does not touch the live registry or markers.
set -u
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # HOOKS_DIR runs the test on another copy of the hooks
STOP="$HOOKS/stop.mjs"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
# The session comes from the hook JSON; the session the test was started from does not count.
unset CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID HARNESS_HOME CLAUDE_PROFILE_BIN
export GATE_SCOPE=all
T="$(mktemp -d)" || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" USERPROFILE="$T/home"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export CLAUDE_GATE_STATE="$T/state" CLAUDE_GATE_CONFIG="$T/config.json"
M="$T/main"      # the main checkout, where the Orchestrator works
W="$T/linked"    # a linked worktree of it, where an implementer works
mkdir -p "$T/home" "$T/state" "$M"
# The gate runs "$PM run check"; the script passes or fails by the first line of $T/mode. On Windows a
# .cmd: node starts nothing else there without an interpreter.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"
    printf '@echo off\r\nset /p m=<"%s"\r\nif "%%m%%"=="ok" exit /b 0\r\necho Tests 1 failed\r\nexit /b 1\r\n' "$T/mode" >"$PM"
else
    PM="$T/fakepm"
    printf '#!/bin/sh\n[ "$(head -n 1 "%s")" = ok ] && exit 0\necho "Tests 1 failed"\nexit 1\n' "$T/mode" >"$PM"
    chmod +x "$PM"
fi
# The registry knows the repository by its main checkout; every worktree of it resolves there.
printf '{"repos":[{"key":"t","match":"%s","pm":"%s","root":{"fast":["check"]},"workspace":{}}]}\n' "$M" "$PM" >"$CLAUDE_GATE_CONFIG"
echo '{ "name": "fixture", "scripts": { "check": "true" } }' >"$M/package.json"
# core.autocrlf=false: the linked worktree gets its files from a checkout, as written (Git for Windows
# may set core.autocrlf=true).
git -C "$M" init -q && git -C "$M" config core.autocrlf false && git -C "$M" add package.json && git -C "$M" commit -q -m init
git -C "$M" worktree add -q --detach "$W"

# A hook input: $1 the folder, $2 the event, $3 "codex" or "claude". A Codex input carries turn_id
# (hooks/codex-input.mjs), a SubagentStop of Codex an agent_id and agent_type.
input() {
    case "$3:$2" in
        codex:Stop) printf '{"session_id":"s-codex","turn_id":"t1","transcript_path":null,"cwd":"%s","hook_event_name":"Stop","model":"m","permission_mode":"default","stop_hook_active":false,"last_assistant_message":"Done."}' "$1" ;;
        codex:SubagentStop) printf '{"session_id":"s-codex","turn_id":"t1","transcript_path":null,"cwd":"%s","hook_event_name":"SubagentStop","model":"m","permission_mode":"default","stop_hook_active":false,"last_assistant_message":"Done.","agent_id":"a1","agent_type":"worfy-implementer","agent_transcript_path":null}' "$1" ;;
        claude:Stop) printf '{"session_id":"s-claude","transcript_path":"%s/s-claude.jsonl","cwd":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$T" "$1" ;;
    esac
}
# Runs the hook in $1 with the input above; rc, $T/out and $T/err hold what it gave.
hook() { (cd "$1" && input "$1" "$2" "$3" | node "$STOP" >"$T/out" 2>"$T/err"); rc=$?; }
verdicts() { find "$T/state" -maxdepth 1 -name 'verdict-*' | wc -l | tr -d ' '; }
outcome() { node -e 'const fs=require("fs"),p=require("path");const d=process.argv[1];const f=fs.readdirSync(d).find(n=>n.startsWith("verdict-")&&n.includes(process.argv[2]));process.stdout.write(f?JSON.parse(fs.readFileSync(p.join(d,f),"utf8")).outcome:"none")' "$T/state" "$1"; }
tag() { node -e 'process.stdout.write(require("crypto").createHash("sha1").update(process.argv[1]).digest("hex").slice(0,8))' "$(git -C "$1" rev-parse --show-toplevel)"; }
said() { echo "exit $rc, stdout: $(head -c 200 "$T/out"), stderr: $(head -c 300 "$T/err")"; }

# --- 1. Main checkout, Codex Stop, red work: no gate run, nothing holds the turn ------------------
echo bad >"$T/mode"
hook "$M" Stop codex
if [ "$rc" -eq 0 ] && [ ! -s "$T/out" ] && [ ! -s "$T/err" ] && [ "$(verdicts)" = 0 ]; then
    ok "codex Stop in the main checkout: no gate run, exit 0, nothing said"
else bad "codex Stop in the main checkout: $(said), verdicts $(verdicts)"; fi

# --- 2. Claude Code Stop in the main checkout and in the linked worktree: no gate run either -------
hook "$M" Stop claude; m_rc=$rc
hook "$W" Stop claude; w_rc=$rc
if [ "$m_rc" -eq 0 ] && [ "$w_rc" -eq 0 ] && [ "$(verdicts)" = 0 ]; then
    ok "claude Stop in the main checkout and in a linked worktree: no gate run, exit 0"
else bad "claude Stop: main exit $m_rc, linked exit $w_rc, verdicts $(verdicts)"; fi

# --- 3. Main checkout, Codex SubagentStop: the gate runs and the red holds the Subagent -----------
hook "$M" SubagentStop codex
if [ "$rc" -eq 2 ] && [[ "$(cat "$T/err")" == "The quality gate is red"* ]] && [ "$(outcome "$(tag "$M")")" = red ]; then
    ok "codex SubagentStop in the main checkout: the gate runs, red, exit 2"
else bad "codex SubagentStop in the main checkout: $(said), outcome $(outcome "$(tag "$M")")"; fi

# --- 4. The work is fixed; the Codex Stop in the main checkout runs no gate, the red marker holds --
echo ok >"$T/mode"
hook "$M" Stop codex
if [ "$rc" -eq 2 ] && [[ "$(cat "$T/err")" == "The quality gate is red"* ]] && [ "$(outcome "$(tag "$M")")" = red ]; then
    ok "codex Stop in the main checkout: held on the red marker, no run of its own"
else bad "codex Stop in the main checkout on a red marker: $(said), outcome $(outcome "$(tag "$M")")"; fi

# --- 5. The Claude Code Stop in the main checkout is held by the same marker, as before ----------
hook "$M" Stop claude
if [ "$rc" -eq 2 ] && [[ "$(cat "$T/err")" == "The quality gate is red"* ]]; then
    ok "claude Stop in the main checkout: held on the red marker"
else bad "claude Stop in the main checkout on a red marker: $(said)"; fi

# --- 6. Linked worktree, Codex Stop: the gate runs; red holds the turn, green lets it end ----------
echo bad >"$T/mode"
hook "$W" Stop codex
if [ "$rc" -eq 2 ] && [[ "$(cat "$T/err")" == "The quality gate is red"* ]] && [ "$(outcome "$(tag "$W")")" = red ]; then
    ok "codex Stop in a linked worktree: the gate runs, red, exit 2"
else bad "codex Stop in a linked worktree, red: $(said), outcome $(outcome "$(tag "$W")")"; fi
echo ok >"$T/mode"
hook "$W" Stop codex
if [ "$rc" -eq 0 ] && [ ! -s "$T/err" ] && [ "$(outcome "$(tag "$W")")" = green ]; then
    ok "codex Stop in a linked worktree: the gate runs, green, exit 0"
else bad "codex Stop in a linked worktree, green: $(said), outcome $(outcome "$(tag "$W")")"; fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
