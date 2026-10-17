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
    В обычном окружении Windows переменной `HOME` нет; Git Bash её задаёт (на ПК: в PowerShell
    `HOME` пуст, в Git Bash — `/c/Users/Alexey`; evidence Ticket-а 01, раздел 07).
  - Соседний скрипт зовётся по пути без интерпретатора, то есть по shebang (строке `#!` в начале
    файла): `harness/bin/ticket:83` и `:107` (`profile`), `harness/bin/epic-board:66` (`ticket root`)
    и `:74` (`epic-status`). На Windows файл без расширения так не запускается: на ПК
    `node harness/bin/epic-board --help` — EXIT=2, `tickets root not determined: spawnSync
    C:\Users\Alexey\worfy\harness\bin\ticket ENOENT` (evidence, раздел 18). `profile:139` зовёт
    `node` по имени из PATH, а не тот node, что запустил его.
  - Из Git Bash (Bash tool) по shebang скрипты `bin` запускаются: `./harness/bin/profile --help` и
    `./harness/bin/epic-status --json` — EXIT=0; `bash harness/bin/epic-status --json` с CRLF в
    рабочем дереве — EXIT=0, валидный JSON (evidence, разделы 18, 19 и 21).
  - `epic-board:355` открывает страницу командой macOS `open`.
- **`silent-check` — на Node, пришёл с PR #150** (E3 Ticket 22, `3837558`). Те же места, что у
  соседей: `profile` и `ticket` зовёт по пути, то есть по shebang (`execFileSync(PROFILE, …)` `:84`,
  `execFileSync(TICKET, …)` `:112`), домашнюю папку берёт из `process.env.HOME` (`:139`). На ПК
  `node harness/bin/silent-check hello` — EXIT=2, `profile not read (exit ENOENT): spawnSync
  …\harness\bin\profile ENOENT` (evidence Ticket-а 01, раздел 18). Его зовут `guard.mjs`,
  `session-start.sh`, skills `ship-ticket` и agent `implementer`; test — `harness/bin/tests/silent-mode.test.sh`.
- **worfy зовёт `epic-status` и `profile` по shebang**: `src/main/workflow/reader.ts:99`,
  `src/main/workflow/profile.ts:64`.
  - `profile` получает окружение login shell пользователя, где node есть в PATH (`profile.ts:91`,
    ADR-0007). `epic-status` получает `process.env` (`reader.ts:98`). У worfy, запущенного из Finder,
    там PATH launchd без node (`src/main/agent/env.ts:3-5`). Bash-версия без node не зовёт
    `ticket root` и читает `<корень>/.scratch`: у Silent Project-а (Ticket-ы вне репозитория) worfy
    из Finder не показывал ни одного Epic-а — блокер приёмки E3 (Ticket 37 Epic-а `worfy-harness`,
    «Вне скоупа»). С PR #305 (Ticket 37, первый срез; 2026-10-14) `epic-status` и `profile` worfy
    запускает с окружением login shell (`src/main/harness/script-env.ts`); номера строк этого
    абзаца — до него. Версия на Node без node в PATH не запустится.
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
2. **`os.homedir()` вместо `HOME`**: `profile:33`, `:177`, `worktree-lock:39`, `silent-check:139`. На Mac
   `os.homedir()` отдаёт `$HOME`, если он задан, поэтому test-ы с временным `HOME` работают как
   прежде. На Windows — `%USERPROFILE%`.
3. **Соседи — через `process.execPath` и путь** (ADR-0055 пункт 2): `ticket:83`/`:107`,
   `epic-board:66` и `:74`, `profile:139` (`gate-resolve.mjs`), `silent-check:84` и `:112`. Номера
   строк — на 4f983ef (у `silent-check` — на `08e8256`); PR #150 правил `ticket`, `profile` и
   `epic-board`, перед началом перечитать. Нет файла соседа — ответ прежний:
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
   `${CLAUDE_PLUGIN_ROOT}/bin/<имя>` прежний. Вызов по shebang в Git Bash работает — и в Bash tool,
   и в команде hook-а (evidence Ticket-а 01, разделы 13 и 19), поэтому перехода skills на явный
   `node` в Epic-е нет.
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
- [ ] `head -1 harness/bin/epic-status` — `#!/usr/bin/env node`; `grep -n 'process.env.HOME' harness/bin/profile harness/bin/worktree-lock harness/bin/silent-check` — exit 1.
- [ ] `harness-home.test.sh`, новый случай: копия `harness/` со снятым битом исполнения у всех файлов `bin` (`chmod -x`). В ней `node <копия>/bin/ticket root`, `node <копия>/bin/epic-status --json` и `node <копия>/bin/epic-board --no-open --out …` — exit 0. Так на Mac проверяется, что соседи зовутся не по shebang. На нынешнем main случай красный.
- [ ] `bash harness/bin/tests/<файл>` для `profile.test.sh`, `tickets-root.test.sh`, `harness-home.test.sh`, `silent-mode.test.sh` и `epic-status.test.sh` — exit 0 на Mac; в `pnpm test` (`test/contract/harness-scripts.test.ts`) — зелёные.
- [ ] Windows-ПК, Git Bash: `node harness/bin/silent-check -C "$(mktemp -d)" hello; echo "EXIT=$?"` — `EXIT=0` (папка вне зарегистрированных Project-ов — «nothing to check»). На нынешнем main — EXIT=2, `spawnSync …\harness\bin\profile ENOENT` (evidence Ticket-а 01, раздел 18).
- [ ] Те же пять test-ов — exit 0 в Git Bash на Windows-ПК. Случай, который на Windows не может пройти (например, symlink в `harness-home.test.sh:196`: без режима разработчика symlink на ПК — `EPERM`, evidence Ticket-а 01, раздел 22), пропускается со строкой `skip <причина>` только на Windows; причина — в Итог.
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

Ожидаемая трудность в Git Bash. Git Bash переводит пути `/tmp/…` в аргументах native-программ в
`C:\…`, а в содержимое JSON-файлов fixture-ов — нет. Если `match` реестра не совпадёт с путём,
который видит node, fixture пишет пути через `cygpath -m`: в Git Bash ПК он есть, `cygpath -m /tmp`
→ `C:/Users/Alexey/AppData/Local/Temp` (evidence Ticket-а 01, раздел 05).

На ПК `test/contract/workflow-reader.test.ts` (25 упавших, `code: 'not-found'`) и
`test/contract/workflow-profile.test.ts` (20 упавших, `no profile script at \h\bin\…`) уже красные
(evidence, раздел 17): stub-ы `#!/bin/sh` и пути с `/`. Этот Ticket сверяет их с тем списком.

## Где в коде

- `harness/bin/epic-status`
- `harness/bin/profile`
- `harness/bin/ticket`
- `harness/bin/worktree-lock`
- `harness/bin/epic-board`
- `harness/bin/silent-check`
- `harness/bin/tests/silent-mode.test.sh`
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
перед Wave (ADR-0056). PR #150 (E3 Ticket 22) влит как `3837558` и правил `epic-status`, `profile`,
`ticket`, `epic-board`, `harness-home.test.sh`, `tickets-root.test.sh` и `profile.test.sh` (evidence
Ticket-а 01, раздел 18): строки выше — на 4f983ef, перед началом перечитать эти файлы. Открытый E3
Ticket 23 (worfy читает Silent Project) тоже меняет `src/main/workflow/reader.ts`,
`src/main/workflow/profile.ts` и их contract test-ы — общие файлы с этим Ticket-ом.

## Итог
### Срез 05a — скрипты Harness: `epic-status` на Node, домашняя папка, соседи через `process.execPath`

Session на Windows-ПК, 2026-10-17. Windows 11 Pro 10.0.26200, Git Bash; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/05-harness-scripts` от main `4500799`, слит main `3b50717`. Пункты 1–4 «Что делаем»; пункты 5 и 7 (worfy зовёт скрипты через `node`, stub-ы test-ов) — срез 05b. **На macOS и Linux с ПК ничего не запускалось.**

- **Test-характеристика (`a7ce0fb`)** — `harness/bin/tests/epic-status.test.sh`, 42 проверки, отдельным commit-ом до переписывания: срез `--json` целиком байт в байт; все написания `Status` и пять `state`; побеждает последнее вхождение; ограждения ```` ``` ```` и `~~~`; CRLF; кавычка, обратная косая и управляющий символ; десять написаний `Blocked by`; `Branch` и `Repo`; файл без номера — не Ticket; Epic-и с точкой в начале пропускаются; Epic со `spec.md`, с `map.md` и без них; все формы строки «Этап»; `--ref` существующей ветки, ветки без `.scratch`, корня, которого нет в рабочем дереве, несуществующего ref, корня вне git, корня репозитория, в режиме Silent; случаи exit 2; код выхода `ticket root` передаётся; `CLAUDE_TICKET_BIN`. На bash-версии на ПК совпадают все случаи, кроме 7, которые bash на Windows не проходит: четыре `--ref` — «could not be resolved» (путь `C:/` против `/c/`), три с отсутствующим корнем — бесконечный цикл `${anc%/*}` на пути `C:\`.
- **`epic-status` на Node (`2f28533`).** CommonJS, имя без расширения, `#!/usr/bin/env node`. `--ref` читает дерево ветки через `git ls-tree -r -z` и один `git cat-file --batch`, без `tar` и временной папки; путь корня внутри репозитория — после `fs.realpathSync.native` с обеих сторон. `--root` разбирается на месте; без него — `ticket root` через `process.execPath`. Запасной ветки «нет node» больше нет: `tickets-root.test.sh`, раздел 8, теперь ждёт отказа без node.
- **`os.homedir()` вместо `HOME` (`3ef73ab`)** в `profile`, `worktree-lock`, `silent-check`; `grep -n 'process.env.HOME'` по ним — exit 1. На Windows скрипт берёт `USERPROFILE`, поэтому `profile.test.sh` задаёт его рядом с `HOME`.
- **Соседи — через `process.execPath` и путь (`0fff5dc`)**: `ticket` → `profile`, `epic-board` → `ticket root` и `epic-status`, `profile` → `gate-resolve.mjs`, `silent-check` → `profile` и `ticket`. Существование файла проверяется до запуска, ответы прежние.
- **`epic-board` (`5681b14`)** открывает страницу командой системы: `open` на macOS, `explorer.exe` на Windows, `xdg-open` на Linux; `--no-open` — как прежде.
- **`harness-home.test.sh` (`d5955d2`)**: новый случай — копия `harness/` без бита исполнения у файлов `bin`; `node <копия>/bin/ticket root`, `epic-status --json`, `epic-board --no-open` — exit 0. На main на ПК он красный: `epic-status` — exit 1 (node не выполняет файл bash), `epic-board` — exit 2 (`spawnSync ticket ENOENT`).
- **Старая и новая версии на этом репозитории (ПК):** без аргументов и `worfy-windows` — одинаковые байты и коды выхода. `--json` отличается ровно двумя запятыми: на Windows старая версия отдаёт невалидный JSON — `xargs` делит список файлов на три запуска awk, и счётчик запятых каждый раз начинается заново; с этими запятыми выводы совпадают байт в байт. `--json --ref origin/main`: старая версия на Windows — exit 3 (пути `C:/` и `/c/`); новая совпадает со старой, запущенной на копии `origin/main` из `git archive`, кроме метки ref и тех же запятых.
- **Проверки на ПК из «Готово, когда»:** `node harness/bin/epic-board --no-open --out <файл>` — exit 0, 13 Epic-ов. `node harness/bin/silent-check -C "$(mktemp -d)" hello`: с пустым временным реестром Gate — exit 0; с настоящим `HOME` — exit 2, потому что на ПК нет реестра Gate (`~/.claude/worfy-harness/gate/config.json`, ENOENT); на main — exit 2, `spawnSync …\profile ENOENT`.
- **Ревью** — subagent этой Session, линза «корректность» с упором на macOS и Linux: high и medium нет; правила разбора, ключи и компактность JSON, флаги, коды выхода и тексты ошибок совпадают со старой версией, на fixture-ах без symlink — байт в байт, включая `--ref` с пробелами и кириллицей. Low:
  - `epic-status --json | head` печатал stack trace на `EPIPE` (bash выходил молча по SIGPIPE) — исправлено в `937a7aa`: на прошлой голове exit 1 и trace, теперь exit 0 и пустой stderr.
  - Порядок файлов и Epic-ов — всегда байтовый. bash-glob следовал `LC_COLLATE`: в `en_US.UTF-8` на Linux смешанный регистр и кириллица шли иначе (`alpha Beta Gamma`, `ёлка` раньше `Яблоко`); в C и C.UTF-8 — как сейчас. Выбран байтовый порядок; шапка скрипта говорит об этом (`937a7aa`).
  - `--ref` читает только обычные файлы: symlink-и Ticket-ов, папок Epic-ов, `spec.md` в ветке не видны (`git archive` их распаковывал). Рабочее дерево symlink-и по-прежнему проходит. Записано в шапке как сужение.
  - На Linux имя файла не в UTF-8 теряется (`readdirSync` без `encoding: "buffer"`); macOS (APFS) не затронут. Не правилось.
  - Вопрос для Mac: путь корня с й или ё в NFD на диске против путей git в NFC (`core.precomposeunicode`) — не даст ли `--ref` пустой срез с exit 0.
  - Сам reviewer запускал старую bash-версию под WSL — вопреки правилу «без WSL» на этом ПК; его выводы о Linux сделаны там.

| `pnpm test` | Exit | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| main `3b50717` | 1 | 5623 | 5176 | 303 | 144 |
| ветка `937a7aa` | 1 | 5624 | 5178 | 302 | 144 |

- **Новых падений по именам нет.** На ветке упали 2 test-а, которые на main прошли: timeout 5 с в `canvas.test.tsx` и `linked-read-only.test.tsx` — файлы срез не трогал; отдельно на обеих сторонах — 64 из 64 прошли.
- `harness-scripts.test.ts` (test-ы `harness/**/tests/*.test.sh` под `pnpm test`): main 19 упало из 31 → ветка 18 из 32. `epic-status.test.sh` (новый) и `harness-home.test.sh` — зелёные.
- `pnpm lint`, `pnpm typecheck` на `937a7aa` — exit 0.
- На Windows пропущены, со строкой `skip <причина>`: три проверки через symlink в `harness-home.test.sh` (без режима разработчика `ln -s` в Git Bash делает копию), проверка `qmd-sync-main` (скрипт zsh) и запуск локального финиша под zsh в `silent-mode.test.sh` (в Git Bash нет zsh).

**Не сделано в этом срезе:** пункт «Готово, когда» «те же пять test-ов — exit 0 в Git Bash на Windows-ПК» выполнен для `epic-status.test.sh` и `harness-home.test.sh`. `profile.test.sh` (79 падений, тот же набор, что на main) и `tickets-root.test.sh` (14 падений; на main 20 и зависания) красные из-за написания путей в fixture-ах: `/tmp/…` в `match` реестра, `ticket` печатает `C:\…`. `silent-mode.test.sh` — 3 падения из `harness/hooks/worktree-create.sh` (`pwd -P` даёт `/tmp/…`; hooks переписывает Ticket 04).
**Не проверено:** всё на macOS и Linux — test-характеристика на bash-версии (экранирование обратной косой в awk macOS), сверка старой и новой версий на живых данных Mac (раздел Mac checks PR).

#### Срез 05a, раунд 2 — ревью Session на Mac и шапка Ticket-а из worfy-pipeline/01

- **Ревью Session на Mac** (глубина high, раунд 1): безопасность чистая — порт закрыл две старые дыры bash-версии (`--ref '--output=…'` писал произвольный файл через `git archive`; symlink-Ticket в ветке читал `/etc/hosts`). На настоящем репозитории 147 запусков (13 Epic-ов × 49 наборов флагов × 3 локали): 138 байт в байт, остальные 9 — `--json --ref`, где bash отдавал имена в NFD через bsdtar; вывод в NFC — исправление. `epic-board` — 1,9 с вместо 11,1 с. Исправлено:
  - **Блокер:** `test/contract/harness-script-env.test.ts:162-167` ждал exit 3 и «node is not on PATH» — запасной ветки bash без node больше нет, `epic-status` без node — exit 127 (`env: node: …`). На main зелёный, на ветке на Mac и Linux красный; на Windows этот describe пропущен, поэтому сверка по именам на ПК его не видела. Теперь ждёт 127, пустой stdout и stderr с `node` (`1ae25e2`).
  - `epic-status`: фильтр `parts[1] !== "issues"` получил test — `--ref` с файлом `evidence/01-x.md` (`f0a0140`); корень с именем `..t` внутри репозитория больше не отвергается (`rel === ".."` или начало `".." + path.sep`, `f0a0140`).
  - `silent-check`: случай с папкой Workflow под домашней папкой, в форме `~/…` (`8eb8e8f`). Он нашёл дефект Windows: Profile отдаёт `C:\…`, а `os.homedir()` — `C:/…`, и форма `~/…` не добавлялась; теперь обе стороны идут через `path.resolve`.
  - `profile`: домашняя папка, общий родитель репозиториев Profile, не становится workspace (`ed8535c`).
  - Каждый новый test падает на своём мутанте и проходит на исправлении.
  - Вопрос «ищет ли Windows `explorer.exe` и `git` сначала в рабочей папке»: на ПК проверено копией `node.exe` под этими именами — Node 24 на Windows рабочую папку не смотрит, только PATH. Без правок.
- **Шапка Ticket-а (worfy-pipeline/01, #421)** влита в main раньше этого PR (решение Session на Mac): она правила bash-`epic-status`. Ветка слила `origin/worfy-pipeline/01` (`e5b895e`) и main `05c63c8` (`1549ce9`); чтение шапки перенесено в Node-версию (`dfd072f`): первая строка `Status` — `statusRaw`, `state` берётся из неё, только если она одна в файле и в новой форме, иначе `none` и `statusError` «old header»; `statusAt`, `statusError`, `blockedReason`, `waits`, `pr` — в порядке ключей bash; строки шапки считаются вне кода и до первого `## ` после `Status`; строка «Этап» дописывает «N with an old header — run ticket migrate». `epic-status.test.sh` (47 проверок): fixture-ы старой шапки теперь `none` с «old header», ожидания строк «Этап» и JSON сверены с bash-версией #421 на том же fixture-е (30 запусков одинаковы; `--ref` — через копию из `git archive`); новый Epic `hdr` — 12 Ticket-ов под новые правила. Мутанты порта (граница `## `, `nstatus === 1`, счётчик старых шапок) — красные.

| `pnpm test` | Exit | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| main `05c63c8` | 1 | 5656 | 5207 | 305 | 144 |
| ветка `1549ce9` | 1 | 5657 | 5210 | 303 | 144 |

- **Новых падений по именам нет.** На ветке и не на main упал один test — `link-server` «closes a pairing socket that sends more than 65536 bytes with 1009» (1006 вместо 1009); он же падает на main, когда `link-server.test.ts` идёт отдельно. Перестали падать 3: `harness-scripts` (`epic-status.test.sh`), `harness-install`, `startup-failure` — последние два в файлах, которые срез не трогает.
- `harness-scripts.test.ts`: main 19 упало из 32 → ветка 18 из 33. `workflow-reader.test.ts` — 31 на обеих сторонах (stub-ы `#!/bin/sh`, их переводит срез 05b).
- Скрипты Harness в Git Bash: `ticket-header.test.sh` 44/0, `epic-status.test.sh` 47/0, `harness-home.test.sh` 41/0 — exit 0; `silent-mode.test.sh` 85/3 (3 — `worktree-create.sh`, Ticket 04), `profile.test.sh` 92/79 и `tickets-root.test.sh` 12/14 — пути fixture-ов, срез 05c. На main `silent-mode.test.sh` и `tickets-root.test.sh` на ПК зависают (bash-`epic-status` в цикле на пути `C:\`); на ветке доходят до конца.
- `pnpm lint`, `pnpm typecheck` на `1549ce9` — exit 0.
