# 05: Меню «Move to», Reset layout и клавиши

Type: task
Status: done 2026-11-27T12:18Z
PR: #2322
Branch: worfy-layout/05
Blocked by: 04
Source: [spec.md](../spec.md), «Ticket-ы», 05; «Решения по реализации» («Меню View button», «Клавиши», «Settings → General», «Sidebar спрятан»); «Решения по test-ам», Seam 3 и Seam 4; решения владельца Q3, Q6; «Волны», Wave 3

Кто: агент.

## Что строить

- Kit ContextMenu на View button (правый клик, Shift+F10).
- Reset layout в меню и в Settings → General.
- ⌥-стрелки, фокус после перемещения.
- 05 идёт после 04, потому что меню и клавиши живут в `ViewButton.tsx` и `ViewZone.tsx` из 04.

## Где в коде

- `src/renderer/shell/ViewButton.tsx`, `src/renderer/shell/ViewZone.tsx` (Ticket 04)
- `src/renderer/settings/GeneralSection.tsx` — строка «View buttons»
- Только читать: `src/renderer/theme/kit/ContextMenu.tsx`, `src/renderer/autopilot/QueueList.tsx` (фокус `:65-80`),
  `src/shared/layout/view-buttons.ts` (Ticket 02)

## Решения

spec.md, раздел «Решения по реализации», «Меню View button», «Клавиши», «Settings → General»; решения владельца Q3,
Q6:

- Пункты меню: «Move to ▸ Header / Sidebar / Footer» (текущая зона отмечена и неактивна), черта, «Reset layout»
  (неактивен, пока расстановка по умолчанию).
- Меню открывается правым кликом, кликом двумя пальцами на touchpad и Shift+F10 на кнопке в фокусе (решено без
  владельца: у Mac нет клавиши меню).
- После «Move to» кнопка встаёт в конец зоны, фокус переходит на неё в новой зоне. Пока sidebar спрятан, «Sidebar» в
  меню работает: кнопка встаёт в конец зоны rail и видна в header после черты.
- Клавиши: ⌥←/⌥→ (Alt+←/→ на Windows) в header и footer, ⌥↑/⌥↓ на rail двигают кнопку внутри зоны. Фокус остаётся на
  ней после перерисовки — образец `QueueList`. На краю зоны ничего не происходит: в другую зону кнопку переносит только
  меню. В header обработчик стоит раньше стрелок ToggleGroup, чтобы ⌥← не двигал фокус.
- Settings → General: строка «View buttons» с кнопкой «Reset layout» (неактивна, пока расстановка по умолчанию).
- Reset layout — patch `viewButtons: null`, поле убирается (раздел «Хранение»). Все окна этой Machine слышат перемену
  через `appSettings.changed`.
- Строки «Reset layout» в Command palette нет — Q6 называет меню и Settings. Прятать кнопки нельзя (Q6).

## Test-ы

- Unit `test/unit/view-zones.test.tsx`: меню зовёт `setAppSettings` с ожидаемой расстановкой; ⌥-стрелки двигают
  кнопку, фокус остаётся (spec.md, «Решения по test-ам», Seam 3).
- E2e `test/e2e/view-buttons.spec.ts`: «Move to» и Reset из меню; ⌥←; второе окно видит перемену (Seam 4).
- Сначала падающий test: красный на старом поведении, это пишется в «Итог».
- `src/renderer/shell/` не описан в `scripts/e2e-specs.table.json`, поэтому PR запускает все spec-файлы e2e.

## Готово, когда

- [ ] «Move to» переносит кнопку в конец зоны, фокус на ней; Reset layout возвращает расстановку по умолчанию во всех
      окнах; ⌥←/⌥→ и ⌥↑/⌥↓ двигают кнопку внутри зоны.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/view-zones.test.tsx, test/unit/settings-reset-layout.test.tsx) · mac - · a725881ce53fb5576136310f8472fb81feecd1be
  - evidence: review pass · PR #2322 · - - · e44ec5c2714fbc8832ba99a2e85257fdd64d995d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · a725881ce53fb5576136310f8472fb81feecd1be
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45983045890/job/140472961083 · ci - · e44ec5c2714fbc8832ba99a2e85257fdd64d995d
