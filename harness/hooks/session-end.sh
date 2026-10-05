#!/usr/bin/env bash
# SessionEnd: отмечает, что сессия проекта закончилась без ретроспективы, чтобы
# hooks/session-start.sh напомнил о /retro (порог — session.retro_reminder_after профиля).
#
# Проект — ~/.claude/bin/profile по каталогу сессии (поле `cwd` из JSON хука, иначе $PWD).
# Пишет только для профиля с полем session.retro_reminder_after: строка «время<TAB>каталог»
# в <профиль>/state/pending-retro.log (каталог state/ не в git). Очищает журнал скилл /retro.
# Остальное — ничего, код 0. В репозитории ничего не пишется.
#
# Для тестов: CLAUDE_PROFILE_BIN, CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR — как у session-start.sh.

set -uo pipefail

if ! command -v node >/dev/null 2>&1; then
    for d in "$HOME"/.nvm/versions/node/*/bin; do
        [ -d "$d" ] && PATH="$d:$PATH"
    done
fi
PATH="/opt/homebrew/bin:$PATH"
export PATH

PROFILE_BIN="${CLAUDE_PROFILE_BIN:-$HOME/.claude/bin/profile}"

input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd="$PWD"

json="$("$PROFILE_BIN" -C "$cwd" --json 2>/dev/null)" || exit 0
after="$(printf '%s' "$json" | jq -r '.session.retro_reminder_after // empty')"
dir="$(printf '%s' "$json" | jq -r '._resolved.dir // empty')"
[ -n "$after" ] && [ -n "$dir" ] && [ -d "$dir" ] || exit 0

mkdir -p "$dir/state"
printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$cwd" >>"$dir/state/pending-retro.log"
exit 0
