#!/usr/bin/env bash
# The shell blocks of skills/overnight-fix-loop/SKILL.md that split a string into words,
# under bash and under zsh (the Claude Code Bash tool runs zsh, and zsh does not split an
# unquoted variable into words). The blocks are cut out of SKILL.md itself; the profile is replaced by a stub F.
# Below — the blocks of skills/qmd (collections table) and skills/tickets-to-tasks (tool from the profile), and
# the Silent mode blocks of skills/ship-ticket and skills/epic-wave: the branch named by
# the change, the verdict in the ticket file, the local commit in the Workflow folder, resuming a wave by Branch:.
# Then the agents' marks: the review mark blocks of both skills, and the CI filter that leaves the
# marks out, the same command in both skills and in agents/implementer.md.
# Last, the blocks that run alike on BSD and GNU tools: the main-branch lock of
# skills/epic-wave, the branches of the last 14 days of skills/continuous-audit, the blocks that read jq's output
# with a jq that writes CRLF, and the tree of the main branch. The blocks of the cross-machine gate are in
# skill-blocks-gate.test.sh; the world both files share (render, the block cutters, the Silent project) is in
# skill-blocks-world.sh.
# Every block runs on the text Claude Code hands the model when the skill is called with arguments (render).
# Run: bash harness/bin/tests/skill-blocks.test.sh; exit code 0 — everything passed.
# SKILL_FILE — check another copy of SKILL.md; SKILL_ARGS — the arguments of the call (default ten words, a to j).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/skill-blocks-world.sh"

STUB='F() { case "$1" in
  worktree.base) echo main ;;
  layout.packages) echo "[\"apps/api\",\"apps/web\"]" ;;
  modules) echo "{}" ;;
  tests.globs) echo "[\"*.test.ts\",\"*.spec.ts\"]" ;;
  *) return 4 ;;
esac; }'

R="$T/repo"; mkdir -p "$R/apps/api/src/carts" "$R/apps/web/src/catalog" "$R/apps/api/test" "$R/apps/api/src/lots"
git -C "$R" init -q -b main
echo a >"$R/apps/api/src/carts/a.ts"; echo b >"$R/apps/web/src/catalog/b.ts"; echo c >"$R/apps/api/src/lots/c.ts"
echo "import x from '../src/carts/a'" >"$R/apps/api/test/carts.test.ts"
echo "import y from './carts/a'" >"$R/apps/api/src/z.spec.ts"
echo "import y from '../carts/a'" >"$R/apps/api/src/lots/c.notatest.ts"
git -C "$R" add -A && git -C "$R" -c user.email=t@t -c user.name=t commit -q -m init

# Module-choice block: pathspec paths from layout.packages.
B1="$(block 'git log "$BASE" --since=30.days')"
[ -n "$B1" ] || bad "module-choice block not found in $SKILL"
want="$(printf '%s\n' apps/api/src/carts apps/api/src/lots apps/web/src/catalog)"
for sh in "${SHELLS[@]}"; do
    got="$(cd "$R" && $sh -c "$STUB"$'\n'"$B1" 2>&1 | awk '{print $2}' | sort)"
    [ "$got" = "$want" ] && ok "$sh: module-choice block lists modules of every package" \
        || bad "$sh: module-choice block: got [$(echo $got)] want [$(echo $want)]"
done

# Module test-list block: --include globs from tests.globs.
B2="$(block 'grep -rslE')"
[ -n "$B2" ] || bad "test-list block not found in $SKILL"
B2="${B2//<package dir>/$R/apps/api}"; B2="${B2//<name>/carts}"
want="$(printf '%s\n' src/z.spec.ts test/carts.test.ts)"
for sh in "${SHELLS[@]}"; do
    got="$(cd "$R" && $sh -c "$STUB"$'\n'"$B2" 2>&1 | sort)"
    [ "$got" = "$want" ] && ok "$sh: test-list block finds test files by every glob" \
        || bad "$sh: test-list block: got [$(echo $got)] want [$(echo $want)]"
done

# --- skills/qmd: collections table from the profiles and index.yml -----------------------
QSKILL="${QMD_SKILL_FILE:-$SKILLS/qmd/SKILL.md}"
B3="$(SKILL="$QSKILL" block 'name profile.json')"
[ -n "$B3" ] || bad "qmd collections block not found in $QSKILL"
# Profiles in the Harness home (p3 with the collections qmd-collections
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
# The block calls ${CLAUDE_PLUGIN_ROOT}/bin/profile (the harness next to this test) against a temporary
# registry and profiles in a temporary home: project suite names a tool under ~ and a list template,
# project acme does not import tickets into Tasks.
TH="$T/tasks-home"; THH="$TH/.claude/worfy-harness"
mkdir -p "$T/tasks/suite-api" "$T/tasks/acme" "$THH/gate" "$THH/projects/suite/bin" "$THH/projects/acme"
for r in suite-api acme; do git -C "$T/tasks/$r" init -q; done
echo '// stand-in tool' >"$THH/projects/suite/bin/tickets.mjs"
echo '{"schema":1,"name":"suite","tasks":{"tool":"~/.claude/worfy-harness/projects/suite/bin/tickets.mjs","list_id":"suite-<slug>"}}' >"$THH/projects/suite/profile.json"
echo '{"schema":1,"name":"acme"}' >"$THH/projects/acme/profile.json"
printf '{"repos":[{"key":"suite-api","match":"%s","profile":"suite"},{"key":"acme","match":"%s","profile":"acme"}]}\n' \
    "$(native "$T/tasks/suite-api")" "$(native "$T/tasks/acme")" >"$THH/gate/config.json"
TENV=(env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR -u CLAUDE_PROFILE_BIN HOME="$TH" USERPROFILE="$TH" HARNESS_HOME="$THH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT")
for sh in "${SHELLS[@]}"; do
    got="$("${TENV[@]}" $sh -c "${B4//<repo>/$T/tasks/suite-api}" 2>&1)"
    tool="${got#*tool: }"; tool="${tool%%$'\n'*}"
    [[ "$got" == *"EXIT=0"* && "$got" == *"suite-<slug>"* ]] && [ -f "$tool" ] \
        && [ "$tool" = "$TH/.claude/worfy-harness/projects/suite/bin/tickets.mjs" ] \
        && ok "$sh: tickets-to-tasks block resolves the tool with ~ expanded" || bad "$sh: tickets-to-tasks suite: [$got]"
    got="$("${TENV[@]}" $sh -c "${B4//<repo>/$T/tasks/acme}" 2>&1)"
    [[ "$got" == *"EXIT=4"* ]] && ok "$sh: tickets-to-tasks block: project without tasks -> 4" || bad "$sh: tickets-to-tasks acme: [$got]"
done

# --- Silent mode blocks of skills/ship-ticket and skills/epic-wave ------------------------------
# The Silent project of skill-blocks-world.sh: $SH, the repository $SR, the Workflow folder $SW, $SHH.
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
    # a Noted line after the verdict: the verdict is still the last gate: line, and no REJECTED is counted
    tf="$SW/.scratch/pay-flow/issues/02-t.md"
    printf '%s\n' 'Noted: [low] x' >>"$tf"
    last="$(grep '^gate:' "$tf" | tail -n 1)"
    [[ "$last" == "gate: VERIFIED — "* ]] && [ "$(tail -n 1 "$tf")" = 'Noted: [low] x' ] && [ "$(grep -c '^gate: REJECTED' "$tf")" = 0 ] \
        && ok "$sh: a Noted line after the verdict — the last gate: line is still gate: VERIFIED, no REJECTED counted" \
        || bad "$sh: Noted after the verdict: last gate: line [$last]"
    # a gate: MAX-REVIEW: line after it is not a verdict: the read of section 3 passes over it
    printf '%s\n' 'gate: MAX-REVIEW: VERIFIED — 2000-01-01' >>"$tf"
    last="$(grep '^gate:' "$tf" | grep -v '^gate: MAX-REVIEW:' | tail -n 1)"
    [[ "$last" == "gate: VERIFIED — "* ]] && ok "$sh: a gate: MAX-REVIEW: line after the verdict — the verdict read is still gate: VERIFIED" \
        || bad "$sh: MAX-REVIEW after the verdict: verdict read [$last]"
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

# --- the agents' marks: the review mark blocks and the CI filter -------------------------
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
# The implementer as it reads in full: the step 6 finish lives in a file of skill ship-ticket (skill-text.sh).
skill_text "$(cd "$SKILLS/.." && pwd)/agents/implementer.md" "$T/implementer.md"; IMPL="$T/implementer.md"
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

# --- blocks alike on BSD and GNU tools (a skill block runs the same on macOS, Linux and Git Bash) --------------
# The main-branch lock of skills/epic-wave, section 4. The loop is bounded: each round counts, and after three the
# block exits with IDLE — so a loop that spins without sleeping (BSD `stat -f %m` under GNU stat fails, and
# `|| continue` skips the sleep) ends the case instead of hanging the run. `sleep 30` becomes a no-op.
BL="$(SKILL="$WAVE" block "--git-common-dir)/main.lock\"   # the repository's shared path")"
[ -n "$BL" ] || bad "main-branch lock block not found in $WAVE"
LKR="$T/lkrepo"; git init -q "$LKR"; LK="$(cd "$LKR/.git" && pwd -P)/main.lock"
BL="${BL//<repo>/$LKR}"
pat='until mkdir "$L" 2>/dev/null; do'
rep='until mkdir "$L" 2>/dev/null; do n=$((n+1)); [ "$n" -le 3 ] || { echo IDLE; exit 7; };'
BL="${BL//"$pat"/$rep}"
BL="${BL//sleep 30/:}"
[[ "$BL" == *'echo IDLE'* && "$BL" != *'sleep 30'* ]] || bad "main-branch lock block: the round bound did not go in: [$BL]"
# In UTC, for TZ=UTC0 touch -t below: local time has an hour that the end of summer time repeats, and touch reads it
# as its first pass (a lock set to 25 min old came out 85 min old in harness/bin/tests/wave-gate-lock.test.sh).
two_hours_ago="$(perl -MPOSIX -e 'print strftime("%Y%m%d%H%M", gmtime(time - 7200))')"
for sh in "${SHELLS[@]}"; do
    rmdir "$LK" 2>/dev/null; mkdir "$LK"; TZ=UTC0 touch -t "$two_hours_ago" "$LK"
    got="$($sh -c "$BL" 2>&1)"; rc=$?
    [ "$rc" = 0 ] && [ "$got" = LOCKED ] && [ ! -e "$LK" ] \
        && ok "$sh: main-branch lock: a lock two hours old in the repository's git folder is removed and taken again (LOCKED), then released" \
        || bad "$sh: main-branch lock, stale: exit $rc [$got]"
    rmdir "$LK" 2>/dev/null; mkdir "$LK"
    got="$($sh -c "$BL" 2>&1)"; rc=$?
    [ "$rc" = 7 ] && [ "$got" = IDLE ] && [ -d "$LK" ] \
        && ok "$sh: main-branch lock: a fresh lock stays, the block waits" || bad "$sh: main-branch lock, fresh: exit $rc [$got]"
done
rmdir "$LK"

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

# --- jq for Windows writes CRLF: the blocks that read jq's output, run with a jq that turns LF into CRLF ----------
CRJ="$T/crlfjq"; mkdir -p "$CRJ"; REAL_JQ="$(type -P jq)"   # type -P: the jq() function above would make command -v print "jq" and the wrapper call itself
[[ "$REAL_JQ" == /* ]] || { echo "FAIL: no jq binary on PATH" >&2; exit 1; }
# One CR a line whatever the inner jq ends its lines with: jq for Windows already writes CRLF, and a wrapper that
# only turned LF into CRLF gave CR CR LF there. perl, not sed: BSD sed has no \r.
mkcrjq() { printf '#!/usr/bin/env bash\nset -o pipefail\n"%s" "$@" | perl -pe '"'"'s/\\r*\\n/\\r\\n/'"'"'\n' "$2" >"$1/jq"; chmod +x "$1/jq"; }
mkcrjq "$CRJ" "$REAL_JQ"
[ "$(printf '[1]' | "$CRJ/jq" -c . | od -An -c | tr -d ' \n')" = '[1]\r\n' ] && ok "the CRLF jq writes CRLF" || bad "the CRLF jq: $(printf '[1]' | "$CRJ/jq" -c . | od -c | head -n 1)"
mkdir -p "$T/crlfjq2"; mkcrjq "$T/crlfjq2" "$CRJ/jq"
[ "$(printf '[1]' | "$T/crlfjq2/jq" -c . | od -An -c | tr -d ' \n')" = '[1]\r\n' ] && ok "the CRLF jq over a jq that already writes CRLF: one CR a line" \
    || bad "the CRLF jq over a CRLF jq: $(printf '[1]' | "$T/crlfjq2/jq" -c . | od -c | head -n 1)"
got="$(cd "$R" && PATH="$CRJ:$PATH" bash -c "${STUB//'modules) echo "{}"'/modules) echo '{\"skip\":[\"lots\"]}'}"$'\n'"$B1" 2>&1 | awk '{print $2}' | sort)"
want="$(printf '%s\n' apps/api/src/carts apps/web/src/catalog)"
[ "$got" = "$want" ] && ok "CRLF jq: module-choice block with modules.skip (overnight-fix-loop)" || bad "CRLF jq: module-choice block: [$got]"
STUBDF='F() { case "$1" in
  worktree.base) echo main ;;
  layout.packages) echo "[\"apps/api\",\"apps/web\"]" ;;
  modules) echo "{\"deep\":[\"apps/api\"],\"flat\":[\"apps/web\"]}" ;;
  *) return 4 ;;
esac; }'
got="$(cd "$R" && PATH="$CRJ:$PATH" bash -c "$STUBDF"$'\n'"$B1" 2>&1 | awk '{print $2}' | sort)"
[ "$got" = "$(printf '%s\n' apps/api/src apps/web/src)" ] && ok "CRLF jq: module-choice block with modules.deep and modules.flat (overnight-fix-loop)" || bad "CRLF jq: module-choice deep/flat: [$got]"
main_lines() { awk 'index($0, "M=$(F worktree.base); [ \"$M\" = null ] && M=") == 1 { on = 1 } on { print } on && $0 == "M=${M#origin/}" { exit }'; }
BDM="$(render "$SHIP" | main_lines)"
[ -n "$BDM" ] || bad "main-branch lines not found in $SHIP"
[ "$BDM" = "$(main_lines <"$SHIP")" ] || echo "$SHIP: the main-branch lines change when the skill is called with the arguments [$SKILL_ARGS]" >>"$CHANGED"
mkdir -p "$T/dbr/repo"
got="$(PATH="$CRJ:$PATH" bash -c 'F() { case "$1" in worktree.base) echo null ;; layout.repos) echo "{\"repo\":{\"default_branch\":\"trunk\"}}" ;; *) return 4 ;; esac; }'$'\n'"${BDM//<repo>/$T/dbr/repo}"$'\n''printf "[%s]" "$M"' 2>&1)"
[ "$got" = "[trunk]" ] && ok "CRLF jq: the main branch from layout.repos default_branch (ship-ticket)" || bad "CRLF jq: default_branch: [$(printf '%s' "$got" | od -c | head -n 2)]"
got="$(cd "$R" && PATH="$CRJ:$PATH" bash -c "$STUB"$'\n'"$B2" 2>&1 | sort)"
[ "$got" = "$(printf '%s\n' src/z.spec.ts test/carts.test.ts)" ] && ok "CRLF jq: test-list block (overnight-fix-loop)" || bad "CRLF jq: test-list block: [$got]"
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

# The tree of the main branch, found by its branch line in `git worktree list --porcelain` (ship-ticket step 11,
# epic-wave's docs commit): the path of the tree that has branch M checked out, a path with a space included.
git -C "$R" branch side && git -C "$R" worktree add -q "$T/tree of side" side
WT="$(native "$T")/tree of side"   # as git prints it: C:/... on Windows
for f in "$SHIP" "$WAVE"; do
    BW="$(render "$f" | grep -m 1 '^W=$(git -C <repo> worktree list --porcelain | awk')"
    [ -n "$BW" ] || { bad "worktree-of-branch line not found in $f"; continue; }
    [ "$BW" = "$(grep -m 1 '^W=$(git -C <repo> worktree list --porcelain | awk' "$f")" ] \
        || echo "$f: the worktree-of-branch line changes when the skill is called with the arguments [$SKILL_ARGS]" >>"$CHANGED"
    for sh in "${SHELLS[@]}"; do
        got="$($sh -c "M=side"$'\n'"${BW//<repo>/$R}"$'\n''printf "[%s]" "$W"' 2>&1)"
        [ "$got" = "[$WT]" ] && ok "$sh: $(basename "$(dirname "$f")"): the worktree of branch M, path with a space" \
            || bad "$sh: $(basename "$(dirname "$f")"): worktree of branch M: got $got want [$WT]"
        got="$($sh -c "M=no-such"$'\n'"${BW//<repo>/$R}"$'\n''printf "[%s]" "$W"' 2>&1)"
        [ "$got" = "[]" ] && ok "$sh: $(basename "$(dirname "$f")"): no worktree for a branch nobody checked out" \
            || bad "$sh: $(basename "$(dirname "$f")"): worktree of a missing branch: got $got"
    done
done

# --- skills/epic-wave, "Open PRs of other epics": the branch template turned into a regex -----------------
# The `re=` line of the block, with the epic put in as the skill says, under a stub F that prints the
# template. (Old Russian placeholders never reach the block: bin/profile prints them in English.)
RE_LINE="$(SKILL="$WAVE" blockf 'F tickets.branch | sed' | grep '^re=')"
[ -n "$RE_LINE" ] || bad "the tickets.branch regex line not found in $WAVE"
RE_LINE="${RE_LINE//<epic>/pay-flow}"
while IFS='|' read -r tmpl want; do
    for sh in "${SHELLS[@]}"; do
        got="$(TMPL="$tmpl" $sh -c 'F() { printf "%s\n" "$TMPL"; }'$'\n'"$RE_LINE"$'\n''printf "%s" "$re"' 2>&1)"
        [ "$got" = "$want" ] && ok "$sh: epic-wave branch regex: $tmpl -> $want" || bad "$sh: epic-wave branch regex: $tmpl -> [$got], want [$want]"
    done
done <<'EOF'
<epic>/<NN>|pay-flow/[0-9]+
<epic>/<NN>-<slug>|pay-flow/[0-9]+-.+
EOF

finish_blocks
