# 03 — Chip одобрений `1/2` в UI: строка списка, ячейка Approvals, доска Pipeline на Stage Human review и карточка Ticket-а на Canvas

Type: task
Status: claimed 2026-11-20T04:29Z
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

Образец вида — Card `card-53b21f06` («Prototype: PR search and review», Ticket 01), состояние `chips`
(Approvals chip). Состояние открывается сразу по `#state=<name>&theme=dark`.

## Вне скоупа

- Chip в Review mode — Ticket 09. Chip в результатах поиска — Ticket 05.

## Итог

- Сначала падающий: `test/unit/approvals-chip.test.tsx` красный до правки — модуль `src/renderer/pr-inbox/ApprovalsChip`
  не находится, 0 test-ов. Новые test-ы `pr-inbox-view.test.tsx` (3 из 4 красные; зелёный только test старого snapshot-а
  без `approvals`), `pipeline-board.test.tsx` (3 из 3 красные) и `review-threads-badge.test.tsx` (3 из 5 красные; два
  зелёных — `reviewChipsOf`, который правился раньше test-а, и случай «chip-а нет») — красные до правки renderer-а.
- Chip — `ApprovalsChip.tsx`, его тексты — чистая `approvalsChip` в `usePrInbox.ts`: `0/2`, `1/2` нейтральный, `✓ 2/2`
  только при `APPROVED` GitHub-а, `✓ 2` при скрытом правиле, `✕ 1/2` (`--blocked-*`), `1/?` приглушённый с пунктиром,
  часы — когда счёт набран, а code owners держат. `aria-label` — словами; tooltip — кто одобрил, кого из code owners
  ждут, сколько одобрений снял последний push, и почему GitHub держит набранный счёт.
- Строка списка: chip справа, последним в строке меток. Ячейка Review панели становится Approvals, когда main прислал
  `approvals`: chip, строка «of 2 required» / «changes requested» / «waiting for code owners» / «rule not visible to your
  account», список reviewer-ов; snapshot Project machine старой версии — ячейка Review, как раньше. Сетка ячеек — `1fr
  1.9fr 1fr 1fr`, как в прототипе. Chip со словом — ещё и в шапке панели (как в прототипе).
- Доска Pipeline: на Stage Human review — `Waits: team · 1/2 approvals`, пока одобрений не хватает (`approvalsShort`:
  chip показан и GitHub не сказал `APPROVED`); на других Stage-ах chip-а нет. Карточка Ticket-а на Canvas: chip рядом с
  последним chip-ом ревью или отдельной строкой, если их нет; `REVIEW_LINE` прежний (18), строка не выше 16 px.
- Снимки строки и ячейки Approvals на 1280 px: [светлая](../evidence/03-approvals-1280-light.png),
  [тёмная](../evidence/03-approvals-1280-dark.png). От прототипа (Card `card-53b21f06`, `chips`) отличаются: в строке
  chip стоит во второй строке справа, после пузыря нитей (в прототипе — так же, под возрастом); ячейка Approvals живёт
  в общей сетке фактов панели, а не отдельным блоком; аватар команды — круглый, а не квадратный.
- **Решено без владельца, подтвердить:** след Ticket-а расширен (Orchestrator разрешил 2026-11-20): `src/shared/ipc/pr-inbox.ts`
  (необязательное поле `approvals.reviewers`), `src/shared/github/approvals.ts` (`approvalsOf` строит список из отзывов и
  открытых запросов ревью), `src/main/github/inbox.ts` (передаёт все запросы ревью, правка только в `toPull`),
  `test/unit/pr-approvals.test.ts`, `test/contract/pr-inbox-approvals.test.ts`. Причина: строка inbox после Ticket-а 02
  не несла ни отзывов, ни запросов ревью — списка reviewer-ов ячейки Approvals (пункт 3) взять было неоткуда. Snapshot без
  `reviewers` разбирается (test), новый — проходит схему Ticket-а 02 (test). Ещё правлены стили рядом со следом
  (`approvals-chip.css` новый, `pr-inbox.css`, `review-threads.css`) и страницы Feature `pr-inbox.md`,
  `gate-and-github.md`, `workflow.md` (английские; перевод — Ticket 12).
- **Решено без владельца, подтвердить:** запрос code owner-а без reviewer-а (команда, которую токен не видит) — запись
  `code owners (hidden team)`, `requested`, не считается; при правиле code owners она же идёт в `codeOwnersPending` и держит
  chip незелёным (замечание ревью Ticket-а 02 про `inbox.ts:260-262`). Запрос без reviewer-а не от code owner-а —
  `a team (hidden)`.
- **Решено без владельца, подтвердить:** `moreRules` в tooltip называется только тогда, когда счёт набран, а GitHub всё ещё
  не одобрил («more rules apply — GitHub decides»): флаг стоит почти на каждом настоящем репозитории, и на каждом PR
  подсказка была бы шумом. Набранный счёт, который ничто из известного не объясняет, говорит «GitHub says: review
  required» и никогда не называется одобренным.
- **Решено без владельца, подтвердить:** правило с `need: 0` при `decision: review-required` — chip `review required` вместо
  числа, «0/0» не бывает; при `APPROVED` — `✓ 1`.
- **Решено без владельца, подтвердить:** при dismiss stale зелёный chip — только по решению GitHub (spec); одобрение на
  старом commit-е в списке — `Approved · stale`, в tooltip — «1 stale approval, before the last push».
- **Решено без владельца, подтвердить:** Ticket над несколькими репозиториями показывает на карточке и доске первый PR, которому
  не хватает одобрений (в порядке групп вида); tooltip карточки называет его.
- **Решено без владельца, подтвердить:** проверки chip-а на карточке Ticket-а — в `test/unit/review-threads-badge.test.tsx`
  (там fake preload для badge-а; `ticket-card.test.tsx` отключает badge-и mock-ом); в `ticket-card.test.tsx` — место на
  карточке: одна строка `REVIEW_LINE` для chip-а без других chip-ов, ни одной — рядом с ними и при `✓`.
