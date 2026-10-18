#!/usr/bin/env bash
# git and HARNESS_HOME in a run of `claude plugin eval` (worfy-harness ticket 28). In the sandbox of
# such a run the git on PATH may be refused, and $HOME/.claude may not be written; two variables tell
# the Harness scripts what to use instead (hooks/eval-env.cjs):
#   EVAL_GIT          — the git every script starts, in place of `git` from PATH;
#   EVAL_HARNESS_HOME — where the Harness state lives when HARNESS_HOME is not set: an absolute path
#                       as it is, a relative one from the git common directory of the current folder.
# What is checked:
#   1. With a git on PATH that only fails (exit 97) and EVAL_GIT naming a wrapper over the real git
#      that logs its arguments, preflight, epic-status --json, profile -C <repo> --name, ticket show,
#      worktree-lock claim/status/release, silent-check --cached, epic-board --no-open, shortcut-ledger
#      and gate.sh fast (on a branch with changes, so that its scope comes from git) give the exit
#      code and the output they give with the real git on PATH, and each of them left lines in the log
#      of the wrapper. Without EVAL_GIT the failing git is what they get.
#   2. EVAL_HARNESS_HOME=worfy-harness with HARNESS_HOME unset: profile finds the profile of
#      <repo>/.git/worfy-harness, also with -C from another folder; the gate writes gate/state there,
#      worktree-lock writes worktree-sessions there (also run from another folder), epic-board its
#      page, ticket mark of a Silent project its marks; a worktree of the same repository gets the
#      same folder, and the .claude folder of the temporary HOME is never created. HARNESS_HOME wins
#      over it; an absolute value is taken as it is; a relative one outside git gives the default
#      $HOME/.claude/worfy-harness; eval-env.cjs asks EVAL_GIT, not git from PATH. worktree-create.sh
#      starts its git through EVAL_GIT.
#   3. gate.sh with no node: its own git calls go to EVAL_GIT, and its marker lands under
#      EVAL_HARNESS_HOME, relative or absolute.
#   4. No Node script of bin/ and hooks/ starts git by its name (two named exceptions).
#   5. Without EVAL_* nothing changes: harness-home.test.sh and the tests of each script stay as they are.
# Run: bash harness/bin/tests/eval-env.test.sh; exit code 0 means everything passed.
# Every HOME here is a temporary folder; the real home is compared with a snapshot at the end. gh is a
# stub first on PATH (preflight asks it for the open PRs); the test prints how many times it was called.
set -u
HARNESS="${HARNESS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"   # HARNESS_DIR — run against another copy
BIN="$HARNESS/bin"
HOOKS="$HARNESS/hooks"
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; TP is the same
# folder for PATH, where C:/… cannot stand.
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
T="$(mktemp -d)" || exit 1
[ -d "$T" ] || exit 1
TP="$(cd "$T" && pwd -P)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
. "$(dirname "$0")/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
check() { # $1 = description, the rest = condition
    local d="$1"; shift
    if "$@"; then ok "$d"; else bad "$d"; fi
}
nocr() { tr -d '\r'; }

unset HARNESS_HOME CLAUDE_GATE_CONFIG CLAUDE_GATE_STATE CLAUDE_GATE_RESOLVE CLAUDE_PROFILE_BIN CLAUDE_TICKET_BIN \
    CLAUDE_PROFILES_DIR CLAUDE_PLUGIN_ROOT CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID GATE_SCOPE PREFLIGHT_GH TICKET_GH \
    EVAL_GIT EVAL_HARNESS_HOME
export HOME="$T/home" USERPROFILE="$T/home"
mkdir -p "$HOME"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t GIT_CONFIG_NOSYSTEM=1

# --- stubs: gh, the failing git, the logging git -------------------------------------------
# gh: a stub first on PATH that logs and refuses, as in preflight.test.sh; the guard stops the test
# before any check if another gh could be started.
. "$(dirname "$0")/gh-stand-in.sh"
mkdir -p "$TP/stubs"
printf '#!/usr/bin/env bash\necho "$*" >>"$GH_STUB_LOG"\necho "gh stub: no GitHub in the tests" >&2\nexit 1\n' >"$TP/stubs/gh"
chmod +x "$TP/stubs/gh"; refusing_gh_exe "$TP/stubs/gh"
export PATH="$TP/stubs:$PATH" GH_STUB_LOG="$TP/gh-stub.log"
if on_windows; then node_stand_in "$TP/stubs/gh" "$TP/stubs/gh.mjs"; export PREFLIGHT_GH="$TP/stubs/gh.mjs"; fi
gh_guard PREFLIGHT_GH "$TP/stubs/gh" "$TP/stubs/gh.mjs"

REAL_GIT="$(type -P git)"
# The failing git: first on PATH of the runs under EVAL_GIT. On Windows node looks up git.com and
# git.exe only: a copy of `false` there is what a bare "git" of node gets.
mkdir -p "$TP/broken"
printf '#!/bin/sh\necho "git of PATH: refused by the test" >&2\nexit 97\n' >"$TP/broken/git"
chmod +x "$TP/broken/git"
if on_windows; then cp "$(type -P false)" "$TP/broken/git.exe"; fi
BROKEN_PATH="$TP/broken:$PATH"
# The logging git: a shell wrapper over the real git. Node on Windows cannot start a shell script, so
# there EVAL_GIT is the real git.exe and the log is not checked for the Node scripts.
GITLOG="$TP/git.log"
mkdir -p "$TP/evalgit"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s"\nexec "%s" "$@"\n' "$GITLOG" "$REAL_GIT" >"$TP/evalgit/git"
chmod +x "$TP/evalgit/git"
if on_windows; then
    EVAL_GIT_NODE="$(node_path "$REAL_GIT")"; case "$EVAL_GIT_NODE" in *.exe) ;; *) EVAL_GIT_NODE="$EVAL_GIT_NODE.exe" ;; esac
else
    EVAL_GIT_NODE="$TP/evalgit/git"
fi
log_lines() { [ -f "$GITLOG" ] && grep -c . "$GITLOG" || echo 0; }

# The check of the package manager: the gate runs "$PM run check". On Windows a .cmd: node starts
# nothing else there without an interpreter.
if [ "$WIN" -eq 1 ]; then
    PM="$T/fakepm.cmd"; printf '@echo off\r\nexit /b 0\r\n' >"$PM"
else
    PM="$T/fakepm"; printf '#!/bin/sh\nexit 0\n' >"$PM"; chmod +x "$PM"
fi

# registry <harness home> <repository>: the gate registry and the profile "t" of the repository.
registry() {
    mkdir -p "$1/gate" "$1/projects/t"
    jq -n --arg r "$2" --arg pm "$PM" \
        '{repos: [{key: "t", match: $r, profile: "t", pm: $pm, root: {fast: ["check"], full: ["check"]}, workspace: {}}]}' >"$1/gate/config.json"
    printf '{"schema":1,"name":"t","attribution":"off","worktree":{"base":"origin/main"},"numbering":{"adr":null,"migrations":null},"docs":{"adr_dir":null}}\n' \
        >"$1/projects/t/profile.json"
    : >"$1/projects/t/rules.md"
}
# newrepo <path>: one commit with an epic "e" of one open ticket, origin in a bare repository inside
# its .git, origin/main fetched.
newrepo() {
    mkdir -p "$1/.scratch/e/issues"
    git -C "$1" init -q -b main
    echo '{ "name": "fixture", "scripts": { "check": "true" } }' >"$1/package.json"
    printf '# 01 — a ticket\n\nType: task\nStatus: open\nBlocked by: —\n' >"$1/.scratch/e/issues/01-a.md"
    git -C "$1" add -A && git -C "$1" commit -q -m init
    git init -q --bare "$1/.git/origin.git"
    git -C "$1" remote add origin "$1/.git/origin.git" && git -C "$1" push -q origin main 2>/dev/null && git -C "$1" fetch -q origin
}

R="$T/repo"
newrepo "$R"
registry "$HOME/.claude/worfy-harness" "$R"

# --- 1. Every script with EVAL_GIT and a failing git on PATH --------------------------------
# pair <name> <stdin> <command…>: the command in $R twice — with the real git on PATH, then with the
# failing git first on PATH and EVAL_GIT; the same exit code and stdout, and new lines in the log.
# PAIR_STDERR=1 compares stderr too.
pair() {
    local name="$1" input="$2"; shift 2
    local real_out real_rc eval_out eval_rc before after err=/dev/null
    [ "${PAIR_STDERR:-0}" = 1 ] && err=/dev/stdout
    real_out="$(cd "$R" && printf '%s' "$input" | "$@" 2>"$err" | nocr)"; real_rc=$?
    before="$(log_lines)"
    eval_out="$(cd "$R" && printf '%s' "$input" | PATH="$BROKEN_PATH" EVAL_GIT="$EVAL_GIT_NODE" "$@" 2>"$err" | nocr)"; eval_rc=$?
    after="$(log_lines)"
    if [ "$eval_rc" -eq "$real_rc" ] && [ "$eval_out" = "$real_out" ]; then ok "$name: with EVAL_GIT the same exit code ($real_rc) and output as with git on PATH"
    else bad "$name: git on PATH rc=$real_rc, out: ${real_out:0:400}; EVAL_GIT rc=$eval_rc, out: ${eval_out:0:400}"; fi
    if on_windows; then echo "skip $name: the log of the wrapper (node on Windows starts EVAL_GIT=git.exe, not the wrapper)"
    elif [ "$after" -gt "$before" ]; then ok "$name: its git calls went to EVAL_GIT ($((after - before)) lines in the log)"
    else bad "$name: no line in the log of EVAL_GIT"; fi
}
set -o pipefail
SID='{"session_id":"s-eval","cwd":"'"$R"'"}'

# The failing first test of the ticket: preflight with EVAL_GIT where git on PATH fails. On main it
# called git by its name and answered "not a git repository", as in the eval run.
out="$(cd "$R" && PATH="$BROKEN_PATH" node "$BIN/preflight" 2>&1)"; rc=$?
check "the failing git is what preflight gets without EVAL_GIT (exit 2, not a git repository)" [ "$rc" -eq 2 ]
[[ "$out" == *"not a git repository"* ]] || echo "     preflight without EVAL_GIT: rc=$rc, out: ${out:0:300}"
pair "preflight" "" env CLAUDE_SESSION_ID= node "$BIN/preflight"
out="$(cd "$R" && PATH="$BROKEN_PATH" EVAL_GIT="$EVAL_GIT_NODE" CLAUDE_SESSION_ID= node "$BIN/preflight" 2>&1)"
check "preflight with EVAL_GIT gets to its last line (GO), past the fetch" [ "$(printf '%s\n' "$out" | nocr | tail -1)" = GO ]
pair "epic-status --json" "" node "$BIN/epic-status" --json
pair "profile -C <repo> --name" "" node "$BIN/profile" -C "$R" --name
pair "ticket show (Status)" "" node "$BIN/ticket" show e 01
# claim and release print nothing either way, so on Windows, where the log is not checked, their
# pairs show only the exit code; status between them prints the tree and the session claim
# registered, and nothing when git fails.
pair "worktree-lock claim" "$SID" node "$BIN/worktree-lock" claim
pair "worktree-lock status" "" env CLAUDE_SESSION_ID= node "$BIN/worktree-lock" status
check "worktree-lock status printed the tree and the session (so its pair compared an output)" \
    [ -n "$(cd "$R" && CLAUDE_SESSION_ID= node "$BIN/worktree-lock" status 2>/dev/null | grep 's-eval')" ]
pair "worktree-lock release" "$SID" node "$BIN/worktree-lock" release
pair "silent-check --cached --untracked" "" node "$BIN/silent-check" -C "$R" --cached --untracked
pair "epic-board --no-open" "" node "$BIN/epic-board" --out "$T/board.html" --no-open
pair "shortcut-ledger <repo>" "" node "$BIN/shortcut-ledger" "$R"
# The gate on a branch ahead of origin/main by a commit, with a file not yet committed: its scope
# comes from git status and the diff from the merge-base, and the scope line it prints (stderr
# compared too) names that merge-base and the number of changed files. A state folder of its own
# each run, so that the second run is no cache hit of the first.
git -C "$R" checkout -q -b feature && echo x >"$R/a.txt" && git -C "$R" add a.txt && git -C "$R" commit -q -m a
echo y >"$R/b.txt"
gate_fresh() { CLAUDE_GATE_STATE="$(mktemp -d "$T/state.XXXXXX")" bash "$HOOKS/gate.sh" "$@"; }
PAIR_STDERR=1 pair "gate.sh fast on a branch with changes" "" gate_fresh fast </dev/null
out="$(cd "$R" && gate_fresh fast </dev/null 2>&1 | nocr)"
check "the gate narrowed its scope by the diff (files changed: 2) and was green" \
    [ "${out#*files changed: 2}" != "$out" -a "${out#*зелено (fast)}" != "$out" ]
[ "${out#*files changed: 2}" != "$out" ] || echo "     gate: ${out:0:400}"
set +o pipefail

# --- 2. EVAL_HARNESS_HOME ---------------------------------------------------------------------
H2="$T/home2"
R2="$T/repo2"
mkdir -p "$H2"
newrepo "$R2"
STATE2="$R2/.git/worfy-harness"
registry "$STATE2" "$R2"
in2() { (cd "$R2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME=worfy-harness "$@"); }
out="$(in2 node "$BIN/profile" -C "$R2" --name 2>&1)"; rc=$?
check "EVAL_HARNESS_HOME=worfy-harness: profile -C finds the profile of <repo>/.git/worfy-harness (exit 0, t)" [ "$rc" -eq 0 -a "$out" = t ]
[ "$rc" -eq 0 ] || echo "     profile: rc=$rc, out: ${out:0:300}"
out="$(in2 env GATE_SCOPE=all bash "$HOOKS/gate.sh" fast </dev/null 2>&1)"; rc=$?
check "EVAL_HARNESS_HOME: gate fast is green and writes gate/state under <repo>/.git/worfy-harness" \
    [ "$rc" -eq 0 -a -n "$(ls "$STATE2/gate/state" 2>/dev/null)" ]
[ "$rc" -eq 0 ] || echo "     gate: rc=$rc, out: ${out:0:300}"
in2 node "$BIN/worktree-lock" claim <<<'{"session_id":"s-eval2","cwd":"'"$R2"'"}' >/dev/null 2>&1
check "EVAL_HARNESS_HOME: worktree-lock claim writes worktree-sessions under <repo>/.git/worfy-harness" \
    [ -n "$(ls "$STATE2/worktree-sessions" 2>/dev/null)" ]
check "EVAL_HARNESS_HOME: git status of the repository does not see the state folder" [ -z "$(git -C "$R2" status --porcelain)" ]
check "EVAL_HARNESS_HOME: the temporary HOME has no .claude" [ ! -e "$H2/.claude" ]
# The folder eval-env.cjs prints, with / for \ (node on Windows joins with \, pwd -W prints /).
slashes() { nocr | sed 's#\\#/#g'; }
hh() { node "$HOOKS/eval-env.cjs" harness-home 2>&1 | slashes; }
STATE2_REAL="$(cd "$STATE2" 2>/dev/null && { pwd -W 2>/dev/null || pwd -P; })"
out="$(in2 hh)"
check "eval-env.cjs harness-home in the repository: <git common dir>/worfy-harness" [ "$out" = "$STATE2_REAL" ]
[ "$out" = "$STATE2_REAL" ] || echo "     got: $out, want: $STATE2_REAL"
git -C "$R2" worktree add -q "$T/wt2" -b side 2>/dev/null
out="$(cd "$T/wt2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME=worfy-harness hh)"
check "a worktree of the same repository gets the same folder" [ "$out" = "$STATE2_REAL" ]
out="$(cd "$T/wt2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME=worfy-harness node "$BIN/profile" --name 2>&1)"
check "profile from that worktree finds the same profile" [ "$out" = t ]
out="$(cd "$R2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME=worfy-harness HARNESS_HOME="$T/hh-wins" hh)"
check "HARNESS_HOME wins over EVAL_HARNESS_HOME" [ "$out" = "$T/hh-wins" ]
out="$(in2 env HARNESS_HOME="$T/hh-wins" node "$BIN/profile" -C "$R2" --name 2>&1)"; rc=$?
check "HARNESS_HOME wins in profile too: it reads the registry there, which does not exist (exit 1)" \
    [ "$rc" -eq 1 -a "${out#*hh-wins}" != "$out" ]
[ "$rc" -eq 1 ] || echo "     profile: rc=$rc, out: ${out:0:300}"
out="$(cd "$R2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME="$T/abs-home" hh)"
check "an absolute EVAL_HARNESS_HOME is taken as it is" [ "$out" = "$T/abs-home" ]
mkdir -p "$T/nogit"
out="$(cd "$T/nogit" && HOME="$H2" USERPROFILE="$H2" GIT_CEILING_DIRECTORIES="$T" EVAL_HARNESS_HOME=worfy-harness hh)"
want="$(cd "$T/nogit" && HOME="$H2" USERPROFILE="$H2" node -e 'process.stdout.write(require("path").join(require("os").homedir(), ".claude", "worfy-harness"))' | slashes)"
check "a relative EVAL_HARNESS_HOME outside git: the default <home>/.claude/worfy-harness" [ "$out" = "$want" ]
[ "$out" = "$want" ] || echo "     got: $out, want: $want"
out="$(cd "$R2" && HOME="$H2" USERPROFILE="$H2" hh)"
check "no variable: the default <home>/.claude/worfy-harness" [ "$out" = "$want" ]
# eval-env.cjs asks EVAL_GIT for the git common dir, not git from PATH.
out="$(cd "$R2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME=worfy-harness PATH="$BROKEN_PATH" EVAL_GIT="$EVAL_GIT_NODE" hh)"
check "a relative EVAL_HARNESS_HOME with a failing git on PATH: the folder comes from EVAL_GIT" [ "$out" = "$STATE2_REAL" ]
[ "$out" = "$STATE2_REAL" ] || echo "     got: $out, want: $STATE2_REAL"
out="$(cd "$T/nogit" && HOME="$H2" USERPROFILE="$H2" GIT_CEILING_DIRECTORIES="$T" EVAL_HARNESS_HOME="$T/abs-home" hh)"
check "an absolute EVAL_HARNESS_HOME outside git is taken as it is" [ "$out" = "$T/abs-home" ]
# From a folder outside the repository: the state folder is that of the repository named by -C or
# by the payload's cwd, an absolute path (git prints the common dir relative to its own cwd).
out="$(cd "$T/nogit" && HOME="$H2" USERPROFILE="$H2" GIT_CEILING_DIRECTORIES="$T" EVAL_HARNESS_HOME=worfy-harness \
    node "$BIN/profile" -C "$R2" --name 2>&1)"; rc=$?
check "profile -C <repo> run from another folder finds the profile of <repo>/.git/worfy-harness" [ "$rc" -eq 0 -a "$out" = t ]
[ "$rc" -eq 0 ] || echo "     profile: rc=$rc, out: ${out:0:300}"
(cd "$T/nogit" && HOME="$H2" USERPROFILE="$H2" GIT_CEILING_DIRECTORIES="$T" EVAL_HARNESS_HOME=worfy-harness \
    node "$BIN/worktree-lock" claim <<<'{"session_id":"s-eval3","cwd":"'"$R2"'"}' >/dev/null 2>&1)
check "worktree-lock claim run from another folder writes under <repo of cwd>/.git/worfy-harness" \
    [ -n "$(grep -l s-eval3 "$STATE2/worktree-sessions"/* 2>/dev/null)" -a ! -e "$T/nogit/.git" ]
# epic-board without --out writes its page into <state>/state/.
rm -f "$STATE2/state/epic-board.html"
in2 env PATH="$BROKEN_PATH" EVAL_GIT="$EVAL_GIT_NODE" node "$BIN/epic-board" --no-open >/dev/null 2>&1; rc=$?
check "EVAL_HARNESS_HOME: epic-board without --out writes <repo>/.git/worfy-harness/state/epic-board.html (exit 0)" \
    [ "$rc" -eq 0 -a -f "$STATE2/state/epic-board.html" ]
# ticket mark of a Silent project keeps its marks in <state>/runs/<project>/marks/.
R4="$T/repo4"
newrepo "$R4"
STATE4="$R4/.git/worfy-harness"
registry "$STATE4" "$R4"
mkdir -p "$T/wf4/.scratch/e/issues"
cp "$R4/.scratch/e/issues/01-a.md" "$T/wf4/.scratch/e/issues/"
printf '{"schema":2,"name":"t","mode":"silent","workflow":{"folder":"%s"}}\n' "$T/wf4" >"$STATE4/projects/t/profile.json"
out="$(cd "$R4" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME=worfy-harness PATH="$BROKEN_PATH" EVAL_GIT="$EVAL_GIT_NODE" \
    node "$BIN/ticket" mark e 01 review success --sha "$(git -C "$R4" rev-parse HEAD)" 2>&1)"; rc=$?
check "EVAL_HARNESS_HOME: ticket mark of a Silent project writes <repo>/.git/worfy-harness/runs/t/marks/e-01.json" \
    [ "$rc" -eq 0 -a -f "$STATE4/runs/t/marks/e-01.json" ]
[ "$rc" -eq 0 ] || echo "     ticket mark: rc=$rc, out: ${out:0:300}"
# worktree-create.sh (not registered, kept as documentation) starts its git through EVAL_GIT. It is
# bash, so EVAL_GIT is the logging wrapper on every system.
before="$(log_lines)"
out="$(printf '{"name":"wc1","cwd":"%s"}' "$R2" | (cd "$R2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME=worfy-harness \
    PATH="$TP/broken:$PATH" EVAL_GIT="$TP/evalgit/git" bash "$HOOKS/worktree-create.sh" 2>&1))"; rc=$?
after="$(log_lines)"
check "worktree-create.sh with EVAL_GIT and a failing git on PATH: exit 0, a tree at <repo>/.claude/worktrees/wc1" \
    [ "$rc" -eq 0 -a -d "$R2/.claude/worktrees/wc1" ]
[ "$rc" -eq 0 ] || echo "     worktree-create: rc=$rc, out: ${out:0:300}"
check "worktree-create.sh: its git calls went to EVAL_GIT" [ "$after" -gt "$before" ]
check "nothing above wrote .claude into the temporary HOME" [ ! -e "$H2/.claude" ]

# --- 3. gate.sh with no node ------------------------------------------------------------------
# A PATH with the failing git first, then the tools the launcher needs and no node (as in
# gate-shim.test.sh); a copy of gate.sh that does not look for node in /opt/homebrew/bin and
# /usr/local/bin. EVAL_GIT is the shell wrapper: bash starts it on every system.
NONODE="" why=""
if [ "$WIN" -eq 1 ]; then NONODE="/usr/bin:/mingw64/bin"
else
    mkdir -p "$T/bin"
    for t in bash env sha1sum shasum mkdir mktemp date mv rm cat dirname realpath; do
        p="$(command -v "$t" 2>/dev/null)" && [ "${p#/}" != "$p" ] && ln -sf "$p" "$T/bin/$t"
    done
    NONODE="$T/bin"
fi
if (PATH="$NONODE"; command -v node >/dev/null 2>&1); then why="node is in $NONODE"; NONODE=""; fi
if [ -z "$NONODE" ]; then echo "skip the checks of gate.sh without node: $why"; else
    mkdir -p "$T/plugin/hooks"
    sed 's#/usr/local/bin /opt/homebrew/bin#/worfy-test-no-such-folder-a /worfy-test-no-such-folder-b#' "$HOOKS/gate.sh" >"$T/plugin/hooks/gate.sh"
    before="$(log_lines)"
    out="$(cd "$R2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME=worfy-harness EVAL_GIT="$TP/evalgit/git" \
        PATH="$TP/broken:$NONODE" "$BASH" "$T/plugin/hooks/gate.sh" fast </dev/null 2>&1)"; rc=$?
    after="$(log_lines)"
    check "gate.sh without node, EVAL_GIT and a failing git on PATH: exit 3, «node не найден»" [ "$rc" -eq 3 ]
    [ "$rc" -eq 3 ] || echo "     gate.sh: rc=$rc, out: ${out:0:300}"
    check "gate.sh without node: its git calls went to EVAL_GIT" [ "$after" -gt "$before" ]
    check "gate.sh without node: the marker and the verdict file are under <repo>/.git/worfy-harness/gate/state" \
        [ -n "$(ls "$STATE2/gate/state" 2>/dev/null | grep '^nokey-broken-')" -a -n "$(ls "$STATE2/gate/state" 2>/dev/null | grep '^verdict-.*\.json$')" ]
    (cd "$R2" && HOME="$H2" USERPROFILE="$H2" EVAL_HARNESS_HOME="$T/abs-gate" EVAL_GIT="$TP/evalgit/git" \
        PATH="$TP/broken:$NONODE" "$BASH" "$T/plugin/hooks/gate.sh" fast </dev/null >/dev/null 2>&1)
    check "gate.sh without node, an absolute EVAL_HARNESS_HOME: the marker is under <that folder>/gate/state" \
        [ -n "$(ls "$T/abs-gate/gate/state" 2>/dev/null | grep '^nokey-broken-')" ]
    check "gate.sh without node: the temporary HOME has no .claude" [ ! -e "$H2/.claude" ]
fi

# --- 4. No Node script starts git by its name ----------------------------------------------------
# Every Node script of bin/ and hooks/: *.mjs, *.cjs, *.js and the files whose first line names node.
# Two are left out on purpose; neither runs in an eval case, and both work on the owner's own state:
#   bin/project-connect  — registers a project on the owner's machine: git init and commits in HARNESS_HOME;
#   bin/qmd-collections  — builds the qmd index: clones the project's repositories with their origin.
node_scripts=()
for f in "$HARNESS"/bin/* "$HARNESS"/hooks/*; do
    [ -f "$f" ] || continue
    case "${f##*/}" in project-connect | qmd-collections) continue ;; esac
    case "$f" in
        *.mjs | *.cjs | *.js) node_scripts+=("$f") ;;
        *) head -1 "$f" | grep -q '^#!.*node' && node_scripts+=("$f") ;;
    esac
done
names=" ${node_scripts[*]##*/} "
check "the list of Node scripts holds the ones that start git (${#node_scripts[@]} scripts)" \
    [ "${names#* profile }" != "$names" -a "${names#* wave-gate }" != "$names" -a "${names#* shortcut-ledger }" != "$names" -a "${names#* gate.mjs }" != "$names" ]
found="$(grep -nE "(execFileSync|execSync|spawnSync|spawn|execFile|exec|run|withTimeout\([^,]+,)\(? *[\"'\`]git[\"'\`]" "${node_scripts[@]}" 2>&1)"; rc=$?
check "no Node script of the Harness starts git by its name (grep exit 1)" [ "$rc" -eq 1 ]
[ "$rc" -eq 1 ] || printf '%s\n' "$found" | sed -n '1,10p' | sed 's/^/     /'

# --- the real home ------------------------------------------------------------------------------
home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
check "the real home is not written" [ "$home_before" = "$home_after" ]
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"
echo "gh stub calls: $( [ -f "$GH_STUB_LOG" ] && grep -c . "$GH_STUB_LOG" || echo 0)"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
