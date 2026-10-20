#!/usr/bin/env bash
# No skill text carries a positional token $0 ... $9. When a skill is called with arguments, Claude Code
# replaces $N in SKILL.md with the N-th word of the arguments ($0 is the first word) before the model reads
# the text, code blocks included. A shell function's "$1" or an awk field $0 then reaches the model as
# a word of the call: `F() { ... --field "$1"; }` called as `/ship-ticket demo 02` becomes `--field "02"`.
# Spellings that stay intact: "$@" for a function's argument, getline or split() into variables in awk.
# Run: bash harness/bin/tests/skill-positional-tokens.test.sh; exit code 0 - no skill carries such a token.
# SKILLS_DIR - check another copy of the skills folder.
set -u
SKILLS="${SKILLS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/skills}"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

# The token as Claude Code matches it: a dollar sign right before a digit. An escaped \$1 counts too: it
# reaches the model as $1, but the copy on disk, which the block tests run, is then a different command.
TOKEN='\$[0-9]'

# The detector itself: it finds the spellings that broke, and leaves the ones that stay intact alone.
for line in 'F() { profile --field "$1"; }' "awk '/^worktree /{w=substr(\$0,10)}'" "awk '{print \$2}'" 'echo \$1' 'x=$10'; do
    printf '%s\n' "$line" | grep -qE "$TOKEN" && ok "the detector finds: $line" || bad "the detector misses: $line"
done
for line in 'F() { profile --field "$@"; }' 'echo "${HOME}" $(date +%s) $((1 + 2)) $# $?' "awk 'BEGIN { while ((getline l) > 0) print l }'"; do
    printf '%s\n' "$line" | grep -qE "$TOKEN" && bad "the detector flags an intact spelling: $line" || ok "the detector leaves alone: $line"
done

n=0
for f in "$SKILLS"/*/SKILL.md; do
    [ -f "$f" ] || continue
    n=$((n + 1))
    name="${f#"$SKILLS"/}"
    hits="$(grep -nE "$TOKEN" "$f")"
    if [ -z "$hits" ]; then
        ok "$name: no positional token"
        continue
    fi
    while IFS= read -r hit; do
        tok="$(printf '%s\n' "${hit#*:}" | grep -oE "$TOKEN" | head -n 1)"
        bad "$name:${hit%%:*}: $tok - Claude Code replaces $tok with a word of the skill's arguments when the skill is called with arguments; write \"\$@\" for a function argument and getline or split() into variables in awk: ${hit#*:}"
    done <<<"$hits"
done
# An empty or wrong folder must not pass as clean.
[ "$n" -ge 5 ] && ok "$n SKILL.md files checked in $SKILLS" || bad "only $n SKILL.md files found in $SKILLS"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
