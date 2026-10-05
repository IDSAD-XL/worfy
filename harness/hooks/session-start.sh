#!/usr/bin/env bash
# SessionStart: подмешивает в новую сессию контекст проекта из его профиля.
#
# Какой проект — решает ~/.claude/bin/profile по каталогу сессии (поле `cwd` из JSON хука,
# иначе $PWD): реестр ~/.claude/gate/config.json, поле "profile" записи. Каталог вне
# зарегистрированных проектов, проект без профиля или профиль без `session.inject_rules: true`
# и без `session.retro_reminder_after` — ничего не печатаем, код 0. Так у Auction старт
# сессии остаётся пустым, как был.
#
# Что подмешивается (формат — profiles/README.md, поле `session`); пункты 1–3 — только при
# session.inject_rules: true, пункт 4 — при любом session.retro_reminder_after:
#   1. rules.md профиля без раздела «## Sources» / «## Источники» (он для сопровождающего,
#      не для агента), под заголовком session.rules_heading;
#   2. индекс уроков <профиль>/lessons/lessons-index.md, если уроки живут в профиле
#      (`lessons: "profile"`);
#   3. карта активного эпика: <профиль>/state/active-epic -> <профиль>/epics/<эпик>/map.md;
#   4. напоминание о /retro, если в <профиль>/state/pending-retro.log не меньше
#      session.retro_reminder_after строк (их дописывает hooks/session-end.sh).
# Каждый раздел — не больше CLAUDE_SESSION_SECTION_CAP байт (по умолчанию 20000); длиннее —
# обрезается по строке, последней строкой идёт «… обрезано, полностью: <путь>».
# В репозитории ничего не пишется.
#
# Для тестов: CLAUDE_PROFILE_BIN подменяет bin/profile; CLAUDE_GATE_CONFIG и
# CLAUDE_PROFILES_DIR уходят в profile как есть. Тесты: hooks/tests/session-hooks.test.sh.

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
field() { printf '%s' "$json" | jq -r "$1 // empty"; }
inject="$(printf '%s' "$json" | jq -r '.session.inject_rules // false')"
after="$(field '.session.retro_reminder_after')"
[ "$inject" = "true" ] || [ -n "$after" ] || exit 0

name="$(field '._resolved.name')"
dir="$(field '._resolved.dir')"
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
state="$dir/state"
tilde='~'
short="${dir/#$HOME/$tilde}"

# Каждый раздел — не больше CAP байт: карта эпика или индекс уроков, разросшиеся до сотен
# килобайт, съели бы контекст каждой сессии. Режем по границе строки (так не рвётся UTF-8)
# и дописываем, где лежит полный текст.
CAP="${CLAUDE_SESSION_SECTION_CAP:-20000}"
case "$CAP" in '' | *[!0-9]*) CAP=20000 ;; esac
ctx=""
add() { # $1 заголовок, $2 текст, $3 файл с полным текстом (для строки об обрезке)
    [ -n "$2" ] || return 0
    local text="$2"
    if [ "$(printf '%s' "$text" | wc -c | tr -d ' ')" -gt "$CAP" ]; then
        local cut chunk
        # Берём CAP+1 байт: если последний из них — перевод строки, граница пришлась ровно на
        # конец строки и все строки целые; иначе последняя строка неполная и снимается.
        chunk="$(printf '%s' "$text" | head -c "$((CAP + 1))"; printf x)"
        chunk="${chunk%x}"
        if [[ "$chunk" == *$'\n' ]]; then
            cut="${chunk%$'\n'}"
        else
            cut="$(printf '%s' "$chunk" | sed '$d')"
        fi
        [ -n "$cut" ] || cut="$(printf '%s' "$text" | head -c "$CAP" | iconv -c -f UTF-8 -t UTF-8 2>/dev/null)"
        text="$cut"$'\n'"… обрезано, полностью: ${3:-исходный файл}"
    fi
    ctx+=$'\n'"## $1"$'\n'"$text"$'\n'
}

if [ "$inject" = "true" ] && [ -s "$dir/rules.md" ]; then
    rules="$(awk '/^## /{skip=($0 ~ /^## (Sources|Источники)/)} !skip' "$dir/rules.md")"
    heading="$(field '.session.rules_heading')"
    add "${heading:-Project rules (profile $name)}" "$rules" "$dir/rules.md"
fi

if [ "$inject" = "true" ] && [ "$(field '.lessons')" = "profile" ] && [ -s "$dir/lessons/lessons-index.md" ]; then
    add "Lessons learned so far (one-liners; full log in $short/lessons/lessons.md)" "$(cat "$dir/lessons/lessons-index.md")" "$dir/lessons/lessons-index.md"
fi

active="$(cat "$state/active-epic" 2>/dev/null || true)"
if [ "$inject" = "true" ] && [ -n "$active" ] && [ -s "$dir/epics/$active/map.md" ]; then
    add "Active epic: $active" "$(cat "$dir/epics/$active/map.md")" "$dir/epics/$active/map.md"
fi

if [ -n "$after" ]; then
    pending=0
    [ -f "$state/pending-retro.log" ] && pending="$(wc -l <"$state/pending-retro.log" | tr -d ' ')"
    if [ "${pending:-0}" -ge "$after" ]; then
        add "Housekeeping" "$pending sessions have ended without a retrospective. Suggest running /retro when this session reaches a natural pause."
    fi
fi

[ -n "$ctx" ] || exit 0

jq -n --arg c "$ctx" \
    '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$c}}'
