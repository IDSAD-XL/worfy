# 12 — Правило очереди Epic-ов: дальше, пропуск или стоп

Type: task
Status: claimed 2026-11-06T09:46Z
Branch: worfy-autopilot-queue/12
Blocked by: —
Source: [spec.md](../spec.md), «Как работает» → «Очередь Epic-ов», «Правило»; «Решения владельца», 18, 20; «Решено без владельца», 6; «Риски», 6; [03](03-очередь-epic-ов.md), Q3, Q5

## Что происходит

- Цикл Epic-а останавливается причиной из `AUTOPILOT_STOP_REASONS` (`src/shared/autopilot/cycle.ts:43-62`). Конец
  Epic-а — `nothingReady` (`:230-234`): `tickets-done` у названных Ticket-ов, иначе `blocked-tickets` со списком или
  `no-ready-wave`.
- Ticket-ы модели знают `state`, `waits` (`src/shared/workflow/types.ts:35-37`), `readyWave` даёт `ready`, `waiting`,
  `skipped` (`src/shared/workflow/waves.ts:175-218`).

## Что делаем

Чистый модуль `src/shared/autopilot/epic-queue.ts`, без Node и DOM:

1. `epicOutcome(reason, tickets, epic)` → `{ kind: 'next', outcome: 'done' }` | `{ kind: 'next', outcome: 'waits-owner',
   tickets }` | `{ kind: 'stop' }`:
   - `done` — все Ticket-ы Epic-а `done` в checkout (не только в ветке, как `namedDone`);
   - `waits-owner` — `blocked-tickets` или `no-ready-wave`, и каждый не `done` Ticket ждёт владельца: `blocked` с
     `Waits: owner`, или его блокеры — только такие Ticket-ы; «не в Autopilot» — как решит `readyWave` сегодня
     (`skipped`);
   - всё остальное (`limits-timeout`, `no-progress`, `wave-unfinished`, ошибки, Stop, `window-too-short`) — `stop`.
2. `nextEpic(queue, index, outcomes)` — следующий не начатый Epic или `null`.
3. `MAX_QUEUE_EPICS = 10`.

## Готово, когда

- [ ] Unit test — таблица случаев: все `done`; один `blocked` `Waits: owner` и Ticket, ждущий его; `blocked` с `Waits:
      agent` — `stop`; `no-progress` (красный CI main) — `stop`; `limits-timeout` — `stop`; `tickets-done` у
      Run-а из одного Epic-а; Ticket `done` только в ветке — не `done`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/epic-queue.test.ts` (новый). Сначала падающий — модуля нет.

## Где в коде

- `src/shared/autopilot/epic-queue.ts`, `test/unit/epic-queue.test.ts` (новые)

Только читать: `src/shared/autopilot/cycle.ts`, `src/shared/workflow/waves.ts`, `src/shared/workflow/types.ts`.
