# 08 — Run: `background-stalled` — продолжение сообщением в ту же Session

Type: task
Status: open
Blocked by: 05
Source: [spec.md](../spec.md), «Ticket-ы», 8; «Лестница Run-а» (абзац под схемой); «Решения по реализации» → «Цикл и
Run: продолжение, отложить, `main-red`», пункт «`background-stalled` — сообщение в ту же Session»; «Решения по test-ам»,
Fault scenario 6; «Решено без владельца», 10 и 11

Кто: агент.

Не платформенный Ticket (main process Autopilot). Глубина ревью — `high`.

## Что происходит

- Run останавливается с `background-stalled`, когда background tasks Orchestrator-а час не дали ни события, ни изменения
  output file (`BACKGROUND_STALL_MS`, `src/shared/autopilot/cycle.ts:87`; решение — `cycle.ts:322–324`). После Ticket-а
  01 цикл на этом месте даёт `continue-tickets` с причиной `background-stalled`, после Ticket-а 05 Run исполняет
  продолжения для `wave-unfinished` и `no-progress`, но не для этой причины.
- Background tasks живут в процессе Session Orchestrator-а; после `tasks-timeout` Wave и сегодня идёт в текущую Session,
  а не в новую SDK session (`src/main/autopilot/run.ts:19–22`). Таймер задач — `run.ts:2844`, output files —
  `src/main/autopilot/task-output.ts`.
- ADR-0029 и ADR-0050: worfy не убивает background tasks и не прерывает ход по своей причине
  (`docs/adr/0029-autopilot-waits-for-background-tasks.md:71–73`,
  `docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md:81–83`).

## Что делаем

1. `continuation.ts` (Ticket 05): текст продолжения для `background-stalled` — `Continuation 1 of 2: background tasks
   impl-05 (61 min), gate fast (61 min) gave no sign of life. Check them. Let a task go on, or stop it and resume its
   ticket, or block the ticket.` Имена задач и минуты — из фактов Run-а; слов модели нет.
2. `run.ts`: `continue-tickets` с причиной `background-stalled` — сообщение в ту же Session Orchestrator-а, без новой SDK
   session; строка Journal `ticket-continued` с `cause: background-stalled`. Над потолком — `background-stalled`, как
   сегодня.
3. Fault scenario 6 на Claude Code и на Codex.
4. `docs/features/autopilot-faults.md` (строка `background-stalled` таблицы «Why a run stops») и
   `docs/features/autopilot.md`: продолжение сообщением, потом прежняя остановка.
5. Датированный Amendment к ADR-0029: при `background-stalled` Run до двух раз шлёт Orchestrator-у сообщение с фактами о
   задачах; задачи по-прежнему не трогает.

## Готово, когда

- [ ] Unit test `test/unit/autopilot-continuation.test.ts`: текст для `background-stalled` называет задачи и минуты, без
      `lastText`.
- [ ] Fault scenario 6 (contract): background task молчит дольше порога test-а → сообщение в ту же Session (тот же
      `sessionId`, нового SDK session нет), `ticket-continued` с `cause: background-stalled`, ни одна задача не
      остановлена; над потолком — `run-stopped` `background-stalled`.
- [ ] То же на Codex (`test/contract/autopilot-faults-codex.test.ts`).
- [ ] И1–И9 держатся (`test/autopilot-invariants.ts`).
- [ ] `docs/features/autopilot-faults.md` и `docs/features/autopilot.md` описывают продолжение при `background-stalled`;
      ADR-0029 — с датированным Amendment-ом.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- `test/unit/autopilot-continuation.test.ts`, `test/contract/autopilot-faults-ladder.test.ts` (Ticket 05),
  `test/contract/autopilot-faults-codex.test.ts` — каждый новый test сначала красный.

## Где в коде

- `src/main/autopilot/run.ts`
- `src/shared/autopilot/continuation.ts`
- `test/unit/autopilot-continuation.test.ts`
- `test/contract/autopilot-faults-ladder.test.ts`
- `test/contract/autopilot-faults-codex.test.ts`
- `test/fixtures/agent-scripts/`
- `docs/features/autopilot-faults.md`
- `docs/features/autopilot.md`
- `docs/adr/0029-autopilot-waits-for-background-tasks.md`

Только читать: `src/shared/autopilot/cycle.ts`, `src/main/autopilot/task-output.ts`,
`docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md`.

## Вне скоупа

- worfy не останавливает и не убивает background tasks (ADR-0029, ADR-0050).
- `turn-hung` — Ticket 09.
