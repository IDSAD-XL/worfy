#!/usr/bin/env bash
# The review depth contract (ticket worfy-review/08): review depth is a setting with four values —
# low, medium, high, max — read from the profile fields review.depth.wave, review.depth.first_round
# and review.depth.later_rounds and overridden by an argument of skills ship-ticket and epic-wave.
# Checked here: the profile contract (profiles/README.md) and the draft schema (run through
# bin/project-connect --schema-only: a profile with review.depth and without it passes, a value outside
# the four fails); the text of ship-ticket (step 7 and the review of another session's PR), epic-wave
# (sections 3 and 5) and max-review (max depth, the token line); the recorded verdict with the two report
# lines still counts as one round; the new lines carry no Cyrillic.
# Run: bash harness/bin/tests/review-depth.test.sh; exit code 0 means every check passed.
# SHIP_TICKET_FILE / EPIC_WAVE_FILE / MAX_REVIEW_FILE / PROFILES_README / CONNECT_BIN point it at other copies.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
ST="${SHIP_TICKET_FILE:-$HARNESS/skills/ship-ticket/SKILL.md}"
EW="${EPIC_WAVE_FILE:-$HARNESS/skills/epic-wave/SKILL.md}"
MR="${MAX_REVIEW_FILE:-$HARNESS/skills/max-review/SKILL.md}"
RD="${PROFILES_README:-$HARNESS/profiles/README.md}"
CONNECT="${CONNECT_BIN:-$HARNESS/bin/project-connect}"
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; the registry's "match"
# must be in that spelling, or bin/profile does not find the repository (/tmp/… is C:\tmp\… to node).
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# check <name> <condition command...>
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
# The texts are wrapped: phrases are looked up with line breaks folded into spaces.
flat() { tr '\n' ' ' | tr -s ' '; }
in_text() { [[ "$1" == *"$2"* ]]; }
lacks() { ! in_text "$1" "$2"; }
section() { awk -v re="^## $2" '$0 ~ re {p=1; next} /^## /{p=0} p' "$1"; }    # section <file> <heading start>

for f in "$ST" "$EW" "$MR" "$RD" "$CONNECT"; do
    [ -f "$f" ] || { echo "FAIL missing $f"; echo "passed $pass, failed $((fail + 1))"; exit 1; }
done
st="$(flat <"$ST")"; ew="$(flat <"$EW")"; mr="$(flat <"$MR")"; rd="$(flat <"$RD")"
st7="$(section "$ST" '7\.' | flat)"
stpr="$(section "$ST" 'Review of a PR another session wrote' | flat)"
ew3="$(section "$EW" '3\.' | flat)"
ew5="$(section "$EW" '5\.' | flat)"

# The sentences both skills carry word for word: the blocking rule and the two report lines.
BLOCK='What blocks a merge, at every depth: a `high` or `med` finding in the code, or a gap in the tests that guard a destructive action (a delete, stopping a process, replacing a copy). The other gaps go as a list into a follow-up ticket.'
LINE_DEPTH='Review depth: <depth> — <where it came from>'
LINE_TOKENS='Review tokens: <subagent tokens of the round> | not measured'
NOT_FIRST='never the first line, and neither starts with `REJECTED` or `gate:`'
NOT_ESTIMATE='an agent whose result shows no count makes the line `Review tokens: not measured`, never an estimate'

# --- 1. The profile contract ------------------------------------------------------------------------
for fld in wave first_round later_rounds; do
    check "README: a row for review.depth.$fld" grep -qF "| \`review.depth.$fld\` |" "$RD"
done
check "README: the four values" in_text "$rd" '`"low"` \| `"medium"` \| `"high"` \| `"max"` \| null'
check "README: no review.depth.wave — low depth" in_text "$rd" 'absent or `null` — `low` depth'
# Without the field the review of a ticket's own diff keeps its old form and cost; the high and medium
# defaults are for a PR another session wrote only.
check "README: no review.depth.first_round — a ticket's own review as before, another session's PR high" in_text "$rd" \
    'absent or `null` — the review of a ticket'"'"'s own diff stays as it was, without a depth (two or three reviewers by `review.ticket_lenses`, the same cost as before), and a PR another session wrote gets `high` depth'
check "README: no review.depth.later_rounds — a ticket's own repeat review as before, another session's PR medium" in_text "$rd" \
    'absent or `null` — the repeat review of a ticket'"'"'s own diff stays as it was, and a PR another session wrote gets `medium` depth'
check "README: no first_round row that makes high the default of every review" lacks "$rd" 'absent or `null` — `high` depth'
check "README: the skill says it took the default" in_text "$rd" 'the skill says in its report that it took the default'
check "README: the depth scale is described in ship-ticket step 7" in_text "$rd" 'the scale is described in skill `ship-ticket`, step 7'

# --- 2. The draft schema: with review.depth, without it, a value outside the four --------------------
# draft <review JSON> — a Full mode draft as skill connect-project proposes it, with the given review.
draft() {
    node - "$1" "$T/repo" <<'NODE'
const [review, match] = process.argv.slice(2)
const profile = {
  schema: 2, name: "shop", title: "shop", mode: "full",
  language: { reports: "en", team: "en", docs: "en" }, attribution: "on",
  layout: { summary: "one package", packages: ["."], repos: null }, stack: ["node"],
  commands: { install: "npm ci", lint: "npm run lint", typecheck: null, test: "npm test", test_one: null, contract: null, e2e: null,
              build: null, verify: "npm run lint && npm test", prepare_tree: "npm ci", requires: [] },
  parallel: "worktrees",
  worktree: { root: match + "/.claude/worktrees/", base: "origin/main", implementer: null, reviewer: null },
  tickets: { root: ".scratch/", path: ".scratch/<эпик>/issues/NN-*.md", trail_section: "## Where in the code", spec: ".scratch/<эпик>/spec.md", branch: null },
  workflow: { folder: null, ticket_skill: "ship-ticket", implementer_steps: "steps 1-8", finish: "local-green", merge: "orchestrator" },
  numbering: null, deploy: null, github: { account: null }, docs: null, lessons: "repo:docs/lessons",
  mcp: { allowed: ["plugin_worfy_qmd", "worfy-canvas"] }, review: JSON.parse(review),
}
const gate = [{ key: "shop", match, profile: "shop", pm: "npm", root: { fast: ["lint", "test"], full: ["lint", "test"] }, workspace: {} }]
process.stdout.write(JSON.stringify({ profile, rules: "# shop\n\n## Sources\n\n- package.json\n", gate }))
NODE
}
# schema <name> <expected exit> <expected output fragment> <review JSON>
schema() {
    local name="$1" want="$2" frag="$3" out code
    draft "$4" >"$T/draft.json" || { bad "$name (the draft was not built)"; return; }
    out="$(HARNESS_HOME="$T/hh" "$CONNECT" --schema-only <"$T/draft.json" 2>&1)"; code=$?
    if [ "$code" -eq "$want" ] && in_text "$out" "$frag"; then ok "$name"; else bad "$name (exit $code: $(printf '%s' "$out" | head -c 400))"; fi
}
mkdir -p "$T/hh" "$T/repo"
L='"lenses":["correctness"],"ticket_lenses":["correctness"]'
schema "schema: a profile without review.depth passes" 0 '"ok": true' "{$L}"
schema "schema: review.depth with the three fields passes" 0 '"ok": true' "{$L,\"depth\":{\"wave\":\"low\",\"first_round\":\"high\",\"later_rounds\":\"medium\"}}"
schema "schema: review.depth max passes" 0 '"ok": true' "{$L,\"depth\":{\"first_round\":\"max\"}}"
schema "schema: review.depth null passes" 0 '"ok": true' "{$L,\"depth\":null}"
schema "schema: a depth field null passes" 0 '"ok": true' "{$L,\"depth\":{\"wave\":null}}"
schema "schema: a value outside the four is refused, the field named" 1 '"path": "profile.review.depth.wave"' "{$L,\"depth\":{\"wave\":\"extreme\"}}"
schema "schema: a depth as a number is refused" 1 '"path": "profile.review.depth.later_rounds"' "{$L,\"depth\":{\"later_rounds\":3}}"
schema "schema: an unknown depth field is refused" 1 '"path": "profile.review.depth.first-round"' "{$L,\"depth\":{\"first-round\":\"high\"}}"
schema "schema: review.depth as a string is refused" 1 '"path": "profile.review.depth"' "{$L,\"depth\":\"high\"}"
check "schema: --schema-only wrote nothing into HARNESS_HOME" test -z "$(ls -A "$T/hh")"

# --- 2a. bin/profile reads the three-part field; a profile without it gives exit 4 -------------------
PROFILE="$HARNESS/bin/profile"
mkdir -p "$T/p/withd" "$T/p/nod" "$T/r1" "$T/r2"
git -C "$T/r1" init -q -b main; git -C "$T/r2" init -q -b main
printf '{"schema":2,"name":"withd","mode":"full","review":{"lenses":["a"],"ticket_lenses":["a"],"depth":{"wave":"medium","first_round":"max","later_rounds":"low"}}}\n' >"$T/p/withd/profile.json"
printf '{"schema":2,"name":"nod","mode":"full","review":{"lenses":["a"],"ticket_lenses":["a"]}}\n' >"$T/p/nod/profile.json"
printf '{"repos":[{"key":"withd","match":"%s","profile":"withd"},{"key":"nod","match":"%s","profile":"nod"}]}\n' "$T/r1" "$T/r2" >"$T/config.json"
# field <repo> <field> — prints "<exit>:<value>"
field() { local v c; v="$(CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/p" "$PROFILE" -C "$1" --field "$2" 2>/dev/null)"; c=$?; printf '%s:%s' "$c" "$v"; }
check "profile: review.depth.wave is read" test "$(field "$T/r1" review.depth.wave)" = "0:medium"
check "profile: review.depth.first_round is read" test "$(field "$T/r1" review.depth.first_round)" = "0:max"
check "profile: review.depth.later_rounds is read" test "$(field "$T/r1" review.depth.later_rounds)" = "0:low"
for fld in wave first_round later_rounds; do
    check "profile: no review.depth — review.depth.$fld is exit 4" test "$(field "$T/r2" "review.depth.$fld")" = "4:"
done

# --- 3. ship-ticket, step 7: the scale, where the depth comes from, the report ------------------------
for d in low medium high max; do
    check "ship-ticket step 7: a row for $d depth" bash -c 'grep -qE "^\| \`$1\` \| " <<<"$2"' _ "$d" "$(section "$ST" '7\.')"
done
check "ship-ticket: the columns — agents, lenses, mutation testing, refute, cost" in_text "$st7" '| Depth | Agents | Lenses | Mutation testing | Refute (sceptic agents) | Cost of a round, subagent tokens |'
check "ship-ticket: low — one reviewer reads the diff and runs the tests" in_text "$st7" '| `low` | one reviewer | one: it reads the diff and runs the tests of the change'
check "ship-ticket: medium — mutation testing of the changed lines, refute for high and med" in_text "$st7" 'changed lines only | one sceptic per `high` and `med` finding |'
check "ship-ticket: high — every code line, refute for every finding" in_text "$st7" 'every code line of the change | one sceptic per finding |'
check "ship-ticket: high — a security lens" in_text "$st7" 'a `security` lens'
check "ship-ticket: max is high, then /worfy:max-review" in_text "$st7" '`max` depth is `high` depth, then `/worfy:max-review` on the whole branch'
check "ship-ticket: the measured cost of high" in_text "$st7" '5.3–6.4 million (measured 2026-10-12)'
check "ship-ticket: depth is always written with the word depth" in_text "$st7" 'a depth is always written with the word "depth"'
check "ship-ticket: the argument" in_text "$st7" '`/worfy:ship-ticket <epic> <NN> depth <low|medium|high|max>`'
check "ship-ticket: the owner's word is the same argument" in_text "$st7" "The owner's word in a message (\`review #237 — low\`, in any language) is the same argument"
check "ship-ticket: reads review.depth.first_round" in_text "$st7" '`F review.depth.first_round`'
check "ship-ticket: reads review.depth.later_rounds" in_text "$st7" '`F review.depth.later_rounds`'
check "ship-ticket: no field — a ticket's own review stays two or three reviewers by ticket_lenses" in_text "$st7" \
    "No field (exit 4 or \`null\`) and no argument — the review of the ticket's own diff stays as it was, without a depth: two or three reviewers in parallel, one lens each, by \`F review.ticket_lenses\`"
check "ship-ticket: no field — the report says so" in_text "$st7" '`Review depth: ticket lenses — default: the profile has no review.depth.first_round`'
check "ship-ticket: the high and medium defaults are for another session's PR only" in_text "$st7" 'The defaults `high` depth and `medium` depth are only for a PR another session wrote'
check "ship-ticket: step 7 has no high default for a ticket's own review" lacks "$st7" 'No field (exit 4 or `null`) — `high` depth'
check "ship-ticket: medium depth names its lenses for a first round" in_text "$st7" 'in a first round, which has no previous report, the first two of `F review.ticket_lenses`'
check "epic-wave: medium depth names its lens for a first round" in_text "$ew3" '(in a first round, the first of `F review.ticket_lenses`)'
for f in "$ST" "$EW" "$MR"; do
    left="$(flat <"$f" | grep -oE 'the `high` (agents|lenses|round)|as `high` [|,]|`high` round' | head -n 2 | tr '\n' ' ')"
    check "$(basename "$(dirname "$f")"): a depth next to high carries the word depth${left:+ — first: $left}" test -z "$left"
done
check "ship-ticket: max only on the owner's request" in_text "$st7" '`max` depth runs only when the owner asks for it'
check "ship-ticket: the blocking rule" in_text "$st7" "$BLOCK"
check "ship-ticket: the depth line of the report" in_text "$st7" "$LINE_DEPTH"
check "ship-ticket: the token line of the report" in_text "$st7" "$LINE_TOKENS"
check "ship-ticket: the report lines are not the verdict's first line" in_text "$st7" "$NOT_FIRST"
check "ship-ticket: no count — not measured, not an estimate" in_text "$st7" "$NOT_ESTIMATE"
check "ship-ticket: the full local check is outside the scale" in_text "$st" 'is outside the depth scale'

# --- 4. ship-ticket: the review of a PR another session or person wrote ------------------------------
check "ship-ticket: the section exists" grep -qx '## Review of a PR another session wrote' "$ST"
check "ship-ticket: the description names the review of another session's PR" bash -c 'grep -m1 "^description:" "$1" | grep -qF "reviewing a PR another session or person wrote"' _ "$ST"
check "ship-ticket PR review: depth as in step 7" in_text "$stpr" 'The depth of every round is chosen as in step 7'
check "ship-ticket PR review: documents only — no review agents" in_text "$stpr" 'A PR that changes only documents gets no review agents'
check "ship-ticket PR review: tests and comments only — medium first round" in_text "$stpr" 'A PR that changes only tests and comments gets `medium` depth in its first round'
check "ship-ticket PR review: tests and comments only — a lower first_round wins" in_text "$stpr" '(the depth of `F review.depth.first_round`, if that is lower)'
check "ship-ticket PR review: a PR with code — high depth without the field" in_text "$stpr" 'its first round has the depth of `F review.depth.first_round`, `high` depth without the field'
check "ship-ticket PR review: later rounds — medium depth without the field" in_text "$stpr" 'Every later round has the depth of `F review.depth.later_rounds`, `medium` depth without the field'
check "ship-ticket PR review: without the field the PR review always has a depth" in_text "$stpr" 'but without the field the review of such a PR always has a depth'
check "ship-ticket PR review: any code or script line outside tests is a PR with code" in_text "$stpr" 'A PR that touches any line of code or of a script outside the tests is a PR with code'
check "ship-ticket PR review: the three-round limit" in_text "$stpr" 'At most three review rounds per PR, unless a `high` finding remains.'
check "ship-ticket PR review: the limit is not the wave's" in_text "$stpr" 'A wave keeps its own count of rounds (`/worfy:epic-wave`, section 3)'
check "ship-ticket PR review: the blocking rule" in_text "$stpr" "$BLOCK"
check "ship-ticket PR review: the owner's manual items do not hold the merge" in_text "$stpr" "The owner's manual acceptance items do not hold the merge"
check "ship-ticket PR review: both report lines in the verdict" in_text "$stpr" "$LINE_DEPTH"

# --- 5. epic-wave, sections 3 and 5 ------------------------------------------------------------------
for d in low medium high max; do
    check "epic-wave section 3: a row for $d depth" bash -c 'grep -qE "^\| \`$1\` \| " <<<"$2"' _ "$d" "$(section "$EW" '3\.')"
done
check "epic-wave: reads review.depth.wave" in_text "$ew3" '`F review.depth.wave`'
check "epic-wave: the argument" in_text "$ew3" '`/worfy:epic-wave tickets 05, 06 of epic X depth medium`'
check "epic-wave: the owner's word is the same argument" in_text "$ew3" "the owner's word in the message (\`wave depth medium\`, in any language) is the same argument"
check "epic-wave: no field — low depth, said in words" in_text "$ew3" 'No field (exit 4 or `null`) — `low` depth, the gate as described above, and the report says so'
check "epic-wave: the price above low is said" in_text "$ew3" 'A wave depth above `low` is expensive: before the dispatch, say its price'
check "epic-wave: max is high, then /worfy:max-review" in_text "$ew3" '`max` depth is `high` depth, then `/worfy:max-review`'
check "epic-wave: the depth does not change the count of rounds" in_text "$ew3" 'The depth does not change the count of rounds'
check "epic-wave: the three-round limit does not apply in a wave" in_text "$ew3" 'The limit of three review rounds of a PR another session wrote (`/worfy:ship-ticket`) does not apply in a wave.'
check "epic-wave: the blocking rule" in_text "$ew3" "$BLOCK"
check "epic-wave: the depth line of the recorded verdict" in_text "$ew3" "$LINE_DEPTH"
check "epic-wave: the token line of the recorded verdict" in_text "$ew3" "$LINE_TOKENS"
check "epic-wave: the report lines are not the verdict's first line" in_text "$ew3" "$NOT_FIRST"
check "epic-wave: no count — not measured, not an estimate" in_text "$ew3" "$NOT_ESTIMATE"
check "epic-wave: the report lines close every verdict, VERIFIED and NARROW too" in_text "$ew3" '**The two report lines** close every recorded verdict, `VERIFIED` and `NARROW: …` too'
check "epic-wave report: the depth and token lines of every ticket" in_text "$ew5" 'for every ticket of the table, the two report lines of its gate (section 3)'

# --- 6. max-review: max depth and the token line ---------------------------------------------------------
check "max-review: max depth is high, then this mode" in_text "$mr" '`max` depth of skill `/worfy:ship-ticket`, step 7, and of a wave (`/worfy:epic-wave`, section 3) is `high` depth first, then this mode'
check "max-review: the report names the depth and the tokens" in_text "$mr" "$LINE_TOKENS"

# --- 7. The recorded verdict with the report lines is still one round ----------------------------------
# The example block of epic-wave section 3: the first line is the verdict, no other line starts with
# REJECTED or gate:, so the counts of rounds (comments starting with REJECTED, commits ^gate: REJECTED)
# see one round.
awk '/^```/{if(inb){if(index(buf,"Review tokens:")) printf "%s", buf; inb=0; buf=""} else {inb=1}; next} inb{buf=buf $0 "\n"}' "$EW" >"$T/verdict.txt"
check "verdict block: found in epic-wave" test -s "$T/verdict.txt"
check "verdict block: the first line is REJECTED" bash -c 'head -n1 "$1" | grep -q "^REJECTED: "' _ "$T/verdict.txt"
check "verdict block: the depth line follows" grep -q '^Review depth: ' "$T/verdict.txt"
check "verdict block: one line starts with REJECTED" test "$(grep -c '^REJECTED' "$T/verdict.txt")" -eq 1
check "verdict block: no line starts with gate:" test "$(grep -c '^gate:' "$T/verdict.txt")" -eq 0
git -C "$T" init -q -b main "$T/g" && git -C "$T/g" -c user.name=t -c user.email=t@t commit -q --allow-empty -m base
{ printf 'gate: '; cat "$T/verdict.txt"; } >"$T/msg.txt"
git -C "$T/g" -c user.name=t -c user.email=t@t commit -q --allow-empty -F "$T/msg.txt"
check "verdict block: as a gate: commit it counts as one REJECTED round" \
    test "$(git -C "$T/g" log --format=%s HEAD~1..HEAD | grep -c '^gate: REJECTED')" -eq 1
printf '\n%s\n' "$(cat "$T/msg.txt")" >"$T/ticket.md"
check "verdict block: as lines of a ticket file it counts as one REJECTED round" test "$(grep -c '^gate: REJECTED' "$T/ticket.md")" -eq 1

# --- 8. The new lines are in English -----------------------------------------------------------------------
for f in "$ST" "$EW" "$MR" "$RD"; do
    left="$(perl -CSD -ne 'print "$.: $_" if /(review\.depth|\bdepth\b|Review tokens)/ && /\p{Cyrillic}/' "$f" | head -n 3)"
    check "$(basename "$(dirname "$f")")/$(basename "$f"): no Cyrillic on the depth lines${left:+ — first: $left}" test -z "$left"
done

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
