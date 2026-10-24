# 17 — В focus mode Browser страница не видна: `<webview>` остаётся на Canvas под слоем focus mode

Type: bug
Status: open 2026-10-24T21:55Z
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

- [ ] e2e: Browser в focus mode, переход из адресной строки tile-а — пиксели страницы видны в tile-е; на
      main до правки test красный.
- [ ] e2e: после выхода из focus mode страница на Canvas та же — без перезагрузки, «назад» ведёт на прошлый
      адрес.
- [ ] Unit test: Browser в focus mode не уходит в сон, даже если его рамка на Canvas вне экрана.
- [ ] Проверки пикселей Browser на Canvas зелёные (`test/e2e/browser-layer.spec.ts`).
- [ ] Mutant-ы: без правки п. 2 e2e пикселей в tile-е красный; без правки п. 3 unit test сна красный.
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
