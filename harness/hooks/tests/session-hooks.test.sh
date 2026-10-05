#!/usr/bin/env bash
# Тесты hooks/session-start.sh и hooks/session-end.sh.
# Запуск: bash ~/.claude/hooks/tests/session-hooks.test.sh; код выхода 0 — всё прошло.
#
# Реестр — живой (~/.claude/gate/config.json, только чтение), профили — копия
# ~/.claude/profiles во временном каталоге (CLAUDE_PROFILES_DIR), поэтому настоящий
# state/pending-retro.log не трогается. Плюс синтетический реестр для крайних случаев.
set -u
START="$HOME/.claude/hooks/session-start.sh"
END="$HOME/.claude/hooks/session-end.sh"
ATAKAMA=/Users/alexey/Work/Atakama
AUCTION=/Users/alexey/Work/Auction
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
cp -Rp "$HOME/.claude/profiles" "$T/profiles"
rm -rf "$T"/profiles/*/state
mkdir -p "$T/plain"
export CLAUDE_PROFILES_DIR="$T/profiles"

# $1 хук, $2 каталог запуска ($PWD), $3 cwd в JSON (пусто — без поля cwd)
run() {
    local payload='{"session_id":"t-1","hook_event_name":"X"}'
    [ -n "$3" ] && payload="{\"session_id\":\"t-1\",\"cwd\":\"$3\",\"hook_event_name\":\"X\"}"
    (cd "$2" && printf '%s' "$payload" | bash "$1")
}
ctx() { jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null; }

LOG="$T/profiles/atakama/state/pending-retro.log"

if [ -d "$ATAKAMA/Atakama-Browser-Server" ]; then
    R="$ATAKAMA/Atakama-Browser-Server"
    out="$(run "$START" "$R" "$R")"; rc=$?
    c="$(printf '%s' "$out" | ctx)"
    [ "$rc" -eq 0 ] && [ "$(printf '%s' "$out" | jq -r .hookSpecificOutput.hookEventName)" = SessionStart ] \
        && ok "atakama repo: SessionStart JSON, exit 0" || bad "atakama repo: rc=$rc out=${out:0:120}"
    [[ "$c" == *"## Personal working rules (Alexey only — never commit these to the repos)"* ]] \
        && ok "atakama repo: rules.md under profile heading" || bad "atakama repo: rules heading missing"
    [[ "$c" == *"## Lessons learned so far (one-liners; full log in ${T/#$HOME/~}/profiles/atakama/lessons/lessons.md)"$'\n'"<!-- One line per lesson"* ]] \
        && ok "atakama repo: lessons index injected" || bad "atakama repo: lessons heading missing"
    [[ "$c" != *"## Sources"* ]] && ok "atakama repo: Sources section stripped" || bad "atakama repo: Sources leaked"
    [[ "$c" != *"Housekeeping"* ]] && ok "atakama repo: no retro reminder without log" || bad "atakama repo: reminder without log"

    # session-end пишет в state профиля; на третьей строке session-start напоминает
    for d in "$ATAKAMA" "$R" "$R/elt"; do [ -d "$d" ] && run "$END" "$d" "$d" >/dev/null; done
    n="$(wc -l <"$LOG" 2>/dev/null | tr -d ' ')"
    [ "${n:-0}" -ge 2 ] && grep -q $'\t'"$R"'$' "$LOG" && ok "session-end appends time<TAB>cwd ($n lines)" \
        || bad "session-end: log has ${n:-0} lines"
    printf 'x\tx\nx\tx\nx\tx\n' >"$LOG"
    c="$(run "$START" "$R" "$R" | ctx)"
    [[ "$c" == *"## Housekeeping"$'\n'"3 sessions have ended without a retrospective."* ]] \
        && ok "retro reminder at 3 pending sessions" || bad "retro reminder missing"

    # активный эпик
    mkdir -p "$T/profiles/atakama/epics/ep1" && echo "MAP-OF-EP1" >"$T/profiles/atakama/epics/ep1/map.md"
    echo ep1 >"$T/profiles/atakama/state/active-epic"
    c="$(run "$START" "$R" "$R" | ctx)"
    [[ "$c" == *"## Active epic: ep1"$'\n'"MAP-OF-EP1"* ]] && ok "active epic map injected" || bad "active epic map missing"
    rm -rf "$T/profiles/atakama/state/active-epic" "$T/profiles/atakama/epics/ep1"

    # общий каталог над тремя репозиториями (сам не git) — тот же профиль
    a="$(run "$START" "$ATAKAMA" "$ATAKAMA")"; b="$(run "$START" "$R" "$R")"
    [ -n "$a" ] && [ "$a" = "$b" ] && ok "atakama workspace root: same context as a repo" || bad "atakama workspace root differs"

    # cwd из JSON важнее $PWD
    c="$(run "$START" "$T/plain" "$R" | ctx)"
    [[ "$c" == *"Personal working rules"* ]] && ok "cwd from hook JSON wins over PWD" || bad "cwd from JSON ignored"
    # без поля cwd — $PWD
    c="$(run "$START" "$R" "" | ctx)"
    [[ "$c" == *"Personal working rules"* ]] && ok "no cwd in JSON: falls back to PWD" || bad "PWD fallback broken"
else
    echo "skip atakama checks: $ATAKAMA missing"
fi

if [ -d "$AUCTION" ]; then
    out="$(run "$START" "$AUCTION" "$AUCTION")"; rc=$?
    [ "$rc" -eq 0 ] && [ -z "$out" ] && ok "auction: session-start prints nothing (inject_rules false)" \
        || bad "auction: rc=$rc out=${out:0:120}"
    out="$(run "$END" "$AUCTION" "$AUCTION")"; rc=$?
    [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$T/profiles/auction/state" ] \
        && ok "auction: session-end writes nothing" || bad "auction: session-end rc=$rc or wrote state"
else
    echo "skip auction checks: $AUCTION missing"
fi

out="$(run "$START" "$T/plain" "$T/plain")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "unregistered dir: session-start silent, exit 0" || bad "unregistered start: rc=$rc"
before="$(find "$T/profiles" -name pending-retro.log -exec cat {} + 2>/dev/null | wc -l)"
out="$(run "$END" "$T/plain" "$T/plain")"; rc=$?
after="$(find "$T/profiles" -name pending-retro.log -exec cat {} + 2>/dev/null | wc -l)"
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ "$before" = "$after" ] && ok "unregistered dir: session-end silent, writes nothing" \
    || bad "unregistered end: rc=$rc before=$before after=$after"

# --- синтетический реестр: профиль без поля session, битый профиль ---------------------
mkdir -p "$T/syn/p1" "$T/syn/p2" "$T/sp/quiet" "$T/sp/broken"
git -C "$T/syn/p1" init -q; git -C "$T/syn/p2" init -q
echo '{"schema":1,"name":"quiet","lessons":"profile"}' >"$T/sp/quiet/profile.json"
echo '# quiet rules' >"$T/sp/quiet/rules.md"
echo '{broken' >"$T/sp/broken/profile.json"
cat >"$T/syn.json" <<EOF
{"repos":[{"key":"q","match":"$T/syn/p1","profile":"quiet"},{"key":"b","match":"$T/syn/p2","profile":"broken"}]}
EOF
for hook in "$START" "$END"; do
    h="$(basename "$hook")"
    out="$(CLAUDE_GATE_CONFIG="$T/syn.json" CLAUDE_PROFILES_DIR="$T/sp" run "$hook" "$T/syn/p1" "$T/syn/p1")"; rc=$?
    [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$T/sp/quiet/state" ] && ok "$h: profile without session field -> nothing" \
        || bad "$h: no-session profile rc=$rc out=${out:0:80}"
    out="$(CLAUDE_GATE_CONFIG="$T/syn.json" CLAUDE_PROFILES_DIR="$T/sp" run "$hook" "$T/syn/p2" "$T/syn/p2")"; rc=$?
    [ "$rc" -eq 0 ] && [ -z "$out" ] && ok "$h: broken profile.json -> silent exit 0" || bad "$h: broken profile rc=$rc"
done

# напоминание о /retro без подмешивания rules.md (inject_rules нет, retro_reminder_after есть)
mkdir -p "$T/syn/p3" "$T/sp/remind"; git -C "$T/syn/p3" init -q
echo '{"schema":1,"name":"remind","session":{"retro_reminder_after":1}}' >"$T/sp/remind/profile.json"
echo '# remind rules' >"$T/sp/remind/rules.md"
printf '{"repos":[{"key":"r","match":"%s","profile":"remind"}]}\n' "$T/syn/p3" >"$T/syn3.json"
CLAUDE_GATE_CONFIG="$T/syn3.json" CLAUDE_PROFILES_DIR="$T/sp" run "$END" "$T/syn/p3" "$T/syn/p3" >/dev/null
c="$(CLAUDE_GATE_CONFIG="$T/syn3.json" CLAUDE_PROFILES_DIR="$T/sp" run "$START" "$T/syn/p3" "$T/syn/p3" | ctx)"
[[ "$c" == *"## Housekeeping"* && "$c" != *"remind rules"* ]] && ok "reminder-only profile: reminder without rules" \
    || bad "reminder-only profile: [$c]"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
