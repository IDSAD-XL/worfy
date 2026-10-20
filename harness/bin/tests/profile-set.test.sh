#!/usr/bin/env bash
# Tests of harness/bin/profile-set: it writes only workflow.pipeline of one project's
# profile, checks the value with the rules bin/profile reads it by (lib/pipeline.cjs), writes only
# while the file still has the Pipeline the caller read (compare-and-write by fingerprint), resets
# the field, and commits the change in the git repository of the Harness home; a commit that fails
# leaves the write in place with a warning. Run: bash harness/bin/tests/profile-set.test.sh; exit
# code 0 — everything passed.
#
# Everything runs in a temporary HOME and HARNESS_HOME: the real ~/.claude and
# ~/.claude/worfy-harness are compared before and after (real-home.sh).
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
SET="$BIN/profile-set"
PROFILE="$BIN/profile"
pass=0
fail=0
. "$(dirname "$0")/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME")"

ok() {
    pass=$((pass + 1))
    echo "ok   $1"
}
bad() {
    fail=$((fail + 1))
    echo "FAIL $1"
}
# check <name> <command…>: passes when the command exits 0.
check() {
    local name="$1"
    shift
    if "$@"; then ok "$name"; else bad "$name"; fi
}
# Four cases put a shell-script `git` stub first on PATH: one refuses commit, and three (the stale
# lock two waiters see) hold their commit until the test lets it go. profile-set starts git by name
# without a shell, and node on Windows starts only a .com or .exe that way, so it skips the stub and
# runs the real git there. Those cases are skipped on Windows, one line per kind. Off Windows every case runs: a skip that fired there would leave cases out while the
# file stays green.
. "$(dirname "$0")/gh-stand-in.sh"
RUN_GIT_STUB=true
if on_windows; then
    RUN_GIT_STUB=false
    echo "skip the failed-commit case: node on Windows starts no shell stub for git, so the real git commits"
    echo "skip the three stale-lock two-waiters cases: node on Windows starts no shell stub for git, so the commit is not held"
fi
# The guard of the above: off Windows (by uname, not by on_windows) the git-stub cases are on.
case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) ;;
    *) check "off Windows the git-stub cases are not skipped" "$RUN_GIT_STUB" ;;
esac

T="$(mktemp -d)"
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
H="$T/home"
HH="$T/hh"
mkdir -p "$H" "$HH/gate" "$HH/projects/demo" "$T/r/demo" "$T/r/plain" "$T/stub"
git -C "$T/r/demo" init -q -b main
git -C "$T/r/plain" init -q -b main
cat >"$HH/gate/config.json" <<EOF
{"repos":[{"key":"demo","match":"$T/r/demo","profile":"demo"}]}
EOF
# A profile with fields around the one written: they must come out as they went in.
cat >"$HH/projects/demo/profile.json" <<'EOF'
{
  "schema": 2,
  "name": "demo",
  "mode": "full",
  "commands": { "test": "make test" },
  "workflow": { "ci": "pr", "merge_gate": "each" },
  "review": { "lenses": ["correctness"] }
}
EOF
printf '# demo rules\n' >"$HH/projects/demo/rules.md"
printf '/*\n!/.gitignore\n!/projects/\n!/gate/\n/gate/*\n!/gate/config.json\n' >"$HH/.gitignore"
git -C "$HH" init -q -b main
git -C "$HH" add -A
git -C "$HH" -c user.name=t -c user.email=t@t commit -q -m init
PJ="$HH/projects/demo/profile.json"

# The scripts with the temporary homes, and nothing of the caller's registry or profiles.
run() { env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR -u EVAL_HARNESS_HOME HOME="$H" USERPROFILE="$H" HARNESS_HOME="${RUN_HH:-$HH}" "$@"; }
commits() { git -C "$HH" rev-list --count HEAD; }
others() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if (p.workflow) delete p.workflow.pipeline; process.stdout.write(JSON.stringify(p))' "$1"; }
field() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=p.workflow&&p.workflow.pipeline; process.stdout.write(v===undefined?"absent":JSON.stringify(v))' "$1"; }
json_get() { node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8"))[process.argv[1]]; process.stdout.write(v===null?"null":typeof v==="string"?v:JSON.stringify(v))' "$1"; }

GOOD='[{"kind":"queued"},{"kind":"implementing","stuck_after":"3h"},{"kind":"check","name":"windows","label":"Windows"},{"kind":"gate-merge"},{"kind":"done"}]'
OTHER='[{"kind":"queued"},{"kind":"implementing"},{"kind":"done"}]'
DEFAULT='[{"kind":"queued"},{"kind":"implementing"},{"kind":"ci"},{"kind":"agent-review"},{"kind":"gate-merge"},{"kind":"closing"},{"kind":"done"}]'

# --- usage ----------------------------------------------------------------------------------------
run "$SET" -C "$T/r/demo" >/dev/null 2>&1
check "no mode -> exit 2" [ $? -eq 2 ]
run "$SET" -C "$T/r/demo" --set "$GOOD" >/dev/null 2>&1
check "--set without --expect -> exit 2" [ $? -eq 2 ]
run "$SET" -C "$T/r/demo" --reset >/dev/null 2>&1
check "--reset without --expect -> exit 2" [ $? -eq 2 ]
run "$SET" -C "$T/r/plain" --read >/dev/null 2>&1
check "a folder of no registered project -> exit 3" [ $? -eq 3 ]

# --- read -----------------------------------------------------------------------------------------
out="$(run "$SET" -C "$T/r/demo" --read)"
rc=$?
check "--read without the field: exit 0" [ "$rc" -eq 0 ]
check "--read without the field: pipeline null" [ "$(json_get pipeline <<<"$out")" = null ]
check "--read without the field: fingerprint null" [ "$(json_get fingerprint <<<"$out")" = null ]
check "--read without the field: resolved is the default Pipeline" [ "$(json_get resolved <<<"$out")" = "$DEFAULT" ]

# --- a valid Pipeline is written and committed -----------------------------------------------------
before_others="$(others "$PJ")"
before_commits="$(commits)"
out="$(run "$SET" -C "$T/r/demo" --expect null --set "$GOOD" 2>"$T/err")"
rc=$?
check "valid Pipeline: exit 0" [ "$rc" -eq 0 ]
[ "$rc" -eq 0 ] || echo "     stderr: $(head -c 400 "$T/err")"
check "valid Pipeline: written as given" [ "$(field "$PJ")" = "$GOOD" ]
check "valid Pipeline: the other fields of profile.json are as they were" [ "$(others "$PJ")" = "$before_others" ]
check "valid Pipeline: one commit more in the Harness home" [ "$(commits)" -eq $((before_commits + 1)) ]
check "valid Pipeline: profile.json is committed (nothing left in git status)" [ -z "$(git -C "$HH" status --porcelain -- projects/demo/profile.json)" ]
check "valid Pipeline: the commit holds profile.json only" [ "$(git -C "$HH" show --name-only --format= HEAD)" = "projects/demo/profile.json" ]
check "valid Pipeline: no warning" [ ! -s "$T/err" ]
fp="$(json_get fingerprint <<<"$out")"
check "valid Pipeline: the answer gives the new fingerprint" [ "${fp#sha256:}" != "$fp" ]
read_fp="$(run "$SET" -C "$T/r/demo" --read | json_get fingerprint)"
check "valid Pipeline: --read gives the same fingerprint" [ "$read_fp" = "$fp" ]
resolved="$(run "$PROFILE" -C "$T/r/demo" --field _resolved.pipeline | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8"))))')"
check "valid Pipeline: bin/profile reads it as _resolved.pipeline" [ "$resolved" = "$GOOD" ]

# --- an invalid Pipeline is not written --------------------------------------------------------------
cp "$PJ" "$T/pj-before"
before_commits="$(commits)"
for bad_pl in \
    '[{"kind":"queued"},{"kind":"ci","stuck_after":"0h"},{"kind":"done"}]|workflow.pipeline[1].stuck_after' \
    '[{"kind":"queued"},{"kind":"check"},{"kind":"done"}]|workflow.pipeline[1]: check needs a name' \
    '[{"kind":"queued"},{"kind":"ci","label":"  "},{"kind":"done"}]|workflow.pipeline[1].label' \
    '[{"kind":"ci"},{"kind":"done"}]|the first Stage is queued' \
    'not json|is not JSON'; do
    pl="${bad_pl%|*}"
    reason="${bad_pl##*|}"
    run "$SET" -C "$T/r/demo" --expect "$fp" --set "$pl" >/dev/null 2>"$T/err"
    rc=$?
    check "invalid ($reason): exit 1" [ "$rc" -eq 1 ]
    check "invalid ($reason): the reason in stderr" grep -qF -- "$reason" "$T/err"
    check "invalid ($reason): profile.json as it was" cmp -s "$PJ" "$T/pj-before"
done
check "invalid Pipelines: no commit" [ "$(commits)" -eq "$before_commits" ]

# --- compare-and-write --------------------------------------------------------------------------------
run "$SET" -C "$T/r/demo" --expect "sha256:0000" --set "$OTHER" >"$T/out" 2>"$T/err"
rc=$?
check "another fingerprint: exit 5" [ "$rc" -eq 5 ]
check "another fingerprint: profile.json as it was" cmp -s "$PJ" "$T/pj-before"
check "another fingerprint: the answer names the current fingerprint" [ "$(json_get fingerprint <"$T/out")" = "$fp" ]
run "$SET" -C "$T/r/demo" --expect null --set "$OTHER" >/dev/null 2>&1
check "fingerprint null while the field is set: exit 5" [ $? -eq 5 ]
run "$SET" -C "$T/r/demo" --expect "sha256:0000" --reset >/dev/null 2>&1
check "reset with another fingerprint: exit 5" [ $? -eq 5 ]
check "after the refusals: profile.json as it was" cmp -s "$PJ" "$T/pj-before"
check "after the refusals: no commit" [ "$(commits)" -eq "$before_commits" ]

# --- reset ----------------------------------------------------------------------------------------------
out="$(run "$SET" -C "$T/r/demo" --expect "$fp" --reset 2>"$T/err")"
rc=$?
check "reset: exit 0" [ "$rc" -eq 0 ]
check "reset: the field is gone" [ "$(field "$PJ")" = absent ]
check "reset: the other fields are as they were" [ "$(others "$PJ")" = "$before_others" ]
check "reset: committed" [ "$(commits)" -eq $((before_commits + 1)) ]
check "reset: the answer gives fingerprint null" [ "$(json_get fingerprint <<<"$out")" = null ]
resolved="$(run "$PROFILE" -C "$T/r/demo" --json | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8"))._resolved.pipeline))')"
check "reset: bin/profile --json gives the default _resolved.pipeline" [ "$resolved" = "$DEFAULT" ]

# --- the commit fails: the write stays, with a warning ---------------------------------------------------
REAL_GIT="$(command -v git)"
if $RUN_GIT_STUB; then
    cat >"$T/stub/git" <<EOF
#!/usr/bin/env bash
for a in "\$@"; do [ "\$a" = commit ] && { echo "stub git: commit refused" >&2; exit 1; }; done
exec "$REAL_GIT" "\$@"
EOF
    chmod +x "$T/stub/git"
    before_commits="$(commits)"
    out="$(PATH="$T/stub:$PATH" run "$SET" -C "$T/r/demo" --expect null --set "$OTHER" 2>"$T/err")"
    rc=$?
    check "failed commit: exit 0" [ "$rc" -eq 0 ]
    check "failed commit: written" [ "$(field "$PJ")" = "$OTHER" ]
    check "failed commit: no commit" [ "$(commits)" -eq "$before_commits" ]
    check "failed commit: a warning line in stderr" grep -q "^profile-set: warning: .*commit refused" "$T/err"
    check "failed commit: the warning in the answer" [ "$(json_get warning <<<"$out")" != null ]
    # What the failed commit staged is not left in the index.
    check "failed commit: nothing staged" [ -z "$(git -C "$HH" diff --cached --name-only)" ]
else
    # The cases below start from this value in the file.
    run "$SET" -C "$T/r/demo" --expect null --set "$OTHER" >/dev/null 2>"$T/err"
    check "Windows, in place of the failed-commit case: written" [ "$(field "$PJ")" = "$OTHER" ]
fi

# --- no git repository in the Harness home -----------------------------------------------------------------
HH2="$T/hh2"
mkdir -p "$HH2/gate" "$HH2/projects/demo"
cat >"$HH2/gate/config.json" <<EOF
{"repos":[{"key":"demo","match":"$T/r/demo","profile":"demo"}]}
EOF
printf '{"schema":2,"name":"demo","mode":"full"}\n' >"$HH2/projects/demo/profile.json"
out="$(RUN_HH="$HH2" run "$SET" -C "$T/r/demo" --expect null --set "$GOOD" 2>"$T/err")"
rc=$?
check "no git in the Harness home: exit 0" [ "$rc" -eq 0 ]
check "no git in the Harness home: written" [ "$(field "$HH2/projects/demo/profile.json")" = "$GOOD" ]
check "no git in the Harness home: a warning line in stderr" grep -q "^profile-set: warning: " "$T/err"
check "no git in the Harness home: no repository made" [ ! -e "$HH2/.git" ]

# --- the same value again: nothing written, nothing committed --------------------------------------------
fp="$(run "$SET" -C "$T/r/demo" --read | json_get fingerprint)"
cp "$PJ" "$T/pj-before"
before_commits="$(commits)"
out="$(run "$SET" -C "$T/r/demo" --expect "$fp" --set "$OTHER" 2>"$T/err")"
rc=$?
check "same value: exit 0" [ "$rc" -eq 0 ]
check "same value: written false" [ "$(json_get written <<<"$out")" = false ]
check "same value: the fingerprint is the current one" [ "$(json_get fingerprint <<<"$out")" = "$fp" ]
check "same value: profile.json byte for byte as it was" cmp -s "$PJ" "$T/pj-before"
check "same value: no commit" [ "$(commits)" -eq "$before_commits" ]

# --- a staged file of someone else stays out of the commit ------------------------------------------------
git -C "$HH" add -A && git -C "$HH" -c user.name=t -c user.email=t@t commit -q -m sync
printf '# demo rules, edited\n' >"$HH/projects/demo/rules.md"
git -C "$HH" add projects/demo/rules.md
fp="$(run "$SET" -C "$T/r/demo" --read | json_get fingerprint)"
out="$(run "$SET" -C "$T/r/demo" --expect "$fp" --set "$GOOD" 2>"$T/err")"
rc=$?
check "staged file of someone else: exit 0" [ "$rc" -eq 0 ]
check "staged file of someone else: the commit holds profile.json only" [ "$(git -C "$HH" show --name-only --format= HEAD)" = "projects/demo/profile.json" ]
check "staged file of someone else: still staged after the write" [ "$(git -C "$HH" diff --cached --name-only)" = "projects/demo/rules.md" ]
git -C "$HH" -c user.name=t -c user.email=t@t commit -q -m rules

# --- "pipeline": null reads as no field -------------------------------------------------------------------
node -e 'const f=process.argv[1],fs=require("fs"),p=JSON.parse(fs.readFileSync(f,"utf8")); p.workflow.pipeline=null; fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$PJ"
out="$(run "$SET" -C "$T/r/demo" --read 2>"$T/err")"
rc=$?
check "pipeline null: --read exit 0" [ "$rc" -eq 0 ]
check "pipeline null: fingerprint null" [ "$(json_get fingerprint <<<"$out")" = null ]
check "pipeline null: resolved is the default Pipeline" [ "$(json_get resolved <<<"$out")" = "$DEFAULT" ]
out="$(run "$SET" -C "$T/r/demo" --expect null --set "$OTHER" 2>"$T/err")"
rc=$?
check "pipeline null: --expect null writes (exit 0)" [ "$rc" -eq 0 ]
check "pipeline null: --expect null writes the value" [ "$(field "$PJ")" = "$OTHER" ]

# --- the lock ---------------------------------------------------------------------------------------------
LOCKDIR="$HH/projects/demo/.profile-set.lock"
check "lock: no lock folder left after the writes" [ ! -e "$LOCKDIR" ]
# A live lock of another writer: this one waits, gives up with exit 6 and writes nothing.
fp="$(run "$SET" -C "$T/r/demo" --read | json_get fingerprint)"
cp "$PJ" "$T/pj-before"
mkdir "$LOCKDIR"
PROFILE_SET_LOCK_WAIT_MS=300 run "$SET" -C "$T/r/demo" --expect "$fp" --set "$GOOD" >/dev/null 2>"$T/err"
rc=$?
check "held lock: exit 6" [ "$rc" -eq 6 ]
check "held lock: says another writer holds it" grep -q "another profile-set is writing" "$T/err"
check "held lock: profile.json as it was" cmp -s "$PJ" "$T/pj-before"
check "held lock: the other writer's lock is left alone" [ -d "$LOCKDIR" ]
# The lock is released while this writer waits: it goes on and writes.
( sleep 0.5; rmdir "$LOCKDIR" ) &
releaser=$!
run "$SET" -C "$T/r/demo" --expect "$fp" --set "$GOOD" >/dev/null 2>"$T/err"
rc=$?
wait "$releaser"
check "lock released while waiting: exit 0" [ "$rc" -eq 0 ]
check "lock released while waiting: written" [ "$(field "$PJ")" = "$GOOD" ]
# A lock a killed writer left long ago is removed.
mkdir "$LOCKDIR" && touch -t 202001010000 "$LOCKDIR"
fp="$(run "$SET" -C "$T/r/demo" --read | json_get fingerprint)"
PROFILE_SET_LOCK_WAIT_MS=300 run "$SET" -C "$T/r/demo" --expect "$fp" --set "$OTHER" >/dev/null 2>"$T/err"
rc=$?
check "stale lock: exit 0" [ "$rc" -eq 0 ]
check "stale lock: written" [ "$(field "$PJ")" = "$OTHER" ]
check "stale lock: no lock folder left" [ ! -e "$LOCKDIR" ]
check "usage names exit 6" grep -q "6 another write held the lock" <(run "$SET" 2>&1)

# A stale lock two waiters see at once. Both judge it stale; one takes it over first and holds it
# through its commit; then the other tries its takeover. The spec: the second takeover leaves the
# first one's lock alone (its token is still in it while it commits), waits for it instead of writing
# beside it, and then gets exit 5, since both read the same Pipeline. Which writer goes first is set
# by events, not by pauses: each writer has a PROFILE_SET_STALE_SYNC folder where profile-set puts its
# token in `judged`, waits for `go` and creates `tried`; the stub git creates `in-commit` and waits
# for `release`. A machine under load only makes each step later, never changes the order.
# wait_for <file>: up to 15 s for the file to appear; 1 when it does not.
wait_for() {
    local i=0
    while [ ! -e "$1" ]; do
        i=$((i + 1))
        [ "$i" -gt 300 ] && return 1
        sleep 0.05
    done
}
# two_waiters <name> <first|second: which writer takes over first> <seconds the second one starts late>
two_waiters() {
    local name="$1" winner="$2" late="$3" s="$T/sync" s1 s2 sw sl vw v1 v2 pid1 pid2="" pidl rc1 rc2 rcw rcl owner_mid loser_waits
    # A signal that never comes: one named FAIL, both writers let go and waited for, no lock left behind.
    give_up() {
        bad "$name: $1 never came"
        touch "$s1/go" "$s2/go" "$s/release"
        wait "$pid1"
        [ -n "$pid2" ] && wait "$pid2"
        rm -rf "$LOCKDIR"
    }
    s1="$s/1"
    s2="$s/2"
    rm -rf "$s"
    mkdir -p "$s1" "$s2"
    v1='[{"kind":"queued"},{"kind":"agent-review"},{"kind":"done"}]'
    v2='[{"kind":"queued"},{"kind":"ci"},{"kind":"agent-review"},{"kind":"done"}]'
    mkdir "$LOCKDIR" && printf 'dead-writer' >"$LOCKDIR/owner" && touch -t 202001010000 "$LOCKDIR/owner" "$LOCKDIR"
    fp="$(run "$SET" -C "$T/r/demo" --read | json_get fingerprint)"
    PATH="$SLOW:$PATH" PROFILE_SET_STALE_SYNC="$s1" PROFILE_SET_LOCK_WAIT_MS=60000 \
        run "$SET" -C "$T/r/demo" --expect "$fp" --set "$v1" >"$T/out1" 2>"$T/err1" &
    pid1=$!
    wait_for "$s1/judged" || { give_up "the first writer's judged"; return; }
    (
        sleep "$late"
        PATH="$SLOW:$PATH" PROFILE_SET_STALE_SYNC="$s2" PROFILE_SET_LOCK_WAIT_MS=60000 \
            run "$SET" -C "$T/r/demo" --expect "$fp" --set "$v2" >"$T/out2" 2>"$T/err2"
    ) &
    pid2=$!
    wait_for "$s2/judged" || { give_up "the second writer's judged"; return; }
    if [ "$winner" = first ]; then sw="$s1" sl="$s2" vw="$v1" pidl=$pid2; else sw="$s2" sl="$s1" vw="$v2" pidl=$pid1; fi
    touch "$sw/go"
    wait_for "$s/in-commit" || { give_up "in-commit of the first to take over"; return; }
    touch "$sl/go"
    wait_for "$sl/tried" || { give_up "tried of the other writer"; return; }
    owner_mid="$(cat "$LOCKDIR/owner" 2>/dev/null || echo none)"
    # The other one cannot end while the holder's commit is held: it waits for the lock.
    loser_waits=false
    kill -0 "$pidl" 2>/dev/null && loser_waits=true
    touch "$s/release"
    wait "$pid1"
    rc1=$?
    wait "$pid2"
    rc2=$?
    if [ "$winner" = first ]; then rcw=$rc1 rcl=$rc2; else rcw=$rc2 rcl=$rc1; fi
    check "$name: the first writer judged the lock stale" [ -s "$s1/judged" ]
    check "$name: the second writer judged the lock stale" [ -s "$s2/judged" ]
    check "$name: the second takeover leaves the first writer's lock, with its token, while it commits" [ "$owner_mid" = "$(cat "$sw/judged" 2>/dev/null)" ]
    check "$name: the other waits while the lock is held" "$loser_waits"
    check "$name: the first to take over writes (exit 0)" [ "$rcw" -eq 0 ]
    check "$name: the other, from the same read, gets exit 5 after it" [ "$rcl" -eq 5 ]
    check "$name: the file holds the value of the first to take over" [ "$(field "$PJ")" = "$vw" ]
    check "$name: no lock folder and no set-aside folder left" [ -z "$(ls -A "$HH/projects/demo" | grep "^\.profile-set\.lock")" ]
}
if $RUN_GIT_STUB; then
    SLOW="$T/slow"
    mkdir -p "$SLOW"
    cat >"$SLOW/git" <<EOF
#!/usr/bin/env bash
for a in "\$@"; do
    if [ "\$a" = commit ]; then
        touch "$T/sync/in-commit"
        i=0
        while [ ! -e "$T/sync/release" ] && [ "\$i" -lt 600 ]; do i=\$((i + 1)); sleep 0.05; done
    fi
done
exec "$REAL_GIT" "\$@"
EOF
    chmod +x "$SLOW/git"
    # The writer that judged first waits; the one that came second takes over first (the order the
    # flaky version meant to set up with pauses).
    two_waiters "stale lock, two waiters" second 0
    # The writer that judged first also takes over first.
    two_waiters "stale lock, two waiters, the first to judge takes over first" first 0
    # The second writer starts 3 s late, as on a loaded machine: the outcome is the same.
    two_waiters "stale lock, two waiters, the second starts 3 s late" second 3
fi

# --- two writers from the same read: the second one gets exit 5, not a lost write ------------------------
fp="$(run "$SET" -C "$T/r/demo" --read | json_get fingerprint)"
# Writer A starts first and is slow to send its value: it gets it only after writer B has saved. The
# second of sleep gives A the time to do whatever it does before reading stdin; A's outcome must not
# depend on it.
( while [ ! -e "$T/b-done" ]; do sleep 0.1; done; printf '%s' "$GOOD" ) | run "$SET" -C "$T/r/demo" --expect "$fp" --set - >"$T/outA" 2>"$T/errA" &
writer_a=$!
sleep 1
B='[{"kind":"queued"},{"kind":"ci"},{"kind":"done"}]'
run "$SET" -C "$T/r/demo" --expect "$fp" --set "$B" >/dev/null 2>"$T/errB"
rc_b=$?
touch "$T/b-done"
wait "$writer_a"
rc_a=$?
check "two writers: the first to send its value writes (exit 0)" [ "$rc_b" -eq 0 ]
check "two writers: the second gets exit 5" [ "$rc_a" -eq 5 ]
check "two writers: the file holds the first writer's value" [ "$(field "$PJ")" = "$B" ]
check "two writers: the second learns the new fingerprint" [ "$(json_get fingerprint <"$T/outA")" = "$(run "$SET" -C "$T/r/demo" --read | json_get fingerprint)" ]
check "two writers: no lock folder left" [ ! -e "$LOCKDIR" ]

# --- a Harness home inside another git repository gets no commit -----------------------------------------
OUTER="$T/outer"
HH3="$OUTER/hh3"
mkdir -p "$HH3/gate" "$HH3/projects/demo"
git -C "$OUTER" init -q -b main
printf 'x\n' >"$OUTER/readme"
git -C "$OUTER" add readme && git -C "$OUTER" -c user.name=t -c user.email=t@t commit -q -m init
cat >"$HH3/gate/config.json" <<EOF
{"repos":[{"key":"demo","match":"$T/r/demo","profile":"demo"}]}
EOF
printf '{"schema":2,"name":"demo","mode":"full"}\n' >"$HH3/projects/demo/profile.json"
out="$(RUN_HH="$HH3" run "$SET" -C "$T/r/demo" --expect null --set "$GOOD" 2>"$T/err")"
rc=$?
check "Harness home inside another repository: exit 0" [ "$rc" -eq 0 ]
check "Harness home inside another repository: written" [ "$(field "$HH3/projects/demo/profile.json")" = "$GOOD" ]
check "Harness home inside another repository: a warning line in stderr" grep -q "^profile-set: warning: " "$T/err"
check "Harness home inside another repository: no commit in the outer repository" [ "$(git -C "$OUTER" rev-list --count HEAD)" -eq 1 ]
check "Harness home inside another repository: nothing staged there" [ -z "$(git -C "$OUTER" diff --cached --name-only)" ]

home_after="$(real_home_snapshot "$REAL_HOME")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" [ "$home_before" = "$home_after" ]
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
