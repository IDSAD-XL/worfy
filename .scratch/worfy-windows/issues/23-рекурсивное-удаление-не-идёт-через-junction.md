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
