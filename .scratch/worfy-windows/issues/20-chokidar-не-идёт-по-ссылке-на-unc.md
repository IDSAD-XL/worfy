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

## Итог

Session на Windows-ПК, 2026-10-12 — 2026-10-13. Node на ПК: системный 22.13.0 на время замеров; с 02:08 2026-10-13 — 24.21.0 (поставил владелец), под ним шли проверки из раздела «Windows-ПК». `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/20` сделана поверх ветки Ticket-а 23 (PR #257): оба правят `trash.ts` и `canvas-server.ts`.

### Выбранный способ

**Вариант (б): на Windows оба watcher-а идут не через chokidar, а через `fs.watch`.** Новый модуль — `src/main/link-safe-watch.ts`; на остальных системах chokidar остался как был.

- **Почему не (а).** readdirp внутри chokidar зовёт `realpath` для каждой ссылки в папке, которую перечисляет, раньше любых фильтров. Достаточно одной ссылки на share в папке — и папку нельзя отдать chokidar. Тогда новый Ticket рядом со ссылкой не появился бы на холсте.
- **Что делает модуль.**
  - Один рекурсивный `fs.watch` на папку. Замер на ПК: в папке со ссылкой на `\\worfy-no-such-host\share\…` он стартует за 0,2–4 ms и сообщает об изменениях как обычно.
  - За ссылку такой watch не заходит — ни за symlink, ни за junction (тот же замер). Чтобы локальная ссылка работала как раньше, модуль сам перечисляет нужные папки через `readdir` с типами (по ссылке не идёт). Каждую ссылку проверяет `walkLinks`: `'remote'` и `'unchecked'` — пропуск; `'local'` — отдельный watch на настоящий путь цели.
  - Папка, которой ещё нет, ожидается на ближайшей существующей папке выше. Удалённая папка ожидается снова.
- **Правило только для Windows** (`sep === '\\'`). На macOS и Linux модуль не создаётся, `lstat` не зовётся.

### Что сделано

1. **Watcher Tickets root** (`src/main/workflow/watch.ts`): на Windows — `ticketsWatch()`. Сам Tickets root проверяется `walkLinks` до любого вызова; ответ не `'local'` — watcher не стартует, Project открывается, в лог идёт одна строка. Ссылки ищутся в корне, в папках Epic-ов и в `issues`. Разрешённые папки — корень Project-а как записан и его настоящий путь, плюс сам Tickets root.
2. **Watcher папки Card-ов** (`src/main/cards/store.ts`): то же. Ссылки ищутся среди Card-ов, в папке Card и в папках прямо внутри неё (`CARD_LINK_DEPTH = 2`). На Windows папка Card-ов больше не создаётся через `mkdirSync`: её появления watcher ждёт сам.
3. **Корзина** (`src/main/layout/trash.ts`): перед взглядом на папку Card и файл данных читаются ссылки на пути к их папке; сам взгляд — `lstat`. **Решение: папка Card, которая сама ссылка, уходит в корзину как ссылка** (`renameSync` по ней не идёт), возвращается ссылкой, `purge` снимает ссылку. Заголовок через ссылку на share не читается — `null`. Возврат Card в папку, которая стала ссылкой на share, — отказ с причиной.
4. **MCP-сервер холста** (`src/main/mcp/canvas-server.ts`): id занят, если по пути `<папка Card-ов>/<id>` что-то лежит по `lstat` — ссылка тоже, и по ней не идём. Если сама папка Card-ов ведёт на share, диск не спрашивается, `create_card` отвечает ошибкой инструмента с причиной, а папка при старте Session не создаётся.
5. **Выбор папки** (`src/main/projects/browse.ts`): ссылка читается до `stat`; ведущая на share или непроверяемая — в список не попадает, и `lstat` её `.git` не зовётся.
6. **Синхронный обход** в `src/main/remote-links.ts`: корзина и MCP-сервер ждать не могут. Алгоритм записан один раз — как шаги (generator); `walkLinks` и новый `walkLinksSync` отличаются только тем, как отвечают на шаг.

### Замеры на ПК

**`fs.watch` и ссылки** (скрипт `probe-t20-watch.cjs`, голый вызов; системный Node 22.13.0 и Node 24.21.0 из Electron — одинаково):

| Что | Результат |
|---|---|
| Создать symlink на `\\worfy-no-such-host\share\epic` | 0,5–0,7 ms |
| `readdir` с типами и `readlink` в папке с такой ссылкой | 0,1–0,2 ms |
| `fs.watch(папка, recursive)` с такой ссылкой внутри | вернулся за 0,2–4 ms; новый Ticket и новая папка Epic-а дают события |
| Файл за локальным symlink-ом, записан по настоящему пути и через ссылку | событий нет |
| Файл за junction, так же | событий нет |
| `fs.watch` на настоящий путь цели локальной ссылки | события есть |
| Наблюдаемая папка удалена | 37 304 события за 0,4 s, все с именем самой папки в виде `\\?\C:\…`; события `'error'` нет |

Последняя строка — причина, по которой модуль закрывает watch на первом же событии с абсолютным именем.

**Падающий первым test.** `test/contract/workflow-watch-links.test.ts`, случай «a symlink to an unreachable share in place of an Epic folder», запущен с `watch.ts` из main. chokidar пишет в лог `UNKNOWN: unknown error, realpath '…\.scratch\away'`, событие `ready` не приходит, `WorkflowWatcher.start` не завершается — test упал по timeout 30 s. С новым watcher-ом тот же test зелёный.

**Время старта** (проба под Node 24.21.0 из Electron, пять запусков подряд):

| Папка | chokidar, как на main | новый watcher |
|---|---|---|
| Tickets root этого клона: 9 папок, 192 Ticket-а | 1243 ms первый запуск, затем 123–141 ms; 220 путей под наблюдением | 5,1–6,5 ms; один handle |
| Папка из 30 Card-ов по три файла | 50–55 ms; 151 путь | 9,2–10,3 ms; один handle |

**`DocsWatcher`** (пункт «Вне скоупа»: идёт ли он по ссылке-папке). Настоящий `DocsWatcher` на корне Project-а с двумя symlink-ами на недоступный share: старт 9,5 ms, изменение `HANDOFF.md` замечено через 93 ms, ни один вызов `node:fs` не назвал путь ссылки. Он не идёт.

### Test-ы

- **Модель диска Windows** — `test/unit/windows-disk.ts`: папки, файлы и ссылки в памяти по правилам `path.win32`. Каждый вызов записывается; вызов, по которому Windows пошла бы на хост, попадает в `contacts`. Идёт на любой системе.
- **На модели** (любая система): `link-safe-watch.test.ts` 24, `tickets-watch.test.ts` 13, `cards-watch.test.ts` 15, `remote-guards.test.ts` 19. Ссылка на `\\evil\share\…` стоит по очереди на каждом уровне: сам Tickets root, папка Epic-а, `issues`, файл Ticket-а, `spec.md`, `map.md`; папка Card-ов, папка Card, файл в Card, папка в Card. Непроверяемая ссылка — так же.
- **Настоящие ссылки, только `win32`:** `workflow-watch-links.test.ts` 6, `cards-watch-links.test.ts` 4, `remote-guards-links.test.ts` 7, один случай в `canvas-tools.test.ts`. Все вызовы `node:fs` под счётчиком (`counted-fs.ts`), в том числе вызовы chokidar. Случаи с symlink-ом на share требуют Developer Mode; без него они пропускаются, и отдельный test называет причину. На этом ПК Developer Mode включён.
- **chokidar для сравнения** (только `win32`): он зовёт `realpath` по ссылке на share и не присылает `ready`. Test оставлен, чтобы заметить, если chokidar перестанет так делать.
- **Локальная ссылка работает как раньше:** junction на месте папки Epic-а и на месте папки Card — изменение за ним доходит до модели (настоящие папки); symlink на файл — на модели.

### Остатки ревью PR #233 (пункт 5)

- `CardStore.info`: id Card проверяется раньше Project-а; комментарий исправлен. Test есть.
- `enrichSnapshot`: настоящий путь корня Project-а добавлен в разрешённые папки, как у `readDocs`. Три test-а со ссылкой-корнем.
- `..` в цели с device-префиксом (`\\?\…`, `\\.\…`, `\??\…`): такая цель теперь отвергается как удалённая. На ПК не замерялось, идёт ли Windows по такой цели: нужен свой share. Комментарий в шапке исправлен.
- Четыре test-а на мутантов N36, N06, N27, N32 — написаны.
- `test/contract/card-protocol.test.ts`: 1031 строка стала 761; случаи со ссылками — в `card-links.test.ts` (338 строк). 89 test-ов те же по именам.

### Остатки ревью PR #241 (пункт 6)

- **Файлы прямо под Tickets root.** На Windows handle теперь один, сколько бы файлов там ни лежало; изменение такого файла по-прежнему вызывает одно чтение, которое ничего не меняет. Для chokidar `ticketsIgnored` пропускает файл прямо под корнем, когда chokidar передаёт его `stats`: test на настоящем chokidar — 20 файлов под корнем, под наблюдением только папки Epic-ов и их содержимое.
- **Tickets root, удалённый и созданный заново.** На Windows — закрыто новым watcher-ом, test на настоящих папках. **На macOS не сделано:** там остался chokidar, а проверить правку на ПК нельзя.

### Мутанты

По одному, свой runner на ПК (`mutants20.cjs`), test-ы под Node 24.21.0 из Electron: **54 из 55 красные.** Один выживший равнозначен: «настоящий путь корня спрашивается у Node всегда» — ответ тот же, меняется только лишний вызов. Гонялись до двух последних merge (ветка Ticket-а 23 третьего круга и main); эти файлы они не трогают.

### Windows-ПК: lint, typecheck, test

Всё ниже — на commit `7c5b3f8`: в ветке main `ddd53d7`, где уже влит PR #257 (Ticket 23). Системный Node 24.21.0, pnpm 11.22.0.

- **Merge с main.** Четыре конфликта: `trash.ts`, `canvas-server.ts`, `canvas-tools.test.ts`, `trash-junction.test.ts`. Все решены версией ветки: в main эти файлы совпадают с веткой Ticket-а 23 (`c81ab43`), а она в этой ветке уже была.
- `pnpm install --frozen-lockfile` — exit code 0. `pnpm lint` — exit code 0. `pnpm typecheck` — exit code 0.
- `pnpm test`, полный, под Node 24.21.0 из Electron 44.5.1:

| | main `ddd53d7` | ветка, commit `7c5b3f8` |
|---|---|---|
| exit code | 1 | 1 |
| test-ов | 4363 | 4463 |
| прошло | 3664 | 3763 |
| упало | 662 | 659 |
| пропущено | 37 | 41 |

- **По именам: один test упал на ветке и не упал на main** — `check-handoff.test.ts`, «passes a file of the right form…», «Test timed out in 5000ms». Ветка этот файл не трогает; отдельно он три раза подряд зелёный, 13 из 13.
- Четыре падают на main и не падают на ветке: по одному в `card-protocol` и `terminal`, два в `permission-card.test.tsx`. Последние три — нестабильные, ветка их не трогает.
- Папок `worfy-*` в `%TEMP%` за полный прогон: 195; main `ddd53d7` — 200. Чистка в test-ах — Ticket 26.
- Прошлые прогоны ветки, для сравнения: до merge main, на `c43cb6c` против main `3d16a41` — 650 упало из 4451 против 683 из 4300, новых падений по именам не было; под системным Node 22.13.0 против main `a995a59` — 655 из 4332 против 701 из 4198.

### Что ещё замечено

- **chokidar на Windows не видит Tickets root, созданный после старта.**
  - Замер: настоящий chokidar 5.0.0 с фильтром `ticketsIgnored`, папки `.scratch` при старте нет; после создания `.scratch\demo\issues\01-a.md` события `add` нет за 5 s. С фильтром main — то же. Значит, на main новый Project без `.scratch` на Windows не получал Ticket-ы до перезапуска.
  - **Вариант (б) это закрывает.** Test на настоящих папках — `workflow-watch-links.test.ts`, «follows a Tickets root made after the start, and one that is removed and made again»; на модели — блок «a root that is not there, or goes away» в `link-safe-watch.test.ts`.
  - На macOS chokidar остался; там этот случай держит прежний contract-test.
- **`DocsWatcher` и удалённый корень Project-а на Windows — поток событий и целое ядро CPU.**
  - Проба под Node 24.21.0 из Electron: настоящий `DocsWatcher` на папке, папка удалена. За 3 s — 261 206 событий (87 071 в секунду), все кроме одного с именем самой папки в виде `\\?\C:\…`. Процесс занял 2969 ms процессорного времени за эти 3 s — 99 % одного ядра. События `'error'` нет. Таймеры при этом шли (29 срабатываний из 30). После `close()` событий нет.
  - `DocsWatcher` отбрасывает такие события по имени, но watch не закрывает. В этот Ticket не входит; заведён Ticket 27.
- **`test/unit/shell-resolve.test.ts` на чистой машине Windows** (замечено на ручном job-е `windows-latest`, Ticket 25): временная папка там — `C:\Users\RUNNER~1\…`, test строил ожидаемый путь от короткого имени, а `resolveProjectFile` отвечает длинным. Test теперь берёт папку через `realpathSync.native`. На этом ПК не воспроизводилось: коротких имён у новых папок нет.
- **Watcher веток git** (`refs/heads`, `packed-refs`, `worktrees`) остался на chokidar и на Windows. Это папка `.git`, в checkout она не попадает; в этот Ticket не входила.

### Не сделано и не проверено

- macOS: ничего на Mac не запускалось. Вслепую написан один test — «still follows a root made after the start» в `tickets-chokidar.test.ts` (на Windows пропущен: chokidar там такого корня не видит).
- Ссылки глубже папок прямо внутри Card на Windows не ищутся (chokidar шёл по ним на любой глубине).
- Без test-а остались два места: настоящий путь корня Project-а в разрешённых папках watcher-а (нужен свой share) и отказ от `mkdirSync` папки Card-ов при старте Session (test-ы `canvasForSession` на Windows падают и на main).
- Гонка между обходом и стартом watch — записанный долг, как в Ticket-ах 18 и 19.
- Скрипт `epic-status` — вне скоупа, как и записано в Ticket-е.
