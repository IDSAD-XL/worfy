# 12 — Закреплённый Node: не под миникартой, toolbar выделения не поверх

Type: task
Status: done — 2026-10-06, [PR #52](https://github.com/IDSAD-XL/worfy/pull/52)
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

- [x] Воспроизведение e2e-ом и снимки до правки — в «Итог».
- [x] Закреплённый Node, сдвинутый к углу миникарты, остаётся вне её: e2e проверяет, что пересечение их boundingBox равно 0.
- [x] Когда выделен другой Node, toolbar выделения не закрывает закреплённый Node: `elementFromPoint` в центре его заголовка возвращает сам Node.
- [x] Toolbar выделенного закреплённого Node-а виден: `elementFromPoint` в центре toolbar возвращает toolbar.
- [x] CanvasMenu и BindingDrop по-прежнему поверх: существующие e2e зелёные (`GATE_SCOPE=all gate.sh full` — код 0, в том числе `binding.spec.ts` и `terminal.spec.ts`, где открывается меню Canvas).
- [x] Снимки в светлой и тёмной теме сверены с F-SPEC (с палитрой тем: отдельных требований к этим элементам в F-SPEC нет — см. «Итог»).

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

## Итог

### Воспроизведение до правки

Два новых e2e в `test/e2e/pin-tags.spec.ts`, прогнанные на коде `origin/main` 0c9a5ee, оба красные:

- «a pinned Node moved into the corner of the minimap is shown clear of it»: Node, сохранённый в
  `x 5000, y 5000`, зажимался в правый нижний угол Canvas и уходил под миникарту — площадь
  пересечения boundingBox Node-а и `.react-flow__minimap` 21210 px² (ожидалось 0).
- «the toolbars of another Node's selection do not cover a pinned Node…»: при выделенном
  незакреплённом Node-е `elementFromPoint` в центре пересечения его toolbar выделения с
  закреплённым Node-ом возвращал кнопку toolbar, а не закреплённый Node; кнопка Focus
  закрывала заголовок второго закреплённого Node-а.

Снимки сняты 2026-10-06 теми же e2e в светлой и тёмной теме. «До» — во временном worktree на
`origin/main` 66a34a5, куда скопирован только новый `pin-tags.spec.ts`; «после» — на ветке
`worfy-daily/12`, перебазированной на 66a34a5.

- До правки, закреплённый Node в углу миникарты:
  [светлая](../evidence/12-pinned-by-minimap-before-light.png),
  [тёмная](../evidence/12-pinned-by-minimap-before-dark.png). Пунктирная рамка закреплённого
  Node-а выглядывает из-под миникарты в правом нижнем углу.
- До правки, toolbar другого выделения:
  [светлая](../evidence/12-toolbar-by-pinned-before-light.png),
  [тёмная](../evidence/12-toolbar-by-pinned-before-dark.png). Кнопка Pin toolbar выделения лежит
  поверх низа закреплённого Node-а `above`, кнопка Focus — поверх заголовка закреплённого Node-а
  `below`. Снимка своего toolbar закреплённого Node-а «до» нет: test падает раньше, на
  `elementFromPoint` (строка 391).
- После правки, угол миникарты:
  [светлая](../evidence/12-pinned-by-minimap-after-light.png),
  [тёмная](../evidence/12-pinned-by-minimap-after-dark.png). Node стоит над миникартой, с
  зазором.
- После правки, toolbar другого выделения:
  [светлая](../evidence/12-toolbar-by-pinned-after-light.png),
  [тёмная](../evidence/12-toolbar-by-pinned-after-dark.png). Закреплённые Node-ы лежат поверх
  toolbar и кнопки Focus.
- После правки, свой toolbar закреплённого Node-а:
  [светлая](../evidence/12-pinned-own-toolbar-after-light.png),
  [тёмная](../evidence/12-pinned-own-toolbar-after-dark.png). Toolbar выделенного закреплённого
  Node-а `above` лежит поверх закреплённого Node-а `top`, кнопка Focus — поверх `other`.

### Причина

- Миникарта — панель React Flow с `z-index: 5` поверх `.react-flow__renderer` (`z-index: 4`), где
  живут все Node-ы. Зажим (`pinning.ts`) знал только границы Canvas.
- `NodeToolbar` из `@xyflow/react` рисуется порталом в `.react-flow__renderer`, рядом с
  `.react-flow__viewport` (`z-index: 2`, у него `transform`, то есть свой контекст наложения), с
  `z-index` = z Node-а + 1. Любой toolbar поэтому лежал над всеми Node-ами плоскости, включая
  закреплённые с их `PINNED_Z_INDEX = 1000`: z закреплённого Node-а действует только внутри
  viewport.

### Что сделано

- `pinning.ts`: зажим закреплённого Node-а после границ Canvas выводит его из угла миникарты
  (`CanvasSize.minimap`) — коротким из двух путей, влево или вверх, тем, что помещается в Canvas;
  касание краем — не пересечение; если не помещается ни один путь, Node остаётся как был.
  Угол — миникарта 200×150 с рамкой 1 px, отступ панели 15 px до краёв Canvas и столько же до
  Node-а: 232×182. Пока миникарта скрыта (View ▸ Show Minimap), угла нет. Pin, Unpin, React
  Flow-овский Node и `NodeChrome` считают место одним зажимом, поэтому Unpin кладёт Node туда, где
  он виден.
- `MiniMapOverlay.tsx` сообщает угол в `pinning.ts` (`setMinimapCorner`), пока миникарта показана.
- Toolbar выделения (`SelectionToolbar.tsx`) и кнопка Focus (`FocusEntry.tsx`) рисуются не через
  `NodeToolbar`, а через `ViewportPortal` — внутри viewport, среди Node-ов, в экранном размере при
  любом zoom (`usePlaneToolbar`, `planeToolbarStyle` в `pinning.ts`). Их z: `PINNED_Z_INDEX - 1`,
  если в выделении нет закреплённого Node-а (над невыделенными Node-ами плоскости, под
  закреплёнными), и z выделения + 1, если есть (над всем, в том числе над другими закреплёнными).
  Сам выделенный Node toolbar не перекрывает: тот стоит вне прямоугольника выделения.
- CanvasMenu (порталом в документ, `zIndex 90`) и меню BindingDrop (`2000`) не тронуты. Контур
  BindingDrop (`zIndex 1000` в `ViewportPortal`) теперь выше toolbar незакреплённого выделения;
  до правки toolbar лежал над ним.

### Проверки

- `test/unit/pinning.test.tsx`: вывод из угла миникарты (оба пути, выбор короткого, касание, Node
  не помещается, размер Canvas неизвестен, Pin/Unpin и `placePinned`) и `planeToolbarStyle` (z,
  положение при zoom 2, pointer events, пустое выделение). Новые тесты на вывод из угла падали до
  правки (5 из 5).
- `test/e2e/pin-tags.spec.ts`: пересечение с миникартой 0 и возврат в угол при скрытой миникарте;
  `elementFromPoint` под toolbar другого выделения — закреплённый Node, под Focus — заголовок
  закреплённого Node-а; toolbar выделенного закреплённого Node-а — над другим закреплённым Node-ом
  и над незакреплённым. Мутант «z toolbar всегда `PINNED_Z_INDEX - 1`» этот test краснит.
- Снимки в светлой и тёмной теме (`pinned-by-minimap-*`, `toolbar-by-pinned-*`,
  `pinned-own-toolbar-*`) просмотрены: цвета toolbar, рамок закреплённого Node-а и миникарты не
  изменились. Отдельных требований к закреплённому Node-у, миникарте и toolbar выделения в
  `docs/design/F-SPEC.md` нет; сверка — с его палитрой тем.

### Что изменилось для пользователя

- Toolbar выделения, который попадает на закреплённый Node, теперь уходит под него: кнопки под
  закреплённым Node-ом не нажать мышью: Delete и Focus остаются на клавишах (Delete, ⌘↩), Pin,
  Add tag и остальное — после сдвига Canvas. Это и есть требуемый порядок слоёв.
- Закреплённый Node, сохранённый в углу миникарты, показывается выше или левее, пока миникарта
  видна; сохранённое место в Layout не меняется, пока его не открепят.
