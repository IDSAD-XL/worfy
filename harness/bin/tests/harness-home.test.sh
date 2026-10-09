#!/usr/bin/env bash
# Where the Harness keeps its machine state and how its scripts find each other
# (ticket worfy-harness/08, ADR-0040 item 5):
#   1. With HARNESS_HOME unset, the state lives in $HOME/.claude/worfy-harness: the gate's
#      cache/, stop-blocks/ and red-*/unverified-* markers, worktree locks, the epic-board
#      snapshot. $HOME/.claude/gate, worktree-sessions and state never appear.
#   2. HARNESS_HOME=<dir> moves all of it to <dir>; CLAUDE_GATE_CONFIG and CLAUDE_GATE_STATE
#      still win.
#   3. Transition: no $HARNESS_HOME/gate/config.json but a legacy $HOME/.claude/gate/config.json:
#      the scripts read the legacy registry and write nothing outside $HARNESS_HOME.
#   4. A copy of harness/ in another folder calls its own neighbours, never $HOME/.claude/bin
#      or $HOME/.claude/hooks, also when a script is started through a symlink.
#   5. Machine output is unchanged: epic-status --json, the ticket Status line, the last line
#      of preflight, profile exit codes.
#   6. The files of the ticket hold no ~/.claude/bin, ~/.claude/hooks or КОД=, and Cyrillic
#      only in the allowed substrings below.
# Run: bash harness/bin/tests/harness-home.test.sh; exit code 0 means everything passed.
# Every HOME here is a temporary folder: the real ~/.claude is neither read nor written.
set -u
HARNESS="${HARNESS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"   # HARNESS_DIR — run against another copy
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
check() { # $1 = description, the rest = condition
    local d="$1"; shift
    if "$@"; then ok "$d"; else bad "$d"; fi
}
rc_out() { [ "$rc" -eq "$1" ] && [ "$out" = "$2" ]; }   # last exit code and output
absent() { local p; for p in "$@"; do [ ! -e "$p" ] || return 1; done; }
go_or_blocked() { [ "$1" = GO ] || [ "${1#BLOCKED: }" != "$1" ]; }
tag() { printf '%s' "$1" | shasum | awk '{print $1}' | cut -c1-8; }

# Runs a command with HOME=$1 and none of the overrides the calling session may have set.
clean() {
    local home="$1"; shift
    env -u HARNESS_HOME -u CLAUDE_GATE_CONFIG -u CLAUDE_GATE_STATE -u CLAUDE_GATE_RESOLVE \
        -u CLAUDE_PROFILE_BIN -u CLAUDE_TICKET_BIN -u CLAUDE_PROFILES_DIR -u CLAUDE_PLUGIN_ROOT \
        -u QMD_SYNC_PROFILE_BIN -u QMD_REFRESH_SYNC -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID \
        -u GATE_SCOPE HOME="$home" "$@"
}

# --- fixtures: a registered repository with an epic and a fake package manager ----------
R="$T/repo"
mkdir -p "$R/.scratch/e1/issues"
git -C "$R" init -q -b main
cat >"$R/package.json" <<'EOF'
{ "name": "fixture", "scripts": { "ok": "true", "bad": "false", "envbad": "false" } }
EOF
printf '# 01 — First\n\nStatus: done\n' >"$R/.scratch/e1/issues/01-first.md"
printf '# 02 — Second\n\nBlocked by: 01\nStatus: open\n' >"$R/.scratch/e1/issues/02-second.md"
# An old Russian Status value: epic-status still folds it into "done".
printf '# 03 — Third\n\n**Status:** Выкачено 2026-08-23, PR #27\n' >"$R/.scratch/e1/issues/03-third.md"
git -C "$R" add -A && git -C "$R" -c user.email=t@t -c user.name=t commit -q -m init
# The gate runs "$PM run <script>"; pm is this file, so the test needs no npm.
PM="$T/fakepm"
cat >"$PM" <<'EOF'
#!/bin/sh
case "$2" in
    ok) exit 0 ;;
    bad) echo "Tests 1 failed"; exit 1 ;;
    envbad) echo "sh: tool: command not found"; exit 127 ;;
esac
exit 1
EOF
chmod +x "$PM"
registry() { # $1 = file; registers $R with profile "tp"
    mkdir -p "$(dirname "$1")"
    printf '{"repos":[{"key":"t","match":"%s","pm":"%s","profile":"tp","root":{"p_ok":["ok"],"p_red":["bad"],"p_env":["envbad"]},"workspace":{}}]}\n' "$R" "$PM" >"$1"
}
profile_dir() { # $1 = home
    mkdir -p "$1/.claude/profiles/tp"
    # tickets.epic_status as a schema 1 profile writes it: preflight reads it as its neighbour.
    echo '{"schema":1,"name":"tp","worktree":{"base":"origin/main"},"tickets":{"epic_status":"~/.claude/bin/epic-status"}}' >"$1/.claude/profiles/tp/profile.json"
}
gate_runs() { # $1 = home, rest = extra env; runs the gate in three profiles and stop.sh once
    local home="$1"; shift
    for p in p_ok p_red p_env; do
        (cd "$R" && printf '{"session_id":"s1"}' | clean "$home" env "$@" GATE_SCOPE=all bash "$HARNESS/hooks/gate.sh" "$p" >/dev/null 2>&1)
    done
}
TAG="$(tag "$R")"
state_ok() { # $1 = state dir: green cache, stop-blocks, red and unverified markers
    [ -d "$1/cache" ] && [ -n "$(ls -A "$1/cache")" ] && [ -d "$1/stop-blocks" ] \
        && [ -f "$1/red-t-$TAG" ] && [ -f "$1/unverified-t-$TAG" ]
}
no_legacy() { # $1 = home: none of the old state folders exists
    [ ! -e "$1/.claude/gate" ] && [ ! -e "$1/.claude/worktree-sessions" ] && [ ! -e "$1/.claude/state" ]
}
lock_files() { find "$1" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }

# --- 1. HARNESS_HOME unset: everything under $HOME/.claude/worfy-harness ---------------
H1="$T/h1"; HH1="$H1/.claude/worfy-harness"
registry "$HH1/gate/config.json"; profile_dir "$H1"
gate_runs "$H1"
check "default: gate state (cache, stop-blocks, red, unverified) in \$HOME/.claude/worfy-harness/gate/state" state_ok "$HH1/gate/state"
out="$(cd "$R" && printf '{"session_id":"s1"}' | clean "$H1" bash "$HARNESS/hooks/stop.sh" 2>&1)"; rc=$?
check "default: stop.sh reads the red marker from the new place (exit 2)" [ "$rc" -eq 2 ]
(cd "$R" && printf '{"session_id":"s1","cwd":"%s"}' "$R" | clean "$H1" node "$HARNESS/bin/worktree-lock" claim >/dev/null 2>&1)
check "default: worktree-lock claim -> lock in \$HOME/.claude/worfy-harness/worktree-sessions" [ "$(lock_files "$HH1/worktree-sessions")" = 1 ]
(cd "$R" && clean "$H1" node "$HARNESS/bin/epic-board" --no-open >/dev/null 2>&1)
check "default: epic-board snapshot in \$HOME/.claude/worfy-harness/state/epic-board.html" [ -s "$HH1/state/epic-board.html" ]
U="$T/unreg"; mkdir -p "$U" && git -C "$U" init -q && git -C "$U" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
out="$(cd "$U" && clean "$H1" bash "$HARNESS/hooks/gate.sh" fast </dev/null 2>&1)"; rc=$?
out="$(printf '%s\n' "$out" | head -n 1)"
check "default: an unregistered repository names the registry under ~/.claude/worfy-harness (exit 3)" \
    rc_out 3 "[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: проект не зарегистрирован в ~/.claude/worfy-harness/gate/config.json"
check "default: no \$HOME/.claude/gate, worktree-sessions or state" no_legacy "$H1"

# --- 2. HARNESS_HOME=<dir>; CLAUDE_GATE_CONFIG and CLAUDE_GATE_STATE win ----------------
H2="$T/h2"; HH2="$T/hh2"
mkdir -p "$H2"; registry "$HH2/gate/config.json"; profile_dir "$H2"
gate_runs "$H2" HARNESS_HOME="$HH2"
check "HARNESS_HOME: gate state in <dir>/gate/state" state_ok "$HH2/gate/state"
(cd "$R" && printf '{"session_id":"s2","cwd":"%s"}' "$R" | clean "$H2" env HARNESS_HOME="$HH2" node "$HARNESS/bin/worktree-lock" claim >/dev/null 2>&1)
check "HARNESS_HOME: lock in <dir>/worktree-sessions" [ "$(lock_files "$HH2/worktree-sessions")" = 1 ]
(cd "$R" && clean "$H2" env HARNESS_HOME="$HH2" node "$HARNESS/bin/epic-board" --no-open >/dev/null 2>&1)
check "HARNESS_HOME: epic-board snapshot in <dir>/state" [ -s "$HH2/state/epic-board.html" ]
check "HARNESS_HOME: nothing under \$HOME/.claude/worfy-harness" [ ! -e "$H2/.claude/worfy-harness" ]
check "HARNESS_HOME: no \$HOME/.claude/gate, worktree-sessions or state" no_legacy "$H2"
CFG3="$T/explicit/config.json"; registry "$CFG3"
echo '{"repos": [ broken' >"$HH2/gate/config.json"
gate_runs "$H2" HARNESS_HOME="$HH2" CLAUDE_GATE_CONFIG="$CFG3" CLAUDE_GATE_STATE="$T/explicit/state"
check "CLAUDE_GATE_CONFIG and CLAUDE_GATE_STATE win over HARNESS_HOME" state_ok "$T/explicit/state"
out="$(clean "$H2" env HARNESS_HOME="$HH2" CLAUDE_GATE_CONFIG="$CFG3" node "$HARNESS/bin/profile" -C "$R" --name 2>&1)"; rc=$?
check "profile: CLAUDE_GATE_CONFIG wins over a broken \$HARNESS_HOME registry" rc_out 0 tp

# --- 3. Transition: only the legacy registry exists -------------------------------------
H3="$T/h3"; HH3="$T/hh3"
registry "$H3/.claude/gate/config.json"; profile_dir "$H3"
mkdir -p "$H3/.claude/gate/state" && echo old >"$H3/.claude/gate/state/red-t-$TAG"
snapshot() { # files under $1/.claude outside worfy-harness, with size and high-resolution mtime
    perl -MFile::Find -MTime::HiRes=lstat -e '
        my $top = shift;
        find({ no_chdir => 1, wanted => sub {
            if ($File::Find::name eq "$top/worfy-harness") { $File::Find::prune = 1; return }
            my @s = lstat($File::Find::name); print "$File::Find::name $s[7] $s[9]\n" } }, $top)' "$1/.claude" | sort
}
before="$(snapshot "$H3")"
out="$(clean "$H3" env HARNESS_HOME="$HH3" node "$HARNESS/bin/profile" -C "$R" --name 2>&1)"; rc=$?
check "legacy registry: profile -C <repo> --name finds the project (exit 0)" rc_out 0 tp
out="$(clean "$H3" node "$HARNESS/bin/profile" -C "$R" --name 2>&1)"; rc=$?
check "legacy registry, HARNESS_HOME unset: profile finds the project (exit 0)" rc_out 0 tp
gate_runs "$H3" HARNESS_HOME="$HH3"
check "legacy registry: gate state goes to \$HARNESS_HOME/gate/state" state_ok "$HH3/gate/state"
out="$(cd "$R" && printf '{"session_id":"s3"}' | clean "$H3" env HARNESS_HOME="$HH3" bash "$HARNESS/hooks/stop.sh" 2>&1)"; rc=$?
check "legacy registry: stop.sh resolves the project through the legacy registry (exit 2)" [ "$rc" -eq 2 ]
(cd "$R" && printf '{"session_id":"s3","cwd":"%s"}' "$R" | clean "$H3" env HARNESS_HOME="$HH3" node "$HARNESS/bin/worktree-lock" claim >/dev/null 2>&1)
(cd "$R" && clean "$H3" env HARNESS_HOME="$HH3" node "$HARNESS/bin/epic-board" --no-open >/dev/null 2>&1)
out="$(clean "$H3" env HARNESS_HOME="$HH3" zsh "$HARNESS/bin/qmd-sync-main" --describe tp 2>&1)"; rc=$?
check "legacy registry: qmd-sync-main --describe finds the profile (exit 0)" [ "$rc" -eq 0 ]
after="$(snapshot "$H3")"
check "legacy registry: nothing under \$HOME/.claude outside worfy-harness changed" [ "$before" = "$after" ]
check "legacy registry: no \$HOME/.claude/worktree-sessions or state" absent "$H3/.claude/worktree-sessions" "$H3/.claude/state"
out="$(clean "$H3" env HARNESS_HOME="$HH3" node "$HARNESS/hooks/gate-resolve.mjs" --which "$R" 2>&1)"; rc=$?
check "legacy registry: gate-resolve.mjs --which finds the project" [ "$rc" -eq 0 -a "${out%%	*}" = t ]
# The new registry wins as soon as it exists.
echo '{"repos":[]}' >"$T/empty.json"; mkdir -p "$HH3/gate" && cp "$T/empty.json" "$HH3/gate/config.json"
out="$(clean "$H3" env HARNESS_HOME="$HH3" node "$HARNESS/bin/profile" -C "$R" --name 2>&1)"; rc=$?
check "both registries: \$HARNESS_HOME/gate/config.json wins (exit 3)" [ "$rc" -eq 3 ]
out="$(clean "$H3" env HARNESS_HOME="$HH3" node "$HARNESS/hooks/gate-resolve.mjs" --which "$R" 2>&1)"; rc=$?
check "both registries: gate-resolve.mjs reads \$HARNESS_HOME/gate/config.json" [ "$rc" -eq 0 -a -z "$out" ]

# --- 4. A copy of harness/ calls its own neighbours -------------------------------------
H4="$T/h4"; TRAP="$T/trap.log"
registry "$H4/.claude/worfy-harness/gate/config.json"; profile_dir "$H4"
mkdir -p "$H4/.claude/bin" "$H4/.claude/hooks"
for f in bin/profile bin/ticket bin/epic-status bin/epic-board bin/preflight bin/worktree-lock bin/qmd-sync-main \
         hooks/gate.sh hooks/gate-resolve.mjs hooks/stop.sh; do
    printf '#!/bin/sh\necho "%s $*" >>"%s"\nexit 1\n' "$f" "$TRAP" >"$H4/.claude/$f"
    chmod +x "$H4/.claude/$f"
done
# gate-resolve.mjs is run as `node <file>`: its trap is JavaScript.
printf 'import fs from "node:fs"\nfs.appendFileSync(%s, "hooks/gate-resolve.mjs " + process.argv.slice(2).join(" ") + "\\n")\nprocess.exit(1)\n' \
    "\"$TRAP\"" >"$H4/.claude/hooks/gate-resolve.mjs"
COPY="$T/copy/harness"; mkdir -p "$T/copy" && cp -R "$HARNESS" "$COPY"
c() { clean "$H4" "$@"; }
(cd "$R" && c node "$COPY/bin/ticket" root >/dev/null 2>&1)
(cd "$R" && c bash "$COPY/bin/epic-status" >/dev/null 2>&1)
(cd "$R" && c bash "$COPY/bin/epic-status" --json >/dev/null 2>&1)
(cd "$R" && c node "$COPY/bin/epic-board" --no-open --out "$T/eb.html" >/dev/null 2>&1)
(cd "$R" && printf '{"cwd":"%s"}' "$R" | c bash "$COPY/hooks/session-start.sh" >/dev/null 2>&1)
(cd "$R" && printf '{"cwd":"%s"}' "$R" | c bash "$COPY/hooks/session-end.sh" >/dev/null 2>&1)
(c zsh "$COPY/bin/qmd-sync-main" --describe tp >/dev/null 2>&1)
(cd "$R" && c bash "$COPY/bin/preflight" --epic e1 </dev/null >/dev/null 2>&1)
# qmd-refresh asks qmd-sync-main --describe for each collection with an `update:` line; qmd is a stub.
mkdir -p "$T/fakebin" && printf '#!/bin/sh\nexit 0\n' >"$T/fakebin/qmd" && chmod +x "$T/fakebin/qmd"
printf 'collections:\n  tp-main:\n    path: %s\n    update: /nowhere/qmd-sync-main tp\n' "$T/mirror" >"$T/index.yml"
(c env PATH="$T/fakebin:$PATH" QMD_INDEX_YML="$T/index.yml" zsh "$COPY/bin/qmd-refresh" --wait --force >/dev/null 2>&1)
(cd "$R" && c node "$COPY/bin/profile" --name >/dev/null 2>&1)
(cd "$R" && printf '{"session_id":"s4"}' | c bash "$COPY/hooks/gate.sh" p_red >/dev/null 2>&1)
(cd "$R" && printf '{"session_id":"s4"}' | c bash "$COPY/hooks/stop.sh" >/dev/null 2>&1)
check "copy: no script called \$HOME/.claude/bin or \$HOME/.claude/hooks" [ ! -e "$TRAP" ]
[ -e "$TRAP" ] && sed 's/^/     /' "$TRAP"
mkdir -p "$T/links"; ln -s "$COPY/bin/profile" "$T/links/profile"; ln -s "$COPY/bin/epic-status" "$T/links/epic-status"
out="$(cd "$R" && c "$T/links/profile" --name 2>&1)"; rc=$?
check "copy through a symlink: profile finds gate-resolve.mjs next to its real file" rc_out 0 tp
ln -s "$COPY/hooks/gate.sh" "$T/links/gate.sh"
out="$(cd "$R" && c env GATE_SCOPE=all bash "$T/links/gate.sh" p_ok </dev/null 2>&1)"; rc=$?
check "copy through a symlink: gate.sh finds gate-resolve.mjs next to its real file" [ "$rc" -eq 0 -a "${out#*\[gate\] зелено}" != "$out" ]
out="$(cd "$R" && c "$T/links/epic-status" --json 2>&1)"; rc=$?
check "copy through a symlink: epic-status finds ticket next to its real file" [ "$rc" -eq 0 ]
check "copy through a symlink: nothing called the trap" [ ! -e "$TRAP" ]

# --- 5. Machine output is unchanged ------------------------------------------------------
# The expected JSON was printed by epic-status at the branch base (origin/main 31bc642) on this fixture;
# worfy-harness ticket 22 added the branch and repo of every ticket (null: no Branch:/Repo: line).
want='{"ref":"main","epics":[{"epic":"e1","hasSpec":false,"hasMap":false}],"tickets":[{"epic":"e1","num":1,"slug":"first","title":"01 — First","statusRaw":"done","state":"done","blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"e1","num":2,"slug":"second","title":"02 — Second","statusRaw":"open","state":"open","blockedRaw":"01","blockedNums":[1],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"e1","num":3,"slug":"third","title":"03 — Third","statusRaw":"Выкачено 2026-08-23, PR #27","state":"done","blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"}]}'
got="$(cd "$R" && clean "$H1" bash "$HARNESS/bin/epic-status" --json 2>&1)"
check "epic-status --json: same JSON as at the branch base" [ "$got" = "$want" ]
[ "$got" = "$want" ] || echo "     got: $got"
for sub in "claim:Status: claimed — " "block:Status: blocked — waits" "done:Status: done — "; do
    verb="${sub%%:*}" line="${sub#*:}"
    extra=(); [ "$verb" = block ] && extra=(waits)
    (cd "$R" && clean "$H1" node "$HARNESS/bin/ticket" "$verb" e1 02 ${extra[@]+"${extra[@]}"} >/dev/null 2>&1)
    last="$(grep '^Status:' "$R/.scratch/e1/issues/02-second.md" | tail -n 1)"
    check "ticket $verb writes '${line}…'" [ "${last#"$line"}" != "$last" ]
done
git -C "$R" checkout -q -- .scratch
out="$(cd "$R" && clean "$H1" bash "$HARNESS/bin/preflight" --epic e1 </dev/null 2>&1)"
lastline="$(printf '%s\n' "$out" | tail -n 1)"
check "preflight ends with GO or BLOCKED: …" go_or_blocked "$lastline"
# preflight reads the lines of `worktree-lock status` (section 1 left a lock of session s1 in H1).
out="$(cd "$R" && clean "$H1" env CLAUDE_SESSION_ID=s9 bash "$HARNESS/bin/preflight" --no-fetch </dev/null 2>&1)"
check "preflight sees another live session through worktree-lock status" [ "${out#*lock: another live session s1}" != "$out" ]
out="$(cd "$R" && clean "$H1" env CLAUDE_SESSION_ID=s1 bash "$HARNESS/bin/preflight" --no-fetch </dev/null 2>&1)"
check "preflight sees its own session holding the lock" [ "${out#*lock: held by this session}" != "$out" ]
for want_rc in "0:-C $R --name" "2:--bogus" "3:-C $T --name" "4:-C $R --field no.such.field"; do
    (cd "$T" && clean "$H1" node "$HARNESS/bin/profile" ${want_rc#*:} >/dev/null 2>&1); rc=$?
    check "profile ${want_rc#*:} -> exit ${want_rc%%:*}" [ "$rc" -eq "${want_rc%%:*}" ]
done
echo '{"repos": [ broken' >"$T/broken.json"
(cd "$T" && clean "$H1" env CLAUDE_GATE_CONFIG="$T/broken.json" node "$HARNESS/bin/profile" -C "$R" --name >/dev/null 2>&1); rc=$?
check "profile with a broken registry -> exit 1" [ "$rc" -eq 1 ]

# --- 6. Text of the ticket's files -------------------------------------------------------
FILES=(
    skills/retro/SKILL.md skills/qmd/SKILL.md skills/overnight-fix-loop/SKILL.md
    skills/continuous-audit/SKILL.md skills/tickets-to-tasks/SKILL.md
    bin/profile bin/ticket bin/epic-status bin/preflight bin/worktree-lock bin/epic-board
    bin/qmd-mcp bin/qmd-refresh bin/qmd-sync-main bin/TICKETS.md
    hooks/gate.sh hooks/gate-resolve.mjs hooks/guard.mjs hooks/stop.sh hooks/session-start.sh hooks/session-end.sh
    bin/tests/preflight.test.sh bin/tests/profile.test.sh bin/tests/qmd.test.sh bin/tests/skill-blocks.test.sh
    bin/tests/tickets-root.test.sh
    hooks/tests/gate-notverified.test.sh hooks/tests/gate-unregistered.test.sh hooks/tests/session-hooks.test.sh
)
# A profile of schema 1 may still name ~/.claude/bin/<script>; the line that maps it onto the
# plugin says "schema 1", and only such a line may name the old place. This file is left out:
# it spells the banned strings to look for them.
banned="$(cd "$HARNESS" && grep -nE '~/\.claude/(bin|hooks)|\$HOME/\.claude/(bin|hooks)|КОД=' "${FILES[@]}" | grep -v 'schema 1')"
check "no ~/.claude/bin, ~/.claude/hooks or КОД= in the ticket's files" [ -z "$banned" ]
[ -z "$banned" ] || printf '%s\n' "$banned" | sed -n '1,20p' | sed 's/^/     /'
# Allowed Cyrillic, cut out before the search: the gate verdict lines (machine strings, read by
# worfy and the skills; ticket 09 replaces them), the old Russian Status values that epic-status
# and ticket still read, profile placeholders, and quoted Russian examples.
ALLOWED="$T/allowed.txt"
cat >"$ALLOWED" <<'EOF'
резолвер плана gate-resolve.mjs завершился с кодом $rc — ничего не проверено, это не «зелено».
резолвер gate-resolve.mjs завершился с кодом $rc
нет изменений относительно merge-base ${mb:0:8} с $base_ref. Это не «зелено».
изменения не затрагивают проверяемые пакеты. Это не «зелено».
у выбранных пакетов нет скриптов профиля. Это не «зелено».
проект не зарегистрирован в
ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно
ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение
ПРОВЕРИТЬ НЕ УДАЛОСЬ
ПРОВЕРИТЬ НЕ
УДАЛОСЬ
окружение недоступно
окружение
недоступно
ничего не прогналось
не зарегистрирован
резолвер … завершился
резолвер
node не найден
зелено
красно
(кэш)
(кэш:
(прошло:
выкачено|Выкачено|выкачена|Выкачена|выкачен|Выкачен
заблокирован|Заблокирован
нет|Нет|нету|Нету|ничего|Ничего|нечего|Нечего
[ \t]+и[ \t]+
«и»
Выкачено
выкачено 2026-08-23
Blocked by: 01 и 02
08 — все перекладки
Пакет юристу
01 — Каркас
Ты подвис?
<эпик>
<имя>
<каталог пакета>
<каталог модуля>
<пакет>
<файл>
<<данные>>
Этап
Сейчас
Дальше
Жду
Где в коде
Что делаем
Готово, когда
Тесты
Решение владельца
Источники
Обязательное чтение исполнителя
Ночной прогон и аудит
только после тикета 01
почему отказались от websocket и живого обновления страницы
сторож выкат документн
От WebSocket отказались,
потому что у api нет домена; если понадобится живость — SSE со страницы лота
смоук / дымовые проверки
почему сторож выката ждёт бесконечно после документного мержа
Сторож выката ждёт по коммиту, а не по последнему прогону: документный мерж сдвигает последний прогон, и ожидание не завершается
прошлые аудиты кода и ложные
находки
аудит находк ложн
ретро
запиши урок
залей тикеты в таски
аудит
просканируй кодовую базу
заведи тикеты по находкам
до 06:30
EOF
cyr="$(cd "$HARNESS" && perl -CSD -Mutf8 -e '
    open my $list, "<:encoding(UTF-8)", shift or die;
    my @allow = sort { length($b) <=> length($a) } grep { length } map { chomp; $_ } <$list>;
    for my $f (@ARGV) {
        open my $h, "<:encoding(UTF-8)", $f or die "$f: $!";
        while (my $l = <$h>) {
            for my $s (@allow) { $l =~ s/\Q$s\E//g }
            print "$f:$.: $l" if $l =~ /\p{Cyrillic}/;
        }
    }' "$ALLOWED" "${FILES[@]}")"
check "Cyrillic only in the allowed substrings" [ -z "$cyr" ]
[ -z "$cyr" ] || printf '%s\n' "$cyr" | sed -n '1,400p' | sed 's/^/     /'

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
