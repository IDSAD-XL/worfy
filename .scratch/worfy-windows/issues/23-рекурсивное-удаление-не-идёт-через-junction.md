# 23 — Рекурсивный `fs.rmSync` под Node 24 из Electron на Windows идёт через junction и опустошает папку за ним

Type: task
Status: open
Blocked by: 12
Source: замеры Session на Windows-ПК, 2026-10-12: скрипты `probe-rm-junction.cjs` и `probe-rm2.cjs`, их текст и вывод — в [комментарии к PR #237](https://github.com/IDSAD-XL/worfy/pull/237#issuecomment-6127158859); владелец согласился завести Ticket 2026-10-12. Порядок: после PR #237 (Ticket [12](12-сборка-nsis-и-stable-copy-на-windows.md) — сборка NSIS и Stable copy; блокер отсюда: обход `removeTree` берётся из его скрипта) и до Ticket-а [20](20-chokidar-не-идёт-по-ссылке-на-unc.md) (watcher-ы chokidar и ссылка на share): оба правят `src/main/layout/trash.ts` и `src/main/mcp/canvas-server.ts`. Делает Session на Windows-ПК; проверяет и вливает Session на Mac.

## Что происходит

- **Замер на ПК владельца, 2026-10-12, голый вызов в probe-скрипте.** Junction — ссылка на папку в NTFS.
  - Node 22.13.0 (системный): `fs.rmSync` junction и папки с junction внутри — папка за junction цела.
  - Node 24.21.0 из Electron 44.5.1: `fs.rmSync(junction, { recursive: true, force: true })` —
    junction удалён, папка за ним **пуста**. `fs.rmSync(папка с junction внутри, { recursive: true })`
    — папка за junction пуста. С `maxRetries` — то же.
  - Там же `fs.promises.rm` и `fs.rm` с callback, оба с `recursive`, папку за junction не трогают.
    Symlink на папку (тип `'dir'`) безопасен во всех трёх. `fs.rmdirSync(junction)` удаляет только ссылку.
- **Ещё два замера на ПК** (Session на Windows, 2026-10-12, скрипты `probe-t12-r2.cjs` и
  `probe-rm3.cjs`; таблица — в отчёте второго круга по PR #237):
  - файл «только для чтения»: `unlinkSync` удаляет его под обоими Node.
    `rmSync(файл, { force: true })` под Node 24 бросает EPERM, файл остаётся; под Node 22 удаляет;
  - `rmSync(junction, { force: true })` без `recursive` под Node 24 бросает ERR_FS_EISDIR, ссылка
    остаётся; под Node 22 удаляет ссылку, папка за ней цела;
  - `maxRetries: 5, retryDelay: 100` у `rmSync` на Windows действительно ждёт: 1,5–2,1 s на файле,
    открытом другим процессом, под обоими Node.
- **Причина — по исходникам Node**; reviewer на Mac прочитал, не запускал: `rmSync` в Node 24 — это
  `std::filesystem::remove_all` в цикле повторов (`src/node_file.cc`, `RmSync`).
- **Main-процесс worfy идёт на том же Node 24.** На main `d803f93`
  `git grep -n "rmSync(" -- src/main scripts` даёт 18 строк, 11 из них с `recursive`. Сами эти места
  не проверялись — только голый вызов.
  - `src/main/harness/migrate/apply.ts:327` — перенос старого Harness удаляет из `~/.claude` пути
    `agents|skills|bin|hooks/<имя>` (`plan.ts:291-301`). Функция `under` проверяет на ссылку только
    папки выше (`apply.ts:115-119`). «На Windows `skills` часто junction на репозиторий» — слова
    Session на Windows, не проверялось.
  - `apply.ts:628` — папка backup после отката; backup копирует ссылку как ссылку (`:469`).
  - `src/main/harness/migrate/restore.ts:162`, `:232` — в тексте отдельного скрипта `restore.mjs`
    (`String.raw`, `:93-278`). Он идёт и под системным Node (`:5`), и в main-процессе (`apply.ts:620`).
  - `src/main/layout/trash.ts:222` — запись корзины с папкой Card (`:6-8`); файлы Card пишут агенты.
    `:163`, `:202` — запись без Card. `src/main/mcp/canvas-server.ts:157` — только что созданная папка.
  - `src/main/terminal/shell-integration.ts:146` — временная папка со скриптами zsh; вызов идёт при
    выходе процесса (`src/main/ipc/terminal.ts:210`) и обязан быть синхронным.
  - `scripts/eval-harness.mjs:213`, `scripts/make-icons.mjs:129` — временные папки; оба скрипта идут
    под системным Node, второй — только на macOS (`:102`).
- **Сегодня риск мал:** Harness на Windows ещё не ставится, папки Card — данные самого worfy. Но
  класс ошибки — потеря чужих файлов. Поэтому Ticket делается до первого переноса Harness на Windows.

## Что делаем

1. **Одна функция удаления дерева**, которая не заходит в junction и symlink: `lstat` каждой записи;
   ссылка удаляется как ссылка (`rmdirSync` или `unlinkSync`). Основа — `removeTree` из PR #237
   (`scripts/install-stable.mjs`, ветка `origin/worfy-windows/12`): в его втором круге файл удаляет
   `unlinkSync`, а удаление и rename на Windows повторяются до пяти раз через 100 ms при EBUSY,
   EPERM, ENOTEMPTY и EACCES. Сейчас он работает только на Windows.
2. **Все 9 мест в `src/main`** зовут её. **Семь вызовов `rmSync` без `recursive` — тоже:** функция
   удаляет и один файл, через `unlinkSync`. Под Node 24 эти вызовы бросают EPERM на файле «только
   для чтения» и ERR_FS_EISDIR на junction; данные при этом целы, но вызов падает. Места:
   `src/main/storage/json-file.ts`, `src/main/link/secrets.ts`, `src/main/harness/migrate/apply.ts`
   (два), `restore.ts`, `src/main/agent/fake-query.ts` и `scripts/statusline-bridge.mjs`. `restore.mjs` ничего импортировать не может: ему нужен
   только node (`restore.ts:1-3`). В его тексте — своя копия; test сверяет её с общей функцией.
3. **Три скрипта в `scripts/`** — та же функция, или строка в «Итог», почему нет. Импортов между
   `src/main` и `scripts/` на main нет (grep); возможен ли общий модуль — не проверялось. Если нет —
   две копии и test, который их сверяет.
4. **Test против возврата:** падает, когда `rmSync` снова появился в `src/main`. Образец
   запрета на main — правило ESLint `worfy/process-boundary` (`eslint.config.js:105-107`) с test-ом
   `test/unit/process-boundary.test.ts:11-13`. Test-а, который ищет текст по `src/`, на main нет
   (grep). Правило ESLint не увидит вызов в строке `restore.ts`; поиск по тексту увидит.
5. **Решить и записать в «Итог»:** брать ли `fs.promises.rm` там, где код уже async. Такое место
   одно — `apply.ts:628` (`rollBack`, `:616`).
6. **Остатки ревью PR #237** (Ticket 12 — установщик NSIS и Stable copy; все low; тот же
   `scripts/install-stable.mjs` и его test-ы; номера строк — по commit-у `2f3dcb6`):
   - **Имя своей временной папки уже занято** (`:440`, `:449`, `:455-464`). Ссылка с именем
     `<цель>.installing-<pid этого запуска>`, которая ведёт в папку пользователя, не убирается:
     `ditto` копирует сборку в ту папку, а ссылка переезжает на место цели. Файл с таким именем
     роняет `ditto`, и `finally` его удаляет. Нужен точный pid запуска. Защита: отказ, если по пути
     своей временной папки лежит не настоящая папка.
   - **Настоящая папка `<цель>.replaced-<n>`** с n до 4 194 304 (например год 2024) удаляется без
     строки в выводе. Печатать одну строку на каждый убранный остаток.
   - **Заметки печатаются только при exit code 0** (`:476-480`). Когда json записать нельзя, строка
     об оставленном остатке пропадает. Сообщение говорит «файл называет прежнюю сборку» и тогда,
     когда файла нет.
   - **Закреплено только блоком test-ов для Windows:** catch вокруг чистки остатков (два мутанта
     проходят на Mac); повторный поиск запущенной копии после сборки.
   - **Не закреплено ни на одной системе:** ссылка с именем остатка (`plainFolder` через `statSync`
     проходит); повтор занятого шага (`RETRIES = 0` проходит); какая из двух отложенных копий
     возвращается на место цели; причина внутри сообщения о json.
   - **Текст Ticket-а 12** (`:379`, `:457` файла Ticket-а): список отличий macOS ещё говорит «сырой
     EISDIR»; exit code упавшей сборки в сам список не внесён.
   - **Шесть пробелов в test-ах `.ico`** (`scripts/ico.mjs`, первый круг ревью): мутанты R1-ICO-14,
     -20, -32, -33, -45, -46 проходят. `packIco` пишет «32 бита» для любого PNG, `readIco` читает
     четыре поля из восьми. Проверять тип цвета и глубину в `packIco`.
   - **8.3 short name** как цель (`C:\PROGRA~1\…`): отказ показан только на модели; на ПК не замерен.

## Готово, когда

- [ ] Test только для `win32` с настоящим junction (`symlinkSync(target, link, 'junction')`): функция
      удаляет junction и папку с junction внутри, файл за junction цел. Идёт на ПК под Node из Electron.
- [ ] Тот же случай на модели идёт на любой системе: подменённая файловая система или symlink на POSIX.
- [ ] Каждое место вызова, где есть шов, покрыто test-ом: junction внутри удаляемой папки, папка за
      ним цела. Места без шва — списком в «Итог».
- [ ] Test из пункта 4 красный, если вернуть `rmSync` — с `recursive` или без — в любой файл `src/main`.
- [ ] Файл «только для чтения» и junction как цель одиночного удаления: функция удаляет файл и
      снимает ссылку, не бросая; test на ПК под Node из Electron.
- [ ] macOS не меняется (symlink-и не проходились и раньше); gate full на Mac зелёный.
- [ ] Замер повторён на ПК после правки, вместе с новой функцией, — таблицей в «Итог».
- [ ] Windows-ПК: `pnpm lint`, `pnpm typecheck`, `pnpm test` — без новых падений относительно main.
- [ ] Остатки ревью PR #237 из пункта 6 «Что делаем»: сделаны и закреплены test-ами, либо в «Итог»
      записано, почему нет.

## Тесты

Сначала падающий test (только `win32`, `it.runIf`, как `test/contract/card-protocol.test.ts:144`): в
папке Card лежит junction, `purge` корзины (`trash.ts:217`) удаляет запись, файл за junction исчез.
На Mac и в Linux CI он пропущен с причиной. Junction уже создаёт `test/unit/agent-env.test.ts:662-670`.

## Где в коде

- новый модуль функции; 9 мест в `src/main` из списка; текст `restore.mjs`; три скрипта в `scripts/`
- `test/contract/trash.test.ts`, `test/contract/harness-migrate.test.ts`, новый test функции

## Вне скоупа

- Исправление в самом Node. Проверка `leadsToRemote` в `trash.ts` и `canvas-server.ts` — это
  Ticket 20.

## Риски

- Node могут исправить: обход останется лишним, но безвредным. Версия Node из Electron — в «Итог».
- Скорость: обход не должен быть медленнее `rmSync` на большом дереве; замер — в «Итог». Файлы
  только для чтения на Windows `unlinkSync` удаляет (замер выше).
- Системный Node 24 (Ticket 24 делает его обязательным): ведёт ли он себя как Node 24 из Electron —
  не проверялось. От этого зависят скрипты в `scripts/`.

## Итог

Session на Windows-ПК, 2026-10-12. Node на ПК: системный 22.13.0; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/23`, в ней main `a995a59`.

### Что сделано

1. **Одна функция удаления** — `src/main/storage/remove.ts`.
   - `removeTree(path)`: `lstat` каждой записи; всё, что не папка, удаляет `unlinkSync` — файл, symlink и junction как ссылку; папка сначала опустошается, потом `rmdirSync`. В то, куда ведёт ссылка, обход не заходит.
   - `removeFile(path)`: один файл или одна ссылка; настоящая папка — ошибка с кодом `EISDIR`, как было у `rmSync` без `recursive`.
   - Пути, которого нет, — не ошибка. На Windows шаг повторяется до пяти раз через 100 ms при EBUSY, EPERM, ENOTEMPTY, EACCES; на других системах повторов нет.
2. **Места вызова в `src/main`** — все 15 вызовов `rmSync` заменены (9 с `recursive`, 6 без; ещё три — в `scripts/`, итого 18 строк из текста Ticket-а): `layout/trash.ts` (три), `mcp/canvas-server.ts`, `terminal/shell-integration.ts`, `harness/migrate/apply.ts` (четыре), текст `restore.mjs` в `harness/migrate/restore.ts` (три), `storage/json-file.ts`, `link/secrets.ts`, `agent/fake-query.ts`.
3. **Скрипты.** Общего модуля у `src/main` и `scripts/` нет: `restore.mjs` и `scripts/install-stable.mjs` — по одному файлу без своих импортов. Поэтому копий обхода три, одним и тем же текстом между метками `// <remove-tree>` и `// </remove-tree>`: в тексте `restore.mjs`, в `scripts/remove-tree.mjs` (его импортируют `eval-harness.mjs` и `make-icons.mjs`) и в `scripts/install-stable.mjs`. `scripts/statusline-bridge.mjs` удаляет один файл через `unlinkSync`.
   - `scripts/install-stable.mjs` вне Windows по-прежнему зовёт `rmSync`: поведение macOS не меняется.
4. **Test против возврата** — `test/unit/no-rmsync.test.ts`: любое слово `rmSync` вне строки-комментария в `src/**/*.ts(x)` роняет test. Поиск по тексту, поэтому видит и вызов внутри строки `restore.ts`.
5. **`fs.promises.rm` не взят.** Единственное async-место — `rollBack` в `apply.ts`. Там тоже `removeTree`: одна функция на все места, и её поведение на ссылке и на файле «только для чтения» замерено. `fs.promises.rm` на файле «только для чтения» не замерялся.
6. **Остатки ревью PR #237** — ниже отдельным списком.

### Замер на ПК после правки

Скрипт `probe-t23.mjs`, голый вызов, оба Node. «За ссылкой» — папка с одним файлом `notes.txt`.

| Что удаляется | `fs.rmSync(recursive, force)`, Node 22.13.0 | `fs.rmSync(recursive, force)`, Node 24.21.0 | `removeTree`, оба Node |
|---|---|---|---|
| junction как путь | ссылки нет, файл за ней цел | ссылки нет, **папка за ней пуста** | ссылки нет, файл цел |
| папка с junction внутри | папки нет, файл за ссылкой цел | папки нет, **папка за ссылкой пуста** | папки нет, файл цел |
| symlink на папку (`'dir'`) как путь и внутри папки | файл цел | файл цел | файл цел |
| symlink на файл | файл цел | файл цел | файл цел |
| файл «только для чтения» как путь | удалён | **бросает EPERM, файл остался** | удалён |
| папка с файлом «только для чтения» | удалена | **бросает EPERM, папка осталась** | удалена |
| 5000 файлов в 100 папках, три раза | 1024, 957, 989 ms | 888, 965, 921 ms | Node 22: 977, 957, 1067 ms; Node 24: 972, 961, 971 ms |

Обход не медленнее `rmSync`: разница внутри разброса.

### Test-ы

- **Падающий первым** — `test/unit/trash-junction.test.ts`, не `test/contract/trash.test.ts`: contract-файл на Windows падает целиком на main (путь `INDEX_HTML` от macOS). На main до правки: `purge` корзины с junction в папке Card опустошил папку за ссылкой (`expected [] to deeply equal [ 'notes.txt' ]`).
- **Функция** — `test/unit/remove-tree.test.ts`, 18 test-ов: настоящие junction, symlink на папку и на файл, файл «только для чтения»; модель файловой системы с повторами по системам; три копии обхода сверяются с модулем по журналу вызовов (10 случаев на 3 системы) и между собой как текст.
- **Места вызова.** Ссылка — junction на Windows, symlink на папку на других системах, кроме двух test-ов переноса Harness: они только `win32`.

| Место | Test | Если вернуть `rmSync` в это место |
|---|---|---|
| `trash.ts`, `purge` | `trash-junction.test.ts` | красный |
| `canvas-server.ts`, `create_card` при сбое Layout | `canvas-tools.test.ts`, новый случай | красный |
| `shell-integration.ts`, `disposeSync` | `shell-integration-dispose.test.ts` | красный |
| `apply.ts`, шаг `files` | `harness-migrate.test.ts`, junction на месте skill (только `win32`) | красный |
| `restore.mjs`, удаление пути перед возвратом из backup | `harness-migrate.test.ts`, junction снова на месте при откате (только `win32`) | красный (мутант: `statSync` вместо `lstatSync`) |
| `apply.ts`, backup после отката | — отдельного случая со ссылкой нет | красный другой test: «a failure after the step "commit"» — `rmSync` падает с EPERM на объекте git |

- **Места без шва** (закрыты только test-ом функции и запретом `rmSync`):
  - `trash.ts`, `put` при сбое и `restore`: к моменту удаления папка записи уже без файлов Card.
  - `restore.mjs`, `keepAside` с переносом: ветка идёт, только когда `renameSync` не удался.
  - Одиночные удаления: `json-file.ts`, `secrets.ts`, `fake-query.ts`, `apply.ts` (marker и файлы отката), `restore.mjs` (созданные файлы).
  - `scripts/eval-harness.mjs`, `scripts/make-icons.mjs`: импортируют копию; сама копия сверена с модулем.

### Остатки ревью PR #237 (пункт 6)

- **Имя своей временной папки занято.** Скрипт отказывает, если по пути `<цель>.installing-<pid>` или `<цель>.replaced-<pid>` этого запуска что-то лежит после чистки остатков: ссылка, файл или папка, которую не удалось убрать. Test: ссылка на папку пользователя, ссылка в никуда, файл — всё цело, сборка в папку за ссылкой не копируется.
- **Строка на каждый убранный остаток:** «…, left by an earlier run, is removed» и «…, a copy an earlier run had moved aside, is back at …».
- **Заметки печатаются и при сбое** — в stderr перед ошибкой. Сообщение о json теперь говорит «the file still names the build that was there before», только когда файл есть; иначе «no file names the build of this copy». Причина от системы закреплена test-ом (EISDIR для папки, EPERM или EACCES для файла «только для чтения»).
- **Закреплено на любой системе** (блок «a whole install» идёт на macOS и Windows): остаток, который нельзя убрать, — через подменённый `rename`. Повторный поиск запущенной копии после сборки для macOS и Linux написан вслепую, на ПК не запускался.
- **Раньше не закреплено нигде, теперь закреплено:** ссылка с именем остатка остаётся на месте; занятый шаг повторяется на Windows, а на других системах первая же ошибка завершает запуск (ветка «не Windows» написана вслепую); из двух отложенных копий возвращается первая по тексту имени — порядок теперь задаёт `leftovers()`, а не файловая система; причина в сообщении о json.
- **Текст Ticket-а 12:** строка о папке на месте `<цель>.json` и exit code упавшей сборки внесены в список отличий macOS. Счёт «три различия только в тексте» выведен из слов ревьюера; саму таблицу Mac-ревью я не видел.
- **`.ico`.** Описаний мутантов R1-ICO-14, -20, -32, -33, -45, -46 не осталось ни у Session на Windows, ни у Session на Mac — только номера. Вместо них сделан свой обход `scripts/ico.mjs`: 61 мутант, 7 выжили, все 7 закрыты test-ами (итог 61 из 61). Проверка типа цвета и глубины в `packIco` сделана ещё в PR #237.
- **8.3 short name.** Новым папкам том коротких имён не выдаёт, но у `C:\Program Files` оно есть — `C:\PROGRA~1`. Test только для Windows, диск только читает: `onDisk` пишет короткое имя полным, и цель через короткое имя папки установщика отвергается. На ПК без такого имени test пропускается.

### Мутанты

По одному, свои runner-ы на ПК, test-ы под Node 24 из Electron.

- **Ticket 23, 42 из 42 красные:** модуль 28, места вызова 5, копии обхода 7, запрет `rmSync` 2.
- **Пункт 6, скрипт установки, 26:** 24 красные обычным путём. Ещё два:
  - «ссылка под своим именем проверяется через `existsSync`»: под Node 22 test красный с ожидаемой причиной; под Node 24 из Electron процесс test-ов обрывается на этом test-е с exit code 1, не дописав отчёт. Причину обрыва не выяснял.
  - «занятый шаг повторяется на любой системе»: на Windows выживает; его ловит только ветка «не Windows», которая на ПК не идёт.
- **`.ico`, 61 из 61** после новых test-ов.
- 81 мутант второго круга PR #237 заново не запускался.

### Windows-ПК: lint, typecheck, test

- `pnpm lint` — exit code 0. `pnpm typecheck` — exit code 0.
- `pnpm test`, полный, оба под Node 24.21.0 из Electron 44.5.1:

| | main `15bde98` | ветка, commit `ceed4ef` |
|---|---|---|
| exit code | 1 | 1 |
| test-ов | 4197 | 4231 |
| прошло | 3472 | 3541 |
| упало | 690 | 654 |
| пропущено | 35 | 36 |

- **После этих прогонов в ветку влит main `a995a59`** (скрипты `harness/` из PR #232 и документы; файлы ветки не затронуты). После слияния: `pnpm lint` и `pnpm typecheck` — exit code 0; десять test-файлов ветки — ни одного падения, которого нет на main. Полный прогон после слияния не повторялся.
- **По именам.** 39 test-ов падают на main и не падают на ветке: `harness-migrate` 28, `build-version` 2, ещё 9 — в файлах, которые ветка не трогала (нестабильные на main: `agent-env`, `check-handoff`, `process-boundary`, `e3-sandbox`, `canvas-menu`, `canvas`, `permission-card` 2, `shell-discovery`).
- **Три test-а падают на ветке и не падают на main** — все три по времени, в файлах, которые ветка не трогала: два в `test/contract/e3-sandbox.test.ts` («the script did not finish in time») и один в `test/unit/epic-canvas.test.tsx`. Эти два файла, запущенные отдельно на ветке: `epic-canvas` — 32 прошло; `e3-sandbox` — ни одного падения, которого нет на main.
- **`harness-migrate`:** на main 54 из 54 упали; на ветке в полном прогоне 26 упали и 30 прошли из 56 (два test-а новые). Один из 26 — «a move writes nothing outside ~/.claude…» — в полном прогоне упал по timeout 15 s; отдельно файл даёт 25 упавших и 31 прошедший. Остальные 25 падают по причинам переноса Harness на Windows, в этот Ticket не входят.

### Папки в `%TEMP%` и падения из-за чистки в test-ах

- **Счётчик папок `worfy-*`, созданных за один полный `pnpm test`:** main `15bde98` — 254; ветка только с новой функцией — 248; ветка целиком — 193.
- **Сама функция счёт не меняет:** папки оставляет не код worfy, а test-ы. Их `afterEach` зовёт `rmSync` с `recursive`; под Node 24 из Electron он падает с EPERM на файле «только для чтения» — такими git пишет свои объекты. Папка остаётся, а test получает ошибку.
- **На main из 690 падений у 153 в причинах есть этот EPERM, у 67 нет другой причины.** По файлам: `harness-migrate` 54, `projects` 24, `docs` 22, `projects-connect` 21, `clients` 10, `shell` 10, `harness-drift` 9, `build-version` 2, `canvas-tools` 1.
- **В этом PR `rmSync` заменён на `removeTree` в двух `afterEach`** (так решено с Session на Mac: не больше двух): `harness-migrate` — 54 падения стали 25–26, папок `worfy-migrate-*` 54 стало 0; `build-version` — 2 падения стали 0, папок 3 стало 0. На ветке EPERM остался у 97 падений в семи файлах.
- **Остальные семь файлов — Ticket 26.** Какие test-файлы оставляют папки сейчас (по счётчику ветки): `canvas-tools` 27, `projects` 24, `harness-evals` 23 и 9, `docs` 22, `projects-connect` 21, `app-settings` 19 (этот не чистит за собой вовсе), `harness-drift` 12, `clients` 10, `shell` 10, `trash` 10.

### Не сделано и не проверено

- macOS: ничего из этого на Mac не запускалось. Три места написаны вслепую: test «looks for a running copy again after the build» (блок «off Windows»), ветка «не Windows» в test-е повтора занятого шага, и все test-ы блока «a whole install» в части macOS.
- `afterEach` остальных семи test-файлов не тронуты — это Ticket 26.
- Папки `worfy-*`, накопленные в `%TEMP%`, не удалялись: решения владельца нет.
- Системный Node 24 на ПК не установлен: скрипты в `scripts/` под ним не запускались. Замер под Node 24 — только через Electron.
- `ShellIntegration.prepare()` на Windows при каждом вызове создаёт новую папку, а `disposeSync` убирает только последнюю (проба под Node 24.21.0: после первого вызова 2 папки, после второго 3, после `disposeSync` осталось 2). По коду причина — проверка «папка только своя» смотрит биты доступа POSIX; сама причина не замерялась. zsh на Windows не запускается, поэтому это не правилось.
