# 17 — В focus mode Browser страница не видна: `<webview>` остаётся на Canvas под слоем focus mode

Type: bug
Status: claimed 2026-10-24T21:56Z
Branch: worfy-browser/17
Blocked by: —
Source: владелец, 2026-10-25 (чат Mac-оркестратора)

## Что происходит

- Владелец, Mac, Stable собрана из `46d53eb3` (после него на main нет коммитов в код Browser). В focus mode
  (Node во весь экран) у Browser страницы «не грузятся».
- Страница Browser — это `<webview>` (элемент Electron со своей страницей), он создаётся в
  `src/renderer/canvas/overlays/BrowserLayer.tsx:208`. Все `<webview>` живут в одном слое внутри
  `ViewportPortal` React Flow (`BrowserLayer.tsx:293`) — слое, который двигается и масштабируется вместе
  с Canvas. Место и размер страницы считает `browserPageRect` (`src/renderer/canvas/nodes/browser-frame.ts:22`)
  по рамке Node на Canvas. Слой стоит под Node-ами, `z-index: -1` (`src/renderer/canvas/nodes/BrowserNode.css:205-210`);
  тело `BrowserNode` прозрачное — окно, через которое видна страница под ним.
- Focus mode (`src/renderer/focus/FocusMode.tsx:173`) рисует в своём tile второй экземпляр `BrowserNode`.
  Ничего в `src/renderer/focus/` про Browser не знает. Слой focus mode — `z-index: 1000` с непрозрачным
  фоном `var(--canvas)` (`src/renderer/focus/focus.css:11-14`). Canvas под ним остаётся смонтированным, только
  получает `inert` (не принимает ввод; `FocusMode.tsx:290-291`).
- Адресная строка tile-а ведёт в тот же `<webview>` на Canvas: `registerBrowserPage` (`BrowserLayer.tsx:144`)
  → `element.loadURL` (`BrowserLayer.tsx:105`). Значит, страница, скорее всего, грузится — но под
  непрозрачным слоем focus mode, а прозрачное тело tile-а показывает пустой фон. Вживую не подтверждено.
- Риски рядом:
  - Сон страницы. `useReportScreen` (`BrowserLayer.tsx:231`) сообщает main, какие Browser видны, по viewport
    Canvas. Browser, который на Canvas за краем экрана, а в focus mode на весь экран, main может усыпить
    (`src/main/browser/sleep.ts:101-105`; `focused` считается в `src/main/browser/live.ts:617`).
  - Два экземпляра `BrowserNode` делят один реестр страниц: снятие с учёта при unmount
    (`unregister()`, `BrowserLayer.tsx:167`). Закрытие одного экземпляра не должно снять страницу второго.
- Ни один test не проверяет Browser в focus mode: `test/unit/focus-mode.test.tsx`, `test/e2e/focus.spec.ts`,
  `test/e2e/focus-sidebar.spec.ts` про Browser node не говорят (слово «browser» там — только про событие
  клавиатуры и `BrowserWindow`).

## Что сделать

1. **Подтвердить e2e test-ом.** Открыть Browser в focus mode, перейти на страницу из адресной строки tile-а,
   проверить пиксели страницы внутри tile-а (helpers — `test/e2e/browser-pixels.ts`, пример —
   `test/e2e/browser-layer.spec.ts`). На текущем main test красный; в «Итог» — что именно видно (пустой фон
   или страница под слоем).
2. **Показать страницу в tile-е focus mode.** Два пути, выбрать в начале работы и записать выбор в «Итог»:
   - тот же `<webview>` на время focus mode ставится поверх tile-а (свои место, размер и `z-index` над слоем
     focus mode);
   - отдельный показ для focus mode, в который `<webview>` переносится.
   Условия для обоих: страница не перезагружается (тот же `<webview>`, без нового `src`); проверки пикселей на
   Canvas (`browser-layer.spec.ts`) остаются зелёными.
3. **Сон.** Browser, показанный в focus mode, считается видимым для `sleep.ts`, даже если на Canvas он за
   краем экрана.
4. **Выход из focus mode.** Страница возвращается в карточку на Canvas с той же историей (назад/вперёд) и
   состоянием (прокрутка, введённый текст).

## Готово, когда

- [x] e2e: Browser в focus mode, переход из адресной строки tile-а — пиксели страницы видны в tile-е; на
      main до правки test красный.
- [x] e2e: после выхода из focus mode страница на Canvas та же — без перезагрузки, «назад» ведёт на прошлый
      адрес.
- [x] Unit test: Browser в focus mode не уходит в сон, даже если его рамка на Canvas вне экрана.
- [x] Проверки пикселей Browser на Canvas зелёные (`test/e2e/browser-layer.spec.ts`).
- [x] Mutant-ы: без правки п. 2 e2e пикселей в tile-е красный; без правки п. 3 unit test сна красный.
- [ ] gate full на Mac зелёный; вручную на Stable — страница видна в focus mode.

## Где в коде

- `src/renderer/canvas/overlays/BrowserLayer.tsx:105` (`loadURL`), `:144` (`registerBrowserPage`), `:167`
  (`unregister`), `:208` (`<webview>`), `:231` (`useReportScreen`), `:293` (`ViewportPortal`).
- `src/renderer/canvas/nodes/browser-frame.ts:22` — `browserPageRect`.
- `src/renderer/canvas/overlays/browser-pages.ts` — страницы и их место по Node-ам Canvas.
- `src/renderer/canvas/nodes/BrowserNode.css:205-210` — слой под Node-ами.
- `src/renderer/focus/FocusMode.tsx:173`, `:290-291`; `src/renderer/focus/focus.css:11-14`.
- `src/main/browser/sleep.ts:101-105`, `src/main/browser/live.ts:617` — сон.
- `test/e2e/browser-pixels.ts`, `test/e2e/browser-layer.spec.ts` — проверки пикселей.

## Итог

Подтверждение на main до правки (`test/e2e/browser-focus.spec.ts`, оба zoom 1 и 0.5 красные): в tile-е
пустой фон focus mode — доля кремового цвета страницы в теле tile-а 0, под курсором в середине tile-а
`div` слоя focus mode, а `<webview>` стоит на месте карточки на Canvas (zoom 1: 638 × 410 в точке
401, 181), под непрозрачным слоем. Страница грузилась, но видна не была.

Выбран путь «тот же `<webview>` поверх tile-а», без переноса в DOM: `<webview>`, переставленный в DOM,
грузит страницу заново, а отдельный показ для focus mode требует именно переноса. Простой подъём
`z-index` над слоем focus mode не работает: страница внутри stacking context-а Canvas и `inert`.
Поэтому страница остаётся в слое Browser на Canvas и кладётся на тело копии рамки в tile-е снизу,
а focus mode пропускает её сквозь себя:

- копия `BrowserNode` в tile-е регистрирует своё тело (`registerBrowserTileBody`,
  `src/renderer/canvas/nodes/browser-frame.ts`); `BrowserLayer` меряет это тело (ResizeObserver на
  теле, сигнал `layoutSeq` из focus mode при смене раскладки и sidebar, сдвиг Canvas) и ставит туда
  страницу: место в единицах Canvas и `scale(1 / zoom)`, так что страница раскладывается
  и рисуется в размер tile-а, один CSS px страницы на CSS px окна (`tilePlacement`,
  `src/renderer/canvas/overlays/browser-pages.ts`). Меняется только `style` того же элемента;
- копия рамки, чья страница рисуется в этом окне, объявляет свой tile сквозным (`useSeeThroughTile`,
  `src/renderer/focus/focus-tile.ts`); focus mode не знает, какой Node в tile-е. Пока есть сквозной
  tile, то, что слой накрывает, помечено `data-focus-covered` и спрятано (`visibility: hidden
  !important` у всех потомков — React Flow пишет `visibility: visible` в inline-стиль каждого Node-а),
  кроме элементов с `data-under-focus` (`src/renderer/focus/cover.ts`): страница в tile-е (`shown`)
  видна и берёт ввод, остальные страницы (`kept`) отрисованы, но невидимы (`opacity: 0`) и `inert`;
  всё прочее под слоем `inert` (`keepShownOnly`: всё вне цепочки предков страниц `shown`). Фон слоя
  переходит на элемент, в котором он нарисован, рамка сквозного tile-а прозрачна, мышь проходит сквозь
  слой и этот tile к странице, кроме панели, разделителей, других tile-ов, заголовка tile-а и шапки
  рамки. Пока тянут заголовок tile-а или разделитель, страница мышь не берёт;
- фокус: `inert` не мешает скрипту фрейма взять фокус (Chromium) — Card под слоем, вызвавшая `focus()`
  у своего поля, забирала клавиатуру и до этого ticket-а. Теперь фокус, попавший под слой (кроме
  страницы `shown`), возвращается на слой (`keepFocusOutOfCover`), при любом покрытии;
- сон: пока tile показывает Browser этого Canvas, отчёт `browser.screen` — только Browser-ы в tile-ах и
  zoom 1 (`screenShown`): Canvas под слоем не виден, Browser-ы на нём засыпают в свой срок;
- screen reader: страница лежит в DOM под Canvas, а не в регионе «Focus mode»; тело рамки в tile-е
  ставит `aria-owns` на элемент страницы. С VoiceOver не проверено.

Цифры e2e после правки: страница лежит на теле tile-а с точностью до 1 px (1150 × 787 при окне 1400 × 900,
zoom 1 и 0.5), раскладка страницы 1150 × 787, кремовый в нижней части тела — 100 % (Note и копии Node-ов
Canvas под слоем не видны), вне тела tile-а пикселей страницы 0. Колесо в tile-е прокручивает страницу
(scrollY 300), клик ставит фокус в поле страницы, текст в поле, адрес, прокрутка и `load` страницы те же после
выхода; «Back» на рамке ведёт на прошлый адрес. При смене раскладки (Rows, Columns) страница идёт за
tile-ом; разделитель, протянутый над страницей, двигается, страница не видит ни одного движения мыши.

Mutant-ы раунда 0 (все убиты): без раскладки в tile (`useTilePlacement(undefined)`) — e2e красный; без tile-ов в
`screenShown` и без подъёма zoom — unit красный; `inert` вместо `data-focus-covered`, регистрация тела
копией на Canvas, без снятия раскладки при выходе, без замера каждый кадр, CSS без `*`, слой с мышью, слой
и рамка tile-а непрозрачные, без правила step-aside — красные e2e или unit.

Клавиши: ни клавиатура Playwright, ни `sendInputEvent` окна не доходят до гостя `<webview>` даже на Canvas
(проверено при написании test-а), поэтому test проверяет, что фокус окна на `<webview>` и поле страницы, а
текст набирает через `sendInputEvent` самого гостя. Живой набор с клавиатуры в tile-е — в ручной проверке
на Stable.

Review раунд 1 (PR #831). Подтверждено e2e на коде раунда 0: со вторым Browser-ом, оставшимся на
Canvas, `visibility: hidden` у предков останавливает его гостя — `capturePage` не приходит за 3 s,
screencast даёт 0 кадров (на Canvas 34), хотя `visibilityState` гостя `visible`. Card со скриптом,
который зовёт `focus()` каждые 100 ms, забирала клавиатуру из-под слоя. После правки (`data-under-focus`,
`keepShownOnly`, `keepFocusOutOfCover`): capture второго Browser-а есть (доля его цвета 0.90), screencast
36–67 кадров за секунду, синих пикселей второй страницы в окне под focus mode 0 (на Canvas 209 170),
фокус остаётся на слое, Tab под слой не уходит (только в страницу tile-а). Цена: невидимая страница под
слоем получает кадры анимации реже (1–8 за 0.5 s вместо 62) — Chromium притормаживает невидимый фрейм;
Card-ы под слоем при `visibility: hidden` тоже могут притормаживаться, пока открыт focus mode.
Новые test-ы: e2e «с Note рядом» проверяет пиксели страницы в tile-е, `<webview>` под курсором и колесо;
e2e двух Browser-ов в tile-ах — каждая страница на своём теле с точностью до 1 px; unit — два Live Browser-а
в tile-ах, ResizeObserver, сигнал `layoutSeq`, отчёт `[]` после выхода, `keepShownOnly`,
`keepFocusOutOfCover`. Mutant-ы раунда 1 (27, все убиты): `some`→`every` у сквозных tile-ов, первое тело для
всех страниц, без `keepShownOnly`, без возврата фокуса, без ResizeObserver, без сигнала раскладки, без
`aria-owns`, CSS без `opacity` у `kept`, без видимости `data-under-focus`, без правила нажатой мыши и другие.

