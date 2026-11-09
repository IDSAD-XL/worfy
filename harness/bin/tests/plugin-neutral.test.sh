#!/usr/bin/env bash
# The plugin is neutral: no file under harness/ names one particular owner, their machine, their
# work projects or the internals of the worfy repository. Rules explain themselves instead of
# pointing at a decision record or a ticket number that only the worfy repository has.
# Run: bash harness/bin/tests/plugin-neutral.test.sh; exit code 0 — nothing forbidden was found.
#
# Two scans. The words of one person — the owner's names and accounts, their machine, their work
# projects, the account of the repository the plugin comes from — are never written here: the list
# next to this file (plugin-neutral.words.json) holds only the SHA-256 of each word, and
# plugin-neutral-words.mjs finds them in every file and path, inside longer words too and whatever
# the letter case. The other forbidden patterns are regular expressions below; they and their
# exceptions live in this file, the one file the regular expressions skip. Both scans need nothing
# outside harness/ and no git: they run the same from an installed copy of the plugin. Examples in
# the Harness use generic names instead: demo, acme, /home/you/work/acme, octo-org.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
SELF="bin/tests/plugin-neutral.test.sh"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# A folder the way node reads it: Git Bash on Windows prints /c/…, `pwd -W` C:/….
node_dir() { (cd "$1" && { pwd -W 2>/dev/null || pwd -P; }); }
WORDS="$(node_dir "$HARNESS")/bin/tests/plugin-neutral-words.mjs"

# name|extended regular expression, matched without regard to letter case
PATTERNS=(
    'macOS home folders|/users/'
    'decision record numbers|adr-[0-9]{4}'
    'paths inside the worfy app sources|src/main/'
    'script and workflow files of the worfy repository|scripts/[a-z0-9_.-]+\.(mjs|cjs|js|ts|sh)|\.github/workflows/[a-z0-9_.-]+\.ya?ml'
    'ticket numbers and waves of worfy epics|worfy-[a-z]+(/| ticket | )[0-9]{2}|worfy-[a-z]+, waves? [0-9]'
    'bare ticket numbers|(^|[^a-z0-9/_-])tickets? [0-9]{2}([^0-9]|$)'
)
# name|path prefix: a pattern does not look into these files. The eval cases are fixtures of the epic
# demo: "ticket 01" there is a ticket of that fixture, not one of worfy's.
SKIP=(
    'bare ticket numbers|evals/'
)

# file|fixed text: a line of that file may carry the text, as long as nothing forbidden is left in
# the line once the text is taken out of it.
ALLOWED=(
    # The tests of the detectors of decision-record and ticket numbers (bin/silent-check and the
    # Silent mode guard) feed them such numbers.
    'bin/tests/silent-mode.test.sh|ADR-0042'
    'hooks/tests/guard-silent.test.sh|ADR-0042'
    'bin/tests/silent-mode.test.sh|Ticket 05'
    'hooks/tests/guard-silent.test.sh|Ticket 05'
    # Generic examples in the text agents read: a phrase the rules forbid, the form of the wave
    # command, a line epic-status prints.
    'hooks/rules/common.md|ticket 04 from'
    'skills/epic-wave/SKILL.md|tickets 05, 06'
    'skills/continuous-audit/SKILL.md|ticket 01 — …'
    # Tickets of the tests' own fixtures and the output and commands the tests expect for them.
    'bin/tests/epic-status.test.sh|ticket 01 — '
    'bin/tests/epic-status.test.sh|ticket 02 — '
    'bin/tests/tickets-root.test.sh|ticket 01'
    'bin/tests/harness-home.test.sh|ticket 03 an old header'
    'bin/tests/decision-log.test.sh|ticket 05 taken out'
    'bin/tests/decision-log.test.sh|Ticket 07 '
    'bin/tests/decision-log.test.sh|tickets 02, 06'
    'bin/tests/epic-wave-ship-ticket.test.sh|tickets 05, 06'
    'bin/tests/review-depth.test.sh|tickets 05, 06'
    'bin/tests/skill-blocks.test.sh|tickets 02, 02'
    # A script of the tests' own fixture project.
    'bin/tests/shortcut-ledger.test.sh|scripts/make.sh'
    # The upstream text of the skills copied from another author (skills/THIRD_PARTY.md): a URL path
    # in an example, an example decision record, the skill's own template script and its map entry.
    'skills/tdd/mocking.md|fetch(`/users/'
    'skills/improve-codebase-architecture/SKILL.md|contradicts ADR-0007'
    'skills/diagnosing-bugs/SKILL.md|`scripts/hitl-loop.template.sh`'
    'evals/lib/coverage.json|"skills/diagnosing-bugs/scripts/hitl-loop.template.sh"'
    # Script files of the worfy repository named before the pattern was added; each is a known leak
    # to remove, kept here so that a new one is caught.
    'README.md|scripts/eval-harness.mjs'
    'README.md|scripts/eval-harness-coverage.mjs'
    'bin/ticket|scripts/install-stable.mjs'
)
# list_files <dir> — the files of the plugin: in a git checkout the tracked ones and the new ones git
# does not ignore (git ls-files run in <dir> prints paths from there, quotepath off keeps non-ASCII
# names as they are), else every file.
list_files() {
    (cd "$1" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        git -c core.quotepath=off ls-files --cached --others --exclude-standard; else
        find . -type f -not -path '*/node_modules/*' | sed 's|^\./||'; fi)
}
LIST="$(list_files "$HARNESS")"
[ -n "$LIST" ] && ok "the plugin has files to scan" || bad "no files found under $HARNESS"

# words <dir> [--words <list>] — the word scan of <dir> over its list_files; its output is in $out.
words() { local dir="$1"; shift; out="$(list_files "$dir" | node "$WORDS" "$(node_dir "$dir")" "$@" 2>&1)"; }

# The word scan itself, on two files in a folder of their own: the account of the repository (the
# author in the manifest, a word of the list) inside a longer word in another letter case, and an
# invented word of a list of the test's own glued into another. Both are found outside git and in a
# checkout; GIT_CEILING_DIRECTORIES keeps git from taking a repository above the temporary folder.
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export GIT_CEILING_DIRECTORIES="$T"
author="$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' "$HARNESS/.claude-plugin/plugin.json" | tail -n 1)"
mixed="$(printf '%s' "$author" | tr '[:upper:][:lower:]' '[:lower:][:upper:]')"
node "$WORDS" --word zorkquux | sed 's/^/{"words": [/; s/$/]}/' >"$T/own-list.json"
for where in outside-git checkout; do
    mkdir -p "$T/$where/docs"
    printf 'see the%sfork of it\n' "$mixed" >"$T/$where/docs/account.md"
    printf 'nothing here\nan xZorkQuuxy word\n' >"$T/$where/docs/invented.md"
    [ "$where" = checkout ] && git -C "$T/$where" init -q && git -C "$T/$where" add -A
    words "$T/$where"; rc=$?
    [ -n "$author" ] && [ "$rc" -eq 1 ] && [[ "$out" == *"docs/account.md:1: the account of the repository"* ]] \
        && ok "word scan, $where: the account of the repository inside a longer word" || bad "word scan, $where: account not found (exit $rc): $out"
    words "$T/$where" --words "$(node_dir "$T")/own-list.json"; rc=$?
    [ "$rc" -eq 1 ] && [[ "$out" == *"docs/invented.md:2: a forbidden word (zo…(8))"* ]] && [[ "$out" != *account.md* ]] \
        && ok "word scan, $where: an invented word glued into another" || bad "word scan, $where: invented word not found (exit $rc): $out"
done

unset GIT_CEILING_DIRECTORIES

# The plugin: no word of the list in any file or path, every exception of the list still needed.
words "$HARNESS"; rc=$?
if [ "$rc" -eq 0 ]; then
    ok "no word of plugin-neutral.words.json in the files and paths of the plugin"
else
    bad "word scan (exit $rc), $(printf '%s\n' "$out" | grep -c .) findings:"
    printf '%s\n' "$out" | head -40
fi

allowed() { # $1 file, $2 line text, $3 the pattern
    local a rest
    for a in "${ALLOWED[@]}"; do
        [ "${a%%|*}" = "$1" ] && [[ "$2" == *"${a#*|}"* ]] || continue
        rest="${2//"${a#*|}"/}"
        printf '%s\n' "$rest" | grep -q -i -E -- "$3" || return 0
    done
    return 1
}

skipped() { # $1 pattern name, $2 file
    local x
    for x in "${SKIP[@]}"; do
        [ "${x%%|*}" = "$1" ] && [[ "$2" == "${x#*|}"* ]] && return 0
    done
    return 1
}

for p in "${PATTERNS[@]}"; do
    name="${p%%|*}" re="${p#*|}"
    hits=""
    while IFS= read -r f; do
        [ -n "$f" ] && [ "$f" != "$SELF" ] && [ -f "$HARNESS/$f" ] || continue
        skipped "$name" "$f" && continue
        while IFS= read -r line; do
            n="${line%%:*}" text="${line#*:}"
            allowed "$f" "$text" "$re" || hits+="    $f:$n: ${text:0:160}"$'\n'
        done < <(grep -n -i -E -I -- "$re" "$HARNESS/$f" 2>/dev/null)
    done <<<"$LIST"
    if [ -z "$hits" ]; then
        ok "no $name ($re)"
    else
        bad "$name ($re) in $(printf '%s' "$hits" | grep -c .) lines:"
        printf '%s' "$hits" | head -40
    fi
done

# The exceptions are still needed: an allowed text that no file carries any more is a stale exception.
for a in "${ALLOWED[@]}"; do
    f="${a%%|*}" text="${a#*|}"
    grep -q -F -- "$text" "$HARNESS/$f" 2>/dev/null && ok "exception still needed: $a" || bad "stale exception: $a"
done

echo "plugin-neutral: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
