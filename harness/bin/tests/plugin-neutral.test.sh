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
    'ticket numbers of worfy epics|worfy-[a-z]+(/| ticket | )[0-9]{2}'
)

# file|fixed text: a line of that file may carry the text, as long as nothing forbidden is left in
# the line once the text is taken out of it.
ALLOWED=(
    # The plugin's author keeps their name in the manifest: credit stays, examples go.
    '.claude-plugin/plugin.json|"name": "Alexey"'
    # The tests of the detectors of decision-record numbers (bin/silent-check and the Silent mode
    # guard) feed them one such number.
    'bin/tests/silent-mode.test.sh|ADR-0042'
    'hooks/tests/guard-silent.test.sh|ADR-0042'
)
# The files of the plugin: the tracked ones when harness/ is in a git checkout (git ls-files run in
# harness/ prints paths from there), else every file.
LIST="$(cd "$HARNESS" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files; else
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

for p in "${PATTERNS[@]}"; do
    name="${p%%|*}" re="${p#*|}"
    hits=""
    while IFS= read -r f; do
        [ -n "$f" ] && [ "$f" != "$SELF" ] && [ -f "$HARNESS/$f" ] || continue
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
    grep -q -F -- "$text" "$HARNESS/$f" 2>/dev/null && ok "exception still needed: $f" || bad "stale exception: $a"
done

echo "plugin-neutral: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
