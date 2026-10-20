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

R="$T/repo"; FR="$T/full"; WF="$T/wf"
for r in "$R" "$FR"; do
    git init -q -b main "$r" && echo 'export const a = 1' >"$r/a.ts" && git -C "$r" add -A && git -C "$r" commit -q -m init
done
mkdir -p "$WF/.scratch/checkout-flow/issues"
printf '# 05 — x\n\nStatus: open\n' >"$WF/.scratch/checkout-flow/issues/05-x.md"
git -C "$WF" init -q -b main && git -C "$WF" add -A && git -C "$WF" commit -q -m init
cat >"$HARNESS_HOME/gate/config.json" <<EOF
{"repos":[
 {"key":"sp","match":"$R","profile":"sp","pm":"npm","root":{},"workspace":{}},
 {"key":"fp","match":"$FR","profile":"fp","pm":"npm","root":{},"workspace":{}}
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
expect() { # <description> <allow|deny> <cwd> <command> [substring of the reason]
    local got; got="$(guard "$3" "$4")"
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

# --- the real home -----------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
