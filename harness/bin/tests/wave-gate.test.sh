#!/usr/bin/env bash
# Tests of harness/bin/wave-gate: one `gate full` for the set of ready PRs of a wave.
# Everything runs on temporary git repositories: a bare "origin" with refs/pull/<N>/head, a clone that
# plays the orchestrator's checkout, a stub gate (counts its runs, red on a marker file, "red once",
# code 3, "nothing ran") and a stub gh (`pr merge` squash-merges into the bare origin itself, `pr view`
# answers from refs/pull). No network, no real gate, no real gh, no real /tmp/worfy-e2e.lock.
# Below — the wave-gate blocks of skills/epic-wave/SKILL.md, cut out of the file and run under bash and zsh.
# Run: bash harness/bin/tests/wave-gate.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$(cd "$HERE/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
WG="$BIN/wave-gate"
SKILL="${SKILL_FILE:-$HARNESS/skills/epic-wave/SKILL.md}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
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
# kills wave-gate (its parent) with that file's signal; $GATE_DIR/sleep — seconds to sleep; $GATE_DIR/lockwatch —
# records the mtime of $GATE_LOCK at the start and at the end of the run.
cat >"$STUBS/gate" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$GATE_DIR/count" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$GATE_DIR/count"
echo "$n $(git rev-parse HEAD^{tree}) $(ls | tr '\n' ' ') scope=${GATE_SCOPE:-} arg=$1 lock=$([ -n "${GATE_LOCK:-}" ] && [ -d "$GATE_LOCK" ] && echo held || echo none)" >>"$GATE_DIR/log"
if [ -f "$GATE_DIR/artifacts" ]; then  # what an earlier run left in the tree; then leave a build output and node_modules
  echo "$n leftover=$([ -e build-out/leftover ] && echo yes || echo no) nm=$([ -e node_modules/keep ] && echo kept || echo none)" >>"$GATE_DIR/artifacts.log"
  mkdir -p build-out node_modules && touch build-out/leftover node_modules/keep
fi
mt() { node -e 'try{process.stdout.write(String(Math.floor(require("fs").statSync(process.argv[1]).mtimeMs/1000)))}catch{process.stdout.write("gone")}' "$1"; }
[ -f "$GATE_DIR/lockwatch" ] && echo "start $(mt "$GATE_LOCK")" >>"$GATE_DIR/lockwatch"
if [ -f "$GATE_DIR/kill$n" ]; then kill -"$(cat "$GATE_DIR/kill$n")" "$PPID"; sleep 1; exit 0; fi
[ -f "$GATE_DIR/sleep" ] && sleep "$(cat "$GATE_DIR/sleep")"
[ -f "$GATE_DIR/lockwatch" ] && echo "end $(mt "$GATE_LOCK")" >>"$GATE_DIR/lockwatch"
# $GATE_DIR/lockscreen — the run locks the screen: its contents go to $SCREEN_DIR/locked; $GATE_DIR/lockfor — the run
# locks the screen for that many seconds and unlocks it before it ends; $GATE_DIR/window — the run is red in the
# script named in the file (test:e2e when empty) and prints what the real gate prints for it: the
# "[gate] красно (full): <project>/<workspace>:<script> (прошло: …)" line and the last 40 lines of the script —
# Playwright's list of failed tests, without the "window was not shown" message that scrolled out of them.
# They are used once, unless $GATE_DIR/keep exists. $GATE_DIR/unitonce — red once in `test` alone.
if [ -f "$GATE_DIR/lockfor" ]; then : >"$SCREEN_DIR/locked"; sleep "$(cat "$GATE_DIR/lockfor")"; rm -f "$SCREEN_DIR/locked" "$GATE_DIR/lockfor"; fi
if [ -f "$GATE_DIR/lockscreen" ]; then cp "$GATE_DIR/lockscreen" "$SCREEN_DIR/locked"; [ -f "$GATE_DIR/keep" ] || rm -f "$GATE_DIR/lockscreen"; fi
if [ -f "$GATE_DIR/window" ]; then script="$(cat "$GATE_DIR/window")"; script="${script:-test:e2e}"; [ -f "$GATE_DIR/keep" ] || rm -f "$GATE_DIR/window"
  { echo "[gate] красно (full): worfy/.:$script (прошло: worfy/.:lint worfy/.:typecheck worfy/.:test)"
    echo "The quality gate did not pass (profile: full, repository: worfy)."; echo "--- FAILED: worfy/.:$script"
    for i in $(seq 1 36); do echo "  ✘  $i [electron] › test/e2e/spec$i.spec.ts:12:3 › case $i (30.2s)"; done
    echo "  36 failed"; echo "  4 passed (19.8m)"; echo " ELIFECYCLE  Command failed with exit code 1."; } >&2; exit 2; fi
if [ -f "$GATE_DIR/unitonce" ]; then rm -f "$GATE_DIR/unitonce"
  echo "[gate] красно (full): worfy/.:test (прошло: worfy/.:lint worfy/.:test:e2e)" >&2; echo " FAIL  test/unit/red.test.ts > is red" >&2; exit 2; fi
if [ -f "$GATE_DIR/code3" ]; then echo "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: stub" >&2; exit 3; fi
if [ -f "$GATE_DIR/none" ]; then echo "[gate] ничего не прогналось (full): stub. Это не «зелено»."; exit 0; fi
if [ -f "$GATE_DIR/redonce" ]; then rm -f "$GATE_DIR/redonce"
  echo "[gate] красно (full): test:e2e (прошло: lint test)" >&2; echo " FAIL  test/e2e/flaky.spec.ts > opens the window" >&2; exit 2; fi
if [ -f RED ]; then echo "[gate] красно (full): test (прошло: lint)" >&2; echo " FAIL  test/unit/red.test.ts > is red" >&2; exit 2; fi
echo "[gate] зелено (full): lint test test:e2e"
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
[ "$1 $2" = "pr merge" ] || { echo "stub gh: unexpected $*" >&2; exit 1; }
n=$3; sha=""; shift 3
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
# N answers if it holds N; each call is logged to $SCREEN_DIR/ioreg.log.
# caffeinate: logs "<own pid> <args>" to $SCREEN_DIR/caf.log and, like the real one with -w, lives until
# that pid is gone.
POWER="$T/power"; mkdir -p "$POWER"
cat >"$POWER/ioreg" <<'EOF'
#!/usr/bin/env bash
d="${SCREEN_DIR:-/nonexistent}"; echo "$*" >>"$d/ioreg.log" 2>/dev/null
v=No
if [ -f "$d/locked" ]; then
  v=Yes; n="$(cat "$d/locked")"
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
# Fast lock timings for the tests; the defaults (20 s poll, 30 min stale, 5 min heartbeat) are checked below.
export WAVE_GATE_LOCK_POLL_S=1 WAVE_GATE_SCREEN_POLL_S=1

# --- a world: bare origin, PR refs, the orchestrator's clone ----------------------------
# new_world <name> <spec>…: each spec is "<N>:<file>[=<content>]" — PR N forks off main and writes that file
# (content defaults to the PR number). RED as the file name makes the gate red on every tree that has it.
new_world() {
    W="$T/$1"; shift
    mkdir -p "$W/gate" "$W/gh"
    git init -q --bare -b main "$W/origin.git"
    git clone -q "$W/origin.git" "$W/seed" 2>/dev/null
    echo base >"$W/seed/base.txt"; echo shared >"$W/seed/shared.txt"; printf 'build-out/\nnode_modules/\n' >"$W/seed/.gitignore"
    git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m base && git -C "$W/seed" push -q origin HEAD:main
    for spec in "$@"; do
        n="${spec%%:*}"; f="${spec#*:}"; c="$n"
        case "$f" in *=*) c="${f#*=}"; f="${f%%=*}" ;; esac
        git -C "$W/seed" checkout -q -b "pr$n" main
        echo "$c" >"$W/seed/$f"
        git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "pr $n"
        git -C "$W/seed" push -q origin "HEAD:refs/pull/$n/head"
        git -C "$W/seed" checkout -q main
    done
    git clone -q "$W/origin.git" "$W/repo"
    mkdir -p "$W/screen"
    export GATE_DIR="$W/gate" GH_ORIGIN="$W/origin.git" GH_LOG="$W/gh/log" GH_TMP="$W/gh" SCREEN_DIR="$W/screen"
    unset GATE_LOCK GH_EXTRA_AT
}
head_of() { git -C "$W/origin.git" rev-parse "refs/pull/$1/head"; }
# state <file> <lock or null> <pr>…: each pr is "<N>[,platform][,label=<name>]"
state() {
    local f="$1" lock="$2"; shift 2
    local items="" sep=""
    for p in "$@"; do
        local n="${p%%,*}" plat=false labels=""
        [[ "$p" == *,platform* ]] && plat=true
        [[ "$p" == *,label=* ]] && labels="\"${p##*,label=}\""
        items="$items$sep{\"number\":$n,\"head\":\"$(head_of "$n")\",\"labels\":[$labels],\"platform\":$plat}"; sep=","
    done
    [ "$lock" = null ] || lock="\"$lock\""
    printf '{"repo":"%s","branch":"main","e2e_lock":%s,"prepare":null,"prs":[%s]}\n' "$W/repo" "$lock" "$items" >"$f"
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

# --- red, then green on the repeat: flaky ----------------------------------------------
new_world flaky 1:a.txt 2:b.txt
S="$W/state.json"; state "$S" null 1 2; touch "$GATE_DIR/redonce"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [ "$(gate_count)" = 2 ] && ok "flaky: status green after a green repeat (2 runs)" || bad "flaky: exit $rc status $(q "$S" s.status) runs $(gate_count)"
[[ "$(q "$S" s.flaky)" == *"test/e2e/flaky.spec.ts > opens the window"* && "$(q "$S" s.flaky)" == *"test:e2e"* ]] && ok "flaky: the failing tests of the first run are recorded" || bad "flaky: $(q "$S" s.flaky 2>&1)"

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

# --- resume: a run broken off after the first gate full ----------------------------------
new_world resume 1:a.txt 2:b.txt 3:RED 4:d.txt 5:e.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2 3 4 5
echo KILL >"$GATE_DIR/kill2"   # the second run (the repeat) kills wave-gate: an abrupt end of the session
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
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
[ "$(wc -l <"$SCREEN_DIR/caf.log" | tr -d ' ')" = 2 ] && caf_gone "$SCREEN_DIR/caf.log" \
    && ok "resume: no caffeinate left after a SIGKILL of wave-gate" || bad "resume: caffeinate left: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
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
sleep 60 & sp=$!
echo "$sp" >"$(PIDF)"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "another wave-gate check runs in this repository (pid $sp" "$W/out" && ok "pid: a live check's pid -> exit 1 naming it" || bad "pid live: exit $rc: $(tail -3 "$W/out")"
[ "$(cat "$(TMPW_OF)/marker" 2>/dev/null)" = mine ] && git -C "$W/repo" worktree list | grep -q worfy-wave-gate && [ "$(gate_count)" = 0 ] && [ "$(cat "$(PIDF)")" = "$sp" ] \
    && ok "pid: the other check's worktree and pid file are untouched, no gate run" || bad "pid live: worktree, pid file or gate touched"
kill "$sp"; wait "$sp" 2>/dev/null
git -C "$W/repo" worktree remove --force "$(TMPW_OF)"
# a dead pid: stale, taken over
sleep 0 & dp=$!; wait "$dp"
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
# two checks started together: exactly one runs
new_world pidrace 1:a.txt
state "$W/s1.json" null 1; state "$W/s2.json" null 1
echo 2 >"$GATE_DIR/sleep"
"$WG" check "$W/s1.json" >"$W/o1" 2>&1 & p1=$!
"$WG" check "$W/s2.json" >"$W/o2" 2>&1 & p2=$!
wait "$p1"; r1=$?; wait "$p2"; r2=$?
codes="$(printf '%s\n' "$r1" "$r2" | sort | tr '\n' ' ')"
[ "$codes" = "0 1 " ] && grep -q "another wave-gate check" "$W/o1" "$W/o2" && [ "$(gate_count)" = 1 ] && ok "pid: two checks at once -> one runs, the other exits 1" || bad "pid race: codes [$codes] runs $(gate_count): $(tail -2 "$W/o1") | $(tail -2 "$W/o2")"
rm -f "$GATE_DIR/sleep"

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
sleep 3
[ "$(gate_count)" = 0 ] && kill -0 "$wg" 2>/dev/null && ok "e2e lock: a live lock held by another -> waits" || bad "e2e lock: did not wait ($(gate_count) runs)"
rmdir "$L"; wait "$toucher" 2>/dev/null
wait "$wg"; rc=$?
[ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && grep -q "lock=held" "$GATE_DIR/log" && ok "e2e lock: taken after release, the gate runs under it" || bad "e2e lock: exit $rc runs $(gate_count) $(cat "$GATE_DIR/log")"
[ ! -e "$L" ] && ok "e2e lock: released after the run" || bad "e2e lock: left after the run"
# stale: older than 30 minutes (the default) — removed and taken
new_world stale 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
mkdir "$L"; touch -t 202001010000 "$L"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "lock=held" "$GATE_DIR/log" && [ ! -e "$L" ] && ok "e2e lock: a lock older than 30 min is taken over and released" || bad "e2e lock stale: exit $rc $(tail -3 "$W/out")"
new_world young 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
mkdir "$L"; touch -t "$(date -r $(( $(date +%s) - 1500 )) +%Y%m%d%H%M.%S 2>/dev/null || date -d @$(( $(date +%s) - 1500 )) +%Y%m%d%H%M.%S)" "$L"
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
sleep 2
[ "$(gate_count)" = 0 ] && ok "e2e lock: a lock 25 min old is not taken over" || bad "e2e lock: a 25-min lock was taken"
rmdir "$L"; wait "$wg"
# heartbeat: the lock's mtime moves during a run
new_world beat 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
echo 3 >"$GATE_DIR/sleep"; touch "$GATE_DIR/lockwatch"
WAVE_GATE_HEARTBEAT_S=1 "$WG" check "$S" >"$W/out" 2>&1; rc=$?
s=$(awk '$1=="start"{print $2}' "$GATE_DIR/lockwatch"); e=$(awk '$1=="end"{print $2}' "$GATE_DIR/lockwatch")
[ "$rc" -eq 0 ] && [ -n "$s" ] && [ -n "$e" ] && [ "$e" != gone ] && [ "$e" -gt "$s" ] && ok "e2e lock: the heartbeat moves the mtime during the run ($s -> $e)" || bad "e2e lock heartbeat: exit $rc start $s end $e"
# an error (a signal) in the middle of a run: the lock is released
new_world sig 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1; export GATE_LOCK="$L"
echo TERM >"$GATE_DIR/kill1"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 143 ] && [ ! -e "$L" ] && ok "e2e lock: released when wave-gate is stopped (exit 143)" || bad "e2e lock on signal: exit $rc, lock $( [ -e "$L" ] && echo left || echo gone)"
[ -s "$SCREEN_DIR/caf.log" ] && caf_gone "$SCREEN_DIR/caf.log" && ok "signal: no caffeinate left after SIGTERM" || bad "signal: caffeinate left or not started: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"
unset GATE_LOCK

# --- an error in the middle of the squash merges: the worktree is removed ---------------------
new_world broken 1:a.txt
# PR 2: a commit whose tree object is missing — git merge fails without a conflict
blob=$(echo "broken $RANDOM" | git -C "$W/repo" hash-object -w --stdin)
tree=$(printf '100644 blob %s\tbroken.txt\n' "$blob" | git -C "$W/repo" mktree)
c2=$(git -C "$W/repo" commit-tree "$tree" -p "$(git -C "$W/repo" rev-parse origin/main)" -m broken)
rm -f "$W/repo/.git/objects/${tree:0:2}/${tree:2}"
S="$W/state.json"
printf '{"repo":"%s","branch":"main","e2e_lock":null,"prepare":null,"prs":[{"number":1,"head":"%s"},{"number":2,"head":"%s"}]}\n' "$W/repo" "$(head_of 1)" "$c2" >"$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && [ "$(q "$S" s.status)" = error ] && ok "error while merging: exit 1, status error" || bad "error while merging: exit $rc status $(q "$S" s.status 2>&1): $(tail -3 "$W/out")"
[ ! -e "$(TMPW_OF)" ] && ok "error while merging: the temporary worktree is removed" || bad "error while merging: worktree left"
[ "$(gate_count)" = 0 ] && ok "error while merging: no gate run" || bad "error while merging: $(gate_count) runs"
[ -s "$SCREEN_DIR/caf.log" ] && caf_gone "$SCREEN_DIR/caf.log" && ok "error while merging: no caffeinate left after the error" || bad "error while merging: caffeinate left or not started: $(cat "$SCREEN_DIR/caf.log" 2>/dev/null)"

# --- the screen: a locked screen before a gate run -------------------------------------------
new_world screenpre 1:a.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1
: >"$SCREEN_DIR/locked"
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
until_ok 10 grep -q "screen locked: gate full waits" "$W/out"; sleep 2
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
until_ok 10 grep -q "waiting for the e2e lock" "$W/out"
: >"$SCREEN_DIR/locked"; rmdir "$L"
until_ok 10 grep -q "screen locked: gate full waits" "$W/out"; sleep 1
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

# --- the screen locks during gate full ------------------------------------------------------------
# the e2e did not get its window and the screen was locked: not red — not verified, repeated after unlock
new_world screenmid 1:a.txt 2:b.txt
S="$W/state.json"; L="$W/e2e.lock"; state "$S" "$L" 1 2
: >"$GATE_DIR/lockscreen"; touch "$GATE_DIR/window"
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
until_ok 10 grep -q "screen locked: gate full waits" "$W/out"; sleep 1
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
echo 3 >"$GATE_DIR/lockfor"; touch "$GATE_DIR/window"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome).join(" ")')" = "full:2:unverified full:2:green" ] && ! grep -q "gate full waits" "$W/out" \
    && ok "screen locked and unlocked during the run: not verified, run again at once, green" || bad "screen locked and unlocked during the run: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.size+":"+r.outcome)'): $(cat "$W/out")"
# test:package (the packaged .app) also needs a window
new_world screenpkg 1:a.txt
S="$W/state.json"; state "$S" null 1
echo 3 >"$GATE_DIR/lockfor"; echo test:package >"$GATE_DIR/window"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.outcome).join(" ")')" = "full:unverified full:green" ] \
    && ok "screen locked, test:package failed: not verified, run again" || bad "screen locked, test:package: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.outcome)')"
# the same failure with the screen unlocked is red (the e2e load case): the usual repeat
new_world windowred 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/window"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.runs.map(r=>r.role+":"+r.outcome).join(" ")')" = "full:red retry:green" ] && [[ "$(q "$S" s.flaky)" == *"spec1.spec.ts"* ]] \
    && ok "e2e failed, screen unlocked: red, repeated as flaky" || bad "e2e failed, screen unlocked: exit $rc runs $(q "$S" 's.runs.map(r=>r.role+":"+r.outcome)')"
# only `test` failed (no e2e script), with the screen locked: red
new_world screenred 1:a.txt
S="$W/state.json"; state "$S" null 1; : >"$GATE_DIR/lockscreen"; touch "$GATE_DIR/unitonce"
"$WG" check "$S" >"$W/out" 2>&1 & wg=$!
until_ok 10 grep -q "screen locked: gate full waits" "$W/out"
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

# --- caffeinate: the commands keep the display awake while they live -----------------------
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

# --- no ioreg and no caffeinate in PATH: no screen check, no keep-awake -----------------------------
# A PATH of links to the tools the script and the stubs need, without /usr/bin and /usr/sbin, where macOS keeps both.
MINBIN="$T/minbin"; mkdir -p "$MINBIN"
for c in node git bash sh env cat ls tr rm cp touch mkdir sleep mktemp awk; do p="$(command -v "$c")" && ln -s "$p" "$MINBIN/$c"; done
new_world nopower 1:a.txt
S="$W/state.json"; state "$S" null 1
: >"$SCREEN_DIR/locked"
if env PATH="$STUBS:$MINBIN" bash -c 'command -v ioreg || command -v caffeinate' >/dev/null 2>&1; then
    bad "no ioreg: the minimal PATH still has ioreg or caffeinate"
else
    PATH="$STUBS:$MINBIN" "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    PATH="$STUBS:$MINBIN" "$WG" merge "$S" >"$W/mout" 2>&1; mrc=$?
    [ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && ! grep -q "screen locked" "$W/out" && [ ! -e "$SCREEN_DIR/ioreg.log" ] \
        && ok "no ioreg in PATH: no screen check, the gate runs" || bad "no ioreg: exit $rc runs $(gate_count): $(cat "$W/out")"
    [ "$mrc" -eq 0 ] && [ ! -e "$SCREEN_DIR/caf.log" ] && ok "no caffeinate in PATH: check and merge run without it" || bad "no caffeinate: merge exit $mrc: $(cat "$W/mout")"
fi

# --- bad input ---------------------------------------------------------------------------
new_world input 1:a.txt
S="$W/state.json"; printf '{"repo":"%s","branch":"main","prs":[]}\n' "$W/repo" >"$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "e2e_lock" "$W/out" && ok "input: e2e_lock missing -> exit 1 naming it" || bad "input: exit $rc $(cat "$W/out")"
"$WG" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "input: no command -> exit 1" || bad "input: no command exit $rc"

# --- the blocks of skills/epic-wave/SKILL.md, under bash and zsh -------------------------------
block() { # $1 = a string that identifies the ```bash block; prints it without the `F() {…profile…}` line
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$SKILL" \
        | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}
BI="$(block 'PLATFORM=(')"; BC="$(block 'wave-gate" check')"; BM="$(block 'wave-gate" merge')"
[ -n "$BI" ] && [ -n "$BC" ] && [ -n "$BM" ] && ok "skill blocks: the set, check and merge blocks are in $SKILL" || bad "skill blocks: not found in $SKILL"
for sh in bash zsh; do
    new_world "skill-$sh" 1:a.txt 2:b.txt 3:c.txt
    export GH_LABELS_3="needs-mac-gate other"
    STUB="F() { case \"\$1\" in workflow.e2e_lock) echo '$W/e2e.lock' ;; commands.prepare_tree) echo 'echo prepared >prepared.txt' ;; *) return 4 ;; esac; }"
    sub() { local b="$1"; b="${b//<repo>/$W/repo}"; b="${b//<main branch>/main}"; b="${b//<state file>/$W/state.json}"
            b="${b//<main lock>/$W/main.lock}"; b="${b//<PR numbers in merge order>/1 2 3}"; b="${b//<platform PR numbers>/2}"; printf '%s' "$b"; }
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$STUB"$'\n'"$(sub "$BI")" 2>&1)"
    S="$W/state.json"
    [ -f "$S" ] && [ "$(q "$S" 's.prs.map(p=>p.number+":"+p.platform+":"+p.labels.join("+")+":"+(p.head.length)).join(" ")')" = "1:false::40 2:true::40 3:false:needs-mac-gate+other:40" ] \
        && [ "$(q "$S" 's.repo+" "+s.branch+" "+s.e2e_lock+" "+s.prepare+" "+s.main_lock')" = "$W/repo main $W/e2e.lock echo prepared >prepared.txt $W/main.lock" ] \
        && ok "$sh: the set block writes the state file" || bad "$sh: the set block: [$got] $(cat "$S" 2>/dev/null)"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$(sub "$BC")" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [ "$(q "$S" s.set)" = "[1]" ] && grep -q "prepared.txt" "$GATE_DIR/log" && ok "$sh: the check block: green set of PR 1, prepare ran" || bad "$sh: the check block: [$got]"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$(sub "$BM")" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 " ] && ok "$sh: the merge block merges PR 1" || bad "$sh: the merge block: [$got]"
    unset GH_LABELS_3
done

caf_gone "$T"/*/screen/caf*.log && ok "no stub caffeinate of any test is left" || bad "stub caffeinate left: $(cat "$T"/*/screen/caf*.log)"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
