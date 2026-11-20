# 02 — Required approvals в main: правило базовой ветки (ruleset и classic protection), действующие одобрения, `approvalsOf` и поле `approvals` строки inbox

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 2; «Факты GitHub API» → «Сколько одобрений требует ветка», «Сколько одобрений
есть»; «Решения по реализации», 3; «Решения по test-ам», Seam 1 и 2; «Вопросы владельцу», Q6

Кто: агент.

Не платформенный Ticket (`src/main/`, `src/shared/`, без Harness). Глубина ревью — `medium`.

## Что происходит

- Ячейка Review выбранного PR показывает одно слово из `reviewDecision` (`src/renderer/pr-inbox/usePrInbox.ts:199-210`).
  Сколько одобрений требует ветка и сколько их уже есть, worfy не читает.
- Запрос деталей PR — `PULL_FIELDS` (`src/main/github/inbox.ts:71-79`): `latestOpinionatedReviews(first: 10)` без
  права записи автора, `reviewRequests` без признака code owner, без `baseRefName` и правил ветки.
- Без правила ветки `reviewDecision` равен `null`, и worfy сам решает по отзывам (`src/main/github/inbox-groups.ts:40`,
  `:66-71`).
- Правила ruleset-ов ветки видны читателю (`Ref.rules`), classic protection — только админу (`branchProtectionRule`
  даёт `null`); раздел «Факты» spec-а, проверено ответами публичных репозиториев.

## Что делаем

1. `PULL_FIELDS` получает `baseRefName`, `baseRef { rules(first: 50) { nodes { type parameters { ... on
   PullRequestParameters { requiredApprovingReviewCount dismissStaleReviewsOnPush requireCodeOwnerReview
   requireLastPushApproval } } } } branchProtectionRule { requiredApprovingReviewCount requiresCodeOwnerReviews
   dismissesStaleReviews requireLastPushApproval } }`, `latestOpinionatedReviews(first: 50, writersOnly: true)` с
   `authorCanPushToRepository` и `commit { oid }`, `asCodeOwner` у запросов ревью.
2. Чистая функция `approvalsOf` в `src/shared/github/approvals.ts` (новый): `{ have, need, source: 'ruleset' |
   'protection' | 'hidden' | 'none', codeOwnersPending, stale, lastPushNeedsOther, moreRules, decision }` по правилам
   раздела 3 spec-а: наибольшее из правил `PULL_REQUEST` и classic protection; `hidden` при `reviewDecision` не `null`
   без прочитанного правила (Q6 (а): `need = null`, chip `1/?`); `none` при `reviewDecision = null` без правил;
   `reviewDecision = APPROVED` главнее счёта.
3. `PrInboxRow` (`src/shared/ipc/pr-inbox.ts`) получает `approvals`; строку собирает `rowOf`
   (`src/main/github/inbox.ts:697`). Правило «Ready» группировки (`src/main/github/inbox-groups.ts:121`) не меняется.
4. Цена: contract test записывает `rateLimit.cost` страницы из 10 PR до и после. Если цена выросла больше чем вдвое,
   правило читается отдельным вызовом `GET /repos/{o}/{r}/rules/branches/{base}` с кэшем по `(repo, base)` на 1 час;
   какой путь выбран — в «Итог».
5. Ручная сверка «действует наибольшее из правил» на тестовом репозитории с двумя правилами `pull_request` — в «Итог»
   (раздел «Факты»: это вывод, не проверено по документации).

## Готово, когда

- [ ] Unit `test/unit/pr-approvals.test.ts` (новый): ruleset, classic protection, оба (наибольшее), скрытое правило →
      `need = null`, нет правил → `none`, `APPROVED` главнее счёта, `CHANGES_REQUESTED`, stale при dismiss stale, отзыв
      без права записи не считается, code owners ждут, last push approval. Красный до правки — в «Итог».
- [ ] Contract `test/contract/pr-inbox-approvals.test.ts` (новый) на gh stand-in (`WORFY_GH`): ruleset-ы репозитория и
      организации, classic protection видимая (admin) и `null`, поле `approvals` в строке inbox; `rateLimit.cost` до и
      после записан в «Итог».
- [ ] `test/contract/pr-inbox.test.ts` и `test/unit/pr-inbox-groups.test.ts` зелёные без правки ожиданий группировки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/shared/github/approvals.ts` (новый)
- `src/main/github/inbox.ts` (`PULL_FIELDS`, `rowOf`, тип `ReadPull`)
- `src/shared/ipc/pr-inbox.ts` (`PrInboxRow`)
- `test/unit/pr-approvals.test.ts` (новый), `test/contract/pr-inbox-approvals.test.ts` (новый)

Только читать: `src/main/github/inbox-groups.ts`, `src/main/github/prs.ts` (`ghRunner`, `WORFY_GH`),
`test/contract/pr-inbox.test.ts` (образец stand-in-а).

## Вне скоупа

- Chip в UI, доска Pipeline и карточка Ticket-а — Ticket 03. Поиск — Ticket 04.
