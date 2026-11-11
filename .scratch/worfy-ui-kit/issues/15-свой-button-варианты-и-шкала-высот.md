# 15 — Свой Button: варианты и одна шкала высот

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 15; «Решения по реализации» (Button и Chip); история 21; заметка темы
`docs/product/ui-overhaul/notes/inventory-foundation.md`, разделы 2 и 2.1

## Что происходит

- Общий только `PrimaryButton` (`theme/primitives.tsx:95-102`, `.w-primary` в `theme/primitives.css:106`).
- Копии по ролям: primary — 7 (`theme/primitives.css`, `canvas/actions/actions.css`, `autopilot/autopilot-modal.css`,
  `session/quote-comments.css`, `pr-inbox/pr-inbox.css`, `session/session.css`, inline в
  `shell/sidebar/SessionsSection.tsx`); danger — 4 (`autopilot-modal.css`, `quote-comments.css`, `session.css`, inline в
  `browser/BrowserProfiles.tsx`); secondary — 6 одинаковых inline-объектов (`BrowserProfiles.tsx`,
  `harness/CodexHooksStep.tsx`, `harness/MigrationForm.tsx`, `machines/LinkMachineDialog.tsx`,
  `machines/machine-dialogs.ts`, `shell/ProjectSettings.tsx`); link — 10 копий; icon-only — не меньше 10 классов
  (`.w-toolbar__icon-button`, `.w-sidebar__icon-button` в `shell/shell.css`, `.w-focus__icon-button` в `focus/focus.css`).
- Высоты разные: 20, 22, 24, 26 и 28 px.

## Что делаем

1. `theme/Button.tsx` и `theme/button.css`: свой Button без библиотеки — варианты primary, secondary, danger, link,
   icon; высоты по одной шкале (custom properties рядом с компонентом, на основе `--row-height` из
   `theme/tokens.css`, который этот Ticket не правит). Кольцо фокуса и курсор — прежние правила `tokens.css`.
2. `PrimaryButton` и его места вызова переходят на Button; копии выше — на варианты Button.
3. Вид кнопок может выровняться (одна высота на роль) — это правка вида, PR называет её отдельной строкой.

## Готово, когда

- [ ] Unit test `test/unit/button.test.tsx`: каждый вариант — `<button type="button">` с именем; `aria-disabled` не
      снимает подсказку; высота варианта берётся из шкалы.
- [ ] `PrimaryButton` нет; копий primary, danger и secondary из списка выше нет.
- [ ] E2e `test/e2e/controls.spec.ts` (кольцо фокуса и курсор) зелёный; существующие test-ы мест без правок ролей и
      `data-testid`.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/theme/Button.tsx` (новый)
- `src/renderer/theme/button.css` (новый)
- `src/renderer/theme/primitives.tsx`
- `src/renderer/theme/primitives.css`
- `src/renderer/canvas/actions/actions.css`
- `src/renderer/autopilot/autopilot-modal.css`
- `src/renderer/session/quote-comments.css`
- `src/renderer/pr-inbox/pr-inbox.css`
- `src/renderer/session/session.css`
- `src/renderer/shell/shell.css`
- `src/renderer/focus/focus.css`
- `src/renderer/shell/sidebar/SessionsSection.tsx`
- `src/renderer/browser/BrowserProfiles.tsx`
- `src/renderer/harness/CodexHooksStep.tsx`
- `src/renderer/harness/MigrationForm.tsx`
- `src/renderer/machines/LinkMachineDialog.tsx`
- `src/renderer/machines/machine-dialogs.ts`
- `src/renderer/machines/MachineDialogs.tsx`
- `src/renderer/machines/ChangeAddressDialog.tsx`
- `src/renderer/shell/ProjectSettings.tsx`
- `src/renderer/session/QuestionCard.tsx`
- `src/renderer/session/PermissionCard.tsx`
- `test/unit/button.test.tsx` (новый)
- `test/e2e/controls.spec.ts`

## Вне скоупа

- Все 348 `<button`: только копии ролей из списка выше и места вызова `PrimaryButton`. Остальные кнопки переходят на
  Button, когда трогают их место.
