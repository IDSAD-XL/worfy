#!/usr/bin/env bash
# The shell blocks of skills/overnight-fix-loop/SKILL.md that split a string into words,
# under bash and under zsh (the Claude Code Bash tool runs zsh, and zsh does not split an
# unquoted variable into words). The blocks are cut out of SKILL.md itself; the profile is replaced by a stub F.
# Below — the blocks of skills/qmd (collections table) and skills/tickets-to-tasks (tool from the profile), and
# the Silent mode blocks of skills/ship-ticket and skills/epic-wave (worfy-harness ticket 22): the branch named by
# the change, the verdict in the ticket file, the local commit in the Workflow folder, resuming a wave by Branch:.
# Then the agents' marks (worfy ADR-0067): the review mark blocks of both skills, and the CI filter that leaves the
# marks out, the same command in both skills and in agents/implementer.md.
# Last, the blocks that run alike on BSD and GNU tools (worfy-windows ticket 07): the main-branch lock of
# skills/epic-wave, the branches of the last 14 days of skills/continuous-audit, the label and the checks section of
# the cross-machine gate (skills/ship-ticket step 8, skills/epic-wave section 1), with a stub gh.
# Run: bash harness/bin/tests/skill-blocks.test.sh; exit code 0 — everything passed.
# SKILL_FILE — check another copy of SKILL.md.
set -u
# The SKILL.md files under test are the copies in harness/skills, next to this test.
SKILLS="$(cd "$(dirname "$0")/../.." && pwd)/skills"
SKILL="${SKILL_FILE:-$SKILLS/overnight-fix-loop/SKILL.md}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$(dirname "$0")/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# The shells every block runs under. Git Bash on Windows has no zsh (worfy ADR-0055): there the zsh cases are
# skipped with one line. On macOS and Linux a missing zsh is a failure, not a skip.
SHELLS=(bash zsh)
# native <dir>: the path as a Node script on Windows reads it (C:/…, `pwd -W` of Git Bash); unchanged elsewhere.
# Paths written into the temporary registry and profiles go through it: the Node profile cannot match /tmp/….
native() { (cd "$1" && pwd -W 2>/dev/null) || printf '%s' "$1"; }
# jq for Windows ends its lines with CRLF. The test's own jq calls drop the CR; the skill blocks must drop it
# themselves, and the CRLF section below runs them with a jq that writes CRLF on any system.
jq() { command jq "$@" | tr -d '\r'; return "${PIPESTATUS[0]}"; }
case "$(uname -s)" in
    MINGW* | MSYS*) command -v zsh >/dev/null 2>&1 || { SHELLS=(bash); echo "skip zsh: Git Bash on Windows has no zsh, the zsh cases run on macOS and Linux"; } ;;
esac

block() { # $1 = a string that identifies the ```bash block; prints it without the `F() {…profile…}` line
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$SKILL" \
        | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}
STUB='F() { case "$1" in
  worktree.base) echo main ;;
  layout.packages) echo "[\"apps/api\",\"apps/web\"]" ;;
  modules) echo "{}" ;;
  tests.globs) echo "[\"*.test.ts\",\"*.spec.ts\"]" ;;
  *) return 4 ;;
esac; }'

R="$T/repo"; mkdir -p "$R/apps/api/src/auctions" "$R/apps/web/src/catalog" "$R/apps/api/test" "$R/apps/api/src/lots"
git -C "$R" init -q -b main
echo a >"$R/apps/api/src/auctions/a.ts"; echo b >"$R/apps/web/src/catalog/b.ts"; echo c >"$R/apps/api/src/lots/c.ts"
echo "import x from '../src/auctions/a'" >"$R/apps/api/test/auctions.test.ts"
echo "import y from './auctions/a'" >"$R/apps/api/src/z.spec.ts"
echo "import y from '../auctions/a'" >"$R/apps/api/src/lots/c.notatest.ts"
git -C "$R" add -A && git -C "$R" -c user.email=t@t -c user.name=t commit -q -m init

# Module-choice block: pathspec paths from layout.packages.
B1="$(block 'git log "$BASE" --since=30.days')"
[ -n "$B1" ] || bad "module-choice block not found in $SKILL"
want="$(printf '%s\n' apps/api/src/auctions apps/api/src/lots apps/web/src/catalog)"
for sh in "${SHELLS[@]}"; do
    got="$(cd "$R" && $sh -c "$STUB"$'\n'"$B1" 2>&1 | awk '{print $2}' | sort)"
    [ "$got" = "$want" ] && ok "$sh: module-choice block lists modules of every package" \
        || bad "$sh: module-choice block: got [$(echo $got)] want [$(echo $want)]"
done

# Module test-list block: --include globs from tests.globs.
B2="$(block 'grep -rslE')"
[ -n "$B2" ] || bad "test-list block not found in $SKILL"
B2="${B2//<каталог пакета>/$R/apps/api}"; B2="${B2//<имя>/auctions}"
want="$(printf '%s\n' src/z.spec.ts test/auctions.test.ts)"
for sh in "${SHELLS[@]}"; do
    got="$(cd "$R" && $sh -c "$STUB"$'\n'"$B2" 2>&1 | sort)"
    [ "$got" = "$want" ] && ok "$sh: test-list block finds test files by every glob" \
        || bad "$sh: test-list block: got [$(echo $got)] want [$(echo $want)]"
done

# --- skills/qmd: collections table from the profiles and index.yml -----------------------
QSKILL="${QMD_SKILL_FILE:-$SKILLS/qmd/SKILL.md}"
B3="$(SKILL="$QSKILL" block 'name profile.json')"
[ -n "$B3" ] || bad "qmd collections block not found in $QSKILL"
# Profiles in the Harness home (worfy-harness ticket 17: p3 with the collections qmd-collections
# writes) and, during the transition, in the old ~/.claude/profiles.
H="$T/home"; mkdir -p "$H/.claude/profiles/p1" "$H/.claude/profiles/p2" "$H/.claude/worfy-harness/projects/p3" "$H/.config/qmd"
echo '{"name":"p1","qmd":{"collections":["c1","c2"],"covers":"docs of p1"}}' >"$H/.claude/profiles/p1/profile.json"
echo '{"name":"p2"}' >"$H/.claude/profiles/p2/profile.json"
echo '{"name":"p3","qmd":{"collections":["p3-docs","p3-tickets","p3-memory"],"covers":"p3"}}' >"$H/.claude/worfy-harness/projects/p3/profile.json"
printf 'collections:\n  c1:\n    path: /x/one\n    pattern: "**/*.md"\n  c2:\n    path: /x/two\n  p3-docs:\n    path: "/x/three"\n    update: /p/qmd-sync-main p3\nmodels:\n  embed: e\n' >"$H/.config/qmd/index.yml"
want="$(printf 'p3: p3-docs, p3-tickets, p3-memory — p3\np1: c1, c2 — docs of p1\np2:  — no qmd field\nc1\t/x/one\nc2\t/x/two\np3-docs\t"/x/three"')"
for sh in "${SHELLS[@]}"; do
    got="$(HOME="$H" HARNESS_HOME= $sh -c "$B3" 2>&1)"
    [ "$got" = "$want" ] && ok "$sh: qmd block prints profile collections and index paths" \
        || bad "$sh: qmd block: got [$got] want [$want]"
done

# --- skills/tickets-to-tasks: tool and list template from the profile --------------------
TSKILL="${TASKS_SKILL_FILE:-$SKILLS/tickets-to-tasks/SKILL.md}"
B4="$(SKILL="$TSKILL" block 'tasks.tool')"
[ -n "$B4" ] || bad "tickets-to-tasks profile block not found in $TSKILL"
# The block calls ${CLAUDE_PLUGIN_ROOT}/bin/profile (the harness next to this test) against the live
# gate registry and profiles: it runs only when they and the repositories exist.
# Registry: $HOME/.claude/worfy-harness/gate/config.json, or the legacy $HOME/.claude/gate/config.json (read-only).
PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ATAKAMA="$HOME/Work/Atakama" AUCTION="$HOME/Work/Auction"
if { [ -f "$HOME/.claude/worfy-harness/gate/config.json" ] || [ -f "$HOME/.claude/gate/config.json" ]; } \
    && [ -d "$ATAKAMA/Atakama-Browser-Server" ] && [ -d "$AUCTION" ]; then
    for sh in "${SHELLS[@]}"; do
        got="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" $sh -c "${B4//<repo>/$ATAKAMA}" 2>&1)"
        # The profile lives in ~/.claude/profiles/atakama before the move to the Harness home and in
        # ~/.claude/worfy-harness/projects/atakama after it.
        tool="${got#*tool: }"; tool="${tool%%$'\n'*}"
        [[ "$got" == *"EXIT=0"* && "$got" == *"atakama-<slug>"* ]] && [ -f "$tool" ] \
            && { [ "$tool" = "$HOME/.claude/profiles/atakama/bin/tickets.mjs" ] || [ "$tool" = "$HOME/.claude/worfy-harness/projects/atakama/bin/tickets.mjs" ]; } \
            && ok "$sh: tickets-to-tasks block resolves the tool with ~ expanded" || bad "$sh: tickets-to-tasks atakama: [$got]"
        got="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" $sh -c "${B4//<repo>/$AUCTION}" 2>&1)"
        [[ "$got" == *"EXIT=4"* ]] && ok "$sh: tickets-to-tasks block: project without tasks -> 4" || bad "$sh: tickets-to-tasks auction: [$got]"
    done
else
    echo "skip tickets-to-tasks block: live registry or Atakama/Auction missing"
fi

# --- Silent mode blocks of skills/ship-ticket and skills/epic-wave ------------------------------
# A Silent project in a temporary HARNESS_HOME; the blocks call the real profile, ticket, epic-status and
# silent-check next to this test (CLAUDE_PLUGIN_ROOT = harness/).
SH="$T/silent"; SR="$SH/repo"; SW="$SH/wf"; SHH="$SH/hh"
mkdir -p "$SH/home" "$SHH/gate" "$SHH/projects/sp" "$SW/.scratch/pay-flow/issues"
git -C "$SH" init -q -b main repo && git -C "$SR" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$SR" branch fix/local-only && git -C "$SR" update-ref refs/remotes/origin/fix/pushed HEAD
printf '{"repos":[{"key":"sp","match":"%s","profile":"sp"}]}\n' "$(native "$SR")" >"$SHH/gate/config.json"
printf '{"schema":2,"name":"sp","mode":"silent","workflow":{"folder":"%s"}}\n' "$(native "$SW")" >"$SHH/projects/sp/profile.json"
tk() { printf '# %s — t\n\nStatus: %s\n%b' "$1" "$2" "${3:-}" >"$SW/.scratch/pay-flow/issues/$1-t.md"; }
# These blocks define F themselves (the real profile), so the F line stays in.
blockf() { awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$SKILL"; }
reset_tickets() {
    tk 01 open; tk 02 claimed 'Branch: fix/local-only\n'; tk 03 claimed 'Branch: fix/pushed\nRepo: repo\n'; tk 04 claimed; tk 05 claimed 'Branch: fix/gone\n'
}
git -C "$SW" init -q -b main
SENV=(env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR -u CLAUDE_PROFILE_BIN -u CLAUDE_TICKET_BIN HOME="$SH/home" HARNESS_HOME="$SHH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
      GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t)
SHIP="$SKILLS/ship-ticket/SKILL.md" WAVE="$SKILLS/epic-wave/SKILL.md"
sub() { local c="$1"; c="${c//<repo>/$SR}"; c="${c//<epic>/pay-flow}"; printf '%s' "$c"; }

B5="$(SKILL="$SHIP" blockf 'silent-check" -C <repo> "$b"')"
[ -n "$B5" ] || bad "Silent branch block not found in $SHIP"
B6="$(SKILL="$WAVE" blockf '.state!="open") | [.num')"
[ -n "$B6" ] || bad "Silent resume block not found in $WAVE"
B7="$(SKILL="$WAVE" blockf 'git -C "$W" add -A .')"
[ -n "$B7" ] || bad "Workflow folder commit block not found in $WAVE"
B8="$(SKILL="$WAVE" blockf 'gate: VERIFIED — $(date')"
[ -n "$B8" ] || bad "Silent verdict block not found in $WAVE"
for sh in "${SHELLS[@]}"; do
    reset_tickets
    # the branch named by the change: checked, then recorded in the ticket of the Workflow folder
    c="$(sub "$B5")"; c="${c//<kind>\/<what-the-change-does>/fix/pay-button-$sh}"; c="${c//<NN>/01}"
    got="$(cd "$SR" && "${SENV[@]}" $sh -c "$c" 2>&1)"
    [[ "$got" == *"EXIT=0"* && "$got" != *RENAME* ]] && grep -qx "Branch: fix/pay-button-$sh" "$SW/.scratch/pay-flow/issues/01-t.md" \
        && [ -z "$(git -C "$SR" status --porcelain)" ] && ok "$sh: Silent branch block checks the name and records Branch: in the Workflow folder" \
        || bad "$sh: Silent branch block: [$got]"
    c="$(sub "$B5")"; c="${c//<kind>\/<what-the-change-does>/pay-flow/01}"; c="${c//<NN>/01}"
    got="$(cd "$SR" && "${SENV[@]}" $sh -c "$c" 2>&1)"
    [[ "$got" == *RENAME* && "$got" == *'epic/NN "pay-flow/01"'* ]] && grep -qx "Branch: fix/pay-button-$sh" "$SW/.scratch/pay-flow/issues/01-t.md" \
        && ok "$sh: Silent branch block: a name with <epic>/<NN> -> RENAME, the ticket keeps its branch" \
        || bad "$sh: Silent branch block with a trace: [$got]"
    # resuming a wave by the Branch: lines
    want="$(printf '1\twork\tfix/pay-button-%s\tlocal branch\n2\twork\tfix/local-only\tlocal branch\n3\twork\tfix/pushed\ton origin only\n4\twork\t-\tno Branch: line\n5\twork\tfix/gone\tno such branch' "$sh")"
    git -C "$SR" branch "fix/pay-button-$sh" 2>/dev/null
    got="$(cd "$SH" && "${SENV[@]}" $sh -c "$(sub "$B6")" 2>&1)"
    [ "$got" = "$want" ] && ok "$sh: resume block reads the wave from Branch: lines (local, origin, none, missing)" \
        || bad "$sh: resume block: got [$got] want [$want]"
    # the verdict in the ticket file
    c="$(sub "$B8")"; c="${c//<NN>/02}"
    got="$(cd "$SH" && "${SENV[@]}" $sh -c "$c" 2>&1)"
    [ "$got" = 0 ] && grep -q "^gate: VERIFIED — " "$SW/.scratch/pay-flow/issues/02-t.md" && [ -z "$(git -C "$SR" status --porcelain)" ] \
        && ok "$sh: verdict block appends gate: VERIFIED to the ticket in the Workflow folder" || bad "$sh: verdict block: [$got]"
    # the local commit in the Workflow folder
    c="$(sub "$B7")"; c="${c//<NN>/02}"
    got="$(cd "$SH" && "${SENV[@]}" $sh -c "$c" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [ -z "$(git -C "$SW" status --porcelain)" ] && [ "$(git -C "$SW" log -1 --format=%s)" = "pay-flow: wave of tickets 02, 02 — statuses, state file" ] \
        && [ -z "$(git -C "$SW" remote)" ] && ok "$sh: Workflow folder block commits locally, no remote" || bad "$sh: Workflow folder commit: [$got]"
done
# Git for Windows prints --show-toplevel as C:/… while `pwd -P` of Git Bash says /c/…: a stand-in git that spells
# the top level that way. The block must still see the Workflow folder as a repository of its own.
WG="$T/wingit"; mkdir -p "$WG"; REAL_GIT="$(type -P git)"
printf '#!/usr/bin/env bash\ncase " $* " in *" --show-toplevel "*) out=$("%s" "$@") || exit $?; printf "C:%%s\\n" "$out" ;; *) exec "%s" "$@" ;; esac\n' "$REAL_GIT" "$REAL_GIT" >"$WG/git"
chmod +x "$WG/git"
reset_tickets
got="$(cd "$SH" && "${SENV[@]}" PATH="$WG:$PATH" bash -c "$(sub "$B7")" 2>&1)"
[[ "$(PATH="$WG:$PATH" git -C "$SW" rev-parse --show-toplevel)" == C:* ]] && [[ "$got" == *"EXIT=0"* ]] && [ -z "$(git -C "$SW" status --porcelain)" ] \
    && ok "Workflow folder block: a top level spelled C:/… (Git for Windows) still commits" || bad "Workflow folder with a C:/ top level: [$got] [$(git -C "$SW" status --porcelain)]"
# A folder inside another repository is not a repository of its own.
git -C "$T" init -q outer && mkdir -p "$T/outer/sub" && echo x >"$T/outer/sub/f"
c="$(sub "$B7")"; c="${c//'W=$(F _resolved.workflow_folder)'/W=$T/outer/sub}"
got="$(cd "$SH" && "${SENV[@]}" bash -c "$c" 2>&1)"
[[ "$got" == *"not a git repository of its own"* ]] && [ -z "$(git -C "$T/outer" log --oneline 2>/dev/null)" ] \
    && ok "Workflow folder block: a folder inside another repository -> nothing to commit" || bad "Workflow folder inside another repository: [$got]"
mv "$SW/.git" "$SH/wf.git"
got="$(cd "$SH" && "${SENV[@]}" bash -c "$(sub "$B7")" 2>&1)"
[[ "$got" == *"not a git repository of its own"* ]] && ok "Workflow folder block: a folder without its own git -> nothing to commit" || bad "Workflow folder without git: [$got]"

# --- the agents' marks (worfy ADR-0067): the review mark blocks and the CI filter -------------------------
# A stub gh first in PATH: `pr checks … --jq <filter>` applies the filter (real jq) to $GH_CHECKS; any other call is
# only logged. No token reaches it, and nothing reaches GitHub.
GHS="$T/ghstub"; mkdir -p "$GHS"
cat >"$GHS/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
if [ "$1 $2" = "pr checks" ]; then
  f=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && f=$2; shift; done
  set -o pipefail; jq -r "$f" "$GH_CHECKS" | tr -d '\r'; exit $?
fi
exit 0
EOF
chmod +x "$GHS/gh"
GH_LOG="$T/gh.log"; : >"$GH_LOG"
MENV=(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$GHS:$PATH" GH_LOG="$GH_LOG")
# ticket runs gh by name from node, which on Windows finds the real gh.exe, not the stub: there a mark that went
# to GitHub would run the stub through a node stand-in ($TICKET_GH). The guard stops the test if any gh the
# blocks can start is not the stub; GH_CONFIG_DIR is empty, so a real gh reached anyway has no credentials.
. "$(dirname "$0")/gh-stand-in.sh"
if on_windows; then node_stand_in "$GHS/gh" "$GHS/gh.mjs"; MENV+=(TICKET_GH="$GHS/gh.mjs"); fi
MENV+=(GH_CONFIG_DIR="$T/gh-config")
( PATH="$GHS:$PATH"; on_windows && export TICKET_GH="$GHS/gh.mjs"; gh_guard TICKET_GH "$GHS/gh" "$GHS/gh.mjs" ) || exit 1
# The review mark: the blocks of both skills, with the real ticket and a Silent project — the marks go to
# $HARNESS_HOME/runs/sp/marks/pay-flow-02.json, gh is never called.
HEAD_SHA="$(git -C "$SR" rev-parse HEAD)"
M="$SHH/runs/sp/marks/pay-flow-02.json"
for skill in "$WAVE" "$SHIP"; do
    BR="$(SKILL="$skill" blockf 'mark <epic> <NN> review pending --sha "$sha"')"
    name="$(basename "$(dirname "$skill")")"
    [ -n "$BR" ] || { bad "$name: the review mark block not found"; continue; }
    for sh in "${SHELLS[@]}"; do
        rm -f "$M"; reset_tickets
        c="$(sub "$BR")"; c="${c//<NN>/02}"; c="${c//<implementer worktree>/$SR}"; c="${c//<worktree>/$SR}"
        got="$(cd "$SH" && "${SENV[@]}" "${MENV[@]}" $sh -c "$c" 2>&1)"
        marks="$(jq -r '[.marks[] | "\(.kind) \(.verdict) \(.sha)"] | join(",")' "$M" 2>&1)"
        [ "$(grep -c 'EXIT=0' <<<"$got")" = 2 ] && [ "$marks" = "review pending $HEAD_SHA,review success $HEAD_SHA" ] \
            && ok "$sh: $name review mark block: pending, then success, on the head SHA (Silent: the marks file)" || bad "$sh: $name review mark block: [$got] marks [$marks]"
    done
done
[ ! -s "$GH_LOG" ] && [ -z "$(git -C "$SR" status --porcelain)" ] && ok "review mark blocks in Silent mode: no gh call, nothing in the repository" || bad "review mark blocks: gh [$(cat "$GH_LOG")] repo [$(git -C "$SR" status --porcelain)]"
# The CI filter: the same command in both skills and in agents/implementer.md, leaving out the names
# `ticket mark --contexts` prints.
# Only commit statuses are marks: gh gives a status an empty `workflow` (an Actions job has its workflow's name).
CI_FILTER='select(.workflow == "" and (.name == "review" or .name == "deploy" or (.name | startswith("check/"))) | not)'
[ "$(node "$PLUGIN_ROOT/bin/ticket" mark --contexts | tr '\n' ' ')" = "review check/* deploy " ] && ok "ticket mark --contexts: review, check/*, deploy — the names the CI filter leaves out" || bad "ticket mark --contexts: $(node "$PLUGIN_ROOT/bin/ticket" mark --contexts)"
BCI_W="$(SKILL="$WAVE" blockf 'gh pr checks <N> --json name,bucket,workflow')"; BCI_S="$(SKILL="$SHIP" blockf 'gh pr checks <N> --json name,bucket,workflow')"
IMPL="$(cd "$SKILLS/.." && pwd)/agents/implementer.md"
[ -n "$BCI_W" ] && [ "$BCI_W" = "$BCI_S" ] && [[ "$BCI_W" == *"$CI_FILTER"* ]] && grep -qF -- "${BCI_W%$'\n'}" "$IMPL" \
    && ok "the CI filter: one command in epic-wave, ship-ticket and agents/implementer.md" || bad "the CI filter differs: [$BCI_W] [$BCI_S]"
ci_case() { # ci_case <want> <checks JSON>
    printf '%s\n' "$2" >"$T/checks.json"
    for sh in "${SHELLS[@]}"; do
        got="$("${MENV[@]}" GH_CHECKS="$T/checks.json" $sh -c "${BCI_W//<N>/7}" 2>&1)"
        [ "$got" = "$1"$'\n'"EXIT=0" ] && ok "$sh: CI filter $2 -> $1" || bad "$sh: CI filter $2: [$got] want $1"
    done
}
# a job of GitHub Actions has its workflow's name; a commit status — a mark among them — has "".
j() { printf '{"name":"%s","bucket":"%s","workflow":"CI"}' "$1" "$2"; }
st() { printf '{"name":"%s","bucket":"%s","workflow":""}' "$1" "$2"; }
ci_case CI=pass "[$(j unit pass),$(st review fail)]"
ci_case CI=pass "[$(j unit pass),$(st check/windows fail),$(st deploy fail),$(j e2e skipping)]"
ci_case CI=fail "[$(j unit pass),$(j lint fail),$(st review pass)]"
ci_case CI=fail "[$(j unit cancel)]"
ci_case CI=fail "[$(st reviewers fail)]"
ci_case CI=pending "[$(j unit pending),$(st review fail)]"
ci_case CI=none "[$(st review pass),$(st check/windows pending)]"
# an Actions job named like a mark is CI: a red job `deploy` is red CI, and a red status `deploy` is not
ci_case CI=fail "[$(j unit pass),$(j deploy fail)]"
ci_case CI=fail "[$(j unit pass),$(j review fail),$(j check/windows fail)]"
ci_case CI=pass "[$(j unit pass),$(j deploy pass),$(st deploy fail)]"

# --- blocks alike on BSD and GNU tools (worfy-windows ticket 07, worfy ADR-0055 item 6) -----------------------------
# The main-branch lock of skills/epic-wave, section 4. The loop is bounded: each round counts, and after three the
# block exits with IDLE — so a loop that spins without sleeping (BSD `stat -f %m` under GNU stat fails, and
# `|| continue` skips the sleep) ends the case instead of hanging the run. `sleep 30` becomes a no-op.
BL="$(SKILL="$WAVE" block '<orchestrator scratchpad>/main.lock')"
[ -n "$BL" ] || bad "main-branch lock block not found in $WAVE"
BL="${BL//<orchestrator scratchpad>/$T/lk}"
pat='until mkdir "$L" 2>/dev/null; do'
rep='until mkdir "$L" 2>/dev/null; do n=$((n+1)); [ "$n" -le 3 ] || { echo IDLE; exit 7; };'
BL="${BL//"$pat"/$rep}"
BL="${BL//sleep 30/:}"
[[ "$BL" == *'echo IDLE'* && "$BL" != *'sleep 30'* ]] || bad "main-branch lock block: the round bound did not go in: [$BL]"
two_hours_ago="$(perl -MPOSIX -e 'print strftime("%Y%m%d%H%M", localtime(time - 7200))')"
for sh in "${SHELLS[@]}"; do
    rm -rf "$T/lk"; mkdir -p "$T/lk/main.lock"; touch -t "$two_hours_ago" "$T/lk/main.lock"
    got="$($sh -c "$BL" 2>&1)"; rc=$?
    [ "$rc" = 0 ] && [ "$got" = LOCKED ] && [ ! -e "$T/lk/main.lock" ] \
        && ok "$sh: main-branch lock: a lock two hours old is removed and taken again (LOCKED), then released" \
        || bad "$sh: main-branch lock, stale: exit $rc [$got]"
    rm -rf "$T/lk"; mkdir -p "$T/lk/main.lock"
    got="$($sh -c "$BL" 2>&1)"; rc=$?
    [ "$rc" = 7 ] && [ "$got" = IDLE ] && [ -d "$T/lk/main.lock" ] \
        && ok "$sh: main-branch lock: a fresh lock stays, the block waits" || bad "$sh: main-branch lock, fresh: exit $rc [$got]"
done

# The branches of the last 14 days, skills/continuous-audit: origin/old (a commit 20 days ago) is left out,
# origin/new (1 day ago) is read; epic-status is a stub that answers for the ref it is given.
ASKILL="${AUDIT_SKILL_FILE:-$SKILLS/continuous-audit/SKILL.md}"
BA="$(SKILL="$ASKILL" block 'live-tickets.jsonl')"
[ -n "$BA" ] || bad "branches-of-14-days block not found in $ASKILL"
[[ "$BA" == *'"${TMPDIR:-/tmp}/live-tickets.jsonl"'* ]] && ok "branches-of-14-days block writes to \${TMPDIR:-/tmp}" || bad "branches-of-14-days block: no \${TMPDIR:-/tmp}: [$BA]"
AU="$T/audit"; mkdir -p "$AU/plugin/bin" "$AU/tmp"
cat >"$AU/plugin/bin/epic-status" <<'EOF'
#!/usr/bin/env bash
# epic-status stub: one open and one done ticket on the ref of --ref.
b=""; while [ $# -gt 0 ]; do [ "$1" = --ref ] && b=$2; shift; done
printf '{"ref":"%s","tickets":[{"ref":"%s","epic":"e","num":"01","slug":"s","title":"t","state":"open"},{"ref":"%s","epic":"e","num":"02","slug":"d","title":"d","state":"done"}]}\n' "$b" "$b" "$b"
EOF
chmod +x "$AU/plugin/bin/epic-status"
git -C "$AU" init -q -b main repo
now="$(date +%s)"
for b in old:20 new:1; do
    GIT_COMMITTER_DATE="$((now - ${b#*:} * 86400)) +0000" GIT_AUTHOR_DATE="$((now - ${b#*:} * 86400)) +0000" \
        git -C "$AU/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "${b%%:*}"
    git -C "$AU/repo" update-ref "refs/remotes/origin/${b%%:*}" HEAD
done
for sh in "${SHELLS[@]}"; do
    rm -f "$AU/tmp/live-tickets.jsonl"
    got="$(cd "$AU/repo" && CLAUDE_PLUGIN_ROOT="$AU/plugin" TMPDIR="$AU/tmp" $sh -c "$BA" 2>&1)"
    live="$(cat "$AU/tmp/live-tickets.jsonl" 2>&1)"
    [ "$live" = '["origin/new","e","01","s","t"]' ] && ok "$sh: branches-of-14-days block reads origin/new only, open tickets only" \
        || bad "$sh: branches-of-14-days block: [$got] live-tickets [$live]"
done

# The cross-machine gate (worfy ADR-0069): a project with cross_machine_gate in the sandbox HARNESS_HOME, and a stub
# gh: `--jq <filter>` applies the filter (real jq) to $GH_JSON, `--body-file <f>` keeps a copy of <f> in $GH_BODY_OUT,
# every call is logged. No token reaches it, and nothing reaches GitHub.
CM="$T/cm"; CR="$CM/repo"; mkdir -p "$CM" "$SHH/projects/cm"
git -C "$CM" init -q --bare -b main origin.git && git -C "$CM" clone -q origin.git repo 2>/dev/null
printf '{"repos":[{"key":"sp","match":"%s","profile":"sp"},{"key":"cm","match":"%s","profile":"cm"}]}\n' "$(native "$SR")" "$(native "$CR")" >"$SHH/gate/config.json"
printf '%s\n' '{"schema":2,"name":"cm","mode":"full","tickets":{"branch":"<эпик>/<NN>"},"worktree":{"base":"origin/main"},"cross_machine_gate":{"label":"needs-mac-gate","role":"request","exempt":[".scratch/","docs/","HANDOFF.md"],"checks_section":"Mac checks"}}' >"$SHH/projects/cm/profile.json"
GHX="$T/ghx"; mkdir -p "$GHX"
cat >"$GHX/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"; echo "$*" >>"$GH_ALL"
f=""; prev=""
for a in "$@"; do
  [ "$prev" = --jq ] && f=$a
  [ "$prev" = --body-file ] && cp "$a" "$GH_BODY_OUT"
  prev=$a
done
[ -n "${GH_FAIL:-}" ] && { echo "HTTP 502: Bad Gateway (https://api.github.com/graphql)" >&2; exit 1; }
[ -n "${GH_BODY_RAW:-}" ] && [[ " $* " == *" --json body "* ]] && { cat "$GH_BODY_RAW"; exit 0; }
if [ -n "$f" ]; then set -o pipefail; jq -r "$f" "$GH_JSON" | tr -d '\r'; exit $?; fi
exit 0
EOF
chmod +x "$GHX/gh"
refusing_gh_exe "$GHX/gh"
( PATH="$GHX:$PATH"; gh_guard - "$GHX/gh" "$GHX/gh" ) || exit 1
XENV=(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$GHX:$PATH" GH_LOG="$T/ghx.log" GH_ALL="$T/ghx-all.log" GH_JSON="$T/ghx.json" GH_BODY_OUT="$T/ghx-body.md" GH_CONFIG_DIR="$T/gh-config")

# The label block of skills/ship-ticket, step 8: the PR's files against cross_machine_gate.exempt.
BLB="$(SKILL="$SHIP" blockf 'cross_machine_gate.exempt')"
[ -n "$BLB" ] || bad "label block not found in $SHIP"
printf -- '- `pnpm icons` — exit 0\n' >"$T/section.md"
BLB="$(sub "${BLB//<repo>/$CR}")"; BLB="${BLB//<N>/7}"; BLB="${BLB//<scratchpad>/$T}"; BLB="${BLB//<section file>/$T/section.md}"
label_case() { # label_case <want: label|no-label> <name> <body> <file>...
    local want="$1" name="$2" body="$3" sh got; shift 3
    jq -n --arg body "$body" '{body: $body, files: [$ARGS.positional[] | {path: .}]}' --args "$@" >"$T/ghx.json"
    for sh in "${SHELLS[@]}"; do
        : >"$T/ghx.log"; rm -f "$T/ghx-body.md" "$T/pr-7-body.md"
        got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BLB" 2>&1)"
        if [ "$want" = no-label ]; then
            [ "$got" = no-label ] && ! grep -q '^pr edit' "$T/ghx.log" && [ ! -e "$T/ghx-body.md" ] \
                && ok "$sh: label block, $name -> no-label, gh pr edit not called" || bad "$sh: label block, $name: [$got] gh [$(cat "$T/ghx.log")]"
        else
            [ "$got" = $'label\nEXIT=0' ] && grep -qxF 'pr edit 7 --add-label needs-mac-gate --body-file '"$T/pr-7-body.md" "$T/ghx.log" \
                && grep -qxF 'Old description.' "$T/ghx-body.md" && grep -qxF '## Mac checks' "$T/ghx-body.md" && grep -qxF -- '- `pnpm icons` — exit 0' "$T/ghx-body.md" \
                && [ "$(grep -c '^## Mac checks$' "$T/ghx-body.md")" = 1 ] \
                && ok "$sh: label block, $name -> label, --add-label needs-mac-gate and --body-file with the old description and ## Mac checks" \
                || bad "$sh: label block, $name: [$got] gh [$(cat "$T/ghx.log")] body [$(cat "$T/ghx-body.md" 2>&1)]"
        fi
    done
}
label_case no-label "files in exempt folders and an exempt file" 'Old description.' .scratch/worfy-windows/issues/07-t.md docs/adr/0069-x.md HANDOFF.md
label_case label "one file outside exempt" 'Old description.' docs/adr/0069-x.md harness/skills/epic-wave/SKILL.md
label_case label "a folder entry covers only paths under it (docsx/)" 'Old description.' docsx/a.md
label_case label "a file entry is the whole path (HANDOFF.md.bak)" 'Old description.' HANDOFF.md.bak
label_case label "a description that already has the section gets no second one" $'Old description.\n\n## Mac checks\n\n- `pnpm icons` — exit 0' harness/x.sh
label_error_case() { # label_error_case <name> <env assignment> <ERROR text> <file>...: gh fails or lists no files -> ERROR, never no-label
    local name="$1" e="$2" msg="$3" sh got; shift 3
    jq -n --arg body 'Old description.' '{body: $body, files: [$ARGS.positional[] | {path: .}]}' --args "$@" >"$T/ghx.json"
    for sh in "${SHELLS[@]}"; do
        : >"$T/ghx.log"; rm -f "$T/ghx-body.md"
        got="$("${SENV[@]}" "${XENV[@]}" $e $sh -c "$BLB" 2>&1)"
        grep -q "^ERROR: .*$msg" <<<"$got" && [[ "$got" != *no-label* ]] && ! grep -q '^pr edit' "$T/ghx.log" \
            && ok "$sh: label block, $name -> ERROR, no label decision, gh pr edit not called" || bad "$sh: label block, $name: [$got] gh [$(cat "$T/ghx.log")]"
    done
}
label_error_case "gh answers HTTP 502" GH_FAIL=1 'failed' harness/x.sh
label_error_case "the PR lists no files yet" GH_FAIL= 'lists no files'
# A description edited on the web comes with CRLF: its section is found, no second one is added.
jq -n '{body: "Old description.", files: [{path: "harness/x.sh"}]}' >"$T/ghx.json"
printf 'Old description.\r\n\r\n## Mac checks\r\n\r\n- `pnpm icons` — exit 0\r\n' >"$T/ghx-crlf-body.md"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"; rm -f "$T/ghx-body.md"
    got="$("${SENV[@]}" "${XENV[@]}" GH_BODY_RAW="$T/ghx-crlf-body.md" $sh -c "$BLB" 2>&1)"
    [ "$got" = $'label\nEXIT=0' ] && [ "$(tr -d '\r' <"$T/ghx-body.md" | grep -c '^## Mac checks$')" = 1 ] \
        && ok "$sh: label block, a CRLF description that has the section gets no second one" || bad "$sh: label block, CRLF description: [$got] body [$(cat "$T/ghx-body.md" 2>&1)]"
done

# The checks section block of skills/epic-wave, section 1: the section's lines up to the next heading.
BCS="$(SKILL="$WAVE" blockf 'no-section')"
[ -n "$BCS" ] || bad "checks section block not found in $WAVE"
BCS="$(sub "${BCS//<repo>/$CR}")"; BCS="${BCS//<N>/7}"
section_case() { # section_case <name> <want> <body>
    jq -n --arg body "$3" '{body: $body}' >"$T/ghx.json"
    for sh in "${SHELLS[@]}"; do
        got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BCS" 2>&1)"
        [ "$got" = "$2" ] && ok "$sh: checks section block, $1" || bad "$sh: checks section block, $1: got [$got] want [$2]"
    done
}
TWO=$'- `pnpm icons` — exit 0\n- `git add --renormalize . && git status --porcelain` — empty output'
section_case "two commands, the next heading ends the section" "$TWO" \
    $'Intro.\n\n## Mac checks\n\n- `pnpm icons` — exit 0\n- `git add --renormalize . && git status --porcelain` — empty output\n\n## Windows checks\n\n- `bash x.test.sh` — exit 0'
section_case "CRLF line ends" "$TWO" \
    $'Intro.\r\n\r\n## Mac checks\r\n\r\n- `pnpm icons` — exit 0\r\n- `git add --renormalize . && git status --porcelain` — empty output\r\n'
section_case "none" none $'## Summary\n\nx\n\n## Mac checks\n\nnone\n'
section_case "no section" no-section $'## Summary\n\nNo checks here.\n\n## Windows checks\n\n- `x` — exit 0'
section_case "a level-1 heading ends it too" '- `a` — exit 0' $'## Mac checks\n- `a` — exit 0\n# Notes\n- `b` — exit 0'
section_case "a level-3 heading stays in the section" $'- `a` — exit 0\n### Notes\n- `b` — exit 0' $'## Mac checks\n- `a` — exit 0\n### Notes\n- `b` — exit 0\n## Next\n- `c`'
section_case "a # comment inside a code block stays in the section" $'```bash\n# comment\npnpm icons\n```\n- `b` — exit 0' \
    $'## Mac checks\n\n```bash\n# comment\npnpm icons\n```\n- `b` — exit 0\n\n## Next\n- `c`'
section_case "an empty section" no-section $'## Mac checks\n\n## Windows checks\n\n- `x` — exit 0'

# The serve rebase block and the request fresh-base block of skills/epic-wave section 1, with F worktree.base
# origin/main as in the live profile: the PR branch is rebased onto origin/main and pushed; the detached worktree
# of the base is created on origin/main and removed.
G=(-c user.email=t@t -c user.name=t)
git -C "$CR" "${G[@]}" commit -q --allow-empty -m base && git -C "$CR" push -q origin main 2>/dev/null
git -C "$CR" checkout -q -b feature && echo f >"$CR/f.txt" && git -C "$CR" add f.txt && git -C "$CR" "${G[@]}" commit -q -m feature \
    && git -C "$CR" push -q origin feature 2>/dev/null && git -C "$CR" checkout -q main
git -C "$CM" clone -q origin.git other 2>/dev/null && git -C "$CM/other" "${G[@]}" commit -q --allow-empty -m moved && git -C "$CM/other" push -q origin main 2>/dev/null
git -C "$CR" worktree add -q "$CM/prwt" feature 2>/dev/null && git -C "$CR" branch -q --set-upstream-to=origin/feature feature
BSV="$(SKILL="$WAVE" blockf 'push --force-with-lease; echo')"
[ -n "$BSV" ] || bad "serve rebase block not found in $WAVE"
BSV="$(sub "${BSV//<repo>/$CR}")"; BSV="${BSV//<PR worktree>/$CM/prwt}"
got="$("${SENV[@]}" bash -c "$BSV" 2>&1)"
tip="$(git -C "$CM/other" rev-parse HEAD)"
[ "$(grep -c '^EXIT=0$' <<<"$got")" = 2 ] && [ "$(git -C "$CM/prwt" rev-parse HEAD~1)" = "$tip" ] \
    && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$(git -C "$CM/prwt" rev-parse HEAD)" ] \
    && ok "serve rebase block: base origin/main — rebased onto the moved origin/main and pushed" || bad "serve rebase block: [$got]"
BRQ="$(SKILL="$WAVE" blockf 'base-gate "$B"')"
[ -n "$BRQ" ] || bad "request fresh-base block not found in $WAVE"
BRQ="$(sub "${BRQ//<repo>/$CR}")"; BRQ="${BRQ//<scratchpad>/$CM}"; BRQ="${BRQ//<F commands.prepare_tree>/git rev-parse HEAD}"
got="$("${SENV[@]}" bash -c "$BRQ" 2>&1 | grep -E '^(EXIT=|[0-9a-f]{40}$)')"   # git's progress lines dropped
[ "$got" = "EXIT=0"$'\n'"$tip"$'\n'"EXIT=0" ] && [ ! -e "$CM/base-gate" ] \
    && ok "request fresh-base block: base origin/main — a detached worktree on origin/main, removed after" || bad "request fresh-base block: [$got] want [EXIT=0 $tip EXIT=0]"

# The open PRs of other epics, skills/epic-wave section 1: every file of each open PR whose branch does not match
# this epic's tickets.branch (<эпик>/<NN>, the epic is pay-flow here), filtered by gh's own --jq.
BOP="$(SKILL="$WAVE" blockf 'gh pr list --state open --limit 200 --json number,headRefName,files')"
[ -n "$BOP" ] || bad "open PRs of other epics block not found in $WAVE"
BOP="$(sub "${BOP//<repo>/$CR}")"
printf '%s\n' '[{"number":1,"headRefName":"pay-flow/03","files":[{"path":"src/a.ts"}]},
 {"number":2,"headRefName":"worfy-link/05","files":[{"path":"src/x.ts"},{"path":"HANDOFF.md"}]},
 {"number":3,"headRefName":"pay-flow/03-extra","files":[{"path":"src/z.ts"}]},
 {"number":4,"headRefName":"fix/empty","files":[]}]' >"$T/ghx.json"
want='#2 worfy-link/05 src/x.ts
#2 worfy-link/05 HANDOFF.md
#3 pay-flow/03-extra src/z.ts
EXIT=0'
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BOP" 2>&1)"
    [ "$got" = "$want" ] && [ "$(grep -c '^pr list' "$T/ghx.log")" = 1 ] \
        && ok "$sh: open PRs of other epics: every file of the PRs off the epic's branch template, own PRs left out" \
        || bad "$sh: open PRs of other epics: got [$got] want [$want]"
done
echo "stub gh calls of the cross-machine and open-PR cases: $(wc -l <"$T/ghx-all.log" | tr -d ' ')"

# --- jq for Windows writes CRLF: the blocks that read jq's output, run with a jq that turns LF into CRLF ----------
CRJ="$T/crlfjq"; mkdir -p "$CRJ"; REAL_JQ="$(type -P jq)"   # type -P: the jq() function above would make command -v print "jq" and the wrapper call itself
[[ "$REAL_JQ" == /* ]] || { echo "FAIL: no jq binary on PATH" >&2; exit 1; }
printf '#!/usr/bin/env bash\nset -o pipefail\n"%s" "$@" | perl -pe '"'"'s/\\n/\\r\\n/'"'"'\n' "$REAL_JQ" >"$CRJ/jq"
chmod +x "$CRJ/jq"
[ "$(printf '[1]' | "$CRJ/jq" -c . | od -An -c | tr -d ' \n')" = '[1]\r\n' ] && ok "the CRLF jq writes CRLF" || bad "the CRLF jq: $(printf '[1]' | "$CRJ/jq" -c . | od -c | head -n 1)"
got="$(cd "$R" && PATH="$CRJ:$PATH" bash -c "${STUB//'modules) echo "{}"'/modules) echo '{\"skip\":[\"lots\"]}'}"$'\n'"$B1" 2>&1 | awk '{print $2}' | sort)"
want="$(printf '%s\n' apps/api/src/auctions apps/web/src/catalog)"
[ "$got" = "$want" ] && ok "CRLF jq: module-choice block with modules.skip (overnight-fix-loop)" || bad "CRLF jq: module-choice block: [$got]"
got="$(cd "$R" && PATH="$CRJ:$PATH" bash -c "$STUB"$'\n'"$B2" 2>&1 | sort)"
[ "$got" = "$(printf '%s\n' src/z.spec.ts test/auctions.test.ts)" ] && ok "CRLF jq: test-list block (overnight-fix-loop)" || bad "CRLF jq: test-list block: [$got]"
got="$(HOME="$H" HARNESS_HOME= PATH="$CRJ:$PATH" bash -c "$B3" 2>&1)"
want="$(printf 'p3: p3-docs, p3-tickets, p3-memory — p3\np1: c1, c2 — docs of p1\np2:  — no qmd field\nc1\t/x/one\nc2\t/x/two\np3-docs\t"/x/three"')"
[ "$got" = "$want" ] && ok "CRLF jq: qmd collections block" || bad "CRLF jq: qmd block: [$got]"
rm -f "$AU/tmp/live-tickets.jsonl"
(cd "$AU/repo" && CLAUDE_PLUGIN_ROOT="$AU/plugin" TMPDIR="$AU/tmp" PATH="$CRJ:$PATH" bash -c "$BA" >/dev/null 2>&1)
[ "$(cat "$AU/tmp/live-tickets.jsonl" 2>&1)" = '["origin/new","e","01","s","t"]' ] && ok "CRLF jq: branches-of-14-days block writes no CR" || bad "CRLF jq: branches-of-14-days: [$(od -c "$AU/tmp/live-tickets.jsonl" | head -n 3)]"
last="${SHELLS[${#SHELLS[@]}-1]}"
reset_tickets; git -C "$SW" -c user.email=t@t -c user.name=t add -A >/dev/null 2>&1
want="$(printf '1\twork\tfix/pay-button-%s\tlocal branch\n2\twork\tfix/local-only\tlocal branch\n3\twork\tfix/pushed\ton origin only\n4\twork\t-\tno Branch: line\n5\twork\tfix/gone\tno such branch' "$last")"
tk 01 claimed "Branch: fix/pay-button-$last\n"
got="$(cd "$SH" && "${SENV[@]}" PATH="$CRJ:$PATH" bash -c "$(sub "$B6")" 2>&1)"
[ "$got" = "$want" ] && ok "CRLF jq: the Silent resume block (epic-wave)" || bad "CRLF jq: resume block: got [$(printf '%s' "$got" | od -c | head -n 4)]"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
