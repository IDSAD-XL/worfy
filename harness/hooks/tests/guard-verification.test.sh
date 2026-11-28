#!/usr/bin/env bash
# Tests of hooks/guard.mjs, section 4: a subagent edits a verification path (lib/verification-paths.cjs and the profile's
# verification.paths) only when the trail of its ticket on the base branch names it (lib/ticket-trail.cjs, the reader
# bin/land uses). The edit tools of Claude Code (Edit, Write, MultiEdit, NotebookEdit), apply_patch of Codex and the write
# targets of a shell command are checked; the main Session passes; a subagent whose branch names no ticket is refused. In
# Silent mode the trail is read from the tickets folder, and a subagent's edit of a ticket's trail is refused. The same
# section refuses a subagent `ticket mark` and any agent session `profile-set` of the fields the merge condition depends
# on. Every refusal goes through deny(), which appends a JSON line to $WORFY_GUARD_LOG when it is set.
# Run: bash harness/hooks/tests/guard-verification.test.sh; exit code 0 means everything passed.
#
# HOME, HARNESS_HOME (registry and profiles), CLAUDE_CONFIG_DIR, the Workflow folder and the repositories are
# temporary. At the end the test compares the real ~/.claude (the Harness parts) and ~/.claude/worfy-harness with a
# snapshot taken before the run.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
GUARD="$HOOKS/guard.mjs"
REAL_HOME="$HOME"
. "$HARNESS/bin/tests/real-home.sh"
. "$HARNESS/bin/tests/gh-stand-in.sh" # node_path
# node_path: C:/… in Git Bash on Windows, the spelling git prints and node reads; elsewhere pwd -P (no /var symlink).
T="$(mktemp -d)"; T="$(cd "$T" && node_path "$(pwd -P)")"
GW=.github/workflows GW_OTHER_CASE=.GitHub/Workflows   # the workflow files below have made-up names
trap 'rm -rf "$T"' EXIT
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
WINDOWS=""; case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WINDOWS=1 ;; esac
FOLDS=""; case "$(uname -s)" in MINGW* | MSYS* | CYGWIN* | Darwin) FOLDS=1 ;; esac   # file systems that ignore letter case

export HOME="$T/home" HARNESS_HOME="$T/hh" CLAUDE_CONFIG_DIR="$T/claude-config"
unset CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR CLAUDE_PROFILE_BIN CLAUDE_TICKET_BIN CLAUDE_SILENT_CHECK_BIN WORFY_GUARD_LOG
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$HARNESS_HOME/gate" "$HARNESS_HOME/projects/vp" "$HARNESS_HOME/projects/sp"

# R — the main checkout of a Full project on main; W — a worktree of it under R/.claude/worktrees (the layout of the
# Harness), on the branch of ticket ep 07; W8 — on ep/08, a ticket that is only on its branch; N — on a branch that
# names no ticket. origin/main is a remote-tracking ref set by hand: the guard never fetches.
R="$T/repo"; W="$R/.claude/worktrees/07"; W8="$R/.claude/worktrees/08"; N="$R/.claude/worktrees/misc"
TICKET_07=$'# 07: x\n\nStatus: claimed\n\n## Where in code\n\n- `tools/check-run.mjs` — the run\n- `'"$GW"$'/named.yml`\n- Read only: `'"$GW"$'/readonly.yml`\n\n## Done when\n\n- [ ] x\n'
git init -q -b main "$R"
git -C "$R" config core.autocrlf false
mkdir -p "$R/.scratch/ep/issues" "$R/.github/workflows" "$R/tools" "$R/src"
printf '%s' "$TICKET_07" >"$R/.scratch/ep/issues/07-x.md"
printf 'on: push\n' >"$R/${GW}/main.yml"
printf 'export const a = 1\n' >"$R/src/a.ts"
printf '.claude/\n' >"$R/.gitignore"
git -C "$R" add -A && git -C "$R" commit -q -m init
git -C "$R" update-ref refs/remotes/origin/main HEAD
git -C "$R" worktree add -q -b ep/07 "$W" main
git -C "$R" worktree add -q -b ep/08 "$W8" main
git -C "$R" worktree add -q -b misc "$N" main
# The branch's own edit of its trail allows nothing: the trail is read on origin/main, not at the branch's HEAD. The
# branch commits a trail item for main.yml inside the section, and ep/08 commits a ticket that names it.
printf '%s' "$TICKET_07" | awk -v own="- \`$GW/main.yml\`" '{ print } /^## Where in code$/ { getline; print ""; print own }' >"$W/.scratch/ep/issues/07-x.md"
git -C "$W" commit -q -am "own trail edit"
mkdir -p "$W8/.scratch/ep/issues" && printf '# 08\n\n## Where in code\n\n- `'"$GW"'/main.yml`\n' >"$W8/.scratch/ep/issues/08-y.md"
git -C "$W8" add -A && git -C "$W8" commit -q -m "the ticket of ep/08 on its branch"
# D — a detached work tree, as worktree.reviewer makes it.
D="$R/.claude/worktrees/review-x"
git -C "$R" worktree add -q --detach "$D" main

grep -q -- "- \`$GW/main.yml\`" <(sed -n '/^## Where in code/,/^## Done when/p' "$W/.scratch/ep/issues/07-x.md") \
    && [ -z "$(git -C "$W" status --porcelain)" ] && [ -z "$(git -C "$W8" status --porcelain)" ] \
    && ok "setup: the trail edit of ep/07 and the ticket of ep/08 are committed on their branches" || bad "setup: the branch-side trail edits are not committed in the trail section"

# M — a registered project of several repositories (its trail entries start with the repository name); P — a registered
# project whose profile has no tickets.branch template. The guard does not check verification paths in either.
M="$T/multi"; M2="$T/multi2"; P="$T/plain"
for x in "$M" "$M2" "$P"; do git init -q -b main "$x" && printf 'x\n' >"$x/a.ts" && git -C "$x" add -A && git -C "$x" commit -q -m init && git -C "$x" update-ref refs/remotes/origin/main HEAD && git -C "$x" checkout -q -b ep/07; done
mkdir -p "$HARNESS_HOME/projects/mp" "$HARNESS_HOME/projects/pp"

# S — the repository of a Silent project, on ep/07; its tickets live in the Workflow folder WF.
S="$T/silent"; WF="$T/wf"
git init -q -b main "$S" && mkdir -p "$S/.github/workflows" && printf 'on: push\n' >"$S/${GW}/main.yml"
git -C "$S" add -A && git -C "$S" commit -q -m init && git -C "$S" update-ref refs/remotes/origin/main HEAD && git -C "$S" checkout -q -b ep/07
mkdir -p "$WF/.scratch/ep/issues"
printf '%s' "$TICKET_07" >"$WF/.scratch/ep/issues/07-x.md"
SILENT_TICKET="$WF/.scratch/ep/issues/07-x.md"
# B — a registered repository whose profile is not JSON: bin/profile cannot read it.
B="$T/broken"
git init -q -b main "$B" && printf 'x\n' >"$B/a.ts" && git -C "$B" add -A && git -C "$B" commit -q -m init && git -C "$B" checkout -q -b ep/07
mkdir -p "$HARNESS_HOME/projects/bp" && printf '{"schema":2,' >"$HARNESS_HOME/projects/bp/profile.json"

TICKETS='"tickets":{"root":".scratch/","path":".scratch/<epic>/issues/NN-*.md","branch":"<epic>/<NN>","trail_section":"## Where in code"}'
cat >"$HARNESS_HOME/gate/config.json" <<EOF
{"repos":[
 {"key":"vp","match":"$R","profile":"vp","pm":"npm","root":{},"workspace":{}},
 {"key":"sp","match":"$S","profile":"sp","pm":"npm","root":{},"workspace":{}},
 {"key":"bp","match":"$B","profile":"bp","pm":"npm","root":{},"workspace":{}},
 {"key":"mp","match":"$M","profile":"mp","pm":"npm","root":{},"workspace":{}},
 {"key":"mp2","match":"$M2","profile":"mp","pm":"npm","root":{},"workspace":{}},
 {"key":"pp","match":"$P","profile":"pp","pm":"npm","root":{},"workspace":{}}
]}
EOF
printf '{"schema":2,"name":"vp","mode":"full",%s,"worktree":{"root":"%s","base":"origin/main","implementer":"x","reviewer":"x"},"verification":{"paths":["tools/check-*.mjs"]}}\n' \
    "$TICKETS" "$R/.claude/worktrees" >"$HARNESS_HOME/projects/vp/profile.json"
printf '{"schema":2,"name":"sp","mode":"silent","attribution":"on","workflow":{"folder":"%s"},%s,"worktree":{"root":"%s","base":"origin/main","implementer":"x","reviewer":"x"}}\n' \
    "$WF" "$TICKETS" "$T/silent-wt" >"$HARNESS_HOME/projects/sp/profile.json"

printf '{"schema":2,"name":"mp","mode":"full",%s,"worktree":{"root":"%s","base":"origin/main","implementer":"x","reviewer":"x"}}\n' \
    "$TICKETS" "$T/mwt" >"$HARNESS_HOME/projects/mp/profile.json"
printf '{"schema":2,"name":"pp","mode":"full","tickets":{"root":".scratch/","path":".scratch/<epic>/issues/NN-*.md","trail_section":"## Where in code"},"worktree":{"root":"%s","base":"origin/main","implementer":"x","reviewer":"x"}}\n' \
    "$T/pwt" >"$HARNESS_HOME/projects/pp/profile.json"

IMPL='"agent_type":"worfy:implementer","agent_id":"a4010b9effb32dff6"'
CODEX_IMPL='"turn_id":"turn-1","agent_type":"worfy-implementer","agent_id":"01a19fd3-agent"'

# decide <json> → prints "deny: <reason>" or "allow"
decide() {
    local out
    out="$(printf '%s' "$1" | node "$GUARD")"
    if [ -z "$out" ]; then echo allow; else printf 'deny: %s\n' "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason')"; fi
}
expect() { # <description> <allow|deny> <json> [substring of the reason]; the answer stays in $got
    got="$(decide "$3")"
    if [[ "$got" == "$2"* ]] && { [ -z "${4:-}" ] || [[ "$got" == *"$4"* ]]; }; then ok "$1"
    else bad "$1: want $2${4:+ ($4)}, got: ${got:0:400}"; fi
}
q() { jq -Rn --arg v "$1" '$v'; }   # a JSON string
edit()  { printf '{"tool_name":"Edit","tool_input":{"file_path":%s,"old_string":"a","new_string":"b"},"cwd":%s%s}' "$(q "$1")" "$(q "$2")" "${3:+,$3}"; }
write() { printf '{"tool_name":"Write","tool_input":{"file_path":%s,"content":%s},"cwd":%s%s}' "$(q "$1")" "$(q "${4:-x}")" "$(q "$2")" "${3:+,$3}"; }
bash_() { printf '{"tool_name":"Bash","tool_input":{"command":%s},"cwd":%s%s}' "$(q "$1")" "$(q "$2")" "${3:+,$3}"; }
patch() { printf '{"tool_name":"apply_patch","tool_input":{"command":%s},"cwd":%s,%s}' "$(q "$1")" "$(q "$2")" "$CODEX_IMPL"; }
STEP="Write the need into your report; the Orchestrator adds the path to the trail"
OUTSIDE="${GW}/main.yml is a verification path, and the trail of ep 07 does not name it"

# --- the edit tools of Claude Code, a subagent of ticket ep 07 ------------------------------------------------
expect "Edit of a verification path outside the trail -> deny with the path and the next step" deny "$(edit "$W/${GW}/main.yml" "$W" "$IMPL")" "$OUTSIDE. $STEP"
expect "Write of a verification path outside the trail -> deny" deny "$(write "$W/${GW}/main.yml" "$W" "$IMPL")" "$OUTSIDE"
expect "MultiEdit of a verification path outside the trail -> deny" deny \
    "{\"tool_name\":\"MultiEdit\",\"tool_input\":{\"file_path\":$(q "$W/${GW}/main.yml"),\"edits\":[{\"old_string\":\"a\",\"new_string\":\"b\"}]},\"cwd\":$(q "$W"),$IMPL}" "$OUTSIDE"
expect "NotebookEdit of a verification path (.claude/**) outside the trail -> deny" deny \
    "{\"tool_name\":\"NotebookEdit\",\"tool_input\":{\"notebook_path\":$(q "$W/.claude/n.ipynb"),\"new_source\":\"x\"},\"cwd\":$(q "$W"),$IMPL}" ".claude/n.ipynb is a verification path"
expect "a new file in a folder that does not exist yet -> deny" deny "$(write "$W/.github/actions/setup/action.yml" "$W" "$IMPL")" ".github/actions/setup/action.yml is a verification path"
expect "a glob of the profile's verification.paths counts -> deny" deny "$(edit "$W/tools/check-new.mjs" "$W" "$IMPL")" "tools/check-new.mjs is a verification path"
expect "the trail names the path (a profile glob) -> allow" allow "$(edit "$W/tools/check-run.mjs" "$W" "$IMPL")"
expect "the trail names the path (a default glob) -> allow" allow "$(write "$W/${GW}/named.yml" "$W" "$IMPL")"
expect "a read-only item of the trail allows nothing -> deny" deny "$(edit "$W/${GW}/readonly.yml" "$W" "$IMPL")" "${GW}/readonly.yml is a verification path"
expect "the branch's own edit of its trail allows nothing (read on origin/main) -> deny" deny "$(edit "$W/${GW}/main.yml" "$W" "$IMPL")" "$OUTSIDE"
expect "a file that is no verification path -> allow" allow "$(edit "$W/src/a.ts" "$W" "$IMPL")"
expect "a file of the worktree is taken from the worktree's root, not from .claude/** of the main checkout -> allow" allow "$(write "$W/src/new.ts" "$R" "$IMPL")"
expect "a relative path is taken from the cwd -> deny" deny "$(edit "${GW}/main.yml" "$W" "$IMPL")" "$OUTSIDE"
expect "a path with backslashes -> deny" deny "$(edit '.github\workflows\ci.yml' "$W" "$IMPL")" "is a verification path, and the trail of ep 07 does not name it"
if [ -n "$FOLDS" ]; then
    expect "another letter case on a file system that ignores it -> deny" deny "$(edit "$W/$GW_OTHER_CASE/MAIN.yml" "$W" "$IMPL")" "is a verification path, and the trail of ep 07"
fi
if [ -z "$WINDOWS" ]; then
    ln -s "$W" "$T/link-07"
    expect "a path spelled through a symbolic link to the worktree -> deny" deny "$(edit "$T/link-07/${GW}/main.yml" "$W" "$IMPL")" "$OUTSIDE"
fi
expect "a file outside any repository -> allow" allow "$(write "$T/outside/ci.yml" "$W" "$IMPL")"

# --- who is refused ------------------------------------------------------------------------------------------------
expect "the main Session -> allow" allow "$(edit "$W/${GW}/main.yml" "$W")"
expect "the main thread of a --agent Session (agent_type, no agent_id) -> allow" allow "$(edit "$W/${GW}/main.yml" "$W" '"agent_type":"worfy:implementer"')"
expect "a subagent on a branch that names no ticket -> deny" deny "$(edit "$N/${GW}/main.yml" "$N" "$IMPL")" "the branch misc names no ticket"
expect "a subagent without a ticket: the next step" deny "$(edit "$N/CLAUDE.md" "$N" "$IMPL")" "$STEP"
expect "a subagent whose ticket is only on its branch -> deny" deny "$(edit "$W8/${GW}/main.yml" "$W8" "$IMPL")" "the trail of ep 08 cannot be read at origin/main"
expect "any subagent, not only the implementer -> deny" deny "$(edit "$W/CLAUDE.md" "$W" '"agent_type":"general-purpose","agent_id":"a1"')" "CLAUDE.md is a verification path"

expect "a subagent on a detached HEAD (a review tree) -> deny with its own next step" deny "$(edit "$D/CLAUDE.md" "$D" "$IMPL")" \
    "CLAUDE.md is a verification path, and this work tree is on a detached HEAD: a subagent edits no verification path in a review tree. Mutate a copy outside the repository"
expect "a profile of several repositories: verification paths are not checked -> allow" allow "$(edit "$M/CLAUDE.md" "$M" "$IMPL")"
expect "a profile with no tickets.branch template: verification paths are not checked -> allow" allow "$(edit "$P/CLAUDE.md" "$P" "$IMPL")"
# A read that fails or runs out of time lets the call through (the spec's risks: land checks the diff at merge).
expect "a profile that cannot be read: a verification path -> allow, land checks at merge" allow "$(edit "$B/CLAUDE.md" "$B" "$IMPL")"
expect "a profile that cannot be read: any other file -> allow" allow "$(edit "$B/a.ts" "$B" "$IMPL")"
SLOW="$T/slow-profile.mjs"
printf 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000)\n' >"$SLOW"
t0=$(date +%s)
got="$(CLAUDE_PROFILE_BIN="$SLOW" CLAUDE_GUARD_READ_MS=1500 decide "$(edit "$W/${GW}/main.yml" "$W" "$IMPL")")"
t1=$(date +%s)
[ "$got" = allow ] && [ $((t1 - t0)) -lt 10 ] && ok "a bin/profile that does not answer within the budget: allow, inside the budget ($((t1 - t0)) s)" \
    || bad "a slow bin/profile: want allow within 10 s, got ${got:0:200} after $((t1 - t0)) s"
if [ -z "$WINDOWS" ]; then
    # A git that hangs on the trail's ls-tree: the trail read shares the budget too (a shell script is no program to spawn on Windows).
    SLOW_GIT="$T/slow-git"
    printf '#!/bin/sh\ncase " $* " in *" ls-tree "*) sleep 20 ;; esac\nexec git "$@"\n' >"$SLOW_GIT" && chmod +x "$SLOW_GIT"
    t0=$(date +%s)
    got="$(EVAL_GIT="$SLOW_GIT" CLAUDE_GUARD_READ_MS=1500 decide "$(edit "$W/${GW}/main.yml" "$W" "$IMPL")")"
    t1=$(date +%s)
    [ "$got" = allow ] && [ $((t1 - t0)) -lt 10 ] && ok "a git that does not answer the trail read within the budget: allow, inside the budget ($((t1 - t0)) s)" \
        || bad "a slow git: want allow within 10 s, got ${got:0:200} after $((t1 - t0)) s"
fi

# --- Codex: apply_patch and Bash of a subagent ---------------------------------------------------------------------
expect "Codex apply_patch Update File outside the trail -> deny" deny "$(patch $'*** Begin Patch\n*** Update File: '"$GW"$'/main.yml\n@@\n-on: push\n+on: pull_request\n*** End Patch' "$W")" "$OUTSIDE. $STEP"
expect "Codex apply_patch Add File outside the trail -> deny" deny "$(patch $'*** Begin Patch\n*** Add File: '"$GW"$'/new.yml\n+on: push\n*** End Patch' "$W")" "${GW}/new.yml is a verification path"
expect "Codex apply_patch Delete File outside the trail -> deny" deny "$(patch $'*** Begin Patch\n*** Delete File: '"$GW"$'/main.yml\n*** End Patch' "$W")" "$OUTSIDE"
expect "Codex apply_patch Move to a verification path -> deny" deny "$(patch $'*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: '"$GW"$'/moved.yml\n@@\n-export const a = 1\n+on: push\n*** End Patch' "$W")" "${GW}/moved.yml is a verification path"
expect "Codex apply_patch of a file the trail names and a plain file -> allow" allow "$(patch $'*** Begin Patch\n*** Update File: tools/check-run.mjs\n+x\n*** Add File: src/b.ts\n+export const b = 2\n*** End Patch' "$W")"
expect "Codex apply_patch of the main agent -> allow" allow "$(printf '{"tool_name":"apply_patch","tool_input":{"command":%s},"cwd":%s,"turn_id":"t"}' "$(q $'*** Begin Patch\n*** Delete File: '"$GW"$'/main.yml\n*** End Patch')" "$(q "$W")")"
expect "Codex Bash of a subagent: a redirect into a verification path -> deny" deny "$(bash_ 'echo x > '"$GW"'/main.yml' "$W" "$CODEX_IMPL")" "$OUTSIDE"

# --- the write targets of a shell command ---------------------------------------------------------------------------
expect "Bash: echo x > ${GW}/main.yml -> deny" deny "$(bash_ 'echo x > '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE. $STEP"
expect "Bash: >> (append) -> deny" deny "$(bash_ 'printf x >>'"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: &> -> deny" deny "$(bash_ 'pnpm x &> '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: cd into the worktree first, then a redirect -> deny" deny "$(bash_ "cd $W && echo x > ${GW}/main.yml" "$T" "$IMPL")" "$OUTSIDE"
expect "Bash: the Git Bash spelling of the absolute path -> deny" deny "$(bash_ "echo x > $(cd "$W" && pwd)/${GW}/main.yml" "$T" "$IMPL")" "$OUTSIDE"
expect "Bash: a variable the command sets -> deny" deny "$(bash_ "D=$W/.github; echo x > \$D/workflows/main.yml" "$T" "$IMPL")" "$OUTSIDE"
expect "Bash: tee -> deny" deny "$(bash_ 'echo x | tee -a '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: cp into the file -> deny" deny "$(bash_ 'cp /etc/hosts '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: cp into the folder -> deny" deny "$(bash_ 'cp /etc/hosts .github/workflows/' "$W" "$IMPL")" ".github/workflows/hosts is a verification path"
expect "Bash: mv a verification path away -> deny" deny "$(bash_ 'mv '"$GW"'/main.yml old.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: rm -rf of a folder above the verification paths -> deny" deny "$(bash_ 'rm -rf .github' "$W" "$IMPL")" ".github is a verification path"
expect "Bash: touch -> deny" deny "$(bash_ 'touch '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: sed -i -> deny" deny "$(bash_ "sed -i '' 's/push/pull_request/' ${GW}/main.yml" "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: perl -pi -> deny" deny "$(bash_ "perl -pi -e 's/a/b/' ${GW}/main.yml" "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: ln -s onto a verification path -> deny" deny "$(bash_ 'ln -sf /tmp/x '"$GW"'/main.yml' "$W" "$IMPL")" "$GW/main.yml (a symbolic link, which may point anywhere) is a verification path, and the trail of ep 07 does not name it"
expect "Bash: a symbolic link anywhere in the repository counts, as in land -> deny" deny "$(bash_ 'ln -s ../x src/link' "$W" "$IMPL")" "src/link (a symbolic link, which may point anywhere) is a verification path, and the trail of ep 07 does not name it"
expect "Bash: a hard link outside the verification paths -> allow" allow "$(bash_ 'ln src/a.ts src/b.ts' "$W" "$IMPL")"
# A folder copy or move: a destination that ends in "/" or is a folder that exists gets each source under its own name,
# so only a source that lands as (or over) a folder above a verification path is refused. tools/ does not exist in W.
mkdir -p "$W/tmpl/workflows" "$W/docs" && printf 'x\n' >"$W/notes.md" && printf '* @x\n' >"$W/CODEOWNERS"
expect "Bash: cp -r of a folder into a folder above them, under its own name -> deny" deny "$(bash_ 'cp -r tmpl/workflows .github/' "$W" "$IMPL")" ".github/workflows is a verification path"
expect "Bash: mv of a folder into a folder above them, under its own name -> deny" deny "$(bash_ 'mv tmpl/workflows .github/' "$W" "$IMPL")" ".github/workflows is a verification path"
expect "Bash: cp -R of a folder onto a folder that does not exist and is above a verification path -> deny" deny "$(bash_ 'cp -R tmpl tools' "$W" "$IMPL")" "tools is a verification path"
expect "Bash: mv of a folder onto a folder that does not exist and is above a verification path -> deny" deny "$(bash_ 'mv tmpl tools' "$W" "$IMPL")" "tools is a verification path"
expect "Bash: cp -RT (no target folder) onto .github -> deny" deny "$(bash_ 'cp -RT tmpl .github' "$W" "$IMPL")" ".github is a verification path"
expect "Bash: mv -T (no target folder) onto .github, in two steps -> deny" deny "$(bash_ 'mv tmpl .github2 && mv -T .github2 .github' "$W" "$IMPL")" ".github is a verification path"
expect "Bash: rsync of a folder's contents onto .github -> deny" deny "$(bash_ 'rsync -a --exclude x tmpl/ .github/' "$W" "$IMPL")" ".github is a verification path"
expect "Bash: rsync of a folder into .github under its own name -> deny" deny "$(bash_ 'rsync -a tmpl/workflows .github' "$W" "$IMPL")" ".github/workflows is a verification path"
expect "Bash: cp -R of a folder into an existing .github lands as .github/tmpl -> allow" allow "$(bash_ 'cp -R tmpl .github' "$W" "$IMPL")"
expect "Bash: mv of a folder into an existing .github lands as .github/docs -> allow" allow "$(bash_ 'mv docs .github' "$W" "$IMPL")"
expect "Bash: mv of a file into tools/ (above tools/check-*.mjs) -> allow" allow "$(bash_ 'mv notes.md tools/' "$W" "$IMPL")"
expect "Bash: cp -r of a file into tools/ -> allow" allow "$(bash_ 'cp -r notes.md tools/' "$W" "$IMPL")"
expect "Bash: mv CODEOWNERS .github/ (the default paths: .github/workflows/**) -> allow" allow "$(bash_ 'mv CODEOWNERS .github/' "$W" "$IMPL")"
expect "Bash: mv of a file to the name of a folder that does not exist -> allow" allow "$(bash_ 'mv notes.md tools' "$W" "$IMPL")"
expect "Bash: rsync of a folder into .github under its own name, not above a verification path -> allow" allow "$(bash_ 'rsync -a docs .github/' "$W" "$IMPL")"
expect "Bash: a plain cp of one file into .github/ (not a verification path) -> allow" allow "$(bash_ 'cp notes.md .github/' "$W" "$IMPL")"
expect "Bash: >| -> deny" deny "$(bash_ 'echo x >| '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: \$PWD/ -> deny" deny "$(bash_ 'echo x > "$PWD/'"$GW"'/main.yml"' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: pushd, then a redirect -> deny" deny "$(bash_ "pushd $W && echo x > $GW/main.yml" "$T" "$IMPL")" "$OUTSIDE"
expect "Bash: 2>&1 in a verification folder is no file write -> allow" allow "$(bash_ "cd $GW && ls 2>&1" "$W" "$IMPL")"
expect "Bash: truncate -> deny" deny "$(bash_ 'truncate -s 0 '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: dd of= -> deny" deny "$(bash_ 'dd if=/dev/zero of='"$GW"'/main.yml count=1' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: install -> deny" deny "$(bash_ 'install -m 644 /etc/hosts '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
expect "Bash: reading a verification path -> allow" allow "$(bash_ 'cat '"$GW"'/main.yml && grep -n on '"$GW"'/main.yml 2>&1 >/dev/null' "$W" "$IMPL")"
expect "Bash: an input redirect from a verification path -> allow" allow "$(bash_ 'wc -l < '"$GW"'/main.yml > /dev/null 2>&1' "$W" "$IMPL")"
expect "Bash: a redirect into a path the trail names -> allow" allow "$(bash_ 'echo x > tools/check-run.mjs' "$W" "$IMPL")"
expect "Bash: a heredoc body that names a redirect is data -> allow" allow "$(bash_ $'cat > notes.md <<\'EOF\'\necho x > '"$GW"$'/main.yml\nEOF' "$W" "$IMPL")"
expect "Bash: the main Session -> allow" allow "$(bash_ 'echo x > '"$GW"'/main.yml' "$W")"

# --- Silent mode: the trail from the tickets folder -------------------------------------------------------------------
expect "silent: the trail in the Workflow folder names the path -> allow" allow "$(edit "$S/${GW}/named.yml" "$S" "$IMPL")"
expect "silent: a verification path outside that trail -> deny" deny "$(edit "$S/${GW}/main.yml" "$S" "$IMPL")" "$OUTSIDE"
expect "silent: a subagent's Edit that adds a path to a ticket's trail -> deny" deny \
    "$(printf '{"tool_name":"Edit","tool_input":{"file_path":%s,"old_string":%s,"new_string":%s},"cwd":%s,%s}' "$(q "$SILENT_TICKET")" "$(q '- `'"$GW"'/named.yml`')" "$(q $'- `'"$GW"$'/named.yml`\n- `'"$GW"$'/main.yml`')" "$(q "$S")" "$IMPL")" \
    "the trail section of ep/issues/07-x.md"
expect "silent: a subagent's Edit of another section of its ticket -> allow" allow \
    "$(printf '{"tool_name":"Edit","tool_input":{"file_path":%s,"old_string":"- [ ] x","new_string":"- [x] x"},"cwd":%s,%s}' "$(q "$SILENT_TICKET")" "$(q "$S")" "$IMPL")"
expect "silent: a subagent's Write of the ticket with another trail -> deny" deny "$(write "$SILENT_TICKET" "$S" "$IMPL" "${TICKET_07/named.yml/ci.yml}")" "the trail section"
expect "silent: a subagent's Write of the ticket with the same trail -> allow" allow "$(write "$SILENT_TICKET" "$S" "$IMPL" "${TICKET_07/Status: claimed/Status: done}")"
expect "silent: a shell write into a ticket that has a trail -> deny" deny "$(bash_ "echo '- \`x/y.txt\`' >> $SILENT_TICKET" "$S" "$IMPL")" "the trail section"
[[ "$got" != *"Edit tool"* ]] && ok "silent: the refusal names no tool Codex lacks" || bad "silent: the refusal names the Edit tool: ${got:0:300}"
expect "silent: a Codex patch that changes the trail -> deny" deny \
    "$(patch $'*** Begin Patch\n*** Update File: '"$SILENT_TICKET"$'\n@@\n - `'"$GW"$'/named.yml`\n+- `'"$GW"$'/main.yml`\n*** End Patch' "$S")" "the trail section"
expect "silent: a Codex patch of another section -> allow" allow \
    "$(patch $'*** Begin Patch\n*** Update File: '"$SILENT_TICKET"$'\n@@\n-- [ ] x\n+- [x] x\n*** End Patch' "$S")"
expect "silent: the main Session edits the trail -> allow" allow \
    "$(printf '{"tool_name":"Edit","tool_input":{"file_path":%s,"old_string":"named.yml","new_string":"ci.yml"},"cwd":%s}' "$(q "$SILENT_TICKET")" "$(q "$S")")"

# --- ticket mark and profile-set ------------------------------------------------------------------------------------
expect "ticket mark from a subagent -> deny" deny "$(bash_ "\"$HARNESS/bin/ticket\" mark ep 07 review success --sha 0123456789abcdef0123456789abcdef01234567" "$W" "$IMPL")" "ticket mark"
expect "node bin/ticket mark from a subagent -> deny" deny "$(bash_ "cd $R && node \"$HARNESS/bin/ticket\" mark ep 07 check/windows success --sha 01" "$W" "$CODEX_IMPL")" "ticket mark"
expect "ticket mark --contexts from a subagent (prints only) -> allow" allow "$(bash_ "\"$HARNESS/bin/ticket\" mark --contexts" "$W" "$IMPL")"
expect "ticket mark from the main Session -> allow" allow "$(bash_ "\"$HARNESS/bin/ticket\" mark ep 07 review pending --sha 01" "$R")"
expect "a heredoc body that names ticket mark is data -> allow" allow "$(bash_ $'cat > notes.md <<\'EOF\'\nticket mark ep 07 review success --sha 01\nEOF' "$W" "$IMPL")"
expect "ticket show from a subagent -> allow" allow "$(bash_ "\"$HARNESS/bin/ticket\" show ep 07" "$W" "$IMPL")"
expect "profile-set --field workflow.merge --set from the main Session -> deny" deny "$(bash_ "\"$HARNESS/bin/profile-set\" --field workflow.merge --expect null --set '{\"workflow.merge\":\"orchestrator\"}'" "$R")" "workflow.merge"
expect "profile-set --field workflow (the whole object) -> deny" deny "$(bash_ "profile-set --field workflow --expect x --set '{}'" "$R")" "profile-set would change workflow,"
expect "profile-set --field verification.paths --set from a subagent -> deny" deny "$(bash_ "node \"$HARNESS/bin/profile-set\" --field verification.paths --expect x --set -" "$W" "$IMPL")" "verification.paths"
expect "profile-set --field verification --reset -> deny" deny "$(bash_ "profile-set --field verification --expect x --reset" "$R")" "verification"
expect "profile-set --field workflow.ci_check -> deny" deny "$(bash_ "profile-set -C $R --field tickets.path --field workflow.ci_check --expect x --set -" "$R")" "workflow.ci_check"
expect "profile-set of the Pipeline (no --field) -> deny" deny "$(bash_ "profile-set --expect x --set '[]'" "$R")" "workflow.pipeline"
expect "profile-set --field workflow.pipeline -> deny" deny "$(bash_ "profile-set --field workflow.pipeline --expect x --set '{}'" "$R")" "workflow.pipeline"
expect "profile-set of another field -> allow" allow "$(bash_ "profile-set --field tickets.path --expect x --set '{}'" "$R")"
expect "profile-set --read of a guarded field -> allow" allow "$(bash_ "profile-set --field workflow.merge --read" "$R")"
expect "profile-set --check of a guarded field -> allow" allow "$(bash_ "profile-set --field workflow.merge --check '{}'" "$R")"

# --- the refusal log --------------------------------------------------------------------------------------------------
LOG="$T/log/guard.jsonl"
mkdir -p "$T/log"
got="$(WORFY_GUARD_LOG="$LOG" decide "$(edit "$W/${GW}/main.yml" "$W" "$IMPL,\"session_id\":\"ses-9\"")")"
line="$(tail -n 1 "$LOG" 2>/dev/null)"
if [[ "$got" == deny* ]] && printf '%s' "$line" | jq -e '.rule == "verification-path" and .agent == "worfy:implementer" and .ticket == "ep/07" and .tool == "Edit" and (.command | endswith("/main.yml")) and .session == "ses-9" and (.time | test("^[0-9]{4}-"))' >/dev/null; then
    ok "WORFY_GUARD_LOG: a refusal appends a JSON line with the rule id"
else bad "WORFY_GUARD_LOG: want a JSON line of the rule verification-path, got: ${line:0:400}"; fi
WORFY_GUARD_LOG="$LOG" decide "$(bash_ 'profile-set --field workflow.merge --expect x --set -' "$R")" >/dev/null
[ "$(tail -n 1 "$LOG" | jq -r '.rule + " " + (.agent // "main") + " " + (.ticket // "-")')" = "profile-set-merge-fields main -" ] \
    && ok "WORFY_GUARD_LOG: the main Session's refusal names no agent and no ticket" || bad "WORFY_GUARD_LOG: main Session line: $(tail -n 1 "$LOG")"
WORFY_GUARD_LOG="$LOG" decide "$(bash_ 'git reset --hard' "$R")" >/dev/null
[ "$(tail -n 1 "$LOG" | jq -r .rule)" = "uncommitted-work" ] && ok "WORFY_GUARD_LOG: an older rule logs its id too" || bad "WORFY_GUARD_LOG: git reset line: $(tail -n 1 "$LOG")"
n="$(wc -l <"$LOG" | tr -d ' ')"
WORFY_GUARD_LOG="$LOG" decide "$(edit "$W/src/a.ts" "$W" "$IMPL")" >/dev/null
[ "$(wc -l <"$LOG" | tr -d ' ')" = "$n" ] && ok "WORFY_GUARD_LOG: an allowed call writes nothing" || bad "WORFY_GUARD_LOG: an allowed call wrote a line"
decide "$(edit "$W/${GW}/main.yml" "$W" "$IMPL")" >/dev/null
[ -z "$(ls -A "$T/log" | grep -v '^guard.jsonl$')" ] && [ "$(wc -l <"$LOG" | tr -d ' ')" = "$n" ] \
    && ok "without WORFY_GUARD_LOG a refusal writes no file" || bad "without WORFY_GUARD_LOG a file was written"
got="$(WORFY_GUARD_LOG="$T/no-such-dir/x/guard.jsonl" decide "$(edit "$W/${GW}/main.yml" "$W" "$IMPL")")"
[[ "$got" == deny* ]] && ok "WORFY_GUARD_LOG that cannot be written: the refusal still holds" || bad "unwritable WORFY_GUARD_LOG: ${got:0:300}"

# --- a failure inside the section ------------------------------------------------------------------------------------
# An exception inside the verification-path section lets the call through (the spec's risks: land checks the diff at
# merge): a replace_all Edit of a ticket in the Workflow folder whose result would pass the longest string node allows.
BIG="$WF/.scratch/ep/issues/09-big.md"
{ printf '# 09\n\n## Where in code\n\n'; head -c 1048576 /dev/zero | tr '\0' a; } >"$BIG"
expect "an exception inside the section (a string too long to build) -> allow, the call goes through" allow \
    "$(printf '{"tool_name":"Edit","tool_input":{"file_path":%s,"old_string":"a","new_string":%s,"replace_all":true},"cwd":%s,%s}' "$(q "$BIG")" "$(q "$(printf 'b%.0s' $(seq 1 600))")" "$(q "$S")" "$IMPL")"
rm -f "$BIG"

# --- a rebase stopped on a conflict --------------------------------------------------------------------------------
# HEAD is detached during a rebase: the branch being rebased (rebase-merge/head-name) is the branch, not a review tree.
SIDE="$T/side"
git -C "$R" worktree add -q -b side "$SIDE" main && printf 'export const a = 3\n' >"$SIDE/src/a.ts" && git -C "$SIDE" commit -q -am side
printf 'export const a = 2\n' >"$W/src/a.ts" && git -C "$W" commit -q -am "ours"
git -C "$W" rebase side >/dev/null 2>&1
[ "$(git -C "$W" rev-parse --abbrev-ref HEAD)" = HEAD ] && ok "setup: the rebase of ep/07 stopped on a conflict, HEAD detached" || bad "setup: the rebase did not stop"
expect "a rebase in progress: a verification path the trail names -> allow" allow "$(edit "$W/${GW}/named.yml" "$W" "$IMPL")"
expect "a rebase in progress: a verification path the trail does not name -> deny, the ordinary refusal" deny "$(edit "$W/${GW}/main.yml" "$W" "$IMPL")" "$OUTSIDE. $STEP"
expect "a rebase in progress: Bash into a verification path the trail does not name -> deny" deny "$(bash_ 'echo x > '"$GW"'/main.yml' "$W" "$IMPL")" "$OUTSIDE"
git -C "$W" rebase --abort >/dev/null 2>&1
expect "a detached tree with no rebase is still a review tree -> deny" deny "$(edit "$D/CLAUDE.md" "$D" "$IMPL")" "Mutate a copy outside the repository"

# --- the matcher --------------------------------------------------------------------------------------------------
[ "$(jq -r '.hooks.PreToolUse[] | select(.hooks[].command | test("guard.mjs")) | .matcher' "$HOOKS/hooks.json")" = "Bash|apply_patch|Edit|Write|MultiEdit|NotebookEdit" ] \
    && ok "hooks.json: guard.mjs runs on Bash, apply_patch and the edit tools" || bad "hooks.json: the matcher of guard.mjs is $(jq -c '.hooks.PreToolUse' "$HOOKS/hooks.json")"

# --- the real home -----------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
