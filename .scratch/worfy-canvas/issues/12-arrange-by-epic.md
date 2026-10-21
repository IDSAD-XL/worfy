# 12 — Команда «Arrange by Epic»: Session-ы встают у своих Epic-ов одним шагом ⌘Z

Type: task
Status: claimed 2026-10-21T08:09Z
Branch: worfy-canvas/12
Blocked by: 01, 11
Source: [spec.md](../spec.md), решения владельца 9 и 10; исследование
[2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md), P4, вариант 4b,
шаг 2. Код перечитан по main `7dab925f`.

## Что происходит

- «Tidy up» (`src/renderer/canvas/tidy.ts:1-8`, `useTidyUp` `:151`) пакует Node-ы на плоскости рядами и
  шлёт один `moveMany`: один шаг ⌘Z. Он не знает Binding-ов: Session-ы одного Epic-а оказываются в разных
  местах.
- Команды — палитра (`src/renderer/palette/commands.ts`, «Tidy up» `:158`) и меню Canvas
  (`src/renderer/canvas/overlays/CanvasMenu.tsx`, «Tidy up» `:130`).
- Место новой Session у её Epic-а — `sessionSpot` Ticket-а 11.

## Что делаем

1. **Раскладка** — `src/renderer/canvas/arrange-by-epic.ts` (новый), чистая функция:
   - кластер Epic-а — его Session-ы (Binding к Epic-у или его Ticket-ам) с деревьями Subagent-ов;
   - кластеры встают колонкой справа от полосы рамок, каждый — на высоте своей рамки (правило
     `sessionSpot`); кластеры, которые налезают друг на друга, сдвигаются вниз;
   - Session-ы без Binding — кластер «Unbound» под остальными;
   - Node-ы с `pinned` и `keep` не двигаются (решение 10); Card, Note, Terminal, HANDOFF — тоже.
2. **Команда «Arrange by Epic»** — палитра и меню Canvas под «Tidy up». Один `moveMany` через LayoutOps —
   один шаг ⌘Z; main проверяет его, как любую операцию (ADR-0038). На read-only экране команды нет
   (неактивна с подсказкой, как «Tidy up»).
3. Повторная команда без изменений на Canvas ничего не двигает.

## Готово, когда

- [ ] Unit `test/unit/arrange-by-epic.test.ts`: кластеры по Binding; «Unbound» отдельно; `pinned` и `keep`
      на месте; повторный вызов на результате — пустой `moveMany`; кластеры не перекрываются.
- [ ] Unit `test/unit/palette-commands.test.tsx` и `test/unit/canvas-menu.test.tsx`: команда есть; на
      read-only экране — неактивна.
- [ ] e2e `test/e2e/arrange-by-epic.spec.ts`: Session-ы фикстуры встают у своих Epic-ов; ⌘Z возвращает всё
      одним шагом; второе окно видит те же места; снимок `arrange-by-epic` в обеих темах.
- [ ] Мутант красный: Node с `keep` двигается.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `arrange-by-epic.test.ts` на кластеры.
- Unit `test/unit/arrange-by-epic.test.ts` (новый), `test/unit/palette-commands.test.tsx`,
  `test/unit/canvas-menu.test.tsx`; e2e `test/e2e/arrange-by-epic.spec.ts` (новый).

## Где в коде

- `src/renderer/canvas/arrange-by-epic.ts` (новый)
- `src/renderer/palette/commands.ts` («Tidy up» `:158`)
- `src/renderer/canvas/overlays/CanvasMenu.tsx` («Tidy up» `:130`)
- `test/unit/arrange-by-epic.test.ts` (новый)
- `test/unit/palette-commands.test.tsx`
- `test/unit/canvas-menu.test.tsx`
- `test/e2e/arrange-by-epic.spec.ts` (новый)

Только чтение: `src/renderer/canvas/tidy.ts`, `src/renderer/canvas/session-spot.ts` (Ticket 11).

## Вне скоупа

- Автоматическое перемещение Session-ов без команды (решение 9).
- Док Session-ов внутри рамки и swimlanes (варианты 4c и 4d исследования).

## Итог

Заполняется при закрытии.
