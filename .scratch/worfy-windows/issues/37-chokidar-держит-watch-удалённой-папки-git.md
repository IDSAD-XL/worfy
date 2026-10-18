# 37 — Watch веток git через chokidar на Windows держит handle удалённой папки

Type: task
Status: done 2026-10-18T17:49Z
PR: #493
Branch: worfy-windows/37-chokidar-handle
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

- [x] Замер сделан. В «Итоге» таблица по шагам 2–5: число событий `raw`, процессорное время за 3 s,
      версии Windows, Node и git.
- [x] Если поток есть: те же шаги после правки дают около 0 ms; в логе одна строка о пропавшей папке.
- [x] Если поток есть: test на подменном watcher-е идёт на любой системе и был красным до правки;
      мутант «watcher не закрыт» красный.
- [ ] Если потока нет: числа в «Итоге», код не менялся.
- [x] `claude-home/registry.ts` назван в «Итоге» Ticket-а 27.
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

Ветка `worfy-windows/37-chokidar-handle` от main `cf506ee`, Windows-ПК, 2026-10-18.

### Замер до правки (пункт 1)

Windows 11 Pro 10.0.26200.9711, Node 24.21.0 (та же версия, что в Electron 44.5.1), git 2.45.1.windows.1, chokidar 5.0.0. Скрипт: `chokidar.watch` на `.git\refs\heads`, `.git\packed-refs`, `.git\worktrees` с тем же `ignored`, что в `watch.ts`, `ignoreInitial: true`, счётчик на `raw`, `ready`, пауза 300 ms; потом `rmdir /s /q` папки репозитория (exit code 0 везде) и 3 s. Папки — в `%TEMP%\worfy-01\t37m`, удалены после замера. Два прогона на случай, где их два.

| Шаг | События `raw` за 3 s | CPU за 3 s | Какие handle шлют |
| --- | --- | --- | --- |
| 2: `pack-refs --all`, `refs\heads` пуста | 121 714; 123 874 | 3735 ms; 3969 ms | `.git`, `.git\refs\heads` |
| 3: контроль, одна ветка файлом | 109 601; 108 395 | 3921 ms; 3843 ms | `.git`, `.git\refs\heads` |
| 4: `git gc` до watch | 104 092 | 3891 ms | `.git`, `.git\refs\heads` |
| 4: `git gc` во время watch | 93 364; 97 450 | 4063 ms; 3937 ms | `.git`, `.git\refs\heads` |
| 4: `git worktree remove` последнего worktree, потом папка репозитория | 119 285; 112 157; 121 823 | 3765–4078 ms | `.git\worktrees`, `.git`, `.git\refs\heads` |
| 4': только `git worktree remove`, репозиторий на месте | 98 703; 98 100 | 3765 ms; 3859 ms | `.git\worktrees` |
| 5: копия `~/.claude` (глубина 2), удалена `projects\<папка>` с transcript-ом / пустая | 0 / 0 (и 0 во втором прогоне) | 0 ms / 0 ms | — |

- **Поток есть во всех случаях git, и в контроле тоже** — на macOS контроль закрывал все handle. `.git` держится всегда: chokidar следит за ней ради файла `packed-refs` и пропавшей `worktrees`.
- **Самый частый путь — без удаления репозитория:** `git worktree remove` последнего worktree удаляет `.git\worktrees`, и её handle шлёт поток, пока Project открыт.
- Имя в событиях потока — полный путь самой папки (на всех 100 % событий, проверено по `watchedPath`), как в замере Ticket-а 27.
- Папка удалена сразу после `ready` (без паузы): потока нет — chokidar ещё не открыл handle.
- Шаг 5: копия `~/.claude` — синтетическая папка того же устройства (`projects\<папка>\<uuid>.jsonl`, `sessions\1.json`), сделанная для замера; настоящая `~/.claude` не читалась.
- **Новый watch chokidar на пропавших путях** (риск из раздела «Риски»): `ready` приходит, следит за ближайшей папкой выше, 0 событий и 0 ms за 3 s. Папку репозитория создали снова — 0 событий (это «Вне скоупа»). Если пропала только `.git\worktrees`, новый watch видит следующий `git worktree add` (держит contract test).

### Причина

chokidar ставит на каждую папку не рекурсивный `fs.watch` и закрывает handle только через папку выше или когда ушла последняя известная запись и `readdir` не прошёл. На Windows handle удалённой папки не закрывается и не шлёт `error`, а шлёт события с полным путём этой папки; chokidar их не проверяет.

### Что изменилось

- `src/main/workflow/watch.ts`: watch веток слушает `raw`. Первое имя — полный путь (правило `namesTheFolder` из `watch-gone.ts`) и событие от `fs.watch` (есть `watchedPath`; опрос `usePolling` не трогается) — одна строка `console.warn`: `[workflow] the folder <папка> is gone: the watch of the branches is made anew`. Затем watcher закрывается, после `close` заводится заново на тех же путях, и идёт чтение веток. `close()` во время этого — новый не заводится. Seam `isAbsolute` в `WatchOptions` для test-ов.
- На macOS и Linux имена событий не бывают полным путём (кроме watch `/`, см. `watch-gone.ts`), поведение там не меняется.
- Выбран вариант «закрыть и завести заново», не перевод на `fs.watch`: правка маленькая, chokidar сам ждёт пропавшие пути на папке выше.
- Ticket 27, «Итог», пункт 4: дописан `claude-home/registry.ts` и ссылка сюда.

### Test-ы

- `test/unit/workflow-branches-gone.test.ts` (4, любая система): подменный chokidar, правило `path.win32`, настоящий `git init`.
- `test/contract/workflow-branches-gone.test.ts` (4, только `win32`): настоящий chokidar и папки; `git worktree remove`, потом папка репозитория; папка после `pack-refs --all`, после `gc`, с одной веткой. Порог — меньше 300 ms CPU за 1 s, одна строка в логе на каждую пропажу; новый watch видит `git worktree add`.
- Красные на коде main (`watch.ts` из `HEAD`, потом возвращён байт в байт): 6 упали, 2 прошли (2 прошедших — guard-ы, что лишнего не делается), exit code 1.
- Мутанты (по одному, файл возвращён байт в байт, все убиты, exit code 1): watcher не закрыт — 7 красных из 8; не заведён заново — 3; нет однократного флага — 1; нет проверки `closed` после `close` — 1; любое имя считается пропажей — 2.

### Те же шаги после правки (ПК)

Через настоящий `WorkflowWatcher` под Electron 44.5.1 (временный test, не в commit), 3 s после удаления:

| Случай | События `raw` | CPU | Строк в логе |
| --- | --- | --- | --- |
| `pack-refs --all` | 2 | 0 ms | 1 |
| контроль, одна ветка | 4 | 0 ms | 1 |
| `gc` до watch / во время | 2 / 2 | 30 ms / 0 ms | 1 / 1 |
| `worktree remove`, потом репозиторий | 4 | 46 ms | 2 (по одной на пропажу) |
| только `worktree remove` | 4 | 16 ms | 1 |

### Прогоны на ПК

- `node scripts/vitest-electron.mjs` на 10 файлах (два новых, `workflow-watch-retry`, `workflow-watch-links`, `workflow-reader`, `workflow-profile`, `workflow-remote-links`, `watch-gone`, `e2e-no-spawn-on-load`, `no-rmsync`): exit code 0, 258 passed, 3 skipped.
- `pnpm lint`: exit code 0. `pnpm typecheck`: exit code 0.
- `gate.sh fast`: exit code 3 — Harness-профиля на ПК нет, это не зелёный.

### После ревью `6f34540` (три low)

- Watch, заведённый заново до своего `ready`, больше не вешает старт: `ready` передаётся новому watch-у (иначе `WorkflowWatcher.start()` ждал до закрытия Project-а). Добавлены unit test-ы: старт до `ready` (красный на `6f34540`, 1 из 7), чтение веток после пересоздания, событие опроса без `watchedPath`. Мутанты «`ready` не передан», «нет чтения после пересоздания», «нет проверки `watchedPath`» — каждый убит (exit code 1, файл возвращён байт в байт). 10 файлов test-ов: exit code 0, 261 passed, 3 skipped; `pnpm lint` и `pnpm typecheck`: exit code 0.

### Осталось Mac и владельцу

- `gate full` на Mac; ручной job «Windows tests» на двух новых test-файлах.
- На Mac убедиться, что unit test проходит (contract test там пропускается).

### Мерж и проверки на Mac (Session на Mac, 2026-10-18)

- PR #493 влит как `9a6eb065`. Ревью на Mac, круг 1 (high, [комментарий](https://github.com/IDSAD-XL/worfy/pull/493#issuecomment-6251078858)): high и medium нет, два low про test-ы — в [Ticket 62](62-остатки-ревью-2026-10-18-вечер.md).
- Перед мержем `GATE_SCOPE=all` gate full на Mac, head `425aa801` после rebase на `01ae750e` — exit 0, `[gate] зелено (full): worfy/.:lint worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package` ([отчёт `Mac checks report: green`](https://github.com/IDSAD-XL/worfy/pull/493#issuecomment-6251742499)). Unit test `workflow-branches-gone` на Mac зелёный; contract test там только для Windows и пропускается.
- Вердикт Windows на `425aa801` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/493#issuecomment-6252049727)): contract и unit `workflow-branches-gone` + `no-rmsync` + `e2e-no-spawn-on-load` — exit 0, 4 файла, 74 passed; contract test идёт на настоящих папках и настоящем git. Регрессий нет. После gate main сдвинулся на #468 (`786aee97`, только Stepper в renderer), общих файлов нет. Linux CI — batch CI на main.
