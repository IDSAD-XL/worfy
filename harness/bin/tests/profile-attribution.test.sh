#!/usr/bin/env bash
# Tests of harness/bin/profile: the values of attribution (null, broken, schema 1), language.docs, mcp.allowed, the
# four Harness paths, placeholders and rules.md headings in their English form, and schema 1 leftovers. The machine
# is profile-schema2-world.sh: a temporary HOME and HARNESS_HOME.
# Run: bash harness/bin/tests/profile-attribution.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/profile-world.sh"
. "$HERE/profile-schema2-world.sh"
# --json carries the resolved attribution (profile-schema2.test.sh has its first cases).
attr_json=(bash -c 'set -o pipefail; "$@" --json | jq -r .attribution' _ "$P2" -C)

eq "--json attribution absent, Silent mode -> off" off "${attr_json[@]}" "$T/r/home"
eq "--json attribution: an explicit on in Silent mode wins" on "${attr_json[@]}" "$T/r/silenton"
eq "--json attribution: an explicit off in Full mode wins" off "${attr_json[@]}" "$T/r/fulloff"
# Schema 1 has no mode: a "mode" written there does not turn the default to off.
eq "--field attribution absent, schema 1 that names mode silent -> on" on "$P2" -C "$T/r/legacysilent" --field attribution
eq "schema 1 that names mode silent: --field mode -> full" full "$P2" -C "$T/r/legacysilent" --field mode
# null is "not set": the default of the mode.
eq "--field attribution null, Silent mode -> off" off "$P2" -C "$T/r/silentnull" --field attribution
eq "--field attribution null, Full mode -> on" on "$P2" -C "$T/r/fullnull" --field attribution
eq "--json attribution null, Silent mode -> off" off "${attr_json[@]}" "$T/r/silentnull"
eq "--json attribution null, Full mode -> on" on "${attr_json[@]}" "$T/r/fullnull"
# Any other value is a broken profile, exit 1 with the value named, in every way of asking — as with "mode".
for v in "${ATTR_BAD[@]}"; do
    for m in silent full; do
        fails_with "attribution ${v#*:}, $m -> 1 with the reason (--field)" 1 "\"attribution\" is \"on\" or \"off\", got ${v#*:} — broken profile" "$P2" -C "$T/r/$m${v%%:*}" --field attribution
        fails_with "attribution ${v#*:}, $m -> 1 (--json)" 1 '"attribution"' "$P2" -C "$T/r/$m${v%%:*}" --json
        fails_with "attribution ${v#*:}, $m -> 1 (--name)" 1 '"attribution"' "$P2" -C "$T/r/$m${v%%:*}" --name
        check "attribution ${v#*:}, $m: nothing on stdout" 1 "" bash -c '[ -n "$("$@" 2>/dev/null)" ]' _ "$P2" -C "$T/r/$m${v%%:*}" --field attribution
    done
done
fails_with "schema 1: attribution \"OFF\" -> 1 with the reason" 1 'got "OFF"' "$P2" -C "$T/r/legacybad" --field attribution
# The summary agents read prints the resolved profile: a Silent project without the field shows off there.
check "summary of a Silent profile without attribution names off" 0 '"attribution": "off"' "$P2" -C "$T/r/home"
check "summary of a Full profile without attribution names on" 0 '"attribution": "on"' "$P2" -C "$T/r/bare"
eq "--field language.docs absent -> en" en "$P2" -C "$T/r/bare" --field language.docs
eq "--field language.docs of a string language (schema 1) is that language" ru "$P2" -C "$T/r/legacy" --field language.docs
eq "--field language.docs from the file" ru "$P2" -C "$T/r/demo" --field language.docs
check "--field mcp.allowed is a JSON list from the file" 0 "" bash -c '[ "$("$@" | node -e "console.log(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")).join(\",\"))")" = qmd,worfy-canvas,github ]' _ "$P2" -C "$T/r/demo" --field mcp.allowed
check "--field mcp.allowed absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field mcp.allowed
# The four Harness paths: answered with this Harness's own scripts, never from a schema 2 file.
eq "schema 2: tickets.status_tool -> bin next to profile" "$BINOUT/ticket" "$P2" -C "$T/r/demo" --field tickets.status_tool
eq "schema 2: tickets.epic_status -> bin next to profile" "$BINOUT/epic-status" "$P2" -C "$T/r/demo" --field tickets.epic_status
eq "schema 2: numbering.reserve_with -> bin next to profile" "$BINOUT/preflight" "$P2" -C "$T/r/demo" --field numbering.reserve_with
eq "schema 2: workflow.preflight -> bin next to profile" "$BINOUT/preflight --epic <epic>" "$P2" -C "$T/r/demo" --field workflow.preflight
eq "schema 2: without the fields: tickets.status_tool still answered" "$BINOUT/ticket" "$P2" -C "$T/r/bare" --field tickets.status_tool
eq "schema 1: ~/.claude/bin/ticket -> the same path as v2" "$BINOUT/ticket" "$P2" -C "$T/r/legacy" --field tickets.status_tool
eq "schema 1: ~/.claude/bin/epic-status -> bin next to profile" "$BINOUT/epic-status" "$P2" -C "$T/r/legacy" --field tickets.epic_status
eq "schema 1: ~/.claude/bin/preflight --epic -> bin next to profile, the placeholder in English" "$BINOUT/preflight --epic <epic>" "$P2" -C "$T/r/legacy" --field workflow.preflight
eq "schema 1: null stays null" null "$P2" -C "$T/r/legacy" --field numbering.reserve_with
eq "schema 1: <HOME>/.claude/bin/ticket -> bin next to profile" "$BINOUT/ticket" "$P2" -C "$T/r/absbin" --field tickets.status_tool
eq "schema 1: <HOME>/.claude/bin/preflight --epic -> bin next to profile, the placeholder in English" "$BINOUT/preflight --epic <epic>" "$P2" -C "$T/r/absbin" --field workflow.preflight
# Placeholders: the English ones are printed as written; the old Russian ones of the same profile print the same.
while IFS='|' read -r f want; do
    eq "placeholders: $f of English placeholders is printed as written" "$want" "$P2" -C "$T/r/phen" --field "$f"
    eq "placeholders: $f of the old Russian placeholders prints the English form" "$want" "$P2" -C "$T/r/phru" --field "$f"
done <<'EOF'
worktree.implementer|git worktree add -b <branch> /w/<ticket-name> main
worktree.reviewer|git worktree add /w/review-<review-target> --detach <branch>
tickets.branch|<epic>/<NN>
tickets.path|.scratch/<epic>/issues/NN-*.md
tickets.spec|.scratch/<epic>/<epic>-spec.md
commands.test_one|node --test <file>
commands.package.test|pnpm -C <package> test
EOF
eq "placeholders: tests.new_file of the old Russian placeholders prints the English form" '{"apps/api":"<module-dir>/<name>.test.ts"}' \
    bash -c '"$@" | node -e "console.log(JSON.stringify(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"))))"' _ "$P2" -C "$T/r/phru" --field tests.new_file
eq "placeholders: --json of the old Russian placeholders equals the English one (apart from _resolved)" "$("$P2" -C "$T/r/phen" --json | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8")); delete p._resolved; delete p.name; console.log(JSON.stringify(p))')" \
    bash -c '"$@" | node -e '"'"'const p=JSON.parse(require("fs").readFileSync(0,"utf8")); delete p._resolved; delete p.name; console.log(JSON.stringify(p))'"'"'' _ "$P2" -C "$T/r/phru" --json
check "placeholders: the summary of the old Russian placeholders has no Russian placeholder" 0 "" bash -c 'o="$("$@")" && [[ "$o" == *"<ticket-name>"* && "$o" != *"<имя-тикета>"* && "$o" != *"<эпик>"* ]]' _ "$P2" -C "$T/r/phru"
# rules.md headings: the old Russian headings read as the English ones (CRLF line kept as written); a heading
# with more words after it (the overnight heading followed by "(old)") stays as written (Russian input on purpose).
eq "rules.md: --rules prints the old Russian headings in English" "$("$P2" -C "$T/r/phen" --rules)" "$P2" -C "$T/r/phru" --rules
check "rules.md: the summary prints the English heading" 0 "## Required reading for the implementer" "$P2" -C "$T/r/phru"
check "rules.md: a heading with more words after it stays as written" 0 "" bash -c 'o="$("$@")" && [[ "$o" == *"## Ночной прогон и аудит (old)"* && "$o" != *"## Overnight run and audit (old)"* ]]' _ "$P2" -C "$T/r/phru" --rules
fails_with "profile.json that is not an object -> 1 with the reason" 1 "not a JSON object" "$P2" -C "$T/r/notobj" --name
check "schema 1: --json and briefing name no ~/.claude/bin" 0 "" bash -c 'o="$("$@" --json && "$@")" && [[ "$o" == *"$0"* && "$o" != *"~/.claude/bin"* ]]' "$(json_printed "$BINREAL")/ticket" "$P2" -C "$T/r/legacy"
eq "schema 1: string language -> language.reports" ru "$P2" -C "$T/r/legacy" --field language.reports
eq "schema 1: string language -> language.team" ru "$P2" -C "$T/r/legacy" --field language.team

after="$(snapshot)"
check "profile writes nothing into HOME or HARNESS_HOME" 0 "" test "$before" = "$after"

home_after="$(real_home_snapshot "$REAL_HOME")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" 0 "" test "$home_before" = "$home_after"
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
