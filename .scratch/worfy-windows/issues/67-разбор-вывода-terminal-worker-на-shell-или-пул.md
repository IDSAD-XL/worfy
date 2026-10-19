# 67 — Разбор вывода Terminal в main: один worker на все shell-ы держит flood; worker на shell или пул

Type: task
Status: open
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

Заполняется при закрытии.
