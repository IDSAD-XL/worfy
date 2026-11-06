# 16 — Очередь в окне запуска и «Run all accepted»

Type: task
Status: open
Blocked by: 11, 13, 14
Source: [spec.md](../spec.md), «Что видит владелец», п. 4; «Окно запуска (прототип)», вид «Queue»; «Решения владельца», 16; «Открытые вопросы», 2; [03](03-очередь-epic-ов.md), Q1

## Что происходит

- Окно запуска (Ticket-ы 09, 11) показывает один Epic; `autopilot.prepare` уже берёт `epics`, но дату принятия
  отдаёт `null`.
- Список принятых Epic-ов — `acceptedEpics` (Ticket 13); старт с `epics` — Ticket 14.
- Command palette — `buildCommands` (`src/renderer/palette/commands.ts:620`), рядом «Run history» (`open-run-history`,
  `:396`).

## Что делаем

1. **Вид «Queue» окна**: заголовок «Start Autopilot · N Epics, M Waves»; строка «N Epics are accepted and waiting.
   Autopilot runs them one after another.»; список `src/renderer/autopilot/QueueList.tsx` — галочка, номер, имя Epic-а,
   число Wave, «accepted <дата>»; перетаскивание и ⌥↑/⌥↓; «Ordered by acceptance date · drag to reorder, untick to
   drop»; прогноз и сетка — по отмеченным; ни одного отмеченного — старт недоступен.
2. **`autopilot.prepare`**: дата принятия и Wave-ы по каждому Epic-у; прогноз — сумма.
3. **«Run all accepted»** — команда Command palette: открывает окно с `acceptedEpics`; нет принятых — toast «No accepted
   Epic has a ready Ticket». Пункт в меню «⋯» рамки Epic-а — Ticket 17.
4. Просьба агента со списком (Ticket 15) — тот же вид «Queue» под строкой «Asked by …».

## Готово, когда

- [ ] Unit test списка: снять галочку, перетащить мышью и ⌥↑/⌥↓, прогноз пересчитан, пустой выбор — старт недоступен.
- [ ] Contract test `autopilot.prepare` с тремя Epic-ами: даты, Wave-ы, сумма прогноза.
- [ ] e2e: Command palette → «Run all accepted» → окно с тремя Epic-ами fixture-а → снять второй, первый и третий
      поменять местами → старт → `run-started.epics` в журнале — в новом порядке без снятого.
- [ ] Снимок вида «Queue» в обеих темах — `../evidence/16-*.png`.
  - evidence: screenshot pass · `../evidence/16-start-window-queue-light.png` · mac dev · d830ba0fc21f4eb0e88ed4d2d8a067b294b60667 · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/16-start-window-queue-dark.png` · mac dev · d830ba0fc21f4eb0e88ed4d2d8a067b294b60667 · scrub: 2026-11-07
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/queue-list.test.tsx` (новый); contract `test/contract/autopilot-prepare.test.ts`; e2e
  `test/e2e/autopilot-start-modal.spec.ts`.
- Сначала падающий: «Run all accepted» — нет команды.

## Где в коде

- `src/renderer/autopilot/StartAutopilotModal.tsx`, `src/renderer/autopilot/start-modal.ts`
- `src/renderer/autopilot/QueueList.tsx` (новый)
- `src/shared/ipc/autopilot-prepare.ts`, `src/main/ipc/autopilot-prepare.ts`, `src/main/autopilot/prepare.ts`
- `src/renderer/palette/commands.ts`
- `test/unit/queue-list.test.tsx` (новый), `test/contract/autopilot-prepare.test.ts`, `test/e2e/autopilot-start-modal.spec.ts`

Только читать: `src/shared/workflow/accepted-epics.ts`, прототип `card-918c77d9`.
