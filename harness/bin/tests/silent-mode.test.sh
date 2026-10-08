#!/usr/bin/env bash
# Tests of Silent mode in the Harness scripts (worfy-harness ticket 22): a Silent project keeps its
# workflow files (tickets, the epic spec, the state file, ADRs) in a Workflow folder outside git, and
# its branches, commits and PRs carry no trace of the workflow.
#   - ticket claim --branch writes Status and Branch into the ticket in the Workflow folder, from any
#     worktree of the repository, and the repository stays clean;
#   - epic-status --json gives branch and repo of every ticket; --ref in Silent mode is exit 3;
#   - bin/silent-check finds every kind of trace, passes clean text and a clean diff, checks nothing
#     in a Full project;
#   - a worktree outside the repository (<HARNESS_HOME>/worktrees/<project>/05) is recognised by
#     profile, gate.sh and worktree-lock;
#   - the local finish of local-green (the block cut out of the ship-ticket skill) merges the ticket
#     branch into main of a temporary repository.
# Run: bash harness/bin/tests/silent-mode.test.sh; exit code 0 means everything passed.
#
# Everything lives in a temporary directory: HOME, HARNESS_HOME (registry and profiles),
# CLAUDE_CONFIG_DIR, the Workflow folder, the repository and its bare origin. At the end the test
# compares the real ~/.claude (the Harness parts) and ~/.claude/worfy-harness with a snapshot taken
# before the run.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
SKILLS="$HARNESS/skills"
REAL_HOME="$HOME"
. "$(dirname "$0")/real-home.sh"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

# --- sandbox -------------------------------------------------------------------------
export HOME="$T/home" HARNESS_HOME="$T/hh" CLAUDE_CONFIG_DIR="$T/claude-config"
unset CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR CLAUDE_PROFILE_BIN CLAUDE_TICKET_BIN CLAUDE_SESSION_ID CLAUDE_CODE_SESSION_ID GATE_SCOPE
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$HARNESS_HOME/gate" "$HARNESS_HOME/projects/sp" "$HARNESS_HOME/projects/fp"

WF="$T/wf"                     # the Workflow folder of the Silent project sp, a local git repository
R="$T/repo"                    # the repository of sp
FR="$T/full"                   # the repository of the Full project fp
git init -q --bare -b main "$T/origin.git"
git init -q -b main "$R"
printf 'node_modules\n' >"$R/.gitignore"; echo 'export const x = 1' >"$R/x.ts"
echo '{ "name": "sp", "scripts": { "check": "true" } }' >"$R/package.json"
git -C "$R" add -A && git -C "$R" commit -q -m init
git -C "$R" remote add origin "$T/origin.git" && git -C "$R" push -q origin main 2>/dev/null && git -C "$R" fetch -q origin
git init -q -b main "$FR" && git -C "$FR" commit -q --allow-empty -m init

mkdir -p "$WF/.scratch/checkout-flow/issues" "$WF/docs/adr"
printf '# 05 — Withdraw button\n\nType: task\nStatus: open\nBlocked by: —\n\n## What\n\ntext\n' >"$WF/.scratch/checkout-flow/issues/05-withdraw.md"
printf '# 06 — Second\n\nStatus: open\nRepo: repo\nBlocked by: 05\n' >"$WF/.scratch/checkout-flow/issues/06-second.md"
git -C "$WF" init -q -b main && git -C "$WF" add -A && git -C "$WF" commit -q -m init

# The gate runs "$PM run check"; this pm needs no npm.
PM="$T/fakepm"; printf '#!/bin/sh\nexit 0\n' >"$PM"; chmod +x "$PM"
cat >"$HARNESS_HOME/gate/config.json" <<EOF
{"repos":[
 {"key":"sp","match":"$R","profile":"sp","pm":"$PM","root":{"fast":["check"]},"workspace":{}},
 {"key":"fp","match":"$FR","profile":"fp","pm":"npm","root":{},"workspace":{}}
]}
EOF
cat >"$HARNESS_HOME/projects/sp/profile.json" <<EOF
{"schema":2,"name":"sp","mode":"silent","attribution":"off",
 "workflow":{"folder":"$WF","finish":"local-green"},
 "tickets":{"root":".scratch/","path":".scratch/<эпик>/issues/NN-*.md","branch":null},
 "worktree":{"root":"$HARNESS_HOME/worktrees/sp/","base":"main",
   "implementer":"git worktree add -b <ветка> $HARNESS_HOME/worktrees/sp/<NN> main"},
 "docs":{"adr_dir":"docs/adr","handoff":{"path":"HANDOFF.md"}},
 "numbering":{"adr":{"dir":"docs/adr","check":null},"migrations":null}}
EOF
printf '{"schema":2,"name":"fp","mode":"full","attribution":"on","tickets":{"root":".scratch/"}}\n' >"$HARNESS_HOME/projects/fp/profile.json"

# --- 1. ticket claim --branch writes into the Workflow folder ---------------------------
out="$(cd "$R" && "$BIN/ticket" claim checkout-flow 05 --branch fix/x 2>&1)"; rc=$?
f="$WF/.scratch/checkout-flow/issues/05-withdraw.md"
if [ "$rc" -eq 0 ] && grep -q "^Status: claimed — $(date -u +%F)" "$f" && grep -qx 'Branch: fix/x' "$f"; then
    ok "ticket claim --branch from the repository writes Status and Branch into the Workflow folder"
else
    bad "ticket claim --branch: exit $rc, out: ${out:0:300}; file: $(tr '\n' '|' <"$f")"
fi
[ -z "$(git -C "$R" status --porcelain)" ] && [ ! -e "$R/.scratch" ] \
    && ok "claim leaves the repository clean" || bad "claim touched the repository: $(git -C "$R" status --porcelain)"

# A worktree of the repository: the status still goes into the one ticket file in the Workflow folder.
git -C "$R" worktree add -q -b fix/other "$T/side" main 2>/dev/null
out="$(cd "$T/side" && "$BIN/ticket" claim checkout-flow/06 --branch fix/other --repo repo 2>&1)"; rc=$?
f6="$WF/.scratch/checkout-flow/issues/06-second.md"
[ "$rc" -eq 0 ] && grep -qx 'Branch: fix/other' "$f6" && [ "$(grep -c '^Repo:' "$f6")" -eq 1 ] && [ ! -e "$T/side/.scratch" ] \
    && ok "claim from another worktree writes the same Workflow folder; an existing Repo: line is kept once" \
    || bad "claim from a worktree: exit $rc, out: ${out:0:300}; file: $(tr '\n' '|' <"$f6")"
out="$(cd "$R" && "$BIN/ticket" claim checkout-flow 06 --repo nope 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *'"nope" is not a repository of the project (repo)'* ]] \
    && ok "claim --repo with a name outside _resolved.repos is refused" || bad "claim --repo nope: exit $rc, out: ${out:0:200}"
out="$(cd "$R" && "$BIN/ticket" claim checkout-flow 05 --branch 'bad name..' 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"not a valid branch name"* ]] && ok "claim --branch with an invalid name is refused" \
    || bad "claim --branch invalid: exit $rc, out: ${out:0:200}"
out="$(cd "$R" && "$BIN/ticket" block checkout-flow 05 --branch x why 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"--branch goes only with claim"* ]] && ok "--branch with block is refused" || bad "block --branch: exit $rc, out: ${out:0:200}"

# --- 2. epic-status: branch and repo; --ref is exit 3 --------------------------------------
js="$(cd "$R" && "$BIN/epic-status" --json 2>&1)"; rc=$?
got="$(printf '%s' "$js" | jq -c '[.tickets[] | {num, branch, repo}]' 2>&1)"
[ "$rc" -eq 0 ] && [ "$got" = '[{"num":5,"branch":"fix/x","repo":null},{"num":6,"branch":"fix/other","repo":"repo"}]' ] \
    && ok "epic-status --json gives branch and repo (null without the line)" || bad "epic-status branch/repo: exit $rc, got: ${got:0:300}"
err="$(cd "$R" && "$BIN/epic-status" --json --ref main 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 3 ] && [[ "$err" == *"in Silent mode the status does not live in branches"* ]] \
    && ok "epic-status --json --ref in Silent mode -> exit 3 with the reason" || bad "epic-status --ref silent: exit $rc, err: ${err:0:200}"
err="$(cd "$FR" && "$BIN/epic-status" --json --ref main 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && ok "epic-status --json --ref in a Full project works as before" || bad "epic-status --ref full: exit $rc, err: ${err:0:200}"
out="$(cd "$R" && "$BIN/epic-board" --no-open --out "$T/board.html" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && grep -q 'base <b>Workflow folder</b>' "$T/board.html" && grep -q 'Withdraw button' "$T/board.html" \
    && ok "epic-board in Silent mode reads the Workflow folder alone" || bad "epic-board silent: exit $rc, out: ${out:0:300}"

# --- 3. silent-check ------------------------------------------------------------------------
SC="$BIN/silent-check"
for t in "fix the checkout-flow screen" "checkout-flow/05" "per ADR-0042" "Ticket 05 done" "Ticket-05" \
         "see $WF/HANDOFF" "notes in .scratch/x" "update HANDOFF" "Co-Authored-By: Claude Opus <noreply@anthropic.com>" \
         "Generated with [Claude Code](https://claude.com/claude-code)"; do
    out="$("$SC" -C "$R" "$t" 2>&1)"; rc=$?
    [ "$rc" -eq 1 ] && ok "silent-check finds a trace in \"$t\"" || bad "silent-check \"$t\": exit $rc, out: ${out:0:200}"
done
out="$("$SC" -C "$R" "checkout-flow/05" 2>&1)"
[[ "$out" == *'epic/NN "checkout-flow/05"'* && "$out" != *"epic name"* ]] && ok "silent-check names <epic>/<NN> once, not also as an epic name" \
    || bad "silent-check epic/NN: $out"
out="$("$SC" -C "$R" "Fix the withdraw button state after a failed request" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "silent-check passes clean text" || bad "silent-check clean text: exit $rc, out: ${out:0:200}"
out="$(printf 'Fix it\n\nTicket 7\n' | "$SC" -C "$R" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"stdin:3: ticket number"* ]] && ok "silent-check reads stdin and names the line" || bad "silent-check stdin: exit $rc, out: $out"
echo "export const route = '/checkout-flow'" >"$R/y.ts"; git -C "$R" add y.ts
out="$("$SC" -C "$R" --cached 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "silent-check passes a clean index (a bare epic word in code is not a trace)" || bad "silent-check clean diff: exit $rc, out: ${out:0:200}"
mkdir -p "$R/.scratch/checkout-flow"; echo '// see ADR-0042' >"$R/z.ts"; echo x >"$R/.scratch/checkout-flow/n.md"; git -C "$R" add -f z.ts .scratch
out="$("$SC" -C "$R" --cached 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *'index z.ts:1: ADR number'* ]] && [[ "$out" == *'index file names .scratch/checkout-flow/n.md: .scratch'* ]] \
    && ok "silent-check finds traces in the added lines and file names of the index" || bad "silent-check dirty index: exit $rc, out: ${out:0:300}"
git -C "$R" commit -q -m "add y" && out="$("$SC" -C "$R" --diff HEAD~1 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *'diff HEAD~1 z.ts:1: ADR number'* ]] && ok "silent-check --diff <rev> reads the commits since rev" || bad "silent-check --diff: exit $rc, out: ${out:0:300}"
git -C "$R" reset -q --soft HEAD~1 && git -C "$R" rm -rq --cached z.ts .scratch y.ts && rm -rf "$R/.scratch" "$R/z.ts" "$R/y.ts"
out="$("$SC" -C "$FR" "Ticket 05, ADR-0042, .scratch/, HANDOFF, Co-Authored-By: Claude" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [[ "$out" == *"Full mode, attribution on"* ]] && ok "silent-check in a Full project with attribution on checks nothing" \
    || bad "silent-check full: exit $rc, out: ${out:0:200}"
out="$("$SC" -C "$WF" "Ticket 05" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "silent-check in the Workflow folder (not a project repository) checks nothing" || bad "silent-check in WF: exit $rc, out: ${out:0:200}"
printf '{"schema":2,"name":"fp","mode":"full","attribution":"off"}\n' >"$HARNESS_HOME/projects/fp/profile.json"
out="$("$SC" -C "$FR" "Ticket 05 and HANDOFF" 2>&1)"; rc1=$?
out2="$("$SC" -C "$FR" $'Fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>' 2>&1)"; rc2=$?
[ "$rc1" -eq 0 ] && [ "$rc2" -eq 1 ] && ok "Full project with attribution off: only attribution lines are traces" || bad "full attribution off: $rc1/$rc2 $out $out2"
printf '{"schema":2,"name":"fp","mode":"full","attribution":"on","tickets":{"root":".scratch/"}}\n' >"$HARNESS_HOME/projects/fp/profile.json"

# --- 4. A worktree outside the repository ----------------------------------------------------
WT="$HARNESS_HOME/worktrees/sp/05"
mkdir -p "$HARNESS_HOME/worktrees/sp"
git -C "$R" worktree add -q -b fix/y "$WT" main 2>/dev/null
out="$("$BIN/profile" -C "$WT" --name 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$out" = sp ] && ok "profile -C <tree outside the repository> -> exit 0, the same profile" || bad "profile outside tree: exit $rc, out: $out"
got="$("$BIN/profile" -C "$WT" --field _resolved.in_worktree 2>&1)"
[ "$got" = true ] && ok "the outside tree is a worktree of the repository" || bad "in_worktree: $got"
out="$(cd "$WT" && GATE_SCOPE=all bash "$HOOKS/gate.sh" fast </dev/null 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [[ "$out" == *"[gate] зелено"* ]] && ls "$HARNESS_HOME/gate/state"/verdict-*.json >/dev/null 2>&1 \
    && ok "gate.sh fast in the outside tree finds the registry entry, green, state in HARNESS_HOME" || bad "gate outside tree: exit $rc, out: ${out:0:300}"
printf '{"session_id":"s-22","cwd":"%s"}' "$WT" | "$BIN/worktree-lock" claim >/dev/null 2>&1
grep -lq "s-22" "$HARNESS_HOME"/worktree-sessions/*.json 2>/dev/null \
    && ok "worktree-lock claim in the outside tree writes the lock into HARNESS_HOME" || bad "worktree-lock: $(ls "$HARNESS_HOME" 2>&1)"

# --- 5. The local finish (local-green): the block of ship-ticket, step 11 ----------------------
# The block is cut out of the skill and run under bash and under zsh; each run merges its own branch.
block() { # $1 skill file, $2 a string that identifies the ```bash block
    awk -v m="$2" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$1"
}
FIN="$(block "$SKILLS/ship-ticket/SKILL.md" 'MERGED=')"
[ -n "$FIN" ] || bad "the local finish block (MERGED=) is not in ship-ticket/SKILL.md"
for sh in bash zsh; do
    b="fix/finish-$sh"
    git -C "$R" worktree add -q -b "$b" "$T/wt-$sh" main 2>/dev/null
    echo "$sh" >"$T/wt-$sh/$sh.txt"; git -C "$T/wt-$sh" add -A && git -C "$T/wt-$sh" commit -q -m "add $sh"
    code="${FIN//<repo>/$R}"; code="${code//<ticket branch>/$b}"
    out="$(cd "$R" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$code" 2>&1)"
    if [[ "$out" == *"MERGED=0"* ]] && git -C "$R" merge-base --is-ancestor "$b" main && [ -f "$R/$sh.txt" ]; then
        ok "$sh: the local finish block fast-forwards main to the ticket branch"
    else bad "$sh: local finish: out: ${out:0:300}"; fi
done
# A branch that is not on top of main is not merged.
git -C "$R" worktree add -q -b fix/stale "$T/wt-stale" main~2 2>/dev/null
echo s >"$T/wt-stale/s.txt"; git -C "$T/wt-stale" add -A && git -C "$T/wt-stale" commit -q -m stale
code="${FIN//<repo>/$R}"; code="${code//<ticket branch>/fix/stale}"
out="$(cd "$R" && CLAUDE_PLUGIN_ROOT="$HARNESS" bash -c "$code" 2>&1)"
[[ "$out" == *"NOT ON TOP"* && "$out" == *"MERGED=1"* ]] && ! git -C "$R" merge-base --is-ancestor fix/stale main \
    && ok "a branch not on top of main is not merged (NOT ON TOP, MERGED=1)" || bad "stale branch: ${out:0:300}"
# main checked out nowhere: the block moves the branch ref.
git -C "$R" checkout -q --detach
git -C "$R" worktree add -q -b fix/detached "$T/wt-det" main 2>/dev/null
echo d >"$T/wt-det/d.txt"; git -C "$T/wt-det" add -A && git -C "$T/wt-det" commit -q -m det
code="${FIN//<repo>/$R}"; code="${code//<ticket branch>/fix/detached}"
out="$(cd "$R" && CLAUDE_PLUGIN_ROOT="$HARNESS" bash -c "$code" 2>&1)"
[[ "$out" == *"MERGED=0"* ]] && git -C "$R" merge-base --is-ancestor fix/detached main \
    && ok "main checked out nowhere: the block moves main to the branch" || bad "detached main: ${out:0:300}"
git -C "$R" checkout -q main
# parallel: single (the main checkout is on the ticket branch) and no worktree.base — Atakama's settings. The main
# branch is not the checkout's HEAD: from origin/HEAD, without it from the local main; the ticket branch itself
# as the main branch is refused.
P="$HARNESS_HOME/projects/sp/profile.json"; cp "$P" "$T/profile.saved"
jq '.worktree.base = null' "$T/profile.saved" >"$P"
single() { # <branch> → the block's output, run from the main checkout standing on <branch>
    git -C "$R" checkout -q -b "$1" main && echo "$1" >"$R/$(echo "$1" | tr / -).txt" && git -C "$R" add -A && git -C "$R" commit -q -m "add $1"
    local code="${FIN//<repo>/$R}"; code="${code//<ticket branch>/$1}"
    (cd "$R" && CLAUDE_PLUGIN_ROOT="$HARNESS" bash -c "$code" 2>&1)
}
git -C "$R" remote set-head origin main >/dev/null 2>&1
out="$(single fix/single)"
[[ "$out" == *"MERGED=0"* ]] && git -C "$R" merge-base --is-ancestor fix/single main && [ "$(git -C "$R" branch --show-current)" = fix/single ] \
    && ok "single, worktree.base null: main comes from origin/HEAD, not from the checkout's HEAD, and is fast-forwarded" \
    || bad "single + base null (origin/HEAD): ${out:0:300}; main has fix/single: $(git -C "$R" merge-base --is-ancestor fix/single main && echo yes || echo no)"
git -C "$R" checkout -q main
git -C "$R" remote set-head origin -d >/dev/null 2>&1; git -C "$R" config remote.origin.followRemoteHEAD never
out="$(single fix/single2)"
[[ "$out" == *"MERGED=0"* ]] && git -C "$R" merge-base --is-ancestor fix/single2 main \
    && ok "single, worktree.base null, no origin/HEAD: the local main is the main branch" || bad "single + base null (no origin/HEAD): ${out:0:300}"
git -C "$R" checkout -q main
git -C "$R" branch trunk main
jq '.worktree.base = null | .layout.repos = {"repo": {"default_branch": "trunk"}}' "$T/profile.saved" >"$P"
main_before="$(git -C "$R" rev-parse main)"
out="$(single fix/single3)"
[[ "$out" == *"MERGED=0"* ]] && git -C "$R" merge-base --is-ancestor fix/single3 trunk && [ "$(git -C "$R" rev-parse main)" = "$main_before" ] \
    && ok "worktree.base null: default_branch of layout.repos comes before origin/HEAD and main" || bad "layout.repos default_branch: ${out:0:300}"
git -C "$R" checkout -q main
jq '.worktree.base = "fix/same"' "$T/profile.saved" >"$P"
out="$(single fix/same)"
[[ "$out" == *"SAME BRANCH"* && "$out" == *"MERGED=1"* ]] && ok "the ticket branch as the main branch is refused (SAME BRANCH, MERGED=1)" || bad "M == B: ${out:0:300}"
git -C "$R" checkout -q main
cp "$T/profile.saved" "$P"
out="$(cd "$R" && "$BIN/ticket" done checkout-flow 05 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && grep -qx "Status: done — $(date -u +%F)" "$f" && ok "ticket done without --pr writes Status: done with no PR" \
    || bad "ticket done: exit $rc, out: ${out:0:200}"
[ -z "$(git -C "$R" status --porcelain)" ] && ok "the repository has no workflow files after the run" || bad "repository dirty: $(git -C "$R" status --porcelain)"

# --- the real home -----------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
