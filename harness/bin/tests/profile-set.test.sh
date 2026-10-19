#!/usr/bin/env bash
# Tests of harness/bin/profile-set (worfy ADR-0073): it writes only workflow.pipeline of one project's
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

home_after="$(real_home_snapshot "$REAL_HOME")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" [ "$home_before" = "$home_after" ]
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
