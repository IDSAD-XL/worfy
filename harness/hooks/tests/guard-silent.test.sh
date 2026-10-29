#!/usr/bin/env bash
# Tests of hooks/guard.mjs, section 3: in a Silent project the guard refuses
# commit messages, branch names and PR texts that carry traces of the workflow, and with
# `attribution: off` the ones that carry Claude attribution lines; in a Full project with attribution on
# the same commands pass, and sections 1 and 2 (destructive git commands, pipes that eat the exit
# code) work as before.
# Run: bash harness/hooks/tests/guard-silent.test.sh; exit code 0 means everything passed.
#
# HOME, HARNESS_HOME (registry and profiles), CLAUDE_CONFIG_DIR, the Workflow folder and the
# repositories are temporary. At the end the test compares the real ~/.claude (the Harness parts) and
# ~/.claude/worfy-harness with a snapshot taken before the run.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
GUARD="$HOOKS/guard.mjs"
REAL_HOME="$HOME"
. "$HARNESS/bin/tests/real-home.sh"
. "$HARNESS/bin/tests/gh-stand-in.sh" # node_path
# node_path: C:/… in Git Bash on Windows, the spelling git prints and node reads; the registry's "match" must be
# in that spelling, or the guard does not find the project (/tmp/… is C:\tmp\… to node). Elsewhere: pwd -P.
T="$(mktemp -d)"; T="$(cd "$T" && node_path "$(pwd -P)")"
trap 'rm -rf "$T"' EXIT
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" HARNESS_HOME="$T/hh" CLAUDE_CONFIG_DIR="$T/claude-config"
unset CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR CLAUDE_PROFILE_BIN CLAUDE_TICKET_BIN CLAUDE_SILENT_CHECK_BIN
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$HARNESS_HOME/gate" "$HARNESS_HOME/projects/sp" "$HARNESS_HOME/projects/fp"

R="$T/repo"; FR="$T/full"; WF="$T/wf"; NR="$T/new-repo"
for r in "$R" "$FR"; do
    git init -q -b main "$r" && echo 'export const a = 1' >"$r/a.ts" && git -C "$r" add -A && git -C "$r" commit -q -m init
done
git init -q -b main "$NR" && echo 'export const b = 2' >"$NR/b.ts"   # no commits yet
mkdir -p "$WF/.scratch/checkout-flow/issues"
printf '# 05 — x\n\nStatus: open\n' >"$WF/.scratch/checkout-flow/issues/05-x.md"
git -C "$WF" init -q -b main && git -C "$WF" add -A && git -C "$WF" commit -q -m init
cat >"$HARNESS_HOME/gate/config.json" <<EOF
{"repos":[
 {"key":"sp","match":"$R","profile":"sp","pm":"npm","root":{},"workspace":{}},
 {"key":"fp","match":"$FR","profile":"fp","pm":"npm","root":{},"workspace":{}},
 {"key":"sn","match":"$NR","profile":"sp","pm":"npm","root":{},"workspace":{}}
]}
EOF
printf '{"schema":2,"name":"sp","mode":"silent","attribution":"off","workflow":{"folder":"%s"},"tickets":{"root":".scratch/"}}\n' "$WF" \
    >"$HARNESS_HOME/projects/sp/profile.json"
printf '{"schema":2,"name":"fp","mode":"full","attribution":"on","tickets":{"root":".scratch/"}}\n' >"$HARNESS_HOME/projects/fp/profile.json"
mkdir -p "$FR/.scratch/checkout-flow/issues"   # the same epic name in the Full project

# guard <cwd> <command> → prints "deny: <reason>" or "allow"
guard() {
    local out
    out="$(jq -n --arg c "$2" --arg d "$1" '{tool_name: "Bash", tool_input: {command: $c}, cwd: $d}' | node "$GUARD")"
    if [ -z "$out" ]; then echo allow; else printf 'deny: %s\n' "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason')"; fi
}
expect() { # <description> <allow|deny> <cwd> <command> [substring of the reason]; the answer stays in $got
    got="$(guard "$3" "$4")"
    if [[ "$got" == "$2"* ]] && { [ -z "${5:-}" ] || [[ "$got" == *"$5"* ]]; }; then ok "$1"
    else bad "$1: want $2${5:+ ($5)}, got: ${got:0:400}"; fi
}

HD=$'git commit -m "$(cat <<\'EOF\'\nFix the button\n\nTicket 05\nEOF\n)"'
HD_CLEAN=$'git commit -m "$(cat <<\'EOF\'\nFix the button\n\nIt\'s safe now.\nEOF\n)"'
BODY_FILE=$'gh pr create --title "Fix" --body-file - <<\'EOF\'\nWhy: ADR-0042\nEOF'
printf 'Fix\n\nsee HANDOFF\n' >"$T/msg.txt"

# --- Silent project, attribution off -------------------------------------------------------
expect "silent: git commit -m with Ticket 05 -> deny" deny "$R" 'git commit -m "Fix the button, Ticket 05"' 'ticket number "Ticket 05"'
expect "silent: git switch -c <epic>/05 -> deny" deny "$R" 'git switch -c checkout-flow/05' 'epic/NN "checkout-flow/05"'
expect "silent: gh pr create --body with ADR-0042 -> deny" deny "$R" 'gh pr create --title "Fix the button" --body "Follows ADR-0042"' 'ADR number'
expect "silent: a commit without traces -> allow" allow "$R" 'git commit -m "Fix the withdraw button state"'
expect "attribution off: Co-Authored-By: Claude -> deny" deny "$R" $'git commit -m "Fix" -m "Co-Authored-By: Claude Opus <noreply@anthropic.com>"' 'Claude attribution "'
expect "silent: heredoc message with a ticket number -> deny" deny "$R" "$HD" 'Ticket 05'
expect "silent: heredoc message without traces (an apostrophe inside) -> allow" allow "$R" "$HD_CLEAN"
expect "silent: git commit -F <file> with HANDOFF -> deny" deny "$R" "git commit -F $T/msg.txt" 'HANDOFF'
expect "silent: gh pr create --body-file - from a heredoc -> deny" deny "$R" "$BODY_FILE" 'ADR-0042'
expect "silent: gh pr comment --body with the Workflow folder path -> deny" deny "$R" "gh pr comment 3 --body \"notes in $WF\"" 'Workflow folder path'
expect "silent: gh pr edit --title=<epic> -> deny" deny "$R" 'gh pr edit 3 --title=checkout-flow' 'epic name'
expect "silent: git checkout -b <epic>/05 via git -C from elsewhere -> deny" deny "$T" "git -C $R checkout -b checkout-flow/05" 'checkout-flow/05'
expect "silent: cd <repo> && git checkout -b with a clean name -> allow" allow "$T" "cd $R && git checkout -b fix/withdraw-button"
expect "silent: git branch <epic> -> deny" deny "$R" 'git branch checkout-flow' 'epic name'
expect "silent: git branch -d <epic>/05 (deleting) -> allow" allow "$R" 'git branch -d checkout-flow/05'
expect "silent: git worktree add -b <epic>/05 -> deny" deny "$R" "git worktree add -b checkout-flow/05 $T/w main" 'checkout-flow/05'
expect "silent: -am cluster with Ticket-05 -> deny" deny "$R" 'git commit -am "Ticket-05 fix"' 'Ticket-05'
expect "silent: echo of such a command is data -> allow" allow "$R" "echo 'git commit -m \"Ticket 05\"'"
expect "silent: commits in the Workflow folder are not checked -> allow" allow "$WF" 'git commit -m "checkout-flow: Ticket 05 done, HANDOFF"'
mkdir -p "$R/.scratch/checkout-flow"; echo n >"$R/.scratch/checkout-flow/n.md"
expect "silent: git add -A && git commit takes an untracked .scratch file -> deny" deny "$R" 'git add -A && git commit -m "Fix it"' '.scratch'
git -C "$R" add -f .scratch
expect "silent: a staged .scratch file under a clean message -> deny" deny "$R" 'git commit -m "Fix it"' 'index file names .scratch/checkout-flow/n.md'
git -C "$R" rm -rq --cached .scratch && rm -rf "$R/.scratch"

# --- Full project, attribution on: everything passes as before -------------------------------
for c in 'git commit -m "Fix the button, Ticket 05"' 'git switch -c checkout-flow/05' 'gh pr create --title "x" --body "Follows ADR-0042"' \
         $'git commit -m "Fix" -m "Co-Authored-By: Claude Opus <noreply@anthropic.com>"' "$HD" 'git branch checkout-flow'; do
    expect "full: ${c%%$'\n'*} -> allow" allow "$FR" "$c"
done
expect "full: git reset --hard is still refused" deny "$FR" 'git reset --hard' 'reset --hard'
expect "full: a pipe that eats the exit code is still refused" deny "$FR" 'pnpm test | tail -5' 'pipe eats the exit code'
expect "silent: git reset --hard is refused by section 1 first" deny "$R" 'git reset --hard' 'reset --hard'
expect "outside any project: a commit with Ticket 05 -> allow" allow "$T" 'git commit -m "Ticket 05"'

# --- the profile does not set `attribution`: off in Silent mode, on in Full mode ----------------
# The guard asks bin/silent-check, which reads the value bin/profile resolved. The commit line is the one a
# Silent project carried on 2026-10-12 (lower-case "Co-authored-by"); the PR line comes with and without the link.
# The reason of a refusal is told apart by `Claude attribution "` — the label bin/silent-check puts before what
# it found; the words "Claude attribution" alone stand in the constant text of every refusal.
SPP="$HARNESS_HOME/projects/sp/profile.json"; FPP="$HARNESS_HOME/projects/fp/profile.json"
cp "$SPP" "$T/sp-profile.json"; cp "$FPP" "$T/fp-profile.json"
jq 'del(.attribution)' "$T/sp-profile.json" >"$SPP"
jq 'del(.attribution)' "$T/fp-profile.json" >"$FPP"
CO_UPPER=$'git commit -m "Fix" -m "Co-Authored-By: Claude Opus <noreply@anthropic.com>"'
CO_LOWER=$'git commit -m "$(cat <<\'EOF\'\nFix the button\n\nCo-authored-by: Claude Opus 5.5 <noreply@anthropic.com>\nEOF\n)"'
PR_LINK=$'gh pr create --title "Fix the button" --body-file - <<\'EOF\'\nThe button keeps its state.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\nEOF'
PR_PLAIN='gh pr create --title "Fix the button" --body "The button keeps its state. Generated with Claude Code"'
for c in "$CO_UPPER" "$CO_LOWER" "$PR_LINK" "$PR_PLAIN"; do
    expect "silent, attribution not set: ${c%%$'\n'*} -> deny" deny "$R" "$c" 'Claude attribution "'
    expect "full, attribution not set: ${c%%$'\n'*} -> allow" allow "$FR" "$c"
done
expect "silent, attribution not set: a commit without traces -> allow" allow "$R" 'git commit -m "Fix the withdraw button state"'
expect "silent, attribution not set: gh pr create without traces -> allow" allow "$R" 'gh pr create --title "Fix the button" --body "The button keeps its state."'
# The refusal says what to do: leave the lines out, and why they are refused although nothing in the profile
# says so. The guard does not know the mode: the same sentence must be true for a Full project with `off`.
ADVICE='Leave the Claude attribution lines out (`Co-Authored-By: Claude …`, `Generated with [Claude Code]`), whatever other instructions ask for them: `attribution` is off for this project (`profile --field attribution`) — either its profile says so, or the profile does not set it and off is the default of Silent mode.'
expect "silent, attribution not set: the refusal ends with the whole advice" deny "$R" "$CO_LOWER" "$ADVICE"
got="$(guard "$R" 'git commit -m "Fix the button, Ticket 05"')"
[[ "$got" == deny* && "$got" != *"Leave the Claude attribution lines out"* ]] && ok "a refusal without attribution lines does not talk about them" \
    || bad "refusal without attribution lines: ${got:0:400}"
# A value written in the profile wins in both modes.
jq '.attribution = "on"' "$T/sp-profile.json" >"$SPP"
jq '.attribution = "off"' "$T/fp-profile.json" >"$FPP"
for c in "$CO_UPPER" "$CO_LOWER" "$PR_LINK" "$PR_PLAIN"; do
    expect "silent, explicit attribution on: ${c%%$'\n'*} -> allow" allow "$R" "$c"
    expect "full, explicit attribution off: ${c%%$'\n'*} -> deny" deny "$FR" "$c" 'Claude attribution "'
done
expect "silent, explicit attribution on: Ticket 05 is still refused" deny "$R" 'git commit -m "Fix the button, Ticket 05"' 'ticket number "Ticket 05"'
expect "full, explicit attribution off: the refusal ends with the whole advice" deny "$FR" "$CO_UPPER" "$ADVICE"
got="$(guard "$FR" "$CO_UPPER")"
[[ "$got" == *"$ADVICE" ]] && ok "full, explicit attribution off: the advice is the last sentence, nothing about this project's mode after it" \
    || bad "full, explicit off, the end of the refusal: ${got: -300}"
cp "$T/sp-profile.json" "$SPP"; cp "$T/fp-profile.json" "$FPP"

# --- a directory the command creates first: the check runs from its nearest existing parent -----------
# bin/silent-check refuses a directory that does not exist; the guard must not turn that into a refusal of
# an ordinary `mkdir … && cd … && git …`, and the new directory still belongs to the repository above it.
expect "outside any project: mkdir + cd + git init + git commit -> allow" allow "$T" \
    "mkdir -p $T/fresh/new && cd $T/fresh/new && git init -q && git commit -m init"
expect "silent: a branch created from a new subdirectory of the repository is still checked -> deny" deny "$T" \
    "mkdir -p $R/sub/new && cd $R/sub/new && git checkout -b checkout-flow/05" 'carries traces'

# --- a repository of the Silent project with no commits yet --------------------------------------
# `git add -A && git commit` asks for `--diff HEAD`, and there is no HEAD: the check compares with the empty
# tree instead of failing, so the first commit is not refused for good.
expect "silent, no commits yet: git add -A && git commit, nothing to find -> allow" allow "$NR" 'git add -A && git commit -m init'
echo 'Follows ADR-0042' >"$NR/notes.md"; git -C "$NR" add notes.md
expect "silent, no commits yet: git add -A && git commit with a staged trace -> deny with the trace" deny "$NR" \
    'git add -A && git commit -m init' 'ADR-0042'
got="$(guard "$NR" 'git add -A && git commit -m init')"
[[ "$got" == *"carries traces"* ]] && ok "silent, no commits yet: the refusal is about traces, not a failed check" || bad "silent, no commits yet: ${got:0:300}"
# The index is clean and the trace is only in the working tree: only the comparison with the empty tree sees it.
git -C "$NR" rm -q --cached notes.md && rm "$NR/notes.md" && git -C "$NR" add b.ts && echo '// Follows ADR-0042' >>"$NR/b.ts"
expect "silent, no commits yet: git commit -a, the trace only in the working tree -> deny with the trace" deny "$NR" \
    'git commit -am init' 'ADR-0042'

# --- the real check with a broken profile.json: the one failure that lets the command through ----------
printf '{"schema":2,' >"$SPP"
expect "silent, the real check, profile.json broken -> allow" allow "$R" 'git commit -m "Fix the button, Ticket 05"'
cp "$T/sp-profile.json" "$SPP"

# --- the check does not answer in time, fails or answers an unknown code ---------------------------
# A stand-in for bin/silent-check (CLAUDE_SILENT_CHECK_BIN): each call appends a line to $STUB_LOG and takes
# the next step of $STUB_PLAN (the last step repeats): `sleep` — hangs until the guard stops it; `traces` —
# exit 1 with a finding; `profile` / `root` — exit 2 with the reason bin/silent-check gives when the profile or
# the tickets root is not read; `kill` — killed by a signal; `many` — exit 1 with 120 findings; a number —
# that exit code, nothing printed.
# One try lasts $TRY_MS here. Where only timeouts happen, 0.5 s is enough: the stand-in that hangs sleeps far
# longer than any try, and each such try is waited out in full. Such a case checks only what the guard prints,
# never the stand-in's log, so its result does not depend on how fast the stand-in starts. Where a stand-in must answer inside a try, a try lasts 5 s, so a node start on a loaded machine never
# runs out of it; where a timeout comes first and the retry must answer, 3 s (each case waits out one try or
# two). The default try is checked once, at the end of the section.
STUB="$T/silent-check-stub.cjs"
cat >"$STUB" <<'EOF'
const fs = require("node:fs")
const log = process.env.STUB_LOG
const n = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0
fs.appendFileSync(log, `call ${Date.now()}\n`)
const plan = (process.env.STUB_PLAN || "0").split(",")
const step = plan[Math.min(n, plan.length - 1)]
if (step === "sleep") {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120000)
    process.exit(0)
}
if (step === "traces") {
    process.stdout.write('stdin:1: ticket number "Ticket 05"\n')
    process.exit(1)
}
if (step === "profile") {
    process.stderr.write("silent-check: profile not read (exit 1): profile.json: unexpected end of JSON input\n")
    process.exit(2)
}
if (step === "root") {
    process.stderr.write("silent-check: tickets root not read (exit 1): ticket: no tickets root\n")
    process.exit(2)
}
if (step === "kill") process.kill(process.pid, "SIGKILL")
if (step === "many") {
    for (let i = 1; i <= 120; i++) process.stdout.write(`stdin:${i}: marker "item ${i}"\n`)
    process.exit(1)
}
process.exit(Number(step))
EOF
TRY_MS=500
# The time in ms. Bash 5 has the clock built in (EPOCHREALTIME, in seconds with a dot under LANG=C.UTF-8); an
# older bash asks node, whose start (up to seconds on a loaded Windows runner) then counts in what is measured.
now_ms() {
    if [[ "${EPOCHREALTIME:-}" =~ ^([0-9]+)[.,]([0-9]{3}) ]]; then echo "${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
    else node -e 'process.stdout.write(String(Date.now()))'; fi
}
# When the stand-in was first called, in ms (the line `call <ms>` it writes), else $1.
first_call_ms() { local at; at="$(awk 'NR == 1 { print $2 }' "$STUB_LOG" 2>/dev/null)"; [[ "$at" =~ ^[0-9]+$ ]] && echo "$at" || echo "$1"; }
calls() { [ -f "$STUB_LOG" ] && grep -c . "$STUB_LOG" || echo 0; }
use_stub() { # <plan>
    export STUB_LOG="$T/stub-$RANDOM-$RANDOM.log" STUB_PLAN="$1" CLAUDE_SILENT_CHECK_BIN="$STUB" CLAUDE_SILENT_CHECK_TIMEOUT_MS="$TRY_MS"
}
no_stub() { unset STUB_LOG STUB_PLAN CLAUDE_SILENT_CHECK_BIN CLAUDE_SILENT_CHECK_TIMEOUT_MS; }
# stub <plan> <description> <allow|deny> <command> [substring of the reason] [calls wanted]
stub() {
    use_stub "$1"
    expect "$2" "$3" "$R" "$4" "${5:-}"
    if [ -n "${6:-}" ]; then
        local n; n="$(calls)"
        [ "$n" = "$6" ] && ok "$2: silent-check called $6 time(s)" || bad "$2: silent-check called $n time(s), want $6"
    fi
    no_stub
}
CLEAN='git commit -m "Fix the withdraw button state"'
# The tries are counted from the refusal, which names the length of each try, not from the stand-in's log: a
# stand-in that starts slower than a 0.5 s try is killed before it writes its log line.
stub sleep "timeout twice -> deny with the reason" deny "$CLEAN" 'did not finish'
TRY_S="$((TRY_MS / 1000)).$((TRY_MS % 1000 / 100)) s"
[[ "$got" == *"did not finish in $TRY_S and then $TRY_S,"* ]] && ok "timeout twice: the refusal names two tries of $TRY_S" \
    || bad "timeout twice: the refusal does not name two tries of $TRY_S: ${got:0:400}"
for want in '`git commit` was not run' 'Run the same command again' 'silent-check -C '; do
    [[ "$got" == *"$want"* ]] && ok "timeout twice: the refusal says: $want" || bad "timeout twice: no \"$want\" in: ${got:0:400}"
done
[[ "$got" != *"carries traces of the workflow"* ]] && ok "timeout twice: the refusal does not claim traces" || bad "timeout twice claims traces: ${got:0:300}"
TRY_MS=5000
stub profile "exit 2, the profile is not read -> allow, as before" allow "$CLEAN" '' 1
stub root "exit 2, the tickets root is not read -> deny with the error" deny "$CLEAN" 'tickets root not read'
stub 3 "an unknown exit code -> deny with the reason" deny "$CLEAN" 'exit 3'
stub 3 "a failure on a PR text: the refusal names gh pr create" deny 'gh pr create --title "Fix" --body "Keeps state"' '`gh pr create` was not run'
stub 1 "exit 1 with nothing found printed (a crash) -> deny as a failure, not as traces" deny "$CLEAN" 'failed (exit 1)'
# The stand-in exits without reading its stdin. A text larger than a pipe buffer cannot be written in full, so
# the write gets EPIPE every time, not only when the exit wins a race with a small write; the exit code is
# still the verdict.
node -e 'process.stdout.write("Fix the withdraw button state.\n".repeat(32768))' >"$T/big-msg.txt"
BIG="git commit -F $T/big-msg.txt"
stub 3 "a text the check does not read, unknown exit code -> deny with exit 3, not EPIPE" deny "$BIG" 'failed (exit 3)'
[[ "$got" != *EPIPE* && "$got" != *"(EOF"* ]] && ok "a text the check does not read: the refusal names neither EPIPE nor EOF" \
    || bad "a text the check does not read names the write error: ${got:0:300}"
stub 0 "a text the check does not read, exit 0 -> allow" allow "$BIG" '' 1
# The same write error as each platform reports it, on every platform: EPIPE on macOS and Linux, EOF on Windows
# (libuv's name for ERROR_BROKEN_PIPE). A preloaded script replaces spawnSync in the guard's process, for the
# silent-check call only, with a result of FAKE_SPAWN="<error code>:<exit code>|<signal>|null".
FAKE="$T/fake-spawn.cjs"
cat >"$FAKE" <<'EOF'
const cp = require("node:child_process")
const real = cp.spawnSync
cp.spawnSync = (cmd, args, opts) => {
    if (!Array.isArray(args) || args[0] !== process.env.CLAUDE_SILENT_CHECK_BIN) return real(cmd, args, opts)
    const [code, end] = process.env.FAKE_SPAWN.split(":")
    const status = /^\d+$/.test(end) ? Number(end) : null
    const signal = /^SIG/.test(end) ? end : null
    const error = Object.assign(new Error(`spawnSync ${cmd} ${code}`), { code, syscall: "spawnSync " + cmd })
    return { pid: 1, output: [null, "", ""], stdout: "", stderr: "", status, signal, error }
}
require("node:module").syncBuiltinESMExports()
EOF
fake() { # <error code>:<end> <description> <allow|deny> [substring of the reason]
    got="$(jq -n --arg c "$CLEAN" --arg d "$R" '{tool_name: "Bash", tool_input: {command: $c}, cwd: $d}' \
        | CLAUDE_SILENT_CHECK_BIN="$STUB" FAKE_SPAWN="$1" node --require "$FAKE" "$GUARD")"
    if [ -z "$got" ]; then got=allow; else got="deny: $(printf '%s' "$got" | jq -r '.hookSpecificOutput.permissionDecisionReason')"; fi
    if [[ "$got" == "$3"* ]] && { [ -z "${4:-}" ] || [[ "$got" == *"$4"* ]]; }; then ok "$2"
    else bad "$2: want $3${4:+ ($4)}, got: ${got:0:400}"; fi
}
fake EOF:0 "EOF (Windows) with exit 0 -> allow" allow
fake EOF:3 "EOF (Windows) with exit 3 -> deny with exit 3" deny 'failed (exit 3)'
fake EOF:SIGKILL "EOF (Windows) with a signal -> deny with the signal" deny 'signal SIGKILL'
fake EOF:null "EOF with no exit code and no signal -> deny with the error" deny 'failed (EOF: '
fake EPIPE:0 "EPIPE (macOS, Linux) with exit 0 -> allow" allow
fake EPIPE:null "EPIPE with no exit code and no signal -> deny with the error" deny 'failed (EPIPE: '
fake ENOENT:0 "another error with exit 0 -> deny with the error" deny 'failed (ENOENT: '
case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) stub kill "killed by a signal -> deny" deny "$CLEAN" 'was not run' ;; # no POSIX signals
    *)
        stub kill "killed by a signal -> deny with the signal" deny "$CLEAN" 'signal SIGKILL'
        stub kill "a text the check does not read, killed by a signal -> deny with the signal" deny "$BIG" 'signal SIGKILL'
        ;;
esac
stub 0 "exit 0 -> allow at once, one call" allow "$CLEAN" '' 1
stub many "120 findings -> the refusal shows 50 and counts the rest" deny "$CLEAN" '… 70 more lines'
[[ "$got" == *'"item 50"'* && "$got" != *'"item 51"'* ]] && ok "120 findings: lines after the 50th are left out" \
    || bad "120 findings: the cap does not hold: ${got: -300}"
export CLAUDE_SILENT_CHECK_BIN="$T/no-such-silent-check"
expect "silent-check does not exist -> deny with the reason" deny "$R" "$CLEAN" 'could not start'
unset CLAUDE_SILENT_CHECK_BIN

TRY_MS=3000
stub sleep,0 "timeout, then the retry answers 0 -> allow" allow "$CLEAN" '' 2
stub sleep,traces "timeout, then the retry finds traces -> deny with the traces" deny "$CLEAN" 'ticket number "Ticket 05"' 2
# Two checks in one command share the budget of two tries: the first check uses a try and its retry, the
# second gets only what is left of the budget, and no retry of its own.
use_stub sleep,0,sleep
# Counted from the stand-in's first start, not from before the hook: the hook's own node start and jq are not part
# of the budget, and on a loaded Windows runner they took the 1.5 s to spare (FLAKY 4 times there, 2026-10-29).
# The error this accepts: the hook's budget starts before it spawns the first stand-in (`deadline` in guard.mjs),
# and the stand-in writes its time only after its own node start, so that start drops out of what is measured too.
# A hook past its budget by less than one node start would pass. The fault this case is for, a second check with a
# try of its own, adds a whole try (3 s) and stays red. The limit is the same as before; a mutant in review was red
# by only 20-30 ms on the Mac, so a change here should be checked against one.
t0="$(now_ms)"; got="$(guard "$R" 'git checkout -b fix/x && git commit -m "Fix y"')"; t1="$(now_ms)"
t0="$(first_call_ms "$t0")"; n="$(calls)"; no_stub
elapsed=$((t1 - t0))
[[ "$got" == deny*'`git commit` was not run'*"did not finish"* ]] && ok "two checks, one budget: the second check runs out of it -> deny" \
    || bad "two checks, one budget: ${got:0:300}"
[ "$n" = 3 ] && ok "two checks, one budget: silent-check called 3 times" || bad "two checks, one budget: silent-check called $n times, want 3"
[ "$elapsed" -lt $((2 * TRY_MS + TRY_MS / 2)) ] && ok "two checks, one budget: the hook ends within two tries ($elapsed ms)" \
    || bad "two checks, one budget: $elapsed ms, want less than $((2 * TRY_MS + TRY_MS / 2))"

# A Full project with attribution on: the real bin/silent-check behind a counting wrapper answers 0 at once —
# one call, no retry.
REAL_CHECK="$HARNESS/bin/silent-check"
command -v cygpath >/dev/null 2>&1 && REAL_CHECK="$(cygpath -m "$REAL_CHECK")"
cat >"$T/count-real.cjs" <<EOF
require("node:fs").appendFileSync(process.env.STUB_LOG, "call\n")
require("$REAL_CHECK")
EOF
export STUB_LOG="$T/count-real.log" CLAUDE_SILENT_CHECK_BIN="$T/count-real.cjs"
expect "full, attribution on: a commit with Ticket 05 -> allow through the real check" allow "$FR" 'git commit -m "Fix the button, Ticket 05"'
n="$(calls)"; [ "$n" = 1 ] && ok "full, attribution on: the real check is called once" || bad "full, attribution on: the real check called $n times"
unset STUB_LOG CLAUDE_SILENT_CHECK_BIN

# The default tries, both timing out: the whole hook ends within its own limit in hooks.json, otherwise Claude
# Code would stop the hook and run the command unchecked.
LIMIT_S="$(jq -r '.hooks.PreToolUse[] | .hooks[] | select(.command | test("guard\\.mjs")) | .timeout' "$HOOKS/hooks.json")"
export STUB_LOG="$T/limit.log" STUB_PLAN=sleep CLAUDE_SILENT_CHECK_BIN="$STUB"
t0="$(now_ms)"; got="$(guard "$R" "$CLEAN")"; t1="$(now_ms)"
unset STUB_LOG STUB_PLAN CLAUDE_SILENT_CHECK_BIN
elapsed=$((t1 - t0))
echo "     the hook with two default timeouts took $elapsed ms; its limit in hooks.json is ${LIMIT_S} s"
[[ "$got" == deny*"did not finish"* ]] && ok "default tries, both time out -> deny" || bad "default tries, both time out: ${got:0:300}"
[[ "$LIMIT_S" =~ ^[0-9]+$ ]] && [ "$elapsed" -lt $((LIMIT_S * 1000)) ] && ok "default tries, both time out: the hook ends within its limit" \
    || bad "default tries, both time out: $elapsed ms against a limit of '$LIMIT_S' s"

# --- the real home -----------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
