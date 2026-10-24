# 18 — Resize карточки Browser и viewport страницы отдельно от размера карточки; сайдбар настроек в хедере

Type: feature
Status: open 2026-10-24T21:58Z
Branch: worfy-browser/18
Blocked by: 17
Source: владелец, 2026-10-25 (чат Mac-оркестратора)

## Запрос владельца

- Менять размер карточки Browser на Canvas (resize мышью, как у других Node-ов).
- Вызывать окно смены viewport: настоящий viewport страницы внутри карточки настраивается и может
  отличаться от размера карточки на Canvas (например, страница видит ширину 1440 px, а карточка на Canvas
  узкая).
- Это может быть сайдбар (боковая панель), который открывается кнопкой в хедере Browser. Сайдбар — место для
  настроек показа и для будущих функций Browser.

## Что сейчас

- У `BrowserNode` нет resize: размер по умолчанию 640×440 (`defaultWidth`, `defaultHeight` —
  `src/renderer/canvas/nodes/BrowserNode.tsx:54-55`), ручки размера нет.
- Другие Node-ы меняют размер через `NodeResizeClamp` (обёртка над resizer-ом React Flow,
  `src/renderer/canvas/NodeResizeClamp.tsx:25`) и в `onResizeEnd` пишут операцию
  `ops.apply({ op: 'resize', … })`: `src/renderer/canvas/nodes/NoteNode.tsx:69-74`,
  `src/renderer/canvas/nodes/TerminalNode.tsx:507-511`.
- Layout (файл раскладки Canvas) хранит `w` и `h` Node-а. Операция `resize` — `src/shared/layout/types.ts:141`,
  применяется в `src/main/layout/store.ts:189` и `:250`. MCP-инструмент `resize_node` (агент меняет размер
  Node-а) — `src/main/mcp/canvas-server.ts:239`.
- Размер страницы сегодня равен размеру тела карточки: `src/renderer/canvas/overlays/browser-pages.ts:39-47`
  берёт ширину и высоту Node-а, `<webview>` занимает 100 %. Эмуляции размера экрана в `src/` нет (ни
  `Emulation.setDeviceMetricsOverride` в CDP — протоколе отладки Chromium, — ни `enableDeviceEmulation`
  Electron).
- Хедер Browser — `div.w-browser-frame__header` (`src/renderer/canvas/nodes/BrowserNode.tsx:507`).
- Кадры страницы для других окон и Linked machine (другой компьютер, который смотрит этот Project по LAN)
  идут screencast-ом размером не больше 1280×1280 (`FRAME_OPTIONS`, `src/main/browser/screencast.ts:30`;
  `screencast` в `src/main/browser/cdp.ts:683-689`). Ввод с этих экранов пересчитывается в координаты
  страницы (`src/renderer/browser/frames.ts`, `sendBrowserInput`).

## Что сделать

1. **Решить способ (первый шаг Ticket-а, возможно ADR).** Два варианта, сравнить и записать выбор:
   - **CSS**: `<webview>` получает фиксированный размер viewport-а и уменьшается или увеличивается в рамку
     карточки через `transform: scale(…)`. Плюсы: ничего не эмулируется, страница видит настоящий размер.
     Проверить: чёткость текста при масштабе, координаты кликов и проверки пикселей.
   - **CDP**: `Emulation.setDeviceMetricsOverride` (или `enableDeviceEmulation`) задаёт странице размер, не
     равный размеру `<webview>`. Проверить: как это сочетается со screencast-ом и вводом с других экранов,
     что видно в самой карточке.
   Для обоих: кадры для других окон и Linked machine (до 1280×1280) и координаты ввода остаются верными.
2. **Resize карточки.** `BrowserNode` получает `NodeResizeClamp` с `onResizeEnd` → операция `resize`, как у
   Note и Terminal. Минимальный размер — такой, чтобы хедер и адресная строка помещались. Страница
   следует за новым размером (если viewport не задан отдельно).
3. **Viewport в данных Node-а.** `data.viewport` (ширина и высота страницы; нет поля — viewport равен телу
   карточки, как сейчас). Хранится в Layout, переживает перезапуск worfy. Изменение — операцией Layout,
   как `resize`, а не отдельным путём записи.
4. **Сайдбар в хедере.** Кнопка в `w-browser-frame__header` открывает сайдбар настроек Browser. Первая
   настройка в нём — viewport: «как карточка» или ширина × высота (несколько готовых размеров и свой).
   Сайдбар сделан так, чтобы в него можно было добавлять следующие настройки.

## Идеи для сайдбара (не делать в этом Ticket-е)

Идеи владельца на будущее. Здесь их не делать — только оставить для них место в сайдбаре.

- Очистить cookies этого сайта одной кнопкой.
- Очистить localStorage.
- Выгрузить из вкладки Network результат или полный лог response-а.

## Готово, когда

- [ ] Выбор способа (CSS или CDP) записан в «Итог» с причиной; если это меняет устройство Browser — ADR.
- [ ] Карточку Browser можно растянуть мышью; размер сохраняется в Layout и переживает перезапуск —
      unit test на операцию `resize` для Browser, e2e на resize.
- [ ] Viewport, заданный в сайдбаре, отличается от размера карточки: страница видит заданную ширину
      (e2e: `window.innerWidth` страницы равен заданному), карточка на Canvas своего размера.
- [ ] Viewport хранится в `data.viewport` и переживает перезапуск — unit test.
- [ ] Кадры для других окон и Linked machine и клики с них попадают в верные точки страницы при viewport,
      отличном от карточки — test на пересчёт координат.
- [ ] Проверки пикселей Browser на Canvas и в focus mode (Ticket 17) зелёные.
- [ ] Mutant-ы: без `data.viewport` страница снова размером карточки — test красный; без пересчёта координат
      test ввода красный.
- [ ] gate full на Mac зелёный; вручную на Stable — resize и смена viewport.

## Где в коде

- `src/renderer/canvas/nodes/BrowserNode.tsx:54-55` (размер по умолчанию), `:507` (хедер).
- `src/renderer/canvas/NodeResizeClamp.tsx:25`; примеры — `NoteNode.tsx:69-74`, `TerminalNode.tsx:507-511`.
- `src/shared/layout/types.ts:141`, `src/main/layout/store.ts:189`, `:250` — операция `resize`.
- `src/main/mcp/canvas-server.ts:239` — `resize_node`.
- `src/renderer/canvas/overlays/browser-pages.ts:39-47` — размер страницы из Node-а.
- `src/main/browser/screencast.ts:30`, `src/main/browser/cdp.ts:683-689` — screencast.
- `src/renderer/browser/frames.ts`, `sendBrowserInput` — ввод с других экранов.

## Итог
