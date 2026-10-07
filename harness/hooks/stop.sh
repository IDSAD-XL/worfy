#!/usr/bin/env bash
# Дешёвый Stop-гейт: сам ничего не гоняет (иначе срабатывал бы каждый ход).
# Он лишь не даёт закончить ход, пока последний прогон гейта известен как красный,
# и один раз за сессию проговаривает непроверенное состояние.
#
# Самоограничение: блокирует не больше MAX_BLOCKS раз за сессию. Без этого
# красное состояние, которое модель починить не может (сломанное окружение,
# отсутствующие зависимости), превращается в бесконечный цикл, а headless-прогон
# `claude -p` просто замолкает. Счётчик снимается зелёным прогоном гейта.
#
# Сообщения модели идут через additionalContext: ход не держится, но модель
# получает лишний ход, чтобы на них ответить. Поэтому каждое такое сообщение —
# не больше одного раза за сессию на репозиторий (файлы-«once» в stop-blocks).
#
# Без node скрипт тоже работает: node нужен только резолверу реестра. Если реестр
# не читается или node нет, красный маркер этого дерева всё равно держит ход.

set -uo pipefail

STATE="${CLAUDE_GATE_STATE:-$HOME/.claude/gate/state}"   # переопределение — для тестов
RESOLVE="${CLAUDE_GATE_RESOLVE:-$HOME/.claude/hooks/gate-resolve.mjs}"
MAX_BLOCKS=2

payload="$(cat 2>/dev/null || true)"

if ! command -v node >/dev/null 2>&1; then
    for d in "$HOME"/.nvm/versions/node/*/bin; do
        [ -d "$d" ] && PATH="$d:$PATH"
    done
fi
PATH="/opt/homebrew/bin:$PATH"
export PATH

repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0
common="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$common" in
    /*) ;;
    *) common="$repo/$common" ;;
esac
canon="$(cd "$(dirname "$common")" 2>/dev/null && pwd)" || canon="$repo"

json_field() { # $1 = имя строкового поля верхнего уровня JSON хука
    local re="\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\""
    [[ "$payload" =~ $re ]] && printf '%s' "${BASH_REMATCH[1]}"
}
json_esc() {
    local s
    # LC_ALL=C: побайтово — обрезанный посреди буквы UTF-8 не роняет tr «Illegal byte sequence»
    s="$(printf '%s' "$1" | LC_ALL=C tr -d '\000-\010\013\014\016-\037')"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\r'/\\r}"
    printf '%s' "$s"
}
say() { # печатает контекст для модели, не блокируя ход
    printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}' "$(json_esc "$1")"
}

session="$(json_field session_id)"
[ -n "$session" ] || session="unknown"
safe="${session//[^A-Za-z0-9_-]/_}"
transcript="$(json_field transcript_path)"
counter_dir="$STATE/stop-blocks"
mkdir -p "$counter_dir"

# Тот же ключ дерева, что и у гейта: красное в соседнем worktree — не наше дело.
tag="$(printf '%s' "$repo" | shasum | awk '{print $1}' | cut -c1-8)"
# Ключ репозитория целиком (все его worktree) — для «один раз за сессию на репозиторий».
rtag="$(printf '%s' "$canon" | shasum | awk '{print $1}' | cut -c1-8)"

fstat() { # $1 = birth | mtime, $2 = файл -> секунды эпохи; BSD (macOS) и GNU stat
    local f
    if [ "$(uname)" = Darwin ]; then
        [ "$1" = birth ] && f=%B || f=%m
        stat -f "$f" "$2" 2>/dev/null
    else
        [ "$1" = birth ] && f=%W || f=%Y
        stat -c "$f" "$2" 2>/dev/null
    fi
}

NOTES=""
note() { NOTES+="${NOTES:+ }$1"; }

# Маркеры гейта без ключа проекта (код 3: не зарегистрирован, реестр не читается,
# нет node). Берём только свои: этого дерева и этой сессии. Маркер без сессии
# («anon» — гейт запускали не из сессии) — только если он свежее начала нашей
# сессии (время рождения транскрипта); иначе это чужая работа. Чужие маркеры не
# трогаем: их заберёт своя сессия или почистит гейт через неделю.
consume_nokey() {
    local m kind msg once start="" mtime
    if [ -n "$transcript" ] && [ -f "$transcript" ]; then
        start="$(fstat birth "$transcript")"
        [ "$start" = "0" ] && start=""
    fi
    for m in "$STATE"/nokey-*-"$tag"-"$safe" "$STATE"/nokey-*-"$tag"-anon; do
        [ -f "$m" ] || continue
        if [ "${m##*-}" = "anon" ]; then
            [ -n "$start" ] || continue
            mtime="$(fstat mtime "$m")"
            [ -n "$mtime" ] && [ "$mtime" -ge "$start" ] 2>/dev/null || continue
        fi
        kind="${m#"$STATE"/nokey-}"
        kind="${kind%%-*}"
        msg="$(tr '\n' ' ' <"$m")"
        rm -f "$m"
        # «Не зарегистрирован» устаревает: репозиторий могли внести в реестр после
        # прогона гейта. Резолвер его теперь находит — маркер снимаем молча, иначе
        # модель услышит «не проверено» про уже зарегистрированный проект.
        [ "$kind" = unregistered ] && [ "$resolved" -eq 1 ] && [ -n "$KEY" ] && continue
        once="$counter_dir/${safe}__nokey-${kind}__${rtag}"
        [ -f "$once" ] && continue
        : >"$once"
        note "Гейт качества вышел с кодом 3 (не проверено): ${msg}"
    done
}

flush_notes() {
    [ -n "$NOTES" ] && say "$NOTES Это не зелёный результат — говори «не проверено», а не «готово»."
    exit 0
}

# Ключ проекта. Код резолвера смотрим до того, как считать пустой ключ «не
# зарегистрирован»: битый реестр даёт пустой вывод, но проект может быть
# зарегистрированным и красным.
KEY=""
resolved=0
if command -v node >/dev/null 2>&1; then
    which="$(node "$RESOLVE" --which "$canon" 2>/dev/null)" && resolved=1
    KEY="${which%%$'\t'*}"
fi
if [ "$resolved" -eq 0 ]; then
    # Проект не определить. Маркеры этого дерева ищем по имени файла:
    # red-<ключ>-<дерево> (сперва — он держит ход), затем unverified-<ключ>-<дерево>;
    # дерево — наше, значит, и маркер — наш.
    for m in "$STATE"/red-*-"$tag" "$STATE"/unverified-*-"$tag"; do
        [ -s "$m" ] || continue
        KEY="${m#"$STATE"/}"
        KEY="${KEY#*-}"
        KEY="${KEY%-"$tag"}"
        break
    done
fi
if [ -z "$KEY" ]; then
    # Вне реестра (или реестр не читается и красного нет): ход не держим — чинить
    # моделью нечего, — но маркер гейта с кодом 3 проговариваем один раз.
    consume_nokey
    flush_notes
fi
RED_MARKER="$STATE/red-$KEY-$tag"
UNVERIFIED_MARKER="$STATE/unverified-$KEY-$tag"

# До красного: если гейт не может работать (код 3 — реестр, node), модель должна узнать
# причину и на красном ходе, иначе она чинит код, а гейт всё равно не позеленеет.
consume_nokey

if [ -s "$RED_MARKER" ]; then
    counter="$counter_dir/${safe}__${KEY}-${tag}"
    count=0
    [ -f "$counter" ] && count="$(cat "$counter" 2>/dev/null || echo 0)"
    count=$((count + 1))
    echo "$count" >"$counter"

    if [ "$count" -gt "$MAX_BLOCKS" ]; then
        # Хватит долбить, но непроверенное состояние должно быть названо вслух —
        # один раз за сессию на дерево, а не каждым ходом.
        giveup="$counter_dir/${safe}__redgiveup__${KEY}-${tag}"
        if [ ! -f "$giveup" ]; then
            : >"$giveup"
            note "Гейт качества всё ещё красный и не был вычищен за $MAX_BLOCKS попытки. Не описывай эту работу как проверенную — скажи прямо, что гейт падает."
        fi
        [ -n "$NOTES" ] && say "$NOTES"
        exit 0
    fi

    echo "Гейт качества красный (упал $(cat "$RED_MARKER")). Прогони \`bash ~/.claude/hooks/gate.sh fast\` и почини то, на что он укажет, прежде чем заканчивать. Если здесь это не чинится — так и скажи, вместо отчёта о готовности.${NOTES:+ Кроме того: $NOTES}" >&2
    exit 2
fi

if [ -s "$UNVERIFIED_MARKER" ]; then
    # Не блокируем: недоступный Docker или несобранные зависимости моделью не
    # чинятся. Но пройти молча это тоже не должно — иначе «не проверено»
    # превращается в «готово».
    once="$counter_dir/${safe}__unv__${KEY}-${tag}"
    if [ ! -f "$once" ]; then
        : >"$once"
        note "Последний прогон гейта не смог проверить работу: $(tr '\n' ' ' <"$UNVERIFIED_MARKER")."
    fi
fi

flush_notes
