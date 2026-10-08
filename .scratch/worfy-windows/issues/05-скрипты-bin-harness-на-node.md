# 05 — Скрипты bin Harness на Node: profile, ticket, worktree-lock, epic-board, epic-status; worfy зовёт их через node

Type: task
Status: open
Blocked by: 03, 09
Source: решения владельца 2026-10-07: Q19 (скрипты Harness, которые зовут hooks и worfy, — на Node; bash — только в test-ах), Q1 (полный порт), Q24 (Windows 10 21H2+ и 11, x64) ([spec.md](../spec.md)); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node», пункты 1–4; [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [ADR-0007](../../../docs/adr/0007-claude-code-launch-environment.md) (окружение Claude Code — login shell пользователя); evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

Папка `harness/bin` — CLI-скрипты plugin-а Harness `worfy`. Их зовут skills (по пути
`${CLAUDE_PLUGIN_ROOT}/bin/<имя>`), hooks и сам worfy.

- **`epic-status` — на bash** (`#!/usr/bin/env bash`, 313 строк). Он печатает строку «Этап» по
  Epic-у, а с `--json` — срез всех Ticket-ов, который читает worfy.
  - Разбор Ticket-ов — одна программа awk (`harness/bin/epic-status:89-166`). Правила: побеждает
    последнее вхождение `Status` и `Blocked by` в файле; строки внутри ограждений кода
    (```` ``` ````, `~~~`) пропускаются; `\r` в конце строки срезается (`:154`, `:158`); управляющие
    символы заменяются пробелом до экранирования JSON (`:94-97`); слова состояний — `:89-92`;
    разделители `Blocked by` — запятая, `;` и « и », «голова» значения — до тире, скобки, точки или
    запятой (`:112-131`).
  - `--ref <ветка>` распаковывает дерево ветки через `git archive` и `tar` во временную папку
    (`:268-300`). Коды выхода: 2 — ошибка аргументов, 3 — `--ref` не прочитан, 1 — нет Epic-а или
    разбор упал.
  - Корень Ticket-ов он берёт у соседа `ticket root`, но только если в PATH есть node (`:54-62`).
    Без node — `<git top-level>/.scratch`, и поле Profile `tickets.root` не читается.
- **`profile`, `ticket`, `worktree-lock`, `epic-board` — уже на Node**, но на Windows ломаются.
  - `process.env.HOME` без запасного `os.homedir()`. `harness/bin/profile:33` —
    `path.join(process.env.HOME, …)`: без `HOME` бросает исключение на старте. `profile:177` — то же
    для проверки рабочей папки. `harness/bin/worktree-lock:39` без `HOME` молча ничего не делает.
    В обычном окружении Windows переменной `HOME` нет; Git Bash её задаёт.
  - Соседний скрипт зовётся по пути без интерпретатора, то есть по shebang (строке `#!` в начале
    файла): `harness/bin/ticket:83` и `:107` (`profile`), `harness/bin/epic-board:66` (`ticket root`)
    и `:74` (`epic-status`). На Windows файл без расширения так не запускается. `profile:139` зовёт
    `node` по имени из PATH, а не тот node, что запустил его.
  - `epic-board:355` открывает страницу командой macOS `open`.
- **worfy зовёт `epic-status` и `profile` по shebang**: `src/main/workflow/reader.ts:99`,
  `src/main/workflow/profile.ts:64`.
  - `profile` получает окружение login shell пользователя, где node есть в PATH (`profile.ts:91`,
    ADR-0007). `epic-status` получает `process.env` (`reader.ts:98`). У worfy, запущенного из Finder,
    там PATH launchd без node (`src/main/agent/env.ts:3-5`). Сегодня это не мешает: bash-версия
    обходится без node. Версия на Node без node в PATH не запустится.
  - «Скрипта нет» worfy узнаёт по `ENOENT` от `execFile` (`reader.ts:101-104`, `profile.ts:67-70`).
    При запуске `node <файл>` нет файла — это exit 1 от самого node. `reader.ts` принял бы его за «скрипт
    упал», а `profile.ts` — за «сломан Profile» (exit 1 у `profile` — broken config). Так же
    `ticket:110` считает `ENOENT` от `profile` признаком «Profile нет».
- **Test-ы.**
  - `harness/bin/tests/tickets-root.test.sh` зовёт `epic-status` по shebang.
    `harness/bin/tests/harness-home.test.sh:180-181` и `:211` — через `bash`, `:196` — через
    symlink.
  - Отдельного test-а на разбор Ticket-ов (`Status`, `Blocked by`, ограждения, CRLF, экранирование)
    нет. JSON проверяет один случай (`harness-home.test.sh:208-211`).
  - Stub-ы скриптов в контрактных test-ах worfy — shell-скрипты: `epic-status` в
    `test/contract/workflow-reader.test.ts:66-105`, `:396`, `:773`; `profile` и `epic-status` в
    `test/contract/workflow-profile.test.ts:137`, `:156`, `:161`, `:247`.
    `workflow-profile.test.ts:111-120` уже проверяет, что интерпретатор ищется в PATH переданного
    окружения (`worfy-profile-node` — symlink на `/bin/sh`).

## Что делаем

1. **`epic-status` на Node** (Q19, ADR-0055 пункты 1 и 3). Имя без расширения и строка
   `#!/usr/bin/env node` остаются; модуль CommonJS, как `profile` (в `harness/package.json` нет
   `"type"` — так задумано). Контракт прежний, байт в байт:
   - флаги `--json`, `--ref`, `--root` (до и после имени Epic-а), `--`; коды выхода 0, 1, 2, 3;
   - строка «Этап» (`line_for`, `:187-247`), заголовок `<ветка>:` и `--json` (`json_dump`,
     `:249-264`: порядок ключей, компактный JSON);
   - все правила разбора из «Что происходит». Порядок файлов задаётся сортировкой, а не порядком
     `readdir`: bash отдавал отсортированный glob.
   - Корень: с `--root` — на месте, как `ticket root --root` (`ticket:103`), без второго процесса;
     без него — `process.execPath` и путь к `ticket` рядом (`ticket root`). Переменная
     `CLAUDE_TICKET_BIN` (test-ы) работает как прежде. Запасная ветка «нет node» уходит: node есть
     всегда.
   - `--ref` читает дерево ветки без `tar` и временной папки — например, `git ls-tree -r -z` и
     один `git cat-file --batch`. Тексты ошибок и exit 3 — прежние (`:268-300`). git на Windows
     отдаёт пути вида `C:/…`: путь корня внутри репозитория считается после
     `fs.realpathSync.native` с обеих сторон.
2. **`os.homedir()` вместо `HOME`**: `profile:33`, `:177`, `worktree-lock:39`. На Mac
   `os.homedir()` отдаёт `$HOME`, если он задан, поэтому test-ы с временным `HOME` работают как
   прежде. На Windows — `%USERPROFILE%`.
3. **Соседи — через `process.execPath` и путь** (ADR-0055 пункт 2): `ticket:83`/`:107`,
   `epic-board:66` и `:74`, `profile:139` (`gate-resolve.mjs`). Нет файла соседа — ответ прежний:
   существование файла проверяется до запуска (`ticket:110` — «Profile нет»).
4. **`epic-board:355`** открывает файл командой своей системы: `open` на macOS, `cmd /c start ""
   <файл>` или `explorer.exe` на Windows, `xdg-open` на Linux. `--no-open` — как прежде.
5. **worfy зовёт скрипты через `node`** (ADR-0055 пункт 2). `reader.ts:99` и `profile.ts:64` —
   `execFile('node', [script, ...args], { env })`. Node ищет `node` в PATH из `options.env`.
   - `epic-status` получает то же окружение с node, что и `profile`: окружение агента
     (`agentEnv()` из `src/main/agent/env.ts`; на Windows его даёт Ticket 09). В `epicStatusRunner`
     — необязательный параметр окружения: по умолчанию `agentEnv()`, test-ы передают своё. Вызовы
     `src/main/workflow/watch.ts:120` и `src/main/mcp/canvas-server.ts:381` не меняются.
   - Нет файла скрипта — существование проверяется до запуска. Ответ прежний: `not-found` с обоими
     путями (`reader.ts:102-104`) и отказ в `profile.ts`, а не exit 1.
   - Нет `node` в PATH окружения — свой текст: `node not found in PATH`, а не «epic-status not
     found».
6. **Вызовы из skills не меняются.** Имена скриптов без расширения, путь
   `${CLAUDE_PLUGIN_ROOT}/bin/<имя>` прежний. Работает ли вызов по shebang в Git Bash, проверяет
   Ticket 01. Если нет, skills переходят на явный `node` (ADR-0055 пункт 2), и этот срез Ticket 01
   добавляет в Epic.
7. **Stub-ы `epic-status` и `profile` в test-ах worfy — Node-скрипты.** После пункта 5 worfy зовёт
   оба скрипта через `node`, а test-ы подкладывают вместо них shell-скрипты: `#!/bin/sh` и
   `cat '<fixture>'`, `echo` или `printf`. node такой файл не выполнит: `cat '…'` для него —
   SyntaxError. Stub-ы становятся скриптами, которые запускает `node`:
   - `epic-status` в 16 e2e-файлах `test/e2e/`: `autopilot`, `binding`, `card-api` (`:60`),
     `checks-badges`, `done-stack`, `edges`, `epic-frame-undo`, `epic-frame`, `new-session`,
     `no-overlap`, `palette-find`, `projects` (`NO_EPICS`, `:58`), `ship-ticket`, `snapping`,
     `subagent-tree`, `theme-shadows` (все — `*.spec.ts`);
   - `profile` в `test/contract/github-prs.test.ts:459` (`printf`; его вызывает
     `readGithubAccount` через `profileRunner`, `src/main/workflow/profile.ts:58`);
   - `epic-status` в `test/contract/projects.test.ts:121`, `:133` — пустой stub, только строка
     `#!/bin/sh`. node выполняет такой файл как пустой скрипт с кодом 0, так что правка нужна, только
     если test покраснеет. Файл всё равно в «Где в коде»: по нему Wave видит пересечение.
   Список собран `grep -rl '#!/bin/sh' test` на `4f983ef`. Исполнитель повторяет поиск на свежем
   main и дописывает новые файлы в «Где в коде» до начала работы.

## Готово, когда

- [ ] `harness/bin/tests/epic-status.test.sh` (новый) зелёный на bash-версии из `origin/main` — до переписывания — и на Node-версии. Его случаи — в «Тесты».
- [ ] Сверка на живых данных, Mac, worktree worfy: старая версия из `git show origin/main:harness/bin/epic-status`, запущенная `bash` с `CLAUDE_TICKET_BIN=harness/bin/ticket`, и новая дают одинаковый вывод (`diff` пуст) для `--json`, для `--json --ref origin/main`, для строк без аргументов и для `epic-status worfy-windows` (через раздел Mac checks PR, Q33).
- [ ] `head -1 harness/bin/epic-status` — `#!/usr/bin/env node`; `grep -n 'process.env.HOME' harness/bin/profile harness/bin/worktree-lock` — exit 1.
- [ ] `harness-home.test.sh`, новый случай: копия `harness/` со снятым битом исполнения у всех файлов `bin` (`chmod -x`). В ней `node <копия>/bin/ticket root`, `node <копия>/bin/epic-status --json` и `node <копия>/bin/epic-board --no-open --out …` — exit 0. Так на Mac проверяется, что соседи зовутся не по shebang. На нынешнем main случай красный.
- [ ] `bash harness/bin/tests/<файл>` для `profile.test.sh`, `tickets-root.test.sh`, `harness-home.test.sh` и `epic-status.test.sh` — exit 0 на Mac; в `pnpm test` (`test/contract/harness-scripts.test.ts`) — зелёные.
- [ ] Те же четыре test-а — exit 0 в Git Bash на Windows-ПК. Случай, который на Windows не может пройти (например, symlink в `harness-home.test.sh:196`), пропускается со строкой `skip <причина>` только на Windows; причина — в Итог.
- [ ] `test/contract/workflow-reader.test.ts`, новый случай: в `process.env` нет node, в окружении, переданном runner-у, есть — Epic-и и Ticket-ы читаются. На нынешнем main он красный.
- [ ] `test/contract/workflow-reader.test.ts`: нет файла `epic-status` — `not-found` с обоими путями (прежний случай `:339`); нет `node` в PATH окружения — `not-found` с текстом про node. `test/contract/workflow-profile.test.ts`: нет файла `profile` — отказ, а не exit 1.
- [ ] Windows-ПК, dev-сборка: Canvas Project-а worfy показывает рамки Epic-ов с Ticket-ами; снимок — `../evidence/05-epic-и-на-windows.png`. На Windows-ПК `node harness/bin/epic-board` открывает страницу в браузере по умолчанию.
- [ ] Mac: gate full зелёный (`lint`, `typecheck`, `test`, `test:e2e`, `test:package`) (по правилу needs-mac-gate: проверяет и вливает Session на Mac). Упакованная сборка (`pnpm package`), запущенная с окружением launchd (`env -i`, как в skill `ship-ticket`, раздел 6), показывает рамки Epic-ов Project-а worfy: в PATH launchd node нет, в окружении агента — есть (через раздел Mac checks PR, Q33).

## Тесты

Сначала — test-характеристика `harness/bin/tests/epic-status.test.sh`. Он пишется против нынешней
bash-версии и зелёный на ней. После переписывания он остаётся зелёным без правок ожиданий. Fixture
— временный git-репозиторий с Epic-ами в `.scratch`. Случаи:

- все написания `Status` (`done`, `Выкачено …`, `claimed`, `blocked`, без поля) и пять `state`;
- `Status` в шапке и в конце файла — побеждает последнее; `Status: done` внутри ```` ``` ```` и
  `~~~` не считается;
- файл с CRLF; заголовок с кавычкой, обратной косой и управляющим символом — JSON валиден, символ
  стал пробелом;
- `Blocked by`: `01, 02`, `01 и 02`, `01; 02`, `—`, `None — can start`, `Пакет юристу` —
  `blockedNums` и `blockedParsed`;
- файл без номера в начале имени — не Ticket; Epic без Ticket-ов со `spec.md`, с `map.md` и без
  них;
- строка «Этап»: `ticket NN — заголовок`, `waits for`, `blocked`, `N without Status`, `closed`;
- `--ref` ветки, где `.scratch` есть, где его нет (пустой ответ), и несуществующий ref (exit 3);
  корень вне git с `--ref` (exit 3); `--ref` без `--json` и `--root` без значения (exit 2).

Затем красные test-ы worfy: случай «в `process.env` нет node» в
`test/contract/workflow-reader.test.ts` и случай `chmod -x` в `harness-home.test.sh`. На нынешнем
main оба красные. В Итог — как они падали.

Stub-ы в `workflow-reader.test.ts` и `workflow-profile.test.ts` становятся скриптами, которые
запускает `node`, как и stub-ы пункта 7. Другой путь — stub `node` в PATH окружения test-а, как
`worfy-profile-node` (`workflow-profile.test.ts:111-120`).

Ожидаемая трудность в Git Bash (на Windows не проверено). Git Bash переводит пути `/tmp/…` в
аргументах native-программ в `C:\…`, а в содержимое JSON-файлов fixture-ов — нет. Если `match`
реестра не совпадёт с путём, который видит node, fixture пишет пути через `cygpath -m`, когда тот
есть.

## Где в коде

- `harness/bin/epic-status`
- `harness/bin/profile`
- `harness/bin/ticket`
- `harness/bin/worktree-lock`
- `harness/bin/epic-board`
- `harness/bin/tests/epic-status.test.sh` (новый)
- `harness/bin/tests/harness-home.test.sh`
- `src/main/workflow/reader.ts`
- `src/main/workflow/profile.ts`
- `test/contract/workflow-reader.test.ts`
- `test/contract/workflow-profile.test.ts`
- `test/contract/github-prs.test.ts`
- `test/contract/projects.test.ts`
- `test/e2e/autopilot.spec.ts`
- `test/e2e/binding.spec.ts`
- `test/e2e/card-api.spec.ts`
- `test/e2e/checks-badges.spec.ts`
- `test/e2e/done-stack.spec.ts`
- `test/e2e/edges.spec.ts`
- `test/e2e/epic-frame-undo.spec.ts`
- `test/e2e/epic-frame.spec.ts`
- `test/e2e/new-session.spec.ts`
- `test/e2e/no-overlap.spec.ts`
- `test/e2e/palette-find.spec.ts`
- `test/e2e/projects.spec.ts`
- `test/e2e/ship-ticket.spec.ts`
- `test/e2e/snapping.spec.ts`
- `test/e2e/subagent-tree.spec.ts`
- `test/e2e/theme-shadows.spec.ts`

Не входит: `preflight` (Ticket 06), обёртки qmd (Ticket 15), hooks и `hooks.json` (Ticket 04),
Gate и `gate-resolve.mjs` (Ticket 03), тексты skills (Ticket 07). `harness-home.test.sh` правит и
Ticket 06 (его `bash …/preflight`, `:186`), поэтому 05 и 06 не идут в одной Wave. Stub-ы пункта 7
дают ещё пересечения: `test/contract/projects.test.ts` — с Ticket-ом 10, `github-prs.test.ts` и
e2e-файлы — с Ticket-ом 14. С Epic-ом `worfy-link` общие `test/e2e/card-api.spec.ts` (его Ticket 10)
и `test/contract/projects.test.ts` (его Ticket 11); их видит проверка открытых PR второго Epic-а
перед Wave (ADR-0056).

## Итог

Заполняется при закрытии.
