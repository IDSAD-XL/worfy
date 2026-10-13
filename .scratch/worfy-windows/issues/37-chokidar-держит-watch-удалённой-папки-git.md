# 37 — Watch веток git через chokidar на Windows держит handle удалённой папки

Type: task
Status: open
Blocked by: —
Source: первый круг ревью PR #281 на Mac, 2026-10-13 ([комментарий в PR #281](https://github.com/IDSAD-XL/worfy/pull/281#issuecomment-6145538673), раздел «Not this PR — tickets I file»); «Итог» [Ticket-а 27](27-docswatcher-на-удалённом-корне-project-а.md): как chokidar ведёт себя на Windows при удалённой папке `.git`, не мерилось. Первый шаг — замер на Windows-ПК.

## Что происходит

- **Что измерил Ticket 27** (ПК владельца). `fs.watch` удалённой папки на Windows не закрывается и
  не шлёт `error`. Он шлёт события без конца; имя в них — полный путь самой папки. Не рекурсивный
  watch дал 442 394 события и 2999 ms процессорного времени за 3 s. PR #281 закрывает такой watch у
  `DocsWatcher` и `LimitsTracker`.
- **Watch веток git этот PR не трогал.** `WorkflowWatcher` следит за `refs/heads`, `packed-refs` и
  `worktrees` общей папки git через chokidar (`src/main/workflow/watch.ts:301`) — на всех системах.
  С chokidar на Windows ушёл только watch Tickets root (`:271-285`, Ticket 20). Watch веток есть у
  Project-а в Full mode (`:291`).
- **Прочитано, chokidar 5.0.0** (`package.json:34`). На каждую папку — свой не рекурсивный
  `fs.watch` (`node_modules/chokidar/handler.js:115-134`). Имя события chokidar не проверяет. Handle
  папки закрывается только через папку выше — или когда ушла её последняя известная запись и
  `readdir` папки не прошёл (`index.js:140-156`, `:709-769`).
- **Запущено на macOS:** настоящий git 2.50.1, настоящий chokidar, настоящий `fs.watch`. Второй
  reviewer повторил своим скриптом.
  - Папка Project-а удалена после `git gc` или `git pack-refs --all` (в `refs/heads` тогда нет ни
    одного файла): chokidar держит handle удалённой `.git/refs/heads`.
  - Сразу после `git init`: держит handle `.git/refs/heads` и `.git`.
  - Контроль — одна ветка файлом в `refs/heads`: все handle закрыты.
  - `git worktree remove` последнего worktree и `git branch -D`: ничего не держит.
  - Потока событий на macOS нет: не больше 11 событий и 22 ms процессорного времени за 3 s.
- **На модели, для Windows.** Настоящий код chokidar и настоящие папки; `fs.watch` подменён и шлёт
  события с полным путём, как измерил Ticket 27. Оставшийся handle получил около 200 000 событий за
  3 s (199 714 и 204 599 в двух случаях), chokidar его не закрыл. У второго reviewer-а: 100 000
  таких событий за 3 s — handle открыт, ошибки нет.
- **Не запускалось нигде:** chokidar и поток событий Windows вместе. Поток на Windows — вывод из
  замера Ticket-а 27 для того же вызова `fs.watch`.
- **Как до этого дойти, если замер подтвердит.** Project в Full mode открыт в worfy. После `git gc`,
  `git pack-refs --all` или `git maintenance` и до следующего commit папку репозитория удаляют.
  Handle живёт, пока Project не закроют или worfy не выйдет (`WorkflowWatcher.close`, `:250-256`).
- **Ещё один watch chokidar «Итог» Ticket-а 27 не называет:** `~/.claude`, глубина 2, все системы
  (`src/main/claude-home/registry.ts:674`). На модели chokidar закрыл там все handle. На Windows не
  мерили.
- **С какого времени.** Так на main и до PR #281; PR этот код не менял.

## Что делаем

### 1. Замер на Windows-ПК — до любой правки

Под Node 24.21.0 из Electron 44.5.1. Все папки — созданные для замера.

1. Репозиторий с одним commit; `git pack-refs --all`, чтобы `.git\refs\heads` опустела. Открыть его
   в worfy как Project в Full mode. Либо скриптом: `chokidar.watch` на `.git\refs\heads`,
   `.git\packed-refs`, `.git\worktrees` с `ignoreInitial: true`, счётчик на событии `raw`, дождаться
   `ready`.
2. `rmdir /s /q` папки репозитория. За 3 s снять `process.cpuUsage()` и число событий `raw`. Поток —
   это сотни тысяч событий и около 3000 ms.
3. Контроль: без `pack-refs`, одна ветка файлом в `refs/heads`. Ожидание — около 0 ms.
4. То же после `git gc` и после `git worktree remove` последнего worktree. На модели второй случай
   зависел от гонки короче миллисекунды: в одном прогоне handle остался, в другом нет.
5. Watch `~/.claude`: тот же счётчик на копии папки, сделанной для замера; удалить в ней
   `projects\<папка>`. Настоящую `~/.claude` владельца не трогать.

### 2. Правка, если поток есть

- **Того же вида, что в PR #281.** chokidar шлёт событие `raw` с именем, которое дала система.
  Listener на `raw` закрывает watcher на первом имени — полном пути и заводит его заново.
- **Либо** перевести watch веток на `fs.watch` с правилом `src/main/link-safe-watch.ts:298`.
- Одна строка в лог: какая папка пропала.
- Потока нет — записать числа в «Итог», код не менять.
- В обоих случаях дописать `claude-home/registry.ts` в список наблюдателей «Итога» Ticket-а 27.

## Готово, когда

- [ ] Замер сделан. В «Итоге» таблица по шагам 2–5: число событий `raw`, процессорное время за 3 s,
      версии Windows, Node и git.
- [ ] Если поток есть: те же шаги после правки дают около 0 ms; в логе одна строка о пропавшей папке.
- [ ] Если поток есть: test на подменном watcher-е идёт на любой системе и был красным до правки;
      мутант «watcher не закрыт» красный.
- [ ] Если потока нет: числа в «Итоге», код не менялся.
- [ ] `claude-home/registry.ts` назван в «Итоге» Ticket-а 27.
- [ ] `gate full` зелёный на Mac; ручной job «Windows tests» на test-файлах правки — без новых
      падений относительно main.

## Тесты

- Сначала падающий test: подменный watcher шлёт `raw` с именем — полным путём (правило `path.win32`);
  ожидание — watcher закрыт, создан новый, в логе одна строка.
- Windows, настоящие папки (только `win32`): шаг 2 замера как test с порогом процессорного времени —
  по образцу `test/contract/docs-watch-root.test.ts`.

## Где в коде

- `src/main/workflow/watch.ts` — `watch` (`:258-304`), вызов chokidar для веток (`:301`), `close`
  (`:250-256`).
- `src/main/claude-home/registry.ts:674` — watch `~/.claude`.
- `src/main/link-safe-watch.ts` — образец закрытия (`:298`, `:301-305`).
- `node_modules/chokidar/handler.js`, `index.js` — только читать.

## Вне скоупа

- `DocsWatcher` и `LimitsTracker` — Ticket 27; их остатки — [Ticket 36](36-остатки-ревью-pr-281.md).
- Tickets root и папка Card-ов на Windows идут не через chokidar — Ticket 20.
- Watch-и chokidar не возвращаются, когда папку вернули. Запущено на macOS: папка Project-а удалена
  и создана снова с новым Ticket-ом — 0 событий; worktree создан снова — 0 событий. Отдельный вопрос.
- macOS: документы удалённого корня — [Ticket 38](38-документы-удалённого-корня-на-macos.md).

## Риски

- **Правка без замера — вслепую:** поток под chokidar на Windows никто не запускал.
- **Новый watcher на пути, которого нет.** Что chokidar делает с таким путём и вернётся ли watch,
  когда папку создадут снова, — проверить в замере до выбора правки.
- **Шаг 5 замера** идёт только на копии `~/.claude`: в настоящей лежат transcript-ы владельца.

## Итог

—
