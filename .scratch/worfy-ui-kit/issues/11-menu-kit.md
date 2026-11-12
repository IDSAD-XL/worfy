# 11 — Menu kit: `ActionMenu`, «Modes» и остальные menu

Type: task
Status: done 2026-11-12T22:29Z
PR: #1836
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
   Esc в menu внутри элемента со своим Esc — одно нажатие, одно действие (правило Ticket-а 03, пункт 6). Пример —
   «Modes» в composer-е: при открытом menu Esc не прерывает ход агента в поле ввода. Как сценарий попадает в риск —
   ADR-0106, раздел «E2e-сценарий для Ticket-ов 10 и 11».

## Готово, когда

- [ ] Unit test `test/unit/kit-menu.test.tsx`: роль и имя; стрелки, Home, End, typeahead; Esc закрывает только menu и
      отмечен как обработанный; фокус возвращается на кнопку; blur окна закрывает.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/kit-menu.test.tsx 15 tests) · mac - · d9b93ea28995f4080f7e20968848759bc063e8dc
- [ ] Существующие `modes-menu`, `update-chip` unit test-ы и e2e мест зелёные без правок ролей и `data-testid`.
  - evidence: test-run pass · `pnpm test` exit 0 (modes-menu, update-chip unit tests; roles and data-testid unchanged) · mac - · d9b93ea28995f4080f7e20968848759bc063e8dc
- [ ] E2e `test/e2e/layers-menu.spec.ts` зелёный на macOS и Windows runner-е.
  - evidence: ci-check pass · CI green on PR #1836 (ci-ok, e2e jobs included) · mac - · f1952c5d54b01faf7c268e6ae6fe280aab6cfc17
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · d9b93ea28995f4080f7e20968848759bc063e8dc

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
