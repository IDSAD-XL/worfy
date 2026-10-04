#!/usr/bin/env bash
# Дешёвый Stop-гейт: сам ничего не гоняет (иначе срабатывал бы каждый ход).
# Он лишь не даёт закончить ход, пока последний прогон гейта известен как красный,
# и один раз за сессию проговаривает непроверенное состояние.
#
# Самоограничение: блокирует не больше MAX_BLOCKS раз за сессию. Без этого
# красное состояние, которое модель починить не может (сломанное окружение,
# отсутствующие зависимости), превращается в бесконечный цикл, а headless-прогон
# `claude -p` просто замолкает. Счётчик снимается зелёным прогоном гейта.

set -uo pipefail

STATE="$HOME/.claude/gate/state"
RESOLVE="$HOME/.claude/hooks/gate-resolve.mjs"
MAX_BLOCKS=2

payload="$(cat 2>/dev/null || true)"

if ! command -v node >/dev/null 2>&1; then
    for d in "$HOME"/.nvm/versions/node/*/bin; do
        [ -d "$d" ] && PATH="$d:$PATH"
    done
fi
PATH="/opt/homebrew/bin:$PATH"
export PATH
command -v node >/dev/null 2>&1 || exit 0

repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0
common="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$common" in
    /*) ;;
    *) common="$repo/$common" ;;
esac
canon="$(cd "$(dirname "$common")" 2>/dev/null && pwd)" || canon="$repo"

KEY="$(node "$RESOLVE" --which "$canon" 2>/dev/null | cut -f1)"
[ -n "$KEY" ] || exit 0 # каталог вне настроенных репозиториев

# Тот же ключ дерева, что и у гейта: красное в соседнем worktree — не наше дело.
tag="$(printf '%s' "$repo" | shasum | awk '{print $1}' | cut -c1-8)"
RED_MARKER="$STATE/red-$KEY-$tag"
UNVERIFIED_MARKER="$STATE/unverified-$KEY-$tag"

session="$(printf '%s' "$payload" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).session_id||"")}catch{}})' 2>/dev/null)"
[ -n "$session" ] || session="unknown"
counter_dir="$STATE/stop-blocks"
mkdir -p "$counter_dir"
safe="${session//[^A-Za-z0-9_-]/_}"

say() { # печатает контекст для модели, не блокируя ход
    node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"Stop",additionalContext:process.argv[1]}}))' "$1" 2>/dev/null
}

if [ -s "$RED_MARKER" ]; then
    counter="$counter_dir/${safe}__${KEY}-${tag}"
    count=0
    [ -f "$counter" ] && count="$(cat "$counter" 2>/dev/null || echo 0)"
    count=$((count + 1))
    echo "$count" >"$counter"

    if [ "$count" -gt "$MAX_BLOCKS" ]; then
        # Хватит долбить, но непроверенное состояние должно быть названо вслух.
        say "Гейт качества всё ещё красный и не был вычищен за $MAX_BLOCKS попытки. Не описывай эту работу как проверенную — скажи прямо, что гейт падает."
        exit 0
    fi

    echo "Гейт качества красный (упал $(cat "$RED_MARKER")). Прогони \`bash ~/.claude/hooks/gate.sh fast\` и почини то, на что он укажет, прежде чем заканчивать. Если здесь это не чинится — так и скажи, вместо отчёта о готовности." >&2
    exit 2
fi

if [ -s "$UNVERIFIED_MARKER" ]; then
    # Не блокируем: недоступный Docker или несобранные зависимости моделью не
    # чинятся. Но пройти молча это тоже не должно — иначе «не проверено»
    # превращается в «готово».
    once="$counter_dir/${safe}__unv__${KEY}-${tag}"
    if [ ! -f "$once" ]; then
        : >"$once"
        say "Последний прогон гейта не смог проверить работу: $(tr '\n' ' ' <"$UNVERIFIED_MARKER"). Это не зелёный результат — говори «не проверено», а не «готово»."
    fi
    exit 0
fi

exit 0
