# 03 — Подсветка Family при наведении и выделении; кнопка «Show family»

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), решение владельца 9 (Session-ы не двигаются сами); исследование
[2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md), P4, вариант 4a.
Термин Family — `CONTEXT.md`. Код перечитан по main `7dab925f`.

## Что происходит

- Подсветка есть только у Edge-ей «Blocked by»: `src/renderer/canvas/edge-focus.ts:1-6` (worfy-week 05).
  Overlay `src/renderer/canvas/overlays/EdgeFocus.tsx:20` пишет туда Node под указателем и выделенные;
  `setEdgeFocus` — `edge-focus.ts:67`. Подсветка — состояние своего окна (ADR-0053).
- Связи известны: Binding (`src/shared/binding/resolve.ts:1-20`) и пунктир Binding-а
  (`src/renderer/canvas/sources/workflow-bindings.ts:1-6`), дерево Subagent-ов
  (`src/renderer/canvas/sources/subagents.ts`). Но Node-ы вне связи не тускнеют, и родственники за краем
  экрана не видны.
- Камера умеет охватить Epic (`focusEpic`, `src/renderer/canvas/sources/epics.ts:161`).

## Что делаем

1. **Family** — `src/renderer/canvas/family.ts` (новый), чистая функция от Binding-ов и деревьев
   Subagent-ов:
   - Ticket → он, его Epic frame, Session-ы с Binding к нему, их Subagent-ы;
   - Session → она, её Subagent-ы, её Ticket и его Epic frame (или её Epic frame);
   - Subagent → его Session и её Family;
   - Epic frame → он, его Ticket-ы, Session-ы с Binding к Epic-у или его Ticket-ам и их Subagent-ы.
2. **Подсветка.** Наведение или выделение одного из этих Node-ов: Family и её Binding-линии остаются
   яркими, остальные Node-ы тускнеют (непрозрачность около 30 %). Состояние — в `edge-focus.ts` рядом с
   Edge-ами, класс тусклости ставит `src/renderer/canvas/NodeChrome.tsx` по подписке на свой да/нет —
   Node перерисовывается, только когда меняется его ответ. Уход указателя и снятие выделения возвращают
   всё. Node-ы не двигаются, Layout не меняется, ⌘Z не участвует.
3. **«Show family»** — кнопка в панели выделения (`src/renderer/canvas/overlays/SelectionToolbar.tsx`),
   когда выделен один Node, у которого есть Family: камера охватывает всю Family, как `focusEpic`. Камера
   — своя у окна (ADR-0053).
4. Read-only экран (ADR-0066): подсветка и «Show family» работают — они ничего не пишут.
5. С «Reduce motion» тусклость меняется без анимации.

## Готово, когда

- [ ] Unit `test/unit/family.test.ts`: Family Ticket-а, Session, Subagent-а, Epic frame-а из фикстуры
      Binding-ов и дерева Subagent-ов; Session без Binding — Family из неё и её Subagent-ов.
- [ ] Unit `test/unit/edge-focus.test.tsx`: наведение на Ticket гасит Node-ы вне Family; Node, чей ответ не
      изменился, не перерисовывается (счётчик рендеров).
- [ ] e2e `test/e2e/family.spec.ts`: наведение на Session — её Ticket и Epic frame яркие, чужая Session
      тусклая; «Show family» охватывает Family камерой; во втором окне того же Project-а ничего не
      меняется; на read-only экране подсветка работает; снимок `family-hover` в обеих темах.
- [ ] Мутант красный: Family без Subagent-ов Session.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `family.test.ts` на Family Ticket-а.
- Unit `test/unit/family.test.ts` (новый), `test/unit/edge-focus.test.tsx`; e2e `test/e2e/family.spec.ts`
  (новый).

## Где в коде

- `src/renderer/canvas/family.ts` (новый)
- `src/renderer/canvas/edge-focus.ts` (`setEdgeFocus` `:67`)
- `src/renderer/canvas/overlays/EdgeFocus.tsx` (`:20`)
- `src/renderer/canvas/NodeChrome.tsx` (`NodeChrome` `:60`)
- `src/renderer/canvas/node-chrome.css`
- `src/renderer/canvas/overlays/SelectionToolbar.tsx`
- `test/unit/family.test.ts` (новый)
- `test/unit/edge-focus.test.tsx`
- `test/e2e/family.spec.ts` (новый)

Только чтение: `src/shared/binding/resolve.ts`, `src/renderer/canvas/sources/workflow-bindings.ts`,
`src/renderer/canvas/sources/subagents.ts`, `src/renderer/canvas/sources/epics.ts` (`focusEpic`).

## Вне скоупа

- Перемещение Node-ов к их Epic-у — Ticket-ы 11 и 12.
- Edge bundling и контуры групп (вариант 4e исследования).

## Итог

Заполняется при закрытии.
