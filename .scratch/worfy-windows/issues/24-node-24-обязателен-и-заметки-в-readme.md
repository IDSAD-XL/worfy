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
    `scripts/`, `harness/`, `test/` нет (grep). gate fast с новой настройкой запускается и доходит
    до test-ов: lint и typecheck в нём прошли (его итог — в «Проверки на Mac»).
  - Сборка `.app`: в коде electron-builder (`node_modules/app-builder-lib/out`) слова `engines` нет
    (grep). не проверено запуском: `pnpm package` и `pnpm test:package` исполнитель не запускал —
    это gate full оркестратора.

- **README, пункт 3 — строки о Node 24** (`grep -n "Node.js 22" README.md` — пусто, код 1):
  Цитаты — текст после доработки по ревью (раздел «Доработка после ревью» ниже).
  - `README.md:7`: «Node.js 24 is required on both machines, the Mac and the Windows PC, and of that
    line 24.15 or newer. `engines.node` of `package.json` is `>=24`, and `.nvmrc` and CI name 24;
    four dependencies, jsdom among them, accept nothing in that line below 24.15. `engineStrict` in
    `pnpm-workspace.yaml` holds pnpm to both: under a Node that the package or one of these
    dependencies does not accept, `pnpm install` stops before it installs anything, with
    `ERR_PNPM_UNSUPPORTED_ENGINE`, exit code 1, the version it expects and the one it got. The tests
    always run under the Node of Electron, which is 24; the scripts (`pnpm icons`,
    `pnpm install:stable`, `postinstall`) run under the Node of the system: with an older one there,
    a script can behave differently from the test that covers it.»
  - `README.md:14`: «Then `pnpm install --frozen-lockfile`. `node --version` must print 24.15 or a
    newer version of the line 24: `v24.15.0`, `v24.21.0`.»
  - `README.md:11` (macOS): «Node.js 24: with nvm, `nvm install` in the repository takes the version
    from `.nvmrc`; without nvm, the macOS installer (`.pkg`) of the newest 24.x from
    <https://nodejs.org/dist/latest-v24.x/>;»
  - `README.md:12`: «pnpm of the version in `packageManager` of `package.json`:
    `corepack enable pnpm`, or `npm install -g pnpm@<version>`.»
  - `README.md:21` (Windows): «Node.js 24, 24.15 or newer of that line: the Windows installer
    (`.msi`) of the newest 24.x from <https://nodejs.org/dist/latest-v24.x/>, or
    `winget install OpenJS.NodeJS.LTS --version 24.20.0`. Without `--version` winget installs the
    newest LTS line, and that is 24 only until the next line becomes LTS, planned for 2026-10-28.
    After that date the winget command may stop finding 24.20.0: in November 2025 winget moved the
    older lines out of `OpenJS.NodeJS.LTS` into packages of their own (`OpenJS.NodeJS.22` and the
    like), and whether the 24.x versions follow once the next line is LTS is not known (there is no
    `OpenJS.NodeJS.24` today). The installer from nodejs.org does not depend on that.
    `node --version` must then print 24.15 or a newer version of the line 24;»

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
  - Цена: закреплённая версия 24.20.0 устареет, а после 2026-10-28 команда может перестать её
    находить (прогноз и запасной путь — в разделе «Доработка после ревью»).
  - На macOS `nvm install` и `corepack enable pnpm` исполнитель не запускал (менять nvm и ставить
    что-либо глобально запрещено): на этом Mac Node 24.19.0 уже стоит через nvm, а `pnpm` —
    ссылка на `corepack/dist/pnpm.js` из Node 24.19.0. Файл `node-v24.21.0.pkg` в
    `https://nodejs.org/dist/latest-v24.x/` есть (`SHASUMS256.txt`).

- **README, пункт 4 — заметка о Terminal на Windows**, `README.md:28-34`, сверена с кодом PR #239
  (`f0730066`), не с пересказом:
  - `README.md:30`: «Closing a Terminal Node on Windows ends every process that is below the shell in
    the process tree at that moment, not only the shell. worfy first ends each process below the
    shell in the process tree (`Stop-Process -Force`), then closes the pseudo-console, which ends the
    shell and what is on its console (`src/main/terminal/pty.ts`). That includes programs with a
    window of their own that were started from the Terminal, an editor or a browser for example: they
    are ended at once and get no request to close, so what was not saved in them is lost. worfy does
    not ask before it closes a Terminal either. The tree is walked from the shell down through
    parents that are still running: a program whose parent has already exited, one started through a
    launcher or `cmd /c start` for example, is not found and stays, unless it is on the console of
    the shell: closing the pseudo-console ends that one.»
  - `README.md:32`: «The same happens when the Node leaves the Layout by any other route, when its
    Project is removed from worfy, when the last window or Linked machine that opened the Terminal
    goes away, and when worfy quits. A program worfy cannot end, an elevated one for example, stays,
    and its pid goes to the log. When the step that ends the processes below the shell fails, or is
    stopped at its limit of 3 seconds, the processes it had not ended by then stay. When no process
    has the pid of the shell any more, or the one that has it was created later than the shell worfy
    started, worfy ends nothing below it. In each of these cases the pseudo-console is still closed,
    which ends the shell, when it is running, and what is on its console.»
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
  - **gate fast (`GATE_SCOPE=all`) — не зелёный: exit 2 оба раза**, строка
    `[gate] красно (fast): worfy/.:test (прошло: worfy/.:lint worfy/.:typecheck)`. В каждом запуске
    упал один test из 4230, и оба ждут события от наблюдателя за файлами:
    первый запуск — `test/contract/docs.test.ts` › «the HANDOFF Node › takes a hide for the user's
    once someone showed the Node while HANDOFF.md was gone» (`:328`, «expected 2 to be greater than 2»);
    второй — `test/contract/claude-home-registry.test.ts` › «watching the Claude home › reports
    registry changes and transcripts in a new worktree folder, not other Projects» (`:122`).
    Load average на Mac в это время — 7–8: шёл gate full соседнего PR с e2e. Третий раз gate не
    запускался (указание оркестратора: под этой нагрузкой не повторять больше одного раза).
    не проверено: зелёный gate fast на Mac; опора — CI на Linux (job `check` на PR — зелёный).

- **Риски Ticket-а после работы.**
  - «Остановка ломает `pnpm install` на ПК» — в силе, отсюда порядок мержа.
  - «Проверка в `postinstall`: дойдёт ли pnpm» — доходит (см. пункт 2), но способ не выбран.
  - «Системный Node 24 и Node 24.21.0 из Electron — разные сборки» — не проверялось и здесь:
    на Mac системный Node — 24.19.0, в Electron — 24.21.0.

### Доработка после ревью (2026-10-12, один коммит поверх `060a795`)

Ревью по двум линзам: одна находка med и три low в тексте README, шесть low в contract test-е.
`package.json` не менялся; в `pnpm-workspace.yaml` дописан только комментарий.

- **Команда winget после 2026-10-28 (med).** Перестанет ли она находить 24.20.0 — неизвестно;
  README так и говорит (текст поправлен во втором круге, см. ниже). Что известно из истории
  `microsoft/winget-pkgs` (GitHub API, только чтение): в ноябре 2025 старые линии разом убрали из
  пакета `OpenJS.NodeJS.LTS` в пакеты по major — 22.11.0 2025-11-03 («Remove OpenJS.NodeJS.LTS
  22.11.0 to OpenJS.NodeJS.22 22.11.0 (#309252)»), 20.18.0 2025-11-05 (#310118), 18.12.1 и 16.20.1
  2025-11-07 (#310633, #310743), 14.21.3 и 12.22.12 2025-11-08 (#310987, #311011), 10.24.1
  2025-11-09 (#311148). Это была разовая уборка, а не правило «через неделю после смены LTS»: до неё
  старые линии лежали в пакете годами — 20.18.0 добавлена 2024-10-03 и пережила в нём год после
  того, как 22 стал LTS (2024-10-29); 18.12.1 лежала с 2022-11-07. Пакета `OpenJS.NodeJS.24`
  сейчас нет (404). В README первым стоит путь без срока годности: установщик `.msi` из
  `https://nodejs.org/dist/latest-v24.x/` — в его `SHASUMS256.txt` сегодня есть
  `node-v24.21.0-x64.msi` и `node-v24.21.0-arm64.msi`. Фраза о `winget show … --versions` убрана.
  не проверено запуском на Windows: ни установщик `.msi`, ни команда winget.
- **Настоящий минимум — Node 24.15.0, а не «24».** Четыре пакета lockfile просят
  `^22.22.2 || ^24.15.0 || >=26.0.0`: `jsdom@30.1.1` (`pnpm-lock.yaml:2243`),
  `@asamuzakjp/css-color@7.1.3`, `@asamuzakjp/dom-selector@9.2.4`, `w3c-xmlserializer@6.0.0`.
  Под Node 24.14.1 (официальный архив darwin-arm64, sha256 сверен; свежий клон `060a795`)
  `pnpm install --frozen-lockfile` — exit 1, `node_modules` не создаётся:

  ```
  ✓ Lockfile passes supply-chain policies (verified 4d ago)
  Lockfile is up to date, resolution step is skipped
  [ERR_PNPM_UNSUPPORTED_ENGINE] Unsupported environment (bad pnpm and/or Node.js version)

  Your Node version is incompatible with "jsdom@30.1.1(@noble/hashes@2.4.0)".

  Expected version: ^22.22.2 || ^24.15.0 || >=26.0.0
  Got: v24.14.1

  This is happening because the package's manifest has an engines.node field specified.
  To fix this issue, install the required Node version.
  EXIT=1
  ```

  README называет 24.15 в строках `:7`, `:14` и `:21`; комментарий в `pnpm-workspace.yaml:15-16`
  называет причину.
  - **Решено без владельца, подтвердить:** `engines.node` оставлен `>=24`, как требует Ticket.
    Поднять ли его до `>=24.15.0`? Тогда под Node 24.0–24.14 остановка назовёт версию проекта, а не
    зависимость. Цена: contract test сейчас принимает только `>=<целое>` и потребует правки; минимум
    придётся менять при обновлении jsdom.
  - Node 25 проходит `>=24`, но его не принимают `vitest@5.0.3` (`^22.12.0 || ^24.0.0 || >=26.0.0`,
    `pnpm-lock.yaml:3243`) и те же четыре пакета: под Node 25 установка остановится на зависимости.
    Запуском не проверено.
- **Заметка о Terminal уточнена по коду.** Обход идёт от оболочки по живым родителям
  (`src/main/terminal/pty.ts:271-279`, `:302-303`): программа, чей родитель уже вышел, не находится
  и остаётся — фраза в `README.md:30`. При пределе 3 с helper снимается посреди цикла (`:315`), уже
  завершённые процессы завершены; исход `gone` (`:260`, `:866-868`) — под оболочкой не завершается
  ничего; в любом исходе идёт `release` (`:869`) — фразы в `README.md:32`.
- **Contract test, `test/contract/node-version.test.ts`** (24 проверки вместо 5; номера строк —
  по файлу после второй доработки):
  - `:55-68`, `:141-159` — версии Node в README ищутся в формах «Node.js 22», «Node 22 or newer»,
    «node 22.x», «Node.js v22», «Node.js LTS (22)», «Node.js 24 or 22» и с переносом строки перед
    числом; таблица форм — в самом test-е.
  - `:186-191` — `>=N` и major из `--version` в README сверяются с `engines.node`; `:137-138` —
    число из фразы «Node of Electron, which is N» сверяется с Node, под которым идёт test.
  - `:41-48`, `:98-99` — значений версии (`node-version` и `node-version-file`) в workflow должно
    быть столько же, сколько шагов `uses: actions/setup-node`; строки-комментарии не считаются.
  - `:33-34`, `:106-122` — ключ читается и в кавычках, и внутри `{ }`, и с пробелом перед двоеточием;
    `node-version-file` допустим только со значением `.nvmrc` (`:102`).
  - `:131-134` — без `process.versions.electron` test падает с сообщением «process.versions.electron
    is not set … run the tests with `pnpm test`». Выбран отказ, а не пропуск: пропуск скрыл бы, что
    test-ы перестали идти под Node из Electron, а именно это он и проверяет.
- **Мутанты** (по одному, файлы возвращены из копий; журналы с кодом выхода —
  `/tmp/worfy-windows-24/impl/mut2/`). Все красные, exit 1:
  - прежние шесть: `engines` `>=22` (3 failed); `engineStrict: false` (1); «Node.js 22 or newer» в
    README (1); `node-version: 22` в `ci.yml:68` (1); `node-version: lts/*` (1); `engines`
    `^24 || ^22` (5);
  - формы в README: «Node 22 or newer», «node 22.x», «Node.js v22», «Node.js LTS (22)»,
    «Node.js 24 or 22», перенос строки перед «22» — по 1 failed;
  - числа README: «Node of Electron, which is 22», «`>=22`», `--version 22.13.0` — по 1 failed;
  - workflow: удалена строка `node-version` в `ci.yml:68`; новый workflow с `setup-node` без
    версии — по 1 failed;
  - формы ключа со значением 22: `with: { node-version: 22, cache: pnpm }`, `"node-version": 22`,
    `node-version : 22` — по 1 failed; `node-version-file: package.json` — 1 failed;
    `node-version-file: .nvmrc` — зелёный, как и должен (exit 0, 24 passed);
  - запуск под обычным vitest (системный Node 24.19.0, не Electron) — exit 1, 1 failed, с
    сообщением о `process.versions.electron`.
- **Проверки после доработки.** `node scripts/vitest-electron.mjs test/contract/node-version.test.ts`
  — 0 (24 passed); `pnpm lint` — 0; `pnpm typecheck` — 0.
  **gate fast (`GATE_SCOPE=all`), один запуск — не зелёный: exit 2**, `[gate] красно (fast):
  worfy/.:test (прошло: worfy/.:lint worfy/.:typecheck)`, `Test Files 2 failed | 200 passed (202)`,
  `Tests 7 failed | 4209 passed | 33 skipped (4249)`. Gate печатает только последние 40 строк вывода.
  В них два падения, оба в `test/contract/docs.test.ts` и оба — ожидание события от наблюдателя за
  файлами: «a Silent Project (worfy-harness ticket 23) › follows edits in the Workflow folder and
  writes nothing there or in the repository» (`:386`, «expected 0 to be greater than 0») и конец
  блока с ожиданием в `:317` (имя test-а в эти строки не попало). Второй упавший файл и остальные
  пять test-ов в 40 строк не попали.
  не проверено: имя второго упавшего файла; зелёный gate fast на Mac. По указанию оркестратора
  gate не повторялся; опора — CI на Linux.

### Вторая доработка (2026-10-13, один коммит поверх `8a9fd9f`)

Повторное ревью обеих линз — VERIFIED; четыре места закрыты сразу.

- **`README.md:21` — довод о winget был однобоким.** Первая доработка писала «a year earlier winget
  moved the 22.x versions … within a week of such a change», будто перенос следует за сменой LTS.
  По истории `microsoft/winget-pkgs` это разовая уборка ноября 2025 всех старых линий сразу (даты и
  номера — в пункте «Команда winget» выше; проверены линии 10.x–22.x). Теперь в README: «in
  November 2025 winget moved the older lines out of `OpenJS.NodeJS.LTS` into packages of their own
  (`OpenJS.NodeJS.22` and the like), and whether the 24.x versions follow once the next line is LTS
  is not known (there is no `OpenJS.NodeJS.24` today). The installer from nodejs.org does not depend
  on that.»
- **`README.md:30` — оговорка о консоли оболочки.** Программа, чей родитель уже вышел, остаётся,
  только если она не на консоли оболочки: такую завершает закрытие псевдоконсоли
  (`src/main/terminal/pty.ts:849-852`). Добавлено: «…is not found and stays, unless it is on the
  console of the shell: closing the pseudo-console ends that one.»
- **`test/contract/node-version.test.ts:75`, `:82`, `:188-191` — `>=` и `--version` привязаны к
  словам о Node.** Нижняя граница считается, только если `>=` стоит в той же строке не дальше 60
  знаков после `engines.node` или «Node.js»; версия установки — только если `--version` стоит в той
  же команде после пакета `OpenJS.NodeJS…`. «Windows >= 10 is needed» и
  `winget install Git.Git --version 2.47.1` больше не дают ложный красный.
- **`:55-68` — Node.js отличается от Node холста.** Число считается версией, если в тексте
  «Node.js», либо если голое «Node» не стоит после «Terminal» или «Canvas» и число не меньше 10:
  у Node.js нет major ниже 10 с 2018 года, а столько Node-ов холста README не нумерует. Следующее
  число списка («24 or 22», «24, 22», «24/22») считается по той же границе; «and» список не
  продолжает: «Node.js 24 and 2 more tools» называет одну версию. Формы закреплены таблицами в
  самом test-е (`:141-178`); проверок стало 38.
- **Мутанты** (по одному, файлы возвращены из копий; журналы с кодом выхода —
  `/tmp/worfy-windows-24/impl/mut3/`):
  - все 22 прежних — как раньше: 21 красный (exit 1), `node-version-file: .nvmrc` зелёный;
  - README, который не о версии Node.js, теперь зелёный (exit 0, 38 passed): «Windows >= 10 is
    needed.»; `winget install Git.Git --version 2.47.1`; «Terminal Node 2 closes with Node 1.»;
    «Node.js 24 and 2 more tools.»;
  - настоящие по-прежнему красные (exit 1, по 1 failed): «`engines.node` … is `>=22`»;
    `winget install OpenJS.NodeJS.LTS --version 22.13.0`; шесть форм «Node 22»; и два новых
    контрольных — «Node.js >= 22 is needed.», «Node.js 24 or 22 and 2 more tools.».
- **Проверки.** `node scripts/vitest-electron.mjs test/contract/node-version.test.ts` — 0
  (38 passed); `pnpm lint` — 0; `pnpm typecheck` — 0.
  **gate fast (`GATE_SCOPE=all`), один запуск — не зелёный: exit 2**, `[gate] красно (fast):
  worfy/.:test (прошло: worfy/.:lint worfy/.:typecheck)`, `Test Files 3 failed | 199 passed (202)`,
  `Tests 7 failed | 4223 passed | 33 skipped (4263)`. В 40 строках вывода gate — два падения, оба в
  `test/contract/workflow-reader.test.ts`, оба ждут события от наблюдателя за файлами: «workflow
  watcher › re-reads only the branch whose ref moved and marks the newly claimed Ticket» и
  «workflow watcher › follows a Tickets root made after the start: the first Ticket, then an edit of
  it and a second Ticket» («no matching workflow delta within 5000 ms; got []»). Load average — 8.
  не проверено: имена двух других упавших файлов; зелёный gate fast на Mac. Gate не повторялся;
  опора — CI на Linux.

#### Долги (не чинились)

- [low] `test/contract/node-version.test.ts:34`, `:99`, `:102` (в ревью — `:34`, `:76`, `:79`:
  строки сдвинулись) — ложный красный на `node-version-file: ./.nvmrc`, на комментарии
  `# node-version: 24 below` в конце строки шага и на вызове reusable workflow с входом
  `node-version: 24`; обратный случай — строка `run: echo "node-version: 24"` покрывает шаг
  `setup-node` без версии. Правка на будущее: считать версию внутри блока `with:` своего шага.
- [low] `:63`, `:138` — зелёными остаются «NodeJS 22», «Node.js version 22», «Node.js: 22»,
  `node@22`, `nvm install 22`, «Electron's Node is 22», ссылки `latest-v22.x`, а после второй
  доработки и «Node.js 24 and 22» («and» список не продолжает); в workflow — локальный action
  `./.github/actions/setup-node` без версии и шаг `nvm install 22`.
- [low] `:75` — `>=` в одной строке с «Node.js» не дальше 60 знаков считается границей Node, даже
  если он о другом («Node.js 24 on Windows >= 10»): ложный красный.

- [low] `test/contract/node-version.test.ts:136` — версия Node из Electron сравнивается с
  `engines.node` только снизу: после перехода Electron на Node 26 эта проверка останется зелёной, а
  test-ы и скрипты окажутся на разных major. Фраза README «which is 24» тогда станет красной
  (`:137-138`), но о разнице major test не скажет. Нужна ли верхняя граница — решение владельца.
- [low] В журналах первого круга в `/tmp/worfy-windows-24/impl/` нет строк с кодами выхода (вывод
  совпадает дословно; коды подтверждены повтором reviewer-а и шагом install в CI). Журналы
  доработки пишут `EXIT=<код>` последней строкой.
- [low] Закреплённая в README версия winget (24.20.0) устареет: у строки `README.md:21` есть срок
  годности, ближайшая дата — 2026-10-28.
- [low] Минимум 24.15 в README и в комментарии `pnpm-workspace.yaml` с lockfile не сверяется:
  обновление jsdom может его сдвинуть, test этого не заметит.
