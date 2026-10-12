# 24 — Node 24 обязателен для разработки на обеих машинах; README: версия Node и закрытие Terminal на Windows

Type: task
Status: claimed — 2026-10-12
Blocked by: 10
Source: решения владельца 2026-10-12: (1) Node 24 обязателен для разработки и на Mac, и на Windows-ПК; (2) закрытие Terminal Node на Windows завершает все процессы под его оболочкой — поведение остаётся, в README о нём заметка. Заметка описывает код PR #239 (Ticket [10](10-terminal-на-powershell.md) — Terminal на PowerShell, влит 2026-10-12); блокер отсюда. Делает агент-implementer на Mac. Установка Node 24 на ПК — шаг владельца.

## Что происходит

- **Что уже говорит «Node 24».** Файл `.nvmrc` — `24` (PR #242). CI ставит `node-version: 24`
  (`.github/workflows/ci.yml:33`, `:68`). Electron 44.5.1 (`package.json:54`) несёт Node 24.21.0.
- **Что не говорит.** В `package.json` поля `engines` нет (grep). README, раздел «Development on
  Windows» (`README.md:5`), пишет «Node.js 22 or newer» (`:10`). Раздела о разработке на macOS в
  README нет: заголовков три (`:1`, `:5`, `:17`). На ПК владельца стоит Node 22.13.0.
- **На одной машине два Node.** Test-ы всегда идут под Node из Electron: `pnpm test` — это
  `scripts/vitest-electron.mjs` (`package.json:16`; запуск — `scripts/vitest-electron.mjs:24-27`).
  Скрипты идут под системным Node: `pnpm icons` (`package.json:13`), `pnpm eval:harness` (`:21`),
  `postinstall` (`:22`). `pnpm install:stable` на main — shell-скрипт (`:20`); в PR #237 (Ticket 12 —
  сборка NSIS и Stable copy, не влит) это `node scripts/install-stable.mjs`.
- **Эта разница скрыла ошибку Ticket-а 23** (рекурсивное удаление идёт через junction — ссылку на
  папку в NTFS). Test падал под Node 24 из Electron. Сам скрипт под Node 22 вёл себя иначе.
- **Что pnpm делает с `engines`.** Версия pnpm — 11.22.0 (`package.json:8`). Репозиторий об `engines`
  ничего не настраивает: в `pnpm-workspace.yaml` только `allowBuilds` (`:5-9`), файла `.npmrc` нет.
  Остановит ли pnpm 11 установку под Node ниже, чем в `engines`, — не проверялось.
- **Terminal.** Закрытие Terminal Node на Windows завершает каждый процесс под его оболочкой, в том
  числе оконные программы, без запроса на закрытие. Владелец решил это оставить: на macOS так же
  завершаются программа на переднем плане и фоновые job-ы оболочки. Код влит с PR #239 (main `f073006`).

## Что делаем

1. **`engines.node: ">=24"`** в `package.json`.
2. **Проверить на деле**, что делает `pnpm install` под Node 22: останавливается, предупреждает или
   молчит. Ticket выбирает между остановкой и предупреждением; рекомендация — остановка. Если pnpm
   сам не останавливает, способ выбирает исполнитель: настройка pnpm в `pnpm-workspace.yaml` или
   проверка версии в `scripts/postinstall.mjs`. Выбор и причина — в «Итог».
3. **README: Node 24 для обеих систем.** Строка `README.md:10` меняется. Для macOS — новая строка
   или короткий раздел: сейчас его нет. Ставит ли `winget install OpenJS.NodeJS.LTS` из той же
   строки именно Node 24 — не проверялось; проверить и поправить команду.
4. **README: заметка о Terminal на Windows:** что завершается при закрытии Terminal Node и что
   запроса на закрытие нет. Текст сверить с кодом, который влит с PR #239.
5. **Порядок с ПК** (предложено): merge — после слова владельца, что Node 24 на ПК стоит. Иначе
   `pnpm install` на ПК остановится.

## Готово, когда

- [x] Под Node 22 `pnpm install --frozen-lockfile` останавливается с ненулевым кодом (или
      предупреждает — как решено в пункте 2). В сообщении названа нужная версия. Вывод и код — в «Итог».
- [x] Под Node 24 `pnpm install --frozen-lockfile` — exit 0.
- [ ] CI на Linux зелёный; gate full на Mac зелёный.
      не проверено: CI идёт на PR, его результат — в PR; gate full запускает оркестратор перед мержем.
- [x] `grep -n "Node.js 22" README.md` — пусто (код 1). Строки README о Node 24 и о Terminal —
      цитатой в «Итог».

## Тесты

Сначала падающий contract test: `engines.node` в `package.json` есть, и его major совпадает с
`.nvmrc` и с `node-version` в `ci.yml`. На main он красный: поля нет. Образец test-а, который читает
`package.json`, — `test/contract/vitest-electron.test.ts:26-28`. Остановку `pnpm install` под Node 22
test не проверяет: в `pnpm test` и в CI Node один. Она проверяется вручную, вывод — в «Итог».

## Где в коде

- `package.json`, `README.md`, новый contract test
- `pnpm-workspace.yaml` или `scripts/postinstall.mjs` — если остановку приходится делать самим

## Вне скоупа

- Запуск скриптов под Node из Electron вместо системного.
- Поведение Terminal: Ticket его только описывает. Код — Ticket 10.

## Риски

- **Остановка ломает `pnpm install` на ПК**, пока там Node 22. Отсюда порядок в пункте 5.
- **Проверка в `postinstall`** идёт после загрузки зависимостей. Дойдёт ли pnpm до неё под Node 22 —
  не проверялось.
- **Системный Node 24 и Node 24.21.0 из Electron — разные сборки.** Одинаково ли они удаляют папку
  с junction (Ticket 23) — не проверялось.
- **Заметка о Terminal описывает поведение Ticket-а 10.** Изменится поведение — изменится текст.

## Итог

Сделано на Mac 2026-10-12, ветка `worfy-windows/24`. Мерж ждёт слова владельца, что Node 24 стоит
на Windows-ПК (пункт 5): после мержа `pnpm install` под Node 22 там остановится.

- **Что сделано.**
  - `package.json`: `"engines": { "node": ">=24" }`.
  - `pnpm-workspace.yaml`: `engineStrict: true` — это и есть остановка (выбор и причина ниже).
  - `README.md`: новый раздел «Development» (Node 24 для обеих машин и установка на macOS), строка
    о Node в «Development on Windows», подраздел «Closing a Terminal on Windows».
  - `test/contract/node-version.test.ts` — пять проверок: major в `engines.node` равен major в
    `.nvmrc`; каждый `node-version` в каждом workflow из `.github/workflows` называет тот же major,
    и в `ci.yml` он есть; `engineStrict: true` стоит в `pnpm-workspace.yaml`; Node из Electron,
    под которым идут test-ы, не старше `engines.node`; README называет для Node.js только этот major.
    На main файл красный: 4 из 4 первых проверок падали с «package.json has no engines.node».
    Каждая проверка краснеет на своём изменении (правка в своём дереве, возврат из копии):
    `>=22` в `engines` — 3 failed; `engineStrict: false` — 1 failed; «Node.js 22 or newer» в README —
    1 failed; `node-version: 22` в одном job-е `ci.yml` — 1 failed; `node-version: lts/*` — 1 failed;
    `"^24 || ^22"` в `engines` — 5 failed.

- **Пункт 2: что делает pnpm 11.22.0 под Node 22.13.0** (та же версия Node, что на ПК владельца).
  Node 22.13.0 — официальный архив `node-v22.13.0-darwin-arm64.tar.gz` с nodejs.org, sha256
  `bc1e374e…2023b7` совпал с `SHASUMS256.txt`; распакован во временную папку, в `PATH` только для
  одной команды. pnpm 11.22.0 поставлен тем же Node во временную папку (`npm install --prefix`).
  Запуски — на свежих клонах ветки (`git clone --local`), не в рабочем дереве.
  - **Только `engines.node: ">=24"`, без настроек pnpm — предупреждает и ставит всё, exit 0.**
    Первая строка вывода:
    `[WARN] Unsupported engine: wanted: {"node":">=24"} (current: {"node":"v22.13.0","pnpm":"11.22.0"})`.
    Дальше обычная установка: 695 пакетов, install-скрипты зависимостей, корневой `postinstall`
    (`electron-rebuild` пересобрал node-pty), `Done in 3.7s using pnpm v11.22.0`.
    Отсюда же ответ на риск о `postinstall`: под Node 22 pnpm до него доходит.
  - **С `engineStrict: true` — останавливается, exit 1, `node_modules` не создаётся.** Вывод целиком
    (клон коммита `ab3ed66f`):

    ```
    [ERR_PNPM_UNSUPPORTED_ENGINE] Unsupported environment (bad pnpm and/or Node.js version)

    Your Node version is incompatible with "/private/tmp/worfy-windows-24/impl/clone-final".

    Expected version: >=24
    Got: v22.13.0

    This is happening because the package's manifest has an engines.node field specified.
    To fix this issue, install the required Node version.
    ```

  - С той же настройкой под Node 22 в клоне, где `node_modules` уже стоит, `pnpm run postinstall
    --dry-run` и `pnpm exec node -v` тоже дали exit 1 с тем же сообщением: перед запуском скрипта
    pnpm сам проверяет зависимости. Прямой запуск `node scripts/postinstall.mjs --dry-run` под
    Node 22 настройка не останавливает — exit 0: pnpm в нём не участвует.
  - **Под Node 24.19.0** (системный Node на Mac), тот же клон `ab3ed66f`:
    `pnpm install --frozen-lockfile` — exit 0, 695 пакетов, `postinstall` пересобрал node-pty,
    `Done in 3.2s using pnpm v11.22.0`; строк с `WARN` и `Unsupported` в выводе нет.

- **Выбранный способ остановки — `engineStrict: true` в `pnpm-workspace.yaml`. Решено без
  владельца, подтвердить.** Причины: pnpm останавливается до установки, а не после неё; сообщение
  называет и нужную версию, и найденную; своего кода нет. Проверка в `scripts/postinstall.mjs`
  сработала бы после того, как все 695 пакетов уже поставлены и их install-скрипты отработали под
  Node 22, и её пропускает `pnpm install --ignore-scripts`.
  Цена выбора: `engineStrict` действует и на зависимости — pnpm откажется ставить пакет, чей
  собственный `engines` не принимает Node, под которым запущен pnpm. С нынешним lockfile под
  Node 24.19.0 таких пакетов нет (exit 0). Если после обновления зависимости установка остановится
  с `ERR_PNPM_UNSUPPORTED_ENGINE` и именем пакета — причина здесь.
  Ticket выбирал между остановкой и предупреждением; выбрана остановка, как рекомендовано.

- **Что остановка не задевает** (проверено чтением и запуском, что чем — названо):
  - CI: оба job-а ставят `node-version: 24` (`.github/workflows/ci.yml:33`, `:68`) — результат в PR.
  - Test-ы под Node из Electron: `scripts/vitest-electron.mjs` запускает vitest бинарём Electron,
    pnpm в этом запуске идёт под системным Node. Node в Electron 44.5.1 — 24.21.0
    (`ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron -p process.versions.node`); это проверяет test.
  - `pnpm install:stable` — `node scripts/install-stable.mjs`, он запускает `pnpm package`
    (`scripts/install-stable.mjs:186`) под тем же системным Node 24.
  - Harness: `harness/hooks/gate-resolve.mjs:118-131` читает из `pnpm-workspace.yaml` только список
    `packages:`; новая строка его не меняет. Других читателей `pnpm-workspace.yaml` и `engines` в
    `scripts/`, `harness/`, `test/` нет (grep). gate fast с новой настройкой — зелёный.
  - Сборка `.app`: в коде electron-builder (`node_modules/app-builder-lib/out`) слова `engines` нет
    (grep). не проверено запуском: `pnpm package` и `pnpm test:package` исполнитель не запускал —
    это gate full оркестратора.

- **README, пункт 3 — строки о Node 24** (`grep -n "Node.js 22" README.md` — пусто, код 1):
  - `README.md:7`: «Node.js 24 is required on both machines, the Mac and the Windows PC:
    `engines.node` of `package.json` is `>=24`, and `.nvmrc` and CI name 24. Under an older Node
    `pnpm install` stops before it installs anything, with `ERR_PNPM_UNSUPPORTED_ENGINE`, exit code 1,
    the version it expects and the one it got (`engineStrict` in `pnpm-workspace.yaml`). The tests
    always run under the Node of Electron, which is 24; the scripts (`pnpm icons`,
    `pnpm install:stable`, `postinstall`) run under the Node of the system: with an older one there,
    a script can behave differently from the test that covers it.»
  - `README.md:11` (macOS): «Node.js 24: with nvm, `nvm install` in the repository takes the version
    from `.nvmrc`; without nvm, the macOS installer (`.pkg`) of the newest 24.x from
    <https://nodejs.org/dist/latest-v24.x/>;»
  - `README.md:12`: «pnpm of the version in `packageManager` of `package.json`:
    `corepack enable pnpm`, or `npm install -g pnpm@<version>`.»
  - `README.md:21` (Windows): «Node.js 24 (`winget install OpenJS.NodeJS.LTS --version 24.20.0`).
    Without `--version` winget installs the newest LTS line, and that is 24 only until the next line
    becomes LTS, planned for 2026-10-28; `winget show OpenJS.NodeJS.LTS --versions` lists the 24.x
    versions the package has. `node --version` must then print `v24.` and a version after it;»

- **Команда winget: что проверено и по каким источникам. Решено без владельца, подтвердить.**
  не проверено запуском на Windows: ни `winget install`, ни `winget show` исполнитель на Mac не
  запускал; что команда делает с уже установленным Node 22, не проверено.
  - Сейчас `winget install OpenJS.NodeJS.LTS` ставит Node 24: в пакете `OpenJS.NodeJS.LTS` только
    версии 24.x, новейшая — 24.20.0 (каталог `manifests/o/OpenJS/NodeJS/LTS` репозитория
    `microsoft/winget-pkgs`, прочитан через GitHub API 2026-10-12; манифест 24.20.0 ссылается на
    `https://nodejs.org/dist/v24.20.0/node-v24.20.0-x64.msi`).
  - Но без `--version` команда перестанет ставить 24: по расписанию релизов Node.js
    (`schedule.json` репозитория `nodejs/Release`) Node 26 становится LTS 2026-10-28, а Node 24 с
    2026-10-20 уходит в maintenance. На 2026-10-12 по `https://nodejs.org/dist/index.json` LTS —
    24.21.0 (Krypton) и 22.23.3 (Jod), 26.11.1 — ещё не LTS.
  - Пакета с закреплённым major для 24 в winget нет: `OpenJS.NodeJS.22` и `OpenJS.NodeJS.23` есть,
    `OpenJS.NodeJS.24` — нет (GitHub API отвечает 404), версии 24.0.0–24.10.0 лежат в общем пакете
    `OpenJS.NodeJS`. Поэтому в README — `OpenJS.NodeJS.LTS` с `--version 24.20.0`.
  - Цена: закреплённая версия 24.20.0 устареет; новые 24.x показывает `winget show … --versions`,
    эта подсказка есть в той же строке README.
  - На macOS `nvm install` и `corepack enable pnpm` исполнитель не запускал (менять nvm и ставить
    что-либо глобально запрещено): на этом Mac Node 24.19.0 уже стоит через nvm, а `pnpm` —
    ссылка на `corepack/dist/pnpm.js` из Node 24.19.0. Файл `node-v24.21.0.pkg` в
    `https://nodejs.org/dist/latest-v24.x/` есть (`SHASUMS256.txt`).

- **README, пункт 4 — заметка о Terminal на Windows**, `README.md:28-34`, сверена с кодом PR #239
  (`f0730066`), не с пересказом:
  - `README.md:30`: «Closing a Terminal Node on Windows ends every process started under its shell,
    not only the shell. worfy first ends each process below the shell in the process tree
    (`Stop-Process -Force`), then closes the pseudo-console, which ends the shell and what is on its
    console (`src/main/terminal/pty.ts`). That includes programs with a window of their own that were
    started from the Terminal, an editor or a browser for example: they are ended at once and get no
    request to close, so what was not saved in them is lost. worfy does not ask before it closes a
    Terminal either.»
  - `README.md:32`: «The same happens when the Node leaves the Layout by any other route, when its
    Project is removed from worfy, when the last window or Linked machine that opened the Terminal
    goes away, and when worfy quits. A program worfy cannot end, an elevated one for example, stays,
    and its pid goes to the log. When the step that ends the processes below the shell fails or takes
    longer than 3 seconds, only the shell and what is on its console end.»
  - `README.md:34`: «On macOS closing a Terminal sends SIGHUP to the shell and its process group,
    and SIGKILL a second later when the shell has not exited by then: the program in the foreground
    and the jobs of the shell are ended too.»
  - Где это в коде: порядок закрытия — `endWindowsShell`, `src/main/terminal/pty.ts:856-870`
    (сначала `endDescendants`, затем `release` → `pty.kill()`, `:889`); обход дерева процессов от
    оболочки и `Stop-Process -InputObject $process -Force` — `descendantsScript`, `:253-298`
    (`:290`); запроса на закрытие программе в скрипте нет — только `Stop-Process -Force`; предел
    3 с — `DESCENDANTS_TIMEOUT_MS`, `:61`; программа, которую не удалось завершить, — в лог,
    `:321-323`; сбой шага — `catch` в `:861-863`, после него всё равно `release`. Вопроса
    пользователю нет: кнопка «Close terminal» сразу удаляет Node и зовёт `terminal.close`
    (`src/renderer/canvas/nodes/TerminalNode.tsx:219-224`, `:258`). Остальные пути закрытия —
    `src/main/ipc/terminal.ts:6-8` и `leave`, `src/main/terminal/pty.ts:790-797`. macOS —
    `pty.ts:830-838`, `KILL_GRACE_MS = 1000` (`:59`).
  - не проверено запуском: поведение на Windows описано по коду и по «Итог» Ticket-а 10, на
    Windows-ПК исполнитель ничего не запускал.

- **Проверки на Mac** (Node 24.19.0, pnpm 11.22.0): `pnpm lint` — 0; `pnpm typecheck` — 0;
  `pnpm test` — 0 (202 файла, 4197 passed, 33 skipped). Первый запуск `pnpm test` дал 1 failed:
  `test/contract/claude-home-registry.test.ts:122`, «no matching change yet» — ожидание события от
  наблюдателя за файлами не дождалось; этот файл отдельно — 0 (62 passed), второй полный запуск — 0.
  Файл с этим Ticket-ом не связан; в это время на машине шли e2e и gate других PR.

- **Риски Ticket-а после работы.**
  - «Остановка ломает `pnpm install` на ПК» — в силе, отсюда порядок мержа.
  - «Проверка в `postinstall`: дойдёт ли pnpm» — доходит (см. пункт 2), но способ не выбран.
  - «Системный Node 24 и Node 24.21.0 из Electron — разные сборки» — не проверялось и здесь:
    на Mac системный Node — 24.19.0, в Electron — 24.21.0.
