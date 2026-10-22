# The world of the wave-gate tests, sourced by wave-gate.test.sh and wave-gate-lock.test.sh after `set -u` and HERE:
# the temporary folder, ok/bad, the stub gate, gh, ioreg and caffeinate, the Windows stand-ins and skips, and
# new_world, state and the other helpers of the cases. Not a test of its own (no .test.sh).
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
  # a killed wave-gate's gate may outlive it: with $GATE_DIR/hold it goes on while that file exists (at most 30 s)
  sleep 1; i=150; while [ -f "$GATE_DIR/hold" ] && [ "$i" -gt 0 ]; do sleep 0.2; i=$((i - 1)); done; exit 0
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
# Waits at most $2 s for the background run $1 and sets rc to its exit code. A run still going then is stopped with
# SIGTERM, and with SIGKILL 2 s later; rc says which it took, and the case fails instead of hanging the file.
gone() { ! kill -0 "$1" 2>/dev/null; }
finish() {
    if gone "$1" || until_ok "$2" gone "$1"; then wait "$1"; rc=$?; return 0; fi
    kill "$1" 2>/dev/null
    if until_ok 2 gone "$1"; then rc="still running after $2 s, stopped by SIGTERM"
    else kill -KILL "$1" 2>/dev/null; rc="still running after $2 s, SIGTERM ignored, killed"; fi
    wait "$1" 2>/dev/null
    return 1
}
# caf_gone <caf.log>…: every stub caffeinate those logs name has ended (within 3 s)
caf_alive() { local f p; for f in "$@"; do [ -f "$f" ] || continue; for p in $(awk '{print $1}' "$f"); do kill -0 "$p" 2>/dev/null && return 0; done; done; return 1; }
caf_gone() { local n=15; while caf_alive "$@"; do n=$((n - 1)); [ "$n" -le 0 ] && return 1; sleep 0.2; done; return 0; }
TMPW_OF() { echo "$(cd "$W/repo/.git" && pwd -P)/worfy-wave-gate"; }
prefix_tree() { git -C "$W/seed" rev-parse "$1^{tree}"; }
