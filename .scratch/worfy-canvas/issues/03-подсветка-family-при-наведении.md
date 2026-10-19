# 03 — Подсветка Family при наведении и выделении; кнопка «Show family»

Type: task
Status: done 2026-10-19T21:39Z
PR: #538
Branch: worfy-canvas/03
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

- [x] Unit `test/unit/family.test.ts`: Family Ticket-а, Session, Subagent-а, Epic frame-а из фикстуры
      Binding-ов и дерева Subagent-ов; Session без Binding — Family из неё и её Subagent-ов.
- [x] Unit `test/unit/edge-focus.test.tsx`: наведение на Ticket гасит Node-ы вне Family; Node, чей ответ не
      изменился, не перерисовывается (счётчик рендеров).
- [x] e2e `test/e2e/family.spec.ts`: наведение на Session — её Ticket и Epic frame яркие, чужая Session
      тусклая; «Show family» охватывает Family камерой; во втором окне того же Project-а ничего не
      меняется; на read-only экране подсветка работает; снимок `family-hover` в обеих темах.
- [x] Мутант красный: Family без Subagent-ов Session.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

Ветка `worfy-canvas/03`.

- `src/renderer/canvas/family.ts` — `familyOf(nodeId, links)`: Family Ticket-а, Session, Subagent-а,
  Epic frame-а; `null`, когда у Node-а нет родственника на Canvas (Note, Session без Binding и без
  Subagent-ов). Subagent, привязанный сам (implementer Wave), приносит в Family только себя и свою
  Session, без соседей. `familyLinksOf` читает связи из Node-ов React Flow: рамки, Ticket-ы, Session-ы,
  Subagent-ы и agent-anchor-ы Binding-ов (`sources/workflow-bindings.ts`). Файл не импортирует
  `workflow-bindings.ts` (React и stores тянут DOM-типы в `tsconfig.test.node.json`): тип anchor-а —
  литерал `FAMILY_ANCHOR_KIND`, равенство с `BINDING_ANCHOR_KIND` проверяет `edge-focus.test.tsx`.
  `family.ts` добавлен в `tsconfig.test.node.json`.
- `edge-focus.ts` — в store `family` (фокус и Family, `null` — ничего не тускнеет) и `links`;
  `useNodeDimmed(id)` — подписка Node-а на свой да/нет. `useAnyFocused` дополнительно рисует пунктир
  Binding-а, оба конца которого в Family (наведение на рамку показывает линии её Session-ов).
- `NodeChrome.tsx` кладёт маркер `.w-node-dimmed` прямым ребёнком Node-а; `node-chrome.css` через
  `:has()` ставит Node-у opacity 0.3, переход 120 ms, с Reduce motion — без перехода.
- «Show family» — последняя кнопка панели выделения при одном выделенном Node-е с Family: `fitView`
  по Family, приближение не больше текущего (как `focusEpic`), с Reduce motion — без анимации камеры.
  Ничего не пишет, на read-only экране активна.
- Тесты: `test/unit/family.test.ts` (7), `test/unit/edge-focus.test.tsx` (+5: тусклость, выделение,
  счётчик рендеров, линии Binding-ов, тип anchor-а), `test/e2e/family.spec.ts` (2: наведение на
  Session + «Show family» + второе окно; read-only экран Linked machine). Снимок `family-hover` —
  `test-results/snapshots/family-hover/{light,dark}.png`.
- Mutation testing: Family без Subagent-ов Session — 8 test-ов красные; подписка Node-а на весь набор
  Family — красный счётчик рендеров; линии без Family — красный test линий; без тусклости — 4 красных.

Круг 2 ревью (PR #538):

- Линия Binding-а с одним концом в Family: в fixture `edge-focus.test.tsx` добавлена Session C,
  привязанная к Epic-у; при наведении на Ticket её линия к рамке не рисуется (мутант `every` → `some`
  красный).
- `FamilySection`: unit `test/unit/show-family.test.tsx` — Note и два выделенных Node-а без кнопки,
  клик по Session вызывает `fitView` с id Family и `maxZoom` текущего zoom, с Reduce motion
  `duration: 0`; в `linked-read-only.test.tsx` кнопка активна на read-only экране рядом с неактивным Pin.
- Подписка на тусклость вынесена в `DimMarker` (`NodeChrome.tsx`): смена тусклости рисует заново
  только маркер, не содержимое Node-а (новый test со счётчиком рендеров содержимого).
- `family.ts` строит индексы связей один раз на объект `links` (WeakMap): Family стоит O(своего
  размера), а не O(Canvas) на каждый Node в фокусе.
- Комментарии про `showWith` (`StepEdge.tsx`, `edges/bindings.ts`, `workflow-bindings.ts`) дописаны
  правилом Family.
- Mutation testing круга 2: Family без Subagent-ов Session (10 красных), `every` → `some`, кнопка при
  нескольких выделенных, кнопка без Family, без `maxZoom`, без Reduce motion, подписка содержимого на
  тусклость — каждый красный.
