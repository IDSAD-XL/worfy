# 10 — Остальные popover-ы и hover card комментария к цитате

Type: task
Status: claimed 2026-11-12T16:33Z
Blocked by: 09
Source: [spec.md](../spec.md), «Ticket-ы», строка 10; «Решения по реализации» (kit, PreviewCard); истории 13, 16, 25;
заметка темы `docs/product/ui-overhaul/notes/inventory-overlays.md`, разделы 2.1 и 5

## Что происходит

- History в sidebar (`session/HistoryPopover.tsx`): Esc только с фокусом внутри, снаружи не закрывается, фокус не
  входит.
- Queued messages (`session/composer/Queue.tsx`): ни Esc, ни нажатия снаружи — только повторный клик.
- Effort (`session/composer/Pickers.tsx:179-360`) и What's new (`update/WhatsNew.tsx`): поведение уже полное, но своё.
- Комментарий к цитате (`session/QuoteCommentParts.tsx:225-423`) и hover card комментария
  (`session/QuoteCommentParts.tsx:425-471`, таймеры в `session/QuoteComments.tsx`): у hover card нет ни клавиатуры, ни
  роли; её якорь — прямоугольник `Range`, а не элемент.
- Command request Terminal AI (`canvas/nodes/TerminalAiRequest.tsx`) и карточка узла Mind map (`product/MindMap.tsx`)
  стоят по своей раскладке; заметка темы считает их заменимыми только частично.

## Что делаем

1. History, Queued messages, Effort, What's new и комментарий к цитате переходят на Popover kit (Ticket 09).
2. `theme/kit/PreviewCard.tsx`: обёртка PreviewCard Base UI; hover card комментария к цитате переходит на неё с якорем-
   прямоугольником, если Base UI его принимает; иначе остаётся своей, и Ticket записывает почему.
3. Command request Terminal AI и карточка Mind map переходят, если Popover kit держит их раскладку; иначе остаются
   своими, и Ticket записывает почему.
4. E2e `test/e2e/layers-popover.spec.ts` дописывается: popover composer-а у края окна, History в sidebar поверх
   Settings; Esc в popover-е внутри элемента со своим Esc — одно нажатие, одно действие (правило Ticket-а 03,
   пункт 6). Пример — Queued messages и Effort в composer-е: при ходе агента Esc закрывает popover и не прерывает
   ход. Как сценарий попадает в риск — ADR-0106, раздел «E2e-сценарий для Ticket-ов 10 и 11».

## Готово, когда

- [ ] Unit test `test/unit/kit-preview-card.test.tsx`: карточка открывается наведением и фокусом, закрывается уходом и
      Esc.
- [ ] Unit test-ы мест: History и Queued messages закрываются по Esc и нажатию снаружи; фокус входит и возвращается.
- [ ] Существующие test-ы мест и e2e `quote-comments.spec.ts` зелёные без правок ролей и `data-testid`; дописанный
      `layers-popover.spec.ts` зелёный на macOS и Windows runner-е.
- [ ] В «Итог» — какие места остались своими и почему.
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/theme/kit/PreviewCard.tsx` (новый)
- `src/renderer/session/HistoryPopover.tsx`
- `src/renderer/session/composer/Queue.tsx`
- `src/renderer/session/composer/Pickers.tsx`
- `src/renderer/update/WhatsNew.tsx`
- `src/renderer/session/QuoteCommentParts.tsx`
- `src/renderer/session/QuoteComments.tsx`
- `src/renderer/session/quote-comments.css`
- `src/renderer/session/session.css`
- `src/renderer/canvas/nodes/TerminalAiRequest.tsx`
- `src/renderer/product/MindMap.tsx`
- `test/unit/kit-preview-card.test.tsx` (новый)
- `test/unit/history-popover.test.tsx`
- `test/unit/effort-slider.test.tsx`
- `test/unit/whats-new-view.test.tsx`
- `test/unit/quote-comments-ui.test.tsx`
- `test/e2e/layers-popover.spec.ts` (из Ticket-а 09)
- `test/e2e/quote-comments.spec.ts`

## Вне скоупа

- Inline confirm «Resume the Session» в `HistoryPopover.tsx` остаётся inline.
- Context menu действий с выделенным текстом (тот же `QuoteCommentParts.tsx`): Ticket 12.

## Итог

- Popover kit (`theme/kit/Popover.tsx`) получил то, что нужно местам без своей кнопки: `trigger` необязателен, `anchor`
  — элемент или прямоугольник на экране; `initialFocus` и `finalFocus`; `onDismiss(reason)` — место может оставить
  popover открытым при нажатии снаружи, уходе фокуса, blur окна и смене вида (Esc закрывает всегда); `popupProps` — свои
  клавиши и drag-and-drop места, их `onKeyDown` идёт раньше kit-а. Нажатие по самому `anchor` — не нажатие снаружи.
  Фокус, ушедший в любой другой элемент окна (поле Command palette по ⌘K, кнопка другой панели), закрывает popover:
  Base UI закрывает его сам только при уходе по Tab. `theme/kit/layer.ts`: `close` получает причину (`escape`, `blur`,
  `view`).
- `theme/kit/PreviewCard.tsx` — новая обёртка PreviewCard Base UI: `dialog` с именем, открывается наведением и фокусом
  на trigger-е, закрывается уходом, Esc, нажатием снаружи, blur окна и сменой вида; без trigger-а ставится по `anchor`.
- History в sidebar (`HistoryButton` в `session/HistoryPopover.tsx`), Queued messages, Effort, What's new и
  комментарий к цитате — на Popover kit; роли и `data-testid` прежние. History висит на элементе во всю ширину секции
  под её действиями (как и до kit-а, ширина — `--anchor-width`); теперь закрывается по Esc при любом фокусе и по
  нажатию снаружи, фокус входит и возвращается на кнопку History. What's new — на слое `top`, blur окна его не
  закрывает (PR открывается в браузере). Комментарий к цитате: Esc отменяет; нажатие снаружи с несохранённым текстом
  оставляет его открытым и просит Save или Cancel, как раньше; blur окна, уход фокуса и смена вида закрывают только
  неизменённый.
- Hover card комментария к цитате — на PreviewCard kit с якорем-прямоугольником: Base UI его принимает. Подсветка
  цитаты — CSS Highlight, не элемент, поэтому наведение по-прежнему считают таймеры `session/QuoteComments.tsx`
  (280 и 220 мс), а kit даёт роль `dialog` «Comment», слой, Esc, нажатие снаружи, blur и смену вида.
- Остались своими:
  - Command request Terminal AI (`canvas/nodes/TerminalAiRequest.tsx`): панель стоит внутри Node-а поверх экрана
    терминала, под его первой строкой (`top` в пикселях экрана), масштабируется вместе с Canvas и не имеет trigger-а
    (⌘I с клавиатуры). Popover kit рисует popup в `document.body` у края элемента: панель вышла бы из zoom Node-а и
    перестала бы закрывать строку shell-а. Esc и возврат фокуса в xterm у неё уже свои.
  - Карточка узла Mind map (`product/MindMap.tsx`): её место считает `cardPlace` внутри панели карты, а не окна, и
    она идёт за камерой карты при pan и zoom. Kit ставит popup у краёв окна и закрывает его нажатием снаружи — то есть
    перетаскиванием карты. Esc, «×» и клик по пустой карте у неё уже свои.
- Esc в popover-е composer-а при ходе агента закрывает popover и не прерывает ход; следующий Esc в поле прерывает
  (unit test `test/unit/composer-popovers.test.tsx`, e2e `layers-popover.spec.ts`). Popover-а, который открывается с
  фокусом в поле ввода, в этом Ticket-е нет: этот случай держит unit test `test/unit/kit-layer.test.tsx` › `the chat
  field keeps the focus while a kit popup is open`. В Product Session Queued messages и Effort не показываются
  (`PRODUCT_SESSION_HIDDEN_COMPOSER_ITEMS`), поэтому случая внутри `ProductSessionPanel` нет.
- E2e, которые искали popup внутри вида Session (`session-controls.spec.ts`, `session-two-windows.spec.ts`), ищут его
  в странице: kit рисует popup в `document.body`. `focus-sidebar.spec.ts` описывает новое поведение History.
