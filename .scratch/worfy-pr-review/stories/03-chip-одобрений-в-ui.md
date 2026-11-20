# Code story — worfy-pr-review 03: Chip одобрений `1/2` в UI: строка списка, ячейка Approvals, доска Pipeline на Stage Human review и карточка Ticket-а на Canvas

Kind: pr · Epic: worfy-pr-review · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 02 строка inbox несла `approvals` — сколько одобрений есть, сколько требует ветка и откуда число, — но UI
их не показывал: ячейка Review панели была одним словом из `reviewDecision`, доска Pipeline писала только `Waits: team`,
карточка Ticket-а на Canvas не знала об одобрениях. Списка reviewer-ов в строке не было вовсе: ни отзывов, ни открытых
запросов ревью main в snapshot не клал.

- Требование: [Что происходит](../issues/03-chip-одобрений-в-ui.md#что-происходит)

## 2. Список reviewer-ов: отзывы, затем открытые запросы, и команда, которую токен не видит

Code: `src/shared/github/approvals.ts:112-127` · key lines: 116, 117, 120, 123, 124

```ts
function reviewersOf(input: ApprovalsInput, counts: (review: ApprovalReview) => boolean, isStale: (review: ApprovalReview) => boolean, requests: readonly ApprovalRequest[]): PrReviewer[] {
  const reviewers: PrReviewer[] = []
  for (const review of input.reviews) {
    const state = REVIEW_STATE[review.state]
    if (state === undefined || same(review.author, input.author)) continue
    reviewers.push({ login: review.author ?? 'ghost', kind: 'user', state: isStale(review) ? 'stale' : state, counts: counts(review), codeOwner: false })
  }
  for (const request of requests) {
    const login = request.name ?? (request.codeOwner ? HIDDEN_CODE_OWNERS : HIDDEN_TEAM)
    // A reviewer asked again keeps the review they gave: the list says what they did, and that they own the code.
    const known = reviewers.find((each) => same(each.login, login))
    if (known !== undefined) known.codeOwner ||= request.codeOwner
    else reviewers.push({ login, kind: request.name === null ? 'hidden' : request.team ? 'team' : 'user', state: 'requested', counts: false, codeOwner: request.codeOwner })
  }
  return reviewers
}
```

- Что делает: строит `approvals.reviewers` — каждый reviewer один раз: последний отзыв (кроме автора PR и `PENDING`),
  `stale` для одобрения, которое снимает dismiss stale, `counts` — только у одобрения, вошедшего в `have`; затем открытые
  запросы ревью. Запрос без reviewer-а — команда, которую токен не видит: запись `code owners (hidden team)` или
  `a team (hidden)`.
- Почему здесь: пункт 3 Ticket-а требует список reviewer-ов с состоянием каждого; данных для него в строке не было.
  Orchestrator разрешил расширить след на `approvals.ts`, `pr-inbox.ts` и `inbox.ts` (2026-11-20) — в «Итог» Ticket-а
  как «Решено без владельца, подтвердить».
- Без него: ячейке Approvals нечего показать под chip-ом, а запрос code owner-а от скрытой команды молча пропадал.
- Требование: [Что делаем, пункт 3](../issues/03-chip-одобрений-в-ui.md#что-делаем)
- Риски и пробелы test-ов: повторно запрошенный reviewer остаётся со своим старым отзывом, а не «Requested»; поле
  `reviewers` необязательное — snapshot старой Project machine идёт без него, и список тогда не показан.

## 3. Скрытая команда code owner-ов держит счёт

Code: `src/shared/github/approvals.ts:98-100` · key lines: 99, 100

```ts
  const requests = input.requests ?? []
  const hiddenOwners = requests.some((request) => request.name === null && request.codeOwner)
  const codeOwnersPending = codeOwners ? [...input.codeOwnerRequests, ...(hiddenOwners ? [HIDDEN_CODE_OWNERS] : [])] : []
```

- Что делает: когда правило требует code owners, запрос code owner-а без имени попадает в `codeOwnersPending` под
  именем `code owners (hidden team)`: chip не становится зелёным по счёту worfy, tooltip говорит, кого ждут.
- Почему здесь: замечание ревью Ticket-а 02 к `inbox.ts:260-262` — такой запрос отбрасывался, и подсказки «waiting for
  code owners» не было.
- Без него: при правиле code owners и команде, которую токен не видит, `codeOwnersPending` пуст, и без решения GitHub
  счёт worfy назвал бы PR одобренным.
- Требование: [Что делаем, пункт 1](../issues/03-chip-одобрений-в-ui.md#что-делаем)
- Риски и пробелы test-ов: что GitHub отдаёт `requestedReviewer: null` для невидимой команды — из ревью Ticket-а 02
  (grafana), contract test проверяет это на stand-in-е gh, не на GitHub.

## 4. Тексты chip-а: решение GitHub главнее счёта

Code: `src/renderer/pr-inbox/usePrInbox.ts:250-270` · key lines: 251, 256, 260, 264, 268, 270

```ts
export function approvalsChip(approvals: PrApprovals | undefined): ApprovalsChipText | null {
  if (approvals === undefined || approvals.source === 'none' || approvals.decision === null) return null
  const { have, need, decision } = approvals
  const reviewers = approvals.reviewers ?? []
  const counted = need === null || need === 0
  const of = counted ? countOf(have, 'approval') : `${have} of ${need} required approval${need === 1 ? '' : 's'}`
  const ratio = need === null ? `${have}/?` : need === 0 ? `${have}` : `${have}/${need}`
  const approvers = reviewers.filter((each) => each.state === 'approved' && each.counts).map((each) => handleOf(each.login))
  const by = approvers.length === 0 ? [] : [`approved by ${namesText(approvers)}`]
  // Approved by GitHub over a rule the account cannot see: `✓ 2`, no «?» (Q6 (a)).
  if (decision === 'approved') return { tone: 'ready', text: `✓ ${counted ? have : ratio}`, label: `${of}, approved`, tooltip: [of, ...by, 'GitHub says: approved'].join(' · '), owners: false, count: true }
  if (decision === 'changes-requested') {
    const asked = reviewers.filter((each) => each.state === 'changes-requested').map((each) => handleOf(each.login))
    const changes = asked.length === 0 ? 'changes requested' : `changes requested by ${namesText(asked)}`
    return { tone: 'blocked', text: `✕ ${ratio}`, label: `${of}, changes requested`, tooltip: [of, changes, ...by].join(' · '), owners: false, count: true }
  }
  if (need === null) {
    const hidden = "GitHub does not show this branch's review rule to your account. GitHub says: review required"
    return { tone: 'unknown', text: ratio, label: `${of}, rule not visible`, tooltip: [of, ...by, hidden].join(' · '), owners: false, count: true }
  }
  if (need === 0) return { tone: 'neutral', text: 'review required', label: `${of}, GitHub says review required`, tooltip: [of, ...by, 'GitHub says: review required'].join(' · '), owners: false, count: false }
```

- Что делает: из `approvals` — цвет, текст, `aria-label` и tooltip chip-а. Зелёный `✓` — только по `APPROVED` GitHub-а
  (`✓ 2` при скрытом правиле), `✕` — при changes requested, `1/?` — когда правило не видно; правило с нулём одобрений
  при `review-required` пишет `review required`, «0/0» не бывает. Нет правила или решения — chip-а нет.
- Почему здесь: Ticket называет `usePrInbox.ts` среди своих файлов; правила — spec, раздел 3 («Решение GitHub главнее
  счёта»), ответ владельца Q6 (а) и замечание ревью Ticket-а 02 про `need: 0`.
- Без него: chip показал бы `0/0` или выдуманное число там, где правило не видно, и зелёный там, где GitHub ещё держит PR.
- Требование: [Что делаем, пункт 1](../issues/03-chip-одобрений-в-ui.md#что-делаем)
- Риски и пробелы test-ов: тексты — английские строки в коде; локализации нет, как и у остального вида.

## 5. Набранный счёт, который GitHub держит, не называется одобренным

Code: `src/renderer/pr-inbox/usePrInbox.ts:271-290` · key lines: 274, 281, 282

```ts
  const reached = have >= need
  // Code owners a rule wants; else, on a count GitHub holds though it is reached, code owners asked that may be what it
  // waits for — a rule the account cannot see, or a team the token cannot see.
  const askedOwners = reached ? reviewers.filter((each) => each.codeOwner && each.state === 'requested').map((each) => each.login) : []
  const pendingOwners = approvals.codeOwnersPending.length > 0 ? approvals.codeOwnersPending : askedOwners
  const owners = pendingOwners.length === 0 ? [] : [`waiting for code owners: ${namesText(pendingOwners.map(handleOf))}`]
  const stale = approvals.stale === 0 ? [] : [`${countOf(approvals.stale, 'stale approval')}, before the last push`]
  const lastPush = approvals.lastPushNeedsOther ? ['the last push needs another approver'] : []
  // A count reached that nothing above explains: GitHub holds it by a rule worfy does not count, or one it cannot see.
  // The rules worfy does not count are named only here: nearly every repository has one, so on a short count they are noise.
  const unexplained = reached && owners.length === 0 && lastPush.length === 0 ? [approvals.moreRules ? 'more rules apply — GitHub decides' : 'GitHub says: review required'] : []
  const waiting = reached && approvals.codeOwnersPending.length > 0
  return {
    tone: waiting ? 'waiting' : 'neutral',
    text: ratio,
    label: waiting ? `${of}, waiting for code owners` : of,
    tooltip: [of, ...by, ...owners, ...stale, ...lastPush, ...unexplained].join(' · '),
    owners: waiting,
    count: true,
  }
```

- Что делает: при `review-required` объясняет в tooltip, что держит PR: code owners, устаревшие одобрения, последний
  push; если счёт набран, а объяснения нет — «GitHub says: review required» или, при `moreRules`, «more rules apply —
  GitHub decides». Часы и `waiting` — только когда счёт набран и правило ждёт code owners.
- Почему здесь: замечания ревью Ticket-а 02: `moreRules` стоит почти на каждом настоящем репозитории (подсказка на
  каждом PR — шум), а при пустом `codeOwnersPending` tooltip не должен называть PR одобренным по правилам.
- Без него: tooltip `2 of 2 required approvals` без оговорки читался бы как «готово», хотя GitHub не пускает merge.
- Требование: [Что делаем, пункт 1](../issues/03-chip-одобрений-в-ui.md#что-делаем)
- Риски и пробелы test-ов: решение показывать `moreRules` только при набранном счёте — «Решено без владельца,
  подтвердить» в «Итог».

## 6. Ячейка Approvals вместо Review

Code: `src/renderer/pr-inbox/PrInboxView.tsx:562-567` · key lines: 563, 565

```tsx
                  {/* The Approvals cell in place of Review once main reads approvals (worfy-pr-review ticket 03). */}
                  {row.approvals !== undefined ? (
                    <Fact name="Approvals">
                      <ApprovalsCell approvals={row.approvals} viewer={viewer} />
                    </Fact>
                  ) : (
```

- Что делает: когда main прислал `approvals`, ячейка Review панели становится Approvals — chip, строка о том, к чему
  пришёл счёт, и reviewer-ы с состоянием; без `approvals` (Project machine старой версии) — ячейка Review, как раньше.
- Почему здесь: Ticket называет `PrInboxView.tsx` и ячейку Approvals; что старый snapshot должен показываться — not
  recorded в Ticket-е, следует из необязательного поля `approvals` Ticket-а 02.
- Без него: на Linked machine, которая получает snapshot старой Project machine, ячейка осталась бы пустой.
- Требование: [Что делаем, пункт 3](../issues/03-chip-одобрений-в-ui.md#что-делаем)
- Риски и пробелы test-ов: ширина ячейки (`1fr 1.9fr 1fr 1fr`) проверена снимком на 1280 px, на 1600 px — нет.

## 7. Карточка Ticket-а: chip одобрений всегда на своей строке

Code: `src/renderer/canvas/badges/review-threads.ts:87-87` · key lines: 87

```ts
export const reviewLinesOf = (reviews: TicketReviews | null): number => (reviews === null ? 0 : reviewLabels(reviews).length + (reviews.short === null ? 0 : 1))
```

- Что делает: число строк badge-а ревью — по строке на ярлык и ещё одна под chip одобрений. Это число `reviewChipsOf`
  отдаёт раскладке карточки (`REVIEW_LINE` на строку).
- Почему здесь: Ticket, пункт 5 — «высота строки `REVIEW_LINE` не растёт»; Q5 (а) — chip только пока PR открыт и
  одобрений не хватает.
- Без него: chip без места на карточке с `overflow: hidden` обрезался бы. Первая версия ставила chip рядом с последним
  ярлыком — e2e `checks-badges.spec.ts:377` в CI PR #2073 показал, что «changes requested» и `✕ 0/? approvals` вместе
  шире карточки (226 px при 218).
- Требование: [Что делаем, пункт 5](../issues/03-chip-одобрений-в-ui.md#что-делаем)
- Риски и пробелы test-ов: карточка с chip-ом стала на строку выше; что ничего не обрезано, проверяет e2e
  `checks-badges.spec.ts:377` (`ticketCardCuts`) только для случая «changes requested» с `✕ 0/? approvals`.

## 8. Доска Pipeline: только на Human review

Code: `src/renderer/pipeline/PipelineBoard.tsx:95-95` · key lines: 95

```tsx
  const short = ticket.kind === 'human-review' ? approvals : undefined
```

- Что делает: chip `1/2 approvals` после `Waits: team · ` — только на Stage Human review; карта `approvalsByTicket`
  (board.ts) держит лишь Ticket-ы, чьему PR не хватает одобрений.
- Почему здесь: Ticket, пункт 4, и Q5 (а).
- Без него: chip стоял бы на карточке в любой колонке, где у Ticket-а есть PR.
- Требование: [Что делаем, пункт 4](../issues/03-chip-одобрений-в-ui.md#что-делаем)
- Риски и пробелы test-ов: снимка доски нет — только unit test.

## 9. Что сознательно не меняли

Группировка inbox (`inbox-groups.ts`) и правило Stage Human review (`pipeline.ts`, ждёт `APPROVED`) не тронуты. Chip в
Review mode и в результатах поиска — Ticket-ы 09 и 05. Русские страницы Feature — Ticket 12.

## 10. Как проверено

Touched test-файлы (`pnpm test` по 8 файлам: approvals-chip, pr-inbox-view, pipeline-board, ticket-card,
review-threads-badge, pr-approvals, pr-inbox-approvals, pr-inbox) — exit 0; `pnpm lint`, `pnpm typecheck` — exit 0;
e2e `pnpm test:e2e test/e2e/pr-inbox.spec.ts -g "approvals chip"` — exit 0. Полный `pnpm test` и `gate fast` — exit 1 и
exit 2: 20–22 test-а наблюдения за файлами (`docs-watch-root`, `docs`, `product-watch`, `workflow-reader`,
`cards-watch-edits`, `claude-home-registry`, `harness-script-env`) при `fseventsd` на 108–116 % CPU; они же красные
отдельно и кода этого PR не касаются.

## Проверить себя

1. Почему chip не зеленеет, когда worfy насчитал `2 of 2`, а GitHub говорит `REVIEW_REQUIRED`?
   - Ответ: зелёный только по решению GitHub; при набранном счёте и `review-required` tooltip говорит «GitHub says: review
     required» или «more rules apply», а chip остаётся нейтральным.
   - Строки: `src/renderer/pr-inbox/usePrInbox.ts:260`, `src/renderer/pr-inbox/usePrInbox.ts:281`
2. Как запрос ревью к команде, которую токен не видит, удерживает chip от зелёного?
   - Ответ: такой запрос code owner-а идёт в `codeOwnersPending` под именем `code owners (hidden team)`, когда правило
     требует code owners, и `decisionOf` без решения GitHub-а не даёт `approved`.
   - Строки: `src/shared/github/approvals.ts:99-100`
3. Когда chip одобрений делает карточку Ticket-а выше?
   - Ответ: только когда у неё нет других chip-ов ревью: тогда он берёт строку `REVIEW_LINE`; рядом с ярлыком строк не
     прибавляет.
   - Строки: `src/renderer/canvas/badges/review-threads.ts:87`

## 11. Что нашёл review и что осталось

> VERIFIED — worfy-pr-review 03 (the approvals chip 1/2 in the PR list, the Approvals cell, the Pipeline board and the Ticket card), head 44bda4d975f876d517221a37dbeb71e771a6b90e
>
> Gate (depth medium): verifier (lens: implementer's report) VERIFIED; reviewer (lens: correctness) no findings above low. CI round: the first head was red on two e2e tests this PR caused (checks-badges.spec.ts:377 — the Ticket card chips overflowed the 218 px card, fixed in code: the approvals chip always on its own line; pr-inbox.spec.ts:224 — the Approvals cell replaces Review as the ticket says, expectation updated); both spec files pass whole locally (17/17).
>
> - Verifier: chip states (usePrInbox.ts:250-291, ApprovalsChip.tsx); row chip PrInboxView.tsx:344-345 and Approvals cell :562-570 with the Review fallback; Pipeline «Waits: team · 1/2 approvals» only on Human review (PipelineBoard.tsx:95); Ticket card line via reviewLinesOf (review-threads.ts:88), REVIEW_LINE 18; approvalsOf reviewers incl. hidden code owner and stale (approvals.ts:98-127). 13 mutants red. Screenshots light/dark 1280 px match the ticket; fixture names only.
> - Reviewer: hidden code-owner request keeps codeOwnersPending only when reviewDecision is null — display only; Ready group and Human review still read reviewDecision, nothing GitHub considers mergeable is blocked; author's and PENDING reviews not counted; older snapshots without reviewers parse; the extra chip line flows into cardHeight (ticket-card.ts:373) and epic-layout.ts:275; Pipeline waits never null on Human review (pipeline.ts:422). 7 test files 228 passed, typecheck EXIT=0.
> - check-feature-docs, check-personal, story-check, evidence-check EXIT=0. ci-ok pass on the head.
>
> Decided without the owner (to confirm): a hidden team request shows as «code owners (hidden team)» / «a team (hidden)»; the Review cell gives way to Approvals when the row has approvals; the review badge on a Ticket card appears on missing approvals alone; the approvals chip always on its own card line (card 18 px taller).
>
> Consider [low]: a DISMISSED review under dismiss-stale shows as «Approved · stale» (approvals.ts:117); a review requested from a Bot / Mannequin shows as «a team (hidden)» (inbox.ts:87 lacks ... on Bot / Mannequin); with reviewDecision null and the rule met the chip says «GitHub says: approved» though GitHub said nothing (usePrInbox.ts:260,319); stale comments ticket-card.ts:335-336, review-threads.css:3; e2e evidence lines cite 794a964a6.
