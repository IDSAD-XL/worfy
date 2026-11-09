#!/usr/bin/env bash
# Tests of the Evidence lines of a ticket's "done" section (harness/lib/evidence.cjs) and of the commands that use
# them: `ticket evidence <epic> <NN>` (the matrix), `ticket evidence <epic> <NN> <item> <kind> <verdict> …` (one
# line written under an item) and the warning `ticket done` prints on items without evidence.
# The tickets are the files of fixtures/evidence, copied into a temporary tickets root; the registry and the
# profiles are temporary too (CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR), and HOME is a temporary folder.
# Run: bash harness/bin/tests/ticket-evidence.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$(cd "$HERE/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
LIB="${LIB_DIR:-$HARNESS/lib}"
TICKET="$BIN/ticket"
FX="$HERE/fixtures/evidence"
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
. "$HERE/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
unset GH_TOKEN GITHUB_TOKEN CLAUDE_PROFILE_BIN GITHUB_ACTIONS
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$T/hh"
export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
mkdir -p "$HOME" "$HARNESS_HOME" "$CLAUDE_PROFILES_DIR/en" "$CLAUDE_PROFILES_DIR/acc"

# --- the projects: ru — not registered, the old Russian heading; en — registered, the profile's English
# heading; acc — registered with a heading of its own, so the test sees that the profile is read -------------
for r in ru en acc; do git init -q -b main "$T/$r" && git -C "$T/$r" commit -q --allow-empty -m init; done
cat >"$CLAUDE_GATE_CONFIG" <<EOF
{"repos":[
 {"key":"en","match":"$T/en","profile":"en","pm":"npm","root":{},"workspace":{}},
 {"key":"acc","match":"$T/acc","profile":"acc","pm":"npm","root":{},"workspace":{}},
 {"key":"sil","match":"$T/sil","profile":"sil","pm":"npm","root":{},"workspace":{}}
]}
EOF
printf '{"schema":1,"name":"en","tickets":{"root":".scratch/","done_section":"## Done when","manual_mark":"manual"}}\n' >"$CLAUDE_PROFILES_DIR/en/profile.json"
printf '{"schema":1,"name":"acc","tickets":{"root":".scratch/","done_section":"## Acceptance","manual_mark":"by hand"}}\n' >"$CLAUDE_PROFILES_DIR/acc/profile.json"
: >"$CLAUDE_PROFILES_DIR/en/rules.md"; : >"$CLAUDE_PROFILES_DIR/acc/rules.md"
RU="$T/ru/.scratch/demo/issues"
mkdir -p "$RU" "$T/en/.scratch/demo/issues" "$T/acc/.scratch/demo/issues"
fresh() { cp "$FX/ru/01-three-items.md" "$RU/01-three-items.md"; cp "$FX/ru/02-states.md" "$RU/02-states.md"; }
fresh
cp "$FX/en/01-english.md" "$T/en/.scratch/demo/issues/01-english.md"
sed -e 's/^## Done when$/## Acceptance/' -e 's/(manual)/(by hand)/' "$FX/en/01-english.md" >"$T/acc/.scratch/demo/issues/01-english.md"

# tk <dir> <args…>: ticket run from <dir>; stdout in $T/out, stderr in $T/err, the exit code in rc.
tk() { local d="$1"; shift; (cd "$d" && node "$TICKET" "$@") >"$T/out" 2>"$T/err"; rc=$?; }
has() { grep -qF -- "$1" "$T/out"; }

# --- 1. the failing test first: without the command ticket answers with usage ----------------------------------
tk "$T/ru" evidence demo 01
[ "$rc" -eq 0 ] && ok "ticket evidence is a command (exit 0)" || bad "ticket evidence demo 01: exit $rc $(cat "$T/err")"

# --- 2. the matrix of a ticket without Evidence lines ------------------------------------------------------------
tk "$T/ru" evidence demo 01
if [ "$rc" -eq 0 ] && [ "$(tail -n 1 "$T/out")" = "evidence: 0 of 3 verified" ] && has "1. not-verified no evidence — First item." \
   && has "2. not-verified no evidence — Second item, its text goes on on a continuation line." && has "3. not-verified no evidence — Third item." \
   && ! has "code fence" && ! has "Not an item"; then
    ok "matrix: 0 of 3 verified, reason no evidence; the code fence and other sections are not read"
else bad "matrix of 01: exit $rc"; cat "$T/out"; fi

# --- 3. the state rules ------------------------------------------------------------------------------------------
tk "$T/ru" evidence demo/02
want=(
    "1. failed — Failed item."
    "2. not-verified review only — Reviewed only."
    "3. not-verified needs windows stable, got windows installed — (вручную) Canvas on the PC."
    "4. not-verified manual item needs owner-check, screenshot or video — (вручную) Manual item with a test run only."
    "5. verified — (вручную, owner) Manual item the owner checked."
    "6. not-verified no evidence — Parent item."
    "7. verified — Nested child item."
    "8. not-verified unreadable evidence line — Item with a broken line."
    "9. verified — Verified item."
    "10. verified — Needs met."
    "11. verified — (вручную) Drag of a card."
)
missing=""
for w in "${want[@]}"; do has "$w" || missing="$missing [$w]"; done
if [ "$rc" -eq 0 ] && [ -z "$missing" ] && [ "$(tail -n 1 "$T/out")" = "evidence: 5 of 11 verified" ]; then
    ok "states: last fail -> failed, review only, needs mismatch, manual needs owner-check, a video proves a manual item, nested item numbered by file order"
else bad "states: exit $rc, missing:$missing"; cat "$T/out"; fi
has "- evidence: test-run pass · \`bash t.sh\` exit 0 · linux - · 7777777" && has "line 25: verdict is pass or fail" \
    && ok "matrix prints the lines under each item, and the reason of an unreadable line" || { bad "matrix lines under items"; cat "$T/out"; }

# --- 4. a write: after the item's continuation, the rest of the file byte for byte --------------------------------
SHA1=abcdef1
tk "$T/ru" evidence demo 01 2 test-run pass --ref '`pnpm test` exit 0' --platform mac --copy dev --sha "$SHA1"
[ "$rc" -eq 0 ] && cmp -s "$RU/01-three-items.md" "$FX/ru/01-after-one.md" && ok "write: the line goes after the continuation of item 2, nothing else changes" \
    || { bad "write into item 2: exit $rc $(cat "$T/err")"; diff "$FX/ru/01-after-one.md" "$RU/01-three-items.md"; }
tk "$T/ru" evidence demo 01 2 gate pass --ref 'gate fast green' --platform mac --copy dev --sha abcdef2
[ "$rc" -eq 0 ] && cmp -s "$RU/01-three-items.md" "$FX/ru/01-after-two.md" && ok "a second write goes after the first Evidence line" \
    || { bad "second write: exit $rc $(cat "$T/err")"; diff "$FX/ru/01-after-two.md" "$RU/01-three-items.md"; }
tk "$T/ru" evidence demo 01
[ "$(tail -n 1 "$T/out")" = "evidence: 1 of 3 verified" ] && ok "after the writes item 2 is verified: 1 of 3" || { bad "matrix after writes"; cat "$T/out"; }

# BOM and CRLF: the same write keeps both.
bom() { printf '\357\273\277'; cat "$1"; }
crlf() { sed 's/$/\r/' "$1"; }
bom "$FX/ru/01-three-items.md" >"$RU/01-three-items.md"; bom "$FX/ru/01-after-one.md" >"$T/want-bom.md"
tk "$T/ru" evidence demo 01 2 test-run pass --ref '`pnpm test` exit 0' --platform mac --copy dev --sha "$SHA1"
[ "$rc" -eq 0 ] && cmp -s "$RU/01-three-items.md" "$T/want-bom.md" && ok "write keeps the byte order mark" || bad "BOM: exit $rc $(cat "$T/err")"
crlf "$FX/ru/01-three-items.md" >"$RU/01-three-items.md"; crlf "$FX/ru/01-after-one.md" >"$T/want-crlf.md"
tk "$T/ru" evidence demo 01 2 test-run pass --ref '`pnpm test` exit 0' --platform mac --copy dev --sha "$SHA1"
[ "$rc" -eq 0 ] && cmp -s "$RU/01-three-items.md" "$T/want-crlf.md" && ok "write keeps CRLF line ends" || bad "CRLF: exit $rc $(cat "$T/err")"
fresh

# A nested item: the line goes under the child, indented under it, and belongs to the child.
tk "$T/ru" evidence demo 02 7 gate pass --ref 'gate fast green' --platform mac --copy dev --sha abcdef3
line="$(sed -n '24p' "$RU/02-states.md")"
[ "$rc" -eq 0 ] && [ "$line" = "    - evidence: gate pass · gate fast green · mac dev · abcdef3" ] && ok "a write into a nested item goes under it with its indentation" \
    || bad "nested write: exit $rc, line 24: [$line] $(cat "$T/err")"
tk "$T/ru" evidence demo 02
has "6. not-verified no evidence — Parent item." && ok "the Evidence line under the child is not the parent's" || { bad "nested owner"; cat "$T/out"; }
fresh

# A link: the line goes into its target, the link stays a link.
if ln -s "$T/target.md" "$T/probe-link" 2>/dev/null && [ -L "$T/probe-link" ]; then
    mv "$RU/01-three-items.md" "$T/target.md"; ln -s "$T/target.md" "$RU/01-three-items.md"
    tk "$T/ru" evidence demo 01 2 test-run pass --ref '`pnpm test` exit 0' --platform mac --copy dev --sha "$SHA1"
    [ "$rc" -eq 0 ] && [ -L "$RU/01-three-items.md" ] && cmp -s "$T/target.md" "$FX/ru/01-after-one.md" && ok "a write through a symbolic link goes into its target" \
        || bad "link: exit $rc $(cat "$T/err")"
    rm -f "$RU/01-three-items.md" "$T/target.md"
else
    echo "skip symbolic link case: no symbolic links here"
fi
rm -f "$T/probe-link"
fresh

# --- 5. refusals: exit 2 with a reason, and the file is not touched ------------------------------------------------
refuse() { # refuse <what> <grep text> <args…>
    local what="$1" text="$2"; shift 2
    tk "$T/ru" evidence demo 01 "$@"
    if [ "$rc" -eq 2 ] && grep -qF -- "$text" "$T/err" && cmp -s "$RU/01-three-items.md" "$FX/ru/01-three-items.md"; then ok "refused: $what"
    else bad "refusal $what: exit $rc, stderr: $(cat "$T/err")"; fresh; fi
}
refuse "unknown kind" "kind is one of" 1 lint pass --ref x --platform mac --sha "$SHA1"
refuse "unknown verdict" "verdict is pass or fail" 1 test-run ok --ref x --platform mac --sha "$SHA1"
refuse "review VERIFIED" "verdict is pass or fail" 1 review VERIFIED --ref "PR #12" --sha "$SHA1"
refuse "unknown platform" "platform is one of" 1 test-run pass --ref x --platform bsd --sha "$SHA1"
refuse "platform - for a test run" "platform is one of" 1 test-run pass --ref x --platform - --sha "$SHA1"
refuse "unknown copy" "copy is one of" 1 test-run pass --ref x --platform mac --copy prod --sha "$SHA1"
refuse "review with a platform" "names no platform and no copy" 1 review pass --ref "PR #12" --platform mac --sha "$SHA1"
refuse "screenshot without a copy" "names the copy" 1 screenshot pass --ref '`a.webp`' --platform mac --sha "$SHA1"
refuse "owner-check without a copy" "names the copy" 1 owner-check pass --ref 'owner said yes' --platform mac --sha "$SHA1"
refuse "ref with the separator" "must not contain" 1 test-run pass --ref 'a · b' --platform mac --sha "$SHA1"
refuse "ref with a line break" "one line" 1 test-run pass --ref "$(printf 'a\nb')" --platform mac --sha "$SHA1"
refuse "no ref" "--ref" 1 test-run pass --platform mac --sha "$SHA1"
refuse "sha not hex" "sha is 7 to 40 hex" 1 test-run pass --ref x --platform mac --sha xyz1234
refuse "sha too short" "sha is 7 to 40 hex" 1 test-run pass --ref x --platform mac --sha abc12
refuse "sha too long" "sha is 7 to 40 hex" 1 test-run pass --ref x --platform mac --sha "$(printf 'a%.0s' $(seq 41))"
refuse "scrub not a date" "scrub is a date" 1 screenshot pass --ref '`a.webp`' --platform mac --copy dev --sha "$SHA1" --scrub today
refuse "item 0" "no item 0" 0 test-run pass --ref x --platform mac --sha "$SHA1"
refuse "item past the section" "no item 4" 4 test-run pass --ref x --platform mac --sha "$SHA1"
refuse "item not a number" "item is a number" x test-run pass --ref x --platform mac --sha "$SHA1"
refuse "a kind without a verdict" "expected" 1 test-run --ref x --platform mac --sha "$SHA1"

tk "$T/ru" evidence demo 01 1 test-run pass --ref '`pnpm test` exit 0' --platform mac --copy dev --sha "$SHA1" -n
[ "$rc" -eq 0 ] && has "  - evidence: test-run pass · \`pnpm test\` exit 0 · mac dev · $SHA1" && has "(-n: file not touched)" \
    && cmp -s "$RU/01-three-items.md" "$FX/ru/01-three-items.md" && ok "-n prints the line and leaves the file as it is" || bad "-n: exit $rc $(cat "$T/out" "$T/err")"

tk "$T/ru" evidence demo 01 1 review pass --ref "PR #12" --sha "$SHA1"
[ "$rc" -eq 0 ] && [ "$(sed -n '14p' "$RU/01-three-items.md")" = "  - evidence: review pass · PR #12 · - - · $SHA1" ] && ok "review pass is written with - - for platform and copy" \
    || bad "review pass: exit $rc $(cat "$T/err")"
fresh

# --- 6. the defaults: platform from the system (ci under GitHub Actions), sha from git HEAD ----------------------------
head="$(git -C "$T/ru" rev-parse HEAD)"
plat="$(node -p '({ darwin: "mac", win32: "windows", linux: "linux" })[process.platform] || "?"')"
tk "$T/ru" evidence demo 01 3 test-run pass --ref '`pnpm test` exit 0' -n
has "  - evidence: test-run pass · \`pnpm test\` exit 0 · $plat - · $head" && ok "defaults: platform $plat, copy -, sha of git HEAD" || bad "defaults: exit $rc $(cat "$T/out" "$T/err")"
(export GITHUB_ACTIONS=true; tk "$T/ru" evidence demo 01 3 ci-check pass --ref 'ci-ok' -n)
grep -qF -- "· ci - · $head" "$T/out" && ok "under GitHub Actions the platform is ci" || bad "GITHUB_ACTIONS: $(cat "$T/out" "$T/err")"

# --- 7. ticket done warns about the items without evidence; exit code and Status as before -------------------------------
tk "$T/ru" done demo 02
if [ "$rc" -eq 0 ] && grep -q '^Status: done 20' "$RU/02-states.md" && grep -qF "evidence: 5 of 11 verified" "$T/err" \
   && grep -qF "1. failed — Failed item." "$T/err" && grep -qF "6. not-verified no evidence — Parent item." "$T/err" && ! grep -qF "7. verified" "$T/err"; then
    ok "ticket done: Status written, exit 0, stderr names the count and each unverified or failed item"
else bad "done warning: exit $rc"; cat "$T/err"; fi
mkdir -p "$T/ru/.scratch/plain/issues"; printf '# 01 — no done section\n\nStatus: open\n\n## What\n\ntext\n' >"$T/ru/.scratch/plain/issues/01-plain.md"
tk "$T/ru" done plain 01
[ "$rc" -eq 0 ] && [ ! -s "$T/err" ] && ok "ticket done on a ticket without the section prints no evidence line" || bad "done without section: exit $rc [$(cat "$T/err")]"
fresh

# --- 8. the heading: the profile's, and the old Russian one with --root and no profile ------------------------------------
tk "$T/en" evidence demo 01
if [ "$rc" -eq 0 ] && [ "$(tail -n 1 "$T/out")" = "evidence: 2 of 3 verified" ] && has "2. not-verified no evidence — (manual) The owner looked at the canvas." && ! has "Not an item"; then
    ok "the profile's ## Done when and (manual) of an English project"
else bad "en: exit $rc $(cat "$T/out" "$T/err")"; fi
tk "$T/acc" evidence demo 01
[ "$rc" -eq 0 ] && [ "$(tail -n 1 "$T/out")" = "evidence: 2 of 3 verified" ] && has "(by hand) The owner looked at the canvas." \
    && ok "a heading of the profile's own (## Acceptance, by hand) is read" || bad "acc: exit $rc $(cat "$T/out" "$T/err")"
tk "$T" evidence demo 01 --root "$T/ru/.scratch"
[ "$rc" -eq 0 ] && [ "$(tail -n 1 "$T/out")" = "evidence: 0 of 3 verified" ] && ok "the old ## Готово, когда is read with --root and no profile" || bad "--root: exit $rc $(cat "$T/out" "$T/err")"

# --- 9. the grammar: the shared cases, and a written line reads back as written ---------------------------------------------
node - "$LIB/evidence.cjs" "$FX/grammar.json" >"$T/out" 2>&1 <<'NODE'
const [lib, cases] = process.argv.slice(2)
const ev = require(lib)
const { cases: list } = JSON.parse(require("fs").readFileSync(cases, "utf8"))
let bad = 0
for (const c of list) {
    const r = ev.parseEvidenceLine(c.text)
    if (c.error ? !r.error : JSON.stringify(r.fields) !== JSON.stringify(c.fields)) { bad++; console.log("case: " + c.text + " -> " + JSON.stringify(r)) }
    if (!c.error && ev.formatEvidence(r.fields) !== "- evidence: " + c.text) { bad++; console.log("round trip: " + c.text) }
}
console.log(`${list.length} cases, ${bad} wrong`)
process.exit(bad ? 1 : 0)
NODE
rc=$?
[ "$rc" -eq 0 ] && ok "evidence.cjs reads every case of fixtures/evidence/grammar.json and writes the same line back" || { bad "grammar cases"; cat "$T/out"; }

# --- 10. the privacy check of the files the ref names (bin/evidence-check), before the line is written ---------------------
# The home path is put together here, so this file holds no whole one; the name is not a stand-in (privacy.cjs).
EVD="$T/ru/.scratch/demo/evidence"; mkdir -p "$EVD"
leak="/Use""rs/martazen/notes"
printf 'gate fast green\nlog of %s/run.txt\n' "$leak" >"$EVD/01-dirty.txt"
printf 'gate fast green\n' >"$EVD/01-clean.txt"
# A 1x1 PNG without metadata chunks.
node -e 'require("fs").writeFileSync(process.argv[1], Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"))' "$EVD/01-canvas.png"
tk "$T/ru" evidence demo 01 1 test-run pass --ref '`../evidence/01-dirty.txt` exit 0' --platform mac --sha "$SHA1"
if [ "$rc" -eq 1 ] && cmp -s "$RU/01-three-items.md" "$FX/ru/01-three-items.md" && grep -qF "home-path" "$T/err" && grep -qF "evidence-check: 1 findings" "$T/err" \
   && ! grep -qF "martazen" "$T/err" && ! grep -qF "martazen" "$T/out"; then
    ok "a ref on a file with a home path: exit 1, the ticket is not touched, stderr names the rule but not the value"
else bad "dirty ref: exit $rc, stderr: $(cat "$T/err")"; fresh; fi
tk "$T/ru" evidence demo 01 1 test-run pass --ref '`../evidence/01-clean.txt` exit 0' --platform mac --sha "$SHA1"
[ "$rc" -eq 0 ] && grep -qF -- "- evidence: test-run pass · \`../evidence/01-clean.txt\` exit 0 · mac - · $SHA1" "$RU/01-three-items.md" \
    && ok "a ref on a clean file: the line is written" || bad "clean ref: exit $rc $(cat "$T/err")"
fresh
refuse "screenshot with a path and no --scrub" "a screenshot needs --scrub <date>: check the pixels by eye first" \
    1 screenshot pass --ref '`../evidence/01-canvas.png`' --platform mac --copy dev --sha "$SHA1"
tk "$T/ru" evidence demo 01 1 screenshot pass --ref '`../evidence/01-canvas.png`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-04
[ "$rc" -eq 0 ] && grep -qF -- "- evidence: screenshot pass · \`../evidence/01-canvas.png\` · mac dev · $SHA1 · scrub: 2026-11-04" "$RU/01-three-items.md" \
    && ok "a screenshot with --scrub and a PNG without metadata: the line is written" || bad "screenshot --scrub: exit $rc $(cat "$T/err")"
fresh
# Silent mode: a tickets root outside the repository publishes nothing, so its files are not checked.
OUT="$T/outside/.scratch/demo"; mkdir -p "$OUT/issues" "$OUT/evidence"
cp "$FX/ru/01-three-items.md" "$OUT/issues/01-three-items.md"; cp "$EVD/01-dirty.txt" "$OUT/evidence/01-dirty.txt"
tk "$T/ru" evidence demo 01 1 test-run pass --ref '`../evidence/01-dirty.txt` exit 0' --platform mac --sha "$SHA1" --root "$T/outside/.scratch"
[ "$rc" -eq 0 ] && grep -qF -- "- evidence: test-run pass · \`../evidence/01-dirty.txt\` exit 0 · mac - · $SHA1" "$OUT/issues/01-three-items.md" \
    && ok "a tickets root outside the repository: the file is not checked, the line is written" || bad "outside root: exit $rc $(cat "$T/err")"
# The repository is the one that holds the tickets root, not the one of the working directory.
tk "$T" evidence demo 01 1 test-run pass --ref '`../evidence/01-dirty.txt` exit 0' --platform mac --sha "$SHA1" --root "$T/ru/.scratch"
[ "$rc" -eq 1 ] && cmp -s "$RU/01-three-items.md" "$FX/ru/01-three-items.md" && grep -qF "home-path" "$T/err" \
    && ok "run from outside git with --root in a repository: the file is checked, exit 1" || { bad "outside git: exit $rc $(cat "$T/err")"; fresh; }
git -C "$T/ru" worktree add -q --detach "$T/ru-wt" 2>/dev/null
tk "$T/ru-wt" evidence demo 01 1 test-run pass --ref '`../evidence/01-dirty.txt` exit 0' --platform mac --sha "$SHA1" --root "$T/ru/.scratch"
[ "$rc" -eq 1 ] && cmp -s "$RU/01-three-items.md" "$FX/ru/01-three-items.md" && grep -qF "home-path" "$T/err" \
    && ok "run from a second worktree with --root in the main checkout: the file is checked, exit 1" || { bad "second worktree: exit $rc $(cat "$T/err")"; fresh; }
git -C "$T/ru" worktree remove --force "$T/ru-wt" 2>/dev/null
# A screenshot whose ref has no path (a URL) needs no --scrub.
tk "$T/ru" evidence demo 01 1 screenshot pass --ref 'https://example.com/run/1' --platform mac --copy dev --sha "$SHA1"
[ "$rc" -eq 0 ] && grep -qF -- "- evidence: screenshot pass · https://example.com/run/1 · mac dev · $SHA1" "$RU/01-three-items.md" \
    && ok "a screenshot with no path in the ref and no --scrub: the line is written" || bad "screenshot without a path: exit $rc $(cat "$T/err")"
fresh

# Silent mode by the profile: the Workflow folder is a git work tree of its own (project-connect runs git init in
# it, no commits), and still nothing there is published, so the file is not checked.
git init -q -b main "$T/sil" && git -C "$T/sil" commit -q --allow-empty -m init
mkdir -p "$CLAUDE_PROFILES_DIR/sil" "$T/sil-wf/.scratch/demo/issues" "$T/sil-wf/.scratch/demo/evidence"; git init -q "$T/sil-wf"
printf '{"schema":2,"name":"sil","mode":"silent","workflow":{"folder":"%s"},"tickets":{"root":".scratch/"}}\n' "$T/sil-wf" >"$CLAUDE_PROFILES_DIR/sil/profile.json"
: >"$CLAUDE_PROFILES_DIR/sil/rules.md"
cp "$EVD/01-dirty.txt" "$T/sil-wf/.scratch/demo/evidence/01-dirty.txt"
SIL="$T/sil-wf/.scratch/demo/issues/01-three-items.md"
cp "$FX/ru/01-three-items.md" "$SIL"
tk "$T/sil" evidence demo 01 1 test-run pass --ref '`../evidence/01-dirty.txt` exit 0' --platform mac --sha "$SHA1"
[ "$rc" -eq 0 ] && grep -qF -- "- evidence: test-run pass · \`../evidence/01-dirty.txt\` exit 0 · mac - · $SHA1" "$SIL" \
    && ok "Silent mode by the profile, Workflow folder a fresh git init: the file is not checked, the line is written" || bad "silent profile: exit $rc $(cat "$T/err")"
cp "$FX/ru/01-three-items.md" "$SIL"
tk "$T/sil" evidence demo 01 1 test-run pass --ref '`../evidence/01-dirty.txt` exit 0' --platform mac --sha "$SHA1" --root "$T/sil-wf/.scratch"
[ "$rc" -eq 0 ] && grep -qF -- "- evidence: test-run pass · \`../evidence/01-dirty.txt\` exit 0 · mac - · $SHA1" "$SIL" \
    && ok "Silent mode by the profile with --root on the Workflow folder: the line is written" || bad "silent profile --root: exit $rc $(cat "$T/err")"
# Full mode with a profile: the check runs as before.
mkdir -p "$T/en/.scratch/demo/evidence"; cp "$EVD/01-dirty.txt" "$T/en/.scratch/demo/evidence/01-dirty.txt"
cp "$T/en/.scratch/demo/issues/01-english.md" "$T/en-before.md"
tk "$T/en" evidence demo 01 1 test-run pass --ref '`../evidence/01-dirty.txt` exit 0' --platform mac --sha "$SHA1"
[ "$rc" -eq 1 ] && cmp -s "$T/en/.scratch/demo/issues/01-english.md" "$T/en-before.md" && grep -qF "home-path" "$T/err" \
    && ok "Full mode by the profile: the file is checked, exit 1" || bad "full profile: exit $rc $(cat "$T/err")"
cp "$T/en-before.md" "$T/en/.scratch/demo/issues/01-english.md"

# --- 11. a line flag followed by another flag does not take it as its value ---------------------------------------------
refuse "--ref followed by -n" "--ref needs a value, got the flag -n" 1 test-run pass --ref -n --platform mac --sha "$SHA1"
refuse "--copy followed by a flag" "--copy needs a value, got the flag --scrub" 1 screenshot pass --ref x --platform mac --copy --scrub 2026-11-04 --sha "$SHA1"
refuse "--scrub followed by a flag" "--scrub needs a value, got the flag --sha" 1 screenshot pass --ref x --platform mac --copy dev --scrub --sha "$SHA1"
refuse "--ref at the end" "--ref needs a value" 1 test-run pass --platform mac --sha "$SHA1" --ref

# --- 12. a video: --scrub always, a .webm or .mp4 file in the ref, a contact sheet next to it -------------------------------
# The clips are tiny synthetic files built by fixtures/evidence/mkclip.cjs (no frames, nothing recorded from a screen).
MKCLIP="$FX/mkclip.cjs"
mkclip() { if [ -n "${2:-}" ]; then printf '%s' "$2" >"$T/clip.json"; node "$MKCLIP" "$1" "$T/clip.json"; else node "$MKCLIP" "$1"; fi; }
mkclip "$EVD/02-drag.webm"
cp "$EVD/01-canvas.png" "$EVD/02-drag.sheet.png"
mkclip "$EVD/02-mp4.mp4" '{"format":"mp4"}'
cp "$EVD/01-canvas.png" "$EVD/02-mp4.sheet.png"
mkclip "$EVD/02-alone.webm"
printf 'not a clip\n' >"$EVD/02-drag.mov"
STATES="$RU/02-states.md"
refuse02() { # refuse02 <what> <grep text> <args…>: a video line into item 4 of 02-states.md is refused, the file is not touched
    local what="$1" text="$2"; shift 2
    tk "$T/ru" evidence demo 02 4 video pass "$@"
    if [ "$rc" -eq 2 ] && grep -qF -- "$text" "$T/err" && cmp -s "$STATES" "$FX/ru/02-states.md"; then ok "video refused: $what"
    else bad "video refusal $what: exit $rc, stderr: $(cat "$T/err")"; fresh; fi
}
refuse02 "no --scrub" "a video needs --scrub <date>: check every frame of its contact sheet first" \
    --ref '`../evidence/02-drag.webm`' --platform mac --copy dev --sha "$SHA1"
refuse02 "no --scrub, ref without a path" "a video needs --scrub <date>" --ref 'https://example.com/clip' --platform mac --copy dev --sha "$SHA1"
refuse02 "no copy" "video names the copy of the app it checked" --ref '`../evidence/02-drag.webm`' --platform mac --sha "$SHA1" --scrub 2026-11-05
refuse02 "ref without a path in backticks" "a video ref is the path of its clip in backticks" \
    --ref 'https://example.com/clip' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
refuse02 "no such clip" "no clip at ../evidence/02-none.webm" --ref '`../evidence/02-none.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
refuse02 "a .mov clip" "a video is a .webm or .mp4 file, got ../evidence/02-drag.mov (convert .mov, .m4v or .mkv to one of them)" \
    --ref '`../evidence/02-drag.mov`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
refuse02 "no contact sheet next to the clip" "no contact sheet next to the clip: ../evidence/02-alone.sheet.png" \
    --ref '`../evidence/02-alone.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
mkdir -p "$T/ru/.scratch/demo/clips"; mkclip "$T/ru/.scratch/demo/clips/02-away.webm"; cp "$EVD/01-canvas.png" "$T/ru/.scratch/demo/clips/02-away.sheet.png"
refuse02 "a clip outside <epic>/evidence/" "a clip lies in the evidence folder of its epic (demo/evidence/), got ../clips/02-away.webm" \
    --ref '`../clips/02-away.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
mkclip "$EVD/02-badsheet.webm"; printf 'x' >"$EVD/02-badsheet.sheet.png"
refuse02 "a contact sheet that is not a PNG" "the contact sheet is not a PNG: ../evidence/02-badsheet.sheet.png" \
    --ref '`../evidence/02-badsheet.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
if ln -s "$EVD/02-drag.webm" "$EVD/02-link.webm" 2>/dev/null && [ -L "$EVD/02-link.webm" ]; then
    cp "$EVD/01-canvas.png" "$EVD/02-link.sheet.png"
    refuse02 "a clip that is a symbolic link" "a clip is a file, not a symbolic link: ../evidence/02-link.webm" \
        --ref '`../evidence/02-link.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
    mkclip "$EVD/02-lsheet.webm"; ln -s "$EVD/01-canvas.png" "$EVD/02-lsheet.sheet.png"
    refuse02 "a contact sheet that is a symbolic link" "a contact sheet is a file, not a symbolic link: ../evidence/02-lsheet.sheet.png" \
        --ref '`../evidence/02-lsheet.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
else
    rm -f "$EVD/02-link.webm" # Git Bash without symbolic links copies the target instead
    echo "skip symbolic link cases: no symbolic links here"
fi
mkclip "$EVD/02-UP.WEBM"; cp "$EVD/01-canvas.png" "$EVD/02-UP.sheet.png"
tk "$T/ru" evidence demo 02 4 video pass --ref '`../evidence/02-UP.WEBM`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05 -n
[ "$rc" -eq 0 ] && has "video pass · \`../evidence/02-UP.WEBM\`" && ok "an upper-case .WEBM with its <name>.sheet.png: accepted" || bad "upper-case clip: exit $rc $(cat "$T/err")"
refuse02 "-n does not skip the checks" "no contact sheet next to the clip" \
    --ref '`../evidence/02-alone.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05 -n
tk "$T/ru" evidence demo 02 4 video pass --ref '`../evidence/02-drag.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
[ "$rc" -eq 0 ] && grep -qF -- "  - evidence: video pass · \`../evidence/02-drag.webm\` · mac dev · $SHA1 · scrub: 2026-11-05" "$STATES" \
    && ok "a webm with its contact sheet and --scrub: the line is written" || bad "video write: exit $rc $(cat "$T/err")"
tk "$T/ru" evidence demo 02
has "4. verified — (вручную) Manual item with a test run only." && has "   - evidence: video pass · \`../evidence/02-drag.webm\` · mac dev · $SHA1 · scrub: 2026-11-05" \
    && [ "$(tail -n 1 "$T/out")" = "evidence: 6 of 11 verified" ] && ok "the matrix shows the video line, and the manual item it proves is verified" \
    || { bad "matrix after the video line"; cat "$T/out"; }
fresh
tk "$T/ru" evidence demo 02 4 video pass --ref '`../evidence/02-mp4.mp4`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
[ "$rc" -eq 0 ] && grep -qF -- "video pass · \`../evidence/02-mp4.mp4\`" "$STATES" && ok "an mp4 with its contact sheet: the line is written" || bad "mp4 write: exit $rc $(cat "$T/err")"
fresh
# The privacy check of the clip and of its contact sheet (bin/evidence-check): a finding in either — exit 1, nothing written.
printf '{"title":"%s/clip"}' "$leak" >"$T/clip.json"; node "$MKCLIP" "$EVD/02-dirty.webm" "$T/clip.json"
cp "$EVD/01-canvas.png" "$EVD/02-dirty.sheet.png"
tk "$T/ru" evidence demo 02 4 video pass --ref '`../evidence/02-dirty.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
[ "$rc" -eq 1 ] && cmp -s "$STATES" "$FX/ru/02-states.md" && grep -qF "02-dirty.webm:Title: home-path" "$T/err" && ! grep -qF "martazen" "$T/err" \
    && ok "a clip with a home path in its Title: exit 1, nothing written, the value masked" || { bad "dirty clip: exit $rc $(cat "$T/err")"; fresh; }
mkclip "$EVD/02-sheet.webm"
# The sheet: the 1x1 PNG with a tEXt chunk after IHDR (8 + 25 bytes) whose text holds the home path.
printf 'cwd %s' "$leak" >"$T/sheet.txt"
node -e '
const fs = require("fs")
const [out, textFile, pngFile] = process.argv.slice(1)
const png = fs.readFileSync(pngFile), text = fs.readFileSync(textFile)
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const data = Buffer.concat([Buffer.from("Comment\0"), text])
fs.writeFileSync(out, Buffer.concat([png.subarray(0, 33), u32(data.length), Buffer.from("tEXt"), data, u32(0), png.subarray(33)]))
' "$EVD/02-sheet.sheet.png" "$T/sheet.txt" "$EVD/01-canvas.png"
tk "$T/ru" evidence demo 02 4 video pass --ref '`../evidence/02-sheet.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
[ "$rc" -eq 1 ] && cmp -s "$STATES" "$FX/ru/02-states.md" && grep -qF "02-sheet.sheet.png:tEXt: home-path" "$T/err" \
    && ok "a contact sheet with a home path in tEXt: exit 1, nothing written" || { bad "dirty sheet: exit $rc $(cat "$T/err")"; fresh; }
# Silent mode: nothing is published, but the clip and its sheet are still looked at: the same refusals.
mkdir -p "$T/sil-wf/.scratch/demo/evidence"; cp "$FX/ru/02-states.md" "$T/sil-wf/.scratch/demo/issues/02-states.md"
mkclip "$T/sil-wf/.scratch/demo/evidence/02-alone.webm"
tk "$T/sil" evidence demo 02 4 video pass --ref '`../evidence/02-alone.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
[ "$rc" -eq 2 ] && grep -qF "no contact sheet next to the clip" "$T/err" && cmp -s "$T/sil-wf/.scratch/demo/issues/02-states.md" "$FX/ru/02-states.md" \
    && ok "Silent mode: a clip without its contact sheet is refused too" || bad "silent video: exit $rc $(cat "$T/err")"
tk "$T/sil" evidence demo 02 4 video pass --ref '`../evidence/02-alone.webm`' --platform mac --copy dev --sha "$SHA1"
[ "$rc" -eq 2 ] && grep -qF "a video needs --scrub" "$T/err" && ok "Silent mode: a video without --scrub is refused" || bad "silent no scrub: exit $rc $(cat "$T/err")"
cp "$EVD/01-canvas.png" "$T/sil-wf/.scratch/demo/evidence/02-alone.sheet.png"
tk "$T/sil" evidence demo 02 4 video pass --ref '`../evidence/02-alone.webm`' --platform mac --copy dev --sha "$SHA1" --scrub 2026-11-05
[ "$rc" -eq 0 ] && grep -qF -- "video pass · \`../evidence/02-alone.webm\`" "$T/sil-wf/.scratch/demo/issues/02-states.md" \
    && ok "Silent mode: a clip with its sheet and --scrub is written" || bad "silent video write: exit $rc $(cat "$T/err")"

# --- 13. --repo R: a ticket of several repositories binds a line to a commit of one of them ---------------------------
# duo — two repositories of one profile, its tickets root above them; the HEADs differ, so the test sees whose is taken.
for r in lib app; do git init -q -b main "$T/duo/$r" && git -C "$T/duo/$r" commit -q --allow-empty -m "$r"; done
git -C "$T/duo/app" commit -q --allow-empty -m second
jq --arg lib "$T/duo/lib" --arg app "$T/duo/app" '.repos += [{key: "lib", match: $lib, profile: "duo", pm: "npm", root: {}, workspace: {}}, {key: "app", match: $app, profile: "duo", pm: "npm", root: {}, workspace: {}}]' \
    "$CLAUDE_GATE_CONFIG" >"$T/config.new" && mv "$T/config.new" "$CLAUDE_GATE_CONFIG"
mkdir -p "$CLAUDE_PROFILES_DIR/duo" "$T/duo/.scratch/demo/issues"; : >"$CLAUDE_PROFILES_DIR/duo/rules.md"
printf '{"schema":1,"name":"duo","tickets":{"root":"%s","done_section":"## Done when","manual_mark":"manual"}}\n' "$T/duo/.scratch" >"$CLAUDE_PROFILES_DIR/duo/profile.json"
DUO="$T/duo/.scratch/demo/issues/01-english.md"
sed -e 's/^Status: open$/Status: claimed 2026-11-09T10:00Z\nRepo: lib\nRepo: app/' "$FX/en/01-english.md" >"$DUO"
cp "$DUO" "$T/duo.orig"
APP_HEAD="$(git -C "$T/duo/app" rev-parse HEAD)"; LIB_HEAD="$(git -C "$T/duo/lib" rev-parse HEAD)"
tk "$T/duo/lib" evidence demo 01 1 test-run pass --ref '`pnpm test` exit 0' --repo app --platform mac
[ "$rc" -eq 0 ] && grep -qxF -- "  - evidence: test-run pass · [app] \`pnpm test\` exit 0 · mac - · $APP_HEAD" "$DUO" \
    && ok "--repo app without --sha, run from lib: the ref starts with [app], the sha is the HEAD of app" || bad "--repo app: exit $rc $(cat "$T/err") $(grep evidence "$DUO")"
tk "$T/duo/lib" evidence demo 01 2 owner-check pass --ref 'the owner said yes' --repo lib --platform mac --copy stable --sha abc1234
[ "$rc" -eq 0 ] && grep -qxF -- "  - evidence: owner-check pass · [lib] the owner said yes · mac stable · abc1234" "$DUO" \
    && ok "--repo lib --sha S: the line names lib and binds S" || bad "--repo lib --sha: exit $rc $(cat "$T/err")"
tk "$T/duo/lib" evidence demo 01 > /dev/null
[ "$rc" -eq 0 ] && has "1. verified — Shell test of the parser." && has "2. verified — (manual) The owner looked at the canvas." \
    && ok "a line with [repo] in its ref reads back by the grammar as it was" || bad "matrix after --repo: $(cat "$T/out")"
cp "$DUO" "$T/duo.now"
tk "$T/duo/lib" evidence demo 01 1 test-run pass --ref 'x exit 0' --repo web --sha abc1234
[ "$rc" -eq 2 ] && grep -qF '"web" is not a Repo: line' "$T/err" && cmp -s "$T/duo.now" "$DUO" && ok "--repo outside the Repo: lines -> exit 2, nothing written" || bad "--repo web: exit $rc $(cat "$T/err")"
tk "$T/duo/lib" evidence demo 01 1 test-run pass --ref 'x exit 0' --repo lib --repo app --sha abc1234
[ "$rc" -eq 2 ] && cmp -s "$T/duo.now" "$DUO" && ok "two --repo -> exit 2, nothing written" || bad "two --repo: exit $rc $(cat "$T/err")"
tk "$T/en" evidence demo 01 1 test-run pass --ref 'x exit 0' --repo en --sha abc1234
[ "$rc" -eq 2 ] && grep -qF "(none)" "$T/err" && ok "--repo on a ticket without Repo: lines -> exit 2" || bad "--repo without Repo: lines: exit $rc $(cat "$T/err")"
[ "$LIB_HEAD" != "$APP_HEAD" ] && ok "the two HEADs differ (the sha check above means something)" || bad "lib and app have one HEAD"

home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
