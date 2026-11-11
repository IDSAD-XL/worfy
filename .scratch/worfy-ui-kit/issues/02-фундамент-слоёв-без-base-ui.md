# 02 — Фундамент слоёв без Base UI: шкала z-index, helper «открытые слои», Esc поля ввода чата

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 02; «Решения по реализации» (шкала слоёв, helper «открытые слои»,
Esc); истории 4, 26, 27; [критик](../../../docs/product/critic/worfy-ui-kit-2026-11-11.md), возражение 2

## Что происходит

- Шкалы z-index нет: 79 объявлений, 28 разных значений от −1 до 3000, именованных констант три
  (`settings/settings-window.ts:24`, `machines/machine-dialogs.ts:29`, `canvas/pinning.ts:38`).
- «Открыт ли popup» шесть мест узнают сами, по ролям в DOM: `focus/FocusMode.tsx:145-147`,
  `canvas/sources/epics.ts:177`, `work-track/SpanPanel.tsx:121`, `flight-recorder/RunHistoryView.tsx:156`,
  `toast/ToastRegion.tsx:99`, `pr-inbox/PrInboxView.tsx:645`.
- Поле ввода чата прерывает ход агента на любой Esc, пока агент занят (`session/MessageInput.tsx:344`), и не смотрит
  `defaultPrevented`. Esc, которым закрыли popup поля ввода, прерывает и ход.

Base UI здесь не нужен: всё это нужно при любом ответе spike-а (Ticket 01).

## Что делаем

1. `theme/tokens.css`: именованные tokens z-index — overlay Canvas, панели, popover, dialog, menu поверх dialog,
   toast, самый верхний слой (menu version chip). Значения сохраняют нынешний порядок слоёв. Для inline `zIndex` в TSX
   — те же значения из `theme/layers.ts`.
2. На шкалу переходят toast-ы (`toast/toast.css`), список `Select` (`theme/select.css`) и закреплённые Node-ы
   (`canvas/pinning.ts`). Остальные слои переходят в Ticket-ах, которые переносят их места на kit.
3. `theme/open-layers.ts`: один helper «какие слои открыты» — dialog, menu, listbox. Шесть мест выше берут его вместо
   своих проверок по ролям.
4. `session/MessageInput.tsx`: Esc с `defaultPrevented` ход агента не прерывает.

## Готово, когда

- [ ] Unit test helper-а: открытые dialog, menu и listbox видны, закрытые — нет; шесть мест выше импортируют helper,
      своих проверок по ролям в них нет. Mutant (helper не знает `listbox`) роняет test.
- [ ] Unit test поля ввода: Esc, который popup поля уже обработал (`preventDefault`), ход не прерывает; обычный Esc
      при занятом агенте прерывает, как раньше.
- [ ] Tokens z-index лежат в `theme/tokens.css`; toast-ы, список `Select` и закреплённые Node-ы берут их; порядок слоёв
      прежний — `test/e2e/toast-placement.spec.ts`, `test/e2e/select.spec.ts`, `test/e2e/focus.spec.ts` зелёные.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/theme/tokens.css`
- `src/renderer/theme/layers.ts` (новый)
- `src/renderer/theme/open-layers.ts` (новый)
- `src/renderer/theme/select.css`
- `src/renderer/toast/toast.css`
- `src/renderer/toast/ToastRegion.tsx`
- `src/renderer/canvas/pinning.ts`
- `src/renderer/focus/FocusMode.tsx`
- `src/renderer/canvas/sources/epics.ts`
- `src/renderer/work-track/SpanPanel.tsx`
- `src/renderer/flight-recorder/RunHistoryView.tsx`
- `src/renderer/pr-inbox/PrInboxView.tsx`
- `src/renderer/session/MessageInput.tsx`
- `test/unit/open-layers.test.ts` (новый)
- `test/unit/message-input-escape.test.tsx` (новый)
- `test/unit/focus-mode.test.tsx`
- `test/unit/toasts-view.test.tsx`

## Вне скоупа

- Popup Base UI, который ещё в DOM, но уже закрывается: helper узнаёт его в Ticket-е 03.
- Слои окон, popover и menu: переходят на шкалу вместе со своими местами (Ticket-ы 04–14).
