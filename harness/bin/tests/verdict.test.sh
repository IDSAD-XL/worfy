#!/usr/bin/env bash
# Tests of bin/verdict: the script that prints a reviewer's answer from its verdict line on, the
# lead-in before it dropped (the rule is lib/verdict.cjs):
#   - every case of the shared fixtures (fixtures/verdict/cases.json, which the worfy app's copy of the
#     rule and the eval grader rejected-first read too): a verdict prints the answer from its line on,
#     exit code 0; no verdict prints nothing, exit code 1 with the reason on stderr;
#   - a lead-in sentence, then REJECTED on the next line: the output starts with REJECTED;
#   - VERIFIED inside a sentence later in the text is no verdict;
#   - stdin with no argument and with `-`; a file with CRLF line ends keeps them;
#   - usage and exit codes: two arguments and a missing file are exit code 2, --help is exit code 0.
# Run: bash harness/bin/tests/verdict.test.sh; exit code 0 means everything passed.
# BIN_DIR points it at another copy of bin/ (a mutant of the script).
#
# Everything lives in a temporary directory, HOME included; at the end the test compares the real
# ~/.claude (the Harness parts) with a snapshot taken before the run.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
V="$BIN/verdict"
FIXTURES="$(dirname "$0")/fixtures/verdict/cases.json"
REAL_HOME="$HOME"
. "$(dirname "$0")/real-home.sh"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home"
mkdir -p "$HOME"

# run <args...> — stdout -> $T/out, stderr -> $T/err, sets rc
run() { "$V" "$@" >"$T/out" 2>"$T/err"; rc=$?; }

# --- 0. The script is there and executable ---------------------------------------------------------
[ -f "$V" ] && [ -x "$V" ] && ok "bin/verdict exists and is executable" || bad "bin/verdict is missing or not executable"
# Windows keeps no executable bit on disk: there the mode recorded in git is the only one.
mode="$(git -C "$HARNESS" ls-files -s -- bin/verdict 2>/dev/null | cut -c1-6)"
if [ "$BIN" != "$HARNESS/bin" ] || [ -z "$mode" ]; then echo "skip the mode in git: not the tracked copy"
elif [ "$mode" = 100755 ]; then ok "git records bin/verdict as executable (100755)"
else bad "git records bin/verdict as $mode, not 100755"; fi

# --- 1. The shared fixtures ------------------------------------------------------------------------
# Each case goes to $T/case-<n>.answer, and what the script must print to $T/case-<n>.want (absent for
# no verdict); $T/cases lists "<n> <name>" lines.
node -e '
const fs = require("fs")
const { cases } = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const out = []
cases.forEach((c, n) => {
  fs.writeFileSync(`${process.argv[2]}/case-${n}.answer`, c.answer)
  if (c.verdict !== null) fs.writeFileSync(`${process.argv[2]}/case-${n}.want`, c.text.endsWith("\n") ? c.text : `${c.text}\n`)
  out.push(`${n} ${c.name}`)
})
fs.writeFileSync(`${process.argv[2]}/cases`, `${out.join("\n")}\n`)
' "$FIXTURES" "$T" || bad "the fixtures cannot be read: $FIXTURES"
cases=0
while IFS=' ' read -r n name; do
    cases=$((cases + 1))
    run "$T/case-$n.answer"
    if [ -f "$T/case-$n.want" ]; then
        [ "$rc" = 0 ] && cmp -s "$T/out" "$T/case-$n.want" && [ ! -s "$T/err" ] \
            && ok "fixture: $name" || bad "fixture: $name: rc=$rc out=[$(cat "$T/out")] err=[$(cat "$T/err")]"
    else
        [ "$rc" = 1 ] && [ ! -s "$T/out" ] && grep -q 'no line starts with VERIFIED or REJECTED' "$T/err" \
            && ok "fixture, no verdict: $name" || bad "fixture, no verdict: $name: rc=$rc out=[$(cat "$T/out")]"
    fi
done <"$T/cases"
[ "$cases" -ge 20 ] && ok "the fixtures hold $cases cases" || bad "the fixtures hold only $cases cases"

# --- 2. The cases of the owner's decision, written here too -----------------------------------------
printf '%s\n' "This confirms a clear discrepancy." "" "REJECTED: node --test exits 1, the report says 0" "- src/sum.mjs:3: [high] sum subtracts" >"$T/lead-in.md"
run "$T/lead-in.md"
[ "$rc" = 0 ] && [ "$(head -n 1 "$T/out")" = "REJECTED: node --test exits 1, the report says 0" ] && [ "$(wc -l <"$T/out" | tr -d ' ')" = 2 ] \
    && ok "a lead-in sentence, then REJECTED: the output starts with REJECTED, the lead-in dropped" || bad "a lead-in sentence, then REJECTED: rc=$rc out=[$(cat "$T/out")]"
printf '%s\n' "Ran node --test: exit 0." "Every claim was VERIFIED by re-running it." >"$T/sentence.md"
run "$T/sentence.md"
[ "$rc" = 1 ] && [ ! -s "$T/out" ] && ok "VERIFIED inside a sentence later in the text: no verdict, exit code 1" || bad "VERIFIED inside a sentence: rc=$rc out=[$(cat "$T/out")]"

# --- 3. stdin and line ends ------------------------------------------------------------------------
"$V" <"$T/lead-in.md" >"$T/out" 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && [ "$(head -n 1 "$T/out")" = "REJECTED: node --test exits 1, the report says 0" ] && ok "stdin with no argument" || bad "stdin with no argument: rc=$rc"
"$V" - <"$T/lead-in.md" >"$T/out" 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && [ "$(head -n 1 "$T/out")" = "REJECTED: node --test exits 1, the report says 0" ] && ok "stdin with -" || bad "stdin with -: rc=$rc"
printf 'Lead-in.\r\nVERIFIED\r\nRan: node --test, exit 0.\r\n' >"$T/crlf.md"
run "$T/crlf.md"
printf 'VERIFIED\r\nRan: node --test, exit 0.\r\n' >"$T/crlf.want"
[ "$rc" = 0 ] && cmp -s "$T/out" "$T/crlf.want" && ok "CRLF line ends are kept" || bad "CRLF line ends: rc=$rc"
printf 'VERIFIED' >"$T/no-end.md"
run "$T/no-end.md"
[ "$rc" = 0 ] && [ "$(cat "$T/out")" = VERIFIED ] && [ "$(wc -c <"$T/out" | tr -d ' ')" = 9 ] && ok "an answer without a line end gets one" || bad "an answer without a line end: rc=$rc"

# --- 4. Usage and exit codes -----------------------------------------------------------------------
run "$T/lead-in.md" "$T/sentence.md"
[ "$rc" = 2 ] && grep -q '^usage: verdict' "$T/err" && [ ! -s "$T/out" ] && ok "two arguments: exit code 2 and the usage" || bad "two arguments: rc=$rc"
run "$T/missing.md"
[ "$rc" = 2 ] && grep -q 'cannot read' "$T/err" && ok "a missing file: exit code 2 and the reason" || bad "a missing file: rc=$rc err=[$(cat "$T/err")]"
run --help
[ "$rc" = 0 ] && grep -q '^usage: verdict' "$T/out" && ok "--help: exit code 0 and the usage on stdout" || bad "--help: rc=$rc"

# --- 5. The real ~/.claude is untouched ------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude did not change" || bad "the real ~/.claude changed during the test"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
