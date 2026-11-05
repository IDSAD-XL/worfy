# 17 — Очередь в строке Autopilot и правка между Wave-ами

Type: task
Status: open
Blocked by: 10, 14, 16
Source: [spec.md](../spec.md), «Что видит владелец», п. 4–5; «Как работает» → «Очередь Epic-ов», «Виды»; «Решения владельца», 17, 18, 21; «Открытые вопросы», 2; [03](03-очередь-epic-ов.md), Q2, Q3, Q6

## Что происходит

- Строка Autopilot — `autopilotStatusLine` (`src/shared/ipc/autopilot.ts:221-…`): «Wave 1 · 2 background tasks»;
  Epic не назван — строка стоит на рамке своего Epic-а (`AutopilotAction.tsx:385`).
- После 14 состояние несёт `queue` и `index`, канал `autopilot.queue` есть.
- Меню «⋯» рамки Epic-а — Force stop и Run history (`AutopilotAction.tsx:449-475`).

## Что делаем

1. **Строка** Run-а очереди: «Epic 2/3: worfy-retry · Wave 1 · …»; на рамке Epic-а, который идёт сейчас. Рамка Epic-а,
   ждущего в очереди, — чип «In queue 3/3»; пропущенного — «Waits for owner».
2. **Меню «⋯»** рамки: «Add to queue» (Epic не в очереди, Run идёт), «Remove from queue» (Epic в очереди, не начат),
   «Run all accepted» (открывает окно Ticket-а 16). Правка во время Wave — «applies after this Wave».
3. Tooltip строки — список очереди со статусами.

## Готово, когда

- [ ] Unit test строки очереди и чипов: `done`, `running`, `next`, `waits-owner`, `elsewhere`.
- [ ] e2e: Run из двух Epic-ов fixture-а → строка «Epic 1/2» → «Add to queue» на третьем → после Wave — «Epic 1/3»;
      «Remove from queue» на втором → он не начат, `queue-changed` в журнале.
- [ ] Снимки строки и чипов в обеих темах — `../evidence/17-*.png`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/autopilot-queue-line.test.ts`, e2e `test/e2e/autopilot-queue.spec.ts` (новые).
- Сначала падающий: строка Run-а очереди без «Epic 1/2».

## Где в коде

- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `src/shared/ipc/autopilot.ts` (`autopilotStatusLine`)
- `test/unit/autopilot-queue-line.test.ts`, `test/e2e/autopilot-queue.spec.ts` (новые)

Только читать: `src/main/ipc/autopilot.ts`, `src/renderer/autopilot/StartAutopilotModal.tsx`.
