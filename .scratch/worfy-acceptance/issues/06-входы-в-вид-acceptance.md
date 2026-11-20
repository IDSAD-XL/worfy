# 06 — Входы в вид Acceptance: секция боковой панели, бейдж rail-а, строка палитры, ручные проверки и уведомление ведут на пункт

Type: task
Status: open
Blocked by: 05
Source: [spec.md](../spec.md), «Ticket-ы», 6; «Решения по реализации» → «Входы»; «Решение», путь владельца, шаг 1

Кто: агент.

Не платформенный Ticket (renderer и уведомление в main). Глубина ревью — `medium`.

## Что происходит

- После Ticket-а 05 вид открывается только вкладкой.
- Секции боковой панели — `src/renderer/shell/sidebar/`, образец `PullRequestsSection.tsx`; бейдж rail-а —
  `useRailBadge` (`src/renderer/shell/sidebar-scope.ts:123`), его рисует `src/renderer/shell/Sidebar.tsx`.
- Строки ручных проверок Command palette — `manualCheckCommands` (`src/renderer/palette/commands.ts:656`); сегодня они
  открывают Ticket.
- Уведомление «`<epic> NN` is waiting for you» (`src/main/workflow/waits-notify.ts:87`) открывает доску Pipeline.

## Что делаем

1. `src/renderer/shell/sidebar/AcceptanceSection.tsx` (новый): счёт по Project-ам; щелчок — вид на первом пункте
   Project-а. Бейдж rail-а — число Ready to check.
2. Строка «Acceptance» в группе View Command palette.
3. `manualCheckCommands` открывает вид на пункте, если пункт в очереди, иначе Ticket, как сейчас.
4. Клик уведомления «is waiting for you» открывает вид на Ticket-е, если он там есть, иначе доску Pipeline.
5. `docs/features/app-shell.md` (секция, бейдж, строка палитры) и `docs/features/notifications.md` (куда ведёт клик).

## Готово, когда

- [ ] Unit test (`test/unit/acceptance-section.test.tsx`, новый): счёт по Project-ам и бейдж = Ready to check. Красный до
      правки — в «Итог».
- [ ] Unit test `test/unit/palette-manual-check-row.test.tsx`: строка ручной проверки открывает вид на пункте; пункта
      нет в очереди — Ticket.
- [ ] Unit test `test/unit/notify.test.ts`: клик уведомления ждущего Ticket-а открывает вид, без Ticket-а в очереди —
      Pipeline.
- [ ] e2e test `test/e2e/sidebar-rail.spec.ts`: бейдж Acceptance на rail-е и переход в вид.
- [ ] `docs/features/app-shell.md` и `docs/features/notifications.md` описывают входы;
      `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/shell/sidebar/AcceptanceSection.tsx` (новый), `src/renderer/shell/Sidebar.tsx`,
  `src/renderer/shell/registry.ts`, `src/renderer/shell/sidebar-scope.ts`
- `src/renderer/palette/commands.ts` (`manualCheckCommands`, группа View)
- `src/main/workflow/waits-notify.ts`
- `src/renderer/acceptance/open.ts` (Ticket 05)
- `test/unit/acceptance-section.test.tsx` (новый), `test/unit/palette-manual-check-row.test.tsx`, `test/unit/notify.test.ts`,
  `test/e2e/sidebar-rail.spec.ts`
- `docs/features/app-shell.md`, `docs/features/notifications.md`

Только читать: `src/renderer/shell/sidebar/PullRequestsSection.tsx`.

## Вне скоупа

- Уведомление «N checks wait for you» и утренняя сводка (spec, «Не в этом Epic-е»).
