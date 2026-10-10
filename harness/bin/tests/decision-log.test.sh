#!/usr/bin/env bash
# Tests of bin/decision-log (worfy-review ticket 06): the script that appends one decision of a wave
# that runs without a human to a TSV file, `time_utc<TAB>decision<TAB>why<TAB>evidence`.
#   - the first row creates the file, its folders and the header line; later rows are appended and
#     the earlier bytes stay as they were;
#   - a tab, a line break or another control character inside a value becomes a space, so every row
#     has exactly four fields; quotes and backslashes are written as they are;
#   - an empty decision or reason is a usage error; a missing or empty evidence is written as `-`;
#   - a value longer than 2000 characters is cut to 2000, counted in characters, not bytes;
#   - a path with a space and Cyrillic letters, absolute or relative;
#   - a file that is not a decision log is refused and left as it was;
#   - several processes that write to one file at once: one header, every row whole.
# Run: bash harness/bin/tests/decision-log.test.sh; exit code 0 means everything passed.
# BIN_DIR points it at another copy of bin/ (a mutant of the script).
#
# Everything lives in a temporary directory, HOME and HARNESS_HOME included. At the end the test
# compares the real ~/.claude (the Harness parts) and ~/.claude/worfy-harness with a snapshot taken
# before the run.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
DL="$BIN/decision-log"
REAL_HOME="$HOME"
. "$(dirname "$0")/real-home.sh"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" HARNESS_HOME="$T/hh"
mkdir -p "$HOME"
TAB=$'\t'
HEADER="time_utc${TAB}decision${TAB}why${TAB}evidence"
TIME_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

# run <args...> — the script as a skill calls it; stdout -> $T/out, stderr -> $T/err, sets rc
run() { "$DL" "$@" >"$T/out" 2>"$T/err"; rc=$?; }
line() { sed -n "${2}p" "$1"; }                          # line <file> <number>
lines() { wc -l <"$1" | tr -d ' '; }
last() { tail -n 1 "$1" | cut -f2-; }                   # the last row without its time
# four_fields <file> — every line has exactly four tab-separated fields
four_fields() { [ "$(awk -F'\t' 'NF != 4' "$1" | wc -l | tr -d ' ')" = 0 ]; }

# --- 0. The script is there and executable ---------------------------------------------------------
[ -f "$DL" ] && [ -x "$DL" ] && ok "bin/decision-log exists and is executable" || bad "bin/decision-log is missing or not executable"
# Windows keeps no executable bit on disk: there the mode recorded in git is the only one.
mode="$(git -C "$HARNESS" ls-files -s -- bin/decision-log 2>/dev/null | cut -c1-6)"
if [ "$BIN" != "$HARNESS/bin" ] || [ -z "$mode" ]; then echo "skip the mode in git: not the tracked copy"
elif [ "$mode" = 100755 ]; then ok "git records bin/decision-log as executable (100755)"
else bad "git records bin/decision-log as $mode, not 100755"; fi

# --- 1. Usage ------------------------------------------------------------------------------------
F="$T/usage/decisions.tsv"
run
[ "$rc" -eq 2 ] && grep -q '^usage: decision-log <file> <decision> <why> \[<evidence>\]' "$T/err" && [ ! -s "$T/out" ] \
    && ok "no arguments: exit 2 and the usage line on stderr" || bad "no arguments: rc=$rc, stderr '$(head -c 200 "$T/err")'"
run "$F"
[ "$rc" -eq 2 ] && [ ! -e "$F" ] && ok "only the file: exit 2, nothing created" || bad "only the file: rc=$rc"
run "$F" "a decision"
[ "$rc" -eq 2 ] && [ ! -e "$F" ] && ok "no reason: exit 2, nothing created" || bad "no reason: rc=$rc"
run "$F" ticket 05 taken out
[ "$rc" -eq 2 ] && [ ! -e "$F" ] && grep -q 'quote' "$T/err" \
    && ok "five arguments (unquoted text): exit 2, nothing created, the message says to quote" || bad "five arguments: rc=$rc, stderr '$(head -c 200 "$T/err")'"
run --help
[ "$rc" -eq 0 ] && grep -q '^usage: decision-log' "$T/out" && [ ! -s "$T/err" ] \
    && ok "--help: exit 0 and the usage on stdout" || bad "--help: rc=$rc"

# --- 2. The first row creates the file with its header ---------------------------------------------
# The place the epic-wave skill names: a folder of the Harness state on this machine.
F="$HARNESS_HOME/runs/demo/checkout-wave-20261010T101500Z/decisions.tsv"
# A time zone 14 hours ahead of UTC: a script that wrote the local time would be far off.
TZ=Pacific/Kiritimati run "$F" "ticket 05 taken out of the wave" "second REJECTED, a leaf ticket" "PR #12, the last comment"
[ "$rc" -eq 0 ] && [ ! -s "$T/out" ] && [ ! -s "$T/err" ] && ok "first row: exit 0, nothing printed" || bad "first row: rc=$rc, stderr '$(head -c 200 "$T/err")'"
[ -f "$F" ] && ok "first row: the file and its folders are created" || bad "first row: no file $F"
[ "$(line "$F" 1)" = "$HEADER" ] && ok "first row: line 1 is the header" || bad "first row: line 1 is '$(line "$F" 1)'"
[ "$(lines "$F")" = 2 ] && ok "first row: two lines, each ended by a line feed" || bad "first row: $(lines "$F") lines"
[ "$(line "$F" 2 | cut -f2-)" = "ticket 05 taken out of the wave${TAB}second REJECTED, a leaf ticket${TAB}PR #12, the last comment" ] \
    && ok "first row: decision, reason and evidence as given" || bad "first row: '$(line "$F" 2)'"
stamp="$(line "$F" 2 | cut -f1)"
[[ "$stamp" =~ $TIME_RE ]] && ok "first row: the time is YYYY-MM-DDTHH:MM:SSZ" || bad "first row: time '$stamp'"
node -e 'process.exit(Math.abs(Date.now() - Date.parse(process.argv[1])) < 120000 ? 0 : 1)' "$stamp" \
    && ok "first row: the time is UTC whatever the time zone" || bad "first row: time '$stamp' is not the current UTC time"
# The bytes: the header first (no byte order mark), no carriage return anywhere.
[ "$(head -c 8 "$F")" = time_utc ] && ok "the file starts with the header, no byte order mark" || bad "the file starts with '$(head -c 8 "$F")'"
[ "$(tr -d '\r' <"$F" | wc -c | tr -d ' ')" = "$(wc -c <"$F" | tr -d ' ')" ] && ok "line ends are LF, no carriage return" || bad "the file has carriage returns"
[ "$(ls -A "$(dirname "$F")")" = decisions.tsv ] && ok "nothing but the log is left in its folder" || bad "the folder holds: $(ls -A "$(dirname "$F")" | tr '\n' ' ')"

# --- 3. The second row is appended; the first stays ------------------------------------------------
cp "$F" "$T/first.tsv"
size="$(wc -c <"$F" | tr -d ' ')"
run "$F" "merge order: 07 before 05" "05 changes the file 07 rewrites" "gh pr view 31 --json files"
[ "$rc" -eq 0 ] && [ "$(lines "$F")" = 3 ] && ok "second row: appended as the third line" || bad "second row: rc=$rc, $(lines "$F") lines"
head -c "$size" "$F" | cmp -s - "$T/first.tsv" && ok "second row: the earlier bytes are unchanged" || bad "second row: the header or the first row changed"
[ "$(last "$F")" = "merge order: 07 before 05${TAB}05 changes the file 07 rewrites${TAB}gh pr view 31 --json files" ] \
    && ok "second row: its three values" || bad "second row: '$(tail -n 1 "$F")'"
[ "$(grep -c '^time_utc' "$F")" = 1 ] && ok "second row: still one header" || bad "second row: $(grep -c '^time_utc' "$F") headers"

# --- 4. Tabs, line breaks and other control characters become spaces --------------------------------
run "$F" "a${TAB}b" $'line one\nline two' $'x\r\ny'
[ "$rc" -eq 0 ] && [ "$(lines "$F")" = 4 ] && ok "control characters: one more line, not several" || bad "control characters: rc=$rc, $(lines "$F") lines"
[ "$(last "$F")" = "a b${TAB}line one line two${TAB}x  y" ] && ok "a tab, a line feed and a carriage return are spaces" || bad "control characters: '$(tail -n 1 "$F" | od -c | head -n 4)'"
four_fields "$F" && ok "every line has exactly four fields" || bad "a line with another number of fields: $(awk -F'\t' 'NF != 4 {print NR": "NF}' "$F" | tr '\n' ' ')"
# NEL and the Unicode line and paragraph separators break a line for some readers too.
run "$F" $'next\xc2\x85line' $'line\xe2\x80\xa8separator' $'paragraph\xe2\x80\xa9separator'
[ "$rc" -eq 0 ] && [ "$(last "$F")" = "next line${TAB}line separator${TAB}paragraph separator" ] \
    && ok "NEL, U+2028 and U+2029 are spaces" || bad "Unicode line breaks: '$(tail -n 1 "$F")'"
run "$F" "  padded  " "${TAB}tabs around${TAB}" $'\nevidence\n'
[ "$rc" -eq 0 ] && [ "$(last "$F")" = "padded${TAB}tabs around${TAB}evidence" ] && ok "white space around a value is cut" || bad "padding: '$(tail -n 1 "$F")'"

# --- 5. Quotes and backslashes are written as they are ---------------------------------------------
run "$F" 'said "no" to it' "\"starts with a quote, isn't closed" 'C:\Users\x\new "a b".txt'
[ "$rc" -eq 0 ] && [ "$(last "$F")" = "said \"no\" to it${TAB}\"starts with a quote, isn't closed${TAB}C:\\Users\\x\\new \"a b\".txt" ] \
    && ok "double quotes, an apostrophe and backslashes are kept byte for byte" || bad "quotes: '$(tail -n 1 "$F")'"
four_fields "$F" && ok "quotes: still four fields in every line" || bad "quotes: a line with another number of fields"

# --- 6. Empty values --------------------------------------------------------------------------------
cp "$F" "$T/before-empty.tsv"
run "$F" "" "a reason"
[ "$rc" -eq 2 ] && grep -q '<decision> is empty' "$T/err" && ok "an empty decision: exit 2" || bad "an empty decision: rc=$rc, stderr '$(head -c 200 "$T/err")'"
run "$F" "a decision" "  ${TAB} "
[ "$rc" -eq 2 ] && grep -q '<why> is empty' "$T/err" && ok "a reason of white space only: exit 2" || bad "a blank reason: rc=$rc, stderr '$(head -c 200 "$T/err")'"
run "" "a decision" "a reason"
[ "$rc" -eq 2 ] && grep -q '<file> is empty' "$T/err" && ok "an empty file name: exit 2" || bad "an empty file name: rc=$rc"
cmp -s "$F" "$T/before-empty.tsv" && ok "empty values: nothing is written" || bad "empty values: the file changed"
E="$T/empty/decisions.tsv"
run "$E" "" "a reason"
[ "$rc" -eq 2 ] && [ ! -e "$E" ] && [ ! -e "$T/empty" ] && ok "an empty decision: no file and no folder is created" || bad "an empty decision created $E"
run "$F" "no evidence given" "a reason"
[ "$rc" -eq 0 ] && [ "$(last "$F")" = "no evidence given${TAB}a reason${TAB}-" ] && ok "no evidence: the field is '-'" || bad "no evidence: '$(tail -n 1 "$F")'"
run "$F" "empty evidence" "a reason" ""
[ "$rc" -eq 0 ] && [ "$(last "$F")" = "empty evidence${TAB}a reason${TAB}-" ] && ok "an empty evidence: the field is '-'" || bad "an empty evidence: '$(tail -n 1 "$F")'"
run "$F" "blank evidence" "a reason" $' \n '
[ "$rc" -eq 0 ] && [ "$(last "$F")" = "blank evidence${TAB}a reason${TAB}-" ] && ok "an evidence of white space only: the field is '-'" || bad "a blank evidence: '$(tail -n 1 "$F")'"
four_fields "$F" && ok "empty evidence: still four fields in every line" || bad "empty evidence: a line with another number of fields"

# --- 7. Values that are too long -------------------------------------------------------------------
# rep <text> <times>
rep() { node -e 'process.stdout.write(process.argv[1].repeat(Number(process.argv[2])))' "$1" "$2"; }
# The last row's fields 2-4 against the expected values, compared in node: the lengths are counted in
# characters whatever the locale of the shell.
# expect_last <file> <js expression that gives [decision, why, evidence]>
expect_last() {
    node -e '
        const rows = require("node:fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)
        const got = rows[rows.length - 1].split("\t").slice(1)
        const want = eval(process.argv[2])
        const same = got.length === want.length && got.every((v, i) => v === want[i])
        if (!same) console.log(`lengths ${got.map((v) => Array.from(v).length)} want ${want.map((v) => Array.from(v).length)}; ends ${got.map((v) => JSON.stringify(v.slice(-4)))}`)
        process.exit(same ? 0 : 1)' "$1" "$2"
}
L="$T/long/decisions.tsv"
run "$L" "$(rep a 5000)" "$(rep b 2000)" "$(rep c 2001)"
[ "$rc" -eq 0 ] && [ "$(lines "$L")" = 2 ] && ok "long values: exit 0, one row" || bad "long values: rc=$rc, stderr '$(head -c 200 "$T/err")'"
why="$(expect_last "$L" '["a".repeat(1999) + "…", "b".repeat(2000), "c".repeat(1999) + "…"]')" \
    && ok "a value over 2000 characters is cut to 1999 and '…'; one of exactly 2000 is kept whole" || bad "long values: $why"
# Characters, not bytes: a Cyrillic letter is two bytes in UTF-8, an emoji is four bytes and two UTF-16 units.
run "$L" "$(rep ж 2000)" "$(rep ж 2500)" "$(rep a 1998)$(rep 😀 3)"
why="$(expect_last "$L" '["ж".repeat(2000), "ж".repeat(1999) + "…", "a".repeat(1998) + "😀…"]')" \
    && ok "the limit counts characters: Cyrillic is not cut early, an emoji is not cut in half" || bad "long values in Cyrillic and emoji: rc=$rc, $why"
four_fields "$L" && ok "long values: four fields in every line" || bad "long values: a line with another number of fields"

# --- 8. A path with a space and Cyrillic letters ------------------------------------------------------
P="$T/папка с пробелом/вложенная папка/журнал решений.tsv"
run "$P" "Ticket 07 выведен из Wave" "вторая REJECTED, высокая находка устояла" "PR #31 — комментарий verifier-а"
[ "$rc" -eq 0 ] && [ -f "$P" ] && ok "a path with a space and Cyrillic letters: the file is created there" || bad "Cyrillic path: rc=$rc, stderr '$(head -c 200 "$T/err")'"
[ "$(line "$P" 1)" = "$HEADER" ] && [ "$(last "$P")" = "Ticket 07 выведен из Wave${TAB}вторая REJECTED, высокая находка устояла${TAB}PR #31 — комментарий verifier-а" ] \
    && ok "Cyrillic values are written as given, in UTF-8" || bad "Cyrillic values: '$(tail -n 1 "$P")'"
[ "$(find "$T/папка с пробелом" -type f | wc -l | tr -d ' ')" = 1 ] && ok "a path with a space: one file, nothing beside it" || bad "a path with a space: $(find "$T/папка с пробелом" -type f | tr '\n' ' ')"
# A relative path is taken from the current directory.
( cd "$T/папка с пробелом" && "$DL" "ещё папка/decisions.tsv" "a decision" "a reason" >"$T/out" 2>"$T/err" ); rc=$?
[ "$rc" -eq 0 ] && [ "$(last "$T/папка с пробелом/ещё папка/decisions.tsv" 2>/dev/null)" = "a decision${TAB}a reason${TAB}-" ] \
    && ok "a relative path with a space and Cyrillic letters" || bad "a relative path: rc=$rc, stderr '$(head -c 200 "$T/err")'"

# --- 9. A file that is not a decision log is refused ---------------------------------------------------
N="$T/notes.md"
printf '# Notes\n\nStatus: open\n' >"$N"; cp "$N" "$T/notes.copy"
run "$N" "a decision" "a reason"
[ "$rc" -eq 1 ] && grep -q 'not a decision log' "$T/err" && ok "another file: exit 1 and the reason on stderr" || bad "another file: rc=$rc, stderr '$(head -c 200 "$T/err")'"
cmp -s "$N" "$T/notes.copy" && ok "another file: left as it was" || bad "another file: it changed"
: >"$T/empty.tsv"
run "$T/empty.tsv" "a decision" "a reason"
[ "$rc" -eq 1 ] && [ ! -s "$T/empty.tsv" ] && ok "an existing empty file: exit 1, nothing written" || bad "an existing empty file: rc=$rc, size $(wc -c <"$T/empty.tsv")"
mkdir "$T/a-folder"
run "$T/a-folder" "a decision" "a reason"
[ "$rc" -eq 1 ] && [ -s "$T/err" ] && [ -z "$(ls -A "$T/a-folder")" ] && ok "a folder instead of a file: exit 1" || bad "a folder: rc=$rc"

# --- 10. Several processes write to one file at once -------------------------------------------------
# A module loaded before the script makes its file system slow: every call that changes a file waits
# first, and the first such call of a process also waits for a moment all the processes share. So
# every process has looked at the folder before any of them writes — the order in which a script
# that checks first and writes later goes wrong every time, not once in a hundred runs.
cat >"$T/slow-fs.js" <<'JS'
const fs = require("node:fs")
const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
const startAt = Number(process.env.SLOW_FS_START_AT || 0)
const delay = Number(process.env.SLOW_FS_DELAY_MS || 20)
let started = false
for (const name of ["linkSync", "openSync", "writeSync", "writeFileSync", "appendFileSync", "renameSync", "copyFileSync", "symlinkSync"]) {
    const real = fs[name]
    fs[name] = function (...args) {
        if (!started) { started = true; sleep(startAt - Date.now()) }
        sleep(delay)
        return real.apply(this, args)
    }
}
JS
# race <file> <processes> <rows per process> <step> — every process appends its rows one after another.
# Each call that changes a file waits 20 ms plus <step> ms for every process before this one: with
# step 0 the processes go through their steps together, with a step the later ones still create the
# file when the first ones have already written their rows.
race() {
    local file="$1" procs="$2" rows="$3" step="$4" p
    local at; at="$(node -e 'console.log(Date.now() + 1500)')"
    for p in $(seq 1 "$procs"); do
        ( for r in $(seq 1 "$rows"); do
              SLOW_FS_START_AT="$at" SLOW_FS_DELAY_MS="$((20 + step * (p - 1)))" node -r "$T/slow-fs.js" "$DL" "$file" \
                  "process $p row $r" "the reason of process $p row $r" "evidence $p.$r" || echo "process $p row $r: exit $?"
          done ) >>"$T/race.out" 2>&1 &
    done
    wait
}
# race_ok <what> <file> <rows expected>
race_ok() {
    local what="$1" file="$2" want="$3" expected
    [ ! -s "$T/race.out" ] && ok "$what: every process exits 0 and prints nothing" || bad "$what: $(head -n 3 "$T/race.out" | tr '\n' ' ')"
    [ "$(line "$file" 1)" = "$HEADER" ] && [ "$(grep -c '^time_utc' "$file")" = 1 ] \
        && ok "$what: one header, and it is the first line" || bad "$what: $(grep -c '^time_utc' "$file") headers, line 1 '$(line "$file" 1)'"
    [ "$(lines "$file")" = "$((want + 1))" ] && four_fields "$file" && ok "$what: $want rows, four fields each" || bad "$what: $(lines "$file") lines"
    expected="$(for p in $(seq 1 "$PROCS"); do for r in $(seq 1 "$ROWS"); do echo "process $p row $r${TAB}the reason of process $p row $r${TAB}evidence $p.$r"; done; done | sort)"
    [ "$(tail -n +2 "$file" | cut -f2- | sort)" = "$expected" ] && ok "$what: every row is whole and written once" || bad "$what: the rows differ from what was written"
    [ "$(ls -A "$(dirname "$file")")" = decisions.tsv ] && ok "$what: no temporary file is left" || bad "$what: the folder holds $(ls -A "$(dirname "$file")" | tr '\n' ' ')"
}
# A file that does not exist yet: who creates it and who writes the header. Once with the processes
# in step, once with each next process slower than the one before.
: >"$T/race.out"; PROCS=5 ROWS=1
race "$T/race-together/decisions.tsv" "$PROCS" "$ROWS" 0
race_ok "a new file, 5 processes in step" "$T/race-together/decisions.tsv" 5
: >"$T/race.out"; PROCS=5 ROWS=1
race "$T/race-staggered/decisions.tsv" "$PROCS" "$ROWS" 15
race_ok "a new file, 5 processes, each slower than the one before" "$T/race-staggered/decisions.tsv" 5
# Three rows from each process, the first of them into a file that does not exist yet.
: >"$T/race.out"; PROCS=4 ROWS=3
R="$T/race-rows/decisions.tsv"
race "$R" "$PROCS" "$ROWS" 0
race_ok "4 processes, 3 rows each" "$R" 12

# --- 11. The epic-wave skill: where the log lives and how it is written -------------------------------
# The block of skills/epic-wave/SKILL.md that names the log of a wave and writes its first row, cut
# out of the skill and run the way an agent runs it — under bash and under zsh (the Bash tool of
# Claude Code runs zsh on macOS). The profile is replaced by a stub F; the plugin root is a folder
# with the script under test in bin/. EPIC_WAVE_FILE points at another copy of the skill.
EW="${EPIC_WAVE_FILE:-$HARNESS/skills/epic-wave/SKILL.md}"
block="$(awk '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,"bin/decision-log")) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$EW" \
    | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"')"
[ -n "$block" ] && ok "epic-wave: a bash block calls bin/decision-log" || bad "epic-wave: no bash block with bin/decision-log in $EW"
block="${block//<epic>/checkout}"
STUB='F() { case "$1" in _resolved.name) echo demo ;; *) return 4 ;; esac; }'
mkdir -p "$T/plugin/bin" && cp "$DL" "$T/plugin/bin/decision-log" 2>/dev/null
STAMP_RE='^checkout-wave-[0-9]{8}T[0-9]{6}Z$'
# skill_block <name> <shell> <state folder, or "" for none> <home> — runs the block with HARNESS_HOME
# set to the state folder or unset, checks the path it prints and the file at that path.
skill_block() {
    local what="$1" sh="$2" state="$3" home="$4" runs out log
    mkdir -p "$home"
    if [ -n "$state" ]; then
        runs="$state/runs"
        out="$(HOME="$home" HARNESS_HOME="$state" CLAUDE_PLUGIN_ROOT="$T/plugin" "$sh" -c "$STUB"$'\n'"$block" 2>&1)"
    else
        runs="$home/.claude/worfy-harness/runs"
        out="$(env -u HARNESS_HOME HOME="$home" CLAUDE_PLUGIN_ROOT="$T/plugin" "$sh" -c "$STUB"$'\n'"$block" 2>&1)"
    fi
    log="$(printf '%s\n' "$out" | tail -n 1)"
    [[ "$out" == *"EXIT=0"* ]] && [[ "$log" == "$runs/demo/checkout-wave-"*"/decisions.tsv" ]] && [[ "$(basename "$(dirname "$log")")" =~ $STAMP_RE ]] \
        && ok "$what: exit 0, the path printed is <state folder>/runs/<project>/<epic>-wave-<UTC time>/decisions.tsv" \
        || bad "$what: output '${out:0:300}'"
    [ "$(line "$log" 1 2>/dev/null)" = "$HEADER" ] && [ "$(last "$log" 2>/dev/null)" = "<decision>${TAB}<why>${TAB}<evidence>" ] && [ "$(lines "$log" 2>/dev/null)" = 2 ] \
        && ok "$what: the file at that path holds the header and the row" || bad "$what: no log with one row at '$log'"
}
for sh in bash zsh; do
    # Git Bash on Windows has no zsh; on macOS and Linux the contract test of these scripts requires it.
    if ! command -v "$sh" >/dev/null 2>&1; then echo "skip the skill block under $sh: not installed"; continue; fi
    skill_block "epic-wave block under $sh, HARNESS_HOME set" "$sh" "$T/state of $sh" "$T/home-a-$sh"
    # Without HARNESS_HOME the state folder is ~/.claude/worfy-harness; the home has a space in its name.
    skill_block "epic-wave block under $sh, no HARNESS_HOME" "$sh" "" "$T/home of $sh"
done

# The rule itself, whole sentences: a changed word inside one changes the rule. The text is wrapped,
# so a section is searched with its line breaks folded into spaces.
section() { awk -v re="^## $2\\\\." '$0 ~ re {p=1; next} /^## /{p=0} p' "$1" | tr '\n' ' ' | tr -s ' '; }    # section <file> <number>
s1="$(section "$EW" 1)"; s5="$(section "$EW" 5)"
# has <name> <section text> <sentence>
has() { [[ "$2" == *"$3"* ]] && ok "epic-wave $1" || bad "epic-wave $1 — missing: $3"; }
has "section 1: the log is kept by a wave without a human" "$s1" '**The decision log of a wave without a human** (worfy Autopilot).'
has "section 1: every decision made without the owner gets a row, outside the repository" "$s1" \
    'So every decision made without the owner gets a row in a file of that run, `decisions.tsv`, in the Harness state folder of the machine, outside the repository.'
has "section 1: the file is named once, the plan is its first row" "$s1" 'Name the file once, when the plan table is ready, and write the plan as its first row:'
has "section 1: later rows use the printed path, not the variable" "$s1" \
    'Every later row is the `decision-log` line of that block with the printed path written out in place of `$LOG`: a shell variable does not live until the next command, and a second `date` would name another file.'
has "section 1: only the script writes the file" "$s1" '`decision-log` creates the file with its header and its folders, and only appends; do not create or edit the file any other way.'
has "section 1: a row for the plan and for a ticket that is not dispatched" "$s1" \
    '- the plan — which tickets go into the wave and in which order — and each ticket that is not dispatched, with the reason;'
has "section 1: a row for a fork settled for the owner" "$s1" '- a fork the owner decides, settled by the recommended option (section 2);'
has "section 1: a row for a dismissed finding" "$s1" '- a finding put into Dismissed (section 3);'
has "section 1: a row for a narrow round and for a ticket taken out of the wave" "$s1" '- a narrow round given or refused, and a ticket taken out of the wave (section 3);'
has "section 1: a row for a merge order that differs from the plan" "$s1" '- the order of the merges when it differs from the plan (section 4).'
has "section 1: what the three values are" "$s1" \
    '`<decision>` says what was decided and names the ticket; `<why>` is the reason in one sentence; `<evidence>` is what can be opened or run to check it — a PR comment, a `file:line`, a command with its exit code — and is left out when there is none.'
has "section 1: no secrets in a row" "$s1" 'No secret goes into a row — a token, a password, a key: the same rule as for a profile.'
has "section 1: a wrong row is corrected by a new one" "$s1" 'A wrong row is corrected by a new row.'
has "section 1: a row that cannot be written does not stop the wave" "$s1" \
    'If `EXIT` is not 0 or the command is refused, the wave goes on and the report says that the log could not be written.'
has "section 1: the log is not a state file" "$s1" 'The log is not a state file: it is not committed, and a resumed wave does not read it — it starts a file of its own.'
has "section 1: a session with a human needs no log" "$s1" 'A session with a human needs no log.'
has "section 5: the report is compared with the log" "$s5" \
    'Before the report is written, compare the two: every decision the report shows — a `blocked` row, a narrow round, a ticket that was not dispatched, a Dismissed finding, a fork settled for the owner, a merge out of the plan'"'"'s order — has its row in the log'
has "section 5: a missing row is added with the mark, written rows are not edited" "$s5" \
    'A decision without a row gets one now, and its `<why>` starts with `added at reconciliation: `; the rows already written are not edited.'
has "section 5: the report names the log between the groups and the status block" "$s5" \
    'Then one line goes between the groups of findings and the status block: `Decision log: <path>`, or `Decision log: not written — <reason>`.'
# No word in capitals for emphasis in the two rules; EXIT is the word of the bash block.
rules_text="$(awk '/^\*\*The decision log of a wave without a human\*\*/{p=1} /^\*\*A wave without a human names its decision log\*\*/{p=1} /^```bash/{c=1} p && !c; /^```$/{c=0} p && /(needs no|not written — <reason>`\.)$/{p=0}' "$EW" | tr '\n' ' ')"
caps="$(perl -e 'my %ok = map { $_ => 1 } qw(EXIT); my $t = shift; while ($t =~ /(?<![A-Z])([A-Z]{4,})(?![A-Z])/g) { print "$1 " unless $ok{$1} }' "$rules_text")"
[ -n "$rules_text" ] && [ -z "$caps" ] && ok "epic-wave: the two rules have no word in capitals" || bad "epic-wave: the rules are not found or have a word in capitals: $caps"

# --- the real home -----------------------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
