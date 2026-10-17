#!/usr/bin/env bash
# Tests of gh-stand-in.sh, on every OS: gh_guard refuses a gh on the shell's PATH that is not the stub and a
# program node would start for gh that is not the stand-in, and passes the accepted setup; node_stand_in runs
# the stub with its arguments. The fake programs only write a marker file: none of them is ever run, and no
# real gh is started (the guard looks programs up, it never runs them).
# Run: bash harness/bin/tests/gh-stand-in.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HERE/gh-stand-in.sh"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

# The stub and its stand-in, as the tests that use the guard set them up.
STUBS="$T/stubs"; mkdir -p "$STUBS"
printf '#!/usr/bin/env bash\necho "$*" >>"$STUB_LOG"\n' >"$STUBS/gh"; chmod +x "$STUBS/gh"
node_stand_in "$STUBS/gh" "$STUBS/gh.mjs"
export STUB_LOG="$T/stub.log"
# A fake "real gh": a gh script (and gh.exe, a copy of `true`, on Windows, where node looks for that name)
# that would only write a marker file. Another fake program for a wrong variable.
FAKE="$T/fake"; mkdir -p "$FAKE"
printf '#!/usr/bin/env bash\n: >"%s/marker"\n' "$T" >"$FAKE/gh"; chmod +x "$FAKE/gh"
on_windows && cp "$(type -P true)" "$FAKE/gh.exe"
cp "$FAKE/gh" "$FAKE/other"
BASE_PATH="$PATH"

# guarded <name> <PATH> <variable> <value or "">: gh_guard in a subshell with that PATH and variable;
# stdout and stderr go to $T/out, the exit code is returned.
guarded() {
    ( PATH="$2"; unset WAVE_GATE_GH TICKET_GH; [ -n "$4" ] && export "$3=$4"
      gh_guard "$3" "$STUBS/gh" "$STUBS/gh.mjs"; echo "guard passed" ) >"$T/out" 2>&1
}
refused() { # refused <name> <rc>: exit 1, a REFUSED line, the fake never ran
    if [ "$2" -eq 1 ] && grep -q '^REFUSED: ' "$T/out" && ! grep -q "guard passed" "$T/out" && [ ! -e "$T/marker" ]; then ok "$1"
    else bad "$1: exit $2, $(cat "$T/out"), marker $( [ -e "$T/marker" ] && echo written || echo none)"; fi
    rm -f "$T/marker"
}

# (a) a fake gh first on the shell's PATH, the variable set right: only the shell check can see it
guarded a "$FAKE:$STUBS:$BASE_PATH" WAVE_GATE_GH "$STUBS/gh.mjs"; rc=$?
refused "a gh on PATH ahead of the stub -> refused, the fake not run" "$rc"
grep -q "$FAKE/gh" "$T/out" && ok "the refusal names the gh it found" || bad "the refusal does not name $FAKE/gh: $(cat "$T/out")"
# (b) the stub first on PATH, the variable naming another program: only the node check can see it
guarded b "$STUBS:$BASE_PATH" WAVE_GATE_GH "$FAKE/other"; rc=$?
refused "WAVE_GATE_GH naming another program -> refused" "$rc"
# (c) the same with TICKET_GH, the variable ticket mark reads
guarded c "$STUBS:$BASE_PATH" TICKET_GH "$FAKE/other"; rc=$?
refused "TICKET_GH naming another program -> refused" "$rc"
# (d) the accepted setups: the variable naming the stand-in; and, where node can start the stub (not Windows),
# no variable with the stub first on PATH. On Windows no variable is refused: node would look up gh.exe.
guarded d "$STUBS:$BASE_PATH" WAVE_GATE_GH "$STUBS/gh.mjs"; rc=$?
[ "$rc" -eq 0 ] && grep -q "guard passed" "$T/out" && ok "WAVE_GATE_GH naming the stand-in, the stub first on PATH -> passes" || bad "accepted setup: exit $rc $(cat "$T/out")"
guarded d2 "$STUBS:$BASE_PATH" TICKET_GH "$STUBS/gh.mjs"; rc=$?
[ "$rc" -eq 0 ] && grep -q "guard passed" "$T/out" && ok "TICKET_GH naming the stand-in -> passes" || bad "accepted TICKET_GH: exit $rc $(cat "$T/out")"
guarded e "$STUBS:$BASE_PATH" WAVE_GATE_GH ""; rc=$?
if on_windows; then
    refused "no variable on Windows -> refused (node would start a gh.exe, never the stub)" "$rc"
else
    [ "$rc" -eq 0 ] && grep -q "guard passed" "$T/out" && ok "no variable, the stub first on PATH -> passes (node starts the stub)" || bad "no variable: exit $rc $(cat "$T/out")"
fi
# (e) a fake gh ahead of the stub and no variable: refused on every OS
guarded f "$FAKE:$STUBS:$BASE_PATH" WAVE_GATE_GH ""; rc=$?
refused "no variable, a fake gh ahead of the stub -> refused" "$rc"
# (g) no variable, and on Windows a refusing gh.exe (a copy of false) next to the stub: node's lookup of a bare gh
# finds that copy, which refuses, so the guard passes there too; "-" (a script with no override variable) the same
REF="$T/refusing"; mkdir -p "$REF"; cp "$STUBS/gh" "$REF/gh"; refusing_gh_exe "$REF/gh"
( PATH="$REF:$BASE_PATH"; unset WAVE_GATE_GH; gh_guard WAVE_GATE_GH "$REF/gh" "$REF/gh.mjs"; echo "guard passed" ) >"$T/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "guard passed" "$T/out" && ok "no variable, the stub (and on Windows its refusing gh.exe) first on PATH -> passes" || bad "refusing gh.exe: exit $rc $(cat "$T/out")"
( PATH="$REF:$BASE_PATH"; gh_guard - "$REF/gh" ""; echo "guard passed" ) >"$T/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q "guard passed" "$T/out" && ok "no override variable (-), the stub first on PATH -> passes" || bad "variable -: exit $rc $(cat "$T/out")"
( PATH="$FAKE:$REF:$BASE_PATH"; gh_guard - "$REF/gh" ""; echo "guard passed" ) >"$T/out" 2>&1; rc=$?
refused "no override variable (-), a fake gh ahead of the stub -> refused" "$rc"
# the guard leaves the credentials out: every token gh reads, and its config folder
( PATH="$STUBS:$BASE_PATH"; export WAVE_GATE_GH="$STUBS/gh.mjs" GH_TOKEN=secret GITHUB_TOKEN=secret GH_ENTERPRISE_TOKEN=secret GITHUB_ENTERPRISE_TOKEN=secret
  gh_guard WAVE_GATE_GH "$STUBS/gh" "$STUBS/gh.mjs"
  printf '%s|%s|%s|%s|%s\n' "${GH_TOKEN-unset}" "${GITHUB_TOKEN-unset}" "${GH_ENTERPRISE_TOKEN-unset}" "${GITHUB_ENTERPRISE_TOKEN-unset}" "${GH_CONFIG_DIR:-}" ) >"$T/out" 2>&1
[ "$(cat "$T/out")" = "unset|unset|unset|unset|$T/gh-config" ] \
    && ok "the guard unsets GH_TOKEN, GITHUB_TOKEN, GH_ENTERPRISE_TOKEN, GITHUB_ENTERPRISE_TOKEN and empties GH_CONFIG_DIR" || bad "credentials: $(cat "$T/out")"

# node_stand_in: the stand-in runs the stub with the arguments and its exit code; with STAND_IN_PARENTS it
# records the pid of the program that started it
printf '#!/usr/bin/env bash\necho "$*" >>"$STUB_LOG"\nexit 7\n' >"$STUBS/seven"; chmod +x "$STUBS/seven"
node_stand_in "$STUBS/seven" "$STUBS/seven.mjs"
: >"$STUB_LOG"
STAND_IN_PARENTS="$T/parents" node -e 'const r = require("child_process").spawnSync(process.execPath, [process.argv[1], "pr", "merge", "a b"], { stdio: "inherit" }); console.log("rc=" + r.status + " me=" + process.pid)' "$STUBS/seven.mjs" >"$T/out" 2>&1
[ "$(cat "$STUB_LOG")" = "pr merge a b" ] && grep -q "rc=7" "$T/out" && ok "the stand-in runs the stub with its arguments and exit code" || bad "stand-in: log [$(cat "$STUB_LOG")] out [$(cat "$T/out")]"
[ "me=$(head -n 1 "$T/parents" 2>/dev/null)" = "$(grep -o 'me=[0-9]*' "$T/out")" ] && ok "the stand-in records its parent's pid in STAND_IN_PARENTS" || bad "parents: $(cat "$T/parents" 2>/dev/null) vs $(cat "$T/out")"
# has_gh_word
words_ok=1
for s in 'gh x' 'execFileSync("gh", [' "execSync('gh pr view')" '/usr/bin/gh pr' 'gh.exe'; do has_gh_word "$s" || { words_ok=0; echo "  missed: $s"; }; done
for s in 'github headRefOid' 'ghost neigh' 'ghx run' 'xgh run'; do has_gh_word "$s" && { words_ok=0; echo "  wrongly matched: $s"; }; done
[ "$words_ok" = 1 ] && ok "has_gh_word: gh as a command, a quoted name, a path; not github, ghost, ghx" || bad "has_gh_word"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
