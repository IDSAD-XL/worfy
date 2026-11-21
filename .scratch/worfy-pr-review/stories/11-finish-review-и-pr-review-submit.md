# Code story — worfy-pr-review 11: Finish review и `pr-review-submit.ts`: диалог с каждым комментарием ровно, lint, проверка head, один POST ревью по Submit человека, новый ADR

Kind: pr · Epic: worfy-pr-review · Ticket: 11 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 10 черновик ревью лежал на машине, а кнопка Finish review была неактивна («Coming next»): отправить
ревью из worfy было нельзя. ADR-0105 разрешал main только две записи на GitHub — ответ в нити и комментарий в
разговоре PR. Владелец 2026-11-20 (Q2 (а)) решил: Submit из диалога, который показывает каждый комментарий ровно, и
один запрос; новый ADR (ADR-0112).

- Требование: [Что происходит](../issues/11-finish-review-и-pr-review-submit.md#что-происходит)

## 2. Сначала посмотреть на GitHub, если прошлый Submit мог дойти

Code: `src/main/github/pr-review-submit.ts:166-188` · key lines: 167, 170, 175, 181, 185

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
        // GitHub has none: the draft is a draft again, its texts free; this Submit goes on as a new one.
        const freed = await this.options.drafts.changeNow(root, repo, pr, (current) => {
          if (current === null || !submitPending(current)) throw new Refusal('The draft changed meanwhile. Look at it again')
          const next: ReviewDraft = { ...current, state: 'draft' }
          delete next.error
          delete next.submittingAt
          return next
        })
        if (freed.problem !== null) throw new Refusal(`Not submitted: ${freed.problem}`)
```

- Что делает: если прошлый Submit не подтвердился (`submitting` после обрыва или ошибка «GitHub did not confirm»), до
  всех прочих проверок ищет это ревью на GitHub; нашёл — только отмечает `submitted`, POST не делает. Не нашёл —
  черновик снова обычный (без ошибки и без `submittingAt`), и Submit идёт дальше как новый.
- Почему здесь: Ticket, «Что делаем», п. 3; образец — Send ответа (`src/main/github/pr-reply-send.ts`). Поиск первым —
  находка ревью раунда 1: ушедшее ревью находится и тогда, когда head сдвинулся или lint стал строже.
- Без него: ответ, потерянный после успешного POST, дал бы второе ревью при повторном щелчке.
- Требование: [Что делаем, п. 3 и 4](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: ошибка чтения ревью — отказ с причиной, черновик остаётся запертым.

## 3. Какое ревью считается тем самым

Code: `src/main/github/pr-review-submit.ts:292-307` · key lines: 293, 298, 300, 302, 304

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

Code: `src/main/github/pr-review-submit.ts:386-391` · key lines: 386, 389, 390

```ts
  if (submitPending(draft)) {
    // The texts of the Submit GitHub did not confirm, and no others: they may be on GitHub already.
    const was = draft.payload
    const same = was.event === input.event && was.body === input.body && was.comments.length === input.comments.length && was.comments.every((comment, at) => sameComment(comment, input.comments[at]!))
    if (!same) throw new Refusal(`Not submitted: ${UNCONFIRMED} for other texts. Submit those, and worfy first looks whether they are on GitHub`)
    return texts
```

- Что делает: пока Submit не подтверждён, main принимает только ушедшие событие, Summary и комментарии; диалог
  открывается на них же без правки (`submitPending` в `src/shared/ipc/pr-review.ts`), Review mode их не правит.
- Почему здесь: искать на GitHub имеет смысл только то, что ушло; другие тексты — другое ревью.
- Без него: человек сменил бы Comment на Approve, поиск не нашёл бы ушедшее ревью, и ушло бы второе.
- Требование: [Что делаем, п. 3](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: убрать неподтверждённое можно только Submit-ом тех же текстов; Discard заперт.

## 5. Проверки до записи: свой PR, сдвинутый head, строки вне diff-а

Code: `src/main/github/pr-review-submit.ts:190-205` · key lines: 191, 202, 203, 205

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

Code: `src/main/github/pr-review-submit.ts:245-257` · key lines: 247, 248, 252, 253, 254

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

## 7. Enter не отправляет

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

## 8. PR inbox перечитывает PR сразу после отправки

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

## 9. Что сознательно не меняли

- Pending review на GitHub main не создаёт и не продолжает; resolve, re-request review, dismiss, merge — нет
  (ADR-0112, п. 8).
- Полоса сдвинутого head не называет комментарии, которые GitHub покажет как outdated (поток C.3 spec-а) — не сделано.

## 10. Как проверено

- `pnpm test test/contract/pr-review-submit.test.ts` — exit 0 (24 test-а на gh stand-in; красный до модуля, до
  `refresh` и до правок раунда 2: 5 failed).
- `pnpm test test/unit/finish-review-dialog.test.tsx` — exit 0; `pnpm test test/unit/review-comments.test.tsx` — exit 0
  (запертый неподтверждённый черновик: 2 failed до правки).
- `pnpm test test/contract/harness-review-draft-lint.test.ts` — exit 0 (красный на старом скрипте: 2 failed; на
  `--untiered`: 1 failed).
- `pnpm test:e2e test/e2e/pr-review.spec.ts test/e2e/pr-inbox.spec.ts` — exit 0, 18 passed.
- Mutation testing: 15 mutant-ов раунда 1 и 13 раунда 2, все убиты.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Проверить себя

1. Почему Submit отказывает целиком, если один комментарий не на изменённой строке, а не отправляет остальные?
   Строки: `src/main/github/pr-review-submit.ts:204-205`
   Ответ: GitHub отвергает весь review с таким комментарием, а молча выкинутый комментарий меняет смысл ревью;
   человек убирает или переносит его сам.
2. Что делает второй щелчок Submit после ответа 502 и почему он не создаёт второе ревью?
   Строки: `src/main/github/pr-review-submit.ts:167-178`
   Ответ: до всех прочих проверок main читает ревью PR и ищет ревью этого аккаунта с ушедшими текстами, данное после
   отметки; нашёл — только отмечает `submitted`, POST не делает.
3. Почему после 502 человек не может сменить Comment на Approve и отправить снова?
   Строки: `src/main/github/pr-review-submit.ts:386-390`
   Ответ: искать на GitHub можно только то, что ушло; другие тексты не нашлись бы, и ушло бы второе ревью.
4. На каком commit-е стоят комментарии, если человек перенёс черновик на новый head?
   Строки: `src/main/github/pr-review-submit.ts:68-68`
   Ответ: `draftCommitOf` — `anchoredOn`, если он есть, иначе `startedOn`: строки комментариев — строки того commit-а.
