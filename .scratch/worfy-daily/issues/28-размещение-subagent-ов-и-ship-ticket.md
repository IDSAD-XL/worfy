# 28 — Размещение Node-ов Subagent-ов и Session из «Ship ticket»

Type: task
Status: open
Blocked by: 06, 07, 08, 09, 10, 23
Source: [spec.md](../spec.md), тема C, риск 10; ручные проверки 2026-10-06, ночь — Ticket 15 worfy-mvp (`.scratch/worfy-mvp/issues/15-дерево-subagent-ов.md:145`) и Ticket 23 worfy-mvp (`.scratch/worfy-mvp/issues/23-ship-ticket-run-wave-open-pr.md:143`); HANDOFF, «Риски и долги»

## Что делаем

Два дефекта размещения новых Node-ов. Третий из тех же проверок — Terminal под свёрнутой рамкой
Epic-а — исправляет Ticket 10.

**1. Node-ы Subagent-ов ложатся поверх других Node-ов.** Дерево Subagent-ов ставится вплотную справа
от Node-а Session. Автоматическое место считается только относительно Session
(`placeSubagents`, `src/renderer/canvas/sources/subagents.ts:133`), свободное место не ищется. На
проверке два Node-а Subagent-ов и стопка «2 done» легли поверх Card «Вопрос».

Правка: автоматическое место дерева не перекрывает другие Node-ы Canvas. Сложность: смещение,
которое пользователь задал перетаскиванием (`offset:<key>`), хранится относительно автоматического
места (`subagents.ts:140-141`). Если автоматическое место обходит другие Node-ы, оно сдвигается,
когда двигают Card, и перетащенный Node уезжает вместе с ним. Требование: перетащенный Node
Subagent-а не сдвигается, когда двигают другие Node-ы, кроме его Session. Как этого добиться —
например, считать автоматическое место один раз, при появлении Node-а, — решает Ticket. Выбор — в
«Итог».

**2. Session из «Ship ticket» встаёт далеко от Ticket-а.** «Ship ticket» создаёт Node Session через
`sessions.create` (`src/main/actions/launch.ts:115`), а тот ищет свободное место по всему Canvas
(`placeNewNode`, `src/main/agent/node-sessions.ts:74`). На проверке Node встал на y ≈ 2466 при
Ticket-е на y ≈ 1054. При zoom 0.6 оба Node-а и линия между ними не помещаются на экран.

Правка: Session из «Ship ticket» встаёт на свободное место рядом со своим Ticket-ом. Где нарисован
Ticket, сейчас знает только renderer: Ticket-ы раскладывают рамки Epic (риск 10 в spec.md). Поэтому
запрос `actions.shipTicket` из renderer несёт место Ticket-а на Canvas, а main ищет свободное место
рядом с ним. Если ADR Ticket-а 10 даёт main место Ticket-а (вариант (а)) или переносит размещение
новых Node-ов в renderer (вариант (в)), Ticket следует этому решению. Выбор — в «Итог».

## Готово, когда

- [ ] Session с двумя Subagent-ами и Card справа от неё: автоматические места Node-ов Subagent-ов и стопки done не пересекаются с Card и другими Node-ами. Unit-test размещения на фикстуре Layout.
- [ ] Перетащенный Node Subagent-а остаётся на месте, когда двигают Card рядом с ним: unit-test сравнивает его координаты на Canvas до и после.
- [ ] «Ship ticket» на фикстуре, где Ticket лежит далеко от первого свободного места Canvas, а рядом с рамкой его Epic-а место есть: Node Session не пересекается с другими Node-ами и рамками, а зазор между ним и Ticket-ом не больше ширины Node-а Session. e2e.
- [ ] Снимки Canvas с деревом Subagent-ов и после «Ship ticket» в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/unit/subagent-nodes.test.tsx` — места дерева рядом с Card, перетащенный Node.
- `test/unit/layout-place.test.ts` — свободное место рядом с заданным местом.
- `test/contract/node-sessions.test.ts` — новая Session рядом с заданным местом.
- `test/e2e/ship-ticket.spec.ts` — Node Session рядом с Ticket-ом.
- Сначала падающий test: unit-test находит пересечение Node-а Subagent-а с Card справа от Session.

## Где в коде

Список покрывает все варианты ADR Ticket-а 10. После выбора лишнее убирается.

- `src/renderer/canvas/sources/subagents.ts`
- `src/renderer/canvas/actions/TicketActions.tsx`
- `src/shared/ipc/actions.ts`
- `src/main/ipc/actions.ts`
- `src/main/actions/launch.ts`
- `src/main/agent/node-sessions.ts`
- `src/main/layout/place.ts`
- `test/unit/subagent-nodes.test.tsx`
- `test/unit/layout-place.test.ts`
- `test/contract/node-sessions.test.ts`
- `test/e2e/ship-ticket.spec.ts`
