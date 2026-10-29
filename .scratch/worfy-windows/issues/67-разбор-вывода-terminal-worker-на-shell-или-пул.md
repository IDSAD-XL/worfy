# 67 — Разбор вывода Terminal в main: один worker на все shell-ы держит flood; worker на shell или пул

Type: task
Status: claimed 2026-10-29T17:29Z
Blocked by: —
Source: follow-up [Ticket-а 39](39-ответы-экрана-считаются-вводом.md) (PR #512, влит 2026-10-19 как `77c473cb`);
замеры в «Итог» Ticket-а 39, «Ревью Mac, круг 3» (ПК) и ревью Mac круга 3 PR #512 (Mac); решения владельца
2026-10-19: «принимаю замедление в #512, worker на оболочку или пул — отдельным тикетом» и «принимаю
замедление #512 и на Mac».

## Что происходит

- С PR #512 main сам отвечает на запрос позиции курсора (`ESC[6n`). Для этого он разбирает весь вывод
  каждого shell-а в xterm.js без экрана (`@xterm/headless`) — в одном worker thread на все shell-ы
  (`src/main/terminal/cursor-answers.ts`, шапка файла; `ScreenWorker` `:129`, общий экземпляр
  `screenWorkerOf` `:188`).
- Чтобы xterm.js worker-а не отказал (больше 50 MB неразобранного), main держит back-pressure: выше
  `HIGH_WATER` (4 000 000 символов, `:59`) ставит pty shell-а на паузу, при `LOW_WATER` (1 000 000, `:61`)
  и ниже возобновляет. Вывод к view идёт со скоростью разбора worker-а.
- **Цена — скорость flood-а.** Замер ПК (Windows 11, Ryzen 7 5800X3D, `node.exe` с бесконечной записью
  `y\n`): worker разбирает ~12–13 MB/s на все shell-ы вместе. Один shell — 11.8 MB/s против 24 MB/s на main
  до PR; два shell-а — в 3.7 раза медленнее main, четыре — в 6.5 раза. Worker, который отвечает `parsed`, не
  разбирая, дал 24.4 MB/s на один shell: скорость держит сам разбор, не back-pressure.
- Замер Mac (ревью круга 3, `yes`): один shell — 137 → 35 MB/s, два shell-а — 190 → 33 MB/s; один worker
  разбирает ~34 MB/s.
- Владелец принял это замедление для PR #512 на обеих системах; ускорение — этот Ticket.
- **Долг ревью круга 3 PR #512 (low):** `resume` в `dispose()` — вызов `letOutputFlow()`
  (`cursor-answers.ts:253`) — без test-а: мутант без него выживает.

## Что делаем

1. Разбор нескольких shell-ов параллельно: worker на shell или пул worker-ов (размер — по числу ядер,
   `os.availableParallelism()`, с верхним пределом). Выбор и довод — в «Итог», с замером обоих вариантов.
2. Back-pressure PR #512 остаётся: пауза pty выше `HIGH_WATER`, resume при `LOW_WATER`; `letOutputFlow` при
   отказе экрана, потере worker-а, `dispose`, `close()` и `release()` — как сейчас, для каждого worker-а.
3. Падение одного worker-а не трогает shell-ы других worker-ов: их ответы идут дальше.
4. Test на долг круга 3: `dispose()` shell-а, чей pty стоит на паузе, возобновляет его (`StandInPty`,
   `test/contract/terminal-cursor.test.ts:26`); мутант без `letOutputFlow()` в `dispose()` — красный.

## Готово, когда

- [ ] Замер на ПК и на Mac тем же способом, что в «Итог» Ticket-а 39 (1, 2 и 4 shell-а, MB/s, CPU, отказы,
      время ответа на `ESC[6n`), для main до правки и для ветки — таблица в «Итог». Один shell — не
      медленнее, чем сейчас; 2 и 4 shell-а — скорость всего вывода растёт с числом shell-ов.
- [ ] Ни одного отказа экрана («refused output») под flood-ом 4 shell-ов; test «60 MB printed at once…»
      зелёный.
- [ ] Test пункта 4 красный на мутанте; test «падение одного worker-а не трогает другой shell» красный на
      мутанте, где падение снимает все shell-ы.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full на Mac и вердикт ПК — платформенный PR
      (ADR-0056, пункт 2): меняет поведение Terminal на Windows.

## Тесты

- `test/contract/terminal-cursor.test.ts`: dispose с pty на паузе (пункт 4); два shell-а на разных
  worker-ах — падение одного не мешает ответу другому; flood двух shell-ов — оба получают ответ на `ESC[6n`
  после flood-а.
- Существующие test-ы back-pressure — без изменений смысла.

## Где в коде

- `src/main/terminal/cursor-answers.ts` — `WORKER_CODE` (`:77`), `ScreenWorker` (`:129`), `screenWorkerOf`
  (`:188`), `CursorAnswers` (`:191`), `dispose` (`:249-254`).
- `test/contract/terminal-cursor.test.ts`.
- `test/fixtures/headless-silent.cjs`, `test/fixtures/headless-exits.cjs` — stand-in worker-ы, если нужен
  новый.

## Вне скоупа

- Ответы на другие запросы без view и их удвоение — [Ticket 68](68-ответы-на-запросы-программ-без-view-и-удвоение.md).
- Скорость самого xterm.js (разбор дешевле) — только если пул не даёт нужного; тогда отдельный Ticket.

## Риски

- Каждый worker грузит свой `@xterm/headless`: память растёт с числом shell-ов. Замерить RSS main с 1 и 8
  shell-ами.
- Порядок кусков вывода и resize одного shell-а должен сохраниться: все его сообщения — в один worker.

## Итог

Ветка `worfy-windows/67`, код — commit `f05bae2b` поверх `origin/main` `13bf92c9`.

### Что сделано

- **Выбор — пул worker-ов, по worker-у на shell до предела** (`src/main/terminal/cursor-answers.ts`,
  `screenWorkersLimit`, `SCREEN_WORKERS_MAX` = 8): предел — `min(os.availableParallelism(), 8)`. Пока
  worker-ов с экранами меньше предела, новый shell получает свой (пустой worker пула или новый);
  иначе садится в первый из worker-ов с наименьшим числом экранов. `screenWorker.limit` принимается,
  только если это целое ≥ 1 или Infinity; иначе — предел по умолчанию (ревью, круг 1). Worker с одним экраном и worker без предела дают одно и то же, поэтому
  оба варианта Ticket-а — одна реализация с одной настройкой (`screenWorker.limit`, для test-ов и
  замера): «worker на shell» — `limit` = ∞, «пул» — предел по умолчанию.
- Shell получает worker один раз, при создании `CursorAnswers`, и держит его до конца: все куски
  вывода и resize одного shell-а идут в один worker по порядку.
- Падение worker-а (`error`, `exit`) снимает только экраны этого worker-а: `lost()` — у каждого
  `ScreenWorker` свой. Новый shell на месте упавшего worker-а запускает новый.
- Worker стартует с первым экраном и кончается с последним, как раньше, — теперь у каждого свой.
- Back-pressure без изменений: `inFlight`, пауза выше `HIGH_WATER`, resume при `LOW_WATER`,
  `letOutputFlow` при отказе экрана, потере worker-а, `dispose`, `close()` и `release()` — всё в
  `CursorAnswers`, то есть на shell, в каком бы worker-е он ни был. Ответы main на запросы Ticket-а 68
  (`ESC[c`, DECRQM, DECRQSS) не тронуты: тот же `WORKER_CODE` и `isMainAnswer`.
- `shortcut:` — делёж сверх предела по числу экранов, а не по объёму вывода.

### Почему пул, а не worker на каждый shell без предела

- Замер Mac ниже: с 4 shell-ами (4 worker-а) main-поток уже занят на 95–97 %, и 8 worker-ов на 8
  shell-ов дают не больше, чем 4 worker-а на 8 shell-ов (110–112 против 113–115 MB/s). Дальше 4–8
  параллельных flood-ов скорость держит main-поток (`TerminalRegistry`, `ReplayBuffer`, рассылка
  подписчикам), а не worker-ы.
- Каждый worker — поток и свой `@xterm/headless`: RSS main без вывода с 8 shell-ами — 180–192 MB против
  133–134 MB на main (~7 MB на worker). Без предела 30 Terminal Node-ов — 30 потоков и ~200 MB сверху
  без выигрыша в скорости.
- 8 — а не 4: на ПК worker разбирает ~12 MB/s, а main-поток Windows при 4 shell-ах без экрана шёл
  на 16–20 % ядра (замер Ticket-а 39), то есть там main-поток прокормит больше worker-ов, чем на Mac.

### Замер Mac

Mac: Apple M5 Pro, 18 ядер (`availableParallelism` 18), Electron 44.5.1 (Node 24.21.0). Способ —
тот же, что в «Итог» Ticket-а 39: настоящий `TerminalRegistry`, программа в каждом shell-е — `yes`;
1.5 с разогрева, 5 с счёта, 3 круга; MB/s — символы у подписчика (MB = 10^6) за счёт; CPU main-потока
— `process.threadCpuUsage()`, процесса с worker-ами — `process.cpuUsage()`, в % одного ядра;
pause / resume — за 5 с счёта; «отказ» — предупреждения «refused output»; `ESC[6n` — 3 запроса на
shell за круг, дописаны в конец следующего куска, который node-pty отдаёт registry, время — до
записи ответа в pty; RSS — процесса в конце счёта. Скрипт — `scripts/terminal-flood-bench.mjs` (в
этой ветке, он же для ПК). main до правки — отдельный checkout `13bf92c9` (`--root`).

Нагрузка (запись перед каждым шагом, `uptime` и три верхних процесса):
- main 1/2/4: load 4.65; верх — `node` 257 % и `fseventsd` 184 % (хвост чужой работы).
- ветка, worker на shell, 1/2/4: load 5.90; шли чужие Electron test-ы `canvas-24` (~250 % на трёх
  процессах) — третий круг 2 shell-ов (56 MB/s против 67–70) вероятно под этой нагрузкой.
- ветка, пул по умолчанию, 1/2/4: load 7.23 (хвост), верх — WindowServer 17 %; дальше load 5.4–6.4,
  верх — WindowServer и worfy-stable до 25 %.

| Состояние | shell-ов | отказ | MB/s всего (на shell) | main-поток, % | процесс, % | pause / resume | ответ на `ESC[6n`, ms | RSS, MB |
|---|---|---|---|---|---|---|---|---|
| main `13bf92c9` (один worker) | 1 | 0/0/0 | 33.2 / 35.3 / 34.0 | 34.7 / 36.3 / 35.5 | 130 / 132 / 131 | 39/39, 41/41, 40/40 | 36–119 | 270–309 |
| main | 2 | 0/0/0 | 30.4 / 30.6 / 31.8 (15.1–16.1) | 31.6 / 31.6 / 33.1 | 130 / 130 / 132 | 43/42, 42/42, 42/44 | 74–250 | 382–384 |
| main | 4 | 0/0/0 | 30.2 / 30.1 / 28.5 (7.0–7.8) | 31.9 / 37.5 / 41.7 | 132 / 138 / 142 | 48/48, 45/45, 41/41 | 149–554 | 391–482 |
| main | 8 | 0/0/0 | 31.1 / 31.5 / 31.2 (3.7–4.4) | 30.2 / 32.1 / 30.0 | 132 / 133 / 131 | 48/50, 48/51, 48/51 | 247–1063 | 466–597 |
| ветка, worker на shell (`--screen-workers shell`) | 1 | 0/0/0 | 33.8 / 33.3 / 34.9 | 35.6 / 34.5 / 36.9 | 132 / 130 / 133 | 39/40, 39/40, 40/40 | 57–121 | 271–333 |
| ветка, worker на shell | 2 | 0/0/0 | 70.0 / 66.8 / 56.2 (28.0–35.1) | 59.4 / 57.5 / 60.0 | 253 / 252 / 250 | 79/81, 68/68, 48/46 | 36–115 | 431–446 |
| ветка, worker на shell | 4 | 0/0/0 | 126.0 / 119.6 / 127.5 (29.8–32.3) | 95.3 / 96.0 / 97.2 | 497 / 497 / 497 | 14/14, 32/32, 7/7 | 3–128 | 627–706 |
| ветка, worker на shell | 8 | 0/0/0 | 111.7 / 111.9 / 109.7 (13.7–14.0) | 97.1 / 97.2 / 97.1 | 561 / 568 / 568 | 0/0 | 1–2 | 528–546 |
| ветка, пул по умолчанию (предел 8) | 1 | 0/0/0 | 34.0 / 33.3 / 33.7 | 34.4 / 34.6 / 34.6 | 130 / 130 / 130 | 40/40, 39/39, 39/40 | 28–117 | 294–327 |
| ветка, пул по умолчанию | 2 | 0/0/0 | 69.5 / 69.8 / 68.3 (33.5–35.7) | 55.7 / 58.9 / 57.3 | 251 / 253 / 251 | 64/64, 77/77, 75/75 | 28–106 | 442–457 |
| ветка, пул по умолчанию | 4 | 0/0/0 | 128.7 / 128.3 / 126.0 (31.1–32.9) | 95.4 / 95.1 / 94.6 | 498 / 496 / 497 | 23/23, 29/29, 25/29 | 30–103 | 646–676 |
| ветка, пул из 4 (`--screen-workers 4`) | 8 | 0/0/0 | 112.9 / 113.8 / 114.8 (13.4–14.9) | 88.2 / 86.1 / 92.8 | 493 / 492 / 500 | 78/73, 89/87, 108/104 | 83–280 | 818–930 |
| ветка, пул из 2 (`--screen-workers 2`) | 4 | 0/0/0 | 63.1 / 64.5 / 62.5 (14.9–16.8) | 56.4 / 54.8 / 52.4 | 256 / 254 / 251 | 78/79, 89/88, 85/87 | 72–261 | 495–542 |

RSS main без вывода (`--program idle`: в shell-е `node -e` с таймером, 2 с счёта, 3 круга): main
`13bf92c9` — 1 shell 145 MB, 8 shell-ов 133–134 MB; ветка (пул по умолчанию) — 1 shell 145 MB,
8 shell-ов 180–192 MB.

- Один shell не медленнее: 33.3–34.9 MB/s на ветке против 33.2–35.3 на main.
- Скорость всего вывода растёт с числом shell-ов: 2 — 68–70 против 30–32 MB/s (×2.2), 4 — 126–129
  против 28–30 (×4.3); ответ на `ESC[6n` при 4 shell-ах — до 128 ms против до 554 ms, при 8 — 1–2 ms
  против до 1063 ms.
- Отказов экрана нет ни в одном круге, ни при 8 shell-ах. При 4 и 8 shell-ах верх — main-поток
  (95–97 %): это следующий предел, вне скоупа.
- `--program node` (метод ПК, `node -e` с бесконечной записью `y\n`) на Mac проверен одним кругом:
  1 shell — 34.5 MB/s, 2 — 68.9 MB/s, как с `yes`.

### Замер на ПК

Заполняет ПК на финальном head PR.

| Состояние | shell-ов | отказ | MB/s всего (на shell) | main-поток, % | процесс, % | pause / resume | ответ на `ESC[6n`, ms | RSS, MB |
|---|---|---|---|---|---|---|---|---|

Команды:

В checkout-е ветки после `pnpm install --frozen-lockfile`; на Windows программа по умолчанию —
`node.exe -e` с бесконечной записью `y\n` (`--program node`). main до правки — отдельный checkout на
`13bf92c9` со своими `node_modules`:

```
git worktree add --detach ..\worfy-67-main 13bf92c9
pnpm -C ..\worfy-67-main install --frozen-lockfile
node scripts/terminal-flood-bench.mjs --shells 1,2,4,8 --root ..\worfy-67-main
node scripts/terminal-flood-bench.mjs --shells 1,2,4,8 --screen-workers shell
node scripts/terminal-flood-bench.mjs --shells 1,2,4
node scripts/terminal-flood-bench.mjs --shells 8 --screen-workers 4
node scripts/terminal-flood-bench.mjs --program idle --shells 1,8 --seconds 2 --root ..\worfy-67-main
node scripts/terminal-flood-bench.mjs --program idle --shells 1,8 --seconds 2
git worktree remove ..\worfy-67-main
```

Каждая команда печатает таблицу в Markdown и нагрузку перед каждым числом shell-ов: на Windows —
занятость всех ядер за 1 с (`os.cpus()`), load average там всегда 0. Верхние процессы ПК записать
отдельно. Скрипт сам закрывает shell-ы в конце каждого круга и добивает их по pid. Запрос
`ESC[6n` вставлен в поток main-а, как в замере Ticket-а 39: консоль из пакета не шлёт его программе,
которая не PowerShell у prompt-а.

### Test-ы (`test/contract/terminal-cursor.test.ts`)

- «a pty paused for the screen is resumed when the shell exits on its own and its screen is taken
  apart (dispose)» — долг круга 3 PR #512. Мутант без `letOutputFlow()` в `dispose()` — красный.
- «two shells on different workers: the worker of one ends (a crash), and the other shell is still
  answered» — stand-in `test/fixtures/headless-exits-on-mark.cjs` (настоящий `@xterm/headless`, worker
  кончается на метке). Мутанты «падение снимает все shell-ы всех worker-ов» и «один worker на всех» —
  красные; на коде main — красный.
- «a flood of 2 / 4 shells at once…» — по 15 MB на shell разом: отказов нет, у каждого пауза, ответ
  `ESC[24;1R` после flood-а, весь вывод у подписчика.
- «with the default limit, as many shells as the limit (up to four here) each get a worker thread of
  their own» — stand-in отвечает `ESC[<threadId>;1R` на метку THREAD: разных потоков столько, сколько
  shell-ов; параллельность видна без замера времени. Мутант «один worker на всех» — красный.
- «past the limit a new shell shares the worker with the fewest screens…» — `limit` = 2, четыре
  shell-а: третий делит worker первого, четвёртый — второго (тот, где меньше экранов); падение
  worker-а первого снимает первый и третий, второй и четвёртый отвечают на `ESC[6n`; новый shell после
  падения получает новый поток и ответ. Мутанты «без предела» (`busy.length < limit` → `true`) и «самый
  загруженный» (`<` → `>` в reduce) — красные (ревью, круг 1).
- «the limit of the workers is one per core, at most SCREEN_WORKERS_MAX; screenWorker.limit replaces it
  only with a whole number of at least 1 or Infinity».
- «60 MB printed at once…» и остальные test-ы back-pressure не менялись и зелёные.

### Команды (Mac, worktree ветки)

- Все unit и contract test-ы модуля Terminal (29 файлов, импорт из `src/main/terminal/` и
  `terminal-profile-isolation`, `node-pty`, `packaging`, `terminal-replies`, `windows-verdict-scope`):
  `node scripts/vitest-electron.mjs <файлы>` → exit 0, 27 passed, 2 skipped; 746 test-ов passed.
- `test/contract/terminal-cursor.test.ts` → exit 0, 109 passed. С `cursor-answers.ts` main → exit 1
  (падение worker-а, предел worker-ов). Мутанты (файл возвращён копией, `cmp` чистый): dispose без
  `letOutputFlow`, падение снимает всех, один worker на всех — каждый exit 1, по 1 failed.
- `pnpm lint && pnpm typecheck && pnpm test` → exit 0 (470 файлов passed, 7 skipped).
- gate fast → exit 0, `[gate] green (fast)`.
- Gate full на Mac не гонялся: условие merge — `ci-ok` (ADR-0083). Платформенный PR (ADR-0056,
  пункт 2): меняет Terminal на Windows; замер ПК — командами выше.

