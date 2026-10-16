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
mt() { node -e 'try{process.stdout.write(String(Math.floor(require("fs").statSync(process.argv[1]).mtimeMs/1000)))}catch{process.stdout.write("gone")}' "$1"; }
[ -f "$GATE_DIR/lockwatch" ] && echo "start $(mt "$GATE_LOCK")" >>"$GATE_DIR/lockwatch"
if [ -f "$GATE_DIR/kill$n" ]; then kill -"$(cat "$GATE_DIR/kill$n")" "$PPID"; sleep 1; exit 0; fi
[ -f "$GATE_DIR/sleep" ] && sleep "$(cat "$GATE_DIR/sleep")"
[ -f "$GATE_DIR/lockwatch" ] && echo "end $(mt "$GATE_LOCK")" >>"$GATE_DIR/lockwatch"
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
export WAVE_GATE_GATE="$STUBS/gate" PATH="$STUBS:$PATH"
# Fast lock timings for the tests; the defaults (20 s poll, 30 min stale, 5 min heartbeat) are checked below.
export WAVE_GATE_LOCK_POLL_S=1

# --- a world: bare origin, PR refs, the orchestrator's clone ----------------------------
# new_world <name> <spec>…: each spec is "<N>:<file>[=<content>]" — PR N forks off main and writes that file
# (content defaults to the PR number). RED as the file name makes the gate red on every tree that has it.
new_world() {
    W="$T/$1"; shift
    mkdir -p "$W/gate" "$W/gh"
    git init -q --bare -b main "$W/origin.git"
    git clone -q "$W/origin.git" "$W/seed" 2>/dev/null
    echo base >"$W/seed/base.txt"; echo shared >"$W/seed/shared.txt"
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
    export GATE_DIR="$W/gate" GH_ORIGIN="$W/origin.git" GH_LOG="$W/gh/log" GH_TMP="$W/gh"
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

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
