# 06 — preflight Harness на Node

Type: task
Status: open
Blocked by: 03
Source: решения владельца 2026-10-07: Q19 (скрипты Harness, которые зовут hooks и worfy, — на Node; bash — только в test-ах), Q24 (Windows 10 21H2+ и 11, x64) ([spec.md](../spec.md)); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node», пункты 1–4; [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

`harness/bin/preflight` — проверка перед Ticket-ом или Wave одной командой. Skills зовут её как
`"${CLAUDE_PLUGIN_ROOT}/bin/preflight" --epic <epic>`: `harness/skills/epic-wave/SKILL.md:67`,
`:411`, `harness/skills/ship-ticket/SKILL.md:87`.

- **Скрипт на bash** (`#!/usr/bin/env bash`, 459 строк). Контракт — шапка `preflight:1-35`:
  - флаги `--epic <epic>`, `--epic=<epic>`, `--no-fetch`, `-h`;
  - не больше 20 строк вывода, предупреждения начинаются с `! `;
  - последняя строка — ровно `GO` или `BLOCKED: <причины через "; ">`;
  - exit 0 — GO, 1 — BLOCKED, 2 — ошибка запуска (не git, Project не зарегистрирован, Profile не
    читается, неизвестный флаг).
- **Десять шагов** (`main`, `:442-457`): Profile (`load_profile`, `:143-177`), дерево, аккаунт `gh`
  (`:193-206`), `git fetch` (`:208-219`), база, главная ветка (`:229-264`), замок worktree
  (`check_lock`, `:266-311`), номера ADR по всем веткам (`:319-354`), миграции (`:356-386`),
  открытые PR (`:388-399`), Epic-и (`:401-435`), вердикт.
- **Тайм-аут на perl.** `with_timeout` (`:70-83`) делает fork, ставит ребёнку свою группу процессов
  (`setpgrp`) и по тайм-ауту шлёт TERM, через 0.5 s — KILL всей группе (`kill -$pid`); код 124.
  Группа нужна потому, что `git fetch` оставляет `git-remote-https`, а `gh` не умирает от SIGALRM
  (`:27-29`). На Windows нет сигналов группе процессов. perl в Git Bash ПК есть (`/usr/bin/perl`,
  evidence Ticket-а 01, раздел 05).
- **Прочие зависимости от shell.** `jq` — в `mig_last` (`:107-114`) и `check_prs` (`:395-397`); без
  `jq` миграции пропускаются с предупреждением (`:358`). В Git Bash ПК `jq` нет (раздел 05): на
  Windows миграции сейчас не проверяются. awk, sort, uniq, paste, sed — в функциях ADR
  (`:85-105`). `realpath`, `mktemp`, `node -e` для чтения JSON Profile-а (`:151-165`). Обрезка темы
  коммита по символам держится на `LC_CTYPE=en_US.UTF-8` (`:39-41`, `cut_chars`, `:62-67`).
- **Соседи зовутся по shebang**: `$PROFILE_BIN` (`:46`, `:145`), `$BIN/worktree-lock` (`:269`),
  `$BIN/epic-status` (`:49`, `:410`, `:417`); `epic-status` проверяется битом исполнения `-x`
  (`:404`). `epic-status` на bash, пока не влит Ticket 05; `worktree-lock` уже на Node.
- **Test-ы.** `harness/bin/tests/preflight.test.sh` запускает `bash "$PF"` (`:40` и далее): 9
  случаев — не зарегистрирован, рабочая папка, не git, GO без нумерации, `--epic`, нет Epic-а,
  устаревший `tickets.epic_status`, база `master` трижды, сломанный Profile.
  `harness/bin/tests/harness-home.test.sh:186` зовёт `bash "$COPY/bin/preflight"`. Не покрыты
  тайм-аут, функции ADR, миграции и разбор вывода `worktree-lock`. Шапка (`:31-34`) описывает
  проверку функций ADR через `source preflight`.
- **На ПК владельца** без Harness и Profile: `bash harness/bin/preflight --help` — EXIT=0;
  `--epic worfy-windows --no-fetch` — EXIT=2, `profile unreadable (profile, exit 1): … gate-resolve.mjs
  failed (exit 4) — project not determined` (evidence Ticket-а 01, раздел 18). git там печатает пути
  `C:/…` (раздел 06).
- PR #150 (E3 Ticket 22) влит как `3837558` и правил `preflight` и `preflight.test.sh` (evidence,
  раздел 18): строки выше — на 4f983ef, перед началом перечитать оба файла.

## Что делаем

1. **`preflight` на Node** (Q19, ADR-0055 пункты 1 и 3). Имя без расширения и строка
   `#!/usr/bin/env node` остаются; модуль CommonJS, как `profile`. Контракт из «Что происходит» —
   прежний: флаги, строки вывода, тексты причин `BLOCKED`, предупреждения, коды выхода. Все десять
   шагов идут до конца и копят причины, как сейчас.
2. **Тайм-аут без perl.** Дочерний процесс запускается асинхронно, с таймером. По тайм-ауту гаснет
   всё дерево процессов, код 124:
   - Mac и Linux: ребёнок в своей группе (`detached: true`), TERM группе (`process.kill(-pid)`),
     через 0.5 s — KILL;
   - Windows: `taskkill /PID <pid> /T /F` — дерево целиком; без нового окна консоли.

   Ctrl+C и TERM самого `preflight` гасят дерево ребёнка и дают exit 130 и 143, как ловушки
   `locate_repo` (`:132-139`). Нет программы (`gh` не установлен) — как ненулевой код: «gh
   unavailable: …».
3. **Без `jq`, awk и временной папки.** JSON (`_journal.json` миграций, ответ `gh pr list`, Profile)
   читает сам скрипт. Строка «jq not found — migrations not checked» уходит. Обрезка темы коммита
   — по символам Unicode, а не по UTF-16 (кириллица и эмодзи не режутся пополам). stderr ребёнка
   хранится в памяти.
4. **Соседи — через `process.execPath`** (ADR-0055 пункт 2): `profile`, `worktree-lock`. `epic-status`
   — по первой строке файла: `#!…node` — через `process.execPath`, иначе через `bash`. Так
   `preflight` работает и до, и после Ticket-а 05. Проверка `-x` (`:404`) становится проверкой, что
   файл есть; текст причины прежний. `PREFLIGHT_PROFILE_BIN` (test-ы) работает как прежде.
5. **Пути.** git на Windows отдаёт `C:/…`. Сравнение рабочего дерева главной ветки с текущим
   (`check_main`, `:231-236`, `:246`) идёт после `path.resolve` с обеих сторон.
6. **Функции для test-ов.** Вместо `source preflight` — `require` того же файла: `preflight`
   экспортирует тайм-аут и чистые функции (`adrScan`, `adrCollisions`, `migLast`, разбор вывода
   `worktree-lock`). `main` идёт только при прямом запуске. Шапка описывает это вместо `source`.

## Готово, когда

- [ ] `head -1 harness/bin/preflight` — `#!/usr/bin/env node`; `grep -nE 'perl|jq ' harness/bin/preflight` — exit 1.
- [ ] `preflight.test.sh` запускает скрипт как `node "$PF"`; прежние 9 случаев не менялись и зелёные.
- [ ] `preflight.test.sh`, новый случай — тайм-аут: fixture на node запускает внука (`setInterval`) и пишет его pid в файл. Тайм-аут 1 s возвращает 124 не позже чем через 3 s, а `process.kill(<pid внука>, 0)` после этого бросает `ESRCH`.
- [ ] `preflight.test.sh`, новые случаи — чистые функции на входах из шапки (`:31-34`): `adrScan` по `0001-a.md 0001-b.md` — `highest 0001 · duplicates 0001`; `adrCollisions` по двум веткам с номером `0098` — `0098: origin/a, origin/b`; `migLast` по `{"entries":[{"idx":"0077"}]}` — `77`; вывод `worktree-lock status` с `holds … ← this` и чужим `also …` — разобран, как в `check_lock`.
- [ ] Сверка на Mac, worktree worfy: `git worktree add --detach "$T/old" origin/main`, затем из worktree worfy `bash "$T/old/harness/bin/preflight" --no-fetch --epic worfy-windows` и `node harness/bin/preflight --no-fetch --epic worfy-windows` — вывод совпадает построчно, коды выхода равны (через раздел Mac checks PR, Q33).
- [ ] `bash harness/bin/tests/preflight.test.sh` и `bash harness/bin/tests/harness-home.test.sh` — exit 0 на Mac и в `pnpm test`.
- [ ] Те же два test-а — exit 0 в Git Bash на Windows-ПК; случай тайм-аута проходит и там (внук погашен через `taskkill /T`).
- [ ] Windows-ПК, worktree worfy, Git Bash: `node harness/bin/preflight --epic worfy-windows; echo EXIT=$?` — с настоящим `git fetch`; последняя строка `GO` или `BLOCKED: …` с настоящими причинами, exit 0 или 1, не больше 20 строк. Вывод — в Итог.
- [ ] Mac: gate full зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).

## Тесты

Сначала — случай тайм-аута в `preflight.test.sh`. На нынешнем main его нечем вызвать: `require`
bash-файла падает. После переписывания он зелёный и на Mac, и на Windows. В Итог — как он падал.

Случаи сверки старой и новой версии: прежние 9 случаев `preflight.test.sh` дают тот же вывод.
Других test-ов вывода нет, поэтому сверка в worktree worfy (пункт «Готово, когда») обязательна.

Ожидаемая трудность в Git Bash. Git Bash переводит пути `/tmp/…` в аргументах native-программ в
`C:\…`, а в содержимое JSON реестра и Profile-ов fixture-а — нет. Если `match` не совпадёт с путём,
который видит node, fixture пишет пути через `cygpath -m`: в Git Bash ПК он есть (evidence Ticket-а
01, раздел 05).

## Где в коде

- `harness/bin/preflight`
- `harness/bin/tests/preflight.test.sh`
- `harness/bin/tests/harness-home.test.sh`

Не входит: остальные скрипты `bin` (Ticket 05), тексты skills — вызов `preflight` в них не
меняется (Ticket 07). `harness-home.test.sh` правит и Ticket 05, поэтому 05 и 06 не идут в одной
Wave.

## Итог

Заполняется при закрытии.
