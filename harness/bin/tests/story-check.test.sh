#!/usr/bin/env bash
# Tests of bin/story-check: the check of a Code story (bin/TICKETS.md, sections "Code story" and "Story
# anchor") against the code of the PR's head, on the shared fixtures of bin/tests/fixtures/code-story.
#   - the story of a PR in English and in Russian and the story of an epic (a dropped handoff among its
#     handoffs) are green, exit code 0;
#   - a fragment that does not match the code, a step without a field, personal data in the story, a
#     header with a commit field and a handoff without `done:` are red, exit code 2, one line per
#     problem: "<story>:<step>: <what is wrong>"; personal data is printed masked;
#   - the anchor: a committed story is checked against HEAD of its branch, an uncommitted one (new or
#     changed) against the working tree, and the output names which; the main branch is refused unless
#     a commit is named; a branch merged without a rebase while the main branch shifted the quoted lines
#     is green on the branch's head; the documents PR that appends the review step checks against the
#     head that was merged (--head), not its own branch; the chapters of an epic story against the head
#     of each chapter's PR (--pr-head);
#   - what cannot be checked (no file, no git work tree, an unknown commit, a usage error) is exit code 1
#     with the reason.
# Run: bash harness/bin/tests/story-check.test.sh; exit code 0 means everything passed.
# BIN_DIR points it at another copy of bin/ (a mutant of the script).
#
# Personal values are put together from pieces ("/Us""ers/"…), so this file holds none of them whole.
# Everything lives in a temporary directory, HOME and the Harness home included; at the end the test
# compares the real ~/.claude (the Harness parts) with a snapshot taken before the run.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
SC="$BIN/story-check"
FIX="$(cd "$(dirname "$0")/fixtures/code-story" && pwd)"
REAL_HOME="$HOME"
. "$(dirname "$0")/real-home.sh"
# T in node's spelling (C:/… in Git Bash on Windows, pwd -P elsewhere).
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home"
export HARNESS_HOME="$T/hh"
mkdir -p "$HOME" "$HARNESS_HOME/user"
unset GITHUB_ACTIONS
# The script sees a stand-in host name, not this machine's (fixtures/fake-hostname.cjs).
export FAKE_HOSTNAME="story""-test-box"
FAKE_HOST_JS="$(cd "$(dirname "$0")/fixtures" && { pwd -W 2>/dev/null || pwd -P; })/fake-hostname.cjs"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require \"$FAKE_HOST_JS\""

# run <args...> — stdout -> $T/out, stderr -> $T/err, sets rc; runs in the sample repository.
run() { (cd "$R" && "$SC" "$@") >"$T/out" 2>"$T/err"; rc=$?; }
# has <file> <text> — the file holds the text as a fixed string.
has() { grep -qF -- "$2" "$1"; }
# line_has <prefix> <text>... — some line of stdout starts with <prefix> and holds every <text>.
line_has() {
    local prefix="$1" l t hit; shift
    while IFS= read -r l; do
        [[ "$l" == "$prefix"* ]] || continue
        hit=1
        for t in "$@"; do [[ "$l" == *"$t"* ]] || hit=0; done
        [ "$hit" = 1 ] && return 0
    done <"$T/out"
    return 1
}
show() { printf -- '--- rc=%s\n--- stdout:\n%s\n--- stderr:\n%s\n' "$rc" "$(cat "$T/out")" "$(cat "$T/err")"; }
check() { # <name> <condition result 0|1>
    if [ "$2" = 0 ]; then ok "$1"; else bad "$1"; show; fi
}

# --- 0. The script is there and executable ---------------------------------------------------------
[ -f "$SC" ] && [ -x "$SC" ] && ok "bin/story-check exists and is executable" || bad "bin/story-check is missing or not executable"
# Windows keeps no executable bit on disk: there the mode recorded in git is the only one.
mode="$(git -C "$HARNESS" ls-files -s -- bin/story-check 2>/dev/null | cut -c1-6)"
if [ "$BIN" != "$HARNESS/bin" ] || [ -z "$mode" ]; then echo "skip the mode in git: not the tracked copy"
elif [ "$mode" = 100755 ]; then ok "git records bin/story-check as executable (100755)"
else bad "git records bin/story-check as $mode, not 100755"; fi

# --- 1. A sample repository: the code of repo/ on main, the stories on the PR's branch ---------------
R="$T/repo"
mkdir -p "$R"
g() { git -C "$R" "$@"; }
g init -q
g symbolic-ref HEAD refs/heads/main
g config user.name test; g config user.email test@example.invalid
g config core.autocrlf false; g config commit.gpgsign false
cp -R "$FIX/repo/src" "$R/src"
g add -A && g commit -qm "base"
BASE="$(g rev-parse HEAD)"
g checkout -q -b demo-cart/pr
S=".scratch/demo-cart/stories"
EN="$S/04-cart-total.md"; RU="$S/05-coupons.md"; EPIC=".scratch/demo-cart/story.md"
mkdir -p "$R/$S"
cp "$FIX/pr-en.md" "$R/$EN"; cp "$FIX/pr-ru.md" "$R/$RU"; cp "$FIX/epic-ru.md" "$R/$EPIC"
g add -A && g commit -qm "stories"
PRHEAD="$(g rev-parse HEAD)"

# --- 2. Clean stories are green, checked against HEAD of the branch ---------------------------------
run "$EN"
check "story of a PR in English: exit code 0, checked against HEAD of the branch" \
    "$([ "$rc" = 0 ] && has "$T/out" "HEAD $PRHEAD" && line_has "$EN: ok" && echo 0 || echo 1)"
run "$RU"
check "story of a PR in Russian, the review step appended: exit code 0" \
    "$([ "$rc" = 0 ] && has "$T/out" "HEAD $PRHEAD" && echo 0 || echo 1)"
run "$EPIC"
check "story of an epic with a dropped handoff and a chapter not ready: exit code 0" \
    "$([ "$rc" = 0 ] && line_has "$EPIC: ok" && echo 0 || echo 1)"
run "$EN" "$RU"
check "two stories in one run: exit code 0, a line for each" \
    "$([ "$rc" = 0 ] && line_has "$EN: ok" && line_has "$RU: ok" && echo 0 || echo 1)"

# --- 3. Red stories ----------------------------------------------------------------------------------
cp "$FIX/bad-fragment.md" "$R/$EN"
run "$EN"
check "a fragment that does not match the code: exit code 2, the step, the path, the lines and the line that differs" \
    "$([ "$rc" = 2 ] && line_has "$EN:2: " "src/cart.ts:10-17" "line 14" && echo 0 || echo 1)"
check "a story changed and not committed is checked against the working tree, and the output says so" \
    "$(has "$T/out" "working tree" && ! has "$T/out" "HEAD $PRHEAD" && echo 0 || echo 1)"
g checkout -q -- "$EN"

cp "$FIX/missing-field.md" "$R/$EN"
run "$EN"
check "a step without a field: exit code 2, the step and the name of the field" \
    "$([ "$rc" = 2 ] && line_has "$EN:3: " "Why here" && echo 0 || echo 1)"
g checkout -q -- "$EN"

# The Russian story reads its labels from lib/input-words.json: without its first field of step 3 the
# problem names the label of that list, not the English one.
want="$(node -e 'process.stdout.write(require(process.argv[1]).codeStoryLabels.ru["What it does"])' "$(cd "$HARNESS/lib" && { pwd -W 2>/dev/null || pwd -P; })/input-words.json")"
awk '/^## 3\./ { s = 1 } s && !d && /^- / { d = 1; next } { print }' "$FIX/pr-ru.md" >"$R/$RU"
run "$RU"
check "a Russian story without a field: exit code 2, the field named by the label of the word list" \
    "$([ "$rc" = 2 ] && [ -n "$want" ] && line_has "$RU:3: " "no field \"$want\"" && ! has "$T/out" "What it does" && echo 0 || echo 1)"
g checkout -q -- "$RU"

# Personal data: a home folder path with a user name that is no stand-in of privacy.cjs.
NAME="jd""oe"
printf '\nRun from /Us''ers/%s/proj on the box.\n' "$NAME" >>"$R/$EN"
run "$EN"
check "personal data in the story: exit code 2, the rule named, the value masked" \
    "$([ "$rc" = 2 ] && line_has "$EN:" "home-path" "jd…(4)" && ! grep -q "$NAME" "$T/out" "$T/err" && echo 0 || echo 1)"
g checkout -q -- "$EN"

# A committed story names no commit: a Commit field in its header is an error.
sed 's/^Kind: pr · /Kind: pr · Commit: 0123456789abcdef0123456789abcdef01234567 · /' "$FIX/pr-en.md" >"$R/$EN"
run "$EN"
check "a header with a Commit field: exit code 2, the header named" \
    "$([ "$rc" = 2 ] && line_has "$EN:header: " "Commit" && echo 0 || echo 1)"
g checkout -q -- "$EN"

# A handoff without `done:` in the step "Seams between tickets" (step 6 of the epic fixture).
awk '!d && sub(/ · done: yes$/, "") { d = 1 } { print }' "$FIX/epic-ru.md" >"$R/$EPIC"
run "$EPIC"
check "a handoff without done: exit code 2, the step and the handoff named" \
    "$([ "$rc" = 2 ] && line_has "$EPIC:6: " "03 → 04" "done:" && echo 0 || echo 1)"
g checkout -q -- "$EPIC"

# --- 4. An uncommitted story is checked against the working tree ------------------------------------
NEW="$S/07-new-story.md"
cp "$FIX/pr-en.md" "$R/$NEW"
run "$NEW"
check "a new story not yet committed: exit code 0, checked against the working tree" \
    "$([ "$rc" = 0 ] && has "$T/out" "working tree" && echo 0 || echo 1)"
rm -f "$R/$NEW"

# --- 5. The main branch moved the quoted lines; the branch was not rebased ---------------------------
g checkout -q main
cp "$FIX/repo-main-shifted/src/cart.ts" "$R/src/cart.ts"
g commit -qam "main adds lines above cartTotal"
SHIFTED="$(g rev-parse HEAD)"
g checkout -q demo-cart/pr
[ "$(g merge-base main demo-cart/pr)" = "$BASE" ] && [ "$(git -C "$R" show main:src/cart.ts | sed -n 13p)" = "$(sed -n 10p "$FIX/repo/src/cart.ts")" ] \
    && ok "fixture: the branch is not rebased, and on main the fragment of step 2 stands three lines lower" \
    || bad "fixture: repo-main-shifted does not give the shifted main branch"
run "$EN"
check "branch not rebased, lines shifted on main: exit code 0 on the branch's head" \
    "$([ "$rc" = 0 ] && has "$T/out" "HEAD $PRHEAD" && echo 0 || echo 1)"

# The PR is merged without a rebase (a squash, as land merges); now the main branch holds the story.
g checkout -q main
g merge -q --squash demo-cart/pr >/dev/null && g commit -qm "squash of the PR"
MAINHEAD="$(g rev-parse HEAD)"
run "$EN"
check "on the main branch with no commit named: exit code 1, the main branch named as the reason" \
    "$([ "$rc" = 1 ] && has "$T/err" "main branch" && has "$T/err" "--head" && echo 0 || echo 1)"
run --head main "$EN"
check "against the main branch named on purpose: exit code 2, the fragment of step 2 does not match there" \
    "$([ "$rc" = 2 ] && line_has "$EN:2: " "src/cart.ts:10-17" && has "$T/out" "$MAINHEAD" && echo 0 || echo 1)"
run --head "$PRHEAD" "$EN"
check "on the main branch against the PR's head: exit code 0, the head named" \
    "$([ "$rc" = 0 ] && has "$T/out" "$PRHEAD" && echo 0 || echo 1)"

# --- 6. The documents PR appends the review step: checked against the head land merged ---------------
g checkout -q -b docs/review main
{
    printf '\n## 6. What review found and what remains\n\n'
    printf 'Review found nothing to change in the sum; the skip of empty lines stays.\n\n'
    printf 'Code: `src/cart.ts:14-14` · key lines: 14\n\n'
    printf '```ts\n'
    sed -n 14p "$FIX/repo/src/cart.ts"
    printf '```\n'
} >>"$R/$EN"
run "$EN"
check "documents PR, its own branch as the anchor: exit code 2 (its code is the main branch's)" \
    "$([ "$rc" = 2 ] && line_has "$EN:6: " "src/cart.ts:14-14" && echo 0 || echo 1)"
run --head "$PRHEAD" "$EN"
check "documents PR, the review step appended, against the head land merged: exit code 0, that head named" \
    "$([ "$rc" = 0 ] && has "$T/out" "$PRHEAD" && ! has "$T/out" "working tree" && echo 0 || echo 1)"
g commit -qam "documents: review step"
run --head "$PRHEAD" "$EN"
check "documents PR committed: still checked against the merged head, exit code 0" \
    "$([ "$rc" = 0 ] && has "$T/out" "$PRHEAD" && echo 0 || echo 1)"

# --- 7. The chapters of an epic story, each against its PR's head ------------------------------------
g checkout -q main
run --pr-head 211="$PRHEAD" --pr-head 212="$PRHEAD" --pr-head 213="$PRHEAD" "$EPIC"
check "epic story on the main branch, every chapter against its PR's head: exit code 0" \
    "$([ "$rc" = 0 ] && has "$T/out" "PR #212" && has "$T/out" "$PRHEAD" && echo 0 || echo 1)"
run --pr-head 211="$PRHEAD" --pr-head 212="$SHIFTED" --pr-head 213="$PRHEAD" "$EPIC"
check "epic story, a chapter against a head where its code moved: exit code 2, its step named" \
    "$([ "$rc" = 2 ] && line_has "$EPIC:3: " "src/cart.ts:10-17" && echo 0 || echo 1)"
run "$EPIC"
check "epic story on the main branch with no head named: exit code 1" "$([ "$rc" = 1 ] && has "$T/err" "main branch" && echo 0 || echo 1)"

# --- 8. What cannot be checked ----------------------------------------------------------------------
g checkout -q demo-cart/pr
run "$S/99-missing.md"
check "no such story file: exit code 1 and the reason" "$([ "$rc" = 1 ] && has "$T/err" "99-missing.md" && echo 0 || echo 1)"
run --head 0000000000000000000000000000000000000bad "$EN"
check "an unknown commit: exit code 1 and the reason" "$([ "$rc" = 1 ] && has "$T/err" "commit" && echo 0 || echo 1)"
L="$T/loose"; mkdir -p "$L"; cp "$FIX/pr-en.md" "$L/story.md"
run --repo "$R" "$L/story.md"
check "a story outside the work tree of the code (--repo): exit code 0, against HEAD of that work tree" \
    "$([ "$rc" = 0 ] && has "$T/out" "HEAD $PRHEAD" && echo 0 || echo 1)"
GIT_CEILING_DIRECTORIES="$T" run "$L/story.md"
check "a story outside a git work tree: exit code 1 and the reason" "$([ "$rc" = 1 ] && has "$T/err" "git" && echo 0 || echo 1)"
run
check "no story named: exit code 1 and the usage" "$([ "$rc" = 1 ] && has "$T/err" "usage: story-check" && echo 0 || echo 1)"
run --pr-head 212 "$EPIC"
check "--pr-head without =<commit>: exit code 1 and the usage" "$([ "$rc" = 1 ] && has "$T/err" "usage: story-check" && echo 0 || echo 1)"
run --help
check "--help: exit code 0 and the usage on stdout" "$([ "$rc" = 0 ] && has "$T/out" "usage: story-check" && echo 0 || echo 1)"

# --- 9. The real ~/.claude is untouched ------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "the real ~/.claude did not change" || bad "the real ~/.claude changed during the test"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
