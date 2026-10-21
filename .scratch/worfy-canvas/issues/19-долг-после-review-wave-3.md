# 19 — Долг после review Wave 3: PR #654, #656, #657, #659

Type: task
Status: open
Blocked by: —
Source: ревью PR [#654](https://github.com/IDSAD-XL/worfy/pull/654) (Ticket 14, архивные Node-ы вне Find,
истории и canvas MCP, круги 1–2), [#656](https://github.com/IDSAD-XL/worfy/pull/656) (Ticket 09, история
Session-ов и popover Archive, круги 1–3), [#657](https://github.com/IDSAD-XL/worfy/pull/657) (Ticket 05,
полоса и иконка типа в шапке Node-а, круги 1–2), [#659](https://github.com/IDSAD-XL/worfy/pull/659)
(follow-up Ticket-а 18, e2e перекрытия карточек), 2026-10-21. Все четыре влиты; строки — по main `d207756b`.

## Что происходит

Каждый пункт ниже — пробел, который ревью нашло и оставило на потом: test, которого нет, дублирование или
редкий случай, который ведёт себя не так. Находки low мерж не держали (правило глубины ревью владельца
2026-10-12). Первый пункт — настоящая ошибка вне диффов этих PR, ревью нашло её попутно.

## Что делаем

Закрыть каждый пункт правкой или test-ом. Если пункт оказался не нужен — строка в «Итог» с причиной.

**Ошибка вне диффов — первой:**

- [ ] `src/main/agent/node-sessions.ts:225-237`: на Resume внешней Session Node пересоздаётся без `keep`,
      `touchedAt` и `locked` — отметка Keep теряется. Архивный Node, который worfy запустил сам, на Resume
      остаётся в архиве, пока main не увидит Session живой.

**#654 (Ticket 14), low:**

- [ ] `src/shared/layout/types.ts:173`: `at` операции `archive` не ограничен текущим временем; нет test-а
      на отрицательное значение и на не-число.
- [ ] `src/renderer/canvas/history.ts:619`: нет test-а, что `sendInOrder` останавливается на первом отказе
      main.
- [ ] `history.ts:478`: нет test-а на ветку undo с закреплённым (pinned) Node-ом.
- [ ] `test/contract/canvas-tools.test.ts:41`: очередь mock-а `node:crypto` не очищается между test-ами.
- [ ] `src/renderer/canvas/show-node.ts` повторяет канал записанных операций из `Canvas.tsx` (send с
      `screenId` плюс `currentLayout`) без общей фабрики.
- [ ] Show архивного Node-а из sidebar-а и палитры на read-only экране не показывает подсказку (как на
      main для скрытого Node-а).

**#657 (Ticket 05), low:**

- [ ] Цвет типа объявлен трижды в файле каждого Node-а (`minimapColor`, литерал в `KindBand`, литерал
      tint); свести в одну константу KIND.
- [ ] У Node-ов React Flow нет `ariaLabel`, поэтому фокус по Tab попадает на безымянный «node»; ставить
      `node.ariaLabel` там, где строятся Node-ы React Flow.
- [ ] Комментарий в шапке `src/renderer/canvas/node-chrome.css` устарел.
- [ ] Test-ы: случаи regex `sessionLabel` (session не в начале, «Sessions…»); состояние, когда registry ещё
      не прочитан (`live === undefined`); сброс при уходе указателя ловит только e2e; порядок загрузки CSS
      в unit test-е — соглашение, к bundle-у не привязан.

**#656 (Ticket 09), low:**

- [ ] `src/renderer/canvas/overlays/ArchivePopover.tsx:73`: `sessionIds` создаётся заново на каждой ревизии
      Layout-а, поэтому неудачные transcript-ы спрашиваются снова на любой операции Layout-а; ключ — строка
      id.
- [ ] `SessionHistoryButton` живёт в `overlays/ArchivePopover.tsx`, но его импортируют `badges/` и
      `actions/`; вынести в свой модуль.
- [ ] `useCanvasStore` повторён в `ArchivePopover.tsx` и `TicketActions.tsx`.
- [ ] `ArchiveOps` выписан руками вместо `Pick<LayoutOps,'apply'>` (`Pick` ломал typecheck node test-ов);
      найти способ только на уровне типов.
- [ ] `src/renderer/binding/store.ts`: `manualError` не очищается, когда Binding-и приходят (на поведение
      сейчас не влияет).
- [ ] Нет test-а уровня popover-а на «Restore all from today» для скрытого Node-а.

**#659 (follow-up Ticket-а 18), low:**

- [ ] `expectSettledWithoutOverlaps` (`test/e2e/helpers.ts:820`) без своего test-а и проходит на пустом
      списке и на прямоугольниках нулевого размера; добавить guard-ы.
- [ ] `helpers.ts:801`: `querySelector` молча берёт первое совпадение; требовать ровно одно.
- [ ] Другие e2e всё ещё читают несколько прямоугольников по одному: `epic-frame.spec.ts:888-898` и `:523`,
      `tidy-up.spec.ts:112`, `no-overlap.spec.ts:128/140/196/258`, `selection-toolbar-frame.spec.ts:163`
      и `:186-201`, `done-stack.spec.ts:96`.

**Flaky test в полных прогонах:**

- [ ] `test/contract/workflow-reader.test.ts` (test file watcher-а) дважды упал в полном `pnpm test` у
      implementer-ов под нагрузкой и прошёл отдельно.

## Готово, когда

- [ ] Каждый пункт выше исправлен или осознанно закрыт с причиной в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `src/main/agent/node-sessions.ts`
- `src/shared/layout/types.ts`, `src/renderer/canvas/history.ts`, `src/renderer/canvas/show-node.ts`,
  `src/renderer/canvas/Canvas.tsx`, `test/contract/canvas-tools.test.ts`
- `src/renderer/canvas/kind-icons.tsx`, `src/renderer/canvas/nodes/`, `src/renderer/canvas/node-chrome.css`
- `src/renderer/canvas/overlays/ArchivePopover.tsx`, `src/renderer/canvas/archive-list.ts`,
  `src/renderer/binding/store.ts`
- `test/e2e/helpers.ts` и spec-и из пункта #659
- `test/contract/workflow-reader.test.ts`

## Итог

Заполняется при закрытии.
