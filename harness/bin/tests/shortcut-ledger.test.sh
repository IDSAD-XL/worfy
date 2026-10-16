#!/usr/bin/env bash
# Tests of bin/shortcut-ledger: the script that lists the `shortcut: <limit>, <when to redo>`
# comments of a git work tree as "<path>:<line>, <limit>, <when to redo>".
#   - a full comment gives a row with its limit and its condition; a comment with no condition
#     gives a row that ends in `no-trigger`; the count of both goes to stderr;
#   - `shortcut:` inside a quoted string of a test, inside markdown backticks or inside a shell
#     heredoc is not a comment; a comment after a string on the same line is one; a here-string
#     (`<<<`) and a heredoc operator inside quotes start no heredoc; `#` inside a word (`${#list}`)
#     starts no comment, nor does `#` glued to a closing quote;
#   - the comment forms `//`, `#`, `/* … */` (one line and a block of lines), `<!-- … -->`;
#   - the markers follow the language: `#` is code in JavaScript (`this.#field`), `//` is code in
#     Python (floor division), so neither hides the real comment after it;
#   - the comment is cut at its first comma, not at a later one;
#   - files: tracked and new ones, not the ones .gitignore excludes, not binary files; CRLF lines,
#     a heredoc in a CRLF shell script among them;
#     a path with a space and Cyrillic letters; paths relative to the directory given;
#   - usage and exit codes: no repository is exit code 1, two arguments are exit code 2.
# Run: bash harness/bin/tests/shortcut-ledger.test.sh; exit code 0 means everything passed.
# BIN_DIR points it at another copy of bin/ (a mutant of the script).
#
# The sample files are written with printf and quoted strings, never with a heredoc: so the
# samples of this test do not show up when the script lists the comments of this repository.
# Everything lives in a temporary directory, HOME included; at the end the test compares the real
# ~/.claude (the Harness parts) with a snapshot taken before the run.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
SL="$BIN/shortcut-ledger"
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
run() { "$SL" "$@" >"$T/out" 2>"$T/err"; rc=$?; }
# expect_out <name> <want> — stdout of the last run is exactly <want>
expect_out() {
    local got; got="$(cat "$T/out")"
    [ "$got" = "$2" ] && ok "$1" || bad "$1"$'\n'"--- got:"$'\n'"$got"$'\n'"--- want:"$'\n'"$2"
}
# put <path> <line>... — writes the lines to <path> in the sample repository, LF line ends
put() { local f="$R/$1"; shift; mkdir -p "$(dirname "$f")"; printf '%s\n' "$@" >"$f"; }

# --- 0. The script is there and executable ---------------------------------------------------------
[ -f "$SL" ] && [ -x "$SL" ] && ok "bin/shortcut-ledger exists and is executable" || bad "bin/shortcut-ledger is missing or not executable"
# Windows keeps no executable bit on disk: there the mode recorded in git is the only one.
mode="$(git -C "$HARNESS" ls-files -s -- bin/shortcut-ledger 2>/dev/null | cut -c1-6)"
if [ "$BIN" != "$HARNESS/bin" ] || [ -z "$mode" ]; then echo "skip the mode in git: not the tracked copy"
elif [ "$mode" = 100755 ]; then ok "git records bin/shortcut-ledger as executable (100755)"
else bad "git records bin/shortcut-ledger as $mode, not 100755"; fi

# --- 1. A sample repository ------------------------------------------------------------------------
R="$T/repo"
mkdir -p "$R"
git -C "$R" init -q
git -C "$R" config user.name test; git -C "$R" config user.email test@example.invalid
git -C "$R" config core.autocrlf false
put .gitignore 'node_modules/' 'out/'
# A full comment, and one with no condition; ordinary comments around them.
put src/format.js \
    'const join = (a, b) => a + b // shortcut: two formats only, redo when a third format appears' \
    '// a plain comment that mentions shortcut: in the middle' \
    '// shortcut: fix later' \
    '// shortcut: the limit,  redo when the first comma splits, not a later one'
# Python and shell comments; a comment after a string; `#` inside a word.
put src/tool.py \
    'x = 1  # shortcut: one locale, redo when a second locale ships' \
    'name = "a # shortcut: in a string, not a comment"' \
    'y = "z"  # shortcut: after a string, redo when strings get escapes' \
    'half = n // 2  # shortcut: floor division is code, redo when n is negative'
put src/field.js \
    'class C { #n = 0; inc() { this.#n++ } } // shortcut: one counter, redo when two are needed'
# A test that keeps sample comments in its strings — not one of them is a comment.
put test/format.test.js \
    "expect(row).toBe('// shortcut: in a single-quoted string, not a comment')" \
    'expect(row).toBe("# shortcut: in a double-quoted string, not a comment")' \
    'expect(row).toBe(`/* shortcut: in a template literal, not a comment */`)' \
    'expect(row).toBe("a \" // shortcut: after an escaped quote, still in the string")'
# Block comments: on one line, and a block of lines with ` * ` before the text.
put src/block.ts \
    '/* shortcut: no retries, redo when the network is flaky */ const a = 1' \
    '/**' \
    ' * The parser.' \
    ' * shortcut: ASCII only, redo when a name with accents arrives' \
    ' */' \
    'const b = 2 /* shortcut: */'
# Markdown: a sample in backticks is not a comment, an HTML comment is.
put docs/notes.md \
    'Mark it with `// shortcut: <limit>, <when to redo>` in code.' \
    '<!-- shortcut: one page, redo when the notes take two -->'
# A shell heredoc writes a sample file: its body is data, not a comment of this script.
put scripts/make.sh \
    '#!/usr/bin/env bash' \
    "cat >out.js <<'EOF'" \
    '// shortcut: in the heredoc body, not ours' \
    '# shortcut: in the heredoc body too, not ours' \
    'EOF' \
    '# shortcut: after the heredoc, redo when the script grows' \
    'cat <<-END' \
    $'\t# shortcut: in an indented heredoc, not ours' \
    $'\tEND' \
    'echo ${#list} $# # shortcut: no arrays of arrays, redo when one is needed' \
    'echo "cat <<EOF" # a heredoc operator inside quotes starts nothing' \
    '# shortcut: after a quoted heredoc operator, redo when it matters' \
    'tr a b <<<hello' \
    '# shortcut: after a here-string, redo when it matters' \
    'echo "word"# shortcut: glued to a word after its closing quote, not a comment'
# CRLF line ends: the condition does not keep the carriage return.
mkdir -p "$R/win"; printf '%s\r\n' 'x = 1 // shortcut: CRLF file, redo never' >"$R/win/crlf.js"
printf '%s\r\n' "cat <<'EOF'" '# shortcut: in a CRLF heredoc, not ours' 'EOF' '# shortcut: after a CRLF heredoc, redo never' >"$R/win/make.sh"
# A path with a space and Cyrillic letters.
put 'docs/папка с пробелом/e.js' '// shortcut: odd path, redo when paths are ASCII'
# Not read: an ignored folder and a binary file.
put node_modules/dep/index.js '// shortcut: in node_modules, not ours'
printf 'abc\0// shortcut: in a binary file, not ours\n' >"$R/src/blob.bin"
git -C "$R" add -A && git -C "$R" commit -qm samples
# A new file, not yet committed, is read too.
put src/new.js '// shortcut: new file, redo after the first commit'

FULL='docs/notes.md:2, one page, redo when the notes take two
docs/папка с пробелом/e.js:1, odd path, redo when paths are ASCII
scripts/make.sh:6, after the heredoc, redo when the script grows
scripts/make.sh:10, no arrays of arrays, redo when one is needed
scripts/make.sh:12, after a quoted heredoc operator, redo when it matters
scripts/make.sh:14, after a here-string, redo when it matters
src/block.ts:1, no retries, redo when the network is flaky
src/block.ts:4, ASCII only, redo when a name with accents arrives
src/block.ts:6, -, no-trigger
src/field.js:1, one counter, redo when two are needed
src/format.js:1, two formats only, redo when a third format appears
src/format.js:3, fix later, no-trigger
src/format.js:4, the limit, redo when the first comma splits, not a later one
src/new.js:1, new file, redo after the first commit
src/tool.py:1, one locale, redo when a second locale ships
src/tool.py:3, after a string, redo when strings get escapes
src/tool.py:4, floor division is code, redo when n is negative
win/crlf.js:1, CRLF file, redo never
win/make.sh:4, after a CRLF heredoc, redo never'

# --- 2. The whole repository -----------------------------------------------------------------------
(cd "$R" && "$SL" >"$T/out" 2>"$T/err"); rc=$?
[ "$rc" = 0 ] && ok "the current directory: exit code 0" || bad "the current directory: exit code $rc: $(cat "$T/err")"
expect_out "every shortcut comment, none from a string, a heredoc, backticks, node_modules or a binary file" "$FULL"
[ "$(cat "$T/err")" = "19 shortcut comments, 2 no-trigger" ] && ok "stderr counts the rows and the no-trigger rows" \
    || bad "stderr: [$(cat "$T/err")]"
grep -q $'\r' "$T/out" && bad "a carriage return in the output" || ok "no carriage return in the output"

run "$R"
[ "$rc" = 0 ] && ok "<dir> given: exit code 0" || bad "<dir> given: exit code $rc"
expect_out "<dir> given lists the same rows" "$FULL"

# --- 3. A subdirectory: paths relative to it -------------------------------------------------------
run "$R/src"
expect_out "a subdirectory: only its files, paths relative to it" 'block.ts:1, no retries, redo when the network is flaky
block.ts:4, ASCII only, redo when a name with accents arrives
block.ts:6, -, no-trigger
field.js:1, one counter, redo when two are needed
format.js:1, two formats only, redo when a third format appears
format.js:3, fix later, no-trigger
format.js:4, the limit, redo when the first comma splits, not a later one
new.js:1, new file, redo after the first commit
tool.py:1, one locale, redo when a second locale ships
tool.py:3, after a string, redo when strings get escapes
tool.py:4, floor division is code, redo when n is negative'

# --- 4. Nothing to list ----------------------------------------------------------------------------
E="$T/empty"; mkdir -p "$E"; git -C "$E" init -q
printf '%s\n' 'const a = 1 // no marker here' >"$E/a.js"
run "$E"
[ "$rc" = 0 ] && [ ! -s "$T/out" ] && [ "$(cat "$T/err")" = "0 shortcut comments, 0 no-trigger" ] \
    && ok "no shortcut comments: exit code 0, empty stdout, a zero count" || bad "no shortcut comments: rc=$rc out=[$(cat "$T/out")] err=[$(cat "$T/err")]"

# --- 5. Usage and errors ---------------------------------------------------------------------------
N="$T/not-a-repo"; mkdir -p "$N"
GIT_CEILING_DIRECTORIES="$T" run "$N"
[ "$rc" = 1 ] && grep -q 'git cannot list the files' "$T/err" && [ ! -s "$T/out" ] \
    && ok "not a git work tree: exit code 1 and the reason" || bad "not a git work tree: rc=$rc err=[$(cat "$T/err")]"
run "$R" "$R"
[ "$rc" = 2 ] && grep -q '^usage: shortcut-ledger' "$T/err" && ok "two arguments: exit code 2 and the usage" || bad "two arguments: rc=$rc"
run ""
[ "$rc" = 2 ] && ok "an empty <dir>: exit code 2" || bad "an empty <dir>: rc=$rc"
run --help
[ "$rc" = 0 ] && grep -q '^usage: shortcut-ledger' "$T/out" && ok "--help: exit code 0 and the usage on stdout" || bad "--help: rc=$rc"

# --- 6. The real ~/.claude is untouched ------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude did not change" || bad "the real ~/.claude changed during the test"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
