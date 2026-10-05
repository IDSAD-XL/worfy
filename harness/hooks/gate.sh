#!/usr/bin/env bash
# Гейт качества. Гоняет линт и тесты там, где менялись файлы относительно
# merge-base с origin/main, а при сомнительной базе (её нет, HEAD отсоединён,
# ветка далеко от origin/main) — во всех пакетах; выбранный набор и причину
# печатает строкой «[gate] набор …». Кэширует зелёные результаты по отпечатку
# содержимого (попадание печатается как «[gate] зелено (…): … (кэш)») и выходит
# с кодом 2 на красном («[gate] красно (…): …»).
#
#   gate.sh fast   -> потикетный профиль (TaskCompleted / TeammateIdle)
#   gate.sh full   -> всё (руками или на закрытии эпика)
#
# Репозиторий опознаётся по общему git-каталогу, а не по пути: рабочие деревья
# лежат и внутри репозитория, и рядом с ним (Auction-arch, Auction-sale-loop).
#
# Главное правило: «ничего не прогналось» — это не «зелено». Красный маркер
# снимается только прогоном, который действительно что-то проверил.
#
# Коды выхода:
#   0 — зелено, «ничего не прогналось», «ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение
#       недоступно» (маркер unverified) или каталог вне git — различаются по
#       строке «[gate] …», а не по коду;
#   2 — красно (TaskCompleted / TeammateIdle на этом коде не дают закончить);
#   3 — не проверено: ни зелено, ни красно. Строка «[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: …»
#       называет причину: проект не зарегистрирован в gate/config.json; реестр не
#       читается или резолвер упал; node не найден. Код не блокирующий для хуков
#       (блокирует только 2). Гейт оставляет маркер на дерево и сессию; stop.sh
#       говорит о нём модели не больше одного раза за сессию на репозиторий
#       (через additionalContext — это стоит модели лишнего хода, поэтому один раз)
#       и ход не держит. Агенты кладут код 3 в not_verified, скиллы на нём не мержат.

set -uo pipefail

PROFILE="${1:-fast}"
CONFIG="${CLAUDE_GATE_CONFIG:-$HOME/.claude/gate/config.json}"
export CLAUDE_GATE_CONFIG="$CONFIG"
STATE="${CLAUDE_GATE_STATE:-$HOME/.claude/gate/state}"   # переопределение — для тестов
CACHE="$STATE/cache"
RESOLVE="${CLAUDE_GATE_RESOLVE:-$HOME/.claude/hooks/gate-resolve.mjs}"

mkdir -p "$CACHE" "$STATE/stop-blocks"

# Хуки присылают JSON на stdin и закрывают его — вычерпываем. При ручном запуске из
# Bash-инструмента stdin открыт и пуст, и `cat` ждал бы EOF вечно (так гейт «подвисал»,
# пока владелец не спросил «Ты подвис?»): читаем построчно не дольше двух секунд на
# строку и дальше не ждём. На терминале (stdin — TTY) читать нечего.
hook_in=""
if [ ! -t 0 ]; then
    while :; do
        _line=""
        IFS= read -r -t 2 _line 2>/dev/null
        r=$?
        hook_in+="$_line"
        [ "$r" -eq 0 ] || break
        hook_in+=$'\n'
    done
fi

# Чья это сессия: session_id из JSON хука, иначе CLAUDE_CODE_SESSION_ID (его видит
# ручной запуск из Bash-инструмента; у субагентов он тот же, что у родителя).
# Нужен, чтобы маркер «проверить не удалось» без ключа проекта доставлялся только
# той сессии, что гоняла гейт, а не соседней в том же дереве.
SESSION=""
re_sid='"session_id"[[:space:]]*:[[:space:]]*"([^"]+)"'
[[ "$hook_in" =~ $re_sid ]] && SESSION="${BASH_REMATCH[1]}"
[ -n "$SESSION" ] || SESSION="${CLAUDE_CODE_SESSION_ID:-}"
SESSION="${SESSION//[^A-Za-z0-9_-]/_}"

# Шелл хука стартует с голым PATH; делаем node и пакетные менеджеры достижимыми.
if ! command -v node >/dev/null 2>&1; then
    for d in "$HOME"/.nvm/versions/node/*/bin; do
        [ -d "$d" ] && PATH="$d:$PATH"
    done
fi
PATH="/opt/homebrew/bin:$PATH:$HOME/.local/share/pnpm"
export PATH

# Проверять надо рабочее дерево, а опознавать — репозиторий целиком.
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0
common="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$common" in
    /*) ;;
    *) common="$repo/$common" ;;
esac
canon="$(cd "$(dirname "$common")" 2>/dev/null && pwd)" || canon="$repo"
tag="$(printf '%s' "$repo" | shasum | awk '{print $1}' | cut -c1-8)"

# Маркеры без ключа проекта (проект не определён) старше недели — мусор от
# брошенных сессий и удалённых worktree.
find "$STATE" -maxdepth 1 -name 'nokey-*' -mtime +7 -delete 2>/dev/null
find "$STATE/stop-blocks" -maxdepth 1 -name '*__*' -mtime +7 -delete 2>/dev/null   # счётчики и «once» stop.sh

# «Проверить не удалось» без ключа проекта: код 3, строка «[gate] ПРОВЕРИТЬ НЕ
# УДАЛОСЬ: …» и маркер для stop.sh. Маркер — на дерево и на сессию
# (nokey-<вид>-<дерево>-<сессия>); без сессии — «anon», и stop.sh берёт такой
# маркер, только если тот свежее начала его собственной сессии.
#   $1 — вид (unregistered | broken), $2 — строка после «ПРОВЕРИТЬ НЕ УДАЛОСЬ: »,
#   $3 — пояснение для модели. В маркер уходят оба: «$2. $3».
not_verified() {
    printf '%s. %s\n' "$2" "$3" >"$STATE/nokey-$1-$tag-${SESSION:-anon}" 2>/dev/null || true
    {
        echo "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: $2"
        echo "$3"
    } >&2
    exit 3
}

command -v node >/dev/null 2>&1 ||
    not_verified broken "node не найден" \
        "Репозиторий: $repo. Гейт без node не работает — это не «зелено»: работа гейтом не проверена."

which="$(node "$RESOLVE" --which "$canon" 2>"$STATE/.resolve-err-$$")"
rc=$?
rerr="$(head -n 1 "$STATE/.resolve-err-$$" 2>/dev/null)"   # строка целиком: обрезка байтами режет букву UTF-8
rm -f "$STATE/.resolve-err-$$"
if [ "$rc" -ne 0 ]; then
    # Упавший резолвер (битый реестр, сломанный node) — это не «каталог вне
    # репозиториев» и не «не зарегистрирован». Молчать и выходить с 0 тоже нельзя.
    not_verified broken "резолвер gate-resolve.mjs завершился с кодом $rc" \
        "Репозиторий: $repo. ${rerr:+Причина: $rerr. }Проект не определён, ничего не проверено — это не «зелено»."
fi
# Репозиторий вне реестра: раньше здесь был молчаливый `exit 0`, и «гейт молчит»
# читалось как «гейт доволен». Теперь — громко и кодом 3.
if [ -z "$which" ]; then
    not_verified unregistered "проект не зарегистрирован в ~/.claude/gate/config.json" \
        "Репозиторий $repo не зарегистрирован в $CONFIG — гейт ничего не проверял. Это не «зелено»: работа гейтом не проверена."
fi
# Разбор TSV без `IFS=$'\t' read`: таб — пробельный символ IFS, два таба подряд
# схлопываются, и пустое поле пропадает (так строка корня ".\t\tlint" теряла
# имя скрипта, и корневой lint не запускался вовсе). Режем руками.
split3() { # $1 = строка; кладёт поля в F1 F2 F3, пустые поля сохраняются
    local line="$1" rest
    F1="${line%%$'\t'*}"
    rest="${line#*$'\t'}"
    [ "$rest" = "$line" ] && rest=""
    F2="${rest%%$'\t'*}"
    F3="${rest#*$'\t'}"
    [ "$F3" = "$rest" ] && F3=""
}
split3 "$which"
KEY="$F1" MATCH="$F2" PM="$F3"
# Строки плана длиннее трёх полей (пути отпечатка, «добавлен от») — режем все поля
# в массив FLD тем же способом, с сохранением пустых.
splitn() { # $1 = строка
    local line="$1"
    FLD=()
    while :; do
        FLD+=("${line%%$'\t'*}")
        [ "$line" = "${line#*$'\t'}" ] && break
        line="${line#*$'\t'}"
    done
}

# Маркеры — на каждое рабочее дерево своё (tag выше): у Auction их два десятка, и
# красное в одном не должно мешать закончить ход в другом.
RED_MARKER="$STATE/red-$KEY-$tag"
UNVERIFIED_MARKER="$STATE/unverified-$KEY-$tag"

# --- какой набор проверять ------------------------------------------------------
# Сужение по диффу от merge-base с origin/main верно только для обычной ветки,
# отведённой недавно. Во всех остальных случаях дифф врёт в меньшую сторону, и
# гейт молча проверял один-два пакета. Поэтому: базы нет, merge-base не
# находится, HEAD отсоединён или ветка далеко от origin/main — проверяем всё.
# GATE_SCOPE=all принудительно включает полный набор.
MAX_AHEAD="${GATE_MAX_AHEAD:-50}"
MAX_BEHIND="${GATE_MAX_BEHIND:-300}"
SCOPE_ALL=0
SCOPE_WHY=""
base_ref="$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
if [ -z "$base_ref" ] && git -C "$repo" rev-parse --verify -q refs/remotes/origin/main >/dev/null 2>&1; then
    base_ref="origin/main"
fi
mb=""
[ -n "$base_ref" ] && mb="$(git -C "$repo" merge-base HEAD "$base_ref" 2>/dev/null || true)"
if [ "${GATE_SCOPE:-}" = "all" ]; then
    SCOPE_ALL=1 SCOPE_WHY="задано GATE_SCOPE=all"
elif [ -z "$base_ref" ]; then
    SCOPE_ALL=1 SCOPE_WHY="нет ни origin/HEAD, ни origin/main — базы для диффа нет"
elif [ -z "$mb" ]; then
    SCOPE_ALL=1 SCOPE_WHY="merge-base HEAD с $base_ref не находится"
elif ! git -C "$repo" symbolic-ref -q HEAD >/dev/null 2>&1; then
    SCOPE_ALL=1 SCOPE_WHY="HEAD отсоединён (detached) — неизвестно, какая ветка проверяется"
else
    counts="$(git -C "$repo" rev-list --left-right --count "$base_ref...HEAD" 2>/dev/null || true)"
    behind="${counts%%[[:space:]]*}"
    ahead="${counts##*[[:space:]]}"
    if ! [[ "$behind" =~ ^[0-9]+$ && "$ahead" =~ ^[0-9]+$ ]]; then
        SCOPE_ALL=1 SCOPE_WHY="не удалось посчитать расхождение с $base_ref"
    elif [ "$ahead" -gt "$MAX_AHEAD" ]; then
        SCOPE_ALL=1 SCOPE_WHY="ветка впереди $base_ref на $ahead коммитов (порог GATE_MAX_AHEAD=$MAX_AHEAD) — долгоживущая ветка"
    elif [ "$behind" -gt "$MAX_BEHIND" ]; then
        SCOPE_ALL=1 SCOPE_WHY="ветка отстала от $base_ref на $behind коммитов (порог GATE_MAX_BEHIND=$MAX_BEHIND)"
    fi
fi

changed_paths() {
    {
        # рабочее дерево и индекс, со снятыми стрелками переименования
        git -C "$repo" -c core.quotePath=false status --porcelain 2>/dev/null | sed 's/^...//; s/.* -> //'
        # всё, что ветка добавила поверх своей базы
        [ -n "$mb" ] && git -C "$repo" -c core.quotePath=false diff --name-only "$mb"...HEAD 2>/dev/null
    } | sed 's/^"//; s/"$//; /^$/d' | sort -u
}

# Отпечаток без HEAD — это отпечаток пустоты, то есть вечная константа: такое
# кэшировать нельзя.
# Пути — сам пакет и его зависимости-воркспейсы: незакоммиченная правка в
# packages/shared должна менять отпечаток каждого пакета, который от него зависит.
fingerprint() { # $@ = пути внутри репозитория
    local head
    head="$(git -C "$repo" rev-parse HEAD 2>/dev/null)" || return 1
    [ -n "$head" ] || return 1
    {
        echo "$head"
        echo "scope: $*"
        git -C "$repo" diff HEAD -- "$@" 2>/dev/null
        git -C "$repo" ls-files --others --exclude-standard -- "$@" 2>/dev/null |
            while read -r f; do shasum "$repo/$f" 2>/dev/null; done
    } | shasum | awk '{print $1}'
}

run_script() { # $1 = имя пакета (пусто = корень), $2 = скрипт
    local pkg="$1" script="$2"
    if [ -n "$pkg" ]; then
        case "$PM" in
            pnpm) (cd "$repo" && pnpm --filter "$pkg" run "$script" 2>&1) ;;
            yarn) (cd "$repo" && yarn workspace "$pkg" run "$script" 2>&1) ;;
            *) (cd "$repo" && npm run "$script" --workspace "$pkg" 2>&1) ;;
        esac
    else
        (cd "$repo" && "$PM" run "$script" 2>&1)
    fi
}

# Отсутствующее окружение — не дефект кода. Блокировать по нему нельзя, но и
# засчитывать за зелёное тоже: такая работа остаётся непроверенной.
UNVERIFIABLE='command not found|Cache entry required but missing|ENOENT.*node_modules'
UNVERIFIABLE+='|Cannot connect to the Docker daemon|Could not find a working container runtime'
UNVERIFIABLE+='|docker daemon is not running|ECONNREFUSED.*:5432|could not connect to server'

# Строка про окружение может попасться и в стеке настоящего падения теста.
# Признак живого прогона важнее: если тесты отчитались, это провал, а не среда.
real_failure() {
    printf '%s' "$1" | grep -qE 'Tests?[[:space:]]+[0-9]+[[:space:]]+(failed|passed)|^ *FAIL |AssertionError|✗|Expected .* to'
}

FAILED=0
REPORT=""
RAN=""
CACHED=""
FAILED_LABELS=""
ENV_BROKEN=""

changed="$(changed_paths)"
nchanged=0
[ -n "$changed" ] && nchanged="$(printf '%s\n' "$changed" | wc -l | tr -d ' ')"
if [ "$SCOPE_ALL" -eq 0 ] && [ -z "$changed" ]; then
    echo "[gate] ничего не прогналось ($PROFILE): нет изменений относительно merge-base ${mb:0:8} с $base_ref. Это не «зелено»."
    exit 0
fi

plan="$(printf '%s\n' "$changed" | GATE_ALL="$SCOPE_ALL" node "$RESOLVE" "$repo" "$PROFILE" "$KEY")"
rc=$?
if [ "$rc" -ne 0 ]; then
    # Упавший резолвер дал бы пустой план, а пустой план читается как «ничего не
    # затронуто». Это не так: проверить не удалось. Красный маркер не трогаем.
    printf 'Профиль %s, репозиторий %s. Проверить не удалось: резолвер плана завершился с кодом %s.\n' \
        "$PROFILE" "$KEY" "$rc" >"$UNVERIFIED_MARKER"
    echo "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер плана gate-resolve.mjs завершился с кодом $rc — ничего не проверено, это не «зелено»." >&2
    exit 3
fi

# Набор печатается всегда: по нему видно, сузился ли гейт и почему.
plan_dirs=""
plan_added=""
while IFS= read -r line; do
    [ -n "$line" ] || continue
    splitn "$line"
    plan_dirs+=" ${FLD[0]}"
    [ -n "${FLD[4]:-}" ] && plan_added+="${plan_added:+, }${FLD[0]} (от ${FLD[4]//,/, })"
done <<<"$plan"
if [ "$SCOPE_ALL" -eq 1 ]; then
    echo "[gate] набор ($PROFILE): все пакеты —${plan_dirs:- пусто} (причина: $SCOPE_WHY)"
else
    echo "[gate] набор ($PROFILE): сужен по диффу от merge-base ${mb:0:8} с $base_ref (ветка впереди на $ahead, позади на $behind; изменено файлов: $nchanged) —${plan_dirs:- пусто}${plan_added:+; добавлены как зависимые: $plan_added}. Полный набор: GATE_SCOPE=all"
fi
if [ -z "$plan_dirs" ]; then
    echo "[gate] ничего не прогналось ($PROFILE): изменения не затрагивают проверяемые пакеты. Это не «зелено»."
    exit 0
fi

while IFS= read -r line; do
    [ -n "$line" ] || continue
    splitn "$line"
    wsdir="${FLD[0]}" pkgname="${FLD[1]:-}" scripts="${FLD[2]:-}" fpscope="${FLD[3]:-}"
    [ -n "$scripts" ] || continue
    [ -n "$fpscope" ] || fpscope="$wsdir"

    # В ключ входит и состав скриптов: расширили профиль — старое зелёное не в счёт.
    shash="$(printf '%s' "$scripts" | shasum | awk '{print $1}' | cut -c1-8)"
    key="$CACHE/${KEY}__${tag}__${wsdir//\//_}__${PROFILE}__${shash}"
    # shellcheck disable=SC2086 # пути воркспейсов без пробелов, делим намеренно
    fp="$(fingerprint $fpscope)" || fp=""
    if [ -n "$fp" ] && [ -f "$key" ] && [ "$(cat "$key")" = "$fp" ]; then
        # Не менялось с тех пор, как позеленело. Кэшируется только зелёное:
        # красное всегда прогоняется заново, чтобы флак не залипал.
        for script in $scripts; do CACHED+=" $KEY/$wsdir:$script"; done
        continue
    fi

    ws_ok=1
    for script in $scripts; do
        label="$KEY/$wsdir:$script"
        out="$(run_script "$pkgname" "$script" </dev/null)" # stdin цикла — план, не отдавать его pnpm
        rc=$?
        if [ "$rc" -eq 0 ]; then
            RAN+=" $label"
        elif printf '%s' "$out" | grep -qE "$UNVERIFIABLE" && ! real_failure "$out"; then
            ws_ok=0
            ENV_BROKEN+=$'\n'"  $label: $(printf '%s\n' "$out" | grep -m1 -E "$UNVERIFIABLE")"
        else
            ws_ok=0
            FAILED=1
            FAILED_LABELS+=" $label"
            REPORT+=$'\n'"--- УПАЛО: $label"$'\n'"$(printf '%s\n' "$out" | tail -n 40)"$'\n'
        fi
    done

    [ "$ws_ok" -eq 1 ] && [ -n "$fp" ] && echo "$fp" >"$key"
done <<<"$plan"

if [ "$FAILED" -eq 1 ]; then
    date -u +%Y-%m-%dT%H:%M:%SZ >"$RED_MARKER"
    {
        echo "[gate] красно ($PROFILE):$FAILED_LABELS${RAN:+ (прошло:$RAN)}"
        echo "Гейт качества не пройден (профиль: $PROFILE, репозиторий: $KEY)."
        echo "Это надо починить до отчёта о готовности."
        echo "$REPORT"
    } >&2
    exit 2
fi

if [ -n "$ENV_BROKEN" ]; then
    {
        printf 'Профиль %s, репозиторий %s. Проверить не удалось:%s\n' "$PROFILE" "$KEY" "$ENV_BROKEN"
    } >"$UNVERIFIED_MARKER"
    {
        echo "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно:"
        echo "$ENV_BROKEN"
        echo "Это не зелёный результат. Так и говори: работа не проверена, — вместо отчёта об успехе."
    } >&2
elif [ -n "$RAN$CACHED" ]; then
    # Чистим только по итогам проверки, которая действительно что-то проверила:
    # свежий прогон или кэш, записанный зелёным прогоном того же содержимого.
    # Иначе красное состояние отмывалось бы правкой документа.
    rm -f "$RED_MARKER" "$UNVERIFIED_MARKER"
    rm -f "$STATE/stop-blocks/"*"__${KEY}-${tag}" 2>/dev/null
    # Строка «[gate] зелено (<профиль>): …» — единственный признак зелёного, и
    # при попадании в кэш она тоже печатается, с пометкой «(кэш)».
    if [ -z "$RAN" ]; then
        echo "[gate] зелено ($PROFILE):$CACHED (кэш)"
    elif [ -n "$CACHED" ]; then
        echo "[gate] зелено ($PROFILE):$RAN (кэш:$CACHED)"
    else
        echo "[gate] зелено ($PROFILE):$RAN"
    fi
else
    echo "[gate] ничего не прогналось ($PROFILE): у выбранных пакетов нет скриптов профиля. Это не «зелено»."
fi

exit 0
