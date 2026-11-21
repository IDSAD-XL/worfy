# Code story — worfy-pr-review 11: Finish review и `pr-review-submit.ts`: диалог с каждым комментарием ровно, lint, проверка head, один POST ревью по Submit человека, новый ADR

Kind: pr · Epic: worfy-pr-review · Ticket: 11 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 10 черновик ревью лежал на машине, а кнопка Finish review была неактивна («Coming next»): отправить
ревью из worfy было нельзя. ADR-0105 разрешал main только две записи на GitHub — ответ в нити и комментарий в
разговоре PR. Владелец 2026-11-20 (Q2 (а)) решил: Submit из диалога, который показывает каждый комментарий ровно, и
один запрос; новый ADR (ADR-0112).

- Требование: [Что происходит](../issues/11-finish-review-и-pr-review-submit.md#что-происходит)

## 2. Сначала посмотреть на GitHub, если прошлый Submit мог дойти

Code: `src/main/github/pr-review-submit.ts:170-186` · key lines: 171, 174, 179, 186

```ts
      // 3. A Submit that may have landed looks on GitHub first, before any other check: found, it is only marked.
      if (submitPending(draft)) {
        let found: { url: string | null } | null
        try {
          found = await this.posted(get, repo, pr, account, commit, draft)
        } catch (error) {
          this.health.failed(root, messageOf(error))
          throw new Refusal(`Not submitted: ${UNCONFIRMED} before, and worfy could not look whether it is on GitHub now: ${firstLine(messageOf(error))}`)
        }
        if (found !== null) {
          const marked = await this.markSubmitted(root, repo, pr, found.url)
          this.health.answered(root)
          return answer('already-submitted', marked, { reviewUrl: found.url })
        }
        // GitHub lists none. Soon after the mark that is no proof: GitHub may list a review late. Later, this Submit
        // goes on with the same texts; the mark stays until the mark of its POST, so a refusal below keeps the lock.
        if (markAge(draft) < LISTING_WAIT_MS) throw new Refusal(`Not submitted: ${NOT_LISTED_YET}`)
```

- Что делает: если прошлый Submit не подтвердился (`submitting` после обрыва или ошибка «GitHub did not confirm»), до
  всех прочих проверок ищет это ревью на GitHub; нашёл — только отмечает `submitted`, POST не делает. Не нашёл в
  первые 5 минут после отметки — отказ «try again in a minute», отметка остаётся. Не нашёл позже — те же тексты идут
  через проверки и один POST; старую отметку заменяет только отметка этого POST.
- Почему здесь: Ticket, «Что делаем», п. 3; образец — Send ответа (`src/main/github/pr-reply-send.ts`). Поиск первым —
  находка ревью раунда 1: ушедшее ревью находится и тогда, когда head сдвинулся или lint стал строже.
- Без него: ответ, потерянный после успешного POST, дал бы второе ревью при повторном щелчке.
- Требование: [Что делаем, п. 3 и 4](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: ошибка чтения ревью — отказ с причиной, черновик остаётся запертым; выйти из этого можно
  Discard-ом (раздел 7). 5 минут ожидания — решено без владельца: POST gh ограничен 30 s, GitHub обычно показывает ревью
  за секунды.

## 3. Какое ревью считается тем самым

Code: `src/main/github/pr-review-submit.ts:290-305` · key lines: 291, 296, 298, 300, 302

```ts
  private async posted(get: (path: string) => Promise<string>, repo: string, pr: number, account: string, commit: string, draft: ReviewDraft): Promise<{ url: string | null } | null> {
    const since = draft.submittingAt === undefined ? Number.NaN : Date.parse(draft.submittingAt) - CLOCK_SKEW_MS
    const wanted = draft.payload.comments.map((comment) => `${comment.path}\n${comment.body.replace(/\r\n/gu, '\n').trimEnd()}`).sort()
    for (let page = 1; page <= REVIEW_PAGES_MAX; page++) {
      const reviews = z.array(reviewSchema).parse(JSON.parse(await get(`repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${page}`)))
      for (const review of reviews) {
        if (review.user?.login?.toLowerCase() !== account.toLowerCase() || review.commit_id == null || !sameSha(review.commit_id, commit) || !sameText(review.body ?? '', draft.payload.body)) continue
        const given = review.submitted_at == null ? Number.NaN : Date.parse(review.submitted_at)
        if (!Number.isNaN(since) && !(given >= since)) continue
        if (review.id == null) continue
        const comments = await this.reviewComments(get, repo, pr, review.id)
        const got = comments.map((comment) => `${comment.path}\n${comment.body.replace(/\r\n/gu, '\n').trimEnd()}`).sort()
        if (got.length === wanted.length && got.every((each, at) => each === wanted[at])) return { url: review.html_url ?? null }
      }
      if (reviews.length < 100) return null
    }
```

- Что делает: берёт ревью этого аккаунта на том же commit-е, с тем же body, в любом состоянии, данное не раньше
  отметки `submitting` минус 2 минуты, и с теми же комментариями к строкам (путь и текст каждого, `GET
  …/reviews/{id}/comments`).
- Почему здесь: ADR-0112, п. 6. Находки ревью раунда 1: сверка state нового выбора пропускала ушедший Approve, а
  сверка только body принимала прежнее ревью с пустым Summary за новое.
- Без него: после 502, который ничего не создал, Submit отметил бы `submitted` по чужому, более раннему ревью, и
  комментарии не ушли бы.
- Требование: [Что делаем, п. 3](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: ревью, отправленное руками с github.com с теми же текстами после отметки, тоже засчиталось
  бы как найденное. 2 минуты допуска часов — решено без владельца.

## 4. Тексты неподтверждённого Submit-а заперты

Code: `src/main/github/pr-review-submit.ts:384-389` · key lines: 384, 387, 388

```ts
  if (submitPending(draft)) {
    // The texts of the Submit GitHub did not confirm, and no others: they may be on GitHub already.
    const was = draft.payload
    const same = was.event === input.event && was.body === input.body && was.comments.length === input.comments.length && was.comments.every((comment, at) => sameComment(comment, input.comments[at]!))
    if (!same) throw new Refusal(`Not submitted: ${UNCONFIRMED} for other texts. Submit those, and worfy first looks whether they are on GitHub`)
    return texts
```

- Что делает: пока Submit не подтверждён, main принимает только ушедшие событие, Summary и комментарии; диалог
  открывается на них же без правки (`submitPending` в `src/shared/ipc/pr-review.ts`), Review mode их не правит. Тот
  же запрет держит main: `textsEditable` в `src/main/github/pr-review-draft.ts` (сохранить или удалить комментарий) и
  `src/main/github/pr-review-agent.ts` (Agent review не запускается).
- Почему здесь: искать на GitHub имеет смысл только то, что ушло; другие тексты — другое ревью.
- Без него: человек сменил бы Comment на Approve, поиск не нашёл бы ушедшее ревью, и ушло бы второе.
- Требование: [Что делаем, п. 3](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: убрать неподтверждённое можно Submit-ом тех же текстов или Discard-ом с предупреждением.

## 5. Проверки до записи: свой PR, сдвинутый head, строки вне diff-а

Code: `src/main/github/pr-review-submit.ts:188-203` · key lines: 189, 200, 201, 203

```ts
      // 4. The check over exactly those texts.
      const lint = await this.lint(root, texts)
      if (lint.kind === 'findings') throw new Refusal(`Not submitted: review-draft-lint found ${lint.findings.join('; ')}`)
      if (lint.kind === 'broken') throw new Refusal(lint.reason)
      // 5. GitHub as it is now: the head, the author, the lines of the diff on the commit.
      let pull: PullNow
      try {
        pull = pullSchema.parse(JSON.parse(await get(`repos/${repo}/pulls/${pr}`)))
      } catch (error) {
        this.health.failed(root, messageOf(error))
        throw new Refusal(`Not submitted: worfy could not read ${repo}#${pr} on GitHub: ${firstLine(messageOf(error))}`)
      }
      if (input.event !== 'COMMENT' && pull.user?.login?.toLowerCase() === account.toLowerCase()) throw new Refusal(OWN_PULL)
      if (!sameSha(pull.head.sha, input.head)) throw new Refusal(`Not submitted: the head of ${repo}#${pr} moved to ${pull.head.sha.slice(0, 7)} since the dialog opened. Look at it again`, pull.head.sha)
      const off = await this.offLines(texts.comments, { who: root, get }, { kind: 'pr', repo, number: pr, headOid: commit, baseOid: pull.base.sha }, sameSha(pull.head.sha, commit))
      if (off.length > 0) throw new Refusal(`Not submitted: GitHub refuses a comment off the lines of the diff on ${commit.slice(0, 7)} — ${off.join('; ')}. Move it to a changed line or remove it`)
```

- Что делает: lint над текстами; читает PR на GitHub (head, base, автор) как аккаунт Project-а; Approve и Request
  changes на своём PR — отказ; head не тот, с которым открылся диалог, — отказ с head-ом сейчас (диалог показывает
  «Your comments are on <a>; the head is <b>.»); комментарий не на изменённой строке commit-а черновика или диапазон
  через две hunk — отказ всего Submit-а. Ни одного запроса записи.
- Почему здесь: Ticket называет `src/main/github/pr-review-submit.ts` и порядок «lint → head → отметка → один POST»
  («Что делаем», п. 2). `commit = draftCommitOf(draft)` — `anchoredOn ?? startedOn` по брифу Orchestrator-а (ADR-0112,
  п. 5; Amendment в spec.md).
- Без него: GitHub отверг бы весь review с одним комментарием вне diff-а (422), а Approve на своём PR — тоже; на
  сдвинутом head человек отправил бы, не увидев новых commit-ов.
- Требование: [Что делаем, п. 2 и 6](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: прототип отправлял остальные комментарии и помечал такие «Not posted» — здесь отказ всего
  Submit-а (решено без владельца, в «Итог»).

## 6. Один POST и что значит его ошибка

Code: `src/main/github/pr-review-submit.ts:243-255` · key lines: 245, 246, 250, 251, 252

```ts
      } catch (error) {
        this.health.failed(root, messageOf(error))
        const refused = refusedByGithub(error)
        const reason = refused !== null ? `GitHub refused the review: ${refused}` : `${UNCONFIRMED}: ${firstLine(messageOf(error))}. Submit again: worfy first looks whether it is on GitHub already`
        await this.options.drafts
          .changeNow(root, repo, pr, (current) => {
            if (current === null || current.state !== 'submitting') throw new Error('not submitting')
            if (refused === null) return { ...current, state: 'draft', error: reason }
            const next: ReviewDraft = { ...current, state: 'draft', error: reason, payload: { ...current.payload, comments: before.payload.comments }, anchors: before.anchors }
            delete next.submittingAt
            return next
          })
          .catch(() => undefined)
```

- Что делает: 4xx (кроме 408) — «GitHub refused the review: <сообщение>», ревью нет: черновику возвращаются
  комментарии и anchors, какими они были до отметки. 5xx, обрыв, timeout — «GitHub did not confirm the review»:
  черновик держит ушедшие тексты и время отметки для поиска. Автоматического повтора нет.
- Почему здесь: Ticket, «Что делаем», п. 2 и 3; возврат комментариев — находка ревью раунда 1 (убранный в диалоге
  комментарий терялся).
- Без него: повтор после 5xx без поиска дал бы два ревью; после 4xx убранный в диалоге комментарий пропал бы из
  черновика.
- Требование: [Что делаем, п. 2 и 3](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: ответ GitHub при висящем pending review с github.com не проверен на настоящем GitHub (п. 8,
  sandbox).

## 7. Discard черновика, чей Submit мог дойти

Code: `src/main/github/pr-review-draft.ts:534-537` · key lines: 534, 536, 537

```ts
        // A POST may still run while its mark is young; a Submit GitHub did not confirm is over, and may be discarded
        // with the warning of the bar: the lookup can fail for good (access lost, repository gone).
        if (draft !== null && ownDraft(draft, file, repo, pr).state === 'submitting' && markAge(draft) < LISTING_WAIT_MS)
          throw new ReviewDraftRefusal('This review is being submitted: it is not discarded')
```

- Что делает: черновик с «GitHub did not confirm the review» удаляется Discard-ом; полоса спрашивает «Discard this
  review?» и предупреждает, что ревью может уже быть на GitHub. Отметку `submitting` моложе 5 минут main не удаляет:
  её POST может ещё идти; старше — worfy закрылся во время POST, и её удалить можно.
- Почему здесь: находка ревью раунда 2. Если поиск падает каждый раз (403/404: доступ потерян, репозиторий удалён),
  Submit отказывает всегда, а правка заперта — без Discard черновик застрял бы навсегда.
- Без него: черновик PR, к которому потерян доступ, нельзя было бы ни отправить, ни убрать.
- Требование: [Что делаем, п. 3](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: после Discard ревью на GitHub, если оно там есть, остаётся; worfy его не трогает.

## 8. Enter не отправляет

Code: `src/renderer/pr-review/FinishReviewDialog.tsx:274-287` · key lines: 277, 279, 283, 286

```tsx
        <button
          type="button"
          className="w-pr-inbox-button w-pr-inbox-button--primary"
          data-testid="pr-review-submit"
          aria-disabled={why !== null}
          title={why ?? 'Click or ⌘↵; Enter alone does not submit'}
          onClick={send}
          onKeyDown={(key) => {
            // A button takes Enter as a click: here only a click or ⌘↵ submits.
            if (key.key === 'Enter' && !key.metaKey && !key.ctrlKey) key.preventDefault()
          }}
        >
          {sending ? 'Submitting…' : moved ? `Submit on ${short(opened.commit)}` : 'Submit review'}
        </button>
```

- Что делает: Submit review — щелчок или ⌘↵; Enter на кнопке в фокусе гасится; на сдвинутом head кнопка называется
  «Submit on <a>».
- Почему здесь: Ticket, «Что делаем», п. 1: «Submit — не кнопка по умолчанию для Enter (щелчок или ⌘↵)».
- Без него: Enter, нажатый по привычке в диалоге, отправил бы ревью на GitHub.
- Требование: [Что делаем, п. 1](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: e2e пути A проверяет, что после Enter нет ни одной записи и диалог открыт.

## 9. PR inbox перечитывает PR сразу после отправки

Code: `src/main/ipc/pr-review.ts:72-81` · key lines: 73, 75, 78

```ts
    defineHandler(prReviewSubmit, async ({ projectId, repo, number, event, body, comments, commit, head }) => {
      const answer = await submitterOf(access).submit(access.root(projectId), repo, number, { event, body, comments, commit, head })
      // GitHub has the review: the PR inbox reads the PR now, not at its next turn, so its approvals chip counts it.
      if (answer.outcome === 'submitted' || answer.outcome === 'already-submitted')
        void access
          .inbox?.()
          .refresh(repo, number)
          .catch((error: unknown) => console.warn('[pr-review] reading the PR again after Submit failed', error))
      return answer
    }),
```

- Что делает: когда GitHub принял ревью (или оно нашлось), main просит PR inbox прочитать этот PR сейчас; chip
  одобрений строки считает новое Approve.
- Почему здесь: spec, решение 7, шаг 5: «PR inbox и строка результата перечитывают PR (`refresh`)». Первый прогон e2e
  пути E показал, что строка inbox оставалась `0/1`: чтение при открытии вида ограничено раз в 30 секунд.
- Без него: chip показывал бы старое число одобрений до следующего цикла PR inbox (5 минут).
- Требование: [Готово, когда — e2e, chip 1/2 → 2/2](../issues/11-finish-review-и-pr-review-submit.md#готово-когда)
- Риски и пробелы test-ов: ошибка этого чтения только пишется в log; ревью от этого не страдает.

## 10. Что сознательно не меняли

- Pending review на GitHub main не создаёт и не продолжает; resolve, re-request review, dismiss, merge — нет
  (ADR-0112, п. 8).
- Полоса сдвинутого head не называет комментарии, которые GitHub покажет как outdated (поток C.3 spec-а) — не сделано.

## 11. Как проверено

- `pnpm test test/contract/pr-review-submit.test.ts` — exit 0 (gh stand-in; красный до модуля, до
  `refresh` и до правок раунда 2: 5 failed).
- `pnpm test test/unit/finish-review-dialog.test.tsx` — exit 0; `pnpm test test/unit/review-comments.test.tsx` — exit 0
  (запертый неподтверждённый черновик: 2 failed до правки).
- `pnpm test test/contract/harness-review-draft-lint.test.ts` — exit 0 (красный на старом скрипте: 2 failed; на
  `--untiered`: 1 failed).
- `pnpm test:e2e test/e2e/pr-review.spec.ts test/e2e/pr-inbox.spec.ts` — exit 0, 18 passed.
- Mutation testing: 15 mutant-ов раунда 1, 13 раунда 2 и 10 раунда 3, все убиты.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Проверить себя

1. Почему Submit отказывает целиком, если один комментарий не на изменённой строке, а не отправляет остальные?
   Строки: `src/main/github/pr-review-submit.ts:202-203`
   Ответ: GitHub отвергает весь review с таким комментарием, а молча выкинутый комментарий меняет смысл ревью;
   человек убирает или переносит его сам.
2. Что делает второй щелчок Submit после ответа 502 и почему он не создаёт второе ревью?
   Строки: `src/main/github/pr-review-submit.ts:171-186`
   Ответ: до всех прочих проверок main читает ревью PR и ищет ревью этого аккаунта с ушедшими текстами, данное после
   отметки; нашёл — только отмечает `submitted`. Не нашёл в первые 5 минут — отказ: GitHub может показать ревью позже.
3. Почему после 502 человек не может сменить Comment на Approve и отправить снова?
   Строки: `src/main/github/pr-review-submit.ts:384-388`
   Ответ: искать на GitHub можно только то, что ушло; другие тексты не нашлись бы, и ушло бы второе ревью.
4. На каком commit-е стоят комментарии, если человек перенёс черновик на новый head?
   Строки: `src/main/github/pr-review-submit.ts:68-68`
   Ответ: `draftCommitOf` — `anchoredOn`, если он есть, иначе `startedOn`: строки комментариев — строки того commit-а.

## 12. Что нашёл review и что осталось

> VERIFIED — worfy-pr-review 11 (Finish review and pr-review-submit.ts: a dialog with every comment exactly, lint, head check, one POST of a review on the person's Submit, new ADR-0112), head f170ea1b33cc08732469e5c122b75c2117061f68
>
> Gate (depth max, three rounds): verifier (lens: implementer's claims, sonnet) — MERGE, all eight claims CONFIRMED, five mutants caught; max review on 52f0db464 (correctness and simplification, each on two models, four sceptics) — MAX-REVIEW REJECTED with four findings, none refuted, taken as round 1; reviewer (correctness) — round 2 MERGE (A–D fixed, three lows sent to round 3 because they touch «never a second review»), round 3 MERGE.
>
> - What the user sees: Finish review (or ⌘⇧↵) opens a dialog — Summary, Comment / Approve / Request changes starting on Comment, «The agent suggests», every comment as it will be posted with Remove, the lint result; Submit only by click or ⌘↵; one POST /pulls/{n}/reviews with commit_id = the draft's commit; then a toast, the approvals chip counts it, and Review mode shows «You reviewed this pull request».
> - «Never a second review»: after a Submit GitHub did not confirm, texts and verdict stay locked in the renderer and in main (saveComment, deleteComment, Agent review refused); the next Submit first looks the review up (account, commit, body, any state, not earlier than the mark minus 2 minutes, the same line comments); «not found» within 5 minutes of the mark refuses and keeps the mark; only the next POST's mark replaces it. A 4xx refusal gives the draft back every comment removed in the dialog. Discard of an unconfirmed draft is allowed with a warning. review-draft-lint --rules without tiers refuses again; Submit passes --untiered.
> - Evidence: contract pr-review-submit 24 tests, pr-review-draft, pr-review-agent, review-comments 95 passed EXIT=0; 23 mutants over rounds 2–3 each red on its own test; e2e pr-review.spec.ts + pr-inbox.spec.ts whole 18 passed EXIT=0; harness/bin e2e specs 53 + packaged 11 passed EXIT=0; plugin-neutral, harness-home, agents-text EXIT=0; pnpm lint, typecheck, test (20216) EXIT=0; story-check, evidence-check EXIT=0; gate fast green EXIT=0.
> - Debt (low): the agent's script harness/bin/pr-review-draft:183-184 does not refuse an unconfirmed draft (a live Agent review Session could add a comment after a 502, then the lookup misses the landed review); clocks ahead of GitHub by more than 2 minutes, or set back, delay or miss the lookup (src/main/github/pr-review-submit.ts:291, src/shared/ipc/pr-review.ts:119-122); duplicated helpers (draftCommitOf, OWN_PULL, whereOf, sameText, keyed queue) to share via src/shared/ipc/pr-review.ts.
> - Not verified: item 8 sandbox — what GitHub answers to the POST while a pending review started on github.com exists (no real GitHub in tests); at the owner's acceptance (ticket 13).
>
> Decided without the owner (to confirm): the changed lines are checked against GitHub's diff on the comments' commit; 4xx is a refusal, 5xx / network / timeout «not confirmed»; Remove acts on this Submit only; Summary lives in the window's memory; PR inbox re-reads the PR after Submit; the lint without --rules takes the template's largest max_chars; a 2-minute clock allowance; comments compared by path and text; the --untiered flag; a 5-minute wait before «not found» frees the draft; a mark without time counts as old; the max review REJECTED taken as review round 1 instead of blocking the ticket.

Code: `harness/bin/pr-review-draft:183-184` · key lines: 183

```
    if (draft.state !== "draft") die(1, `the review is ${draft.state}: nothing written`)
    if (isObject(draft.agent) && draft.agent.state === "stopped") die(1, "Agent review was stopped in worfy (Stop or Take over): nothing written")
```

Code: `src/main/github/pr-review-submit.ts:291-291` · key lines: 291

```ts
    const since = draft.submittingAt === undefined ? Number.NaN : Date.parse(draft.submittingAt) - CLOCK_SKEW_MS
```

Code: `src/shared/ipc/pr-review.ts:119-122` · key lines: 119

```ts
export const markAge = (draft: Pick<ReviewDraft, 'submittingAt'>, now: number = Date.now()): number => {
  const at = draft.submittingAt === undefined ? Number.NaN : Date.parse(draft.submittingAt)
  return Number.isNaN(at) ? Infinity : now - at
}
```
