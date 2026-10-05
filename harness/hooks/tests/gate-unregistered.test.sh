#!/usr/bin/env bash
# Тесты gate.sh и stop.sh для репозитория вне реестра gate/config.json.
# Запуск: bash ~/.claude/hooks/tests/gate-unregistered.test.sh; код выхода 0 — всё прошло.
#
# Реестр, каталог состояния и репозитории — временные (CLAUDE_GATE_CONFIG, CLAUDE_GATE_STATE):
# живые маркеры в ~/.claude/gate/state тест не трогает.
set -u
HOOKS="${HOOKS_DIR:-$HOME/.claude/hooks}"   # HOOKS_DIR — прогнать тест на другой копии хуков
GATE="$HOOKS/gate.sh"
STOP="$HOOKS/stop.sh"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
# Тест сам задаёт сессию через JSON хука; сессия, из которой его запустили, не в счёт.
unset CLAUDE_CODE_SESSION_ID
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()   { pass=$((pass + 1)); echo "ok   $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL $1"; }

export CLAUDE_GATE_STATE="$T/state" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$T/state" "$T/unreg" "$T/reg"
git -C "$T/unreg" init -q && git -C "$T/unreg" commit -q --allow-empty -m init
git -C "$T/reg" init -q && git -C "$T/reg" commit -q --allow-empty -m init
printf '{"repos":[{"key":"t","match":"%s","pm":"npm","root":{},"workspace":{}}]}\n' "$T/reg" >"$CLAUDE_GATE_CONFIG"
tag() { printf '%s' "$1" | shasum | awk '{print $1}' | cut -c1-8; }

payload='{"session_id":"test-session"}'

# 1. gate.sh в незарегистрированном репозитории: строка-сообщение и код 3, маркер для stop.sh.
out="$(cd "$T/unreg" && printf '%s' "$payload" | bash "$GATE" fast 2>&1)"; rc=$?
line="[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: проект не зарегистрирован в ~/.claude/gate/config.json"
if [ "$rc" -eq 3 ] && printf '%s\n' "$out" | grep -qxF "$line"; then ok "gate unregistered -> exit 3 + message"
else bad "gate unregistered: exit $rc, out: ${out:0:300}"; fi
[ -s "$T/state/nokey-unregistered-$(tag "$T/unreg")-test-session" ] && ok "gate unregistered -> marker written" || bad "gate unregistered: no marker"

# 2. stop.sh после кода 3: ход не держит (код 0, не 2), но говорит «не проверено» и снимает маркер.
out="$(cd "$T/unreg" && printf '%s' "$payload" | bash "$STOP" 2>"$T/stop.err")"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *additionalContext* ]] && [[ "$out" == *"не проверено"* ]] && [[ "$out" != *'"decision"'* ]] && [ ! -s "$T/stop.err" ]; then
    ok "stop after gate exit 3 -> not blocking (exit 0), says 'не проверено'"
else bad "stop after exit 3: exit $rc, out: ${out:0:300}, err: $(head -c 200 "$T/stop.err")"; fi
[ ! -e "$T/state/nokey-unregistered-$(tag "$T/unreg")-test-session" ] && ok "stop consumed the marker" || bad "stop left the marker"

# 3. Второй Stop без нового прогона гейта — молчит.
out="$(cd "$T/unreg" && printf '%s' "$payload" | bash "$STOP" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "stop again -> silent exit 0" || bad "stop again: exit $rc, out: ${out:0:200}"

# 4. Не git-каталог — по-прежнему код 0 без вывода (вне области Q56).
out="$(cd "$T/state" && bash "$GATE" fast </dev/null 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "gate outside git -> exit 0 (unchanged)" || bad "gate outside git: exit $rc, out: ${out:0:200}"

# 5. Регрессия: в зарегистрированном репозитории красный маркер по-прежнему держит ход (код 2).
date -u +%Y-%m-%dT%H:%M:%SZ >"$T/state/red-t-$(tag "$T/reg")"
out="$(cd "$T/reg" && printf '%s' "$payload" | bash "$STOP" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$out" == *"Гейт качества красный"* ]] && ok "stop registered + red -> exit 2 (unchanged)" || bad "stop registered red: exit $rc, out: ${out:0:200}"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
