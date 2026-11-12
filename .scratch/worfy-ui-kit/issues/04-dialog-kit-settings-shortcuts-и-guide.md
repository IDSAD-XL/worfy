# 04 — Dialog kit: Settings, Keyboard shortcuts и Guide одним шагом, без трёх guard-ов

Type: task
Status: claimed 2026-11-12T14:18Z
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», строка 04; «Решения по реализации» (Settings, Keyboard shortcuts и Guide;
toast-ы; `Select` внутри окна kit); «Решения по test-ам» (Seam 1, Seam 2); истории 1, 2, 3, 9, 11, 14, 25;
[ADR-0090](../../../docs/adr/0090-guide-window-and-two-languages.md) (окно worfy Guide);
[критик](../../../docs/product/critic/worfy-ui-kit-2026-11-11.md), возражение 1

## Что происходит

- Settings, Keyboard shortcuts и Guide держат модальность тремя guard-ами на уровне модуля: capture-listener-ы
  `keydown` на window (`settings/settings-window.ts:84-144`, `shortcuts/shortcuts-window.ts:58-86`,
  `guide/store.ts:88-129`). Окно kit рядом с ними получит второй focus trap, и два trap-а будут спорить за фокус.
- В Settings одиннадцать своих `Select`. Их список рисуется в `document.body`, вне окна.
- Копия segmented control языка Guide (`guide/GuideWindow.tsx:161-173`) — одна из трёх копий `SegmentedControl`.

## Что делаем

1. `theme/kit/Dialog.tsx`: обёртка Dialog Base UI — роль и имя, focus trap, возврат фокуса, Esc закрывает только
   верхний слой и отмечается `preventDefault`, слой из шкалы z-index, общая часть из `theme/kit/layer.ts`. Клик по
   области toast-ов не считается нажатием снаружи, область не прячется от screen reader-а.
2. Settings, Keyboard shortcuts и Guide переходят на Dialog kit одним PR-ом; три guard-а удаляются. Правило ADR-0090
   «открыт всегда только один из трёх диалогов» остаётся.
3. `Select` внутри окна kit — решение, которое выбрал spike (Ticket 01).
4. Язык Guide — через общий `SegmentedControl` из `theme/primitives.tsx` (только import; ToggleGroup — Ticket 14).
5. E2e `test/e2e/layers-dialog.spec.ts`: окно поверх Canvas, рядом с Terminal, под focus mode, клик по toast-у при
   открытом окне.

## Готово, когда

- [ ] Unit test `test/unit/kit-dialog.test.tsx`: роль и имя; Tab не уходит из окна; фокус возвращается к кнопке, которая
      открыла окно; Esc закрывает только верхний слой и отмечен как обработанный; клик по области toast-ов окно не
      закрывает; blur окна приложения не закрывает модальное окно.
  - evidence: test-run pass · `pnpm exec vitest run --project jsdom test/unit/kit-dialog.test.tsx` exit 0 · mac - · 50b50b72f1db6fcfb0739b91ac131a463adc7732
- [ ] Guard-ов в `settings-window.ts`, `shortcuts-window.ts`, `guide/store.ts` нет; `settings-dialog`,
      `shortcuts-overlay`, `guide-window` unit test-ы и e2e `settings`, `shortcuts`, `guide` зелёные без правок ролей и
      `data-testid`.
  - evidence: test-run pass · `pnpm exec vitest run --project jsdom test/unit/settings-dialog.test.tsx test/unit/shortcuts-overlay.test.tsx test/unit/guide-window.test.tsx` exit 0 · mac - · 50b50b72f1db6fcfb0739b91ac131a463adc7732
- [ ] `Select` в Settings: выбор мышью, Esc на открытом списке закрывает только список, список виден screen reader-у —
      unit test `select.test.tsx` и e2e `select.spec.ts`.
  - evidence: test-run pass · `pnpm exec vitest run --project jsdom test/unit/select.test.tsx` exit 0 · mac - · 50b50b72f1db6fcfb0739b91ac131a463adc7732
- [ ] E2e `test/e2e/layers-dialog.spec.ts` зелёный на macOS и Windows runner-е.
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0; e2e test бюджета старта зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 50b50b72f1db6fcfb0739b91ac131a463adc7732

## Где в коде

- `src/renderer/theme/kit/Dialog.tsx` (новый)
- `src/renderer/theme/kit/dialog.css` (новый)
- `src/renderer/settings/SettingsDialog.tsx`
- `src/renderer/settings/settings-window.ts`
- `src/renderer/shortcuts/ShortcutsOverlay.tsx`
- `src/renderer/shortcuts/shortcuts-window.ts`
- `src/renderer/guide/GuideWindow.tsx`
- `src/renderer/guide/store.ts`
- `src/renderer/theme/Select.tsx`
- `src/renderer/toast/ToastRegion.tsx`
- `test/unit/kit-dialog.test.tsx` (новый)
- `test/unit/settings-dialog.test.tsx`
- `test/unit/shortcuts-overlay.test.tsx`
- `test/unit/guide-window.test.tsx`
- `test/unit/select.test.tsx`
- `test/e2e/layers-dialog.spec.ts` (новый)
- `test/e2e/settings.spec.ts`
- `test/e2e/shortcuts.spec.ts`
- `test/e2e/guide.spec.ts`
- `test/e2e/select.spec.ts`

## Вне скоупа

- Остальные модальные окна: Ticket-ы 05–08.
- Helper `focusablesOf` (`settings/settings-window.ts:69`) остаётся, пока его импортируют окна 05–07.
