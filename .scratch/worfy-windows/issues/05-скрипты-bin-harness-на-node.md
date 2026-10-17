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

### Срез 05b — worfy запускает скрипты Harness через `node`; stub-ы test-ов — скрипты Node

Session на Windows-ПК, 2026-10-17. Windows 11 Pro 10.0.26200, Git Bash; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/05-node-start` от main `4500799`. В неё слиты срез 05a по ходу его ревью (worfy не может запустить через `node` bash-`epic-status`) и main `00078fa`, где 05a влит (#420); конфликт в `harness-script-env.test.ts` — squash #420 против его же commit-ов, уже слитых сюда, решён в пользу ветки, где есть и 05a, и 05b. Пункты 5 и 7 «Что делаем». **На macOS и Linux с ПК ничего не запускалось.**

- **worfy запускает `epic-status`, `profile` и `ticket` как `node <скрипт>` (`6ad96c9`).** `harnessScriptCommand` (`src/main/workflow/profile.ts`) ищет `node` в PATH окружения, которое получит скрипт (на Windows — `node.exe` и ключ `Path` в любом регистре; относительные записи PATH пропускаются), и до запуска проверяет, что файл скрипта есть. Нет файла — прежний ответ: `not-found` с обоими путями у `epic-status`, «нет скрипта profile» у `profile`. Нет node — свой текст `node not found in PATH`, помеченный как сбой окружения: watcher снова снимает окружение login shell. Через него идут `reader.ts`, `profileRunner`, `ticket root` (`folder.ts`), `profile --help` строки первого запуска. `epicStatusRunner` уже с PR #305 принимает окружение обязательным параметром — так и осталось.
- **Старый Harness (`a8c4eb8`, ревью).** У копии Harness из `~/.claude/bin` (legacy) или plugin-а прежнего worfy, ещё не обновлённого, `epic-status` — на bash; `node <файл bash>` упал бы с SyntaxError, и Canvas потерял бы все Epic-и. Если первая строка `#!` не называет node, скрипт на macOS и Linux запускается сам, как раньше; на Windows — понятный отказ «this Harness's epic-status is not a Node script — update the Harness».
- **Строка «Harness scripts» экрана первого запуска (`22f22ea`, `58354fc`)**: нет node — подсказка про node; пропуск на Windows («ticket 05 решит») снят; подсказка `start` говорит о запуске node, а не о бите исполнения.
- **Stub-ы (`15693a5`, `5e81a2d`, `6c3fb9e`, `b091890`)**: stub-ы `epic-status` и `profile` в contract-test-ах (`workflow-reader`, `workflow-profile`, `github-prs`, `projects`, `docs`, `first-run-checks`, `harness-script-wiring`) и в 31 e2e-spec — скрипты Node; общий помощник `test/harness-node.ts`. Вывод и коды выхода — как у прежних `cat`/`printf`/`echo`.
- **Новые contract-случаи:** node есть только в PATH runner-а — Epic-и читаются (на исходниках main красный); нет node — `node not found in PATH`; нет скрипта — сообщается раньше, чем нет node; нет файла `profile` — отказ, а не exit 1.
- **Мутанты:** без поиска node падают 1 случай reader и 3 profile; без проверки существования — 29 reader и 4 profile; скрипт по пути без node — 32 из 47 reader и 45 из 84 profile; без ветки «старый Harness» — два случая Windows (случаи macOS и Linux на ПК пропущены).
- **Ревью** — subagent этой Session, линза «корректность», macOS в первую очередь. Найдено и исправлено в `77f7b95`, `a8c4eb8`, `58354fc`:
  - high: `harness-script-env.test.ts` (`:243`, `:288`), e2e `first-run.spec.ts` (`:322`) и `finder-path.spec.ts` (`:130`) ждали старый текст «exit code 127: … node» — на Windows пропущены, на Linux CI и Mac были бы красными;
  - medium: старый Harness с bash-`epic-status` — см. выше;
  - low: пропуск на Windows и подсказка в строке первого запуска, устаревшие комментарии.
  - Ожидания «exit code 127» оставлены там, где test проверяет, как runner обрабатывает 127 от самого скрипта (это по-прежнему возможно у старого Harness, который запускается сам): `workflow-profile.test.ts:553`, `:662`, `workflow-watch-retry.test.ts:160`, `harness-script-wiring.test.ts:431-450`.
  - Без ответа (вопрос): видит ли job `full-macos` CI node в PATH login shell — stub-ам e2e он теперь нужен там, где `#!/bin/sh` не требовал.

| `pnpm test` | Exit | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| main `00078fa` | 1 | 5657 | 5206 | 307 | 144 |
| ветка `272617c` | 1 | 5664 | 5280 | 240 | 144 |

| Файл | main: упало | ветка: упало |
|---|---|---|
| `workflow-reader.test.ts` | 31 из 45 | 1 из 49, 1 пропущен |
| `workflow-profile.test.ts` | 46 из 82 | 29 из 86 |
| `github-prs.test.ts` | 14 из 69 | 0 из 69 |
| `docs.test.ts` | 3 из 22 | 0 из 22 |
| `projects.test.ts` | 11 из 42 | 10 из 42 |
| `first-run-checks.test.ts` | 22 из 54 | 22 из 53 |

- Ветка `272617c` по файлам равна `3c19ea6` (голова PR): слияние main `00078fa` добавило только `docs/lessons/README.md` и один файл `.scratch`.
- **Новых падений по именам нет.** Перестали падать 67 test-ов: `workflow-reader` 30, `workflow-profile` 17, `github-prs` 14 (12 — группа «gh with the Project's GitHub account», которой нужен был `bin/profile`, остаток среза 3b Ticket-а 14; 2 — timeout-ы под нагрузкой на main), `docs` 3, `projects`, `harness-install`, `startup-failure` по 1. `startup-failure.test.ts` отдельно на обеих сторонах — одинаково, 11 из 35 упало.
- Без нагрузки, отдельно на обеих сторонах (`workflow-reader`, `critical-path`, `epic-layout`, `harness-scripts`): новых падений нет; `critical-path` (разделитель пути Windows) и `epic-layout` (timeout 5 с) — по одному и на main.
- Оставшийся `workflow-reader` — timeout производительности (371 мс при пороге 300 мс), падает и на main. 29 в `workflow-profile` и 10 в `projects` падают и на main: ждут путей POSIX (`/h/bin`, `/work/…`).
- **e2e, 31 изменённый spec** (без `packaged.spec.ts`), `electron-vite build` и Playwright, окна приложения на ПК (ночная автономия). Сверка по имени test-а без номеров строк (spec-и правились). Первый прогон, main `3b50717` и ветка `c5f092b`, 05:10–05:46: main — 78 упало, 14 прошли; ветка — 58 упало, 34 прошли. Повтор после слияния с 05a раунда 2 и main, main `501e92a` и ветка `272617c`, 10:38–11:15: main — 78 упало, 14 прошли; ветка — 57 упало, 35 прошли; новых падений нет, перестали падать 21 (`autopilot` 5, `focus-sidebar` 2, `linked-autopilot` 2, `ship-ticket` 2, `card-api`, `checks-badges`, `epic-frame`, `epic-frame-undo`, `finder-path`, `projects`, `sidebar-sections`, `silent-project`, `theme-shadows`, `two-windows` по 1). `first-run.spec.ts` «Harness scripts…» (переименован в ревью) падает на обеих сторонах: fixture `PATH` в виде POSIX.
- `pnpm lint`, `pnpm typecheck` на `44d37a5` (дерево `src` и `test` то же, что у `3c19ea6`) — exit 0.
- Ночью на ПК оставались зависшие процессы `bash` от test-ов `silent-mode` на main (bash-`epic-status` в цикле на пути вида `C:\…`): 27, затем ещё 9. Они давали timeout-ы в полных прогонах; остановлены, после каждого прогона теперь чистятся. Поэтому сомнительные файлы прогнаны отдельно.

**Не проверено:** всё на macOS и Linux, в том числе случаи «старый Harness запускается сам» и `harness-script-env.test.ts` (на Windows пропущены); `packaged.spec.ts`.

### Срез 05b, раунд 2 — ревью Mac (PR #434)

Session на Windows-ПК, 2026-10-17. Ревью первого раунда на Mac (глубина high: корректность на macOS, безопасность, мутанты) — изменения запрошены. Код приложения на macOS не регрессировал, но 7 test-ов на Mac красные там, где main зелёный: stub-ы стали скриптами Node, а эти test-ы запускают их с PATH без node. На Windows эти test-ы пропущены, поэтому вердикт с ПК их не видел. Исправлено в `1b563bd`, `a224925`, `4e5e6d8`, `f4ed6ee`, `e59dfae`.

- **Блокеры (high), одна причина.**
  - `harness-script-wiring.test.ts` (`:340`, `:423`, `:441`): PATH `/usr/bin:/bin` теперь с папкой node впереди (`LOGIN_PATH`) — по-прежнему PATH как у login shell, без PATH самого worfy.
  - `projects.test.ts:697-704` и e2e машины B (`linked-add-project.spec.ts`, `linked-read-only.spec.ts`, `linked-machines.spec.ts`): окружение скриптов worfy снимает через `$SHELL -ilc` (`src/main/agent/env.ts`); при `SHELL=/bin/sh` и временном HOME login shell читает `/etc/profile`, потом `$HOME/.profile`. Помощник `loginProfileWithNode(home)` (`test/harness-node.ts`) пишет `.profile`, который ставит папку node первой в PATH. Так путь «скрипт через node» остаётся под test-ом; stub-ы `#!/bin/sh` вне Windows не понадобились.
- **medium: аргументы старого Harness.** Stub-ы `#!/bin/sh` в `workflow-reader.test.ts` и `workflow-profile.test.ts` отвечают только на аргументы worfy (`--json`, `--json --ref <x>`; `-C <корень> --field mcp.allowed`), иначе exit 2 «unexpected arguments». Новые test-ы запускают каждый stub через `sh`; на Windows — когда `sh` есть в PATH (Git Bash).
- **low.**
  - `profile.ts`: BOM UTF-8 перед `#!` отбрасывается; файл, который нельзя прочитать, на macOS и Linux запускается сам (система скажет, можно ли), на Windows — через node, и node объясняет отказ.
  - `nodeOnPath` на Windows берёт только полные пути: `\tools`, `/tools`, `C:tools` пропускаются (`isWindowsAbsolutePath` из `src/shared/paths.ts`, то же правило, что у `findOnPath`). Иначе проверка смотрела бы на диск worfy, а запуск шёл бы на диске рабочей папки скрипта.
  - Новый `test/contract/harness-script-command.test.ts`: порядок PATH, относительная запись, запись от корня диска (Windows), папка с именем node, нет бита исполнения; папка на месте скрипта, нет строки `#!`, BOM с node и с bash, аргументы старого Harness, нечитаемый файл; `runEpicStatus`: рабочей папки нет, EACCES — `not-found`.
- **Мутанты на ПК** (`harness-script-command.test.ts`, каждый с возвратом файла): убиты — обратный порядок PATH, относительные записи не пропускаются, `isAbsolute` на Windows, без `isFile`, папка принята за скрипт, без проверки `#!`, BOM не отбрасывается, `reader.ts:156` `not-found` → `failed`. Выжили, потому что их случаи на Windows пропущены: без `X_OK`, нечитаемый файл отдан node, `args: []` у старого Harness — проверены только чтением.
- **Найдено на ПК при полном прогоне:** `test/harness-node.ts` в первой версии раунда спрашивал `spawnSync('sh')` при загрузке модуля, а его загружают e2e-spec-и — `e2e-no-spawn-on-load.test.ts` падал (на любой ОС). Теперь `hasSh()` спрашивает при первом вызове (`e59dfae`).

| `pnpm test` | Exit | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| main `00078fa` | 1 | 5657 | 5206 | 307 | 144 |
| ветка `f4ed6ee` | 1 | 5680 | 5259 | 273 | 148 |

- В полном прогоне 26 имён упали только на ветке, почти все — timeout-ы: пять зависших `bash` от прогона #428 в `wt428` (bash-`epic-status` в цикле) крутились с 11:55. Остановлены. 14 этих файлов прогнаны отдельно на обеих сторонах: осталось 3 имени. `e2e-no-spawn-on-load` — настоящий, исправлен в `e59dfae` и после него зелёный; `startup-failure` «ignores an ELECTRON_RENDERER_URL that is not a URL» падает и в полном прогоне main; `shell-discovery` «Sidebar renders a section file…» — отдельно по два раза на обеих сторонах зелёный.
- **Новых падений по именам нет** (на `e59dfae`: `e2e-no-spawn-on-load`, `workflow-profile`, `workflow-reader`, `shell-discovery` отдельно — ни одного имени, которое на main проходит). Перестали падать 60: `workflow-reader` 29, `workflow-profile` 17, `github-prs` 10, `docs` 3, `projects` 1.
- e2e трёх изменённых spec-ов `linked-*` на ПК, 14:55–14:57: 6 упало, 6 прошли — те же имена, что на main `501e92a` и на ветке до раунда; новых падений нет. На Windows они падают по своим причинам; то, что машина B видит Epic, на ПК не проверить.
- `pnpm lint`, `pnpm typecheck` на `e59dfae` — exit 0.

**Не проверено:** блокеры раунда и случаи, пропущенные на Windows (`X_OK`, нечитаемый файл, аргументы старого Harness через сам runner, `harness-script-wiring` с минимальным PATH, машина B в e2e), — только на macOS и Linux; на ПК проверены чтением.

### Срез 05c — shell-test-ы Harness на Windows: пути в fixture-ах

Session на Windows-ПК, 2026-10-17. Windows 11 Pro 10.0.26200, Git Bash. Ветка `worfy-windows/05-test-fixtures` от main `9337e77`. Только test-ы: код скриптов Harness не менялся. **На macOS и Linux с ПК ничего не запускалось.**

- **Причина падений на Windows.** Fixture-ы писали пути в виде Git Bash (`/tmp/tmp.X/…`): `match` в реестре, `tickets.root` и `workflow.folder` в `profile.json`, ожидаемые строки. Скрипты на Node видят тот же каталог как `C:\Users\…\Temp\tmp.X\…`. Поэтому `profile` отвечал exit 3 «not in a registered project», а `/tmp/…` в `profile.json` Node понимал как `C:\tmp\…`.
- **Что сделано (`43a2b41`, `0911e8b`, `da0c3a1`).**
  - Временный каталог `T` берётся через `pwd -W || pwd -P`, как в `silent-mode.test.sh`: в Git Bash это `C:/…`, на macOS и Linux `-W` нет, и строка прежняя.
  - Ожидаемые пути идут через помощник `printed()`: `cygpath -w`, где он есть, иначе путь без изменений. Для путей внутри JSON — `json_printed()` (обратная косая удваивается). Помощник `nat()` из среза 05a убран: при `T` вида `C:/…` он ничего не менял.
  - Fixture схемы 1 с `<HOME>/.claude/bin/` записан в написании ОС.
  - Два случая `tickets.root` в `profile.test.sh` идут через shell-stub `$P2` в `CLAUDE_PROFILE_BIN`. На Windows Node не запускает shell-скрипт, и `ticket` молча переходил к `<git top-level>/.scratch`. Эти два случая остались как есть, но только на macOS и Linux; на Windows — строка `skip`. Добавлены два таких же случая со stub-ом на Node (`#!/usr/bin/env node`, запускает `$PROFILE` с HOME песочницы), они идут везде (`da0c3a1`).
- **Ревью** — subagent этой Session, линза «корректность», macOS и Linux в первую очередь. Строки ожидаемых значений на macOS и Linux не изменились. Найдено и исправлено в `da0c3a1`:
  - medium: первая версия заменила shell-stub прямым запуском `bin/ticket` с HOME песочницы. Так пропали проверка ветки «profile — не скрипт Node» (`bin/ticket:143`) и разделение окружений: на main `ticket` шёл с настоящим HOME, и только `profile` видел HOME песочницы. Мутант «`ticket` сам раскрывает `~/` в `workflow.folder` через `os.homedir()`»: на первой версии зелёный, на `da0c3a1` красный. Мутант ветки Node (`bin/ticket:144`) — 2 случая красные. Мутант ветки shell-скрипта (`:143`) на Windows проверить нельзя: её случаи там пропущены;
  - low: `CLAUDE_PROFILE_BIN` теперь задан явно во всех четырёх запусках `ticket`;
  - low: `json_printed()` полагался на снятие кавычек в замене `${//}`, которого нет в bash 3.2 (macOS `/bin/bash`); теперь `sed`. Проверено под `shopt -s compat42`: прежний вариант давал `C:"\"a"\"b`, новый — `C:\\a\\b`.
  - Symlink в `tickets-root.test.sh` создаётся с `MSYS=winsymlinks:nativestrict`: без прав на symlink Git Bash раньше молча копировал каталог, и случай «--root через symlink» проверял не symlink. Теперь он падает явно. macOS переменную не читает.

| Shell test, Git Bash | main `9337e77` | ветка |
|---|---|---|
| `profile.test.sh` | exit 1, 92 ok / 79 FAIL | exit 0, 171 ok / 0 FAIL |
| `tickets-root.test.sh` | exit 1, 12 ok / 14 FAIL | exit 0, 26 ok / 0 FAIL |
| `silent-mode.test.sh` (не менялся) | exit 1, 85 ok / 3 FAIL | то же |

- Сверка по именам: ни один случай, проходящий на main, на ветке не падает.
- **Мутанты** (скрипт портится, прогон, возврат): без префикса `<HOME>/.claude/bin/` в `LEGACY_BIN` (`bin/profile`) — 2 случая красные; без строки относительного корня Silent в `bin/ticket` — 1; `bin/ticket` игнорирует `tickets.root` — 9 случаев `tickets-root`; `--root` от `launchDir()` вместо `process.cwd()` — случай с symlink красный. Один мутант (абсолютный `tickets.root` игнорируется) выжил как эквивалентный: `path.resolve(top, абсолютный)` и так даёт абсолютный путь.
- **3 случая `silent-mode` — дефект hook-а, не fixture.** `harness/hooks/worktree-create.sh` (не зарегистрирован, оставлен для ticket-а 24 worfy-harness):
  - строка 65, `[ "${root#/}" != "$root" ]`, считает абсолютным только путь от `/`; `worktree.root` вида `C:\…`, который `profile` печатает на Windows, считается относительным — падает «WorktreeCreate outside», а за ним «hook tree» (дерево ложится внутрь репозитория);
  - строки 56 и 89 (`pwd -P`) печатают путь POSIX `/tmp/…/.claude/worktrees/<имя>`, которым родной Claude Code на Windows не воспользуется — падает «WorktreeCreate default».
  - Test не менялся: путь `/tmp/…` в fixture-е сделал бы его зелёным и спрятал дефект.
- **Замечено, вне среза:** `bin/ticket:143-160` — на Windows `CLAUDE_PROFILE_BIN`, который не запускается (shell-скрипт), даёт ENOENT, и `ticket` молча берёт `<git top-level>/.scratch` даже в Silent-проекте (переменную ставят только test-ы); `bin/profile:271-276` — пути скриптов Harness на Windows с разными разделителями (`C:\…\harness\bin/ticket`); `bin/profile:277` — путь схемы 1 `<HOME>/.claude/bin/` с прямыми косыми (`C:/…`) на Windows не распознаётся, только с обратными.
- Части после #428 (worfy-pipeline 02): `ticket-mark.test.sh`, проверки `workflow.pipeline` в `profile.test.sh`, проверки держателя e2e lock в `wave-gate.test.sh` (POSIX `repo` в `state.json`) — отдельным срезом, когда #428 будет в main.

**Не проверено:** всё на macOS и Linux, в том числе случаи с shell-stub-ом (на Windows пропущены) и `json_printed()` на настоящем bash 3.2. То, что строки там не изменились, выведено из кода: нет `cygpath`, `pwd -W` не срабатывает и уступает `pwd -P`, `MSYS` не читается, удвоение обратных косых в строке без них ничего не меняет.

### Срез 05d — stand-in `gh` на Windows и fixture-ы test-ов #428/#433

Session на Windows-ПК, 2026-10-17. Windows 11 Pro 10.0.26200, Git Bash. Ветка `worfy-windows/05-gh-stand-in`, начата от main `4dbae79`, до push перенесена на main `b2ae59d` (там уже #433 — batch CI, worfy-throughput 08, и #437 — срез 05c). **На macOS и Linux с ПК ничего не запускалось.**

- **Зачем.** В вердикте по #433 нашлось: на Windows `wave-gate.test.sh` доходил до **настоящего `gh`**. Stub `gh` — файл `#!/bin/sh` без расширения; Node на Windows его не запускает, и поиск по PATH находил `gh.exe`. В одном прогоне настоящий `gh` выполнил `gh workflow run ci.yml --ref main -f job=check` и отказал только потому, что у временного репозитория нет remote на GitHub. GitHub Actions не запускались.
- **Stand-in и guard — первым commit-ом (`0967c27`).**
  - `harness/bin/tests/gh-stand-in.sh` (новый): на Windows test пишет stand-in на Node (`.mjs`, который запускает тот же bash-stub) и указывает на него переменную скрипта. Guard останавливает test до первой проверки, если `gh` для bash — не stub, а для node — не stub и не stand-in; `GH_CONFIG_DIR` пустой, токены сняты.
  - `harness/bin/wave-gate`: помощник `program(override, usual)` — override на `.mjs` идёт через `process.execPath`, любой другой как есть. `WAVE_GATE_GH` — для каждого вызова `gh` (`gh pr merge`, `gh run list` из #433); `WAVE_GATE_GATE` принимает и `.mjs`. Команда batch CI из профиля (`ci_batch_run`) идёт через shell, поэтому при `WAVE_GATE_GH` ведущий `gh` в ней заменяется stand-in-ом (`ghShell`, `962f82b`). Без переменных всё как на main.
  - `harness/bin/ticket`: `TICKET_GH` — программа вместо `gh` из PATH для `ticket mark` (commit status через `gh api`), через уже существующий `execScriptSync`. Без переменной — `gh` из PATH, как раньше.
  - `ticket-mark.test.sh` и `skill-blocks.test.sh` тоже получили stand-in и guard: когда fixture-ы `ticket-mark` заработали, `ticket mark` в режиме Full тоже дошёл бы до настоящего `gh`.
- **Fixture-ы в написании Node** (`b64b845`, `2c27e27`, `fbcab7e`, `857783e`, `962f82b`, `92f597d`): `repo` в `state.json` и файлах batch CI `wave-gate`, `match` в реестре и папка Workflow в `ticket-mark`, путь в сообщении `workflow.pipeline` в `profile.test.sh` (через `printed()` из 05c); stub gate — через stand-in на Node; pid держателя e2e lock на Windows — pid, который записал stand-in.
- **`real-home.sh` (`1e7c348`).** Папки, куда пишут живые Session-ы (`worktree-sessions/`, `gate/state/`, `profiles/*/state/`), сверялись регулярными выражениями только с `/`, а Node на Windows даёт `\` — любая другая Session на ПК давала «the real home changed». Теперь путь сверяется в виде с `/`; при несовпадении `ticket-mark`, `wave-gate` и `profile` печатают до 10 различающихся строк. На macOS и Linux ничего не меняется.
- **Ревью** — subagent этой Session, линзы «безопасность» (Windows первым) и «корректность на macOS/Linux»: high и medium нет. Исправлено в `f6481e5`:
  - low: проверка команды CI на Windows смотрела только на начало (`gh …`), а заменяется только ведущий `gh` — `gh a && gh b` дошёл бы вторым `gh` до настоящего. Теперь отказ для `&&`, `|`, `;`, перевода строки, `` ` ``, `$(` и второго слова `gh`;
  - low: проверка блока set из SKILL.md ловила только `"gh"` в двойных кавычках; теперь любое слово `gh`, кроме stand-in-а;
  - low (без правки): commit-ы `0967c27`…`857783e` по отдельности не закрывают вызовы `gh` из #433 — их закрывает `962f82b`. Bisect `wave-gate.test.sh` на Windows по этому отрезку не делать.
  - **Нарушение при ревью:** проба reviewer-а 14 раз запустила настоящий `gh.exe` (в бриф-е разрешён только `--version`): каждый раз — только справка `gh run`, в GitHub API ничего не ушло.

| Shell test, Git Bash | main `b2ae59d` | ветка `1e7c348` |
|---|---|---|
| `wave-gate.test.sh` | exit 1, 30 ok / 120 FAIL | exit 1, 120 ok / 30 FAIL |
| `ticket-mark.test.sh` | exit 1, 23 / 18 | exit 1, 40 / 1 |
| `profile.test.sh` | exit 1, 208 / 2 | exit 0, 210 / 0 |
| `skill-blocks.test.sh` | exit 1, 5 / 40 | exit 1, 5 / 40 |

- Сверка по именам: ни один случай, проходящий на main, на ветке не падает. Все 19 случаев batch CI («batch ci: …», «pr ci», «ci: unknown mode», «merge refused») и проверка блока batch CI в bash на Windows проходят.
- Ни одного процесса `gh.exe` за прогоны с настоящим `gh` в PATH (опрос каждые 200 мс).
- **Мутанты:** guard — поддельный `gh.exe` первым в PATH, `WAVE_GATE_GH` снят, `TICKET_GH` снят: каждый раз exit 1 со строкой REFUSED до первой проверки; держатель pid = `process.ppid` — «e2e lock holder» красный; без `--squash` — «green set: gh pr merge --squash» красный; `context=x<kind>` в `ticket` — 4 случая «full:» красные; без `--ref` в dispatch — 2 случая batch CI красные.
- **Осталось падать (причины вне среза):** `wave-gate` 30 — 4 случая сигналов (Node на Windows не получает сигнал POSIX), 17 — stub-ы `ioreg`/`caffeinate` без расширения (`wave-gate.test.sh:100-117`), 2 — `ln -s` в Git Bash копирует `git.exe` без его DLL, 7 — нет zsh; `ticket-mark` 1 («full: no gh») — тот же `git.exe`; `skill-blocks` 40 — пути Silent fixture-а («no epic pay-flow») и CR в выводе, как на main.
- Тот же класс stub-ов без расширения, которые запускает скрипт на Node, есть ещё в `project-connect.test.sh` (`qmd`), `qmd-collections.test.sh`, `qmd.test.sh`, `decision-log.test.sh`, `harness-home.test.sh`, `silent-mode.test.sh` — запускает ли их Node, не проверено.
- `real-home`: проверка проходит во всех трёх test-ах. Один прогон `wave-gate` упал на 4 строках `~/.claude/skills/synced/…` — синхронизация skill-ов приложения раз в 10 минут, не test; `skills/synced` в список не добавлен.
- **К срезу 05b после ревью Mac:** gate full на Mac падал на `snapping.spec.ts:175` (1 из 30): stand-in на Node отвечал раньше нажатия, и панель «No epics yet» лежала над Card. Ответ по умолчанию в `snapping.spec.ts` — одна Epic без Ticket-ов (`c999115`, PR #434).

**Не проверено:** всё на macOS и Linux; guard-ы раунда ревью проверены вызовом функций на образцах строк, не мутантом полного test-а.

### Срез 05d, раунд 2 — ревью Mac (PR #444)

Ревью первого раунда на Mac (глубина high: корректность на macOS, безопасность, мутанты): корректность и безопасность — ничего; без переменных скрипты на macOS байт в байт как main, ни один test не дошёл до настоящего `gh`. Изменения запрошены по одному medium; low-ы исправлены в том же раунде (`9341072`, `8e3e5ed`, `88aed26`, `2bb8e23`).

- **medium: у guard-а не было своего test-а** (`gh-stand-in.sh:43`, `:66`; мутанты «принять любой `gh` из PATH shell-а» и «принять любой `gh`, который запустит node» выживали). Новый `harness/bin/tests/gh-stand-in.test.sh` идёт на любой ОС: поддельный `gh` первым в PATH — exit 1, строка REFUSED с его путём, файл-метка не записан; неверный `WAVE_GATE_GH`; неверный `TICKET_GH`; допустимые настройки; без переменной; guard снимает учётные данные. 12 ok / 0 FAIL.
- **low: переопределения проверялись только на Windows** (6 мутантов выживали на macOS). Новый `harness/bin/tests/gh-override.test.sh` со stub-ами, которые пишут свои аргументы в журнал: `.mjs` идёт через node (dispatch и поиск run), `gh` после пробелов в начале тоже заменяется, обычная программа запускается как есть, `ghx …`/`xgh …` не трогаются. 7 ok / 0 FAIL; случай «без переменной» (stub с именем `gh` первым в PATH под guard-ом) на Windows пропущен — Node не запускает shell-stub. `TICKET_GH` на `.mjs` для `ticket mark` в режиме Full — в `ticket-mark.test.sh` на любой ОС.
- **low: нет test-а снимка real home.** Новый `harness/bin/tests/real-home.test.sh`: запись в изменчивые папки без метки и с меткой (пути с `/` и `\`), запись в остальные части, предел 10 строк у `real_home_diff`. 14 ok / 0 FAIL.
- **low: `TICKET_GH` на несуществующий файл давал «gh is not in PATH».** Теперь «TICKET_GH names a program that is not there: <путь>»; без `TICKET_GH` текст прежний. Test в `ticket-mark.test.sh`.
- **low: `~/.claude/skills/synced/` — изменчивая папка** (`real-home.sh`): Claude Code переписывает её примерно раз в 10 минут, и «real home unchanged» мигал и на Mac.
- **Мутанты на ПК, все 8 красные:** guard без проверки shell (2 FAIL) и без проверки node (3); `.mjs` как обычная программа (3); обычная программа через node (2); без замены в `ghShell` (5); регулярное выражение без границы слова (1); `ticket` без `TICKET_GH` (10 в `ticket-mark`); голый `gh` в поиске run (2).

| Shell test, Git Bash | main `b2ae59d` | ветка `2bb8e23` |
|---|---|---|
| `gh-stand-in.test.sh` (новый) | — | exit 0, 12 ok / 0 FAIL |
| `gh-override.test.sh` (новый) | — | exit 0, 7 ok / 0 FAIL, 1 skip |
| `real-home.test.sh` (новый) | — | exit 0, 14 ok / 0 FAIL |
| `ticket-mark.test.sh` | exit 1, 23 / 18 | exit 1, 42 / 1 |
| `wave-gate.test.sh` | exit 1, 30 / 120 | exit 1, 120 / 30 |
| `profile.test.sh` | exit 1, 208 / 2 | exit 0, 210 / 0 |

- Сверка по именам: ни один случай, проходящий на main, на ветке не падает. Оставшиеся падения — те же, что в первом раунде (сигналы, `ioreg`/`caffeinate`, `git.exe` в минимальном PATH, zsh).
- `test/contract/harness-scripts.test.ts` находит три новых файла, и они проходят. На Windows `profile`, `silent-mode` и `wave-gate` не укладываются в предел 120 с на файл (`harness-scripts.test.ts:22`) — вопрос скорости ПК; `profile` отдельно проходит.
- Ни один test и ни одна проба этого раунда не запускали настоящий `gh`.

**Не проверено:** всё на macOS и Linux, в том числе случаи «без переменной» в `gh-stand-in.test.sh` и `gh-override.test.sh` (на ПК проверены только чтением).
