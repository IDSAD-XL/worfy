# 12 — Закреплённый Node: не под миникартой, toolbar выделения не поверх

Type: task
Status: open
Blocked by: 06, 07, 08, 09
Source: [spec.md](../spec.md), тема C; [ADR-0013](../../../docs/adr/0013-pinned-node-screen-coordinates.md) — экранные координаты закреплённого Node-а; Ticket 29 worfy-mvp

## Что делаем

Закреплённый Node уезжает под миникарту, и над ним рисуется toolbar выделения.

**Что в коде:**

- `src/renderer/canvas/pinning.ts:44-58`: `clampAxis`, `insideCanvas` и `pinnedScreenPoint` зажимают
  экранную точку в границы Canvas. Прямоугольник миникарты при этом не учитывается.
- `placePinned` (`:91-106`) даёт закреплённому Node-у `zIndex PINNED_Z_INDEX = 1000` (`:22`).
- NodeToolbar стоит в `overlays/SelectionToolbar.tsx:221` (`Position.Top`, offset 12) и в
  `overlays/FocusEntry.tsx:59` (`Position.Bottom`). Своего z-index у них нет.
- Вероятно, z-index задаёт `@xyflow/react` через портал во viewport. Это не проверено.

**Первый шаг — воспроизвести e2e-ом**, без догадок: `elementFromPoint` в нужных точках и снимки до
правки. Итог — в «Итог».

**Правки:**

- Зажим закреплённого Node-а исключает прямоугольник миникарты
  (`src/renderer/canvas/overlays/MiniMapOverlay.tsx`).
- Порядок слоёв: toolbar выделения другого Node-а не закрывает закреплённый Node, а toolbar самого
  закреплённого Node-а виден. CanvasMenu (zIndex 90) и BindingDrop (1000 и 2000) остаются поверх,
  как сейчас.

## Готово, когда

- [ ] Воспроизведение e2e-ом и снимки до правки — в «Итог».
- [ ] Закреплённый Node, сдвинутый к углу миникарты, остаётся вне её: e2e проверяет, что пересечение их boundingBox равно 0.
- [ ] Когда выделен другой Node, toolbar выделения не закрывает закреплённый Node: `elementFromPoint` в центре его заголовка возвращает сам Node.
- [ ] Toolbar выделенного закреплённого Node-а виден: `elementFromPoint` в центре toolbar возвращает toolbar.
- [ ] CanvasMenu и BindingDrop по-прежнему поверх: существующие e2e зелёные.
- [ ] Снимки в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/unit/pinning.test.tsx` — зажим с прямоугольником миникарты.
- `test/e2e/pin-tags.spec.ts` — порядок слоёв через `elementFromPoint`.
- Сначала падающий test: у угла миникарты `pinnedScreenPoint` возвращает точку внутри неё.

## Где в коде

- `src/renderer/canvas/pinning.ts`
- `src/renderer/canvas/overlays/SelectionToolbar.tsx`
- `src/renderer/canvas/overlays/FocusEntry.tsx`
- `src/renderer/canvas/overlays/MiniMapOverlay.tsx`
- `src/renderer/canvas/node-chrome.css`
- `test/unit/pinning.test.tsx`
- `test/e2e/pin-tags.spec.ts`
