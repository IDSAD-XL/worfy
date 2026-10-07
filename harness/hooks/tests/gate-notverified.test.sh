#!/usr/bin/env bash
# Тесты кода 3 гейта («проверить не удалось») и его доставки через stop.sh:
#   - битый или отсутствующий реестр: резолвер выходит не с нулём, гейт — с кодом 3
#     «резолвер … завершился», а не «не зарегистрирован»; stop.sh всё равно держит ход
#     на красном маркере зарегистрированного проекта;
#   - node не найден / резолвер упал: код 3, а не 0;
#   - сообщение stop.sh — не больше одного раза за сессию на репозиторий;
#   - маркер доставляется только своей сессии и своему дереву; маркер без сессии
#     («anon») — только если он свежее начала сессии.
# Запуск: bash ~/.claude/hooks/tests/gate-notverified.test.sh; код выхода 0 — всё прошло.
# HOOKS_DIR — прогнать тест на другой копии хуков (например, на версии до правки).
set -u
HOOKS="${HOOKS_DIR:-$HOME/.claude/hooks}"
GATE="$HOOKS/gate.sh"
STOP="$HOOKS/stop.sh"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
unset CLAUDE_CODE_SESSION_ID
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
check() { # $1 = описание, остальное — условие
    local d="$1"; shift
    if "$@"; then ok "$d"; else bad "$d (rc=$rc, out: ${out:0:300})"; fi
}
tag() { printf '%s' "$1" | shasum | awk '{print $1}' | cut -c1-8; }
sp() { printf '{"session_id":"%s"%s}' "$1" "${2:+,\"transcript_path\":\"$2\"}"; }

export CLAUDE_GATE_STATE="$T/state" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$T/state" "$T/reg" "$T/unreg" "$T/home"
for r in reg unreg; do
    git -C "$T/$r" init -q && git -C "$T/$r" commit -q --allow-empty -m init
done
git -C "$T/unreg" worktree add -q "$T/unreg-wt" 2>/dev/null
GOOD_CFG="$(printf '{"repos":[{"key":"t","match":"%s","pm":"npm","root":{},"workspace":{}}]}' "$T/reg")"
echo "$GOOD_CFG" >"$CLAUDE_GATE_CONFIG"
RED="$T/state/red-t-$(tag "$T/reg")"

# --- 1. Битый реестр -------------------------------------------------------------
echo '{"repos": [ broken' >"$CLAUDE_GATE_CONFIG"
out="$(node "$CLAUDE_GATE_RESOLVE" --which "$T/reg" 2>&1)"; rc=$?
check "resolver: unparseable config -> non-zero exit" [ "$rc" -ne 0 ]
rm -f "$CLAUDE_GATE_CONFIG"
out="$(node "$CLAUDE_GATE_RESOLVE" --which "$T/reg" 2>&1)"; rc=$?
check "resolver: missing config -> non-zero exit" [ "$rc" -ne 0 ]
echo '{"Repos": []}' >"$CLAUDE_GATE_CONFIG"
out="$(node "$CLAUDE_GATE_RESOLVE" --which "$T/reg" 2>&1)"; rc=$?
check "resolver: config without 'repos' array -> non-zero exit" [ "$rc" -ne 0 ]
echo '{"repos": [ broken' >"$CLAUDE_GATE_CONFIG"

out="$(cd "$T/reg" && sp s1 | bash "$GATE" fast 2>&1)"; rc=$?
check "gate: broken config -> exit 3" [ "$rc" -eq 3 ]
check "gate: broken config -> 'ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер', not 'не зарегистрирован'" \
    bash -c '[[ "$1" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер"* && "$1" != *"не зарегистрирован"* ]]' _ "$out"

date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && sp s1 | bash "$STOP" 2>&1)"; rc=$?
check "stop: broken config + red marker -> still blocks (exit 2)" [ "$rc" -eq 2 ]
check "stop: broken config + red marker -> red message" bash -c '[[ "$1" == *"Гейт качества красный"* ]]' _ "$out"
check "stop: broken config + red marker -> block message names the gate-3 reason" \
    bash -c '[[ "$1" == *"Кроме того"*"резолвер"* ]]' _ "$out"
out="$(cd "$T/reg" && sp s1 | bash "$STOP" 2>&1)"; rc=$?
check "stop: gate-3 reason already said in this session -> not repeated" \
    bash -c '[ "$2" -eq 2 ] && [[ "$1" != *"Кроме того"* ]]' _ "$out" "$rc"
rm -f "$RED" "$T/state/stop-blocks/"*

(cd "$T/reg" && sp s1b | bash "$GATE" fast >/dev/null 2>&1)
out="$(cd "$T/reg" && sp s1b | bash "$STOP" 2>&1)"; rc=$?
check "stop: broken config, no red -> exit 0, says 'не проверено' once" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *additionalContext* && "$1" == *"не проверено"* ]]' _ "$out" "$rc"
check "stop: additionalContext output is valid JSON" node -e 'JSON.parse(process.argv[1])' "$out"
echo "Профиль fast, репозиторий t. Проверить не удалось: docker" >"$T/state/unverified-t-$(tag "$T/reg")"
out="$(cd "$T/reg" && sp s1u | bash "$STOP" 2>&1)"; rc=$?
check "stop: broken config + unverified marker of this tree -> said once, exit 0" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *"не смог проверить"* ]]' _ "$out" "$rc"
rm -f "$T/state/unverified-t-"*

# Красный и маркер кода 3 вместе: ход держится, причина кода 3 — в том же сообщении.
(cd "$T/reg" && sp s1r | bash "$GATE" fast >/dev/null 2>&1)
date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && sp s1r | bash "$STOP" 2>&1)"; rc=$?
check "stop: red + gate-3 marker -> blocks and names the gate-3 reason" \
    bash -c '[ "$2" -eq 2 ] && [[ "$1" == *"Гейт качества красный"* && "$1" == *"резолвер"* ]]' _ "$out" "$rc"
(cd "$T/reg" && sp s1r | bash "$STOP" >/dev/null 2>&1)
out="$(cd "$T/reg" && sp s1r | bash "$STOP" 2>&1)"; rc=$?
check "stop: red past MAX_BLOCKS -> exit 0 with 'всё ещё красный'" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *"всё ещё красный"* ]]' _ "$out" "$rc"
out="$(cd "$T/reg" && sp s1r | bash "$STOP" 2>&1)"; rc=$?
check "stop: red past MAX_BLOCKS again -> silent (once per session)" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
rm -f "$RED" "$T/state/stop-blocks/"*
echo "$GOOD_CFG" >"$CLAUDE_GATE_CONFIG"

# --- 10. Нет node / резолвер упал -------------------------------------------------
# gate.sh и stop.sh сами добавляют /opt/homebrew/bin: если node там есть, «нет node» не изобразить.
if [ -x /opt/homebrew/bin/node ]; then echo "skip node-missing checks: /opt/homebrew/bin/node exists"; else
out="$(cd "$T/reg" && sp s10 | HOME="$T/home" PATH=/usr/bin:/bin bash "$GATE" fast 2>&1)"; rc=$?
check "gate: node missing -> exit 3 (not 0)" [ "$rc" -eq 3 ]
check "gate: node missing -> 'ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден'" \
    bash -c '[[ "$1" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден"* ]]' _ "$out"
out="$(cd "$T/reg" && sp s10 | HOME="$T/home" PATH=/usr/bin:/bin bash "$STOP" 2>&1)"; rc=$?
check "stop without node: gate's node-missing marker -> exit 0, says 'не проверено'" \
    bash -c '[ "$2" -eq 0 ] && [[ "$1" == *"node не найден"* && "$1" == *"не проверено"* ]]' _ "$out" "$rc"
date -u +%Y-%m-%dT%H:%M:%SZ >"$RED"
out="$(cd "$T/reg" && sp s10 | HOME="$T/home" PATH=/usr/bin:/bin bash "$STOP" 2>&1)"; rc=$?
check "stop without node + red marker -> blocks (exit 2)" [ "$rc" -eq 2 ]
rm -f "$RED" "$T/state/stop-blocks/"*
fi

printf '#!/usr/bin/env node\nthrow new Error("boom")\n' >"$T/crash.mjs"
out="$(cd "$T/reg" && sp s10b | CLAUDE_GATE_RESOLVE="$T/crash.mjs" bash "$GATE" fast 2>&1)"; rc=$?
check "gate: resolver crash -> exit 3 + 'ПРОВЕРИТЬ НЕ УДАЛОСЬ'" \
    bash -c '[ "$2" -eq 3 ] && [[ "$1" == *"[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер"* ]]' _ "$out" "$rc"

# --- 3. Не больше одного сообщения за сессию на репозиторий ------------------------
U="$T/unreg"; UM="$T/state/nokey-unregistered-$(tag "$U")"
(cd "$U" && sp s3 | bash "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp s3 | bash "$STOP" 2>&1)"; rc=$?
check "stop: first notice in session -> said" bash -c '[[ "$1" == *"не зарегистрирован"* ]]' _ "$out"
(cd "$U" && sp s3 | bash "$GATE" fast >/dev/null 2>&1)
check "gate: second run writes marker again" [ -s "$UM-s3" ]
out="$(cd "$U" && sp s3 | bash "$STOP" 2>&1)"; rc=$?
check "stop: second gate run, same session -> silent exit 0 (once per session)" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
check "stop: silent run still consumes the marker" [ ! -e "$UM-s3" ]

# --- 4. Маркер — только своей сессии и своему дереву ------------------------------
(cd "$U" && sp sA | bash "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp sB | bash "$STOP" 2>&1)"; rc=$?
check "stop in session B: marker of session A not delivered" bash -c '[ "$2" -eq 0 ] && [ -z "$1" ]' _ "$out" "$rc"
check "marker of session A left for A" [ -s "$UM-sA" ]
out="$(cd "$U" && sp sA | bash "$STOP" 2>&1)"
check "stop in session A: gets its marker" bash -c '[[ "$1" == *"не зарегистрирован"* ]]' _ "$out"

(cd "$T/unreg-wt" && sp sW | bash "$GATE" fast >/dev/null 2>&1)
out="$(cd "$U" && sp sW | bash "$STOP" 2>&1)"
check "stop in main tree: marker of another worktree not delivered" bash -c '[ -z "$1" ]' _ "$out"
out="$(cd "$T/unreg-wt" && sp sW | bash "$STOP" 2>&1)"
check "stop in that worktree: gets its marker" bash -c '[[ "$1" == *"не зарегистрирован"* ]]' _ "$out"

# Без сессии (запуск из терминала): маркер anon, берётся только сессией, начавшейся раньше.
(cd "$U" && bash "$GATE" fast </dev/null >/dev/null 2>&1)
AM="$UM-anon"
check "gate without session -> anon marker" [ -s "$AM" ]
touch -t 202001010000 "$AM"
: >"$T/new.jsonl"
out="$(cd "$U" && sp sNew "$T/new.jsonl" | bash "$STOP" 2>&1)"
check "stop: anon marker older than session start -> not delivered" bash -c '[ -z "$1" ] && [ -e "$2" ]' _ "$out" "$AM"
touch "$AM"
out="$(cd "$U" && sp sNew "$T/new.jsonl" | bash "$STOP" 2>&1)"
check "stop: anon marker newer than session start -> delivered" bash -c '[[ "$1" == *"не зарегистрирован"* ]]' _ "$out"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
