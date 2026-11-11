# 10 — Остальные popover-ы и hover card комментария к цитате

Type: task
Status: open
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
   Settings.

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
