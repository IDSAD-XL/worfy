#!/usr/bin/env bash
# Tests of the ticket header format — one fact per line (harness/bin/TICKETS.md, "Header"):
#   Status: <open|claimed|blocked|done> [<time>], Blocked reason:, Waits:, PR: #<N>
# what `ticket claim|open|done|block` write, how `ticket migrate` moves the old spellings into it,
# and what `epic-status --json` reads from it (statusAt, blockedReason, waits, pr, statusError).
# Run: bash harness/bin/tests/ticket-header.test.sh; exit code 0 — everything passed.
#
# The fixtures are copies of real Status lines of .scratch/*/issues/ without user paths. No gh, no
# profile registry: the tickets root is given with --root, the registry is a temporary empty one.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"   # BIN_DIR — run the test against another copy of the tools
TICKET="$BIN/ticket"
STATUS="$BIN/epic-status"
export CLAUDE_TICKET_BIN="$TICKET"
export CLAUDE_PROFILE_BIN="$BIN/profile"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$(dirname "$0")/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
printf '{"repos":[]}\n' >"$CLAUDE_GATE_CONFIG"; mkdir -p "$CLAUDE_PROFILES_DIR"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

R="$T/.scratch"
E="$R/ep/issues"
mkdir -p "$E" "$R/odd/issues"
NOW='[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]Z'
tk()   { "$TICKET" "$@" --root "$R"; }
json() { "$STATUS" --json --root "$R"; }
# state / any field of one ticket of epic ep in the epic-status answer
field() { printf '%s' "$1" | jq -r --argjson n "$2" --arg f "$3" '.tickets[] | select(.epic == "ep" and .num == $n) | .[$f] | if . == null then "null" else tostring end'; }

# ── fixtures: every spelling the repositories carry ─────────────────────────────────────────────
printf '%s\n' '# 01 — bold header' '' '**Type:** task' '**Status:** open' '**Blocked by:** none' '' '## Что делаем' '' 'text' >"$E/01-bold.md"
# The old double spelling: the header and the footer say the same thing.
printf '%s\n' '# 02 — footer' '' 'Type: task' '**Status:** done — 2026-08-27' 'Blocked by: —' '' '## Итог' '' 'text' '' 'Status: done' >"$E/02-footer.md"
printf '%s\n' '# 03 — in progress' '' 'Status: in-progress' 'Blocked by: 01' >"$E/03-progress.md"
printf '%s\n' '# 04 — Russian word' '' 'Status: заблокирован — ждёт тестовые ключи Stripe' 'Blocked by: —' >"$E/04-russian.md"
printf '%s\n' '# 05 — PR link' '' 'Type: task' 'Status: done — 2026-10-15, [PR #412](https://github.com/octo-org/acme/pull/412)' 'Blocked by: 01' '' '## Итог' '' \
    'PR: https://github.com/octo-org/acme/pull/38 (ветка `ep/05`).' >"$E/05-pr.md"
printf '%s\n' '# 06 — reason with a semicolon' '' 'Type: task' \
    'Status: blocked — приёмка вместе с владельцем (HANDOFF, «Дальше»: приёмки 26 и 16 — не в Autopilot); Autopilot не берёт' 'Blocked by: 01–15' >"$E/06-semicolon.md"
printf '%s\n' '# 07 — done with a note' '' 'Type: research' \
    'Status: done — 2026-10-16, отчёт — [PR #339](https://github.com/octo-org/acme/pull/339), решение владельца — в «Итог»' 'Blocked by: —' >"$E/07-note.md"
printf '%s\n' '# 08 — claimed' '' 'Status: claimed — 2026-10-16' 'Blocked by: —' '' '```bash' 'Status: done' '```' >"$E/08-claimed.md"
printf '%s\n' '# 09 — already new' '' 'Type: task' 'Status: open' 'Blocked by: —' >"$E/09-new.md"
printf '\357\273\277# 10 — CRLF and BOM\r\n\r\nStatus: Выкачено 2026-08-23, PR #27\r\nBlocked by: —\r\n' >"$E/10-crlf.md"
printf '%s\n' '# 11 — no Status' '' 'Type: task' 'Blocked by: —' >"$E/11-none.md"
# New format; the only PR: line is in the result section, so the ticket has no PR.
# A blocked line with a date before the reason: the date is the Status time, not part of the reason.
printf '%s\n' '# 13 — blocked with a date' '' 'Status: blocked — 2026-10-12, waits for the API keys' 'Blocked by: —' >"$E/13-blocked-date.md"
printf '%s\n' '# 12 — body PR' '' 'Status: done 2026-10-01' 'Blocked by: —' '' '## Итог' '' 'PR: #99' >"$E/12-body-pr.md"
# Refusals live in their own epic, so the run over ep stays clean.
printf '%s\n' '# 01 — unknown word' '' 'Status: draft' >"$R/odd/issues/01-draft.md"
printf '%s\n' '# 02 — header and footer disagree' '' 'Status: open' '' '## Итог' '' 'Status: done — 2026-08-27' >"$R/odd/issues/02-conflict.md"
printf '%s\n' '# 03 — two PRs' '' 'Status: done — 2026-10-01, PR #1, PR #2' >"$R/odd/issues/03-two.md"
printf '%s\n' '# 04 — a note on claimed' '' 'Status: claimed — 2026-10-01, waits for the review' >"$R/odd/issues/04-note.md"
cp -R "$R" "$T/orig"

# The state the old reader gave every fixture (last Status line, the word classified) — the migration keeps it.
STATES='1:open 2:done 3:work 4:blocked 5:done 6:blocked 7:done 8:work 9:open 10:done 11:none 12:done 13:blocked'

# ── 1. epic-status reads only the new format ──────────────────────────────────────────────────────
got="$(json)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(field "$got" 1 state)" = none ] && [ "$(field "$got" 1 statusError)" = "old header" ] \
   && [ "$(field "$got" 4 state)" = none ] && [ "$(field "$got" 9 state)" = open ] && [ "$(field "$got" 9 statusError)" = null ] \
   && [ "$(field "$got" 11 state)" = none ] && [ "$(field "$got" 11 statusError)" = null ] \
   && [ "$(printf '%s' "$got" | jq -r '.tickets[] | select(.epic == "odd" and .num == 2) | .state + "/" + .statusError')" = "none/old header" ]; then
    ok "epic-status: an old header (also a new Status line with an old footer) is state none with statusError 'old header', not a guess"
else bad "epic-status on old headers: exit $rc, got: ${got:0:400}"; fi
got="$("$STATUS" ep --root "$R" 2>&1)"
[[ "$got" == *"10 with an old header — run ticket migrate"* ]] && ok "epic-status line counts old headers" || bad "epic-status line: $got"

# ── 2. the writers refuse an old header ───────────────────────────────────────────────────────────
for c in "claim ep 01" "open ep 04" "done ep 05 --pr 3" "block ep 08 reason"; do
    # shellcheck disable=SC2086
    out="$(tk $c 2>&1)"; rc=$?
    [ "$rc" -eq 1 ] && [[ "$out" == *"run ticket migrate first"* ]] && ok "ticket $c on an old header -> exit 1" || bad "ticket $c: exit $rc, $out"
done
diff -r "$T/orig" "$R" >/dev/null && ok "refused writers left every file as it was" || bad "a refused writer changed a file"

# ── 3. migrate refuses a line it does not understand, and writes nothing ──────────────────────────
out="$(tk migrate 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && [[ "$out" == *"odd/issues/01-draft.md:3"*"Status: draft"* ]] && [[ "$out" == *"odd/issues/02-conflict.md"* ]] \
   && [[ "$out" == *"odd/issues/03-two.md:3"* ]] && [[ "$out" == *"odd/issues/04-note.md:3"*"text besides the date and the PR"* ]] \
   && diff -r "$T/orig" "$R" >/dev/null; then
    ok "migrate refuses unknown word, header/footer conflict, two PRs and a note on a claimed line; nothing written"
else bad "migrate refusal: exit $rc, $out"; fi

# ── 4. migrate -n prints the diff and writes nothing ──────────────────────────────────────────────
out="$(tk migrate --epic ep -n 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *"-**Status:** open"*"+Status: open"* ]] && [[ "$out" == *"+PR: #412"* ]] \
   && [[ "$out" == *"10 files to change"* ]] && diff -r "$T/orig" "$R" >/dev/null; then
    ok "migrate -n: diff printed, no file touched"
else bad "migrate -n: exit $rc, $out"; fi

# ── 5. migrate moves every spelling ───────────────────────────────────────────────────────────────
out="$(tk migrate --epic ep 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "migrate --epic ep: exit 0" || bad "migrate: exit $rc, $out"
want() { # <file> <expected lines...>
    local f=$1; shift
    if printf '%s\n' "$@" | cmp -s - "$E/$f"; then ok "migrated $f"; else bad "migrated $f:"; cat "$E/$f"; fi
}
want 01-bold.md '# 01 — bold header' '' '**Type:** task' 'Status: open' '**Blocked by:** none' '' '## Что делаем' '' 'text'
want 02-footer.md '# 02 — footer' '' 'Type: task' 'Status: done 2026-08-27' 'Blocked by: —' '' '## Итог' '' 'text'
want 03-progress.md '# 03 — in progress' '' 'Status: claimed' 'Blocked by: 01'
want 04-russian.md '# 04 — Russian word' '' 'Status: blocked' 'Blocked reason: ждёт тестовые ключи Stripe' 'Blocked by: —'
want 05-pr.md '# 05 — PR link' '' 'Type: task' 'Status: done 2026-10-15' 'PR: #412' 'Blocked by: 01' '' '## Итог' '' \
    'PR: https://github.com/octo-org/acme/pull/38 (ветка `ep/05`).'
want 06-semicolon.md '# 06 — reason with a semicolon' '' 'Type: task' 'Status: blocked' \
    'Blocked reason: приёмка вместе с владельцем (HANDOFF, «Дальше»: приёмки 26 и 16 — не в Autopilot); Autopilot не берёт' 'Blocked by: 01–15'
want 07-note.md '# 07 — done with a note' '' 'Type: research' 'Status: done 2026-10-16' 'PR: #339' 'Blocked by: —'
want 13-blocked-date.md '# 13 — blocked with a date' '' 'Status: blocked 2026-10-12' 'Blocked reason: waits for the API keys' 'Blocked by: —'
want 08-claimed.md '# 08 — claimed' '' 'Status: claimed 2026-10-16' 'Blocked by: —' '' '```bash' 'Status: done' '```'
cmp -s "$T/orig/ep/issues/09-new.md" "$E/09-new.md" && ok "a file in the new format is skipped" || bad "09-new.md changed"
cmp -s "$T/orig/ep/issues/11-none.md" "$E/11-none.md" && ok "a file without Status is skipped" || bad "11-none.md changed"
printf '\357\273\277# 10 — CRLF and BOM\r\n\r\nStatus: done 2026-08-23\r\nPR: #27\r\nBlocked by: —\r\n' | cmp -s - "$E/10-crlf.md" \
    && ok "migrate keeps BOM and CRLF" || bad "10-crlf.md: $(od -c "$E/10-crlf.md" | head -5)"
[[ "$out" == *"blocked without Waits:"*"ep/issues/04-russian.md"*"ep/issues/06-semicolon.md"* ]] \
    && ok "migrate lists the blocked tickets without Waits" || bad "no Waits list: $out"
[[ "$out" == *"07-note.md"*"note dropped: отчёт —"*"решение владельца — в «Итог»"* ]] \
    && ok "migrate names the note it dropped from a done line" || bad "no dropped note: $out"
out="$(tk migrate --epic ep 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [[ "$out" == *"0 files to change"* ]] && ok "a second migrate changes nothing" || bad "second migrate: exit $rc, $out"

# ── 6. epic-status on the migrated tree: the same state, the new fields filled ────────────────────
got="$(json)"; rc=$?
same=1
for p in $STATES; do [ "$(field "$got" "${p%%:*}" state)" = "${p#*:}" ] || { same=0; echo "  ticket ${p%%:*}: $(field "$got" "${p%%:*}" state), want ${p#*:}"; }; done
[ "$rc" -eq 0 ] && [ "$same" = 1 ] && ok "epic-status after migrate: every state as before" || bad "states changed: exit $rc"
if [ "$(field "$got" 6 blockedReason)" = 'приёмка вместе с владельцем (HANDOFF, «Дальше»: приёмки 26 и 16 — не в Autopilot); Autopilot не берёт' ] \
   && [ "$(field "$got" 5 pr)" = 412 ] && [ "$(field "$got" 5 statusAt)" = 2026-10-15 ] && [ "$(field "$got" 10 pr)" = 27 ] \
   && [ "$(field "$got" 4 waits)" = null ] && [ "$(field "$got" 9 statusAt)" = null ] && [ "$(field "$got" 9 pr)" = null ] \
   && [ "$(field "$got" 2 statusRaw)" = "done 2026-08-27" ] && [ "$(field "$got" 1 statusError)" = null ] && [ "$(field "$got" 12 pr)" = null ] \
   && [ "$(field "$got" 13 statusAt)" = 2026-10-12 ] && [ "$(field "$got" 13 blockedReason)" = "waits for the API keys" ]; then
    ok "epic-status: blockedReason, pr, statusAt; a body 'PR:' line is not the header's"
else bad "epic-status fields: ${got:0:600}"; fi

# ── 7. the writers: one fact per line ─────────────────────────────────────────────────────────────
out="$(tk block ep 04 --waits owner 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && grep -qx 'Status: blocked' "$E/04-russian.md" && grep -qx 'Blocked reason: ждёт тестовые ключи Stripe' "$E/04-russian.md" \
   && grep -qx 'Waits: owner' "$E/04-russian.md"; then
    ok "block --waits without a reason on a blocked ticket: only Waits is set"
else bad "block --waits: exit $rc, $out"; cat "$E/04-russian.md"; fi
[ "$(field "$(json)" 4 waits)" = owner ] && ok "epic-status: waits" || bad "epic-status waits"
out="$(tk block ep 03 --waits 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "--waits needs a value" || bad "--waits without a value: exit $rc"
out="$(tk block ep 09 --waits team 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"needs a reason"* ]] && ok "block --waits without a reason on an open ticket -> exit 1" || bad "block open --waits: exit $rc, $out"
out="$(tk claim ep 09 --waits team 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "--waits goes only with block" || bad "claim --waits: exit $rc"

tk block ep 09 "waits for the vendor; and the keys" --waits "Windows-PC" >/dev/null 2>&1
head -n 7 "$E/09-new.md" >"$T/h09"
if grep -Eqx "Status: blocked $NOW" "$T/h09" && [ "$(sed -n 5p "$T/h09")" = 'Blocked reason: waits for the vendor; and the keys' ] \
   && [ "$(sed -n 6p "$T/h09")" = 'Waits: Windows-PC' ] && [ "$(sed -n 7p "$T/h09")" = 'Blocked by: —' ]; then
    ok "block <reason> --waits <machine>: Status with time, then Blocked reason, then Waits"
else bad "block 09:"; cat "$E/09-new.md"; fi
tk block ep 09 "another reason" >/dev/null 2>&1
grep -q '^Waits:' "$E/09-new.md" && bad "block with a new reason and no --waits kept a stale Waits" || ok "block with a new reason and no --waits drops the old Waits"
grep -qx 'Blocked reason: another reason' "$E/09-new.md" && ok "block replaces the reason" || bad "reason not replaced"

tk claim ep 04 --branch ep/04 >/dev/null 2>&1
if grep -Eqx "Status: claimed $NOW" "$E/04-russian.md" && ! grep -Eq '^(Blocked reason|Waits):' "$E/04-russian.md" && grep -qx 'Branch: ep/04' "$E/04-russian.md"; then
    ok "claim: Status claimed with time; Blocked reason and Waits removed; Branch written"
else bad "claim 04:"; cat "$E/04-russian.md"; fi
tk done ep 04 --pr 12 >/dev/null 2>&1
if grep -Eqx "Status: done $NOW" "$E/04-russian.md" && grep -qx 'PR: #12' "$E/04-russian.md" && [ "$(grep -c '^Status:' "$E/04-russian.md")" = 1 ]; then
    ok "done --pr: Status done with time and the line PR: #12"
else bad "done 04:"; cat "$E/04-russian.md"; fi
got="$(json)"
[[ "$(field "$got" 4 statusAt)" =~ ^$NOW$ ]] && [ "$(field "$got" 4 pr)" = 12 ] && [ "$(field "$got" 4 state)" = done ] \
    && ok "epic-status: statusAt with minutes, pr" || bad "epic-status after done: ${got:0:300}"
tk done ep 04 --pr 13 >/dev/null 2>&1
[ "$(grep -c '^PR:' "$E/04-russian.md")" = 1 ] && grep -qx 'PR: #13' "$E/04-russian.md" && ok "a second done --pr replaces the PR line" || bad "PR line duplicated"
tk open ep 06 >/dev/null 2>&1
if grep -Eqx "Status: open $NOW" "$E/06-semicolon.md" && ! grep -q '^Blocked reason:' "$E/06-semicolon.md"; then
    ok "open: Status open with time, Blocked reason removed"
else bad "open 06:"; cat "$E/06-semicolon.md"; fi
tk claim ep 11 >/dev/null 2>&1
[ "$(sed -n 4p "$E/11-none.md")" = 'Blocked by: —' ] && grep -Eqx "Status: claimed $NOW" "$E/11-none.md" \
    && ok "claim on a file without Status inserts the plain line into the header" || { bad "claim 11:"; cat "$E/11-none.md"; }
tk claim ep 10 >/dev/null 2>&1
# No sed on the CRLF file: Git Bash sed drops \r. Take the written time with grep -ao, build the expected
# bytes with printf and compare them with the file itself, so a lost BOM or any lost \r fails the check.
at10="$(LC_ALL=C grep -aoE "^Status: claimed $NOW" "$E/10-crlf.md" | LC_ALL=C grep -aoE "$NOW" | head -1)"
printf '\357\273\277# 10 — CRLF and BOM\r\n\r\nStatus: claimed %s\r\nPR: #27\r\nBlocked by: —\r\n' "$at10" >"$T/w10"
[ -n "$at10" ] && cmp -s "$E/10-crlf.md" "$T/w10" && ok "claim keeps BOM and CRLF" || bad "10-crlf after claim: $(od -c "$E/10-crlf.md" | head -6)"
out="$(tk show ep 09 2>&1)"
[[ "$out" == "09-new.md:4  Status: blocked "*"Blocked reason: another reason"* ]] && ok "show prints the status lines" || bad "show: $out"

# ── 7b. the writer and the reader take the same lines for code (lib/code-fence.cjs) ────────────────
# A block closes only with a line of its own character, at least as long, with nothing after it. If ticket and
# epic-status saw blocks differently, `ticket done` could write a ticket that epic-status reads as not done.
# In their own tickets root, so the migrate runs above do not reach them.
F="$T/fence/.scratch"; FE="$F/fen/issues"; mkdir -p "$FE"
# 01: ~~~ inside a ``` block is text; the ``` after it closes the block, so the next Status line is a second one.
printf '%s\n' '# 01 — tilde in a backtick block' '' 'Status: open' '' '```text' '~~~' '```' 'Status: done' '```' >"$FE/01-tilde.md"
# 02: ``` inside a ```` block is text, and so is the Status line after it: the header has one Status line.
printf '%s\n' '# 02 — backticks in a longer block' '' 'Status: open' '' '````md' '```' 'Status: done' '```' '````' >"$FE/02-four.md"
fstate() { "$STATUS" --json --root "$F" | jq -r --argjson n "$1" '.tickets[] | select(.num == $n) | .state + "/" + (.statusError // "-")'; }
[ "$(fstate 1)" = "none/old header" ] && [ "$(fstate 2)" = "open/-" ] \
    && ok "epic-status: ~~~ does not close a \`\`\` block, \`\`\` does not close a \`\`\`\` block" || bad "epic-status on fences: 01 $(fstate 1), 02 $(fstate 2)"
out="$("$TICKET" done fen 01 --root "$F" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"run ticket migrate first"* ]] && grep -qx 'Status: open' "$FE/01-tilde.md" \
    && ok "ticket done refuses 01 as an old header, as epic-status reads it" || bad "ticket done fen 01: exit $rc, $out"
out="$("$TICKET" done fen 02 --root "$F" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(fstate 2)" = "done/-" ] && [ "$(sed -n 3p "$FE/02-four.md")" != "Status: open" ] && grep -Eqx "Status: done $NOW" "$FE/02-four.md" \
    && ok "ticket done on 02 writes the header line, and epic-status reads 02 as done" || bad "ticket done fen 02: exit $rc, $out, state $(fstate 2)"

# ── 8. no writes into the real home ───────────────────────────────────────────────────────────────
[ "$(real_home_snapshot "$HOME" "$T")" = "$home_before" ] && ok "real home untouched" || bad "real home changed"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
