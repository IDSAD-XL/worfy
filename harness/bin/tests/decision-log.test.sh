#!/usr/bin/env bash
# Tests of bin/decision-log: the script that appends one decision of a wave
# that runs without a human to a TSV file, `time_utc<TAB>decision<TAB>why<TAB>evidence`.
#   - the first row creates the file, its folders and the header line; later rows are appended and
#     the earlier bytes stay as they were;
#   - a tab, a line break or another control character inside a value becomes a space, so every row
#     has exactly four fields; quotes and backslashes are written as they are;
#   - an empty decision or reason is a usage error; a missing or empty evidence is written as `-`;
#   - a value longer than 2000 characters is cut to 2000, counted in characters, not bytes;
#   - a path with a space and Cyrillic letters, absolute or relative;
#   - a file that is not a decision log is refused and left as it was;
#   - a last line that lost its line feed is not glued to the new row;
#   - several processes that write to one file at once: one header, every row whole — with the
#     order of their steps set by the test, and once more on a volume without hard links;
#   - the block of skills/epic-wave that names the log and writes its first row: run under bash and
#     zsh, with the words of the skill's call in place of $0…$9, with values that hold commands, and
#     with no project name; the sentences of the skill's two rules.
# Run: bash harness/bin/tests/decision-log.test.sh; exit code 0 means everything passed.
# BIN_DIR points it at another copy of bin/ (a mutant of the script); EPIC_WAVE_FILE at another
# copy of the skill.
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

# --- 10. A last line that lost its line feed -------------------------------------------------------
# A write cut short (a full disk, a killed process) leaves the last row without its line feed. The
# next row must not be glued to it.
C="$T/cut/decisions.tsv"; mkdir -p "$T/cut"
printf '%s\n%s' "$HEADER" "2026-10-10T08:15:00Z${TAB}a cut row${TAB}its reason${TAB}-" >"$C"
run "$C" "the next row" "a reason" "evidence"
[ "$rc" -eq 0 ] && [ "$(lines "$C")" = 3 ] && four_fields "$C" && ok "a last line without a line feed: the new row starts a line of its own" \
    || bad "a last line without a line feed: rc=$rc, $(lines "$C") lines, fields per line: $(awk -F'\t' '{printf "%s ", NF}' "$C")"
[ "$(line "$C" 2)" = "2026-10-10T08:15:00Z${TAB}a cut row${TAB}its reason${TAB}-" ] && [ "$(last "$C")" = "the next row${TAB}a reason${TAB}evidence" ] \
    && ok "a last line without a line feed: both rows are whole" || bad "a last line without a line feed: line 2 '$(line "$C" 2)', line 3 '$(line "$C" 3)'"
run "$C" "one more row" "a reason"
[ "$rc" -eq 0 ] && [ "$(lines "$C")" = 4 ] && [ "$(grep -c '^$' "$C")" = 0 ] && ok "a file that ends with a line feed gets no empty line" \
    || bad "a file that ends with a line feed: $(lines "$C") lines, $(grep -c '^$' "$C") empty"

# --- 11. Several processes write to one file at once -------------------------------------------------
# The order of the steps of two processes is set by the test, not by chance or by delays. A module
# loaded before the script (node -r) splits every way of writing a file into the steps the system
# itself takes — open (the name appears), write, close — and stops a process at the moment named by
# SYNC_PAUSE_AT:
#   checked — before the first call of the process that changes anything: it has looked, not written;
#   created — right after the log's name came to exist through this process;
#   writing — right before this process's first write into a log that was there when it opened it;
#   wrote   — right after that write.
# A stopped process creates <SYNC_DIR>/<SYNC_ROLE>.paused and goes on when <SYNC_DIR>/<SYNC_ROLE>.go
# appears. The orders set below make four kinds of script go wrong on every run, whatever the load
# of the machine: one that looks first and creates the log later; one that shows the log's name
# before the header is in it; one that works out where its row goes, or what the whole file will
# be, before it writes; one that writes a row in two parts. The module stops only the synchronous
# calls of fs: a script that wrote through fs.promises or a stream would pass the stops, and any
# other fault is met only by the round without a set order, by chance.
# SYNC_NO_LINK=1 makes a hard link fail the way a volume without hard links does.
cat >"$T/sync-fs.js" <<'JS'
const fs = require("node:fs")
const path = require("node:path")
const real = {}
for (const name of ["openSync", "writeSync", "closeSync", "linkSync", "renameSync", "existsSync", "readFileSync", "writeFileSync"]) real[name] = fs[name]
const log = process.env.SYNC_LOG ? path.resolve(process.env.SYNC_LOG) : null
const isLog = (p) => log !== null && typeof p === "string" && path.resolve(p) === log
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const seen = new Set()
const at = (event) => {
    if (seen.has(event)) return
    seen.add(event)
    if (process.env.SYNC_PAUSE_AT !== event) return
    const base = path.join(process.env.SYNC_DIR, process.env.SYNC_ROLE)
    real.writeFileSync(base + ".paused", "")
    for (let i = 0; i < 6000 && !real.existsSync(base + ".go"); i++) sleep(5)
    if (!real.existsSync(base + ".go")) process.stderr.write(`sync-fs: ${process.env.SYNC_ROLE} was never told to go on\n`)
}
const forWriting = (flags) => !(flags === undefined || flags === "r" || flags === "rs" || flags === fs.constants.O_RDONLY)
let logFd = null
let logWasThere = false
fs.openSync = function (p, flags, mode) {
    if (!forWriting(flags)) return real.openSync(p, flags, mode)
    at("checked")
    const there = real.existsSync(p)
    const fd = real.openSync(p, flags, mode)
    if (isLog(p)) {
        logFd = fd
        logWasThere = there
        if (!there) at("created")
    }
    return fd
}
fs.writeSync = function (fd, ...rest) {
    at("checked")
    if (fd === logFd && logWasThere) at("writing")
    const written = real.writeSync(fd, ...rest)
    if (fd === logFd && logWasThere) at("wrote")
    return written
}
fs.closeSync = function (fd) {
    if (fd === logFd) logFd = null
    return real.closeSync(fd)
}
const writeWhole = (defaultFlag) => function (p, data, options) {
    const o = options && typeof options === "object" ? options : {}
    const fd = fs.openSync(p, o.flag || defaultFlag, o.mode)
    try {
        fs.writeSync(fd, data)
    } finally {
        fs.closeSync(fd)
    }
}
fs.writeFileSync = writeWhole("w")
fs.appendFileSync = writeWhole("a")
fs.copyFileSync = function (from, to, mode = 0) {
    const fd = fs.openSync(to, mode & fs.constants.COPYFILE_EXCL ? "wx" : "w")
    try {
        fs.writeSync(fd, real.readFileSync(from))
    } finally {
        fs.closeSync(fd)
    }
}
fs.linkSync = function (from, to) {
    at("checked")
    if (process.env.SYNC_NO_LINK) throw Object.assign(new Error("ENOTSUP: operation not supported, link"), { code: "ENOTSUP", syscall: "link" })
    real.linkSync(from, to)
    if (isLog(to)) at("created")
}
fs.renameSync = function (from, to) {
    at("checked")
    const there = real.existsSync(to)
    real.renameSync(from, to)
    if (isLog(to) && !there) at("created")
}
JS
scene=0
# two <name> <event> <whose row is written first: first|second> <file> <rows already in the file> [no-link]
# — the first process stops at <event>, the second runs to its end, then the first goes on. The
# earlier rows and both new ones must be there, in the order they were written.
two() {
    local what="$1" event="$2" order="$3" file="$4" earlier="$5" nolink="${6:-}" dir i=0 rc1 rc2 expected
    local row1="the process that stops${TAB}the reason of the first${TAB}evidence 1" row2="the process that runs through${TAB}the reason of the second${TAB}evidence 2"
    scene=$((scene + 1)); dir="$T/sync-$scene"; mkdir -p "$dir"
    ( SYNC_DIR="$dir" SYNC_ROLE=first SYNC_PAUSE_AT="$event" SYNC_LOG="$file" SYNC_NO_LINK="$nolink" \
          node -r "$T/sync-fs.js" "$DL" "$file" "the process that stops" "the reason of the first" "evidence 1" >"$dir/first.out" 2>&1
      echo "$?" >"$dir/first.rc" ) &
    until [ -e "$dir/first.paused" ] || [ -e "$dir/first.rc" ] || [ "$i" -ge 1200 ]; do i=$((i + 1)); sleep 0.05; done
    [ -e "$dir/first.paused" ] && ok "$what: the first process stops at '$event'" \
        || bad "$what: the first process never reached '$event' (exit $(cat "$dir/first.rc" 2>/dev/null), output '$(head -c 200 "$dir/first.out")')"
    SYNC_DIR="$dir" SYNC_ROLE=second SYNC_PAUSE_AT="" SYNC_LOG="$file" SYNC_NO_LINK="$nolink" \
        node -r "$T/sync-fs.js" "$DL" "$file" "the process that runs through" "the reason of the second" "evidence 2" >"$dir/second.out" 2>&1
    rc2=$?
    : >"$dir/first.go"
    wait
    rc1="$(cat "$dir/first.rc" 2>/dev/null)"
    [ "$rc1" = 0 ] && [ "$rc2" = 0 ] && [ ! -s "$dir/first.out" ] && [ ! -s "$dir/second.out" ] && ok "$what: both processes exit 0 and print nothing" \
        || bad "$what: exit ${rc1:-none} and $rc2; first '$(head -c 200 "$dir/first.out")', second '$(head -c 200 "$dir/second.out")'"
    [ "$(line "$file" 1)" = "$HEADER" ] && [ "$(grep -c '^time_utc' "$file")" = 1 ] \
        && ok "$what: one header, and it is the first line" || bad "$what: $(grep -c '^time_utc' "$file") headers, line 1 '$(line "$file" 1)'"
    expected="$([ -z "$earlier" ] || printf '%s\n' "$earlier"; if [ "$order" = first ]; then printf '%s\n%s\n' "$row1" "$row2"; else printf '%s\n%s\n' "$row2" "$row1"; fi)"
    [ "$(tail -n +2 "$file" | cut -f2-)" = "$expected" ] && four_fields "$file" \
        && ok "$what: every row is there, whole, once and in the order written (the $order process's row before the other's)" \
        || bad "$what: the file holds: $(tail -n +2 "$file" | cut -f2- | tr '\n' '|')"
    [ "$(ls -A "$(dirname "$file")")" = decisions.tsv ] && ok "$what: no temporary file is left" || bad "$what: the folder holds $(ls -A "$(dirname "$file")" | tr '\n' ' ')"
}
# The first process finds no log; before it creates one, the second creates the log and writes its row.
two "a log created by another process after the look" checked second "$T/sync-late/decisions.tsv" ""
# The second process comes while the first is creating the log: the name is there, is the header?
two "a log read while it is being created" created second "$T/sync-created/decisions.tsv" ""
# A log that exists. The first process is about to write its row — it has opened the log and worked
# out whatever it needs — when the second writes a whole row. A row written at a place found before
# the write, or as a new copy of the file read before it, wipes the second's row out.
W="$T/sync-writing/decisions.tsv"
run "$W" "an earlier row" "a reason" "evidence 0"
two "a row written by another process right before the write" writing second "$W" "an earlier row${TAB}a reason${TAB}evidence 0"
# The same log; the second process writes while the first is in the middle of its row.
S="$T/sync-rows/decisions.tsv"
run "$S" "an earlier row" "a reason" "evidence 0"
two "two rows written at the same time" wrote first "$S" "an earlier row${TAB}a reason${TAB}evidence 0"
# Without any set order: five processes at once, two rows each.
U="$T/at-once/decisions.tsv"
for p in 1 2 3 4 5; do
    ( for r in 1 2; do "$DL" "$U" "process $p row $r" "the reason of process $p row $r" "evidence $p.$r" || echo "process $p row $r: exit $?"; done ) >>"$T/at-once.out" 2>&1 &
done
wait
expected="$(for p in 1 2 3 4 5; do for r in 1 2; do echo "process $p row $r${TAB}the reason of process $p row $r${TAB}evidence $p.$r"; done; done | sort)"
[ ! -s "$T/at-once.out" ] && [ "$(line "$U" 1)" = "$HEADER" ] && [ "$(grep -c '^time_utc' "$U")" = 1 ] && four_fields "$U" \
    && [ "$(tail -n +2 "$U" | cut -f2- | sort)" = "$expected" ] && [ "$(ls -A "$(dirname "$U")")" = decisions.tsv ] \
    && ok "five processes at once, two rows each: one header, ten whole rows, nothing else in the folder" \
    || bad "five processes at once: output '$(head -c 200 "$T/at-once.out")', $(lines "$U") lines, $(grep -c '^time_utc' "$U") headers"

# --- 12. A volume without hard links -----------------------------------------------------------------
# The log is created through a hard link. Where the volume has none (exFAT, some network folders)
# the script creates the log directly, still without replacing a file that is already there.
X="$T/no-link/decisions.tsv"
SYNC_NO_LINK=1 SYNC_LOG="$X" SYNC_PAUSE_AT="" node -r "$T/sync-fs.js" "$DL" "$X" "the first row" "a reason" "evidence" >"$T/out" 2>"$T/err"; rc=$?
[ "$rc" -eq 0 ] && [ ! -s "$T/err" ] && [ "$(line "$X" 1)" = "$HEADER" ] && [ "$(last "$X")" = "the first row${TAB}a reason${TAB}evidence" ] && [ "$(lines "$X")" = 2 ] \
    && ok "no hard links: the log is created with its header and the row" || bad "no hard links: rc=$rc, stderr '$(head -c 200 "$T/err")', $(lines "$X" 2>/dev/null) lines"
[ "$(ls -A "$(dirname "$X")")" = decisions.tsv ] && ok "no hard links: no temporary file is left" || bad "no hard links: the folder holds $(ls -A "$(dirname "$X")" | tr '\n' ' ')"
# The first process finds no log and stops; the second creates it and writes; the first, whose link
# fails, must not write its header over what is there.
two "no hard links, a log created by another process after the look" checked second "$T/no-link-late/decisions.tsv" "" 1

# --- 13. The epic-wave skill: where the log lives and how it is written -------------------------------
# The block of skills/epic-wave/SKILL.md that names the log of a wave and writes its first row, cut
# out of the skill whole and run the way an agent runs it — under bash and under zsh (the Bash tool
# of Claude Code runs zsh on macOS), in a folder of its own, in a time zone 14 hours ahead of UTC.
# The plugin root is a folder with a space in its name; its bin/ holds the script under test and a
# stand-in for bin/profile. EPIC_WAVE_FILE points at another copy of the skill.
EW="${EPIC_WAVE_FILE:-$HARNESS/skills/epic-wave/SKILL.md}"
block="$(awk '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,"bin/decision-log")) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$EW")"
[ -n "$block" ] && ok "epic-wave: a bash block calls bin/decision-log" || bad "epic-wave: no bash block with bin/decision-log in $EW"
mkdir -p "$T/repo" "$T/cwd"
block="${block//<epic>/checkout}"; block="${block//<repo>/$T/repo}"
PLUGIN="$T/plugin root"
mkdir -p "$PLUGIN/bin" && cp "$DL" "$PLUGIN/bin/decision-log" 2>/dev/null
# The stand-in answers the two ways of asking the project's name; the name comes from STUB_PROJECT,
# and an empty one is a folder outside the registered projects (the real script prints nothing, exit 3).
cat >"$PLUGIN/bin/profile" <<'SH'
#!/bin/sh
[ "$1" = -C ] && [ -d "$2" ] || exit 2
case "$3 ${4:-}" in
    "--name "|"--field _resolved.name") [ -n "${STUB_PROJECT:-}" ] || exit 3; printf '%s\n' "$STUB_PROJECT" ;;
    *) exit 4 ;;
esac
SH
chmod +x "$PLUGIN/bin/profile"
export STUB_PROJECT=demo
STAMP_RE='^checkout-wave-[0-9]{8}T[0-9]{6}Z$'
# run_block <shell> <state folder, or "" for none> <home> <text> — sets out (the output) and log (its last line)
run_block() {
    local sh="$1" state="$2" home="$3" text="$4"
    mkdir -p "$home"
    if [ -n "$state" ]; then
        out="$(cd "$T/cwd" && TZ=Pacific/Kiritimati HOME="$home" HARNESS_HOME="$state" CLAUDE_PLUGIN_ROOT="$PLUGIN" "$sh" -c "$text" 2>&1)"
    else
        out="$(cd "$T/cwd" && env -u HARNESS_HOME TZ=Pacific/Kiritimati HOME="$home" CLAUDE_PLUGIN_ROOT="$PLUGIN" "$sh" -c "$text" 2>&1)"
    fi
    log="$(printf '%s\n' "$out" | tail -n 1)"
}
# block_ok <name> <folder the runs must land in> <the row expected> — checks out and log of the last run_block
block_ok() {
    local what="$1" runs="$2" row="$3" stamp
    stamp="$(basename "$(dirname "$log")")"
    [[ "$out" == *"EXIT=0"* ]] && [[ "$log" == "$runs/demo/checkout-wave-"*"/decisions.tsv" ]] && [[ "$stamp" =~ $STAMP_RE ]] \
        && ok "$what: exit 0, the path printed is <state folder>/runs/<project>/<epic>-wave-<time>/decisions.tsv" \
        || bad "$what: output '${out:0:300}'"
    node -e 'const m = /^checkout-wave-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(process.argv[1])
        process.exit(m && Math.abs(Date.now() - Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6])) < 120000 ? 0 : 1)' "$stamp" \
        && ok "$what: the time in the folder's name is UTC whatever the time zone" || bad "$what: '$stamp' is not the current UTC time"
    [ "$(line "$log" 1 2>/dev/null)" = "$HEADER" ] && [ "$(last "$log" 2>/dev/null)" = "$row" ] && [ "$(lines "$log" 2>/dev/null)" = 2 ] \
        && ok "$what: the file at that path holds the header and the row" || bad "$what: no log with the row at '$log': '$(tail -n 1 "$log" 2>/dev/null)'"
}
# Claude Code puts the words of the skill's call in place of $0…$9 anywhere in the skill's text, bash
# blocks included. The wave is called as "/worfy:epic-wave tickets 02, 06 of epic checkout".
called="$(printf '%s' "$block" | perl -pe 'BEGIN { @w = ("tickets", "02,", "06", "of", "epic", "checkout", "", "", "", "") } s/\$([0-9])/$w[$1]/g')"
# Values an agent may well write: a command in backquotes, a command substitution, a variable.
hostile="$(printf '%s' "$block" | D="the check \`touch $T/ran-backquote\` failed" W="\$(touch $T/ran-dollar) is the reason" E="\$HOME/notes.md:12" \
    perl -pe 's/<decision>/$ENV{D}/; s/<why>/$ENV{W}/; s/<evidence>/$ENV{E}/')"
# An apostrophe inside a value, written the way the skill says.
apostrophe="$(printf '%s' "$block" | W="it'\\''s the owner'\\''s call" perl -pe 's/<why>/$ENV{W}/')"
PLAIN_ROW="<decision>${TAB}<why>${TAB}<evidence>"
for sh in bash zsh; do
    # Git Bash on Windows has no zsh; on macOS and Linux the contract test of these scripts requires it.
    if ! command -v "$sh" >/dev/null 2>&1; then echo "skip the skill block under $sh: not installed"; continue; fi
    run_block "$sh" "$T/state of $sh" "$T/home-a-$sh" "$block"
    block_ok "epic-wave block under $sh, HARNESS_HOME set" "$T/state of $sh/runs" "$PLAIN_ROW"
    # Without HARNESS_HOME the state folder is ~/.claude/worfy-harness; the home has a space in its name.
    run_block "$sh" "" "$T/home of $sh" "$block"
    block_ok "epic-wave block under $sh, no HARNESS_HOME" "$T/home of $sh/.claude/worfy-harness/runs" "$PLAIN_ROW"
    run_block "$sh" "$T/called-$sh" "$T/home-b-$sh" "$called"
    block_ok "epic-wave block under $sh, with the words of the call in place of \$0…\$9" "$T/called-$sh/runs" "$PLAIN_ROW"
    run_block "$sh" "$T/hostile-$sh" "$T/home-c-$sh" "$hostile"
    block_ok "epic-wave block under $sh, values with backquotes, \$(…) and \$HOME" "$T/hostile-$sh/runs" \
        "the check \`touch $T/ran-backquote\` failed${TAB}\$(touch $T/ran-dollar) is the reason${TAB}\$HOME/notes.md:12"
    run_block "$sh" "$T/apostrophe-$sh" "$T/home-d-$sh" "$apostrophe"
    block_ok "epic-wave block under $sh, an apostrophe written as '\\''" "$T/apostrophe-$sh/runs" "<decision>${TAB}it's the owner's call${TAB}<evidence>"
    # No project name: no log, and the block says so.
    STUB_PROJECT=""; run_block "$sh" "$T/nameless-$sh" "$T/home-e-$sh" "$block"; STUB_PROJECT=demo
    [[ "$out" == *"no project name: the decision log is not kept"* ]] && [[ "$out" != *"EXIT="* ]] && [ ! -e "$T/nameless-$sh" ] \
        && ok "epic-wave block under $sh, no project name: no log is started, and the block says so" \
        || bad "epic-wave block under $sh, no project name: output '${out:0:300}', state folder: $(ls -A "$T/nameless-$sh" 2>/dev/null | tr '\n' ' ')"
done
[ ! -e "$T/ran-backquote" ] && [ ! -e "$T/ran-dollar" ] && ok "epic-wave block: a command inside a value is not run" || bad "epic-wave block: a command inside a value was run: $(ls "$T" | grep '^ran-' | tr '\n' ' ')"
[ -z "$(ls -A "$T/cwd")" ] && ok "epic-wave block: nothing is left in the folder it runs in" || bad "epic-wave block: left in the current folder: $(ls -A "$T/cwd" | tr '\n' ' ')"
[[ "$block" == *"\"\$LOG\" '<decision>' '<why>' '<evidence>'"* ]] && ok "epic-wave block: the three values stand in single quotes" || bad "epic-wave block: the values are not in single quotes"

# The two rules of the skill, the block included: each is the last text of its section, so it runs
# from its heading to the next section.
rules_all="$(awk '/^\*\*The decision log of a wave without a human\*\*/{p=1} /^\*\*A wave without a human names its decision log\*\*/{p=1} /^## /{p=0} p' "$EW")"
positional="$(printf '%s\n' "$rules_all" | grep -nE '\$[0-9]' | head -n 3 | tr '\n' ' ')"
[ -n "$rules_all" ] && [ -z "$positional" ] && ok "epic-wave: the two rules have no \$0…\$9 for Claude Code to replace" || bad "epic-wave: the rules are not found or hold a positional token: $positional"

# The rule itself, whole sentences: a changed word inside one changes the rule. The text is wrapped,
# so a section is searched with its line breaks folded into spaces.
section() { awk -v re="^## $2\\\\." '$0 ~ re {p=1; next} /^## /{p=0} p' "$1" | tr '\n' ' ' | tr -s ' '; }    # section <file> <number>
s1="$(section "$EW" 1)"; s5="$(section "$EW" 5)"
# has <name> <section text> <sentence>
has() { [[ "$2" == *"$3"* ]] && ok "epic-wave $1" || bad "epic-wave $1 — missing: $3"; }
has "section 1: the log is kept by a wave without a human" "$s1" '**The decision log of a wave without a human** (worfy Autopilot).'
has "section 1: what decides is the declined question, as for the narrow round" "$s1" \
    'What decides is the same as for the narrow round in section 3: a question to the owner is declined automatically; the wave then usually came as the Autopilot command.'
has "section 1: every decision made without the owner gets a row, outside the repository" "$s1" \
    'So every decision made without the owner gets a row in a file of that run, `decisions.tsv`, in the Harness state folder of the machine, outside the repository.'
has "section 1: the file is started when the sign shows, the plan is its first row" "$s1" \
    'Start the file at the moment that sign shows — with the plan table when the wave came as the Autopilot command, later when a question is declined only then — name it once, and write the plan as its first row:'
has "section 1: later rows use the printed path, not the variable" "$s1" \
    'Every later row is the `decision-log` line of that block with the printed path written out in place of `$LOG`: a shell variable does not live until the next command, and a second `date` would name another file.'
has "section 1: the values stay in single quotes" "$s1" \
    'The three values stay in single quotes, so the shell hands them to the script as written: a backquote or a `$` inside a value is neither run nor expanded.'
has "section 1: an apostrophe inside a value" "$s1" 'An apostrophe inside a value is written as `'"'\\''"'`.'
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
has "section 1: a log that cannot be started or written does not stop the wave" "$s1" \
    'If the project name comes out empty, `EXIT` is not 0 or the command is refused, the wave goes on without the log and the report says that it could not be written.'
has "section 1: the log is not a state file" "$s1" 'The log is not a state file: it is not committed, and a resumed wave does not read it — it starts a file of its own.'
has "section 1: a session with a human needs no log" "$s1" 'A session with a human needs no log.'
has "section 5: the report is compared with the log" "$s5" \
    'Before the report is written, compare the two: every decision the report shows — a `blocked` row, a narrow round, a ticket that was not dispatched, a Dismissed finding, a fork settled for the owner, a merge out of the plan'"'"'s order — has its row in the log'
has "section 5: a missing row is added with the mark, written rows are not edited" "$s5" \
    'A decision without a row gets one now, and its `<why>` starts with `added at reconciliation: `; the rows already written are not edited.'
has "section 5: the report names the log between the groups and the status block" "$s5" \
    'Then one line goes between the groups of findings and the status block: `Decision log: <path>`, or `Decision log: not written — <reason>`.'
# No word in capitals for emphasis in the two rules; EXIT is the word of the bash block.
rules_text="$(printf '%s\n' "$rules_all" | awk '/^```bash/{c=1} !c; /^```$/{c=0}' | tr '\n' ' ')"
caps="$(perl -e 'my %ok = map { $_ => 1 } qw(EXIT); my $t = shift; while ($t =~ /(?<![A-Z])([A-Z]{4,})(?![A-Z])/g) { print "$1 " unless $ok{$1} }' "$rules_text")"
[ -n "$rules_text" ] && [ -z "$caps" ] && ok "epic-wave: the two rules have no word in capitals" || bad "epic-wave: the rules are not found or have a word in capitals: $caps"

# --- the real home -----------------------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
