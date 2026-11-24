# 06 — Входы в вид Acceptance: секция боковой панели, бейдж rail-а, строка палитры, ручные проверки и уведомление ведут на пункт

Type: task
Status: claimed 2026-11-24T02:57Z
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
  - evidence: test-run pass · `pnpm exec vitest run test/unit/acceptance-section.test.tsx` exit 0 · mac - · fe45ed8a5
- [ ] Unit test `test/unit/palette-manual-check-row.test.tsx`: строка ручной проверки открывает вид на пункте; пункта
      нет в очереди — Ticket.
  - evidence: test-run pass · `pnpm exec vitest run test/unit/palette-manual-check-row.test.tsx test/unit/palette-commands.test.tsx` exit 0 · mac - · fe45ed8a5
- [ ] Unit test `test/unit/notify.test.ts`: клик уведомления ждущего Ticket-а открывает вид, без Ticket-а в очереди —
      Pipeline.
  - evidence: test-run pass · `pnpm exec vitest run test/unit/notification-ticket-click.test.tsx` exit 0 · mac - · fe45ed8a5
- [ ] e2e test `test/e2e/sidebar-rail.spec.ts`: бейдж Acceptance на rail-е и переход в вид.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/sidebar-rail.spec.ts test/e2e/sidebar-sections.spec.ts` exit 0 · mac dev · fe45ed8a5
- [ ] `docs/features/app-shell.md` и `docs/features/notifications.md` описывают входы;
      `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · fe45ed8a5
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

## Итог

- Секция `src/renderer/shell/sidebar/AcceptanceSection.tsx` (rail: после Pull requests): по Project-у — строки Ready to
  check, Update first, Waits for you, Failed со счётом; клик — вид на первой строке Project-а в этой группе, Project не
  открывается. Бейдж rail-а — число Ready to check Project-ов переключателя. `Sidebar.tsx`, `registry.ts` и
  `sidebar-scope.ts` не менялись: секцию находит `import.meta.glob`.
- Палитра: «Acceptance» в группе View (с Project-ом и без); строка ручной проверки открывает вид на пункте, если он в
  очереди, иначе карточку Ticket-а. `openAcceptance` с целью, которой нет в очереди, больше не переключает вид.
- Клик «is waiting for you»: окно ждёт первый ответ очереди и открывает вид на Ticket-е или, как раньше, доску Pipeline
  (`src/renderer/canvas/overlays/NotificationTarget.tsx`); не дождалось ответа очереди за время жизни заметки (10 s) —
  доска Pipeline. `src/main/workflow/waits-notify.ts` не менялся: очередь есть и в main (`src/main/acceptance/service.ts`),
  но окно читает очередь своей Machine в момент клика (окно, перезагруженное на Linked machine, — очередь той Machine);
  проверка в main потребовала бы нового поля заметки и видела бы очередь на момент показа, а не клика. Test-ы — в `test/unit/notification-ticket-click.test.tsx` вместе с прежними test-ами этого клика
  (вынесены из `test/unit/pipeline-board.test.tsx`, перешедшего 1000 строк), а не в `test/unit/notify.test.ts` (там
  test-ы main).
- Ready to check в секции и бейдж не считают пункты с отметкой Sent — как счёт вкладки после ревью 05.
- Решено без владельца: секция и её бейдж следуют переключателю Project-ов боковой панели, как Pull requests. Это
  отступление от spec.md:94 («На rail-е и на вкладке — бейдж «3»», одно число): при «All Projects» числа совпадают, при
  одном Project-е бейдж rail-а считает только его.
- Красный до правки: `pnpm exec vitest run test/unit/acceptance-section.test.tsx test/unit/palette-manual-check-row.test.tsx
  test/unit/pipeline-board.test.tsx` — exit 1: файла секции нет («Failed to resolve import …/AcceptanceSection»), строка
  палитры вела к Ticket-у, строки «Acceptance» не было, клик уведомления открывал Pipeline. После правки — exit 0.
- Снимки (e2e `test/e2e/sidebar-rail.spec.ts`, в репозиторий не кладутся):
  `test-results/worfy-acceptance-06-screens/sidebar-acceptance-1280-{light,dark}.png` и
  `sidebar-acceptance-view-1280-{light,dark}.png`.
