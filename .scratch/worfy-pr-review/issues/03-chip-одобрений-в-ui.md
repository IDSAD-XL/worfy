# 03 — Chip одобрений `1/2` в UI: строка списка, ячейка Approvals, доска Pipeline на Stage Human review и карточка Ticket-а на Canvas

Type: task
Status: open
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», 3; «Решение», 5; «Как пользователь идёт по экрану», B и D; «Решения по
реализации», 3 и 12; «Вопросы владельцу», Q5 и Q6

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium`; снимки обеих тем в «Итог».

## Что происходит

- После Ticket-а 02 строка inbox несёт `approvals` (`have`, `need`, `source`, code owners, stale), но UI его не
  показывает. Ячейка Review — одно слово из `reviewDecision` (`src/renderer/pr-inbox/PrInboxView.tsx:500-509`).
- Stage Human review Pipeline-а ждёт `APPROVED` и не говорит, сколько осталось (`src/shared/workflow/pipeline.ts:367-368`);
  карточка доски пишет `Waits: team` (`src/renderer/pipeline/PipelineBoard.tsx:133-135`).
- Карточка Ticket-а на Canvas уже держит строку chip-ов ревью из снимка PR inbox (`REVIEW_LINE`,
  `src/renderer/canvas/ticket-card.ts:70`; `src/renderer/canvas/badges/ReviewThreads.tsx`).
- Решения владельца 2026-11-20: Q5 (а) — chip ещё на доске Pipeline (Stage Human review) и на карточке Ticket-а на
  Canvas, только пока PR открыт и одобрений не хватает; Q6 (а) — `1/?` и tooltip «rule not visible to your account»,
  зелёный `✓ 2` при `APPROVED`.

## Что делаем

1. `src/renderer/pr-inbox/ApprovalsChip.tsx` (новый) по прототипу Ticket-а 01: `0/2`, `1/2` (нейтральный), `✓ 2/2` и
   `✓ 2` при `APPROVED` (`--ready-*`), красный с числом при `CHANGES_REQUESTED` (`--blocked-*`), `1/?` приглушённый.
   `aria-label` — текстом («1 of 2 required approvals», «1 approval, rule not visible»). Tooltip — откуда число
   (ruleset, protection, hidden), кто одобрил, «waiting for code owners: …», «more rules apply — GitHub decides».
2. Строка списка PR inbox — chip справа; при `source: 'none'` chip не показан.
3. Ячейка Review панели PR становится ячейкой Approvals: chip и список reviewer-ов с состоянием (approved, changes
   requested, commented, requested, stale, серое «does not count» без права записи); при `none` — «No review rule · 1
   approval».
4. Доска Pipeline: на Stage Human review карточка пишет `Waits: team · 1/2 approvals`, пока одобрений не хватает.
5. Карточка Ticket-а на Canvas: chip в строке chip-ов ревью, только пока PR открыт и одобрений не хватает (Q5 (а));
   высота строки `REVIEW_LINE` не растёт.

## Готово, когда

- [ ] Unit `test/unit/approvals-chip.test.tsx` (новый): тексты, `aria-label`, классы цвета для `0/2`, `1/2`, `✓ 2/2`,
      `✓ 2` при `APPROVED` и `need = null`, `1/?`, changes requested, code owners; красный до правки — в «Итог».
- [ ] `test/unit/pr-inbox-view.test.tsx`: chip в строке и ячейка Approvals со списком reviewer-ов.
- [ ] `test/unit/pipeline-board.test.tsx`: `Waits: team · 1/2 approvals` на Stage Human review; нет chip-а, когда
      одобрений хватает.
- [ ] `test/unit/ticket-card.test.tsx`: chip на карточке при открытом PR и нехватке одобрений; нет — при `✓`.
- [ ] e2e `test/e2e/pr-inbox.spec.ts`: снимок строки и ячейки Approvals в светлой и тёмной теме на 1280 px.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/pr-inbox/ApprovalsChip.tsx` (новый)
- `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/pr-inbox/usePrInbox.ts`
- `src/renderer/pipeline/PipelineBoard.tsx`, `src/renderer/pipeline/board.ts` (`waitsText`)
- `src/renderer/canvas/badges/ReviewThreads.tsx`, `src/renderer/canvas/badges/review-threads.ts`,
  `src/renderer/canvas/ticket-card.ts`
- `test/unit/approvals-chip.test.tsx` (новый), `test/unit/pr-inbox-view.test.tsx`, `test/unit/pipeline-board.test.tsx`,
  `test/unit/ticket-card.test.tsx`, `test/e2e/pr-inbox.spec.ts`

Только читать: `src/shared/github/approvals.ts` (Ticket 02), `src/shared/workflow/pipeline.ts`,
`src/renderer/theme/tokens.css`.

## Вне скоупа

- Chip в Review mode — Ticket 09. Chip в результатах поиска — Ticket 05.
