#!/usr/bin/env bash
# The shell blocks of skills/overnight-fix-loop/SKILL.md that split a string into words,
# under bash and under zsh (the Claude Code Bash tool runs zsh, and zsh does not split an
# unquoted variable into words). The blocks are cut out of SKILL.md itself; the profile is replaced by a stub F.
# Below — the blocks of skills/qmd (collections table) and skills/tickets-to-tasks (tool from the profile), and
# the Silent mode blocks of skills/ship-ticket and skills/epic-wave (worfy-harness ticket 22): the branch named by
# the change, the verdict in the ticket file, the local commit in the Workflow folder, resuming a wave by Branch:.
# Then the agents' marks (worfy ADR-0067): the review mark blocks of both skills, and the CI filter that leaves the
# marks out, the same command in both skills and in agents/implementer.md.
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
for sh in bash zsh; do
    got="$(cd "$R" && $sh -c "$STUB"$'\n'"$B1" 2>&1 | awk '{print $2}' | sort)"
    [ "$got" = "$want" ] && ok "$sh: module-choice block lists modules of every package" \
        || bad "$sh: module-choice block: got [$(echo $got)] want [$(echo $want)]"
done

# Module test-list block: --include globs from tests.globs.
B2="$(block 'grep -rslE')"
[ -n "$B2" ] || bad "test-list block not found in $SKILL"
B2="${B2//<каталог пакета>/$R/apps/api}"; B2="${B2//<имя>/auctions}"
want="$(printf '%s\n' src/z.spec.ts test/auctions.test.ts)"
for sh in bash zsh; do
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
for sh in bash zsh; do
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
    for sh in bash zsh; do
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
printf '{"repos":[{"key":"sp","match":"%s","profile":"sp"}]}\n' "$SR" >"$SHH/gate/config.json"
printf '{"schema":2,"name":"sp","mode":"silent","workflow":{"folder":"%s"}}\n' "$SW" >"$SHH/projects/sp/profile.json"
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
for sh in bash zsh; do
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
  jq -r "$f" "$GH_CHECKS"; exit $?
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
    for sh in bash zsh; do
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
    for sh in bash zsh; do
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

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
