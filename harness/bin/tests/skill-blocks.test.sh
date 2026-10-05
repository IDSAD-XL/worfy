#!/usr/bin/env bash
# Блоки shell из skills/overnight-fix-loop/SKILL.md, которые делят строку на слова, —
# под bash и под zsh (Bash-инструмент Claude Code запускает zsh, а zsh не делит переменную
# без кавычек на слова). Блоки вырезаются из самого SKILL.md, профиль подменяется заглушкой F.
# Запуск: bash ~/.claude/bin/tests/skill-blocks.test.sh; код выхода 0 — всё прошло.
# SKILL_FILE — проверить другую копию SKILL.md.
set -u
SKILL="${SKILL_FILE:-$HOME/.claude/skills/overnight-fix-loop/SKILL.md}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

block() { # $1 = строка, по которой узнаётся блок ```bash; печатает его без строки `F() {…profile…}`
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$SKILL" \
        | grep -v '^F() { ~/.claude/bin/profile'
}
STUB='F() { case "$1" in
  worktree.base) echo main ;;
  layout.packages) echo "[\"apps/api\",\"apps/web\"]" ;;
  modules) echo "{}" ;;
  tests.globs) echo "[\"*.test.ts\",\"*.spec.ts\"]" ;;
  *) return 4 ;;
esac; }'

R="$T/repo"; mkdir -p "$R/apps/api/src/auctions" "$R/apps/web/src/catalog" "$R/apps/api/test" "$R/apps/api/src/lots"
git -C "$R" init -q -b main
echo a >"$R/apps/api/src/auctions/a.ts"; echo b >"$R/apps/web/src/catalog/b.ts"; echo c >"$R/apps/api/src/lots/c.ts"
echo "import x from '../src/auctions/a'" >"$R/apps/api/test/auctions.test.ts"
echo "import y from './auctions/a'" >"$R/apps/api/src/z.spec.ts"
echo "import y from '../auctions/a'" >"$R/apps/api/src/lots/c.notatest.ts"
git -C "$R" add -A && git -C "$R" -c user.email=t@t -c user.name=t commit -q -m init

# Блок выбора модулей: пути pathspec из layout.packages.
B1="$(block 'git log "$BASE" --since=30.days')"
[ -n "$B1" ] || bad "module-choice block not found in $SKILL"
want="$(printf '%s\n' apps/api/src/auctions apps/api/src/lots apps/web/src/catalog)"
for sh in bash zsh; do
    got="$(cd "$R" && $sh -c "$STUB"$'\n'"$B1" 2>&1 | awk '{print $2}' | sort)"
    [ "$got" = "$want" ] && ok "$sh: module-choice block lists modules of every package" \
        || bad "$sh: module-choice block: got [$(echo $got)] want [$(echo $want)]"
done

# Блок списка тестов модуля: маски --include из tests.globs.
B2="$(block 'grep -rslE')"
[ -n "$B2" ] || bad "test-list block not found in $SKILL"
B2="${B2//<каталог пакета>/$R/apps/api}"; B2="${B2//<имя>/auctions}"
want="$(printf '%s\n' src/z.spec.ts test/auctions.test.ts)"
for sh in bash zsh; do
    got="$(cd "$R" && $sh -c "$STUB"$'\n'"$B2" 2>&1 | sort)"
    [ "$got" = "$want" ] && ok "$sh: test-list block finds test files by every glob" \
        || bad "$sh: test-list block: got [$(echo $got)] want [$(echo $want)]"
done

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
