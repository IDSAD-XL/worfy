# Code story — worfy-pr-review 02: Required approvals в main: правило базовой ветки (ruleset и classic protection), действующие одобрения, `approvalsOf` и поле `approvals` строки inbox

Kind: pr · Epic: worfy-pr-review · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

Ячейка Review выбранного PR показывала одно слово из `reviewDecision`. Сколько одобрений требует базовая ветка и
сколько их уже есть, worfy не читал: запрос деталей PR не просил ни правил ветки, ни права записи reviewer-а, ни признака
code owner у запроса ревью. Этот PR читает правила в том же запросе деталей, считает одобрения чистой функцией и кладёт
результат в строку inbox (`approvals`). Chip в UI — Ticket 03.

- Требование: [Что происходит](../issues/02-required-approvals-в-main.md#что-происходит)

## 2. Запрос деталей читает правила базовой ветки

Code: `src/main/github/inbox.ts:78-92` · key lines: 79, 80, 86, 88

```ts
const BASE_RULES = [
  'rules(first: 50) { nodes { type parameters { ... on PullRequestParameters { requiredApprovingReviewCount dismissStaleReviewsOnPush requireCodeOwnerReview requireLastPushApproval requireExtraApprovalForUnattributedChanges requiredReviewers { minimumApprovals } } } } }',
  'branchProtectionRule { requiresApprovingReviews requiredApprovingReviewCount requiresCodeOwnerReviews dismissesStaleReviews requireLastPushApproval }',
].join(' ')
export const PULL_FIELDS = [
  'number title url state isDraft isCrossRepository createdAt updatedAt baseRefName headRefName headRefOid reviewDecision mergeable mergeStateStatus additions deletions',
  'author { login }',
  'commits(last: 1) { nodes { commit { author { user { login } } statusCheckRollup { state } } } }',
  `baseRef { ${BASE_RULES} }`,
  'reviewRequests(first: 10) { nodes { asCodeOwner requestedReviewer { __typename ... on User { login } ... on Team { slug combinedSlug } } } }',
  'latestOpinionatedReviews(first: 50) { nodes { author { login } state submittedAt authorCanPushToRepository commit { oid } } }',
  `reviewThreads(first: 50) { nodes { id isResolved isOutdated path line viewerCanReply comments(last: 3) { nodes { ${COMMENT} } } } }`,
  `comments(last: 5) { nodes { ${COMMENT} } }`,
].join(' ')

```

- Что делает: к каждому PR страницы деталей добавлены `baseRefName`, правила ruleset-ов базовой ветки (`Ref.rules`,
  правила организации тоже), classic protection (`Ref.branchProtectionRule`), автор head commit-а, `asCodeOwner` и
  `combinedSlug` у запросов ревью, `authorCanPushToRepository` и `commit { oid }` у отзывов.
- Почему здесь: Ticket и spec (раздел 3) велят читать правила в том же запросе деталей, а отдельный вызов
  `rules/branches` — только если цена страницы выросла больше чем вдвое. Замер: `rateLimit.cost` страницы из 10 PR
  vercel/next.js — 6 до и 6 после.
- Без него: числа «сколько требует ветка» взять неоткуда: у PR такого поля нет.
- Требование: [Что делаем, пункты 1 и 4](../issues/02-required-approvals-в-main.md#что-делаем)
- Риски и пробелы test-ов: `writersOnly: true` из пункта 1 сознательно не поставлен (отзывы без права записи нужны
  `decisionOf` и для серого «does not count»), отбор по праву записи — в `approvalsOf`. Classic protection GitHub
  отдаёт только админу; остальным `null`. Настоящую цену stand-in не знает — замер сделан вручную, запросами на чтение.

## 3. Сколько требует ветка: наибольшее из правил, иначе hidden или none

Code: `src/shared/github/approvals.ts:61-68` · key lines: 64, 65, 67, 68

```ts
export function approvalsOf(input: ApprovalsInput): PrApprovals {
  const protection = input.protection?.requiresApprovingReviews === true ? input.protection : null
  // GitHub's own default for a protection that asks for reviews without a number is 1.
  const protectionNeed = protection === null ? null : (protection.requiredApprovingReviewCount ?? 1)
  const rulesetNeed = input.rules.length === 0 ? null : Math.max(...input.rules.map((rule) => rule.requiredApprovingReviewCount))
  const source: PrApprovals['source'] =
    rulesetNeed === null && protectionNeed === null ? (input.reviewDecision === null ? 'none' : 'hidden') : (protectionNeed ?? -1) > (rulesetNeed ?? -1) ? 'protection' : 'ruleset'
  const need = source === 'hidden' ? null : source === 'none' ? 0 : Math.max(rulesetNeed ?? 0, protectionNeed ?? 0)
```

- Что делает: `need` — наибольшее из чисел правил `PULL_REQUEST` и classic protection; ничего не прочитано, а GitHub
  даёт `reviewDecision` — источник `hidden` и `need = null` (chip `1/?`); ничего не прочитано и решения нет —
  `none`, `need = 0`.
- Почему здесь: правила раздела 3 spec-а и ответ владельца Q6 (а): не выдумывать число, когда правило не видно.
- Без него: при скрытой classic protection worfy показал бы `0` нужных одобрений там, где GitHub требует их.
- Требование: [Что делаем, пункт 2](../issues/02-required-approvals-в-main.md#что-делаем)
- Риски и пробелы test-ов: что действует наибольшее из нескольких правил — вывод; сверено только частично, на
  vercel/next.js (правила 1, 0, 0, 1: без одобрений — `REVIEW_REQUIRED`, с одним — `APPROVED`). Protection,
  которая просит ревью без числа, считается за 1 — по умолчанию GitHub; test-ом на настоящем GitHub не проверено.

## 4. Сколько одобрений считается

Code: `src/shared/github/approvals.ts:75-80` · key lines: 75, 77, 78

```ts
  const writers = input.reviews.filter((review) => review.authorCanPush === true && !same(review.author, input.author))
  const isStale = (review: ApprovalReview): boolean =>
    dismissStale && (review.state === 'DISMISSED' || (review.state === 'APPROVED' && review.commit !== null && input.headRefOid !== null && review.commit !== input.headRefOid))
  const counted = writers.filter((review) => review.state === 'APPROVED' && !isStale(review))
  const have = counted.length
  const stale = writers.filter(isStale).length
```

- Что делает: считаются последние `APPROVED` reviewer-ов с правом записи, кроме автора PR; при dismiss stale отзыв на
  старом commit-е или `DISMISSED` идёт в `stale`, а не в `have`.
- Почему здесь: раздел «Факты» spec-а: одобрение без права записи правило не считает, а dismiss stale снимает
  одобрение при push.
- Без него: одобрение человека без права записи дало бы зелёный счёт, который GitHub не принимает.
- Требование: [Готово, когда, unit test](../issues/02-required-approvals-в-main.md#готово-когда)
- Риски и пробелы test-ов: отзыв без `authorCanPushToRepository` (старый ответ, поле не пришло) не считается.

## 5. Решение GitHub главнее счёта

Code: `src/shared/github/approvals.ts:89-96` · key lines: 90, 92, 94, 95

```ts
function decisionOf(reviewDecision: string | null, have: number, need: number | null, codeOwnersPending: readonly string[], lastPushNeedsOther: boolean, moreRules: boolean): PrApprovals['decision'] {
  if (reviewDecision === 'APPROVED') return 'approved'
  if (reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested'
  if (reviewDecision === 'REVIEW_REQUIRED') return 'review-required'
  // GitHub gives no decision: worfy's count decides, and green only when nothing it cannot count applies.
  if (need === null || need === 0) return null
  return have >= need && codeOwnersPending.length === 0 && !lastPushNeedsOther && !moreRules ? 'approved' : 'review-required'
}
```

- Что делает: `reviewDecision` GitHub-а, когда он есть, решает за worfy; без него счёт против `need` даёт
  `approved` только без code owners в ожидании, без last push и без правил, которые worfy не считает.
- Почему здесь: spec, раздел 3: «`reviewDecision = APPROVED` — chip зелёный, даже если счёт worfy меньше».
- Без него: PR, который GitHub уже пускает в merge, выглядел бы незаконченным из-за невидимого аккаунту правила.
- Требование: [Что делаем, пункт 2](../issues/02-required-approvals-в-main.md#что-делаем)
- Риски и пробелы test-ов: not recorded.

## 6. Что сознательно не меняли

Группировка (`src/main/github/inbox-groups.ts`) не тронута: Ready по-прежнему по `decisionOf`, и `approvals` она не
читает. Поле `approvals` в `PrInboxRow` необязательное: snapshot Project machine старой версии на Linked machine
разбирается без него. Отдельного вызова `rules/branches` с кэшем нет: цена страницы не выросла.

## 7. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0. Новый unit test красный без модуля
`approvals.ts`; новый contract test на читателе из `origin/main` — 6 из 7 красные.

## Проверить себя

1. Почему отзывы читаются без `writersOnly: true`, хотя считаются только одобрения с правом записи?
   - Ответ: отбор делает `approvalsOf` по `authorCanPush`; все отзывы нужны `decisionOf`, который при пустом
     `reviewDecision` решает группу по отзывам, — иначе изменилось бы правило Ready.
   - Строки: `src/shared/github/approvals.ts:75-78`
2. Что покажет строка, если GitHub ответил `REVIEW_REQUIRED`, а ни ruleset-а, ни protection аккаунт не видит?
   - Ответ: источник `hidden`, `need = null` — число неизвестно, его не выдумывают.
   - Строки: `src/shared/github/approvals.ts:66-68`
3. Почему одобрение старого commit-а иногда считается, а иногда нет?
   - Ответ: оно не считается только когда правило снимает старые одобрения при push (dismiss stale); тогда оно в `stale`.
   - Строки: `src/shared/github/approvals.ts:76-78`

## 8. Что нашёл review и что осталось

> VERIFIED — pr-review 02 (required approvals in main), head a88b47db866acab25911ea55be2e0dc027001ff5
>
> Gate (depth medium): verifier (lens: implementer's report) VERIFIED; reviewer (lens: correctness) 3 med + 1 low; each med went to its own sceptic — all three downgraded to low.
>
> - Verifier: files_changed = diff; pr-approvals (16 unit), pr-inbox-approvals (7 contract), unchanged pr-inbox + pr-inbox-groups green (630 passed); red before on origin/main confirmed (unit fails to load, contract 6 of 7 red); two mutants of its own (author exclusion dropped; write-access filter dropped) each red; gate fast `[gate] green (fast)`; eslint, evidence-check, story-check exit 0. The two «decided without the owner» items hold: writersOnly not set (spec.md:308/421 vs :424-425 contradict; filtering in approvalsOf keeps Ready grouping and the grey «does not count» list); last pusher approximated by the head commit author (null author → flag stays false).
> - Reviewer: query validated live (read-only) on next.js, grafana, node, vscode — branchProtectionRule null for a non-admin without error, cost 1 per PR; schema compatible with an older Linked machine both ways.
> - ci-ok pass on the head.
>
> Consider [low] (downgraded by sceptics; notes for ticket 03):
> - approvals.ts:77 — with dismiss-stale, an APPROVED review on an older commit counts as stale; GitHub dismisses on any diff change incl. Update branch, so only a no-op push leaves it — chip still green (GitHub's decision wins), count understated. Ticket 02 line 81 asks for this behaviour.
> - inbox.ts:260-262 — a code-owner request with requestedReviewer null (a team the token cannot see; 6 of 30 grafana PRs) is dropped: the «waiting for code owners» hint is missing; the chip is right whenever GitHub gives a decision. Fix: a placeholder name.
> - approvals.ts:65-68 — a read rule with 0 approvals gives need 0, source ruleset, even with REVIEW_REQUIRED; not seen on real repos; ticket 03 must render need 0 + review-required sensibly (not «0/0»).
> - inbox.ts:79 — rules(first: 50) counts rules of every type; past 50 a PULL_REQUEST rule may be missed (next.js has 18).
> - requireExtraApprovalForUnattributedChanges is true on every PULL_REQUEST rule seen → the «more rules apply» hint would show on every PR.
> - inbox.ts:179 — stray formatting `={` (main has `= {`).
> - reviews first:10 → 50 can change Ready grouping for PRs with >10 reviewers (spec asks for 50); «Итог» says the input set is unchanged.
>
> Not verified: max-of-rules on a test repo with two rules (needs GitHub writes).
