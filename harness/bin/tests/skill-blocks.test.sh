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
# skills/epic-wave, the branches of the last 14 days of skills/continuous-audit, the label and the checks section of
# the cross-machine gate (skills/ship-ticket step 8; the serve pass of skills/gate-queue;
# the request blocks of skills/epic-wave section 1), with a stub gh.
# Every block runs on the text Claude Code hands the model when the skill is called with arguments (render below).
# Run: bash harness/bin/tests/skill-blocks.test.sh; exit code 0 — everything passed.
# SKILL_FILE — check another copy of SKILL.md; SKILL_ARGS — the arguments of the call (default ten words, a to j).
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
# The shells every block runs under. Git Bash on Windows has no zsh: there the zsh cases are
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
# Off Windows the zsh cases always run: a skip that fired there would leave them out and the file would stay green.
case "$(uname -s)" in
    MINGW* | MSYS*) ;;
    *) [[ " ${SHELLS[*]} " == *" zsh "* ]] && ok "the shells of the blocks include zsh off Windows" || bad "the shells of the blocks lack zsh off Windows: [${SHELLS[*]}]" ;;
esac

# Claude Code hands the model SKILL.md with the skill's arguments put in: $N becomes the N-th word of the
# arguments ($0 the first; a $N past the last word stays), $ARGUMENTS[N] the same, $ARGUMENTS the whole
# string, and \$ before a digit or ARGUMENTS stands for a plain $. Code blocks are not spared, and a skill
# called with arguments gets its blocks in that form. So every block below runs on the text as Claude Code
# renders it for the arguments SKILL_ARGS (default ten words, so every $0 ... $9 is replaced), under every shell of SHELLS; the cut also checks
# that the rendered block equals the block in the file, so the file's own text gives the same result.
# SKILL_ARGS= (empty) renders the text of a call without arguments.
SKILL_ARGS="${SKILL_ARGS-a b c d e f g h i j}"
render() { # [file]; prints the skill text as Claude Code renders it for the arguments SKILL_ARGS (no $ in them)
    SKILL_ARGS="$SKILL_ARGS" perl -pe 'BEGIN { $all = $ENV{SKILL_ARGS}; @a = split " ", $all }
        s/(?<!\\)\\\$(?=\d|ARGUMENTS)/\x01/g;
        s/\$ARGUMENTS\[(\d+)\]/defined $a[$1] ? $a[$1] : "\x01ARGUMENTS[$1]"/ge;
        s/\$(\d+)(?!\w)/defined $a[$1] ? $a[$1] : "\x01$1"/ge;
        s/\$ARGUMENTS/$all/g;
        s/\x01/\$/g' "$@"
}
got="$(printf '%s\n' 'F() { p --field "$1"; }' "awk '{w=substr(\$0,10)} \$3==b'" '\$1 $ARGUMENTS $ARGUMENTS[2] $10 $1x "$@" ${1}' | SKILL_ARGS='a b c' render)"
want="$(printf '%s\n' 'F() { p --field "b"; }' "awk '{w=substr(a,10)} \$3==b'" '$1 a b c c $10 $1x "$@" ${1}')"
[ "$got" = "$want" ] && ok "render puts the arguments in as Claude Code does" || bad "render: got [$got] want [$want]"
# The blocks whose rendered text differs from the file's, one line each; checked at the end.
CHANGED="$T/changed-blocks"; : >"$CHANGED"
cut_block() { # $1 = a string that identifies the ```bash block; reads markdown on stdin
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}'
}
# blockf <marker>: the ```bash block of $SKILL that contains the marker, as Claude Code renders it.
blockf() {
    local own rendered
    own="$(cut_block "$1" <"$SKILL")"; rendered="$(render "$SKILL" | cut_block "$1")"
    [ "$own" = "$rendered" ] || printf '%s: the block with [%s] changes when the skill is called with the arguments [%s]\n' "$SKILL" "$1" "$SKILL_ARGS" >>"$CHANGED"
    printf '%s\n' "$rendered"
}
block() { # $1 = a string that identifies the ```bash block; prints it without the `F() {…profile…}` line
    blockf "$1" | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}
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
B2="${B2//<каталог пакета>/$R/apps/api}"; B2="${B2//<имя>/carts}"
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
PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
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
# A Silent project in a temporary HARNESS_HOME; the blocks call the real profile, ticket, epic-status and
# silent-check next to this test (CLAUDE_PLUGIN_ROOT = harness/).
SH="$T/silent"; SR="$SH/repo"; SW="$SH/wf"; SHH="$SH/hh"
mkdir -p "$SH/home" "$SHH/gate" "$SHH/projects/sp" "$SW/.scratch/pay-flow/issues"
git -C "$SH" init -q -b main repo && git -C "$SR" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$SR" branch fix/local-only && git -C "$SR" update-ref refs/remotes/origin/fix/pushed HEAD
printf '{"repos":[{"key":"sp","match":"%s","profile":"sp"}]}\n' "$(native "$SR")" >"$SHH/gate/config.json"
printf '{"schema":2,"name":"sp","mode":"silent","workflow":{"folder":"%s"}}\n' "$(native "$SW")" >"$SHH/projects/sp/profile.json"
tk() { printf '# %s — t\n\nStatus: %s\n%b' "$1" "$2" "${3:-}" >"$SW/.scratch/pay-flow/issues/$1-t.md"; }
# These blocks define F themselves (the real profile), so the F line stays in: blockf, not block.
reset_tickets() {
    tk 01 open; tk 02 claimed 'Branch: fix/local-only\n'; tk 03 claimed 'Branch: fix/pushed\nRepo: repo\n'; tk 04 claimed; tk 05 claimed 'Branch: fix/gone\n'
}
git -C "$SW" init -q -b main
SENV=(env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR -u CLAUDE_PROFILE_BIN -u CLAUDE_TICKET_BIN HOME="$SH/home" HARNESS_HOME="$SHH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
      GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t)
SHIP="$SKILLS/ship-ticket/SKILL.md" WAVE="$SKILLS/epic-wave/SKILL.md" GQF="$SKILLS/gate-queue/SKILL.md"
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
two_hours_ago="$(perl -MPOSIX -e 'print strftime("%Y%m%d%H%M", localtime(time - 7200))')"
for sh in "${SHELLS[@]}"; do
    rmdir "$LK" 2>/dev/null; mkdir "$LK"; touch -t "$two_hours_ago" "$LK"
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

# The cross-machine gate: a project with cross_machine_gate in the sandbox HARNESS_HOME, and a stub
# gh: `--jq <filter>` applies the filter (real jq) to $GH_JSON, `--body-file <f>` keeps a copy of <f> in $GH_BODY_OUT,
# every call is logged. No token reaches it, and nothing reaches GitHub.
CM="$T/cm"; CR="$CM/repo"; mkdir -p "$CM" "$SHH/projects/cm"
git -C "$CM" init -q --bare -b main origin.git && git -C "$CM" clone -q origin.git repo 2>/dev/null
printf '{"repos":[{"key":"sp","match":"%s","profile":"sp"},{"key":"cm","match":"%s","profile":"cm"}]}\n' "$(native "$SR")" "$(native "$CR")" >"$SHH/gate/config.json"
CMP='{"schema":2,"name":"cm","mode":"full","tickets":{"branch":"<эпик>/<NN>"},"github":{"account":"mac-bot"},"worktree":{"base":"origin/main"},"cross_machine_gate":{"label":"needs-mac-gate","role":"request","exempt":[".scratch/","docs/","HANDOFF.md"],"checks_section":"Mac checks"}}'
printf '%s\n' "$CMP" >"$SHH/projects/cm/profile.json"
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
[ -n "${GH_FAIL_ON:-}" ] && [[ " $* " == *" $GH_FAIL_ON "* ]] && { echo "HTTP 502: Bad Gateway (https://api.github.com/graphql)" >&2; exit 1; }
[ -n "${GH_BODY_RAW:-}" ] && [[ " $* " == *" --json body "* ]] && { cat "$GH_BODY_RAW"; exit 0; }
[ -n "${GH_LOCK:-}" ] && [[ " $* " == *" pr merge "* ]] && { [ -d "$GH_LOCK" ] && echo held || echo free; } >>"$GH_LOCK_LOG"
[ -n "${GH_TERM_ON:-}" ] && [[ " $* " == *" $GH_TERM_ON "* ]] && { kill -TERM "$PPID"; exit 1; }   # the call is stopped
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
# Only the description read fails: without the guard the block went on and replaced the whole description
# with the section alone.
label_error_case "gh fails on reading the description" GH_FAIL_ON=body 'json body failed' harness/x.sh
# bin/profile exit 1 (a broken cross_machine_gate) is an ERROR, exit 4 (no such field) is the skip.
jq -n '{body: "Old description.", files: [{path: "harness/x.sh"}]}' >"$T/ghx.json"
jq '.cross_machine_gate.role = "merge"' <<<"$CMP" >"$SHH/projects/cm/profile.json"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BLB" 2>&1)"
    [[ "$got" == "ERROR: bin/profile exit 1"* ]] && [ ! -s "$T/ghx.log" ] \
        && ok "$sh: label block, a broken profile (exit 1) -> ERROR, gh not called" || bad "$sh: label block, broken profile: [$got] gh [$(cat "$T/ghx.log")]"
done
jq 'del(.cross_machine_gate)' <<<"$CMP" >"$SHH/projects/cm/profile.json"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BLB" 2>&1)"
    [ "$got" = "label step skipped: cross_machine_gate.role is absent" ] && [ ! -s "$T/ghx.log" ] \
        && ok "$sh: label block, no cross_machine_gate (exit 4) -> skipped, gh not called" || bad "$sh: label block, no field: [$got]"
done
printf '%s\n' "$CMP" >"$SHH/projects/cm/profile.json"
# A description edited on the web comes with CRLF: its section is found, no second one is added.
jq -n '{body: "Old description.", files: [{path: "harness/x.sh"}]}' >"$T/ghx.json"
printf 'Old description.\r\n\r\n## Mac checks\r\n\r\n- `pnpm icons` — exit 0\r\n' >"$T/ghx-crlf-body.md"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"; rm -f "$T/ghx-body.md"
    got="$("${SENV[@]}" "${XENV[@]}" GH_BODY_RAW="$T/ghx-crlf-body.md" $sh -c "$BLB" 2>&1)"
    [ "$got" = $'label\nEXIT=0' ] && [ "$(tr -d '\r' <"$T/ghx-body.md" | grep -c '^## Mac checks$')" = 1 ] \
        && ok "$sh: label block, a CRLF description that has the section gets no second one" || bad "$sh: label block, CRLF description: [$got] body [$(cat "$T/ghx-body.md" 2>&1)]"
done

# The checks section block of skills/gate-queue, step 3: the section's lines up to the next heading. The pass is written
# only there: skills/epic-wave section 1 runs skills/gate-queue and has no copy of the block.
BCS="$(SKILL="$GQF" blockf 'no-section')"
[ -n "$BCS" ] || bad "checks section block not found in $GQF"
[ -z "$(SKILL="$WAVE" blockf 'no-section')" ] && ok "the checks section block is not in $WAVE" || bad "the checks section block is still in $WAVE"
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

# The serve pass of skills/gate-queue against a bare origin, with F worktree.base origin/main as in the
# live profile. The list skips fork PRs. The rebase block takes the branch as origin has it (a stale local branch
# from an earlier pass would push a rework away), pushes with a lease on the listed head, prints the new head.
G=(-c user.email=t@t -c user.name=t)
git -C "$CR" "${G[@]}" commit -q --allow-empty -m base && git -C "$CR" push -q origin main 2>/dev/null
git -C "$CR" checkout -q -b feature && echo f >"$CR/f.txt" && git -C "$CR" add f.txt && git -C "$CR" "${G[@]}" commit -q -m feature \
    && git -C "$CR" push -q origin feature 2>/dev/null && git -C "$CR" checkout -q main      # the local feature: stale from now on
git -C "$CM" clone -q origin.git other 2>/dev/null && git -C "$CM/other" "${G[@]}" commit -q --allow-empty -m moved && git -C "$CM/other" push -q origin main 2>/dev/null
git -C "$CM/other" checkout -q feature 2>/dev/null && echo r >"$CM/other/r.txt" && git -C "$CM/other" add r.txt \
    && git -C "$CM/other" "${G[@]}" commit -q -m rework && git -C "$CM/other" push -q origin feature 2>/dev/null   # the rework of the request machine
tip="$(git -C "$CM/origin.git" rev-parse main)"; rework="$(git -C "$CM/origin.git" rev-parse feature)"
BSL="$(SKILL="$GQF" blockf 'isCrossRepository')"
[ -n "$BSL" ] || bad "serve list block not found in $GQF"
BSL="$(sub "${BSL//<repo>/$CR}")"
printf '%s\n' '[{"number":7,"headRefName":"feature","headRefOid":"'"$rework"'","isCrossRepository":false,"createdAt":"2026-10-18T06:00:00Z","commits":[{"committedDate":"2026-10-18T07:00:00Z"}],"comments":[]},
 {"number":8,"headRefName":"evil","headRefOid":"0123","isCrossRepository":true,"createdAt":"2026-10-18T08:00:00Z","commits":[],"comments":[]}]' >"$T/ghx.json"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BSL" 2>&1)"
    [ "$got" = "7 feature $rework since 2026-10-18T07:00:00Z"$'\n'"8 fork: skipped"$'\n'"EXIT=0" ] && grep -q -- '--json number,headRefName,headRefOid,isCrossRepository' "$T/ghx.log" \
        && ok "$sh: serve list block: a fork PR is skipped, the others come with their head" || bad "$sh: serve list block: [$got]"
done
BSV="$(SKILL="$GQF" blockf 'gone() {')"
[ -n "$BSV" ] || bad "serve rebase block not found in $GQF"
BSV="$(sub "${BSV//<repo>/$CR}")"; BSV="${BSV//<scratchpad>/$CM}"; BSV="${BSV//<branch>/feature}"
serve_rebase() { local b="${BSV//<N>/$1}"; b="${b//<head>/$2}"; "${SENV[@]}" ${RSH:-bash} -c "$b" 2>&1; }   # RSH: the shell
got="$(serve_rebase 7 "$rework")"; new="$(grep -E '^[0-9a-f]{40}$' <<<"$got" | tail -n 1)"
[ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$new" ] \
    && git -C "$CM/origin.git" merge-base --is-ancestor "$tip" "$new" && git -C "$CM/origin.git" cat-file -e "$new:r.txt" 2>/dev/null \
    && ok "serve rebase block: a stale local branch — the rework is kept, rebased onto origin/main, pushed, new head printed" \
    || bad "serve rebase block, stale local branch: [$got] origin feature has r.txt: $(git -C "$CM/origin.git" cat-file -e feature:r.txt 2>&1 && echo yes)"
git -C "$CR" worktree remove --force "$CM/pr-7"
# A push to the branch while the block runs, then a fetch (an editor's background fetch): the lease on the listed
# head refuses the push; a lease on the remote-tracking ref would take the fetched head and push that push away.
RG="$T/racegit"; mkdir -p "$RG"; : >"$T/race"
cat >"$RG/git" <<RACE
#!/usr/bin/env bash
if [ -e "$T/race" ] && [[ " \$* " == *" push "* ]]; then
  rm -f "$T/race"
  "$REAL_GIT" -C "$CM/other" fetch -q origin && "$REAL_GIT" -C "$CM/other" checkout -q -B feature origin/feature && echo \$\$ >"$CM/other/y.txt" && "$REAL_GIT" -C "$CM/other" add y.txt && "$REAL_GIT" -C "$CM/other" -c user.email=t@t -c user.name=t commit -q -m race && "$REAL_GIT" -C "$CM/other" push -q origin feature 2>/dev/null && "$REAL_GIT" -C "$CR" fetch -q origin
fi
exec "$REAL_GIT" "\$@"
RACE
chmod +x "$RG/git"
b="${BSV//<N>/8}"; b="${b//<head>/$new}"; got="$("${SENV[@]}" PATH="$RG:$PATH" bash -c "$b" 2>&1)"
[ ! -e "$T/race" ] && [ "$(git -C "$CM/origin.git" log -1 --format=%s feature)" = race ] && [ "$(tail -n 1 <<<"$got")" != EXIT=0 ] && [ ! -e "$CM/pr-8" ] \
    && ok "serve rebase block: a push while the block runs — the push is refused, origin keeps that push, the tree is removed" || bad "serve rebase block, push while the block runs: [$got]"
new="$(git -C "$CM/origin.git" rev-parse feature)"
[ ! -e "$CM/pr-8" ] || git -C "$CR" worktree remove --force "$CM/pr-8"
# The pass again from the list after a refused push — the same PR, the same scratchpad — while the other machine
# pushes once more: the retry starts from origin's branch, and both pushes of the other machine stay on origin.
retry_case() { # retry_case <shell> <N>
    local sh="$1" n="$2" b got1 got second head
    head="$(git -C "$CM/origin.git" rev-parse feature)"; : >"$T/race"
    b="${BSV//<N>/$n}"; b="${b//<head>/$head}"; got1="$("${SENV[@]}" PATH="$RG:$PATH" $sh -c "$b" 2>&1)"
    git -C "$CM/other" fetch -q origin && git -C "$CM/other" checkout -q -B feature origin/feature && echo "$sh $n" >"$CM/other/z.txt" \
        && git -C "$CM/other" add z.txt && git -C "$CM/other" "${G[@]}" commit -q -m second && git -C "$CM/other" push -q origin feature 2>/dev/null
    second="$(git -C "$CM/origin.git" rev-parse feature)"
    got="$(RSH=$sh serve_rebase "$n" "$second")"
    [ "$(tail -n 1 <<<"$got1")" != EXIT=0 ] && [ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && git -C "$CM/origin.git" merge-base --is-ancestor "$second" feature \
        && ok "$sh: serve rebase block: a retry after a refused push — the other machine's commits stay on origin" \
        || bad "$sh: serve rebase block, retry: first [$(tail -n 1 <<<"$got1")] retry [$got] origin feature $(git -C "$CM/origin.git" log --format=%s -3 feature | tr '\n' ' ')"
    [ ! -e "$CM/pr-$n" ] || git -C "$CR" worktree remove --force "$CM/pr-$n"
}
# A tree left from an earlier try (no worktree remove by hand) is removed first; a tree deleted by hand that git still
# lists is pruned first: both runs reach the rebase and the push.
leftover_case() { # leftover_case <shell> <N>
    local sh="$1" n="$2" head got got2 got3
    head="$(git -C "$CM/origin.git" rev-parse feature)"
    got="$(RSH=$sh serve_rebase "$n" "$head")"
    got2="$(RSH=$sh serve_rebase "$n" "$head")"
    [ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && [ "$(tail -n 1 <<<"$got2")" = EXIT=0 ] && grep -qE '^[0-9a-f]{40}$' <<<"$got2" \
        && ok "$sh: serve rebase block: a tree left from an earlier try of the PR is removed first" || bad "$sh: serve rebase block, leftover tree: [$got2]"
    rm -rf "$CM/pr-$n"
    got3="$(RSH=$sh serve_rebase "$n" "$head")"
    [ "$(tail -n 1 <<<"$got3")" = EXIT=0 ] && [ -d "$CM/pr-$n" ] \
        && ok "$sh: serve rebase block: a tree deleted by hand that git still lists is pruned first" || bad "$sh: serve rebase block, tree deleted by hand: [$got3]"
    [ ! -e "$CM/pr-$n" ] || git -C "$CR" worktree remove --force "$CM/pr-$n"
}
for sh in "${SHELLS[@]}"; do retry_case "$sh" 10; leftover_case "$sh" 12; done
new="$(git -C "$CM/origin.git" rev-parse feature)"
# worktree.base null: the main branch, not `git rebase null` (and the request block below the same).
jq '.worktree.base = null' <<<"$CMP" >"$SHH/projects/cm/profile.json"
got="$(serve_rebase 9 "$new")"
[ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && ok "serve rebase block: worktree.base null -> origin/main" || bad "serve rebase block, base null: [$got]"
git -C "$CR" worktree remove --force "$CM/pr-9"
BRQ="$(SKILL="$WAVE" blockf 'base-gate "$B"')"
[ -n "$BRQ" ] || bad "request fresh-base block not found in $WAVE"
BRQ="$(sub "${BRQ//<repo>/$CR}")"; BRQ="${BRQ//<scratchpad>/$CM}"; BRQ="${BRQ//<F commands.prepare_tree>/git rev-parse HEAD}"
for base in null origin/main; do
    jq --arg b "$base" '.worktree.base = (if $b == "null" then null else $b end)' <<<"$CMP" >"$SHH/projects/cm/profile.json"
    got="$("${SENV[@]}" bash -c "$BRQ" 2>&1 | grep -E '^(EXIT=|[0-9a-f]{40}$)')"   # git's progress lines dropped
    [ "$got" = "EXIT=0"$'\n'"$tip"$'\n'"EXIT=0" ] && [ ! -e "$CM/base-gate" ] \
        && ok "request fresh-base block: base $base — a detached worktree on origin/main, removed after" || bad "request fresh-base block, base $base: [$got] want [EXIT=0 $tip EXIT=0]"
done
printf '%s\n' "$CMP" >"$SHH/projects/cm/profile.json"
# A rebase conflict stops the block before the push: nothing half-rebased reaches origin.
git -C "$CM/other" checkout -q main && git -C "$CM/other" pull -q origin main 2>/dev/null; echo conflict >"$CM/other/f.txt" \
    && git -C "$CM/other" add f.txt && git -C "$CM/other" "${G[@]}" commit -q -m conflict && git -C "$CM/other" push -q origin main 2>/dev/null
before="$(git -C "$CM/origin.git" rev-parse feature)"
got="$(serve_rebase 11 "$before")"
[ "$(tail -n 1 <<<"$got")" != EXIT=0 ] && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$before" ] \
    && ok "serve rebase block: a rebase conflict stops the block — origin keeps the branch, nothing half-rebased is pushed" \
    || bad "serve rebase block, conflict: [$got] origin feature $(git -C "$CM/origin.git" log --format=%s -1 feature)"
# The second block after a resolved state-file conflict. With the path lost (a fresh shell: P empty or unset) and the
# current folder a tree with a resolved rebase of its own, it refuses and pushes nothing.
BCT="$(SKILL="$GQF" blockf 'rebase --continue')"
[ -n "$BCT" ] || bad "conflict follow-up block not found in $GQF"
BCT="$(sub "${BCT//<repo>/$CR}")"; BCT="${BCT//<scratchpad>/$CM}"; BCT="${BCT//<branch>/feature}"; BCT="${BCT//<N>/11}"; BCT="${BCT//<head>/$before}"
git -C "$CR" worktree add -q --detach "$CM/cwdwt" "$before" 2>/dev/null; git -C "$CM/cwdwt" rebase -q origin/main >/dev/null 2>&1
echo resolved >"$CM/cwdwt/f.txt"; git -C "$CM/cwdwt" add f.txt
for sh in "${SHELLS[@]}"; do
    for lost in 'P=' ':' "P=$CM/cwdwt"; do   # empty, unset, a path to another tree
        pline="P=$CM/pr-11"; b="${BCT/$pline/$lost}"
        got="$(cd "$CM/cwdwt" && "${SENV[@]}" $sh -c "$b" 2>&1)"
        [[ "$got" == REFUSED:* ]] && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$before" ] \
            && ok "$sh: conflict follow-up block: the path lost ([$lost]) -> refused, nothing pushed" \
            || bad "$sh: conflict follow-up block, path lost [$lost]: [$got] origin feature $(git -C "$CM/origin.git" log --format=%s -1 feature)"
    done
done
git -C "$CM/cwdwt" rebase --abort 2>/dev/null; git -C "$CR" worktree remove --force "$CM/cwdwt"
# The other machine pushes to the branch while this one resolves the conflict: the lease on the listed head refuses
# the push, origin keeps the other machine's commit, and the tree is removed.
echo resolved >"$CM/pr-11/f.txt"; git -C "$CM/pr-11" add f.txt
git -C "$CM/other" fetch -q origin && git -C "$CM/other" checkout -q -B feature origin/feature && echo moved >"$CM/other/m.txt" \
    && git -C "$CM/other" add m.txt && git -C "$CM/other" "${G[@]}" commit -q -m "moved while resolving" && git -C "$CM/other" push -q origin feature 2>/dev/null
moved="$(git -C "$CM/origin.git" rev-parse feature)"
got="$("${SENV[@]}" bash -c "$BCT" 2>&1)"
[ "$(tail -n 1 <<<"$got")" != EXIT=0 ] && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$moved" ] && [ ! -e "$CM/pr-11" ] \
    && ok "conflict follow-up block: the branch moved while the conflict was resolved -> push refused, the other machine's commit stays" \
    || bad "conflict follow-up block, branch moved: [$got] origin feature $(git -C "$CM/origin.git" log --format=%s -1 feature)"
[ ! -e "$CM/pr-11" ] || git -C "$CR" worktree remove --force "$CM/pr-11"
# The pass again from the list, on the moved head: the conflict again, resolved and staged in the PR's real tree; the
# rebase goes on and the push holds the lease.
got="$(serve_rebase 11 "$moved")"
[ "$(tail -n 1 <<<"$got")" != EXIT=0 ] && [ -d "$CM/pr-11" ] || bad "serve rebase block, the conflict again: [$got]"
BCT="${BCT//$before/$moved}"
echo resolved >"$CM/pr-11/f.txt"; git -C "$CM/pr-11" add f.txt
got="$("${SENV[@]}" bash -c "$BCT" 2>&1)"
[ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && git -C "$CM/origin.git" merge-base --is-ancestor main feature \
    && [ "$(git -C "$CM/origin.git" show feature:f.txt)" = resolved ] && git -C "$CM/origin.git" cat-file -e feature:m.txt \
    && ok "conflict follow-up block: the PR's tree, conflict resolved -> rebase continued, pushed with the lease" || bad "conflict follow-up block, resolved: [$got]"
new="$(git -C "$CM/origin.git" rev-parse feature)"
[ ! -e "$CM/pr-11" ] || git -C "$CR" worktree remove --force "$CM/pr-11"

# The report block posts the report once; the merge block merges only after a green report that reached the PR and a
# green check, and only the head the checks ran on, under the main-branch lock at its shared path, released by a trap.
BCM="$(SKILL="$GQF" blockf 'gh pr comment <N> --body-file')"
[ -n "$BCM" ] || bad "serve report block not found in $GQF"
BCM="${BCM//<scratchpad>/$T}"; BCM="${BCM//<N>/7}"
printf 'Mac checks report: green\nverdict line\n' >"$T/pr-7-report.md"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"; got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BCM" 2>&1)"
    [ "$got" = "comment EXIT=0" ] && [ "$(cat "$T/ghx.log")" = "pr comment 7 --body-file $T/pr-7-report.md" ] \
        && ok "$sh: report block: one gh pr comment with the report file" || bad "$sh: report block: [$got] gh [$(cat "$T/ghx.log")]"
    : >"$T/ghx.log"; got="$("${SENV[@]}" "${XENV[@]}" GH_FAIL_ON=comment $sh -c "$BCM" 2>/dev/null)"
    [ "$got" = "comment EXIT=1" ] && ok "$sh: report block: a failed comment gives its exit code" || bad "$sh: report block, failed: [$got]"
done
BMG="$(SKILL="$GQF" blockf '<comment exit>')"
[ -n "$BMG" ] || bad "serve merge block not found in $GQF"
[[ "$BMG" != *'gh pr comment <N>'* ]] && ok "merge block: no gh pr comment — a repeat after a lock timeout posts no second report" || bad "merge block posts a comment"
BMG="$(sub "${BMG//<repo>/$CR}")"; BMG="${BMG//<scratchpad>/$T}"; BMG="${BMG//<N>/7}"; BMG="${BMG//<new head>/$new}"
LCK="$(cd "$CR/.git" && pwd -P)/main.lock"
mb() { local b="${BMG//<check exit>/$1}"; printf '%s' "${b//<comment exit>/$2}"; }   # mb <check exit> <comment exit>
merge_case() { # merge_case <want: merge|none> <name> <first line of the report> <check exit> <comment exit> [env assignment]
    local want="$1" name="$2" b sh got; b="$(mb "$4" "$5")"; printf '%s\nverdict line\n' "$3" >"$T/pr-7-report.md"
    for sh in "${SHELLS[@]}"; do
        : >"$T/ghx.log"; : >"$T/lock.log"
        got="$("${SENV[@]}" "${XENV[@]}" GH_LOCK="$LCK" GH_LOCK_LOG="$T/lock.log" ${6:-} $sh -c "$b" 2>&1)"
        if [ "$want" = merge ]; then
            [ "$(cat "$T/ghx.log")" = "pr merge 7 --squash --match-head-commit $new"$'\n'"pr edit 7 --remove-label needs-mac-gate" ] \
                && [ "$(cat "$T/lock.log")" = held ] && [ ! -e "$LCK" ] \
                && ok "$sh: merge block, $name -> merge of the checked head under the lock, label removed, lock released" || bad "$sh: merge block, $name: [$got] gh [$(cat "$T/ghx.log")]"
        else
            [ ! -s "$T/ghx.log" ] && [ ! -e "$LCK" ] \
                && ok "$sh: merge block, $name -> no merge, the label stays, no lock taken" || bad "$sh: merge block, $name: [$got] gh [$(cat "$T/ghx.log")]"
        fi
        rmdir "$LCK" 2>/dev/null   # a lock left by a broken block would hold the next case in its wait
    done
}
merge_case merge "green report, comment 0, check 0" "Mac checks report: green" 0 0
merge_case none "the comment failed" "Mac checks report: green" 0 1
merge_case none "red report" "Mac checks report: red" 0 0
merge_case none "check exit 2" "Mac checks report: green" 2 0
printf 'Mac checks report: green\n' >"$T/pr-7-report.md"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"; got="$("${SENV[@]}" "${XENV[@]}" GH_FAIL_ON=merge $sh -c "$(mb 0 0)" 2>/dev/null)"
    [ "$got" = "merge EXIT=1" ] && ! grep -q -- '--remove-label' "$T/ghx.log" && [ ! -e "$LCK" ] \
        && ok "$sh: merge block: the merge failed -> merge EXIT=1, the label stays, the trap releases the lock" || bad "$sh: merge block, merge failed: [$got] gh [$(cat "$T/ghx.log")] lock $(ls -d "$LCK" 2>&1)"
    rmdir "$LCK" 2>/dev/null   # a lock left by a broken block would hold the next case in its wait
    # The call is stopped during the merge (a TERM to the shell): the trap still releases the lock.
    : >"$T/ghx.log"; "${SENV[@]}" "${XENV[@]}" GH_TERM_ON=merge $sh -c "$(mb 0 0)" >/dev/null 2>&1; rc=$?
    [ "$rc" = 130 ] && [ ! -e "$LCK" ] && ok "$sh: merge block: the call stopped during the merge -> exit 130, the trap releases the lock" \
        || bad "$sh: merge block, stopped: exit $rc lock $(ls -d "$LCK" 2>&1)"
    rmdir "$LCK" 2>/dev/null
done
# A lock left by a session that died (older than 90 minutes) is taken over; the merge runs under it and releases it.
mkdir "$LCK" && touch -t 202601010000 "$LCK"; : >"$T/ghx.log"; : >"$T/lock.log"
"${SENV[@]}" "${XENV[@]}" GH_LOCK="$LCK" GH_LOCK_LOG="$T/lock.log" bash -c "$(mb 0 0)" >/dev/null 2>&1
grep -q '^pr merge 7' "$T/ghx.log" && [ "$(cat "$T/lock.log")" = held ] && [ ! -e "$LCK" ] \
    && ok "merge block: a stuck lock (older than 90 min) is taken over, the merge runs under it" || bad "merge block, stuck lock: gh [$(cat "$T/ghx.log")] lock [$(cat "$T/lock.log")]"
rmdir "$LCK" 2>/dev/null
# A live lock (a merge of another session, minutes old) is waited for: no merge while it is there; the merge goes once
# its holder releases it. A stub sleep releases it on its first call, as the other session would, and says so when
# the lock is already gone by then: the block took the live lock for a stuck one and removed it.
SLP="$T/sleepstub"; mkdir -p "$SLP"
printf '#!/usr/bin/env bash\necho "sleep $*" >>"$SLEEP_LOG"\ngrep -q "^pr merge" "$GH_LOG" && echo "merged during the wait" >>"$SLEEP_LOG"\n[ -d "$LIVE_LOCK" ] || echo "the live lock was gone before its holder let it go" >>"$SLEEP_LOG"\nrmdir "$LIVE_LOCK" 2>/dev/null\nexit 0\n' >"$SLP/sleep"; chmod +x "$SLP/sleep"
for sh in "${SHELLS[@]}"; do
    mkdir "$LCK"; : >"$T/ghx.log"; : >"$T/lock.log"; : >"$T/sleep.log"
    "${SENV[@]}" "${XENV[@]}" PATH="$SLP:$GHX:$PATH" SLEEP_LOG="$T/sleep.log" LIVE_LOCK="$LCK" GH_LOCK="$LCK" GH_LOCK_LOG="$T/lock.log" $sh -c "$(mb 0 0)" >/dev/null 2>&1
    [ "$(cat "$T/sleep.log")" = "sleep 30" ] && grep -q '^pr merge 7' "$T/ghx.log" && [ "$(cat "$T/lock.log")" = held ] && [ ! -e "$LCK" ] \
        && ok "$sh: merge block: a live lock is waited for (one sleep 30, no merge during it), then taken; the merge runs under it" \
        || bad "$sh: merge block, live lock: sleep [$(cat "$T/sleep.log")] gh [$(cat "$T/ghx.log")] lock [$(cat "$T/lock.log")]"
    rmdir "$LCK" 2>/dev/null
done

# The request machine's report lookup: only a report by github.account counts.
BRR="$(SKILL="$WAVE" blockf 'report: ([.comments[]')"
[ -n "$BRR" ] || bad "request report block not found in $WAVE"
BRR="$(sub "${BRR//<repo>/$CR}")"; BRR="${BRR//<N>/7}"
jq -n '{state: "OPEN", commits: [{committedDate: "2026-10-18T10:00:00Z"}], comments: [
  {author: {login: "mac-bot"}, createdAt: "2026-10-18T11:00:00Z", body: "Mac checks report: red\nreason"},
  {author: {login: "mallory"}, createdAt: "2026-10-18T12:00:00Z", body: "Mac checks report: green\nall fine"}]}' >"$T/ghx.json"
for sh in "${SHELLS[@]}"; do
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BRR" 2>&1)"
    [ "$(jq -r '.report.verdict' <<<"${got%EXIT=*}" 2>&1)" = "Mac checks report: red" ] && [[ "$got" == *EXIT=0 ]] \
        && ok "$sh: request report block: a green report by another account does not count" || bad "$sh: request report block: [$got]"
done

# The open PRs of other epics, skills/epic-wave section 1: every file of each open PR whose branch does not match
# this epic's tickets.branch (<эпик>/<NN>, the epic is pay-flow here), filtered by gh's own --jq.
BOP="$(SKILL="$WAVE" blockf 'gh pr list --state open --limit 200 --json number,headRefName,files')"
[ -n "$BOP" ] || bad "open PRs of other epics block not found in $WAVE"
BOP="$(sub "${BOP//<repo>/$CR}")"
printf '%s\n' '[{"number":1,"headRefName":"pay-flow/03","files":[{"path":"src/a.ts"}]},
 {"number":2,"headRefName":"ep-link/05","files":[{"path":"src/x.ts"},{"path":"HANDOFF.md"}]},
 {"number":3,"headRefName":"pay-flow/03-extra","files":[{"path":"src/z.ts"}]},
 {"number":4,"headRefName":"fix/empty","files":[]}]' >"$T/ghx.json"
want='#2 ep-link/05 src/x.ts
#2 ep-link/05 HANDOFF.md
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

[ -s "$CHANGED" ] && bad "blocks that Claude Code changes when the skill is called with arguments (a \$N in the text):"$'\n'"$(cat "$CHANGED")" \
    || ok "every block checked here is the same text with and without the arguments [$SKILL_ARGS]"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
