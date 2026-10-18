# 06 — preflight Harness на Node

Type: task
Status: claimed 2026-10-17T22:30Z
Branch: worfy-windows/06
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

- [x] `head -1 harness/bin/preflight` — `#!/usr/bin/env node`; `grep -nE 'perl|jq ' harness/bin/preflight` — exit 1.
- [x] `preflight.test.sh` запускает скрипт как `node "$PF"`; прежние 9 случаев не менялись и зелёные.
- [x] `preflight.test.sh`, новый случай — тайм-аут: fixture на node запускает внука (`setInterval`) и пишет его pid в файл. Тайм-аут 1 s возвращает 124 не позже чем через 3 s, а `process.kill(<pid внука>, 0)` после этого бросает `ESRCH`.
- [x] `preflight.test.sh`, новые случаи — чистые функции на входах из шапки (`:31-34`): `adrScan` по `0001-a.md 0001-b.md` — `highest 0001 · duplicates 0001`; `adrCollisions` по двум веткам с номером `0098` — `0098: origin/a, origin/b`; `migLast` по `{"entries":[{"idx":"0077"}]}` — `77`; вывод `worktree-lock status` с `holds … ← this` и чужим `also …` — разобран, как в `check_lock`.
- [x] Сверка на Mac, worktree worfy: `git worktree add --detach "$T/old" origin/main`, затем из worktree worfy `bash "$T/old/harness/bin/preflight" --no-fetch --epic worfy-windows` и `node harness/bin/preflight --no-fetch --epic worfy-windows` — вывод совпадает построчно, коды выхода равны (через раздел Mac checks PR, Q33).
- [x] `bash harness/bin/tests/preflight.test.sh` и `bash harness/bin/tests/harness-home.test.sh` — exit 0 на Mac и в `pnpm test`.
- [x] Те же два test-а — exit 0 в Git Bash на Windows-ПК; случай тайм-аута проходит и там (внук погашен через `taskkill /T`).
- [ ] Windows-ПК, worktree worfy, Git Bash: `node harness/bin/preflight --epic worfy-windows; echo EXIT=$?` — с настоящим `git fetch`; последняя строка `GO` или `BLOCKED: …` с настоящими причинами, exit 0 или 1, не больше 20 строк. Вывод — в Итог.
- [x] Mac: gate full зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).

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

Session на Mac (implementer), 2026-10-18. macOS 25.6, bash 3.2.57, Node 24.19.0. Ветка `worfy-windows/06` от main
`7f8f46eb`. На Windows ничего не запускалось: пункты Windows-ПК и gate full на Mac открыты.

- **`harness/bin/preflight` на Node**: CommonJS, имя без расширения, `#!/usr/bin/env node`;
  `grep -nE 'perl|jq ' harness/bin/preflight` — exit 1. Флаги, строки, тексты причин `BLOCKED`, предупреждения и
  коды выхода прежние. `withTimeout` запускает ребёнка асинхронно в своей группе процессов (`detached`), по
  тайм-ауту — TERM группе, через 0.5 s KILL; на Windows — `taskkill /PID <pid> /T /F` с `windowsHide`. Нет
  программы — код 127 без вывода, как у perl; строка PR тогда — `gh unavailable: gh not found` (круг ревью 1).
  Ctrl+C, TERM и
  HUP самого `preflight` гасят дерево ребёнка и дают 130, 143, 129. JSON (журнал миграций, ответ `gh pr list`,
  Profile) читает сам скрипт; строки «jq not found — migrations not checked» нет. Вывод детей — байты: не-UTF-8
  проходит без изменений, тема коммита режется по code point. Соседи — через `process.execPath`; файл, чей `#!`
  называет другой интерпретатор, — по `#!` (на Windows через `bash`). `epic-status` проверяется на существование
  вместо `-x`, текст причины прежний. `PREFLIGHT_GH` — gh test-а (stand-in), по тому же правилу. `check_main`
  сравнивает пути после `path.resolve`. Экспорт для `require`: `withTimeout`, `adrScan`, `adrCollisions`,
  `migLast`, `lockReport`, `cutChars`, `decode`, `encode`; `main` — только при прямом запуске.
- **Как падал новый test на main:** `require` bash-файла — `SyntaxError: Invalid or unexpected token` на строке
  `# preflight — …`; `preflight.test.sh` на bash-версии — exit 1, passed 1, failed 25.
- **Test-ы:** `preflight.test.sh` — `node "$PF"`, прежние 13 проверок без изменений и зелёные; новые: тайм-аут
  (внук на `setInterval`, 124 за ≤3 s, затем `ESRCH`; отсутствие внука ждётся до 1 s — время на reaping), нет
  программы (127), TERM и INT во время `epic-status` (143 и 130, внук погашен, вердикта нет; на Windows — `skip`),
  `adrScan`, `adrCollisions`, `migLast`, `lockReport` (три случая), `cutChars`, байты не-UTF-8. На Windows gh
  test-а — node stand-in через `PREFLIGHT_GH`, под `gh_guard`; то же в `harness-home.test.sh`.
- **Mutation testing:** `process.kill(child.pid)` вместо группы — случай тайм-аута красный (`124 in time alive`);
  выход по сигналу без гашения детей — оба случая сигнала красные (внук жив).

| Test, Mac | main `90c5e724` | ветка |
|---|---|---|
| `bash harness/bin/tests/preflight.test.sh` | exit 0, passed 15 | exit 0, passed 29 |
| `bash harness/bin/tests/harness-home.test.sh` | exit 0, passed 46 | exit 0, passed 46 |
| `pnpm lint && pnpm typecheck && pnpm test` | — | exit 0; 280 файлов, 5898 passed, 70 skipped |
| `gate.mjs fast` | — | exit 0, `[gate] зелено (fast)` |

- **Сверка старой и новой версии на Mac (байт в байт stdout, stderr и код выхода):** в worktree worfy
  `bash <копия origin/main>/harness/bin/preflight --no-fetch --epic worfy-windows` и
  `node harness/bin/preflight --no-fetch --epic worfy-windows` — exit 0 и 0, 15 строк, `IDENTICAL` (gh — stub с
  постоянным списком PR). На fixture-ах `preflight.test.sh` — 13 запусков из 13 одинаковы. Отдельный набор из 68
  сценариев (ADR в ветках и коллизии, миграции, ответы gh — ошибка, мусор, пусто, объект, странные элементы,
  нет gh; аккаунт gh; fetch и его сбой; отстающий, опережающий и разошедшийся main; detached HEAD; замок —
  чужой, свой, без id, нечитаемый реестр, сбой, неразобранный вывод; `epic-status` — нет файла, сбой, пусто,
  много Epic-ов, зависание 20 s; Silent mode; тема с кириллицей и эмодзи и тема не в UTF-8; флаги) — 68 из 68
  одинаковы.
- **Настоящий gh — 0 вызовов:** оба test-а с логирующим `gh` первым в PATH до stub-а — лог пуст.
- **Отличия от bash-версии:** `profile --json`, который вернул exit 0 и не JSON, — причина теперь сообщение
  `JSON.parse` без префикса `SyntaxError:` (bash печатал первую строку stack trace node, `<anonymous_script>:1`).
  gh, которого нет, — `gh unavailable: gh not found` (на Mac bash печатал пустую причину). stdin детей — пустой (bash
  отдавал свой); ребёнок — в новой session (`setsid`, так делает `detached` в Node), а не только в своей группе: у него нет
  управляющего терминала, и `ssh` в `git fetch` не спросит пароль с терминала (при perl фоновая группа ждала бы
  до тайм-аута 60 s). Это следствие из устройства, не проверялось.

### Круг ревью 1

- Слит main `b07527f3` (hooks на Node, #453; #455): `harness-home.test.sh` больше не зовёт `bash stop.sh`.
- gh, которого нет: причина — ошибка запуска (`ENOENT` → `gh not found`). Test-ы 4g: `PREFLIGHT_GH` на
  несуществующий файл и PATH без gh (второй — только macOS и Linux).
- Ctrl+C группе процессов во время синхронного `git`: git умер от SIGINT, TERM или HUP — `preflight` сразу выходит
  с 128 + номер сигнала, без строк из пустого ответа («branch detached ?»). Test 4f: обёртка `git` первой в PATH
  убивает себя SIGINT на `symbolic-ref` шага tree; exit 130, строк шага нет. На Windows — `skip`.
- Test-ы через `main` (4h), Full mode: коллизия ADR `0098` в двух ветках; номер миграции, занятый на
  origin/main; 7 PR → 4 строки и `… and 3 more`, всего не больше 20 строк; тема базы с байтом 0xFF — байт в байт
  (объект commit пишется вручную: `git commit` переводит не-UTF-8 в UTF-8); живая чужая session — последняя
  строка `BLOCKED: another live session in the tree: s1-aaaaa (heartbeat just now)`, exit 1. Test 6b: внук вне
  группы (`detached`) держит pipe — 124 не позже 3 s.
- Mutation testing, каждый mutant — красный test: причина замка в warn — `e2e lock`; `>=` → `>` для origin/main —
  `e2e migrations`; строка коллизии не печатается — `e2e ADR`; без предела 4 строк — `e2e PRs` (7 строк PR, 21
  строка); без причины для gh, которого нет, — оба случая 4g; без выхода по сигналу git — 4f; запасной таймер
  pipe 60 s — 6b (`124 late 15052 ms`); декодер с потерей байт — `e2e subject` и `decode/encode`.

### Мерж и сверка (Session на Mac, 2026-10-18)

- PR #456 влит как `9b5e2cd7` после `GATE_SCOPE=all` gate full на Mac, exit 0, `[gate] зелено (full)` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/456#issuecomment-6243697542)); ПК на `bde22e3`: `preflight.test.sh` exit 0, 34 ok / 0 FAIL, случай тайм-аута проходит, `harness-home.test.sh` exit 0, 42 / 0 ([вердикт ПК](https://github.com/IDSAD-XL/worfy/pull/456#issuecomment-6243521403)). Осталось: на Windows-ПК живой `node harness/bin/preflight --epic worfy-windows` с настоящим `git fetch` — вывода в PR нет, статус не меняется.
