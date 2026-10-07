#!/usr/bin/env bash
# Тесты корня тикетов у ~/.claude/bin/ticket и ~/.claude/bin/epic-status: поле tickets.root
# профиля, флаг --root и прежнее поведение вне реестра (<git top-level>/.scratch).
# Запуск: bash harness/bin/tests/tickets-root.test.sh; код выхода 0 — всё прошло.
#
# Реестр и профили — временные (CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR); живой реестр не читается.
set -u
# The scripts under test are the copies next to this test (harness/).
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"   # BIN_DIR — прогнать тест на другой копии инструментов
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
TICKET="$BIN/ticket"
STATUS="$BIN/epic-status"
export CLAUDE_TICKET_BIN="$TICKET"
export CLAUDE_PROFILE_BIN="$BIN/profile"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
WS="$T/ws"            # общий каталог, как ~/Work/Atakama: сам не git
mkdir -p "$WS/Repo-A/src" "$WS/Repo-B" "$T/rel" "$T/unreg" "$CLAUDE_PROFILES_DIR/multi" "$CLAUDE_PROFILES_DIR/rel"
for r in "$WS/Repo-A" "$WS/Repo-B" "$T/rel" "$T/unreg"; do
    git -C "$r" init -q -b main && git -C "$r" commit -q --allow-empty -m init
done
cat >"$CLAUDE_GATE_CONFIG" <<EOF
{"repos":[
 {"key":"A","match":"$WS/Repo-A","profile":"multi","pm":"npm","root":{},"workspace":{}},
 {"key":"B","match":"$WS/Repo-B","profile":"multi","pm":"npm","root":{},"workspace":{}},
 {"key":"rel","match":"$T/rel","profile":"rel","pm":"npm","root":{},"workspace":{}}
]}
EOF
printf '{"schema":1,"name":"multi","tickets":{"root":"%s/.scratch/"}}\n' "$WS" >"$CLAUDE_PROFILES_DIR/multi/profile.json"
printf '{"schema":1,"name":"rel","tickets":{"root":".scratch/"}}\n' >"$CLAUDE_PROFILES_DIR/rel/profile.json"
: >"$CLAUDE_PROFILES_DIR/multi/rules.md"; : >"$CLAUDE_PROFILES_DIR/rel/rules.md"

mk() { # <корень тикетов> <эпик> <NN-slug> <Status>
    mkdir -p "$1/$2/issues"
    printf '# %s — заголовок\n\nStatus: %s\nBlocked by: none\n' "${3%%-*}" "$4" >"$1/$2/issues/$3.md"
}
mk "$WS/.scratch" ep 01-first open
mk "$WS/.scratch" ep 02-second done
mk "$WS/Repo-A/.scratch" ep 01-decoy claimed   # ловушка: git top-level/.scratch, прежний корень

# 1. Изнутри репозитория профиля с абсолютным tickets.root — корень в общем каталоге.
got="$(cd "$WS/Repo-A/src" && "$TICKET" root 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "$WS/.scratch" ] && ok "ticket root inside repo -> workspace .scratch" || bad "ticket root: exit $rc, got: $got"
got="$(cd "$WS/Repo-A/src" && "$TICKET" show ep 01 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "01-first.md:3  Status: open" ] && ok "ticket show inside repo reads workspace ticket" || bad "ticket show: exit $rc, got: $got"
got="$(cd "$WS/Repo-B" && "$TICKET" claim ep/01 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && grep -q '^Status: claimed — ' "$WS/.scratch/ep/issues/01-first.md" \
   && grep -q '^Status: claimed$' "$WS/Repo-A/.scratch/ep/issues/01-decoy.md" && [[ "$got" == ".scratch/ep/issues/01-first.md:3"* ]]; then
    ok "ticket claim from second repo writes the workspace file only"
else bad "ticket claim: exit $rc, got: $got"; fi
"$TICKET" open ep 01 --root "$WS/.scratch" >/dev/null 2>&1

# 2. epic-status изнутри репозитория — тот же корень, без ветки репозитория в строке.
got="$(cd "$WS/Repo-A" && "$STATUS" ep 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "/implement · ep 1/2 · тикет 01 — заголовок" ] && ok "epic-status inside repo -> workspace epic, no branch" || bad "epic-status ep: exit $rc, got: $got"
got="$(cd "$WS/Repo-A" && "$STATUS" --json 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s' "$got" | jq -r '[.tickets[].slug]|join(",")')" = "first,second" ] && ok "epic-status --json inside repo -> workspace tickets" || bad "epic-status --json: exit $rc, got: ${got:0:200}"
got="$(cd "$WS" && "$STATUS" ep 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "/implement · ep 1/2 · тикет 01 — заголовок" ] && ok "epic-status from workspace root" || bad "epic-status from ws: exit $rc, got: $got"

# 3. --json --ref при корне вне git: отказ кодом 3 и словами, а не пустой ответ.
out="$(cd "$WS/Repo-A" && "$STATUS" --json --ref main 2>"$T/err")"; rc=$?
[ "$rc" -eq 3 ] && [ -z "$out" ] && grep -q 'не в git-репозитории' "$T/err" && ok "--json --ref with non-git root -> exit 3 + reason" || bad "--ref non-git: exit $rc, out: ${out:0:100}, err: $(head -c 200 "$T/err")"

# 4. --root перекрывает профиль.
got="$(cd "$WS/Repo-A" && "$TICKET" show ep 01 --root .scratch 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "01-decoy.md:3  Status: claimed" ] && ok "ticket --root overrides profile" || bad "ticket --root: exit $rc, got: $got"
got="$(cd "$WS/Repo-A" && "$STATUS" --root "$WS/Repo-A/.scratch" ep 2>&1)"; rc=$?
[[ "$rc" -eq 0 && "$got" == "/implement · ep 0/1 · main · тикет 01"* ]] && ok "epic-status --root overrides profile" || bad "epic-status --root: exit $rc, got: $got"

got="$(cd "$WS/Repo-A" && "$STATUS" ep --root "$WS/Repo-A/.scratch" 2>&1)"; rc=$?
[[ "$rc" -eq 0 && "$got" == "/implement · ep 0/1 · main · тикет 01"* ]] && ok "epic-status <epic> --root (flag after epic)" || bad "epic-status ep --root: exit $rc, got: $got"
ln -s "$WS/Repo-A/src" "$T/link"
a="$(cd "$T/link" && "$TICKET" root --root ../.scratch 2>&1)"; b="$(cd "$T/link" && "$TICKET" show ep 01 --root ../.scratch 2>&1)"
[ "$a" = "$WS/Repo-A/.scratch" ] && [ "$b" = "01-decoy.md:3  Status: claimed" ] && ok "relative --root through a symlink: root and show agree" || bad "symlink --root: root=$a show=$b"

# 5. Относительный tickets.root — от корня текущего дерева; в worktree — свой, и --ref читает ветку.
mk "$T/rel/.scratch" ep 01-main open
git -C "$T/rel" add .scratch && git -C "$T/rel" commit -q -m tickets
git -C "$T/rel" worktree add -q -b feat "$T/rel-wt" 2>/dev/null
mk "$T/rel-wt/.scratch" ep 02-branch open
git -C "$T/rel-wt" add .scratch && git -C "$T/rel-wt" commit -q -m more
got="$(cd "$T/rel-wt" && "$TICKET" root 2>&1)"
[ "$got" = "$T/rel-wt/.scratch" ] && ok "relative root in worktree -> worktree .scratch" || bad "relative root wt: $got"
got="$(cd "$T/rel" && "$STATUS" --json --ref feat 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s' "$got" | jq -r '[.tickets[].slug]|join(",")')" = "main,branch" ] && ok "--json --ref reads branch tickets (git root)" || bad "--ref git: exit $rc, got: ${got:0:200}"
got="$(cd "$T/rel" && "$STATUS" --json --ref no-such 2>&1)"; rc=$?
[ "$rc" -eq 3 ] && ok "--json --ref unknown ref -> exit 3 (unchanged)" || bad "--ref unknown: exit $rc"

# 6. Вне реестра — как раньше: <git top-level>/.scratch, и «вне тикетов» без каталога.
mkdir -p "$T/unreg/sub"
got="$(cd "$T/unreg/sub" && "$TICKET" root 2>&1)"
[ "$got" = "$T/unreg/.scratch" ] && ok "unregistered -> git top-level/.scratch" || bad "unregistered root: $got"
got="$(cd "$T/unreg/sub" && "$STATUS" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "вне тикетов (нет $T/unreg/.scratch)" ] && ok "unregistered epic-status unchanged" || bad "unregistered status: exit $rc, got: $got"

# 7. Сломанный реестр — отказ, а не тихий откат на git top-level.
printf '{broken' >"$CLAUDE_GATE_CONFIG"
got="$(cd "$WS/Repo-A" && "$TICKET" show ep 01 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$got" == *"--root"* ]] && ok "broken registry -> ticket exit 1, names --root" || bad "broken registry: exit $rc, got: $got"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
