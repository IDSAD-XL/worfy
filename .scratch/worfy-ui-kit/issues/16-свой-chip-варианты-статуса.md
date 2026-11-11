# 16 — Свой Chip: варианты статуса

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 16; «Решения по реализации» (Button и Chip); история 22; заметка темы
`docs/product/ui-overhaul/notes/inventory-foundation.md`, разделы 2 и 2.1

## Что происходит

- Общий `StatusChip` (`theme/primitives.tsx:52-59`): цвет всегда с иконкой и подписью. Голая разметка `.w-chip` — 28
  строк в 13 файлах.
- Около 15 своих компонентов chip-ов и badge-ей статуса: `Chip` трижды (`projects/ConnectProject.tsx:161`,
  `autopilot/StartAutopilotModal.tsx:214`, `canvas/badges/ChecksBadges.tsx:34`), `TicketChip` и `FactChip`
  (`pr-inbox/PrInboxView.tsx`), `StateChip` и `RepoChip` (`canvas/nodes/TicketNode.tsx`), `GateBadge`, `TempBadge`,
  `PullBadges` (`ChecksBadges.tsx`), `VendorBadge` (`session/VendorBadge.tsx`), `DriveBadge`
  (`canvas/nodes/BrowserNode.tsx`), своя копия `StatusChip` в `shell/FirstRunChecks.tsx:124`.

## Что делаем

1. `theme/Chip.tsx` и `theme/chip.css`: свой Chip без библиотеки — варианты статуса (ready, working, blocked, done,
   stopped и нейтральный), иконка и подпись при каждом цвете. `StatusChip` становится вариантом Chip.
2. Свои chip-ы и badge-и статуса из списка выше переходят на Chip.
3. Вид chip-ов одного статуса выравнивается — это правка вида, PR называет её отдельной строкой.

## Готово, когда

- [ ] Unit test `test/unit/chip.test.tsx`: каждый вариант — с иконкой и подписью; цвет без подписи не бывает.
- [ ] Своих компонентов chip-ов статуса из списка выше нет; существующие `checks-badges`, `vendor-badge` unit test-ы и
      e2e `checks-badges.spec.ts` зелёные без правок ролей и `data-testid`.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/theme/Chip.tsx` (новый)
- `src/renderer/theme/chip.css` (новый)
- `src/renderer/theme/primitives.tsx`
- `src/renderer/theme/primitives.css`
- `src/renderer/projects/ConnectProject.tsx`
- `src/renderer/autopilot/StartAutopilotModal.tsx`
- `src/renderer/canvas/badges/ChecksBadges.tsx`
- `src/renderer/canvas/badges/checks-badges.css`
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/pr-inbox/PrInboxView.tsx`
- `src/renderer/pr-inbox/pr-inbox.css`
- `src/renderer/session/VendorBadge.tsx`
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/shell/FirstRunChecks.tsx`
- `test/unit/chip.test.tsx` (новый)
- `test/unit/checks-badges.test.tsx`
- `test/unit/vendor-badge.test.tsx`
- `test/e2e/checks-badges.spec.ts`

## Вне скоупа

- Chip-ы вложений и тегов (`AttachmentChips`, `DocumentChip`, `ImageChip`, `NodeChips`): это не статус.
- В Wave 1 плана Ticket делит `theme/primitives.tsx`, `theme/primitives.css`, `pr-inbox/pr-inbox.css` с Ticket-ом 15 и
  `pr-inbox/PrInboxView.tsx` с Ticket-ом 02: вычисленная Wave возьмёт его после них.
