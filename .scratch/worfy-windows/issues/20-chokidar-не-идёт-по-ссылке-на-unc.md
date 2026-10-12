# 20 — Ссылка на `\\host\share\…` в Tickets root и в папке Card-ов: watcher-ы chokidar не обращаются по ней; та же проверка в корзине, MCP-сервере холста и выборе папки

Type: task
Status: open
Blocked by: 10
Source: ревью PR #233 (Ticket [19](19-leadstoremote-в-docs-cards-и-workflow.md) — проверка `leadsToRemote` в HANDOFF, ADR, Card-ах и Ticket-ах) на Mac, 2026-10-10; «Итог» Ticket-а 19, пункт «Другие места того же класса». Делает Session на Windows-ПК после Ticket-а 10 (Terminal на PowerShell); проверяет и вливает Session на Mac, как у Ticket-ов 18 и 19.

## Что происходит

На Windows вызов по symlink-у на `\\host\share\…` (`realpath`, `stat`, `readdir`, `fs.watch`)
подключает систему к хосту по SMB и может отдать ему NTLM-хэш пользователя. Ticket 18 (файл по
ссылке из markdown и файл Card) и Ticket 19 закрыли это для путей, которые worfy разрешает и читает
сам: `walkLinks` и `leadsToRemote` (`src/main/remote-links.ts:146`, `:208`) смотрят путь только
через `lstat` и `readlink`. Открыты два watcher-а chokidar: они стартуют при открытии Project-а, без
щелчка. Строки — по main `0f692e5`, сверить при claim.

- **Watcher Tickets root** (`src/main/workflow/watch.ts:212`): `watch(layout.ticketsRoot, …)` идёт
  до первого чтения (`:163`). Tickets root (папка Ticket-ов) — `<repo>/.scratch`
  (`src/main/workflow/folder.ts:98`), содержимое репозитория. Вызов: `useWorkflow` в renderer-е → IPC
  `workflow.open` (`src/main/ipc/workflow.ts:31`) → `WorkflowWatcher.start` (`watch.ts:305`).
- **Watcher папки Card-ов** (`src/main/cards/store.ts:203`): `CardStore.info()` запускает его
  (`:168`) раньше своей проверки ссылок (`:170`). Это папка данных worfy, git туда не пишет: риск ниже.
- **chokidar 5.0.0** зовёт `realpath`, `stat`, `readdir` и `fs.watch` по каждой ссылке в папке.
  `followSymlinks: false` этого не останавливает: `_handleSymlink` зовёт `realpath`
  (`chokidar/handler.js:421`). `ignored` — тоже: readdirp разрешает ссылку (`readdirp/index.js:266`,
  вызов на `:144`) раньше фильтров (`:147`, `:159`).
- **Недоступный host — watcher не стартует** (ПК, 2026-10-12: chokidar 5.0.0 в отдельном скрипте, в
  приложении не проверялось). `realpath` ссылки на `\\host\share\…` падает с `UNKNOWN` (errno -4094)
  через 1264 ms. chokidar шлёт `'error'`, а `'ready'` не приходит (ждали 15 s).
  `WorkflowWatcher.watch()` ждёт `Promise.all(ready)` (`watch.ts:226`) и не завершается. После ошибки watch работает
  наполовину: изменение существующего Ticket-а он видит, новый Ticket в той же папке — нет.
  Сломанная ссылка на локальный диск даёт ENOENT, и `'ready'` приходит за 9–10 ms.
- **После PR #241** (влит 2026-10-12, main `0f692e5`) у этого watcher-а в `ignored` стоит функция
  `ticketsIgnored`: наблюдаются только папки Epic-ов, их `spec.md`, `map.md`, `issues` и
  `issues/*.md`. Опции `depth` нет: с ней терялись Ticket-ы Tickets root, созданного после старта.
  Ссылку на наблюдаемых уровнях chokidar разрешает по-прежнему. Слушатель `'error'` пишет ошибку в
  лог, но `watch()` при ней не завершает.

Ещё три места того же класса без проверки, старше Ticket-ов 18 и 19:

- `src/main/layout/trash.ts:145` и `:85` — `existsSync` папки Card и `readFileSync` её `index.html`
  (`readCardTitle`) по ссылке, когда Card Node уходит в корзину.
- `src/main/mcp/canvas-server.ts:131` — `existsSync(join(context.cardsDir, id))`, когда MCP-сервер
  холста выбирает id новой Card.
- `src/main/projects/browse.ts:79` и `:91` — выбор папки зовёт `stat` для каждой дочерней ссылки и
  `lstat` для `<папка>\.git`. Достаточно зайти в клонированный репозиторий со ссылкой на share в корне.

Когда это возможно. Git for Windows по умолчанию выписывает symlink текстовым файлом
(`core.symlinks=false`). Настоящая ссылка появляется, если пользователь включил symlink-и в Git и
Developer Mode в Windows (или работает от администратора). Это реже, чем «любой клонированный
репозиторий», но класс тот же, что в Ticket-ах 18 и 19, и щелчка не нужно. Правило — только для
Windows (`paths.sep === '\\'`). Junction с сетевой целью Windows не проходит (Ticket 19, «Итог»).

## Что делаем

Переиспользуем `walkLinks` и `leadsToRemote`. Способ для chokidar выбирает исполнитель, выбор — в «Итог».

1. **До старта watcher-а** — `walkLinks` по пути самой папки (Tickets root, папка Card-ов). Ответ
   `'remote'` или `'unchecked'` — watcher на ней не стартует, Project открывается.
2. **Ниже папки chokidar не разрешает ссылки.** Варианты:
   - (а) перечислить цели самим: корень, папки Epic-ов и `issues`, папки Card. Каждая проверена
     через `lstat` и `walkLinks`; ссылка на share и непроверенная ссылка пропускаются. chokidar
     получает явные пути без ссылок и `depth: 0`;
   - (б) на Windows заменить chokidar у этих двух watcher-ов на `fs.watch` проверенных папок;
   - (в) patch или обёртка, с которой chokidar не зовёт `realpath` и `stat` по ссылке.
3. **Три соседних места** — `leadsToRemote` до вызова по ссылке. `trash.ts`: заголовок — `null`;
   переносить ли саму ссылку в корзину — решить и записать в «Итог». `canvas-server.ts`: id
   считается занятым. `browse.ts`: такой ссылки в списке нет.
4. В test-ах файловая система подменяется, как в Ticket-ах 18 и 19 (`RemoteLinkOptions`); где шва
   для подмены нет — добавить его параметром.
5. **Остатки второго круга ревью PR #233** (все low; подробности — комментарий
   [6124582630](https://github.com/IDSAD-XL/worfy/pull/233#issuecomment-6124582630)):
   - `CardStore.info` (`src/main/cards/store.ts:165-166`): `cardDir` раньше `cardsDir`. Тогда
     неверный id Card у Project-а не из списка снова даёт ошибку про id, как на main.
     Комментарий «once» поправить.
   - `enrichSnapshot` (`src/main/workflow/reader.ts:227`): добавить в разрешённые папки настоящий
     путь корня Project-а, как делает `readDocs`. Сейчас Project, корень которого сам ссылка на
     share, молча теряет названия Epic-ов и списки «Где в коде».
   - `src/main/remote-links.ts:87-91`: `..` в цели вида `\\?\UNC\host\share\..\..\…`.
     `path.win32` его сворачивает, Windows — нет. Отказывать такой цели или проверить на ПК, что
     Windows по ней не идёт. Комментарий в шапке (`:11-14`) поправить.
   - Четыре test-а на выживших мутантов: N36, N06, N27, N32.
   - `test/contract/card-protocol.test.ts` вырос до 1031 строки, gate предупреждает о файле
     длиннее 1000 строк. Вынести случаи со ссылками в отдельный файл.
6. **Остатки ревью PR #241** (low, есть и на main; комментарий
   [6125360657](https://github.com/IDSAD-XL/worfy/pull/241#issuecomment-6125360657)):
   - файлы прямо под Tickets root остаются под наблюдением: 2 000 файлов дают 2 001 путь и
     столько же открытых файлов. `epic-status` их не читает;
   - Tickets root, удалённый и созданный заново (`git checkout` ветки без `.scratch` и обратно),
     после этого обычно не наблюдается.

## Готово, когда

- [ ] Watcher Tickets root, `path.win32`, подменённая файловая система, счётчик на каждом вызове fs
      (и на вызовах chokidar). Ссылка на `\\evil\share\…` по очереди на каждом уровне — сам Tickets
      root, папка Epic-а, `issues`, файл Ticket-а, `spec.md`: ни одного `realpath`, `stat`,
      `readdir` и `fs.watch` по пути через неё. Непроверенная ссылка (`'unchecked'`) — так же.
- [ ] Ссылка на недоступный `\\host\share\…` в наблюдаемой папке: `WorkflowWatcher.watch()`
      завершается, Project открывается, новый Ticket в той же папке появляется на холсте.
- [ ] Watcher папки Card-ов: то же для папки Card-ов, папки Card и файла внутри Card.
- [ ] Локальная ссылка работает как раньше: изменение файла за ней обновляет холст — и Ticket, и Card.
- [ ] macOS: поведение и список наблюдаемых путей (`getWatched()`) те же, что на main; с
      `path.posix` проверка не зовёт `lstat` ни разу.
- [ ] `trash.ts`, `canvas-server.ts`, `browse.ts`: ссылка на `\\evil\share\…` — отказ, как в «Что
      делаем», и ни одного `existsSync`, `readFileSync`, `stat`, `lstat` по пути через неё.
- [ ] Windows-ПК, настоящая ссылка на `\\worfy-no-such-host\share\…` (только `win32`, нужен
      Developer Mode; пропуск с причиной), по случаю на каждый watcher: вызовы Node под счётчиком
      такого пути не получают, старт не ждёт сеть.
- [ ] Остатки ревью PR #233 и PR #241 (пункты 5 и 6 в «Что делаем»): каждый сделан и закреплён
      test-ом, либо в «Итог» записано, почему нет.
- [ ] Время на ПК, репозиторий worfy: старт обоих watcher-ов не медленнее main; числа — в «Итог».
- [ ] Каждый новый test краснеет на мутанте, который убирает проверку в своём месте.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` на Windows-ПК — без новых падений относительно main;
      gate full на Mac зелёный (общий код: проверяет и вливает Session на Mac).

## Тесты

Сначала падающий test: watcher Tickets root, папка Epic-а — ссылка на `\\evil\share\e1`, «`realpath`
по ней не вызван». На main он красный: chokidar зовёт `realpath` ссылки (`handler.js:421`). В «Итог»
— как он падал. Test-ы с подменой идут на Mac, в Linux CI и на Windows; с настоящей ссылкой — на ПК.

## Где в коде

- `src/main/workflow/watch.ts`, `src/main/cards/store.ts`
- `src/main/layout/trash.ts`, `src/main/mcp/canvas-server.ts`, `src/main/projects/browse.ts`
- `src/main/remote-links.ts` (из Ticket-ов 18 и 19; правится, только если не хватает шва)
- `test/contract/workflow-reader.test.ts` (блок «workflow watcher»), `test/contract/card-protocol.test.ts`
- `test/contract/trash.test.ts`, `test/contract/canvas-tools.test.ts`, `test/contract/projects.test.ts`

## Вне скоупа

- Скрипт `epic-status` (bash) перечисляет `.scratch/*/` по ссылкам раньше `enrichSnapshot`
  (`src/main/workflow/reader.ts:269`). На Windows он сегодня не запускается. На Node его переносит
  Ticket 05 (скрипты `bin` Harness на Node): та же проверка нужна там.
- Гонка между обходом и стартом watcher-а (TOCTOU) — записанный долг, как в Ticket-ах 18 и 19.
- `DocsWatcher.watch` (`src/main/docs/watch.ts:228`, рекурсивный `fs.watch` корня Project-а): идёт
  ли он на Windows по ссылке-папке, не проверялось. Проверить на ПК и записать в «Итог».

## Риски

- `src/main/workflow/watch.ts` после PR #241 держит test-ы на `ticketsIgnored` и на Tickets root,
  созданный после старта (`test/contract/workflow-reader.test.ts`): они должны остаться зелёными.
- Вариант (а): папка Epic-а или `issues`, созданная после старта, должна попасть под наблюдение,
  иначе новый Epic не появится на холсте. Покрыть test-ом.
