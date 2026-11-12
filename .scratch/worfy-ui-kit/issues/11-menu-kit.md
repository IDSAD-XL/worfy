# 11 — Menu kit: `ActionMenu`, «Modes» и остальные menu

Type: task
Status: open
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», строка 11; «Решения по реализации» (kit, Esc); «Решения по test-ам» (Seam 1,
Seam 2); истории 3, 8, 10, 13, 15, 16, 25; заметка темы `docs/product/ui-overhaul/notes/inventory-overlays.md`,
раздел 2.2

## Что происходит

Шесть menu, общий из них только `ActionMenu`:

- «⋯» Autopilot и «Open PR» — `canvas/actions/action-menu.ts`: без переворота, без Home/End;
- «Modes» (Eco mode, Auto-approval, Auto-continue) — `session/composer/Modes.tsx`, z-index 3000 в `session/session.css`;
- «Sidebar shows» (Project switcher) — `shell/ProjectSwitcher.tsx`;
- menu version chip (Update) — `update/UpdateChip.tsx`;
- «New session on» (выбор Vendor) — `session/NewSessionVendor.tsx`: стрелок нет, Esc без `preventDefault`;
- «Choose a profile» Browser-а — `canvas/nodes/BrowserNode.tsx:437-491`: ни Esc, ни стрелок, ни перевода фокуса.

## Что делаем

1. `theme/kit/Menu.tsx`: обёртка Menu Base UI — `menu` с именем, `menuitem`, `menuitemcheckbox`, `menuitemradio`;
   стрелки, Home, End, typeahead; Esc закрывает только menu и отмечается `preventDefault`; фокус возвращается на
   кнопку; переворот у края; слой из шкалы; общая часть из `theme/kit/layer.ts`.
2. Шесть menu переходят на Menu kit. `ActionMenu` становится обёрткой над Menu kit или уходит, если места вызова
   берут Menu kit сами.
3. Menu на Node-ах, которые тащат (Browser, «⋯» Autopilot и «Open PR»), — `modal={false}`: модальное menu Base UI
   кладёт `InternalBackdrop` на всё окно (`MenuPositioner`), и Node не тащится, пока menu открыто. С `modal={false}`
   первое же перетаскивание двигает Node и закрывает menu; кнопка остаётся с `nodrag` (spike, заметка
   `spike-base-ui.md`, шаг 2, пункт 3; Base UI #6150).
4. E2e `test/e2e/layers-menu.spec.ts`: menu поверх Canvas, на Node-е, который тащат, поверх Settings, у края окна;
   Esc в menu внутри элемента со своим Esc — одно нажатие, одно действие (правило Ticket-а 03, пункт 6). Сценарий —
   ADR-0106, раздел «E2e-сценарий для Ticket-ов 10 и 11»: menu kit-а внутри панели справа
   `session/ProductSessionPanel.tsx`, у которой свой Esc. «Modes» в composer-е в риск не попадает: фокус уходит в menu.

## Готово, когда

- [ ] Unit test `test/unit/kit-menu.test.tsx`: роль и имя; стрелки, Home, End, typeahead; Esc закрывает только menu и
      отмечен как обработанный; фокус возвращается на кнопку; blur окна закрывает.
- [ ] Существующие `modes-menu`, `update-chip` unit test-ы и e2e мест зелёные без правок ролей и `data-testid`.
- [ ] E2e `test/e2e/layers-menu.spec.ts` зелёный на macOS и Windows runner-е.
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/theme/kit/Menu.tsx` (новый)
- `src/renderer/theme/kit/menu.css` (новый)
- `src/renderer/canvas/actions/action-menu.ts`
- `src/renderer/canvas/actions/actions.css`
- `src/renderer/session/composer/Modes.tsx`
- `src/renderer/session/session.css`
- `src/renderer/shell/ProjectSwitcher.tsx`
- `src/renderer/shell/shell.css`
- `src/renderer/update/UpdateChip.tsx`
- `src/renderer/session/NewSessionVendor.tsx`
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/nodes/BrowserNode.css`
- `test/unit/kit-menu.test.tsx` (новый)
- `test/unit/modes-menu.test.tsx`
- `test/unit/update-chip.test.tsx`
- `test/e2e/layers-menu.spec.ts` (новый)

## Вне скоупа

- Context menu: Ticket 12. Menu bar приложения — native, не в Epic-е.
