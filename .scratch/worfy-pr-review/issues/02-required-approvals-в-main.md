# 02 — Required approvals в main: правило базовой ветки (ruleset и classic protection), действующие одобрения, `approvalsOf` и поле `approvals` строки inbox

Type: task
Status: done 2026-11-20T04:14Z
PR: #2058
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
  - evidence: gate pass · `gate fast` exit 0 · mac - · bb9444923fe946f705cbb68e6f563bb3b078e92d
- [ ] Contract `test/contract/pr-inbox-approvals.test.ts` (новый) на gh stand-in (`WORFY_GH`): ruleset-ы репозитория и
      организации, classic protection видимая (admin) и `null`, поле `approvals` в строке inbox; `rateLimit.cost` до и
      после записан в «Итог».
  - evidence: gate pass · `gate fast` exit 0 · mac - · bb9444923fe946f705cbb68e6f563bb3b078e92d
- [ ] `test/contract/pr-inbox.test.ts` и `test/unit/pr-inbox-groups.test.ts` зелёные без правки ожиданий группировки.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bb9444923fe946f705cbb68e6f563bb3b078e92d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44667289013/job/136070139589 · ci - · a88b47db866acab25911ea55be2e0dc027001ff5

## Где в коде

- `src/shared/github/approvals.ts` (новый)
- `src/main/github/inbox.ts` (`PULL_FIELDS`, `rowOf`, тип `ReadPull`)
- `src/shared/ipc/pr-inbox.ts` (`PrInboxRow`)
- `test/unit/pr-approvals.test.ts` (новый), `test/contract/pr-inbox-approvals.test.ts` (новый)

Только читать: `src/main/github/inbox-groups.ts`, `src/main/github/prs.ts` (`ghRunner`, `WORFY_GH`),
`test/contract/pr-inbox.test.ts` (образец stand-in-а).

## Вне скоупа

- Chip в UI, доска Pipeline и карточка Ticket-а — Ticket 03. Поиск — Ticket 04.

## Итог

- Сначала падающий: `test/unit/pr-approvals.test.ts` красный без модуля `src/shared/github/approvals.ts` (импорт не
  находится, 0 test-ов); `test/contract/pr-inbox-approvals.test.ts` на читателе из `origin/main` (`db924b6a1`) — 6 из 7
  красные (в строке нет `approvals`, в запросе нет правил); зелёный только test разбора старого snapshot-а.
- `approvalsOf` (`src/shared/github/approvals.ts`) — чистая функция: `need` — наибольшее из `requiredApprovingReviewCount`
  правил `PULL_REQUEST` ruleset-ов и classic protection (у protection с `requiresApprovingReviews` без числа — 1, как у
  GitHub; protection без `requiresApprovingReviews` правилом ревью не считается); источник `hidden` и `need = null`, когда
  правил не прочитано, а `reviewDecision` не `null`; `none` и `need = 0` — когда нет ни того, ни другого. `have` — отзывы
  `APPROVED` с `authorCanPushToRepository: true`, не автора PR, и при dismiss stale — только на head commit (отзыв на старом
  commit-е и `DISMISSED` идут в `stale`). `decision`: `reviewDecision` GitHub-а главнее счёта; без него — счёт против
  `need`, зелёный только без code owners в ожидании, без last push и без `moreRules`.
- `PrInboxRow.approvals` — необязательное поле (`prApprovalsSchema` в `src/shared/ipc/pr-inbox.ts`): snapshot Project
  machine старой версии на Linked machine разбирается без него. Группировка (`inbox-groups.ts`) не тронута: Ready
  по-прежнему по `decisionOf`; `test/contract/pr-inbox.test.ts` и `test/unit/pr-inbox-groups.test.ts` зелёные без правки.
- **Решено без владельца, подтверждено владельцем 2026-11-20:** `writersOnly: true` из пункта 1 не поставлен. Отзывы читаются как раньше, все
  (`latestOpinionatedReviews(first: 50)`), с `authorCanPushToRepository`, а отбор по праву записи делает `approvalsOf`.
  Причина: `decisionOf` берёт решение из отзывов, когда `reviewDecision` равен `null`; с `writersOnly` одобрение человека
  без права записи перестало бы переводить PR в Ready — это правка правила группировки, которую Ticket запрещает. И
  spec (раздел 3) хочет показывать такие одобрения серым «does not count» — без них в ответе показать нечего. Цена: те же
  50 отзывов на PR, запрос не дороже (замер ниже).
- **Решено без владельца, подтверждено владельцем 2026-11-20:** кто сделал последний push, GraphQL не говорит; `lastPusher` — автор head commit-а
  (`commits(last: 1) { commit { author { user { login } } } }`). `lastPushNeedsOther` — правило есть, одобрения есть, но
  ни одного на head commit-е от другого человека.
- `codeOwnersPending` — открытые запросы с `asCodeOwner: true` (login или `combinedSlug` команды, вида `org/team`), только
  когда правило требует code owners. `moreRules` — `requiredReviewers` не пуст или
  `requireExtraApprovalForUnattributedChanges`; `ignore_approvals_from_contributors` в GraphQL нет (интроспекция
  `PullRequestParameters` 2026-11-20).
- Цена (`rateLimit.cost`) страницы деталей из 10 PR, vercel/next.js, 10 открытых PR, токен IDSAD-XL, 2026-11-20: до —
  6, после — 6 (и `rateLimit(dryRun: true)`, и настоящий запрос). Цена не выросла: выбран путь «в том же запросе», без
  отдельного `GET …/rules/branches/{base}` и кэша. В contract test-е stand-in отдаёт `rateLimit` из fixture-а, настоящую
  цену он не знает; замер — этими запросами только на чтение.
- Сверка «действует наибольшее из правил» — частичная, без тестового репозитория: создать ruleset-ы — запись на GitHub,
  владелец спит. На vercel/next.js (`canary`) четыре правила `PULL_REQUEST` с числами 1, 0, 0, 1 (одно с code owners);
  PR без одобрений — `REVIEW_REQUIRED` (не наименьшее 0), PR #102099 с одним одобрением писателя — `APPROVED` (не сумма
  2). Совпадает с «наибольшим»; classic protection этого репозитория нам не видна (`null`), так что исключить её влияние
  нельзя. Сверка на тестовом репозитории с двумя правилами — открыта.
