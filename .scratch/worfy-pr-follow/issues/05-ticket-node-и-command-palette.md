# 05 — Ticket Node и Command palette: кнопка по первой причине PR с меню ▾ и строки palette

Type: task
Status: done 2026-11-18T18:39Z
PR: #2009
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Решение» → «Поток пользователя», B; «Как это выглядит»; «Решения по
реализации», 3; «Решено без владельца», 5

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium`; снимок экрана Ticket Node с меню.

## Что происходит

- На Ticket Node видны badge открытых нитей и «changes requested» (`src/renderer/canvas/badges/ReviewThreads.tsx:11-15`)
  и флаг rework (`src/renderer/pipeline/Stepper.tsx:182-186`); щелчок по badge открывает Pull requests, и только.
- Кнопки на Ticket и Epic — слоты `src/renderer/canvas/actions/<Name>.tsx`, добавляются по файлу
  (`src/renderer/canvas/badges/index.ts:1-12`). «Open PR» с меню — образец кнопки с меню
  (`src/renderer/canvas/actions/OpenPr.tsx:1-14`).
- PR Ticket-а в snapshot PR inbox находит `reviewsByTicket` (`src/renderer/canvas/badges/review-threads.ts:50-70`) по
  `ticketOfRow` (`src/renderer/pr-inbox/usePrInbox.ts:180`).
- Кнопка и строка palette не расходятся, потому что обе спрашивают `src/renderer/canvas/actions/gates.ts:1-3`. Строка
  Ship ticket в palette — `src/renderer/palette/commands.ts:325-341`.
- Новая Session Node встаёт у Ticket-а через `near` (`src/shared/ipc/actions.ts:23-27`).
- Английские страницы: таблица действий Canvas — `docs/features/workflow.md:103-104`; строки palette —
  `docs/features/app-shell.md:129`, `:140`.

## Что делаем

1. Новый слот `src/renderer/canvas/actions/PrFollow.tsx`: на Ticket-е, PR которого есть в snapshot PR inbox и которому
   функция Ticket-а 01 даёт причину, — одна кнопка по первой причине (Resolve conflicts → Fix checks → Address
   comments) и меню ▾ с остальными. PR нет в snapshot или PR inbox выключен (`"prInbox": false`) — кнопки нет.
2. Ticket с PR в нескольких репозиториях (ADR-0104): пункт меню на каждый PR, как у «Open PR».
3. Щелчок — `actions.prFollow` с `near` справа от колонки рамок на высоте Ticket-а, как у Ship ticket.
4. Состояние кнопки и строки — hook `usePrFollowState` Ticket-а 01 (`src/renderer/canvas/actions/gates.ts`); своей
   копии нет.
5. Command palette: строки «Fix checks owner/web#118», «Resolve conflicts …», «Address comments …». Новый вид
   `CommandGate` `pr-follow` (`src/renderer/palette/commands.ts:91-93`); `buildCommands` (`:727`) получает snapshot
   PR inbox; строку рисует `src/renderer/palette/CommandPalette.tsx:251-264`, где сейчас две ветки — Ship ticket и
   Run wave. Неактивная строка — серая, с причиной, как у Ship ticket.
6. Английские страницы: строка действия в таблице `docs/features/workflow.md` и строки palette в
   `docs/features/app-shell.md`. Перевод — Ticket 06.

## Готово, когда

- [ ] Unit test (`test/unit/canvas-actions.test.tsx`): Ticket с PR в `DIRTY` и красным CI — кнопка Resolve conflicts и в
      меню Fix checks; PR без причин — кнопки нет; PR inbox выключен — кнопки нет.
  - evidence: test-run pass · `pnpm test test/unit/canvas-actions.test.tsx test/unit/pr-follow-choices.test.tsx` exit 0 · mac - · 208de743da7ac3ac4e1385230cb8090e40c6cbb6
  - evidence: test-run pass · `pnpm test test/unit/canvas-actions.test.tsx test/unit/pr-follow-choices.test.tsx` exit 0 · mac - · 5bd4948c6f615c9794b01a3417e4b0719daf2c83
  - evidence: review pass · PR #2009 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test (`test/unit/palette-commands.test.tsx`): строки palette совпадают с кнопкой — те же действия и те же
      причины отказа.
  - evidence: test-run pass · `pnpm test test/unit/palette-commands.test.tsx` exit 0 · mac - · 208de743da7ac3ac4e1385230cb8090e40c6cbb6
  - evidence: test-run pass · `pnpm test test/unit/palette-commands.test.tsx` exit 0 · mac - · 5bd4948c6f615c9794b01a3417e4b0719daf2c83
  - evidence: review pass · PR #2009 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] e2e test рядом с `test/e2e/ship-ticket.spec.ts` (gh stub): у Ticket-а нет Session с Binding-ом; щелчок Resolve
      conflicts на Ticket Node создаёт новую Session Node у Ticket-а, её первое сообщение —
      `/worfy:pr-fix conflicts <repo>#<N> <sha>` с head из stub-а. Путь в Session с Binding-ом проверяет contract test
      Ticket-а 01.
  - evidence: review pass · PR #2009 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Снимок экрана Ticket Node с меню — в «Итог» (снимок ревью — в scratchpad).
  - evidence: review pass · PR #2009 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Английские страницы `docs/features/workflow.md` и `docs/features/app-shell.md` описывают действие.
  - evidence: commit pass · worfy-pr-follow/05: pull request actions on the Ticket Node and in the Command palette · - - · 208de743da7ac3ac4e1385230cb8090e40c6cbb6
  - evidence: review pass · PR #2009 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44365821923/job/135040635296 · ci - · 21caee9f33b91d696e035d75637aef06bfb0758e

## Где в коде

- `src/renderer/canvas/actions/PrFollow.tsx` (новый)
- `src/renderer/palette/commands.ts`, `src/renderer/palette/CommandPalette.tsx`
- `test/unit/canvas-actions.test.tsx`, `test/unit/palette-commands.test.tsx`
- `test/e2e/` (новый test рядом с `ship-ticket.spec.ts`)
- `docs/features/workflow.md`, `docs/features/app-shell.md`

Только читать: `src/shared/actions/pr-follow.ts` (Ticket 01), `src/renderer/canvas/actions/OpenPr.tsx`,
`src/renderer/canvas/actions/gates.ts`, `src/renderer/canvas/badges/review-threads.ts`.

## Вне скоупа

- Badge «Watching» на Session Node — часть 2. Pull requests — Ticket 04.
