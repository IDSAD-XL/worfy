#!/usr/bin/env bash
# Tests of harness/bin/wave-gate: one `gate full` for the set of ready PRs of a wave.
# Everything runs on temporary git repositories: a bare "origin" with refs/pull/<N>/head, a clone that
# plays the orchestrator's checkout, a stub gate (counts its runs, red on a marker file, "red once",
# code 3, "nothing ran") and a stub gh (`pr merge` squash-merges into the bare origin itself, `pr view`
# answers from refs/pull). No network, no real gate, no real gh, no real /tmp/worfy-e2e.lock.
# Below — the wave-gate blocks of skills/epic-wave/SKILL.md, and its gate full block of one PR with holder.json in the
# e2e lock, cut out of the file and run under bash and zsh.
# Run: bash harness/bin/tests/wave-gate.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$(cd "$HERE/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
WG="$BIN/wave-gate"
SKILL="${SKILL_FILE:-$HARNESS/skills/epic-wave/SKILL.md}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
# A path under $T as node reads it, for the state file: C:/… in Git Bash on Windows (pwd -W), where node reads
# /tmp/… as C:\tmp\…; unchanged elsewhere.
TN="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
tn() { case "$1" in "$T"/*) printf '%s' "$TN${1#"$T"}" ;; *) printf '%s' "$1" ;; esac; }
. "$HERE/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-t}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-t@t}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-t}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-t@t}"
q() { node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=new Function("s","return ("+process.argv[2]+")")(s); process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }

# --- stubs -----------------------------------------------------------------------------
STUBS="$T/stubs"; mkdir -p "$STUBS"
# The stub gate. Its cwd is the tree under test. Every run appends one line to $GATE_LOG:
# "<n> <tree> <files of the tree>". A file RED in the tree — red, with a failing test line; $GATE_DIR/redonce —
# red on the first run only; $GATE_DIR/code3 — exit 3; $GATE_DIR/none — "nothing ran"; $GATE_DIR/kill<n> — the n-th run
# kills wave-gate (its parent) with that file's signal; $GATE_DIR/hold — the run waits while that file exists (at most
# 30 s); $GATE_DIR/lockwatch — records the mtime of $GATE_LOCK at the start and at the end of the run, the end once
# the mtime has moved (at most 10 s later), so a heartbeat that comes late still counts; the holder.json of $GATE_LOCK during the
# run is copied to $GATE_DIR/holder.<n>.json; $GATE_DIR/takeover — a script run first, as another agent would.
# $GATE_DIR/fastgreen — a green line of the fast profile with exit 0; $GATE_DIR/midred — red once, with a line that
# mentions a red verdict in its middle before the red line; $GATE_DIR/words — a script that sets the verdict words.
cat >"$STUBS/gate" <<'EOF'
#!/usr/bin/env bash
# Builtins where a subshell would do: every fork costs tens of milliseconds in Git Bash, and the stub runs often.
n=0; [ -f "$GATE_DIR/count" ] && read -r n <"$GATE_DIR/count"; n=$((n + 1)); echo "$n" >"$GATE_DIR/count"
[ -n "${GATE_LOCK:-}" ] && [ -f "$GATE_LOCK/holder.json" ] && cp "$GATE_LOCK/holder.json" "$GATE_DIR/holder.$n.json"
[ -f "$GATE_DIR/takeover" ] && bash "$GATE_DIR/takeover"
lock=none; [ -n "${GATE_LOCK:-}" ] && [ -d "$GATE_LOCK" ] && lock=held
echo "$n $(git rev-parse HEAD^{tree}) $(ls | tr '\n' ' ') scope=${GATE_SCOPE:-} arg=$1 lock=$lock" >>"$GATE_DIR/log"
if [ -f "$GATE_DIR/artifacts" ]; then  # what an earlier run left in the tree; then leave a build output and node_modules
  echo "$n leftover=$([ -e build-out/leftover ] && echo yes || echo no) nm=$([ -e node_modules/keep ] && echo kept || echo none)" >>"$GATE_DIR/artifacts.log"
  mkdir -p build-out node_modules && touch build-out/leftover node_modules/keep
fi
mt() { node -e 'try{process.stdout.write(String(Math.floor(require("fs").statSync(process.argv[1]).mtimeMs/1000)))}catch{process.stdout.write("gone")}' "$1"; }
[ -f "$GATE_DIR/lockwatch" ] && { m0="$(mt "$GATE_LOCK")"; echo "start $m0" >>"$GATE_DIR/lockwatch"; }
# On Windows wave-gate is not $PPID (the gate stand-in, a node process, runs this stub): its Windows pid is the
# last line the stand-in appended to $STAND_IN_PARENTS, and Git Bash reaches a native process by that pid only
# through kill -f -W.
if [ -f "$GATE_DIR/kill$n" ]; then
  if [ -s "${STAND_IN_PARENTS:-}" ]; then /usr/bin/kill -f -W -"$(cat "$GATE_DIR/kill$n")" "$(tail -n 1 "$STAND_IN_PARENTS")"
  else kill -"$(cat "$GATE_DIR/kill$n")" "$PPID"; fi
  sleep 1; exit 0
fi
i=150; while [ -f "$GATE_DIR/hold" ] && [ "$i" -gt 0 ]; do sleep 0.2; i=$((i - 1)); done
# The verdict words: English, as the gate prints them; $GATE_DIR/old — the Russian words of the gate of the
# release before, which wave-gate still reads.
# shortcut: accepts the old Russian token, remove after the next release
if [ -f "$GATE_DIR/old" ]; then green="[gate] зелено"; red="[gate] красно"; passed="прошло"; none="[gate] ничего не прогналось"; unv="[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ"
else green="[gate] green"; red="[gate] red"; passed="passed"; none="[gate] nothing ran"; unv="[gate] not verified"; fi
[ -f "$GATE_DIR/words" ] && . "$GATE_DIR/words"
if [ -f "$GATE_DIR/lockwatch" ]; then
  m1="$(mt "$GATE_LOCK")"; i=50; while [ "$m1" = "$m0" ] && [ "$i" -gt 0 ]; do sleep 0.2; m1="$(mt "$GATE_LOCK")"; i=$((i - 1)); done
  echo "end $m1" >>"$GATE_DIR/lockwatch"
fi
# $GATE_DIR/lockscreen — the run locks the screen: its contents go to $SCREEN_DIR/locked; $GATE_DIR/lockfor — the run
# locks the screen until the stub ioreg has answered Yes once (at most that many seconds) and unlocks it before it
# ends — wave-gate's poll during the run sees the lock however late its ioreg starts; $GATE_DIR/window — the run is red in the
# script named in the file (test:e2e when empty) and prints what the real gate prints for it: the
# "[gate] red (full): <project>/<workspace>:<script> (passed: …)" line and the last 40 lines of the script —
# Playwright's list of failed tests, without the "window was not shown" message that scrolled out of them.
# They are used once, unless $GATE_DIR/keep exists. $GATE_DIR/unitonce — red once in `test` alone.
if [ -f "$GATE_DIR/lockfor" ]; then
  yes0=0; [ -f "$SCREEN_DIR/yes.log" ] && yes0=$(( $(wc -l <"$SCREEN_DIR/yes.log") ))
  : >"$SCREEN_DIR/locked"; i=$(( $(cat "$GATE_DIR/lockfor") * 5 ))
  while [ "$i" -gt 0 ] && [ "$(( $(cat "$SCREEN_DIR/yes.log" 2>/dev/null | wc -l) ))" -le "$yes0" ]; do sleep 0.2; i=$((i - 1)); done
  rm -f "$SCREEN_DIR/locked" "$GATE_DIR/lockfor"
fi
if [ -f "$GATE_DIR/lockscreen" ]; then cp "$GATE_DIR/lockscreen" "$SCREEN_DIR/locked"; [ -f "$GATE_DIR/keep" ] || rm -f "$GATE_DIR/lockscreen"; fi
if [ -f "$GATE_DIR/window" ]; then script="$(cat "$GATE_DIR/window")"; script="${script:-test:e2e}"; [ -f "$GATE_DIR/keep" ] || rm -f "$GATE_DIR/window"
  { echo "$red (full): worfy/.:$script ($passed: worfy/.:lint worfy/.:typecheck worfy/.:test)"
    echo "The quality gate did not pass (profile: full, repository: worfy)."; echo "--- FAILED: worfy/.:$script"
    for i in $(seq 1 36); do echo "  ✘  $i [electron] › test/e2e/spec$i.spec.ts:12:3 › case $i (30.2s)"; done
    echo "  36 failed"; echo "  4 passed (19.8m)"; echo " ELIFECYCLE  Command failed with exit code 1."; } >&2; exit 2; fi
if [ -f "$GATE_DIR/unitonce" ]; then rm -f "$GATE_DIR/unitonce"
  echo "$red (full): worfy/.:test ($passed: worfy/.:lint worfy/.:test:e2e)" >&2; echo " FAIL  test/unit/red.test.ts > is red" >&2; exit 2; fi
if [ -f "$GATE_DIR/fastgreen" ]; then echo "$green (fast): lint"; exit 0; fi
if [ -f "$GATE_DIR/midred" ]; then rm -f "$GATE_DIR/midred"
  echo "  > echo \"$red (x): bogus\"" >&2; echo "$red (full): test ($passed: lint)" >&2; echo " FAIL  test/unit/red.test.ts > is red" >&2; exit 2; fi
if [ -f "$GATE_DIR/code3" ]; then echo "$unv: stub" >&2; exit 3; fi
if [ -f "$GATE_DIR/none" ]; then echo "$none (full): stub. This is not green."; exit 0; fi
if [ -f "$GATE_DIR/redonce" ]; then rm -f "$GATE_DIR/redonce"
  echo "$red (full): test:e2e ($passed: lint test)" >&2; echo " FAIL  test/e2e/flaky.spec.ts > opens the window" >&2; exit 2; fi
if [ -f RED ]; then echo "$red (full): test ($passed: lint)" >&2; echo " FAIL  test/unit/red.test.ts > is red" >&2; exit 2; fi
echo "$green (full): lint test test:e2e"
EOF
# The stub gh: `pr merge <N> --squash --match-head-commit <sha>` squash-merges refs/pull/<N>/head into main of
# $GH_ORIGIN and pushes; with GH_EXTRA_AT=<N> that merge also adds a file (another tree than the checked one).
# `pr view <N> --json …` prints the PR from refs/pull/<N>/head and the labels in $GH_LABELS_<N>.
cat >"$STUBS/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
if [ "$1 $2" = "pr view" ]; then
  n=$3; l="GH_LABELS_$n"; labels=""; sep=""
  for x in ${!l:-}; do labels="$labels$sep{\"name\":\"$x\"}"; sep=","; done
  printf '{"number":%s,"headRefOid":"%s","labels":[%s]}\n' "$n" "$(git -C "$GH_ORIGIN" rev-parse "refs/pull/$n/head")" "$labels"; exit 0
fi
# `pr checks` is red ("no checks reported", exit 1): with workflow.ci "batch" a PR has no CI run on its head.
[ "$1 $2" = "pr checks" ] && { echo "no checks reported on the 'pr' branch" >&2; exit 1; }
# `workflow run …` (the batch CI dispatch): exit $GH_DISPATCH_RC (0), prints $GH_RUN_URL when it is set.
# `run list …` prints $GH_RUNS (a file with the JSON list), or [] without it.
if [ "$1 $2" = "workflow run" ]; then [ -n "${GH_RUN_URL:-}" ] && echo "$GH_RUN_URL"; exit "${GH_DISPATCH_RC:-0}"; fi
if [ "$1 $2" = "run list" ]; then if [ -n "${GH_RUNS:-}" ] && [ -f "$GH_RUNS" ]; then cat "$GH_RUNS"; else echo "[]"; fi; exit 0; fi
[ "$1 $2" = "pr merge" ] || { echo "stub gh: unexpected $*" >&2; exit 1; }
n=$3; sha=""; shift 3
# GH_MERGE_FAIL_AT=<N>: the merge of PR N is refused, as GitHub refuses a PR it cannot merge.
[ "${GH_MERGE_FAIL_AT:-}" = "$n" ] && { echo "stub gh: Pull request #$n is not mergeable" >&2; exit 1; }
while [ $# -gt 0 ]; do [ "$1" = "--match-head-commit" ] && sha=$2; shift; done
[ "$sha" = "$(git -C "$GH_ORIGIN" rev-parse "refs/pull/$n/head")" ] || { echo "head mismatch" >&2; exit 1; }
w=$(mktemp -d "$GH_TMP/m.XXXXXX")
git clone -q "$GH_ORIGIN" "$w/c" && cd "$w/c" && git fetch -q origin "refs/pull/$n/head" && git merge -q --squash FETCH_HEAD >/dev/null || exit 1
[ "${GH_EXTRA_AT:-}" = "$n" ] && echo extra >extra.txt && git add extra.txt
git commit -q --allow-empty -m "squash #$n" && git push -q origin HEAD:main
EOF
chmod +x "$STUBS/gate" "$STUBS/gh"
# The screen stubs, in a folder of their own: every test finds them before the real /usr/sbin/ioreg and
# /usr/bin/caffeinate, so no test reads the real screen state or holds the real display awake.
# ioreg: `"IOConsoleLocked" = Yes` while $SCREEN_DIR/locked exists — always if the file is empty, the next
# N answers if it holds N; each call is logged to $SCREEN_DIR/ioreg.log, each Yes also to $SCREEN_DIR/yes.log.
# caffeinate: logs "<own pid> <args>" to $SCREEN_DIR/caf.log and, like the real one with -w, lives until
# that pid is gone.
POWER="$T/power"; mkdir -p "$POWER"
cat >"$POWER/ioreg" <<'EOF'
#!/usr/bin/env bash
d="${SCREEN_DIR:-/nonexistent}"; echo "$*" >>"$d/ioreg.log" 2>/dev/null
v=No
if [ -f "$d/locked" ]; then
  v=Yes; n="$(cat "$d/locked")"; echo "$*" >>"$d/yes.log" 2>/dev/null
  if [ -n "$n" ]; then n=$((n - 1)); if [ "$n" -le 0 ]; then rm -f "$d/locked"; else echo "$n" >"$d/locked"; fi; fi
fi
printf '+-o Root  <class IORegistryEntry, id 0x100000100, retain 31>\n    {\n      "IOConsoleUsers" = ()\n      "IOConsoleLocked" = %s\n    }\n' "$v"
EOF
cat >"$POWER/caffeinate" <<'EOF'
#!/usr/bin/env bash
echo "$$ $*" >>"${SCREEN_DIR:-/nonexistent}/caf.log" 2>/dev/null
w=""; while [ $# -gt 0 ]; do [ "$1" = -w ] && w=$2; shift; done
[ -n "$w" ] || exit 0
while kill -0 "$w" 2>/dev/null; do sleep 0.2; done
EOF
chmod +x "$POWER/ioreg" "$POWER/caffeinate"
export WAVE_GATE_GATE="$STUBS/gate" PATH="$STUBS:$POWER:$PATH"
# On Windows node cannot start the shell stubs, and its PATH lookup finds the real gh.exe: wave-gate runs the
# gate and gh through node stand-ins named by $WAVE_GATE_GATE and $WAVE_GATE_GH there. The guard stops the test
# before anything runs if any gh it can start is not the stub.
. "$HERE/gh-stand-in.sh"
if on_windows; then
    node_stand_in "$STUBS/gate" "$STUBS/gate.mjs"; node_stand_in "$STUBS/gh" "$STUBS/gh.mjs"
    export WAVE_GATE_GATE="$STUBS/gate.mjs" WAVE_GATE_GH="$STUBS/gh.mjs"
fi
gh_guard WAVE_GATE_GH "$STUBS/gh" "$STUBS/gh.mjs"
# What Git Bash on Windows cannot run is skipped there, one line each:
# - the screen cases: wave-gate starts `ioreg` and `caffeinate` by name without a shell, and node on Windows starts
#   only a .com or .exe that way, so the shell stubs never start — as on a real Windows machine, which has neither
#   command and where wave-gate checks no screen. "no ioreg in PATH" below still runs there;
# - the SIGTERM case: a kill from Git Bash ends a native node process without running its signal handlers, so
#   wave-gate cannot release the e2e lock on SIGTERM there (SIGKILL needs no handler and runs);
# - zsh: Git Bash on Windows has none.
# Off Windows every case runs: a skip that fired there would leave cases out while the file stays green.
RUN_SCREEN=true RUN_SIGTERM=true SHELLS=(bash zsh) skips=0
skip() { skips=$((skips + 1)); echo "skip $1"; }
if on_windows; then
    RUN_SCREEN=false RUN_SIGTERM=false
    skip "the screen cases (ioreg, caffeinate): node on Windows starts no shell stub by name, and Windows has neither command"
    skip "the SIGTERM case: a kill from Git Bash ends node on Windows without running its signal handlers"
    if ! command -v zsh >/dev/null 2>&1; then
        SHELLS=(bash); skip "zsh: Git Bash on Windows has no zsh, the zsh cases run on macOS and Linux"
    fi
fi
# The guard of the above: off Windows (by uname, not by on_windows) no skip fired and every case is on.
case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) ;;
    *) [ "$skips" = 0 ] && $RUN_SCREEN && $RUN_SIGTERM && [[ " ${SHELLS[*]} " == *" zsh "* ]] \
           && ok "off Windows no case is skipped (screen, SIGTERM, zsh)" \
           || bad "off Windows a Windows skip fired: $skips skip line(s), screen $RUN_SCREEN, SIGTERM $RUN_SIGTERM, shells [${SHELLS[*]}]" ;;
esac
# Fast lock timings for the tests; the defaults (20 s poll, 30 min stale, 5 min heartbeat) are checked below.
export WAVE_GATE_LOCK_POLL_S=1 WAVE_GATE_SCREEN_POLL_S=1

# --- a world: bare origin, PR refs, the orchestrator's clone ----------------------------
# new_world <name> <spec>…: each spec is "<N>:<file>[=<content>]" — PR N forks off main and writes that file
# (content defaults to the PR number). RED as the file name makes the gate red on every tree that has it.
# One push for main and every PR ref: a local push costs about 0.4 s on Windows, and the file runs 35 worlds.
new_world() {
    W="$T/$1"; shift
    mkdir -p "$W/gate" "$W/gh" "$W/screen"
    local refs=(main:main)
    git init -q --bare -b main "$W/origin.git"
    git clone -q "$W/origin.git" "$W/seed" 2>/dev/null
    echo base >"$W/seed/base.txt"; echo shared >"$W/seed/shared.txt"; printf 'build-out/\nnode_modules/\n' >"$W/seed/.gitignore"
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m base
    for spec in "$@"; do
        n="${spec%%:*}"; f="${spec#*:}"; c="$n"
        case "$f" in *=*) c="${f#*=}"; f="${f%%=*}" ;; esac
        git -C "$W/seed" checkout -q -b "pr$n" main
        echo "$c" >"$W/seed/$f"
        git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "pr $n"
        refs+=("pr$n:refs/pull/$n/head")
    done
    [ $# -eq 0 ] || git -C "$W/seed" checkout -q main
    git -C "$W/seed" push -q origin "${refs[@]}"
    git clone -q "$W/origin.git" "$W/repo"
    export GATE_DIR="$W/gate" GH_ORIGIN="$W/origin.git" GH_LOG="$W/gh/log" GH_TMP="$W/gh" SCREEN_DIR="$W/screen"
    unset GATE_LOCK GH_EXTRA_AT GH_RUN_URL GH_RUNS GH_DISPATCH_RC GH_MERGE_FAIL_AT
}
head_of() { git -C "$W/origin.git" rev-parse "refs/pull/$1/head"; }
# state <file> <lock or null> <pr>…: each pr is "<N>[,platform][,label=<name>]"; the cross-machine label of the
# profile is $XLABEL as JSON (default "needs-mac-gate", the label of worfy's profile)
state() {
    local f="$1" lock="$2"; shift 2
    local items="" sep=""
    for p in "$@"; do
        local n="${p%%,*}" plat=false labels=""
        [[ "$p" == *,platform* ]] && plat=true
        [[ "$p" == *,label=* ]] && labels="\"${p##*,label=}\""
        items="$items$sep{\"number\":$n,\"head\":\"$(head_of "$n")\",\"labels\":[$labels],\"platform\":$plat}"; sep=","
    done
    [ "$lock" = null ] || lock="\"$(tn "$lock")\""
    printf '{"repo":"%s","branch":"main","e2e_lock":%s,"prepare":null,"cross_machine_label":%s,"prs":[%s]}\n' "$(tn "$W/repo")" "$lock" "${XLABEL:-\"needs-mac-gate\"}" "$items" >"$f"
}
gate_count() { cat "$GATE_DIR/count" 2>/dev/null || echo 0; }
# until_ok <seconds> <command…>: polls the command every 0.2 s; exit 0 as soon as it succeeds, 1 after the time
until_ok() { local n=$(( $1 * 5 )); shift; while [ "$n" -gt 0 ]; do "$@" && return 0; sleep 0.2; n=$((n - 1)); done; return 1; }
# caf_gone <caf.log>…: every stub caffeinate those logs name has ended (within 3 s)
caf_alive() { local f p; for f in "$@"; do [ -f "$f" ] || continue; for p in $(awk '{print $1}' "$f"); do kill -0 "$p" 2>/dev/null && return 0; done; done; return 1; }
caf_gone() { local n=15; while caf_alive "$@"; do n=$((n - 1)); [ "$n" -le 0 ] && return 1; sleep 0.2; done; return 0; }
TMPW_OF() { echo "$(cd "$W/repo/.git" && pwd -P)/worfy-wave-gate"; }
prefix_tree() { git -C "$W/seed" rev-parse "$1^{tree}"; }

# --- red set: no PR outside the green prefix is marked for merge (the first test, red before the script) ---
new_world red5 1:a.txt 2:b.txt 3:RED 4:d.txt 5:e.txt
S="$W/state.json"; state "$S" null 1 2 3 4 5
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "red set: check exits 2" || bad "red set: check exit $rc: $(tail -5 "$W/out")"
[ "$(q "$S" s.status)" = red ] && ok "red set: status red" || bad "red set: status $(q "$S" s.status 2>&1)"
[ "$(q "$S" s.culprit)" = 3 ] && ok "red set: the culprit is PR 3" || bad "red set: culprit $(q "$S" s.culprit 2>&1)"
[ "$(q "$S" 's.green_prefix')" = "[1,2]" ] && ok "red set: green_prefix is PRs 1-2" || bad "red set: green_prefix $(q "$S" s.green_prefix 2>&1)"
[ "$(q "$S" s.green_tree)" = "$(q "$S" 's.prefixes[1].tree')" ] && [ -n "$(q "$S" s.green_tree)" ] \
    && ok "red set: green_tree is the tree of the prefix 1-2" || bad "red set: green_tree $(q "$S" s.green_tree 2>&1)"
# runs: the first, the repeat and the bisection — at most 2+ceil(log2 5) = 5 runs of the gate
c=$(gate_count)
[ "$c" -ge 3 ] && [ "$c" -le 5 ] && ok "red set: $c gate runs (at most 2+ceil(log2 5) = 5)" || bad "red set: $c gate runs"
[ "$(q "$S" 's.runs.filter(r=>r.role==="retry").length')" = 1 ] && [ "$(q "$S" 's.runs[1].size')" = 5 ] \
    && ok "red set: the whole set is run again before the bisection" || bad "red set: no repeat of the whole set: $(q "$S" 's.runs.map(r=>r.role+r.size)')"
grep -q "scope=all arg=full" "$GATE_DIR/log" && ! grep -qv "scope=all arg=full" "$GATE_DIR/log" \
    && ok "red set: every run is GATE_SCOPE=all gate full" || bad "red set: gate args: $(cat "$GATE_DIR/log")"
[ ! -e "$(TMPW_OF)" ] && ok "red set: the temporary worktree is removed" || bad "red set: worktree left at $(TMPW_OF)"
# merge of a red set: only the green prefix
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
merged="$(awk '$1=="pr" && $2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')"
[ "$rc" -eq 0 ] && [ "$merged" = "1 2 " ] && ok "red set: merge merges only PRs 1 and 2" || bad "red set: merge exit $rc, merged [$merged]: $(tail -3 "$W/mout")"
[ "$(git -C "$W/origin.git" rev-parse 'main^{tree}')" = "$(q "$S" s.green_tree)" ] && ok "red set: main has the tree of the green prefix" || bad "red set: main tree differs"
[ "$(q "$S" s.merge.status)" = done ] && ok "red set: merge.status done" || bad "red set: merge.status $(q "$S" s.merge.status 2>&1)"
"$WG" merge "$S" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(grep -c 'pr merge' "$GH_LOG")" = 2 ] && ok "red set: merge again merges nothing more" || bad "red set: second merge exit $rc"

# --- green set of three: base, order, heads, the tree of every prefix ----------------------
new_world green3 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && ok "green set: exit 0, status green" || bad "green set: exit $rc status $(q "$S" s.status 2>&1): $(tail -5 "$W/out")"
[ "$(q "$S" s.base)" = "$(git -C "$W/origin.git" rev-parse main)" ] && ok "green set: base is the SHA of origin/main" || bad "green set: base $(q "$S" s.base)"
[ "$(q "$S" 's.set')" = "[1,2,3]" ] && ok "green set: the set in merge order" || bad "green set: set $(q "$S" s.set)"
[ "$(q "$S" 's.prefixes.map(p=>p.head).join(" ")')" = "$(head_of 1) $(head_of 2) $(head_of 3)" ] && ok "green set: the head SHA of every PR" || bad "green set: heads"
# the tree after every prefix, built independently: main + a, + b, + c
git -C "$W/seed" checkout -q -b expect main
want=""
for n in 1 2 3; do git -C "$W/seed" merge -q --squash "pr$n" >/dev/null 2>&1 && git -C "$W/seed" commit -q -m "e$n" && want="$want $(git -C "$W/seed" rev-parse 'HEAD^{tree}')"; done
[ "$(q "$S" 's.prefixes.map(p=>" "+p.tree).join("")')" = "$want" ] && ok "green set: prefixes[i].tree equals the squash of PRs 1..i" || bad "green set: prefix trees [$(q "$S" 's.prefixes.map(p=>p.tree)')] want [$want]"
[ "$(gate_count)" = 1 ] && ok "green set: one gate run" || bad "green set: $(gate_count) gate runs"
grep -q "a.txt b.txt base.txt c.txt" "$GATE_DIR/log" && ok "green set: the gate runs on the tree of the whole set" || bad "green set: gate tree: $(cat "$GATE_DIR/log")"
[ ! -e "$(TMPW_OF)" ] && ok "green set: the temporary worktree is removed" || bad "green set: worktree left"
"$WG" check "$S" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && ok "green set: check again on a finished state runs no gate" || bad "green set: second check exit $rc, $(gate_count) runs"
# merge of the green set
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 2 3 " ] && ok "green set: merge merges 1, 2, 3 in order" || bad "green set: merge exit $rc: $(tail -3 "$W/mout")"
grep -q -- "--squash --match-head-commit $(head_of 2)" "$GH_LOG" && ok "green set: gh pr merge --squash --match-head-commit <head>" || bad "green set: gh args $(cat "$GH_LOG")"
[ "$(q "$S" 's.merge.merged.map(m=>m.tree).join(" ")')" = "$(q "$S" 's.prefixes.map(p=>p.tree).join(" ")')" ] && ok "green set: the tree of main after each merge is recorded and equal" || bad "green set: merged trees"

# --- a conflict of the second PR: DIRTY, the others are checked ------------------------------
new_world dirty 1:shared.txt=one 2:shared.txt=two 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,3]" ] && ok "conflict: the set is 1, 3" || bad "conflict: exit $rc set $(q "$S" s.set 2>&1): $(tail -5 "$W/out")"
[ "$(q "$S" 's.excluded.map(e=>e.number+":"+e.reason).join(" ")')" = "2:DIRTY" ] && ok "conflict: PR 2 is out of the set with DIRTY" || bad "conflict: excluded $(q "$S" s.excluded)"
grep -q "a.txt\|c.txt" "$GATE_DIR/log" && grep -q "c.txt" "$GATE_DIR/log" && ok "conflict: the gate ran on 1 + 3" || bad "conflict: gate log $(cat "$GATE_DIR/log")"
[ ! -e "$(TMPW_OF)" ] && ok "conflict: the temporary worktree is removed" || bad "conflict: worktree left"

# --- platform and needs-mac-gate: out of the set, not merged, not run ---------------------
new_world plat 1:a.txt 2:b.txt 3:c.txt 4:d.txt
S="$W/state.json"; state "$S" null 1 2,platform 3,label=needs-mac-gate 4
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,4]" ] && ok "platform: the set is 1, 4" || bad "platform: exit $rc set $(q "$S" s.set 2>&1)"
[ "$(q "$S" 's.excluded.map(e=>e.number+":"+e.reason).join(" ")')" = "2:platform 3:needs-mac-gate" ] && ok "platform: 2 platform, 3 needs-mac-gate — with the reasons" || bad "platform: excluded $(q "$S" s.excluded)"
! grep -q "b.txt\|c.txt" "$GATE_DIR/log" && ok "platform: their changes are not in the gate's tree" || bad "platform: gate tree has them: $(cat "$GATE_DIR/log")"
"$WG" merge "$S" >/dev/null 2>&1
[ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 4 " ] && ok "platform: merge merges only 1 and 4" || bad "platform: merged $(cat "$GH_LOG")"
# The label is the profile's cross_machine_gate.label from the state file, not a name in wave-gate:
# another project's label takes its PR out, worfy's name is then an ordinary label; null — no such label.
new_world xlabel 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; XLABEL='"needs-pc-gate"' state "$S" null 1 2,label=needs-pc-gate 3,label=needs-mac-gate
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,3]" ] && [ "$(q "$S" 's.excluded.map(e=>e.number+":"+e.reason).join(" ")')" = "2:needs-pc-gate" ] \
    && ok "label: the profile's label (needs-pc-gate) takes PR 2 out; needs-mac-gate is an ordinary label then" || bad "label: exit $rc set $(q "$S" s.set 2>&1) excluded $(q "$S" s.excluded 2>&1)"
new_world xlabel-null 1:a.txt 2:b.txt
S="$W/state.json"; XLABEL=null state "$S" null 1 2,label=needs-mac-gate
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,2]" ] && [ "$(q "$S" 's.excluded.length')" = 0 ] \
    && ok "label: null (no cross-machine gate in the profile) takes no PR out by a label" || bad "label null: exit $rc set $(q "$S" s.set 2>&1)"
# A state file written before the field existed has no cross_machine_label: the label is then needs-mac-gate, the one
# wave-gate used before it took the label from the profile — for check and for merge.
new_world xlabel-old 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2,label=needs-mac-gate 3
node -e 'const fs=require("fs"),f=process.argv[1],s=JSON.parse(fs.readFileSync(f,"utf8"));delete s.cross_machine_label;fs.writeFileSync(f,JSON.stringify(s))' "$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,3]" ] && [ "$(q "$S" 's.excluded.map(e=>e.number+":"+e.reason).join(" ")')" = "2:needs-mac-gate" ] \
    && ok "label: an old state file without cross_machine_label — check takes the needs-mac-gate PR out" || bad "label old: exit $rc set $(q "$S" s.set 2>&1) $(cat "$W/out")"
node -e 'const fs=require("fs"),f=process.argv[1],s=JSON.parse(fs.readFileSync(f,"utf8"));delete s.cross_machine_label;fs.writeFileSync(f,JSON.stringify(s))' "$S"
"$WG" merge "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 3 " ] \
    && ok "label: an old state file without cross_machine_label — merge merges 1 and 3, not the needs-mac-gate PR" || bad "label old merge: exit $rc merged [$(cat "$GH_LOG")] $(cat "$W/out")"

# --- red, then green on the repeat: flaky ----------------------------------------------
new_world flaky 1:a.txt 2:b.txt
S="$W/state.json"; state "$S" null 1 2; touch "$GATE_DIR/redonce"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [ "$(gate_count)" = 2 ] && ok "flaky: status green after a green repeat (2 runs)" || bad "flaky: exit $rc status $(q "$S" s.status) runs $(gate_count)"
[[ "$(q "$S" s.flaky)" == *"test/e2e/flaky.spec.ts > opens the window"* && "$(q "$S" s.flaky)" == *"test:e2e"* && "$(q "$S" s.flaky)" != *"lint"* ]] && ok "flaky: the failing tests and scripts of the first run are recorded, not the passed ones" || bad "flaky: $(q "$S" s.flaky 2>&1)"

# --- could not verify: code 3 and "nothing ran" ------------------------------------------
for mode in code3 none; do
    new_world "unv-$mode" 1:a.txt 2:b.txt
    S="$W/state.json"; state "$S" null 1 2; touch "$GATE_DIR/$mode"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 3 ] && [ "$(q "$S" s.status)" = unverified ] && [ "$(gate_count)" = 1 ] && ok "$mode: status unverified, exit 3, no repeat" || bad "$mode: exit $rc status $(q "$S" s.status 2>&1) runs $(gate_count)"
    "$WG" merge "$S" >/dev/null 2>&1; rc=$?
    [ "$rc" -ne 0 ] && [ ! -s "$GH_LOG" ] && ok "$mode: merge refuses, no gh call" || bad "$mode: merge exit $rc, gh: $(cat "$GH_LOG" 2>/dev/null)"
    [ ! -e "$(TMPW_OF)" ] && ok "$mode: the temporary worktree is removed" || bad "$mode: worktree left"
done
# a later check after an unverified run tries again
rm -f "$GATE_DIR/none"
"$WG" check "$S" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && ok "unverified: check again, now green" || bad "unverified: second check exit $rc status $(q "$S" s.status)"

# --- the Russian verdict lines of the gate of the release before --------------------------------
# shortcut: accepts the old Russian token, remove after the next release
new_world oldgreen 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/old"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && ok "old gate: the Russian green line is green" || bad "old gate green: exit $rc status $(q "$S" s.status 2>&1): $(cat "$W/out")"
new_world oldflaky 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/old" "$GATE_DIR/redonce"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [[ "$(q "$S" s.flaky)" == *"test:e2e"* && "$(q "$S" s.flaky)" != *"lint"* ]] \
    && ok "old gate: the failed scripts are read from the Russian red line, without the passed ones" || bad "old gate red: exit $rc flaky $(q "$S" s.flaky 2>&1)"
new_world oldnone 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/old" "$GATE_DIR/none"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 3 ] && [ "$(q "$S" s.status)" = unverified ] && ok "old gate: the Russian «nothing ran» line is not green" || bad "old gate none: exit $rc status $(q "$S" s.status 2>&1)"

# --- what the verdict lines must hold to count ------------------------------------------------
# A green line of another profile is not the green of `gate full`.
new_world fastgreen 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/fastgreen"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 3 ] && [ "$(q "$S" s.status)" = unverified ] && ok "a green line of the fast profile with exit 0 is unverified, not green" || bad "fast green: exit $rc status $(q "$S" s.status 2>&1)"
# A line that mentions a red verdict in its middle is not the red line of the gate.
new_world midred 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/midred"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.flaky.scripts.join(" ")')" = test ] \
    && ok "the failed scripts come from the line that starts with the red verdict, not from a line that mentions it" || bad "mid-line red: exit $rc flaky $(q "$S" s.flaky 2>&1)"
# The words wave-gate reads are the words harness/hooks/gate.mjs prints: the stub prints lines built from the
# literals of gate.mjs, so a word renamed there and not here turns these checks red.
GATE_MJS="${GATE_MJS:-$HARNESS/hooks/gate.mjs}"
words="$(node -e '
const s = require("fs").readFileSync(process.argv[1], "utf8")
const g = s.match(/say\("\[gate\] ([^"(]+?) \(" \+ PROFILE \+ "\):" \+ ran\)/)
const r = s.match(/complain\("\[gate\] ([^"(]+?) \(" \+ PROFILE \+ "\):" \+ failedLabels/)
const p = s.match(/" \(([^":(]+):" \+ ran \+ "\)"/)
if (!g || !r || !p) process.exit(1)
process.stdout.write([g[1], r[1], p[1]].join("\n") + "\n")' "$GATE_MJS" | tr -d '\r')"; rc=$?
{ read -r GW; read -r RW; read -r PW; } <<<"$words"
[ "$rc" -eq 0 ] && [ -n "$GW" ] && [ -n "$RW" ] && [ -n "$PW" ] && ok "gate.mjs: the green, red and passed words are found ($GW, $RW, $PW)" || bad "gate.mjs: words not found (exit $rc): $words"
new_world gatewords 1:a.txt
printf 'green=%q; red=%q; passed=%q\n' "[gate] $GW" "[gate] $RW" "$PW" >"$GATE_DIR/words"
S="$W/state.json"; state "$S" null 1
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && ok "gate.mjs words: its green line of gate full is green" || bad "gate.mjs green: exit $rc status $(q "$S" s.status 2>&1): $(cat "$W/out")"
new_world gatewordsred 1:a.txt
printf 'green=%q; red=%q; passed=%q\n' "[gate] $GW" "[gate] $RW" "$PW" >"$GATE_DIR/words"; touch "$GATE_DIR/redonce"
S="$W/state.json"; state "$S" null 1
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.flaky.scripts.join(" ")')" = test:e2e ] \
    && ok "gate.mjs words: the failed scripts are read from its red line, without the passed ones" || bad "gate.mjs red: exit $rc flaky $(q "$S" s.flaky 2>&1)"

# --- resume: a run broken off after the first gate full ----------------------------------
new_world resume 1:a.txt 2:b.txt 3:RED 4:d.txt 5:e.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2 3 4 5
echo KILL >"$GATE_DIR/kill2"   # the second run (the repeat) kills wave-gate: an abrupt end of the session
# STAND_IN_PARENTS: on Windows the gate stub finds wave-gate's pid there (no file is written elsewhere)
STAND_IN_PARENTS="$GATE_DIR/parents" "$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 137 ] && [ "$(q "$S" 's.runs.length')" = 1 ] && [ "$(q "$S" 's.runs[0].outcome')" = red ] && ok "resume: killed after the first run, which is recorded" || bad "resume: exit $rc runs $(q "$S" s.runs 2>&1)"
[ -d "$(TMPW_OF)" ] && ok "resume: the broken run left its worktree" || bad "resume: no worktree left"
before=$(gate_count)
WAVE_GATE_LOCK_STALE_S=2 "$WG" check "$S" >"$W/out2" 2>&1; rc=$?
after=$(gate_count)
[ "$rc" -eq 2 ] && [ "$(q "$S" s.culprit)" = 3 ] && ok "resume: the second check finds PR 3" || bad "resume: exit $rc culprit $(q "$S" s.culprit 2>&1): $(tail -5 "$W/out2")"
# 4 runs in all (full, retry, 2 bisect); the first is not repeated: 2 + 3 = 5 stub calls with the killed one
[ "$before" = 2 ] && [ "$after" = 5 ] && [ "$(q "$S" 's.runs.length')" = 4 ] && ok "resume: the finished run is not repeated ($before + $((after - before)) stub calls)" || bad "resume: stub calls $before then $after, runs $(q "$S" 's.runs.length')"
grep -q "reus" "$W/out2" && ok "resume: the worktree of the broken run is reused" || bad "resume: no reuse in the output: $(head -5 "$W/out2")"
[ ! -e "$(TMPW_OF)" ] && [ ! -e "$L" ] && ok "resume: worktree and stale lock gone after the end" || bad "resume: worktree or lock left"
# the run killed with SIGKILL ran no exit handler: its caffeinate ends because of -w <its pid> alone
if $RUN_SCREEN; then
    [ "$(wc -l <"$SCREEN_DIR/caf.log" | tr -d ' ')" = 2 ] && caf_gone "$SCREEN_DIR/caf.log" \
        && ok "resume: no caffeinate left after a SIGKILL of wave-gate" || bad "resume: caffeinate left: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
fi
# origin/main moved: the state is reset, the set is checked again
new_world moved 1:a.txt 2:b.txt
S="$W/state.json"; state "$S" null 1 2
"$WG" check "$S" >/dev/null 2>&1
old_base="$(q "$S" s.base)"
echo more >"$W/seed/more.txt"; git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m more && git -C "$W/seed" push -q origin HEAD:main
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.base)" = "$(git -C "$W/origin.git" rev-parse main)" ] && [ "$(q "$S" s.base)" != "$old_base" ] && [ "$(gate_count)" = 2 ] \
    && ok "base moved: check again resets and checks on the new base" || bad "base moved: exit $rc base $(q "$S" s.base) runs $(gate_count)"
grep -q "more.txt" "$GATE_DIR/log" && ok "base moved: the new run has the new base in its tree" || bad "base moved: gate tree $(tail -1 "$GATE_DIR/log")"

# --- merge: base moved, tree mismatch ------------------------------------------------------
new_world mbase 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >/dev/null 2>&1
echo other >"$W/seed/other.txt"; git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m other && git -C "$W/seed" push -q origin HEAD:main
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 4 ] && [ ! -s "$GH_LOG" ] && ok "merge: origin/main != base -> no merge, exit 4" || bad "merge base moved: exit $rc gh $(cat "$GH_LOG" 2>/dev/null)"
[[ "$(q "$S" s.merge.stopped.reason)" == "base moved"* ]] && ok "merge: the reason is base moved" || bad "merge base moved: reason $(q "$S" s.merge 2>&1)"
new_world mtree 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >/dev/null 2>&1
GH_EXTRA_AT=2 "$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 4 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 2 " ] && ok "merge: the tree after PR 2 differs -> PR 3 is not merged" || bad "merge tree: exit $rc gh $(cat "$GH_LOG")"
[ "$(q "$S" s.merge.stopped.number)" = 2 ] && [[ "$(q "$S" s.merge.stopped.reason)" == *"tree"* ]] && ok "merge: the stop names PR 2 and the tree" || bad "merge tree: stopped $(q "$S" s.merge 2>&1)"
grep -q "gate full on" "$W/mout" && ok "merge: the stop asks for gate full on the main branch" || bad "merge tree: output $(cat "$W/mout")"
"$WG" merge "$S" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 4 ] && [ "$(grep -c 'pr merge' "$GH_LOG")" = 2 ] && ok "merge: a stopped merge does not go on" || bad "merge tree: second merge exit $rc"

# --- merge resumed after a break: the main branch must still be the commit of the last recorded merge ---
new_world mresume 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >/dev/null 2>&1
# PR 1 merged, then the session broke before PR 2: the state has merge.merged = [#1], status pending
gh pr merge 1 --squash --match-head-commit "$(head_of 1)" >/dev/null 2>&1
m1="$(git -C "$W/origin.git" rev-parse main)"
node -e 'const fs=require("fs"),[f,c,t]=process.argv.slice(1),s=JSON.parse(fs.readFileSync(f,"utf8")); s.merge={merged:[{number:1,commit:c,tree:t}],status:"pending"}; fs.writeFileSync(f,JSON.stringify(s))' \
    "$S" "$m1" "$(git -C "$W/origin.git" rev-parse 'main^{tree}')"
cp "$S" "$W/state-clean.json"
: >"$GH_LOG"
echo foreign >"$W/seed/foreign.txt"; git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m foreign && git -C "$W/seed" pull -q --rebase origin main 2>/dev/null; git -C "$W/seed" push -q origin HEAD:main
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 4 ] && ! grep -q "pr merge" "$GH_LOG" && ok "merge resume: a push after the recorded merge of #1 -> exit 4, no gh pr merge" || bad "merge resume: exit $rc gh [$(cat "$GH_LOG")]: $(tail -3 "$W/mout")"
[ "$(q "$S" s.merge.stopped.number)" = 2 ] && [[ "$(q "$S" s.merge.stopped.reason)" == *"after the merge of #1"* ]] && ok "merge resume: the stop names #2 and the merge of #1" || bad "merge resume: stopped $(q "$S" s.merge 2>&1)"
# without the foreign push the resume goes on from #2
new_world mresume2 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >/dev/null 2>&1
gh pr merge 1 --squash --match-head-commit "$(head_of 1)" >/dev/null 2>&1
node -e 'const fs=require("fs"),[f,c,t]=process.argv.slice(1),s=JSON.parse(fs.readFileSync(f,"utf8")); s.merge={merged:[{number:1,commit:c,tree:t}],status:"pending"}; fs.writeFileSync(f,JSON.stringify(s))' \
    "$S" "$(git -C "$W/origin.git" rev-parse main)" "$(git -C "$W/origin.git" rev-parse 'main^{tree}')"
: >"$GH_LOG"
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "2 3 " ] && ok "merge resume: an unchanged main -> merges #2 and #3 only" || bad "merge resume clean: exit $rc gh [$(cat "$GH_LOG")]"

# --- one check per repository: the pid file ------------------------------------------------------
PIDF() { echo "$(cd "$W/repo/.git" && pwd -P)/worfy-wave-gate.pid"; }
new_world pidlive 1:a.txt
S="$W/state.json"; state "$S" null 1
git -C "$W/repo" worktree add -q --detach "$(TMPW_OF)" origin/main && echo mine >"$(TMPW_OF)/marker"
sleep 60 & sp=$! job=$!
# the pid node sees: in Git Bash the Windows pid of sleep, once it has started
if on_windows; then until_ok 5 grep -q sleep "/proc/$sp/exename"; sp="$(cat "/proc/$sp/winpid")"; fi
echo "$sp" >"$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "another wave-gate check runs in this repository (pid $sp" "$W/out" && ok "pid: a live check's pid -> exit 1 naming it" || bad "pid live: exit $rc: $(tail -3 "$W/out")"
[ "$(cat "$(TMPW_OF)/marker" 2>/dev/null)" = mine ] && git -C "$W/repo" worktree list | grep -q worfy-wave-gate && [ "$(gate_count)" = 0 ] && [ "$(cat "$(PIDF)")" = "$sp" ] \
    && ok "pid: the other check's worktree and pid file are untouched, no gate run" || bad "pid live: worktree, pid file or gate touched"
kill "$job"; wait "$job" 2>/dev/null
git -C "$W/repo" worktree remove --force "$(TMPW_OF)"
# a dead pid: stale, taken over. The pid of a node that has exited: node's pid is the one wave-gate checks, while in
# Git Bash `$!` is an MSYS pid, which may fall on a live Windows process (worfy-windows ticket 72).
dp="$(node -e 'process.stdout.write(String(process.pid))')"
echo "$dp" >"$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "pid $dp, which is not running" "$W/out" && [ ! -e "$(PIDF)" ] && ok "pid: a dead pid is taken over; the pid file is gone at the end" || bad "pid dead: exit $rc: $(tail -3 "$W/out")"
# an empty pid file: young — its writer is between open and write; old — stale
new_world pidempty 1:a.txt
S="$W/state.json"; state "$S" null 1
: >"$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "its pid is being written" "$W/out" && ok "pid: an empty pid file just made -> exit 1" || bad "pid empty young: exit $rc: $(tail -3 "$W/out")"
touch -t 202001010000 "$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "no pid for over" "$W/out" && ok "pid: an empty pid file older than 10 s is taken over" || bad "pid empty old: exit $rc: $(tail -3 "$W/out")"
# two checks started together: exactly one runs. The gate run of the one that runs is held until the other has
# given way: a fixed sleep in the gate let the first check finish before a late second one started, and both ran.
new_world pidrace 1:a.txt
state "$W/s1.json" null 1; state "$W/s2.json" null 1
touch "$GATE_DIR/hold"
"$WG" check "$W/s1.json" >"$W/o1" 2>&1 & p1=$!
"$WG" check "$W/s2.json" >"$W/o2" 2>&1 & p2=$!
until_ok 30 grep -q "another wave-gate check" "$W/o1" "$W/o2"
rm -f "$GATE_DIR/hold"
wait "$p1"; r1=$?; wait "$p2"; r2=$?
codes="$(printf '%s\n' "$r1" "$r2" | sort | tr '\n' ' ')"
[ "$codes" = "0 1 " ] && grep -q "another wave-gate check" "$W/o1" "$W/o2" && [ "$(gate_count)" = 1 ] && ok "pid: two checks at once -> one runs, the other exits 1" || bad "pid race: codes [$codes] runs $(gate_count): $(tail -2 "$W/o1") | $(tail -2 "$W/o2")"

# --- between runs: ignored build output is removed, node_modules stays ---------------------------
new_world artifacts 1:a.txt 2:RED
S="$W/state.json"; state "$S" null 1 2; touch "$GATE_DIR/artifacts"
"$WG" check "$S" >/dev/null 2>&1
[ "$(awk 'NR>1{print $2, $3}' "$GATE_DIR/artifacts.log" | sort -u)" = "leftover=no nm=kept" ] && [ "$(wc -l <"$GATE_DIR/artifacts.log" | tr -d ' ')" = 3 ] \
    && ok "between runs: no build output of the run before, node_modules kept" || bad "between runs: $(cat "$GATE_DIR/artifacts.log")"

# --- the e2e lock ---------------------------------------------------------------------------
new_world lock 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1
export GATE_LOCK="$L"
mkdir "$L"
( while [ -d "$L" ]; do touch -c "$L"; sleep 1; done ) & toucher=$!
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
# 3 s from the moment it says it waits, not from its start: a late start left no time to wait in
until_ok 30 grep -q "waiting for the e2e lock" "$W/out"; sleep 3
[ "$(gate_count)" = 0 ] && kill -0 "$wg" 2>/dev/null && ok "e2e lock: a live lock held by another -> waits" || bad "e2e lock: did not wait ($(gate_count) runs)"
rmdir "$L"; wait "$toucher" 2>/dev/null
wait "$wg"; rc=$?
[ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && grep -q "lock=held" "$GATE_DIR/log" && ok "e2e lock: taken after release, the gate runs under it" || bad "e2e lock: exit $rc runs $(gate_count) $(cat "$GATE_DIR/log")"
[ ! -e "$L" ] && ok "e2e lock: released after the run" || bad "e2e lock: left after the run"
# the holder of the lock: holder.json with the numbers of the set while the gate runs, gone with the lock
new_world holder 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2 3; export GATE_LOCK="$L"
STAND_IN_PARENTS="$GATE_DIR/parents" "$WG" check "$S" >"$W/out" 2>&1 & wg=$!; wait "$wg"; rc=$?
# wave-gate's pid as node sees it: in Git Bash its Windows pid, which the gate stand-in recorded as its parent
on_windows && wg="$(head -n 1 "$GATE_DIR/parents" 2>/dev/null)"
h="$GATE_DIR/holder.1.json"
[ "$rc" -eq 0 ] && [ -f "$h" ] && [ "$(q "$h" 's.prs.join(",")+" "+s.what+" "+s.pid')" = "1,2,3 gate-full $wg" ] \
    && ok "e2e lock: holder.json names the set (prs 1,2,3), gate-full and the pid of wave-gate while the gate runs" || bad "e2e lock holder: exit $rc, holder $(cat "$h" 2>/dev/null)"
[ "$(q "$h" '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s.since)')" = true ] && ok "e2e lock: holder.json has since (ISO 8601 UTC)" || bad "e2e lock holder: since $(q "$h" s.since 2>&1)"
[ ! -e "$L" ] && ok "e2e lock: holder.json goes with the lock when it is released" || bad "e2e lock holder: left $(ls -A "$L" 2>/dev/null)"
# a red set: each run of the bisection names the PRs it checks
new_world holderbis 1:a.txt 2:RED 3:c.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2 3; export GATE_LOCK="$L"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
got="$(for f in "$GATE_DIR"/holder.*.json; do q "$f" 's.prs.join(",")'; echo; done | sort -u | tr '\n' ' ')"
[ "$rc" -eq 2 ] && [[ " $got" == *" 1,2,3 "* ]] && [[ " $got" == *" 1 "* || " $got" == *" 1,2 "* ]] && [ ! -e "$L" ] \
    && ok "e2e lock: each run of the bisection names its own prefix in holder.json ($got)" || bad "e2e lock holder bisection: exit $rc [$got]"
# stale: older than 30 minutes (the default) — removed with the holder.json of whoever left it, and taken
new_world stale 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
mkdir "$L"; printf '{"prs":[9],"what":"gate-full","pid":1,"since":"2020-01-01T00:00:00Z"}\n' >"$L/holder.json"; touch -t 202001010000 "$L"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "lock=held" "$GATE_DIR/log" && [ ! -e "$L" ] && ok "e2e lock: a lock older than 30 min is taken over and released" || bad "e2e lock stale: exit $rc $(tail -3 "$W/out")"
[ "$(q "$GATE_DIR/holder.1.json" 's.prs.join(",")' 2>&1)" = 1 ] && ok "e2e lock: the abandoned holder.json is replaced by ours" || bad "e2e lock stale holder: $(cat "$GATE_DIR/holder.1.json" 2>/dev/null)"
# ours was removed as abandoned during the run and another agent holds the lock now: on release its holder.json
# and its lock stay
new_world foreign 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
printf '%s\n' "rm -f '$L/holder.json'; rmdir '$L'; mkdir '$L'; echo '{\"prs\":[7],\"what\":\"gate-full\",\"pid\":1,\"since\":\"x\"}' >'$L/holder.json'" >"$GATE_DIR/takeover"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$L/holder.json" 's.prs.join(",")' 2>&1)" = 7 ] && ok "e2e lock: on release, a lock someone else holds now keeps its holder.json and stays" || bad "e2e lock foreign: exit $rc, lock [$(ls -A "$L" 2>&1)]"
rm -f "$L/holder.json"; rmdir "$L" 2>/dev/null; rm -f "$GATE_DIR/takeover"
new_world young 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
mkdir "$L"; touch -t "$(date -r $(( $(date +%s) - 1500 )) +%Y%m%d%H%M.%S 2>/dev/null || date -d @$(( $(date +%s) - 1500 )) +%Y%m%d%H%M.%S)" "$L"
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
until_ok 30 grep -q "waiting for the e2e lock" "$W/out"; sleep 2
[ "$(gate_count)" = 0 ] && grep -q "waiting for the e2e lock" "$W/out" && ok "e2e lock: a lock 25 min old is not taken over" || bad "e2e lock: a 25-min lock was taken"
rmdir "$L"; wait "$wg"
# heartbeat: the lock's mtime moves during a run
new_world beat 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
touch "$GATE_DIR/lockwatch"
WAVE_GATE_HEARTBEAT_S=1 "$WG" check "$S" >"$W/out" 2>&1; rc=$?
s=$(awk '$1=="start"{print $2}' "$GATE_DIR/lockwatch"); e=$(awk '$1=="end"{print $2}' "$GATE_DIR/lockwatch")
[ "$rc" -eq 0 ] && [ -n "$s" ] && [ -n "$e" ] && [ "$e" != gone ] && [ "$e" -gt "$s" ] && ok "e2e lock: the heartbeat moves the mtime during the run ($s -> $e)" || bad "e2e lock heartbeat: exit $rc start $s end $e"
# an error (a signal) in the middle of a run: the lock is released
if $RUN_SIGTERM; then
    new_world sig 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
    echo TERM >"$GATE_DIR/kill1"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 143 ] && [ ! -e "$L" ] && ok "e2e lock: released when wave-gate is stopped (exit 143)" || bad "e2e lock on signal: exit $rc, lock $( [ -e "$L" ] && echo left || echo gone)"
    [ -s "$SCREEN_DIR/caf.log" ] && caf_gone "$SCREEN_DIR/caf.log" && ok "signal: no caffeinate left after SIGTERM" || bad "signal: caffeinate left or not started: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
    unset GATE_LOCK
fi
# killed without its signal handlers (SIGKILL; on Windows every kill from another process): the lock stays with its
# holder.json, and the next run takes it at once because the holder's pid is not running, not after 30 min
# (worfy-windows ticket 72). On every system.
new_world killed 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
echo KILL >"$GATE_DIR/kill1"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
rm -f "$GATE_DIR/kill1"
kp="$(q "$L/holder.json" s.pid 2>&1)"
[ "$rc" -ne 0 ] && [ -d "$L" ] && [ "$(q "$L/holder.json" 's.host===require("os").hostname()' 2>&1)" = true ] \
    && ok "e2e lock: a killed wave-gate leaves its lock with its pid and host (exit $rc)" || bad "e2e lock killed: exit $rc, holder [$(cat "$L/holder.json" 2>&1)]"
held_twice() { [ "$(grep -c 'lock=held' "$GATE_DIR/log" 2>/dev/null)" -ge 2 ]; }
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
if until_ok 30 held_twice; then wait "$wg"; rc=$?; else kill "$wg" 2>/dev/null; wait "$wg" 2>/dev/null; rc="still waiting after 30 s"; fi
[ "$rc" = 0 ] && grep -q "held by pid $kp, which is not running" "$W/out" && [ ! -e "$L" ] \
    && ok "e2e lock: the lock of a killed wave-gate is taken at once by the next run" || bad "e2e lock of a killed run: $rc: $(tail -3 "$W/out")"
rm -rf "$L"; unset GATE_LOCK
# a holder.json without this host is not judged by its pid: the one-PR block of skills/epic-wave writes no host, and
# in Git Bash its pid is not a Windows pid; a pid of another host means nothing here. The young lock is waited for.
gone="$(node -e 'process.stdout.write(String(process.pid))')"
for host in none elsewhere; do
    new_world "holder-$host" 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
    rec='{"prs":[9],"what":"gate-full","pid":'"$gone"',"since":"x"}'
    [ "$host" = none ] || rec='{"prs":[9],"what":"gate-full","pid":'"$gone"',"host":"'"$host"'","since":"x"}'
    mkdir "$L"; printf '%s\n' "$rec" >"$L/holder.json"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "waiting for the e2e lock" "$W/out"; sleep 2
    [ "$(gate_count)" = 0 ] && grep -q "waiting for the e2e lock" "$W/out" && [ -f "$L/holder.json" ] \
        && ok "e2e lock: a young lock whose holder.json has host $host is waited for, its pid not looked at" || bad "e2e lock host $host: taken [$(tail -2 "$W/out")]"
    rm -f "$L/holder.json"; rmdir "$L"; wait "$wg"
    unset GATE_LOCK
done

# --- an error in the middle of the squash merges: the worktree is removed ---------------------
new_world broken 1:a.txt
# PR 2: a commit whose tree object is missing — git merge fails without a conflict
blob=$(echo "broken $RANDOM" | git -C "$W/repo" hash-object -w --stdin)
tree=$(printf '100644 blob %s\tbroken.txt\n' "$blob" | git -C "$W/repo" mktree)
c2=$(git -C "$W/repo" commit-tree "$tree" -p "$(git -C "$W/repo" rev-parse origin/main)" -m broken)
rm -f "$W/repo/.git/objects/${tree:0:2}/${tree:2}"
S="$W/state.json"
printf '{"repo":"%s","branch":"main","e2e_lock":null,"prepare":null,"cross_machine_label":null,"prs":[{"number":1,"head":"%s"},{"number":2,"head":"%s"}]}\n' "$(tn "$W/repo")" "$(head_of 1)" "$c2" >"$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && [ "$(q "$S" s.status)" = error ] && ok "error while merging: exit 1, status error" || bad "error while merging: exit $rc status $(q "$S" s.status 2>&1): $(tail -3 "$W/out")"
[ ! -e "$(TMPW_OF)" ] && ok "error while merging: the temporary worktree is removed" || bad "error while merging: worktree left"
[ "$(gate_count)" = 0 ] && ok "error while merging: no gate run" || bad "error while merging: $(gate_count) runs"
if $RUN_SCREEN; then
    [ -s "$SCREEN_DIR/caf.log" ] && caf_gone "$SCREEN_DIR/caf.log" && ok "error while merging: no caffeinate left after the error" || bad "error while merging: caffeinate left or not started: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
fi

# --- the screen: a locked screen before a gate run -------------------------------------------
if $RUN_SCREEN; then
    new_world screenpre 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1
    : >"$SCREEN_DIR/locked"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    # the wait polls ioreg every second: three calls in all, however late each one starts (a fixed 2 s here fit
    # only two calls of a slow ioreg)
    until_ok 30 grep -q "screen locked: gate full waits" "$W/out"
    until_ok 30 eval '[ "$(wc -l <"$SCREEN_DIR/ioreg.log" | tr -d " ")" -ge 3 ]'
    [ "$(gate_count)" = 0 ] && kill -0 "$wg" 2>/dev/null && [ "$(grep -c 'screen locked' "$W/out")" = 1 ] \
        && ok "locked screen: one line 'screen locked: gate full waits', the gate does not run" || bad "locked screen: $(gate_count) runs: $(cat "$W/out")"
    [ ! -e "$L" ] && ok "locked screen: the e2e lock is not held while it waits" || bad "locked screen: the e2e lock is held while waiting"
    grep -q "^-n Root -d1$" "$SCREEN_DIR/ioreg.log" && [ "$(wc -l <"$SCREEN_DIR/ioreg.log" | tr -d ' ')" -ge 3 ] \
        && ok "locked screen: ioreg -n Root -d1, polled while it waits" || bad "locked screen: ioreg calls: $(cat "$SCREEN_DIR/ioreg.log" 2>/dev/null)"
    rm -f "$SCREEN_DIR/locked"
    wait "$wg"; rc=$?
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && [ "$(q "$S" s.status)" = green ] && ok "locked screen: unlocked -> the gate runs, green" || bad "locked screen: after unlock exit $rc runs $(gate_count)"
    # the screen locks while the check waits for the e2e lock: the lock is given back and the check waits
    new_world screenlock 1:a.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1
    mkdir "$L"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "waiting for the e2e lock" "$W/out"
    : >"$SCREEN_DIR/locked"; rmdir "$L"
    until_ok 30 grep -q "screen locked: gate full waits" "$W/out"; sleep 1
    [ "$(gate_count)" = 0 ] && [ ! -e "$L" ] && ok "locked screen after the e2e lock: the lock is released, the gate waits" || bad "locked screen after the lock: $(gate_count) runs, lock $( [ -e "$L" ] && echo held || echo free): $(cat "$W/out")"
    rm -f "$SCREEN_DIR/locked"
    wait "$wg"; rc=$?
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && ok "locked screen after the e2e lock: unlocked -> green" || bad "locked screen after the lock: exit $rc runs $(gate_count)"
    # an unlocked screen: ioreg is asked, the gate runs at once
    new_world screenno 1:a.txt
    S="$W/state.json"; state "$S" null 1
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && grep -q "^-n Root -d1$" "$SCREEN_DIR/ioreg.log" && ! grep -q "screen locked" "$W/out" \
        && ok "unlocked screen: IOConsoleLocked = No -> the gate runs" || bad "unlocked screen: exit $rc runs $(gate_count): $(cat "$W/out")"
fi

# --- the screen locks during gate full ------------------------------------------------------------
if $RUN_SCREEN; then
    # the e2e did not get its window and the screen was locked: not red — not verified, repeated after unlock
    new_world screenmid 1:a.txt 2:b.txt
    S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2
    : >"$GATE_DIR/lockscreen"; touch "$GATE_DIR/window"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "screen locked: gate full waits" "$W/out"; sleep 1
    [ "$(gate_count)" = 1 ] && [ "$(q "$S" 's.runs.length')" = 1 ] && [ "$(q "$S" 's.runs[0].outcome')" = unverified ] \
        && [[ "$(q "$S" 's.runs[0].reason')" == "screen locked"* ]] && [ "$(q "$S" s.status)" = checking ] \
        && ok "screen locked during the run: the run is recorded not verified (screen locked), not red" || bad "screen locked during the run: runs $(q "$S" s.runs 2>&1) status $(q "$S" s.status 2>&1)"
    grep -q "screen locked during gate full" "$W/out" && [ ! -e "$L" ] && ! grep -q "window was not shown" "$(q "$S" 's.runs[0].log')" && ok "screen locked during the run: said so, the e2e lock released while it waits" || bad "screen locked during the run: output $(cat "$W/out")"
    rm -f "$SCREEN_DIR/locked"
    wait "$wg"; rc=$?
    [ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [ "$(gate_count)" = 2 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome).join(" ")')" = "full:2:unverified full:2:green" ] \
        && [ "$(q "$S" '"flaky" in s')" = false ] && ok "screen locked during the run: repeated after unlock, green, not flaky" || bad "screen locked during the run: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome)') flaky $(q "$S" s.flaky 2>&1)"
    # the screen was locked in the middle of the run and unlocked before its end: seen by the poll during the run
    new_world screenblip 1:a.txt 2:b.txt
    S="$W/state.json"; state "$S" null 1 2
    echo 30 >"$GATE_DIR/lockfor"; touch "$GATE_DIR/window"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome).join(" ")')" = "full:2:unverified full:2:green" ] && ! grep -q "gate full waits" "$W/out" \
        && ok "screen locked and unlocked during the run: not verified, run again at once, green" || bad "screen locked and unlocked during the run: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome)'): $(cat "$W/out")"
    # test:package (the packaged .app) also needs a window
    new_world screenpkg 1:a.txt
    S="$W/state.json"; state "$S" null 1
    echo 30 >"$GATE_DIR/lockfor"; echo test:package >"$GATE_DIR/window"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.outcome).join(" ")')" = "full:unverified full:green" ] \
        && ok "screen locked, test:package failed: not verified, run again" || bad "screen locked, test:package: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.outcome)')"
fi
# the same failure with the screen unlocked is red (the e2e load case): the usual repeat
new_world windowred 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/window"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.outcome).join(" ")')" = "full:red retry:green" ] && [[ "$(q "$S" s.flaky)" == *"spec1.spec.ts"* ]] \
    && ok "e2e failed, screen unlocked: red, repeated as flaky" || bad "e2e failed, screen unlocked: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.outcome)')"
if $RUN_SCREEN; then
    # only `test` failed (no e2e script), with the screen locked: red
    new_world screenred 1:a.txt
    S="$W/state.json"; state "$S" null 1; : >"$GATE_DIR/lockscreen"; touch "$GATE_DIR/unitonce"
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!
    until_ok 30 grep -q "screen locked: gate full waits" "$W/out"
    [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.outcome).join(" ")')" = "full:red" ] && ok "screen locked, only test failed: red" || bad "screen locked, only test failed: runs $(q "$S" 's.runs.map(r=>r.role+":"+r.outcome)' 2>&1)"
    rm -f "$SCREEN_DIR/locked"; wait "$wg"
    # the screen locks during every run: three tries, then not verified (exit 3); the next check runs it again
    new_world screenloop 1:a.txt
    S="$W/state.json"; state "$S" null 1
    echo 1 >"$GATE_DIR/lockscreen"; touch "$GATE_DIR/window" "$GATE_DIR/keep"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 3 ] && [ "$(q "$S" s.status)" = unverified ] && [ "$(gate_count)" = 3 ] && [ "$(q "$S" 's.runs.filter(r=>r.outcome==="unverified").length')" = 3 ] \
        && ok "screen locked during every run: 3 tries, then unverified, exit 3" || bad "screen locked every run: exit $rc status $(q "$S" s.status) runs $(gate_count)"
    rm -f "$GATE_DIR/lockscreen" "$GATE_DIR/window" "$GATE_DIR/keep" "$SCREEN_DIR/locked"
    "$WG" check "$S" >/dev/null 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [ "$(gate_count)" = 4 ] && ok "screen locked every run: the next check runs it again, green" || bad "screen locked every run: next check exit $rc runs $(gate_count)"
fi

# --- caffeinate: the commands keep the display awake while they live -----------------------
if $RUN_SCREEN; then
    new_world caf 1:a.txt
    S="$W/state.json"; state "$S" null 1
    "$WG" check "$S" >"$W/out" 2>&1 & wg=$!; wait "$wg"; rc=$?
    [ "$rc" -eq 0 ] && [ "$(awk '{$1=""; print substr($0,2)}' "$SCREEN_DIR/caf.log")" = "-d -w $wg" ] \
        && ok "caffeinate: check runs caffeinate -d -w <its own pid>" || bad "caffeinate: check exit $rc, pid $wg, calls: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
    caf_gone "$SCREEN_DIR/caf.log" && ok "caffeinate: gone after check exits" || bad "caffeinate: left after check"
    mv "$SCREEN_DIR/caf.log" "$SCREEN_DIR/caf-check.log"
    "$WG" merge "$S" >"$W/mout" 2>&1 & wg=$!; wait "$wg"; rc=$?
    [ "$rc" -eq 0 ] && [ "$(awk '{$1=""; print substr($0,2)}' "$SCREEN_DIR/caf.log")" = "-d -w $wg" ] \
        && ok "caffeinate: merge runs caffeinate -d -w <its own pid>" || bad "caffeinate: merge exit $rc, pid $wg, calls: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
    caf_gone "$SCREEN_DIR/caf.log" && ok "caffeinate: gone after merge exits" || bad "caffeinate: left after merge"
fi

# --- no ioreg and no caffeinate in PATH: no screen check, no keep-awake -----------------------------
# A PATH of links to the tools the script and the stubs need, without /usr/bin and /usr/sbin, where macOS keeps both.
# Git Bash on Windows has neither command anywhere: there the PATH is the test's own without the screen stubs. Its
# ln -s copies a program instead of linking it, and a copied git.exe or bash.exe cannot load the DLLs of its folder.
if on_windows; then
    NOPOWER_PATH="${PATH//"$POWER:"/}"
else
    MINBIN="$T/minbin"; mkdir -p "$MINBIN"
    for c in node git bash sh env cat ls tr rm cp touch mkdir sleep mktemp awk; do p="$(command -v "$c")" && ln -s "$p" "$MINBIN/$c"; done
    NOPOWER_PATH="$STUBS:$MINBIN"
fi
new_world nopower 1:a.txt
S="$W/state.json"; state "$S" null 1
: >"$SCREEN_DIR/locked"
if env PATH="$NOPOWER_PATH" bash -c 'command -v ioreg || command -v caffeinate' >/dev/null 2>&1; then
    bad "no ioreg: the minimal PATH still has ioreg or caffeinate"
else
    PATH="$NOPOWER_PATH" "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    PATH="$NOPOWER_PATH" "$WG" merge "$S" >"$W/mout" 2>&1; mrc=$?
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && ! grep -q "screen locked" "$W/out" && [ ! -e "$SCREEN_DIR/ioreg.log" ] \
        && ok "no ioreg in PATH: no screen check, the gate runs" || bad "no ioreg: exit $rc runs $(gate_count): $(cat "$W/out")"
    [ "$mrc" -eq 0 ] && [ ! -e "$SCREEN_DIR/caf.log" ] && ok "no caffeinate in PATH: check and merge run without it" || bad "no caffeinate: merge exit $mrc: $(cat "$W/mout")"
fi

# --- workflow.ci "batch": no CI on the PR head; one CI run on main after the wave -------------
# A PR whose checks are red (the stub `gh pr checks` exits 1) is merged in the set: wave-gate never asks for
# checks or mergeStateStatus.
new_world batch 1:a.txt 2:b.txt
S="$W/state.json"; state "$S" null 1 2
"$WG" check "$S" >"$W/out" 2>&1 && "$WG" merge "$S" >>"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 2 " ] \
    && ok "batch: PRs without green checks are merged in the set" || bad "batch: exit $rc: $(tail -3 "$W/out")"
! grep -qE '^(pr checks|run |workflow run)|mergeStateStatus' "$GH_LOG" \
    && ok "batch: check and merge ask for no checks, no run, no mergeStateStatus and dispatch nothing" || bad "batch: gh calls: $(cat "$GH_LOG")"
# ci_guard <command>: on Windows wave-gate runs only a leading gh of a ci_batch_run command as the stand-in, through
# cmd.exe. A command that does not start with gh, chains another command (&, |, ;, a newline, ` or $( ) or names
# gh again would reach the real gh there, so it stops the test. Every command a CI state file gets passes it.
ci_guard() {
    on_windows || return 0
    if [[ "$1" != "gh "* ]] || [[ "$1" == *[\&\|\;\`$'\n']* || "$1" == *'$('* ]] || has_gh_word "${1#gh }"; then
        echo "REFUSED: ci_batch_run [$1] is not one gh command: on Windows it would reach the real gh" >&2; exit 1
    fi
}
# ci_state <file> <ci> <run or null>: the wave CI state file the skill block writes, its command through ci_guard.
ci_state() { local run="$3"
    [ "$run" = null ] || ci_guard "$run"
    [ "$run" = null ] || run="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$run")"
    printf '{"repo":"%s","branch":"main","ci":"%s","ci_batch_run":%s}\n' "$(tn "$W/repo")" "$2" "$run" >"$1"; }
dispatches() { grep -c '^workflow run' "$GH_LOG"; }
TIP="$(git -C "$W/origin.git" rev-parse main)"
C="$W/ci.json"; ci_state "$C" batch 'gh workflow run ci.yml --ref $ref -f job=check'
export GH_RUN_URL="https://github.com/o/r/actions/runs/4242"
"$WG" ci "$C" >"$W/cout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = 1 ] && grep -qx 'workflow run ci.yml --ref main -f job=check' "$GH_LOG" \
    && ok "batch ci: one dispatch for main, \$ref is the branch" || bad "batch ci: exit $rc: $(cat "$W/cout") gh: $(grep 'workflow run' "$GH_LOG")"
[ "$(q "$C" 's.ci_run.run_id+" "+s.ci_run.url+" "+s.ci_run.commit')" = "4242 $GH_RUN_URL $TIP" ] && [ -n "$(q "$C" s.ci_run.dispatched_at)" ] \
    && ok "batch ci: the run id, its URL and the commit of main are recorded" || bad "batch ci: ci_run $(q "$C" s.ci_run 2>&1)"
grep -q "CI_RUN=4242 $GH_RUN_URL" "$W/cout" && ok "batch ci: prints CI_RUN=<id> <url>" || bad "batch ci: output $(cat "$W/cout")"
"$WG" ci "$C" >"$W/cout2" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = 1 ] && grep -q "CI_RUN=4242" "$W/cout2" \
    && ok "batch ci: a second call dispatches nothing more" || bad "batch ci: second call exit $rc, dispatches $(dispatches)"
# workflow.ci "pr": nothing is dispatched
P="$W/ci-pr.json"; ci_state "$P" pr null
"$WG" ci "$P" >"$W/pout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = 1 ] && grep -q "CI=skipped" "$W/pout" && [ "$(q "$P" 's.ci_run===undefined')" = true ] \
    && ok "pr ci: nothing is dispatched, CI=skipped" || bad "pr ci: exit $rc: $(cat "$W/pout")"
# no URL in the dispatch output: the run is found by the commit of main; not found yet — exit 3, and a second
# call finds it without a second dispatch
unset GH_RUN_URL
export WAVE_GATE_CI_POLL_S=0.1 WAVE_GATE_CI_TRIES=2
D="$W/ci-find.json"; ci_state "$D" batch 'gh workflow run ci.yml --ref $ref -f job=check'
before=$(dispatches)
"$WG" ci "$D" >"$W/dout" 2>&1; rc=$?
[ "$rc" -eq 3 ] && [ "$(dispatches)" = $((before + 1)) ] && [ "$(q "$D" 's.ci_run.run_id===undefined')" = true ] \
    && grep -q -- "--commit $TIP --event workflow_dispatch" "$GH_LOG" && grep -q -- "--workflow ci.yml" "$GH_LOG" \
    && ok "batch ci: run not found -> exit 3, looked up by the commit of main and the workflow" || bad "batch ci: not found exit $rc: $(cat "$W/dout") gh: $(grep 'run list' "$GH_LOG")"
printf '[{"databaseId":7,"url":"https://github.com/o/r/actions/runs/7","createdAt":"2000-01-01T00:00:00Z"},{"databaseId":9,"url":"https://github.com/o/r/actions/runs/9","createdAt":"%s"}]\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$W/runs.json"
export GH_RUNS="$W/runs.json"
"$WG" ci "$D" >"$W/dout2" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = $((before + 1)) ] && [ "$(q "$D" 's.ci_run.run_id')" = 9 ] \
    && ok "batch ci: the second call finds the run created after the dispatch, without a second dispatch" || bad "batch ci: find exit $rc run $(q "$D" s.ci_run 2>&1): $(cat "$W/dout2")"
unset GH_RUNS
# a failed dispatch: exit 1, nothing recorded as dispatched, the next call dispatches again
F1="$W/ci-fail.json"; ci_state "$F1" batch 'gh workflow run ci.yml --ref $ref -f job=check'
export GH_DISPATCH_RC=1 GH_RUN_URL="https://github.com/o/r/actions/runs/11"
before=$(dispatches)
"$WG" ci "$F1" >"$W/fout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && [ "$(q "$F1" 's.ci_run.dispatched_at===undefined && s.ci_run.status==="dispatch failed"')" = true ] \
    && ok "batch ci: a failed dispatch -> exit 1, not recorded as dispatched" || bad "batch ci: failed dispatch exit $rc: $(cat "$W/fout") $(q "$F1" s.ci_run 2>&1)"
export GH_DISPATCH_RC=0
"$WG" ci "$F1" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = $((before + 2)) ] && [ "$(q "$F1" s.ci_run.run_id)" = 11 ] \
    && ok "batch ci: after a failed dispatch the next call dispatches" || bad "batch ci: retry exit $rc"
unset GH_RUN_URL GH_DISPATCH_RC WAVE_GATE_CI_POLL_S WAVE_GATE_CI_TRIES
# bad input: batch without a command, an unknown mode, a merge of the set still in progress
B="$W/ci-bad.json"; ci_state "$B" batch null
"$WG" ci "$B" >"$W/bout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "ci_batch_run" "$W/bout" && ok "batch ci: batch without ci_batch_run -> exit 1 naming it" || bad "batch ci: no command exit $rc $(cat "$W/bout")"
ci_state "$B" nightly null
"$WG" ci "$B" >"$W/bout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q '"ci"' "$W/bout" && ok "ci: an unknown mode -> exit 1" || bad "ci: unknown mode exit $rc $(cat "$W/bout")"
run='gh workflow run ci.yml --ref $ref'; ci_guard "$run"
node -e 'const fs=require("fs"),f=process.argv[1],s=JSON.parse(fs.readFileSync(f,"utf8"));s.ci="batch";s.ci_batch_run=process.argv[2];s.merge={merged:[],status:"pending"};fs.writeFileSync(f,JSON.stringify(s))' "$B" "$run"
before=$(dispatches)
"$WG" ci "$B" >"$W/bout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "merge" "$W/bout" && [ "$(dispatches)" = "$before" ] \
    && ok "batch ci: a merge still in progress -> exit 1, nothing dispatched" || bad "batch ci: pending merge exit $rc $(cat "$W/bout")"
# A branch name that is not a plain one never reaches the shell: exit 1, no dispatch.
ci_guard "$run"
printf '{"repo":"%s","branch":"main;x","ci":"batch","ci_batch_run":"%s"}\n' "$(tn "$W/repo")" "$run" >"$B"
before=$(dispatches)
"$WG" ci "$B" >"$W/bout" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q '"branch"' "$W/bout" && [ "$(dispatches)" = "$before" ] \
    && ok "batch ci: branch \"main;x\" -> exit 1, nothing dispatched" || bad "batch ci: branch main;x exit $rc $(cat "$W/bout")"
# Only a run created before the dispatch is listed on that commit: it is not this dispatch's run -> exit 3.
export WAVE_GATE_CI_POLL_S=0.1 WAVE_GATE_CI_TRIES=1
printf '[{"databaseId":7,"url":"https://github.com/o/r/actions/runs/7","createdAt":"2000-01-01T00:00:00Z"}]\n' >"$W/old-runs.json"
export GH_RUNS="$W/old-runs.json"
E="$W/ci-old.json"; ci_state "$E" batch 'gh workflow run ci.yml --ref $ref -f job=check'
"$WG" ci "$E" >"$W/eout" 2>&1; rc=$?
[ "$rc" -eq 3 ] && grep -q "CI_RUN=not-found" "$W/eout" && [ "$(q "$E" 's.ci_run.run_id===undefined')" = true ] \
    && ok "batch ci: only a run older than the dispatch is listed -> exit 3, not taken" || bad "batch ci: old run exit $rc run $(q "$E" s.ci_run 2>&1)"
# The lookups are capped: the 6th call that finds no run makes it "not verified"; a later call neither looks nor dispatches.
for i in 2 3 4 5 6; do "$WG" ci "$E" >"$W/eout" 2>&1; rc=$?; done
before=$(dispatches)
"$WG" ci "$E" >"$W/eout2" 2>&1; rc2=$?
[ "$rc" -eq 3 ] && grep -q "CI_RUN=not-verified" "$W/eout" && [ "$(q "$E" 's.ci_run.status+" "+s.ci_run.lookups')" = "not verified 6" ] \
    && [ "$rc2" -eq 3 ] && grep -q "CI_RUN=not-verified" "$W/eout2" && [ "$(dispatches)" = "$before" ] \
    && ok "batch ci: after 6 calls without a listed run -> not verified, no further lookup or dispatch" || bad "batch ci: cap exit $rc/$rc2: $(cat "$W/eout") $(q "$E" s.ci_run 2>&1)"
unset GH_RUNS WAVE_GATE_CI_POLL_S WAVE_GATE_CI_TRIES
# The next wave reuses the file after main moved: a new dispatch for the new tip, the old run kept as superseded.
# The checkout is on another branch: $ref is still the file's branch, not the checked-out one.
git clone -q "$W/origin.git" "$W/next" && echo next >"$W/next/next.txt" && git -C "$W/next" add -A && git -C "$W/next" commit -q -m "next wave" && git -C "$W/next" push -q origin HEAD:main
git -C "$W/repo" checkout -q -b elsewhere
TIP2="$(git -C "$W/origin.git" rev-parse main)"
export GH_RUN_URL="https://github.com/o/r/actions/runs/5000"
before=$(dispatches); refs=$(grep -c '^workflow run ci.yml --ref main -f job=check$' "$GH_LOG")
"$WG" ci "$C" >"$W/nout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = $((before + 1)) ] && [ "$(grep -c '^workflow run ci.yml --ref main -f job=check$' "$GH_LOG")" = $((refs + 1)) ] \
    && [ "$(q "$C" 's.ci_run.run_id+" "+s.ci_run.commit+" "+s.ci_run.superseded.map(x=>x.run_id+":"+x.commit).join(",")')" = "5000 $TIP2 4242:$TIP" ] \
    && ok "batch ci: main moved since the recorded run -> a new dispatch for main's new tip, the old run superseded" || bad "batch ci: next wave exit $rc: $(cat "$W/nout") $(q "$C" s.ci_run 2>&1)"
"$WG" ci "$C" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(dispatches)" = $((before + 1)) ] && ok "batch ci: on the same new tip no further dispatch" || bad "batch ci: repeat on the new tip exit $rc, dispatches $(dispatches)"
git -C "$W/repo" checkout -q main
unset GH_RUN_URL

# --- a refused gh pr merge: the PR is not recorded as merged, the merge stops ----------------
new_world mfail 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >"$W/out" 2>&1
export GH_MERGE_FAIL_AT=2
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 4 ] && [ "$(q "$S" 's.merge.merged.map(m=>m.number).join(" ")')" = 1 ] && [ "$(q "$S" 's.merge.status+" "+s.merge.stopped.number')" = "stopped 2" ] \
    && grep -q "gh pr merge failed" "$S" && ok "merge refused by gh: exit 4, only PR 1 recorded as merged, stopped at 2" || bad "merge refused: exit $rc $(q "$S" s.merge 2>&1)"
[ "$(git -C "$W/origin.git" log --format=%s main | head -n 1)" = "squash #1" ] && ok "merge refused by gh: main ends at PR 1" || bad "merge refused: main $(git -C "$W/origin.git" log --format=%s -1 main)"
unset GH_MERGE_FAIL_AT

# --- bad input ---------------------------------------------------------------------------
new_world input 1:a.txt
S="$W/state.json"; printf '{"repo":"%s","branch":"main","prs":[]}\n' "$(tn "$W/repo")" >"$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "e2e_lock" "$W/out" && ok "input: e2e_lock missing -> exit 1 naming it" || bad "input: exit $rc $(cat "$W/out")"
printf '{"repo":"%s","branch":"main","e2e_lock":null,"prepare":null,"cross_machine_label":5,"prs":[]}\n' "$(tn "$W/repo")" >"$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "cross_machine_label" "$W/out" && ok "input: cross_machine_label not a string -> exit 1 naming it" || bad "input: cross_machine_label 5: exit $rc $(cat "$W/out")"
"$WG" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "input: no command -> exit 1" || bad "input: no command exit $rc"

# --- the blocks of skills/epic-wave/SKILL.md, under bash and zsh -------------------------------
block() { # $1 = a string that identifies the ```bash block; prints it without the `F() {…profile…}` line
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$SKILL" \
        | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}
BI="$(block 'PLATFORM=(')"; BC="$(block 'wave-gate" check')"; BM="$(block 'wave-gate" merge')"; BCI="$(block 'wave-gate" ci')"
[ -n "$BI" ] && [ -n "$BC" ] && [ -n "$BM" ] && [ -n "$BCI" ] && ok "skill blocks: the set, check, merge and batch CI blocks are in $SKILL" || bad "skill blocks: not found in $SKILL"
for sh in "${SHELLS[@]}"; do
    new_world "skill-$sh" 1:a.txt 2:b.txt 3:c.txt
    export GH_LABELS_3="needs-mac-gate other"
    STUB="F() { case \"\$1\" in workflow.e2e_lock) echo '$(tn "$W/e2e.lock")' ;; commands.prepare_tree) echo 'echo prepared >prepared.txt' ;; cross_machine_gate.label) echo needs-mac-gate ;; *) return 4 ;; esac; }"
    # The paths the blocks hand to node in node's spelling. On Windows the set block's node, which runs gh by
    # name and would find the real gh.exe, runs the gh stand-in instead.
    sub() { local b="$1" ghpat='execFileSync("gh", ['
            b="${b//<repo>/$(tn "$W/repo")}"; b="${b//<main branch>/main}"; b="${b//<state file>/$W/state.json}"
            b="${b//<main lock>/$(tn "$W/main.lock")}"; b="${b//<PR numbers in merge order>/1 2 3}"; b="${b//<platform PR numbers>/2}"
            if on_windows; then b="${b//"$ghpat"/execFileSync(process.execPath, [\"$(node_path "$STUBS/gh.mjs")\", }"; fi
            printf '%s' "$b"; }
    # On Windows node's gh by name is the real gh.exe: a block that still names gh, other than the stand-in, is
    # not run.
    if on_windows && blk="$(sub "$BI")" && has_gh_word "${blk//"$(node_path "$STUBS/gh.mjs")"/}"; then
        bad "$sh: the set block still runs gh by name: on Windows that is the real gh, the block is not run"
    else
        got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$STUB"$'\n'"$(sub "$BI")" 2>&1)"
    fi
    S="$W/state.json"
    [ -f "$S" ] && [ "$(q "$S" 's.prs.map(p=>p.number+":"+p.platform+":"+p.labels.join("+")+":"+(p.head.length)).join(" ")')" = "1:false::40 2:true::40 3:false:needs-mac-gate+other:40" ] \
        && [ "$(q "$S" 's.repo+" "+s.branch+" "+s.e2e_lock+" "+s.prepare+" "+s.main_lock+" "+s.cross_machine_label')" = "$(tn "$W/repo") main $(tn "$W/e2e.lock") echo prepared >prepared.txt $(tn "$W/main.lock") needs-mac-gate" ] \
        && ok "$sh: the set block writes the state file" || bad "$sh: the set block: [$got] $(cat "$S" 2>/dev/null)"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$(sub "$BC")" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [ "$(q "$S" s.set)" = "[1]" ] && grep -q "prepared.txt" "$GATE_DIR/log" && ok "$sh: the check block: green set of PR 1, prepare ran" || bad "$sh: the check block: [$got]"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$(sub "$BM")" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 " ] && ok "$sh: the merge block merges PR 1" || bad "$sh: the merge block: [$got]"
    unset GH_LABELS_3
    # The batch CI block: the profile says batch — one dispatch for main, also when the block runs twice;
    # the profile has no workflow.ci (F exits 4) — nothing is dispatched.
    BATCH_RUN='gh workflow run ci.yml --ref $ref -f job=check'; ci_guard "$BATCH_RUN"
    BATCH="F() { case \"\$1\" in workflow.ci) echo batch ;; workflow.ci_batch_run) echo '$BATCH_RUN' ;; *) return 4 ;; esac; }"
    export GH_RUN_URL="https://github.com/o/r/actions/runs/77"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$BATCH"$'\n'"$(sub "$BCI" | sed "s#<CI file>#$W/ci.json#")" 2>&1)"
    got2="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$BATCH"$'\n'"$(sub "$BCI" | sed "s#<CI file>#$W/ci.json#")" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [[ "$got2" == *"CI_RUN=77"* ]] && [ "$(grep -c '^workflow run ci.yml --ref main -f job=check$' "$GH_LOG")" = 1 ] \
        && ok "$sh: the batch CI block dispatches once for main, run twice" || bad "$sh: the batch CI block: [$got] [$got2] $(grep 'workflow run' "$GH_LOG")"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$STUB"$'\n'"$(sub "$BCI" | sed "s#<CI file>#$W/ci-pr.json#")" 2>&1)"
    [[ "$got" == *"CI=skipped"* ]] && [[ "$got" == *"EXIT=0"* ]] && [ "$(grep -c '^workflow run' "$GH_LOG")" = 1 ] && [ "$(q "$W/ci-pr.json" s.ci)" = pr ] \
        && ok "$sh: the batch CI block without workflow.ci dispatches nothing" || bad "$sh: the CI block with pr: [$got]"
    unset GH_RUN_URL
done

# The gate full of one PR ("each"): the e2e lock with holder.json naming that PR, under bash and zsh.
BE="$(block 'printf '"'"'{"prs":[%s],"what":"gate-full"')"
[ -n "$BE" ] && ok "skill blocks: the one-PR gate full block is in $SKILL" || bad "skill blocks: the one-PR gate full block not found in $SKILL"
# The block polls the e2e lock every 20 s, and it sleeps once more after it removes an abandoned lock: the run
# with an abandoned lock below spent 20 s per shell in that sleep alone. The test runs the block with a 0.2 s
# poll, as it runs wave-gate with WAVE_GATE_LOCK_POLL_S=1; the 20 s of the block is checked here. After 50 polls
# (10 s) the block exits 98: a block that never takes the lock fails its check instead of hanging the file.
LOCK_POLL=$'\n    sleep 20\n' LOCK_FAST=$'\n    sleep 0.2; polls=$(( ${polls:-0} + 1 )); [ "$polls" -le 50 ] || exit 98\n'
[[ "$BE" == *"until mkdir \"\$L\""*"$LOCK_POLL"*"  done"* ]] && ok "skill blocks: the one-PR gate full block polls the e2e lock every 20 s" \
    || bad "skill blocks: the one-PR gate full block has no 'sleep 20' in its until mkdir loop"
# The exit code of a run of the block, for a failed check. Exit 98 is the fast poll giving up: the lock was never taken.
why() { [ "$1" -eq 98 ] && echo "exit 98, the lock was never taken" || echo "exit $1"; }
for sh in "${SHELLS[@]}"; do
    new_world "each-$sh" 1:a.txt
    L="$W/e2e.lock"; export GATE_LOCK="$L"
    STUB="F() { case \"\$1\" in workflow.e2e_lock) echo '$L' ;; *) return 4 ;; esac; }"
    b="${BE//<N>/5}"; b="${b//<PR worktree>/$W/repo}"; b="${b//<repo>/$W/repo}"; b="${b/"$LOCK_POLL"/$LOCK_FAST}"
    b="${b//node \"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/gate.mjs\" full/$STUBS/gate full}"
    # Without the fast poll both runs below would wait the real 20 s polls, and the whole file would run out
    # of its time instead of failing this one check.
    if [[ "$b" != *"$LOCK_FAST"* ]]; then
        bad "$sh: the one-PR gate full block: the fast lock poll could not be put in place of 'sleep 20', the block is not run"
        unset GATE_LOCK; continue
    fi
    got="$($sh -c "$STUB"$'\n'"$b" 2>&1)"; rc=$?
    h="$GATE_DIR/holder.1.json"
    [[ "$got" == *"EXIT=0"* ]] && [ "$(gate_count)" = 1 ] && grep -q "lock=held" "$GATE_DIR/log" && [ "$(q "$h" 's.prs.join(",")+" "+s.what+" "+(typeof s.pid)')" = "5 gate-full number" ] \
        && ok "$sh: the one-PR gate full block: holder.json names PR 5 and gate-full while the gate runs" || bad "$sh: the one-PR block, $(why "$rc"): [$got] holder $(cat "$h" 2>/dev/null)"
    [ ! -e "$L" ] && ok "$sh: the one-PR gate full block: the lock and its holder.json are gone after it" || bad "$sh: the one-PR block left [$(ls -A "$L" 2>&1)]"
    # an abandoned lock with someone's holder.json is taken over
    mkdir "$L"; printf '{"prs":[9],"what":"gate-full","pid":1,"since":"x"}\n' >"$L/holder.json"; touch -t 202001010000 "$L"
    got="$($sh -c "$STUB"$'\n'"$b" 2>&1)"; rc=$?
    [[ "$got" == *"EXIT=0"* ]] && [ "$(q "$GATE_DIR/holder.2.json" 's.prs.join(",")' 2>&1)" = 5 ] && [ ! -e "$L" ] \
        && ok "$sh: the one-PR gate full block: an abandoned lock is removed with its holder.json and taken" || bad "$sh: the one-PR block, abandoned lock, $(why "$rc"): [$got]"
    unset GATE_LOCK
done

caf_gone "$T"/*/screen/caf*.log && ok "no stub caffeinate of any test is left" || bad "stub caffeinate left: $(cat "$T"/*/screen/caf*.log)"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
