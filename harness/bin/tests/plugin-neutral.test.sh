#!/usr/bin/env bash
# The plugin is neutral: no file under harness/ names one particular owner, their machine, their
# work projects or the internals of the worfy repository. Rules explain themselves instead of
# pointing at a decision record or a ticket number that only the worfy repository has.
# Run: bash harness/bin/tests/plugin-neutral.test.sh; exit code 0 — nothing forbidden was found.
#
# The forbidden patterns and their only exceptions live in this file, and this file is the one
# file the scan skips. Examples in the Harness use generic names instead: demo, acme,
# /home/me/work/acme, octo-org.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
SELF="bin/tests/plugin-neutral.test.sh"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

# name|extended regular expression, matched without regard to letter case
PATTERNS=(
    'work projects of the owner|auction|atakama|flux-config-platform'
    'macOS home folders|/users/'
    'names or accounts of the owner|alexey|oleksii|idsad|canvasforai'
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
    # The plugin's author keeps their name in the manifest: credit stays, examples go.
    '.claude-plugin/plugin.json|"name": "Alexey"'
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
    # Script files of the worfy repository named before the pattern was added; each is a known leak
    # to remove, kept here so that a new one is caught.
    'README.md|scripts/eval-harness.mjs'
    'README.md|scripts/eval-harness-coverage.mjs'
    'bin/ticket|scripts/install-stable.mjs'
)
# The files of the plugin: in a git checkout the tracked ones and the new ones git does not ignore
# (git ls-files run in harness/ prints paths from there, quotepath off keeps non-ASCII names as they
# are), else every file.
LIST="$(cd "$HARNESS" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -c core.quotepath=off ls-files --cached --others --exclude-standard; else
    find . -type f -not -path '*/node_modules/*' | sed 's|^\./||'; fi)"
[ -n "$LIST" ] && ok "the plugin has files to scan" || bad "no files found under $HARNESS"

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
