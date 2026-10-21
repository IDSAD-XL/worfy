#!/usr/bin/env bash
# Tests of Silent mode in the Harness scripts: a Silent project keeps its
# workflow files (tickets, the epic spec, the state file, ADRs) in a Workflow folder outside git, and
# its branches, commits and PRs carry no trace of the workflow.
#   - ticket claim --branch writes Status and Branch into the ticket in the Workflow folder, from any
#     worktree of the repository, and the repository stays clean;
#   - epic-status --json gives branch and repo of every ticket; --ref in Silent mode is exit 3;
#   - bin/silent-check finds every kind of trace, passes clean text and a clean diff, checks nothing
#     in a Full project;
#   - a worktree outside the repository (<HARNESS_HOME>/worktrees/<project>/05) is recognised by
#     profile, gate.mjs and worktree-lock; hooks/worktree-create.sh, kept unregistered as a draft, puts
#     a tree there with the profile's worktree.implementer template, and hooks.json does not register it;
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
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; the registry's
# `match` written with /tmp/… would match nothing node sees. Elsewhere there is no -W.
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

# --- sandbox -------------------------------------------------------------------------
# USERPROFILE with HOME: a Node script on Windows takes the home folder from it, not from HOME.
export HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$T/hh" CLAUDE_CONFIG_DIR="$T/claude-config"
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
# On Windows the file is a .cmd: node starts nothing else there without an interpreter.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
if [ "$WIN" -eq 1 ]; then PM="$T/fakepm.cmd"; printf '@echo off\r\nexit /b 0\r\n' >"$PM"
else PM="$T/fakepm"; printf '#!/bin/sh\nexit 0\n' >"$PM"; chmod +x "$PM"; fi
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
if [ "$rc" -eq 0 ] && grep -Eqx "Status: claimed $(date -u +%F)T[0-9]{2}:[0-9]{2}Z" "$f" && grep -qx 'Branch: fix/x' "$f"; then
    ok "ticket claim --branch from the repository writes Status and Branch into the Workflow folder"
else
    bad "ticket claim --branch: exit $rc, out: ${out:0:300}; file: $(tr '\n' '|' <"$f")"
fi
[ -z "$(git -C "$R" status --porcelain)" ] && [ ! -e "$R/.scratch" ] \
    && ok "claim leaves the repository clean" || bad "claim touched the repository: $(git -C "$R" status --porcelain)"

# ticket migrate from the repository moves the tickets of the Workflow folder, not of the repository.
mkdir -p "$WF/.scratch/migr/issues"
printf '# 01 — Old\n\nStatus: blocked — waits for the keys; Autopilot does not take it\nBlocked by: —\n' >"$WF/.scratch/migr/issues/01-old.md"
out="$(cd "$R" && "$BIN/ticket" migrate --epic migr 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(sed -n 3,4p "$WF/.scratch/migr/issues/01-old.md")" = "$(printf 'Status: blocked\nBlocked reason: waits for the keys; Autopilot does not take it')" ] \
   && [[ "$out" == *"blocked without Waits: 1"* ]] && [ -z "$(git -C "$R" status --porcelain)" ] && [ ! -e "$R/.scratch" ]; then
    ok "ticket migrate in Silent mode writes into the Workflow folder, the repository stays clean"
else bad "migrate in Silent mode: exit $rc, out: ${out:0:300}; file: $(tr '\n' '|' <"$WF/.scratch/migr/issues/01-old.md")"; fi
rm -r "$WF/.scratch/migr"

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
# The word "ticket" of another language comes from lib/input-words.json, with any ending of the word.
# On stdin, not as an argument: Git Bash on Windows may pass a non-ASCII argument to node in another code page.
for t in "Тикет 05 готов" "по тикету-05" "Тикета #5"; do
    out="$(printf '%s\n' "$t" | "$SC" -C "$R" 2>&1)"; rc=$?
    [ "$rc" -eq 1 ] && [[ "$out" == *"ticket number"* ]] && ok "silent-check finds the ticket number in \"$t\"" || bad "silent-check \"$t\": exit $rc, out: ${out:0:200}"
done
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
# A broken lib/input-words.json: a copy of silent-check next to it (profile and ticket of this Harness). The Full
# project is not affected; the Silent one is exit 2, which the Bash guard takes as a failed check and refuses.
BW="$T/broken-words"; mkdir -p "$BW/bin" "$BW/hooks" "$BW/lib"
cp "$BIN/silent-check" "$BW/bin/" && cp "$HOOKS/eval-env.cjs" "$BW/hooks/" && printf '{ "ticketWord": [\n' >"$BW/lib/input-words.json"
out="$(CLAUDE_PROFILE_BIN="$BIN/profile" CLAUDE_TICKET_BIN="$BIN/ticket" node "$BW/bin/silent-check" -C "$FR" "Ticket 05" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [[ "$out" == *"Full mode, attribution on"* ]] && ok "broken input words: a Full project still checks nothing, exit 0" \
    || bad "broken input words, Full: exit $rc, out: ${out:0:300}"
out="$(printf 'Fix it\n' | CLAUDE_PROFILE_BIN="$BIN/profile" CLAUDE_TICKET_BIN="$BIN/ticket" node "$BW/bin/silent-check" -C "$R" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$out" == *"input words not read (lib/input-words.json)"* ]] && ok "broken input words: a Silent project fails closed, exit 2 with the reason" \
    || bad "broken input words, Silent: exit $rc, out: ${out:0:300}"
out="$("$SC" -C "$WF" "Ticket 05" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "silent-check in the Workflow folder (not a project repository) checks nothing" || bad "silent-check in WF: exit $rc, out: ${out:0:200}"
# A Workflow folder under the home folder is also a trace in its ~/… spelling. WF above is not under
# HOME, so only this case reaches that form.
cp "$HARNESS_HOME/projects/sp/profile.json" "$T/sp-profile-wf.json"; mkdir -p "$HOME/hwf"
jq --arg f "$HOME/hwf" '.workflow.folder = $f' "$T/sp-profile-wf.json" >"$HARNESS_HOME/projects/sp/profile.json"
out="$("$SC" -C "$R" "see ~/hwf/notes.md" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *'Workflow folder path "~/hwf"'* ]] && ok "silent-check finds the ~/… spelling of a Workflow folder under HOME" \
    || bad "silent-check ~/ Workflow folder: exit $rc, out: ${out:0:200}"
cp "$T/sp-profile-wf.json" "$HARNESS_HOME/projects/sp/profile.json"
printf '{"schema":2,"name":"fp","mode":"full","attribution":"off"}\n' >"$HARNESS_HOME/projects/fp/profile.json"
out="$("$SC" -C "$FR" "Ticket 05 and HANDOFF" 2>&1)"; rc1=$?
out2="$("$SC" -C "$FR" $'Fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>' 2>&1)"; rc2=$?
[ "$rc1" -eq 0 ] && [ "$rc2" -eq 1 ] && ok "Full project with attribution off: only attribution lines are traces" || bad "full attribution off: $rc1/$rc2 $out $out2"
printf '{"schema":2,"name":"fp","mode":"full","attribution":"on","tickets":{"root":".scratch/"}}\n' >"$HARNESS_HOME/projects/fp/profile.json"

# The profile does not set `attribution`: the default follows the mode — off in Silent mode, on in Full
# mode — and a value written in the profile wins. silent-check reads the value bin/profile resolved.
SPP="$HARNESS_HOME/projects/sp/profile.json"; FPP="$HARNESS_HOME/projects/fp/profile.json"
cp "$SPP" "$T/sp-profile.json"; cp "$FPP" "$T/fp-profile.json"
ATTR_LINES=("Co-Authored-By: Claude Opus <noreply@anthropic.com>" "Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>" \
            "🤖 Generated with [Claude Code](https://claude.com/claude-code)" "Generated with Claude Code")
jq 'del(.attribution)' "$T/sp-profile.json" >"$SPP"
jq 'del(.attribution)' "$T/fp-profile.json" >"$FPP"
[ "$("$BIN/profile" -C "$R" --field attribution 2>&1)" = off ] && [ "$("$BIN/profile" -C "$FR" --field attribution 2>&1)" = on ] \
    && ok "attribution not set: profile resolves off in the Silent project and on in the Full one" \
    || bad "attribution default: sp=$("$BIN/profile" -C "$R" --field attribution 2>&1) fp=$("$BIN/profile" -C "$FR" --field attribution 2>&1)"
for t in "${ATTR_LINES[@]}"; do
    out="$("$SC" -C "$R" $'Fix the button\n\n'"$t" 2>&1)"; rc=$?
    [ "$rc" -eq 1 ] && [[ "$out" == *"text:3: Claude attribution"* ]] && ok "Silent project, attribution not set: \"$t\" is a trace" \
        || bad "silent, attribution not set, \"$t\": exit $rc, out: ${out:0:200}"
    out="$("$SC" -C "$FR" $'Fix the button\n\n'"$t" 2>&1)"; rc=$?
    [ "$rc" -eq 0 ] && [[ "$out" == *"Full mode, attribution on"* ]] && ok "Full project, attribution not set: \"$t\" passes" \
        || bad "full, attribution not set, \"$t\": exit $rc, out: ${out:0:200}"
done
out="$("$SC" -C "$R" "Fix the withdraw button state after a failed request" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "Silent project, attribution not set: clean text passes" || bad "silent, attribution not set, clean text: exit $rc, out: ${out:0:200}"
jq '.attribution = "on"' "$T/sp-profile.json" >"$SPP"
for t in "${ATTR_LINES[@]}"; do
    out="$("$SC" -C "$R" $'Fix the button\n\n'"$t" 2>&1)"; rc=$?
    [ "$rc" -eq 0 ] && ok "Silent project with an explicit attribution on: \"$t\" passes" || bad "silent, explicit on, \"$t\": exit $rc, out: ${out:0:200}"
done
out="$("$SC" -C "$R" $'Ticket 05\n\nCo-Authored-By: Claude <noreply@anthropic.com>' 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"ticket number"* && "$out" != *"Claude attribution"* ]] \
    && ok "Silent project with an explicit attribution on: the other traces are still found" || bad "silent, explicit on, ticket number: exit $rc, out: ${out:0:200}"
# `"attribution": null` is "not set". Any other value that is not "on" or "off" is a broken profile:
# silent-check does not answer "clean" for it (exit 2), where it used to pass the lines of a Silent project.
jq '.attribution = null' "$T/sp-profile.json" >"$SPP"
jq '.attribution = null' "$T/fp-profile.json" >"$FPP"
out="$("$SC" -C "$R" $'Fix the button\n\n'"${ATTR_LINES[1]}" 2>&1)"; rc1=$?
out2="$("$SC" -C "$FR" $'Fix the button\n\n'"${ATTR_LINES[1]}" 2>&1)"; rc2=$?
[ "$rc1" -eq 1 ] && [[ "$out" == *'Claude attribution "'* ]] && [ "$rc2" -eq 0 ] && ok "attribution null: the default of the mode (a trace in Silent, none in Full)" \
    || bad "attribution null: $rc1/$rc2 $out $out2"
for v in '""' '"OFF"' 0 false; do
    jq --argjson v "$v" '.attribution = $v' "$T/sp-profile.json" >"$SPP"
    out="$("$SC" -C "$R" $'Fix the button\n\n'"${ATTR_LINES[1]}" 2>&1)"; rc=$?
    [ "$rc" -eq 2 ] && [[ "$out" == *"profile not read (exit 1)"* && "$out" == *'"attribution" is "on" or "off"'* ]] \
        && ok "Silent project with attribution $v: silent-check does not call the text clean (exit 2, the reason)" \
        || bad "silent, attribution $v: exit $rc, out: ${out:0:300}"
done
cp "$T/sp-profile.json" "$SPP"; cp "$T/fp-profile.json" "$FPP"

# --- 4. A worktree outside the repository ----------------------------------------------------
WT="$HARNESS_HOME/worktrees/sp/05"
mkdir -p "$HARNESS_HOME/worktrees/sp"
git -C "$R" worktree add -q -b fix/y "$WT" main 2>/dev/null
out="$("$BIN/profile" -C "$WT" --name 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$out" = sp ] && ok "profile -C <tree outside the repository> -> exit 0, the same profile" || bad "profile outside tree: exit $rc, out: $out"
got="$("$BIN/profile" -C "$WT" --field _resolved.in_worktree 2>&1)"
[ "$got" = true ] && ok "the outside tree is a worktree of the repository" || bad "in_worktree: $got"
out="$(cd "$WT" && GATE_SCOPE=all node "$HOOKS/gate.mjs" fast </dev/null 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [[ "$out" == *"[gate] green"* ]] && ls "$HARNESS_HOME/gate/state"/verdict-*.json >/dev/null 2>&1 \
    && ok "gate.mjs fast in the outside tree finds the registry entry, green, state in HARNESS_HOME" || bad "gate outside tree: exit $rc, out: ${out:0:300}"
printf '{"session_id":"s-22","cwd":"%s"}' "$WT" | "$BIN/worktree-lock" claim >/dev/null 2>&1
grep -lq "s-22" "$HARNESS_HOME"/worktree-sessions/*.json 2>/dev/null \
    && ok "worktree-lock claim in the outside tree writes the lock into HARNESS_HOME" || bad "worktree-lock: $(ls "$HARNESS_HOME" 2>&1)"

# --- 4b. hooks/worktree-create.sh, a WorktreeCreate hook kept as a draft and NOT registered ----------------
# Decided 2026-10-09: hooks.json does not register it, so Claude Code's own worktree creation is untouched.
# The script itself is tested here as a unit: for sp it runs the profile's worktree.implementer template (root
# outside the repository); otherwise it adds <repository>/.claude/worktrees/<name>. The live probes ran
# another script through --settings, not this one through the plugin.
WTC="$HOOKS/worktree-create.sh"
wtc() { printf '{"name":"%s","cwd":"%s","hook_event_name":"WorktreeCreate"}' "$1" "$2" | "$WTC" 2>"$T/wtc.err"; }
# On Windows the script is not ported (a decision of 2026-10-13): line 65 takes only a /… path as absolute, so
# the C:\… root profile prints there lands inside the repository, and pwd -P prints a /tmp/… path native Claude
# Code cannot use. The cases that create a tree are skipped there; the refusals still run.
WTC_SKIP="worktree-create.sh is not ported to Windows (C:\\… root taken as relative, POSIX path printed)"
if [ "$WIN" -eq 1 ]; then
    echo "skip WorktreeCreate outside, hook tree, repeat: $WTC_SKIP"
else
out="$(wtc agent-a1 "$R")"; rc=$?
if [ "$rc" -eq 0 ] && [ "$out" = "$HARNESS_HOME/worktrees/sp/agent-a1" ] && [ "$(git -C "$out" rev-parse --abbrev-ref HEAD 2>/dev/null)" = worktree-agent-a1 ] \
   && [ "$(git -C "$out" rev-parse --path-format=absolute --git-common-dir)" = "$R/.git" ]; then
    ok "WorktreeCreate, root outside the repository: the worktree.implementer template adds <root><name>, the hook prints it"
else bad "WorktreeCreate outside: exit $rc, out: $out, err: $(head -c 300 "$T/wtc.err")"; fi
git -C "$out" branch -m worktree-agent-a1 fix/agent-a1 2>/dev/null
[ "$("$BIN/profile" -C "$out" --name 2>&1)" = sp ] && [ "$(git -C "$out" rev-parse --abbrev-ref HEAD)" = fix/agent-a1 ] && [ -z "$(git -C "$R" status --porcelain)" ] \
    && ok "the hook's tree: the same profile, the implementer renames the branch, the repository stays clean" || bad "hook tree: $(git -C "$out" rev-parse --abbrev-ref HEAD)"
out="$(wtc agent-a1 "$R")"; rc=$?
[ "$rc" -ne 0 ] && [ -z "$out" ] && ok "WorktreeCreate: the template fails (the tree exists) — exit $rc, no path" || bad "WorktreeCreate repeat: exit $rc, out: $out"
# The placeholders of worktree.implementer, <branch> and <ticket-name>: a stub profile prints the template
# as written, so the hook's own substitution is what is tested. (Old Russian placeholders never reach the
# hook: bin/profile prints them in English, profile.test.sh.)
cat >"$T/wtc-profile" <<'EOF'
#!/usr/bin/env bash
case "$*" in *worktree.root*) printf '%s\n' "$WTC_ROOT" ;; *worktree.implementer*) printf '%s\n' "$WTC_TMPL" ;; *) exit 4 ;; esac
EOF
chmod +x "$T/wtc-profile"
tmpl="git worktree add -b <branch> $HARNESS_HOME/worktrees/sp/<ticket-name> main"
out="$(printf '{"name":"ph-en","cwd":"%s","hook_event_name":"WorktreeCreate"}' "$R" \
    | CLAUDE_PROFILE_BIN="$T/wtc-profile" WTC_ROOT="$HARNESS_HOME/worktrees/sp/" WTC_TMPL="$tmpl" "$WTC" 2>"$T/wtc.err")"; rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "$HARNESS_HOME/worktrees/sp/ph-en" ] && [ "$(git -C "$out" rev-parse --abbrev-ref HEAD 2>/dev/null)" = worktree-ph-en ] \
    && ok "WorktreeCreate: the placeholders <branch>/<ticket-name> give <root><name> on worktree-<name>" \
    || bad "WorktreeCreate placeholders: exit $rc, out: $out, err: $(head -c 300 "$T/wtc.err")"
[ -d "$out" ] && git -C "$R" worktree remove --force "$out" && git -C "$R" branch -q -D worktree-ph-en
fi
out="$(wtc ../escape "$R")"; rc=$?
[ "$rc" -ne 0 ] && [ -z "$out" ] && [ ! -e "$HARNESS_HOME/worktrees/escape" ] && ok "WorktreeCreate: a name with .. is refused" || bad "WorktreeCreate ../: exit $rc, out: $out"
if [ "$WIN" -eq 1 ]; then
    echo "skip WorktreeCreate default: $WTC_SKIP"
else
out="$(wtc agent-b1 "$FR")"; rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "$FR/.claude/worktrees/agent-b1" ] && [ "$(git -C "$out" rev-parse --abbrev-ref HEAD 2>/dev/null)" = worktree-agent-b1 ] \
    && ok "WorktreeCreate, no outside root (Full project fp): <repository>/.claude/worktrees/<name> on worktree-<name>, as Claude Code itself" \
    || bad "WorktreeCreate default: exit $rc, out: $out, err: $(head -c 300 "$T/wtc.err")"
git -C "$FR" worktree remove --force "$FR/.claude/worktrees/agent-b1" && git -C "$FR" branch -q -D worktree-agent-b1
fi
out="$(wtc agent-c1 "$T")"; rc=$?
[ "$rc" -ne 0 ] && [ -z "$out" ] && ok "WorktreeCreate outside git: exit $rc, no path" || bad "WorktreeCreate outside git: exit $rc, out: $out"
jq -e '.hooks | type == "object" and (has("WorktreeCreate") | not) and ([.. | strings | select(contains("worktree-create"))] == [])' "$HOOKS/hooks.json" >/dev/null \
    && ok "hooks.json registers no WorktreeCreate hook and never runs worktree-create.sh" \
    || bad "hooks.json registers WorktreeCreate or worktree-create.sh: $(jq -c '.hooks.WorktreeCreate' "$HOOKS/hooks.json" 2>&1)"

# --- 5. The local finish (local-green): the block of ship-ticket, step 11 ----------------------
# The block is cut out of the skill and run under bash and under zsh; each run merges its own branch.
block() { # $1 skill file, $2 a string that identifies the ```bash block
    awk -v m="$2" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$1"
}
FIN="$(block "$SKILLS/ship-ticket/SKILL.md" 'MERGED=')"
[ -n "$FIN" ] || bad "the local finish block (MERGED=) is not in ship-ticket/SKILL.md"
FIN="${FIN//<epic>/ep}"        # the epic of the Full project fp below; sp's repository has no such folder
ran=0
for sh in bash zsh; do
    if [ "$WIN" -eq 1 ] && ! command -v "$sh" >/dev/null 2>&1; then
        echo "skip $sh: local finish: Git Bash on Windows has no $sh"; continue
    fi
    ran=$((ran + 1))
    b="fix/finish-$sh"
    git -C "$R" worktree add -q -b "$b" "$T/wt-$sh" main 2>/dev/null
    echo "$sh" >"$T/wt-$sh/$sh.txt"; git -C "$T/wt-$sh" add -A && git -C "$T/wt-$sh" commit -q -m "add $sh"
    code="${FIN//<repo>/$R}"; code="${code//<ticket branch>/$b}"; code="${code//<ticket worktree>/$T/wt-$sh}"
    out="$(cd "$R" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$code" 2>&1)"
    if [[ "$out" == *"MERGED=0"* ]] && git -C "$R" merge-base --is-ancestor "$b" main && [ -f "$R/$sh.txt" ]; then
        ok "$sh: the local finish block fast-forwards main to the ticket branch"
    else bad "$sh: local finish: out: ${out:0:300}"; fi
done
# A branch that is not on top of main is not merged.
git -C "$R" worktree add -q -b fix/stale "$T/wt-stale" "main~$ran" 2>/dev/null   # before the finishes above
echo s >"$T/wt-stale/s.txt"; git -C "$T/wt-stale" add -A && git -C "$T/wt-stale" commit -q -m stale
code="${FIN//<repo>/$R}"; code="${code//<ticket branch>/fix/stale}"; code="${code//<ticket worktree>/$T/wt-stale}"
out="$(cd "$R" && CLAUDE_PLUGIN_ROOT="$HARNESS" bash -c "$code" 2>&1)"
[[ "$out" == *"NOT ON TOP"* && "$out" == *"MERGED=1"* ]] && ! git -C "$R" merge-base --is-ancestor fix/stale main \
    && ok "a branch not on top of main is not merged (NOT ON TOP, MERGED=1)" || bad "stale branch: ${out:0:300}"
# main checked out nowhere: the block moves the branch ref.
git -C "$R" checkout -q --detach
git -C "$R" worktree add -q -b fix/detached "$T/wt-det" main 2>/dev/null
echo d >"$T/wt-det/d.txt"; git -C "$T/wt-det" add -A && git -C "$T/wt-det" commit -q -m det
code="${FIN//<repo>/$R}"; code="${code//<ticket branch>/fix/detached}"; code="${code//<ticket worktree>/$T/wt-det}"
out="$(cd "$R" && CLAUDE_PLUGIN_ROOT="$HARNESS" bash -c "$code" 2>&1)"
[[ "$out" == *"MERGED=0"* ]] && git -C "$R" merge-base --is-ancestor fix/detached main \
    && ok "main checked out nowhere: the block moves main to the branch" || bad "detached main: ${out:0:300}"
git -C "$R" checkout -q main
# parallel: single (the main checkout is on the ticket branch) and no worktree.base — the settings of a project of several repositories. The main
# branch is not the checkout's HEAD: from origin/HEAD, without it from the local main; the ticket branch itself
# as the main branch is refused.
P="$HARNESS_HOME/projects/sp/profile.json"; cp "$P" "$T/profile.saved"
jq '.worktree.base = null' "$T/profile.saved" >"$P"
single() { # <branch> → the block's output, run from the main checkout standing on <branch>
    git -C "$R" checkout -q -b "$1" main && echo "$1" >"$R/$(echo "$1" | tr / -).txt" && git -C "$R" add -A && git -C "$R" commit -q -m "add $1"
    local code="${FIN//<repo>/$R}"; code="${code//<ticket branch>/$1}"; code="${code//<ticket worktree>/$R}"
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
[ "$rc" -eq 0 ] && grep -Eqx "Status: done $(date -u +%F)T[0-9]{2}:[0-9]{2}Z" "$f" && ! grep -q '^PR:' "$f" && ok "ticket done without --pr writes Status: done with no PR" \
    || bad "ticket done: exit $rc, out: ${out:0:200}"
[ -z "$(git -C "$R" status --porcelain)" ] && ok "the repository has no workflow files after the run" || bad "repository dirty: $(git -C "$R" status --porcelain)"

# --- 5b. Full mode + local-green: the ticket's documents ride the merge (narrow round) ------------------
# The documents (ticket done, the result section) are prepared uncommitted in the ticket's worktree; the
# merge block commits them only on a branch that is on top of main, and fast-forwards right after. A branch
# that is not on top gets no documents commit, so no unmerged branch carries done.
cat >"$HARNESS_HOME/projects/fp/profile.json" <<EOF
{"schema":2,"name":"fp","mode":"full","attribution":"on","workflow":{"finish":"local-green"},
 "worktree":{"base":"main"},"tickets":{"root":".scratch/"},"docs":{"handoff":{"path":"HANDOFF.md"}}}
EOF
mkdir -p "$FR/.scratch/ep/issues"
for n in 01 02 03 04 05 06; do printf '# %s — t\n\nStatus: claimed\n' "$n" >"$FR/.scratch/ep/issues/$n-t.md"; done
echo '# state' >"$FR/HANDOFF.md"; git -C "$FR" add -A && git -C "$FR" commit -q -m "tickets"
fullrun() { # <branch> <worktree> → the merge block's output
    local code="${FIN//<repo>/$FR}"; code="${code//<ticket branch>/$1}"; code="${code//<ticket worktree>/$2}"
    code="${code//<documents commit message>/close ticket}"
    (cd "$FR" && CLAUDE_PLUGIN_ROOT="$HARNESS" bash -c "$code" 2>&1)
}
git -C "$FR" worktree add -q -b ep/01 "$T/fw1" main 2>/dev/null
echo c >"$T/fw1/c1.txt"; git -C "$T/fw1" add -A && git -C "$T/fw1" commit -q -m "code 01"
(cd "$T/fw1" && "$BIN/ticket" done ep 01 >/dev/null && echo '- debt' >>HANDOFF.md)
out="$(fullrun ep/01 "$T/fw1")"
if [[ "$out" == *"MERGED=0"* && "$out" == *"MAIN=main"* ]] && grep -q '^Status: done' "$FR/.scratch/ep/issues/01-t.md" && grep -q -- '- debt' "$FR/HANDOFF.md" \
   && [ "$(git -C "$FR" log -1 --format=%s main)" = "close ticket" ] && [ -z "$(git -C "$T/fw1" status --porcelain)" ]; then
    ok "full + local-green: the documents are committed on the ticket branch and reach main with the fast-forward"
else bad "full docs ride: ${out:0:300}; main: $(git -C "$FR" log -1 --format=%s main)"; fi
git -C "$FR" worktree add -q -b ep/02 "$T/fw2" main~1 2>/dev/null
echo c >"$T/fw2/c2.txt"; git -C "$T/fw2" add -A && git -C "$T/fw2" commit -q -m "code 02"
(cd "$T/fw2" && "$BIN/ticket" done ep 02 >/dev/null)
out="$(fullrun ep/02 "$T/fw2")"
if [[ "$out" == *"NOT ON TOP"* && "$out" == *"MERGED=1"* ]] && [ "$(git -C "$T/fw2" log -1 --format=%s)" = "code 02" ] \
   && [ "$(git -C "$FR" show ep/02:.scratch/ep/issues/02-t.md | grep -c '^Status: done')" = 0 ]; then
    ok "full + local-green: a branch not on top gets no documents commit — no unmerged branch carries done"
else bad "full not on top: ${out:0:300}; last commit: $(git -C "$T/fw2" log -1 --format=%s)"; fi
# Owner round, finding 1: NOT ON TOP rolls the prepared documents back, so the implementer's rebase in that
# tree works and nothing puts done on the unmerged branch.
if [[ "$out" == *"DOCS ROLLED BACK"* ]] && [ -z "$(git -C "$T/fw2" status --porcelain)" ] && git -C "$T/fw2" rebase -q main >/dev/null 2>&1 \
   && [ "$(git -C "$T/fw2" show HEAD:.scratch/ep/issues/02-t.md | grep -c '^Status: done')" = 0 ]; then
    ok "full + local-green: NOT ON TOP rolls the documents back — the tree is clean, the rebase works, no done on the branch"
else bad "not on top rollback: ${out:0:300}; status: $(git -C "$T/fw2" status --porcelain | head -3)"; git -C "$T/fw2" rebase --abort >/dev/null 2>&1; fi

# Owner round, findings 2 and 3: a failing documents commit (a commit hook, signing) moves nothing and says so;
# the documents commit takes only the epic's folder and the state file, not what is already staged.
git -C "$FR" worktree add -q -b ep/04 "$T/fw4" main 2>/dev/null
echo c >"$T/fw4/c4.txt"; git -C "$T/fw4" add -A && git -C "$T/fw4" commit -q -m "code 04"
(cd "$T/fw4" && "$BIN/ticket" done ep 04 >/dev/null && echo '- debt 04' >>HANDOFF.md)
echo x >"$T/fw4/extra.ts"; git -C "$T/fw4" add extra.ts
mkdir -p "$T/fw4/.scratch/other"; echo o >"$T/fw4/.scratch/other/o.md"
mkdir -p "$T/hooks-fail"; printf '#!/bin/sh\necho "pre-commit: refused" >&2\nexit 1\n' >"$T/hooks-fail/pre-commit"; chmod +x "$T/hooks-fail/pre-commit"
main_before="$(git -C "$FR" rev-parse main)"; b_before="$(git -C "$FR" rev-parse ep/04)"
git -C "$FR" config core.hooksPath "$T/hooks-fail"
out="$(fullrun ep/04 "$T/fw4")"
git -C "$FR" config --unset core.hooksPath
if [[ "$out" == *"DOCS COMMIT FAILED"* && "$out" == *"MERGED=1"* && "$out" != *"MERGED=0"* ]] && [ "$(git -C "$FR" rev-parse main)" = "$main_before" ] \
   && [ "$(git -C "$FR" rev-parse ep/04)" = "$b_before" ]; then
    ok "full + local-green: a commit hook refuses the documents commit — main not moved, DOCS COMMIT FAILED, MERGED=1"
else bad "failing documents commit (hook): ${out:0:300}; main moved: $([ "$(git -C "$FR" rev-parse main)" = "$main_before" ] && echo no || echo yes)"; fi
printf '#!/bin/sh\nexit 1\n' >"$T/gpg-fail"; chmod +x "$T/gpg-fail"
git -C "$FR" config commit.gpgsign true; git -C "$FR" config gpg.program "$T/gpg-fail"
out="$(fullrun ep/04 "$T/fw4")"
git -C "$FR" config --unset commit.gpgsign; git -C "$FR" config --unset gpg.program
[[ "$out" == *"DOCS COMMIT FAILED"* && "$out" == *"MERGED=1"* ]] && [ "$(git -C "$FR" rev-parse main)" = "$main_before" ] \
    && ok "full + local-green: signing fails — main not moved, MERGED=1; a second failing run is the same" || bad "failing documents commit (signing): ${out:0:300}"
out="$(fullrun ep/04 "$T/fw4")"
names="$(git -C "$FR" show --name-only --format= ep/04)"
if [[ "$out" == *"MERGED=0"* ]] && [ "$(git -C "$FR" log -1 --format=%s main)" = "close ticket" ] && [ "$(git -C "$FR" rev-list --count "$b_before..main")" = 1 ] \
   && grep -q '^Status: done' "$FR/.scratch/ep/issues/04-t.md" && [[ "$names" != *extra.ts* && "$names" != *other/o.md* ]] \
   && [ "$(git -C "$T/fw4" diff --cached --name-only)" = extra.ts ] && [ -f "$T/fw4/.scratch/other/o.md" ]; then
    ok "full + local-green: the cause fixed, the block again — one documents commit, only the epic's folder and the state file"
else bad "documents commit after the fix: ${out:0:300}; commit files: $(echo $names)"; fi
git -C "$T/fw4" reset -q extra.ts

# Short round 2026-10-09: DOCS COMMIT FAILED leaves the documents staged; if main moves before the next run, NOT ON
# TOP must roll back the index too (--staged), or the tree stays dirty and the implementer's rebase cannot start.
git -C "$FR" worktree add -q -b ep/06 "$T/fw6" main 2>/dev/null
echo c >"$T/fw6/c6.txt"; git -C "$T/fw6" add -A && git -C "$T/fw6" commit -q -m "code 06"
(cd "$T/fw6" && "$BIN/ticket" done ep 06 >/dev/null && echo '- debt 06' >>HANDOFF.md)
git -C "$FR" config core.hooksPath "$T/hooks-fail"
out1="$(fullrun ep/06 "$T/fw6")"
git -C "$FR" config --unset core.hooksPath
staged1="$(git -C "$T/fw6" diff --cached --name-only | tr '\n' ' ')"
echo m >"$FR/m6.txt"; git -C "$FR" add m6.txt && git -C "$FR" commit -q -m "main moves" -- m6.txt
out="$(fullrun ep/06 "$T/fw6")"
if [[ "$out1" == *"DOCS COMMIT FAILED"* && "$staged1" == *HANDOFF.md* && "$out" == *"NOT ON TOP"* && "$out" == *"DOCS ROLLED BACK"* && "$out" == *"MERGED=1"* ]] \
   && [ -z "$(git -C "$T/fw6" status --porcelain)" ] && git -C "$T/fw6" rebase -q main >/dev/null 2>&1 \
   && [ "$(git -C "$T/fw6" show HEAD:.scratch/ep/issues/06-t.md | grep -c '^Status: done')" = 0 ]; then
    ok "full + local-green: DOCS COMMIT FAILED, then NOT ON TOP — the staged documents are rolled back too, the rebase works"
else bad "failed documents commit, then not on top: ${out1:0:200} / ${out:0:300}; staged before: $staged1; status: $(git -C "$T/fw6" status --porcelain | head -3)"
    git -C "$T/fw6" rebase --abort >/dev/null 2>&1; fi

# A break between the documents commit and the fast-forward (here: the fast-forward fails on a local change in
# the main checkout), then the block again: no second documents commit; a third run changes nothing.
git -C "$FR" worktree add -q -b ep/05 "$T/fw5" main 2>/dev/null
echo c >"$T/fw5/c5.txt"; git -C "$T/fw5" add -A && git -C "$T/fw5" commit -q -m "code 05"
(cd "$T/fw5" && "$BIN/ticket" done ep 05 >/dev/null)
echo local >>"$FR/.scratch/ep/issues/05-t.md"
out="$(fullrun ep/05 "$T/fw5")"
first_head="$(git -C "$FR" rev-parse ep/05)"
[[ "$out" == *"MERGED=1"* ]] && [ "$(git -C "$FR" log -1 --format=%s ep/05)" = "close ticket" ] && ! git -C "$FR" merge-base --is-ancestor ep/05 main \
    && ok "a fast-forward that fails after the documents commit: MERGED=1, the branch carries done, main does not" || bad "break after the documents commit: ${out:0:300}"
git -C "$FR" checkout -q -- .scratch/ep/issues/05-t.md
out="$(fullrun ep/05 "$T/fw5")"
[[ "$out" == *"MERGED=0"* ]] && [ "$(git -C "$FR" rev-parse ep/05)" = "$first_head" ] && [ "$(git -C "$FR" rev-parse main)" = "$first_head" ] \
    && ok "the block again after the break: no second documents commit, main fast-forwarded" || bad "second run after the break: ${out:0:300}"
out="$(fullrun ep/05 "$T/fw5")"
[[ "$out" == *"MERGED=0"* ]] && [ "$(git -C "$FR" rev-parse main)" = "$first_head" ] \
    && ok "a third run after MERGED=0 changes nothing" || bad "third run: ${out:0:300}"

# The wave's documents when no VERIFIED ticket is left to merge: a commit on main, in a temporary worktree
# when main is checked out nowhere (the blocks of epic-wave, section 4, item 4).
WOPEN="$(block "$SKILLS/epic-wave/SKILL.md" 'TEMPORARY=')"; WDOCS="$(block "$SKILLS/epic-wave/SKILL.md" 'wave documents commit message')"
[ -n "$WOPEN" ] && [ -n "$WDOCS" ] || bad "the wave documents blocks are not in epic-wave/SKILL.md"
wopen() { # → TREE= and TEMPORARY= of the first block
    local code="${WOPEN//<repo>/$FR}"; code="${code//<main branch>/main}"
    (cd "$FR" && bash -c "$code" 2>&1)
}
wcommit() { # <tree> <temporary> → the commit block's output
    local code="${WDOCS//<repo>/$FR}"; code="${code//<TREE>/$1}"; code="${code//<TEMPORARY>/$2}"; code="${code//<epic>/ep}"
    code="${code//<wave documents commit message>/wave documents}"
    (cd "$FR" && CLAUDE_PLUGIN_ROOT="$HARNESS" bash -c "$code" 2>&1)
}
line() { local v="${1#*$2=}"; printf '%s' "${v%%$'\n'*}"; } # <output> <KEY> → the value of KEY=
wavedocs() { # <ticket to block> → output of both blocks around a ticket block
    local o tree tmp
    o="$(wopen)"; tree="$(line "$o" TREE)"; tmp="$(line "$o" TEMPORARY)"
    (cd "$tree" && "$BIN/ticket" block ep "$1" "removed from the wave" >/dev/null)
    printf '%s\n%s' "$o" "$(wcommit "$tree" "$tmp")"
}
git -C "$FR" checkout -q --detach
# Owner round, finding 4: a failing commit in the temporary worktree still removes it.
main_before="$(git -C "$FR" rev-parse main)"
git -C "$FR" config core.hooksPath "$T/hooks-fail"
out="$(wavedocs 06)"
git -C "$FR" config --unset core.hooksPath
tmpw="$(line "$out" TEMPORARY)"
if [[ "$out" == *"WAVE DOCS COMMIT FAILED"* && "$out" != *"EXIT=0"* && "$tmpw" != no ]] && [ ! -e "$tmpw" ] \
   && [ "$(git -C "$FR" worktree list --porcelain | grep -c "^branch refs/heads/main$")" = 0 ] && [ "$(git -C "$FR" rev-parse main)" = "$main_before" ]; then
    ok "wave documents: a failing commit in the temporary worktree — WAVE DOCS COMMIT FAILED, the tree removed, main not moved"
else bad "wave documents, failing commit: ${out:0:400}; trees: $(git -C "$FR" worktree list | tr '\n' ' ')"; fi
# A break after the first block: the temporary tree is left; the next first block finds it as temporary.
o1="$(wopen)"; o2="$(wopen)"
if [ "$(line "$o1" TEMPORARY)" != no ] && [ "$(line "$o2" TEMPORARY)" = "$(line "$o1" TEMPORARY)" ] && [ "$(line "$o2" TREE)" = "$(line "$o1" TREE)" ]; then
    ok "wave documents: a temporary tree left by a break is found again as temporary, not as the main checkout"
else bad "wave documents after a break: first: ${o1:0:200}; second: ${o2:0:200}"; fi
out="$(wcommit "$(line "$o2" TREE)" "$(line "$o2" TEMPORARY)")"
[[ "$out" == *"EXIT=0"* ]] && [ ! -e "$(line "$o2" TREE)" ] && ok "wave documents: nothing to commit — EXIT=0, the temporary tree removed" || bad "wave documents, empty run: ${out:0:300}"
out="$(wavedocs 03)"
if [[ "$out" == *"EXIT=0"* && "$out" != *"TEMPORARY=no"* ]] && [ "$(git -C "$FR" log -1 --format=%s main)" = "wave documents" ] \
   && git -C "$FR" show main:.scratch/ep/issues/03-t.md | grep -qx 'Blocked reason: removed from the wave' \
   && [ "$(git -C "$FR" worktree list | grep -c "/main ")" = 0 ]; then
    ok "wave documents, main checked out nowhere: one commit on main in a temporary worktree, removed after"
else bad "wave documents (temporary tree): ${out:0:400}"; fi
git -C "$FR" checkout -q main
# Owner round, finding 5: in the main checkout the commit takes only the epic's folder and the state file.
mkdir -p "$FR/.scratch/other"; echo o >"$FR/.scratch/other/x.md"; echo y >"$FR/code2.ts"; git -C "$FR" add code2.ts
out="$(wavedocs 02)"
names="$(git -C "$FR" show --name-only --format= main)"
[ "$names" = .scratch/ep/issues/02-t.md ] && [ "$(git -C "$FR" diff --cached --name-only)" = code2.ts ] \
    && [ "$(git -C "$FR" status --porcelain -- .scratch/other)" = "?? .scratch/other/" ] \
    && ok "wave documents in the main checkout: only the epic's folder — another epic's file and a staged code file stay out" \
    || bad "wave documents scope: commit files: $(echo $names); staged: $(git -C "$FR" diff --cached --name-only)"
git -C "$FR" reset -q code2.ts
[[ "$out" == *"TREE=$FR"* && "$out" == *"TEMPORARY=no"* && "$out" == *"EXIT=0"* ]] && git -C "$FR" show main:.scratch/ep/issues/02-t.md | grep -q '^Status: blocked' \
    && ok "wave documents, main checked out in the main checkout: the commit is made there" || bad "wave documents (main checkout): ${out:0:400}"

# --- the real home -----------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
