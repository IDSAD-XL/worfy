#!/usr/bin/env bash
# Блоки shell из skills/overnight-fix-loop/SKILL.md, которые делят строку на слова, —
# под bash и под zsh (Bash-инструмент Claude Code запускает zsh, а zsh не делит переменную
# без кавычек на слова). Блоки вырезаются из самого SKILL.md, профиль подменяется заглушкой F.
# Ниже — блоки skills/qmd (таблица коллекций) и skills/tickets-to-tasks (инструмент из профиля).
# Запуск: bash harness/bin/tests/skill-blocks.test.sh; код выхода 0 — всё прошло.
# SKILL_FILE — проверить другую копию SKILL.md.
set -u
# The SKILL.md files under test are the copies in harness/skills, next to this test.
SKILLS="$(cd "$(dirname "$0")/../.." && pwd)/skills"
SKILL="${SKILL_FILE:-$SKILLS/overnight-fix-loop/SKILL.md}"
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

# --- skills/qmd: таблица коллекций из профилей и index.yml -----------------------------
QSKILL="${QMD_SKILL_FILE:-$SKILLS/qmd/SKILL.md}"
B3="$(SKILL="$QSKILL" block 'profiles/*/profile.json')"
[ -n "$B3" ] || bad "qmd collections block not found in $QSKILL"
H="$T/home"; mkdir -p "$H/.claude/profiles/p1" "$H/.claude/profiles/p2" "$H/.config/qmd"
echo '{"name":"p1","qmd":{"collections":["c1","c2"],"covers":"docs of p1"}}' >"$H/.claude/profiles/p1/profile.json"
echo '{"name":"p2"}' >"$H/.claude/profiles/p2/profile.json"
printf 'collections:\n  c1:\n    path: /x/one\n    pattern: "**/*.md"\n  c2:\n    path: /x/two\nmodels:\n  embed: e\n' >"$H/.config/qmd/index.yml"
want="$(printf 'p1: c1, c2 — docs of p1\np2:  — поля qmd нет\nc1\t/x/one\nc2\t/x/two')"
for sh in bash zsh; do
    got="$(HOME="$H" $sh -c "$B3" 2>&1)"
    [ "$got" = "$want" ] && ok "$sh: qmd block prints profile collections and index paths" \
        || bad "$sh: qmd block: got [$got] want [$want]"
done

# --- skills/tickets-to-tasks: инструмент и шаблон списка из профиля --------------------
TSKILL="${TASKS_SKILL_FILE:-$SKILLS/tickets-to-tasks/SKILL.md}"
B4="$(SKILL="$TSKILL" block 'tasks.tool')"
[ -n "$B4" ] || bad "tickets-to-tasks profile block not found in $TSKILL"
# The block calls the live ~/.claude/bin/profile: it runs only with the live registry and repositories.
ATAKAMA="$HOME/Work/Atakama" AUCTION="$HOME/Work/Auction"
if [ -f "$HOME/.claude/gate/config.json" ] && [ -d "$ATAKAMA/Atakama-Browser-Server" ] && [ -d "$AUCTION" ]; then
    for sh in bash zsh; do
        got="$($sh -c "${B4//<repo>/$ATAKAMA}" 2>&1)"
        [[ "$got" == *"КОД=0"* && "$got" == *"tool: $HOME/.claude/profiles/atakama/bin/tickets.mjs"* && "$got" == *"atakama-<slug>"* ]] \
            && [ -f "$HOME/.claude/profiles/atakama/bin/tickets.mjs" ] \
            && ok "$sh: tickets-to-tasks block resolves the tool with ~ expanded" || bad "$sh: tickets-to-tasks atakama: [$got]"
        got="$($sh -c "${B4//<repo>/$AUCTION}" 2>&1)"
        [[ "$got" == *"КОД=4"* ]] && ok "$sh: tickets-to-tasks block: project without tasks -> 4" || bad "$sh: tickets-to-tasks auction: [$got]"
    done
else
    echo "skip tickets-to-tasks block: live registry or Atakama/Auction missing"
fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
