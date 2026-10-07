# 17 — Stop в Autopilot прерывает Session Orchestrator-а и его Background task-и

Type: task
Status: claimed — 2026-10-07
Blocked by: —
Source: замечание владельца 2026-10-07 («Поставь работу на паузу, мне кое че нужно сделать с ноутом», затем «я нажал на стоп но он продолжает, мб там еще есть?»); журнал Autopilot `2026-10-07T17-46-49-381Z-d32be6.jsonl`; [ADR-0029](../../../docs/adr/0029-autopilot-waits-for-background-tasks.md), пункты 5–6; [spec.md](../spec.md), этап 3

## Что происходит

Stop по замыслу ADR-0029 (пункты 5–6) не прерывает ход Orchestrator-а и не останавливает его
Background task-и. Владелец ждёт обратного.

- Кнопка «Stop autopilot» (`src/renderer/canvas/actions/AutopilotAction.tsx:100`, title «Stop
  Autopilot over <epic> after this step») вызывает `autopilot.stop` (`:83-85`, main —
  `src/main/ipc/autopilot.ts:27`). Комментарий `AutopilotAction.tsx:14` прямо говорит: Background task-и живут
  дальше, main вернёт Orchestrator-а после них.
- `Autopilot.stop` (`src/main/autopilot/run.ts:312-318`) подаёт в cycle `stop` с причиной
  `user-stop`. `end()` (`run.ts:630-655`) пишет `run-stopped` и, если живы Background task-и или идёт ход,
  включает linger (`:645-646`) и откладывает возврат Orchestrator-а (`:648`).
- `setUnattended(false)` при ходе или живых Background task-ах только ставит `entry.wanted = ATTENDED`
  (`src/main/agent/orchestrator.ts:234-235`). Orchestrator остаётся unattended Session в
  bypassPermissions вместе с Background task-ами. Конец Background task-а присылает task-notification, он начинает новый ход
  в той же Session, и `/epic-wave` идёт дальше, вплоть до merge.
- `interrupt()` и остановки Background task-ов на этом пути нет. `Session.interrupt()` вне хода ничего не делает
  (`src/main/agent/session.ts:406`); его зовёт только ручная кнопка Interrupt
  (`src/main/ipc/agent.ts:174`).
- Что было 2026-10-07 (журнал `…-d32be6`): 17:47:32 — Background task implementer-а Ticket-а 13
  `worfy-harness`; 18:05:52 — `run-stopped`, `user-stop`, с этим Background task-ом; 95 s Session жила
  unattended; 18:07:27 — процесс убит руками, `background-tasks []` и через 1 ms
  `orchestrator-returned`. Это сработал отложенный возврат: `Session.fail` → `relaunch`
  (`orchestrator.ts:388`, `:438-450`), новый процесс с `--resume`. Claude Code дописал в историю
  уведомление о брошенном Background task-е, ход им не начался.
- Повторный старт Autopilot не возобновит прерванный Ticket: `readyWave` пропускает Ticket-ы в
  состоянии `work` (`src/shared/workflow/waves.ts:170`). Кнопка ответит «No ready wave».

## Что делаем

Поведение «Stop = прервать» — только для причины `user-stop`. Остальные причины остановки ждут
Background task-и, как требует ADR-0029.

1. **`Session.halt()`** в `src/main/agent/session.ts`: ставит очередь на паузу, отказывает открытым
   permission-запросам; если идёт ход — `query.interrupt()` и ожидание `result`, `error` или `closed`,
   но не дольше `HALT_TURN_MS` (около 15 s). `stopTask` не нужен:
   - без объявления `perTaskStopAffordance` (worfy его не задаёт) interrupt во время хода сам
     убивает Background task-и (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1801-1802`);
   - закрытие процесса убивает остальные (`session.ts:478`).
2. **`giveBackNow(projectId)`** в `src/main/agent/orchestrator.ts`: `relaunch(entry, ATTENDED)`
   сразу, без `entry.wanted`, даже если state и список Background task-ов ещё не обновились. Закрытие старого
   процесса уносит всё, что пережило interrupt. Поднятый с `--resume` процесс только допишет
   уведомления о брошенных Background task-ах в историю, ход они не начинают.
3. **`end()` для `user-stop`** (`run.ts:630-655`) вместо linger и отложенного возврата:
   `run-stopped` (reason `user-stop`, `tasks`, `tickets` — Ticket-ы прерванной Wave, в уже
   существующем поле, `src/shared/autopilot/journal.ts:151`) → `dropQueuedWave` →
   `await session.halt()` → `tasks-killed` (reason `user-stop`), если Background task-и были живы →
   `giveBackNow` → `orchestrator-returned` → отпустить keep-awake. Номера Wave cycle передаёт в
   эффекте `stopped` (`src/shared/autopilot/cycle.ts:120`, `:133-135`): фаза к моменту `end()` уже
   `stopped`. В `RunSession` (`run.ts:60-67`) — `halt()`, в зависимостях Autopilot — `giveBackNow`;
   связать в `src/main/ipc/autopilot.ts`.
4. **Сообщения человека в очереди.** `halt` ставит очередь на паузу, `relaunch` передаёт её новой
   Session как есть (`session.ts:378-380`, `orchestrator.ts:442`). Сейчас после возврата такие
   сообщения уходят сами, после правки ждут «Send queued». Это записывается в ADR и проверяется
   test-ом.
5. **Продолжение с прерванного Ticket-а.** Поле `resumable: number[]` в `AutopilotState`
   (`src/shared/ipc/autopilot.ts:34`): Ticket-ы последнего `run-stopped` с `user-stop` этого Epic-а,
   которые всё ещё в `work`. `runWaveState` (`src/shared/actions/render-template.ts:129`) получает этот
   список и ставит такие Ticket-ы первой Wave раньше ready-набора. Список приходит во все три точки:
   кнопку в renderer (`src/renderer/canvas/actions/gates.ts:36`), проверку в main
   (`src/main/actions/launch.ts:197`) и событие `start` cycle-а (`cycle.ts:171-173`). `/epic-wave`
   такую Wave уже умеет возобновлять: в транскрипте 2026-10-07 он поднял implementer-а через
   SendMessage.
6. **UI.** Title кнопки — «Stop Autopilot over <epic>: interrupts the Orchestrator and its
   background tasks; worktrees stay» (`AutopilotAction.tsx:100` и `docs/design/F-SPEC.md:56`).
   Stop теперь длится до `HALT_TURN_MS`: пока он идёт, кнопка в состоянии «Stopping…» и не нажимается.
   Комментарий `AutopilotAction.tsx:14` — о новом поведении.
7. **Новый ADR** — следующий свободный номер в момент взятия Ticket-а (сейчас 0050). Заменяет пункты
   5–6 ADR-0029 и отвергнутый там вариант (`:102`) для `user-stop`; ADR-0029 не правится. В нём же:
   очередь сообщений после Stop держится; ручная кнопка Interrupt уже сейчас убивает
   implementer-ов по той же причине (`sdk.d.ts:1801-1802`), посылка ADR-0029 «Background task-и переживают
   остановку» для неё не выполнялась.

**Решено без владельца, подтвердить:**

- Stop бросает работу implementer-ов на полушаге: worktree и ветки остаются, но шаг (например
  merge) может остаться недоделанным. Этого и просит замечание; ADR-0029 запрещал ровно это.
- Background task-и убивает только `user-stop`. `background-stalled`, `wave-unfinished` и `limits-timeout`
  по-прежнему ждут их.
- Повторный старт берёт первой Wave только Ticket-ы из последнего `run-stopped` с `user-stop` этого
  Epic-а, а не любой Ticket в `work`: тот может вести человек руками.

Известный риск: implementer, убитый посреди e2e, не снимет замок `/tmp/worfy-e2e.lock` (trap на
EXIT не срабатывает при SIGKILL). Замок снимет следующий запуск, когда тот старше 30 минут.

## Готово, когда

- [ ] Contract `test/contract/agent-controls.test.ts`: `halt()` у Session в ходе вызывает interrupt и ждёт `result` не дольше `HALT_TURN_MS`; у idle Session interrupt не вызывает; после `halt()` очередь на паузе.
- [ ] Unit `test/unit/autopilot-run.test.ts`: Stop в фазе `tasks` и во время хода вызывает `halt` и `giveBackNow` по одному разу, linger не включается; `stop()` возвращает status `stopped`, reason `user-stop`; журнал по порядку — `run-stopped` (`user-stop`, `tasks`, `tickets` прерванной Wave), `tasks-killed` (`user-stop`), `orchestrator-returned`.
- [ ] Contract `test/contract/autopilot-background.test.ts`: сценарии `:360` и `:390` переписаны — после `stop()` записан `close`, `isUnattended(PROJECT)` false сразу после возврата `stop()`, power `['start', 'stop']`, после Stop ни одного нового prompt и message. `:424` и `:439` (ожидание последнего Background task-а после Stop) переписаны под новое поведение или удалены с причиной в «Итог»; `:601` переведён на причину `background-stalled`; `:526` не меняется.
- [ ] Contract `test/contract/autopilot.test.ts`: `:391` и `:464` переписаны — после Stop нового хода нет, повторный start принят сразу.
- [ ] Contract `test/contract/autopilot-background.test.ts`, новый сценарий: сообщение человека, поставленное в очередь до Stop, после возврата `stop()` лежит в очереди новой Session (`queued().items` — одно, `queued().paused` — true), и новых prompt нет.
- [ ] Unit `test/unit/autopilot-cycle.test.ts` и `test/unit/launch.test.ts`: `start` с `resume: [13]`, где Ticket 13 в `work`, даёт `wave-started` с Ticket-ом 13; `runWaveState` с `resumable` не отвечает «No ready wave».
- [ ] Unit `test/unit/canvas-actions.test.tsx`: кнопка Autopilot доступна при `resumable` и Ticket-е в `work`; title Stop — новый; пока `autopilot.stop` не вернулся, кнопка в «Stopping…» и не нажимается.
- [ ] e2e `test/e2e/autopilot.spec.ts` (локально, в gate full): сценарий `:358` переписан — после Stop `orchestrator-returned` приходит без `release()`, power `['start prevent-display-sleep', 'stop']`, повторный `autopilot.start` даёт ok.
- [ ] `grep -n "interrupts the Orchestrator" docs/design/F-SPEC.md src/renderer/canvas/actions/AutopilotAction.tsx` находит обе строки.
- [ ] ADR со следующим свободным номером записан.
- [ ] `~/.claude/hooks/gate.sh fast` — exit 0, строка `[gate]` говорит green.
- [ ] (вручную) Stable copy после влития: Autopilot над Wave с implementer-ом, Stop — за 15 s Orchestrator не начинает нового хода, процесса implementer-а нет (`ps`), в журнале `run-stopped`, `tasks-killed`, `orchestrator-returned`; повторный Autopilot берёт прерванный Ticket первым. Как проверить: окно приложения и журнал `~/Library/Application Support/worfy/autopilot/`.

## Тесты

Сначала падающие test-ы — переписанные `test/contract/autopilot-background.test.ts:360` (на нынешнем
main после `stop()` нет `close`, Orchestrator unattended) и `test/unit/autopilot-run.test.ts` (нет
`halt`). В «Итог» — как падали.

- `test/contract/agent-controls.test.ts` — `Session.halt`.
- `test/unit/autopilot-run.test.ts` — Stop, порядок журнала.
- `test/contract/autopilot-background.test.ts`, `test/contract/autopilot.test.ts` — прежние
  сценарии Stop под новое поведение; в первом ещё новый сценарий очереди сообщений после Stop.
- `test/unit/autopilot-cycle.test.ts`, `test/unit/launch.test.ts` — `resume`.
- `test/unit/canvas-actions.test.tsx` — кнопки.
- `test/e2e/autopilot.spec.ts` — `:358`.

## Где в коде

- `src/main/autopilot/run.ts`
- `src/main/agent/session.ts`
- `src/main/agent/orchestrator.ts`
- `src/main/ipc/autopilot.ts`
- `src/main/actions/launch.ts`
- `src/shared/ipc/autopilot.ts`
- `src/shared/autopilot/cycle.ts`
- `src/shared/autopilot/journal.ts`
- `src/shared/actions/render-template.ts`
- `src/renderer/canvas/actions/gates.ts`
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `docs/design/F-SPEC.md`
- `test/contract/agent-controls.test.ts`
- `test/contract/autopilot-background.test.ts`
- `test/contract/autopilot.test.ts`
- `test/unit/autopilot-run.test.ts`
- `test/unit/autopilot-cycle.test.ts`
- `test/unit/launch.test.ts`
- `test/unit/canvas-actions.test.tsx`
- `test/e2e/autopilot.spec.ts`

`journal.ts` — только шапка файла: поле `tickets` у `run-stopped` с `user-stop` и причина `user-stop`
у `tasks-killed`; схема не меняется. `src/main/agent/fake-query.ts` не меняется: `stopTask` не нужен.
Новый ADR — файл в `docs/adr`, номер известен при взятии. Общий файл с Ticket-ом 15 — `F-SPEC.md`,
15 идёт Wave-ой позже. С 13, 14 и 16 общих файлов нет.

## Итог

Заполняется при закрытии.
