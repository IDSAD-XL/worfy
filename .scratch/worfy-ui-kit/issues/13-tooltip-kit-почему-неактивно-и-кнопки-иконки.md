# 13 — Tooltip kit: подсказки «почему неактивно» и кнопки-иконки

Type: task
Status: claimed 2026-11-12T14:18Z
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», строка 13; «Решения по реализации» (Tooltip kit); истории 5, 6; заметка темы
`docs/product/ui-overhaul/notes/inventory-overlays.md`, раздел 4

## Что происходит

- Своего tooltip нет, только native `title`: 335 мест в 105 файлах. С клавиатуры `title` не виден.
- Подсказка «почему действие неактивно» на экране Linked machine (связанной машины только для чтения) приходит
  spread-ом `writeAction(...)` из `projects/read-only.ts:26-29`: 46 вызовов в 22 файлах. Кнопка остаётся
  `aria-disabled`, а не `disabled`: «a disabled button shows no tooltip» (`read-only.ts:23-24`).
- Кнопки-иконки без текста: `shell/Toolbar.tsx`, `shell/Sidebar.tsx`, `shell/toolbar/HarnessStatus.tsx`
  (`IconButton`), `focus/FocusMode.tsx`.

## Что делаем

1. `theme/kit/Tooltip.tsx`: обёртка Tooltip Base UI — показ при наведении и при фокусе с клавиатуры, Esc скрывает,
   текст доступен screen reader-у как описание, слой из шкалы.
2. `writeAction` отдаёт подсказку Tooltip kit-у. Цель — правка в одном `read-only.ts`, без 22 мест вызова. Если без
   правки мест вызова не выходит, Ticket правит их и называет это в PR; тогда он делит файлы с Ticket-ами 09 и 11 и
   идёт после них.
3. Кнопки-иконки toolbar, sidebar, Harness status и focus mode получают Tooltip kit вместо `title`.
4. Остальные `title` остаются.

## Готово, когда

- [ ] Unit test `test/unit/kit-tooltip.test.tsx`: подсказка видна при фокусе с клавиатуры и при наведении; Esc
      скрывает; кнопка `aria-disabled` с подсказкой её показывает.
- [ ] Unit test Linked machine (`linked-read-only.test.tsx`): у неактивного действия подсказка «почему» видна при
      фокусе; e2e `linked-read-only.spec.ts` зелёный.
- [ ] У кнопок-иконок toolbar, sidebar, Harness status и focus mode нет `title`, подсказка — Tooltip kit; имя кнопки
      прежнее (`getByRole` test-ы без правок).
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/theme/kit/Tooltip.tsx` (новый)
- `src/renderer/theme/kit/tooltip.css` (новый)
- `src/renderer/projects/read-only.ts`
- `src/renderer/shell/Toolbar.tsx`
- `src/renderer/shell/Sidebar.tsx`
- `src/renderer/shell/toolbar/HarnessStatus.tsx`
- `src/renderer/focus/FocusMode.tsx`
- `test/unit/kit-tooltip.test.tsx` (новый)
- `test/unit/linked-read-only.test.tsx`
- `test/unit/harness-status.test.tsx`
- `test/e2e/linked-read-only.spec.ts`

## Вне скоупа

- Остальные `title`: позже, когда трогают их место.
