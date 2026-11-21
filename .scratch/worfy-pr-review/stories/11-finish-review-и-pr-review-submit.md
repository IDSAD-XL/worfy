# Code story — worfy-pr-review 11: Finish review и `pr-review-submit.ts`: диалог с каждым комментарием ровно, lint, проверка head, один POST ревью по Submit человека, новый ADR

Kind: pr · Epic: worfy-pr-review · Ticket: 11 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 10 черновик ревью лежал на машине, а кнопка Finish review была неактивна («Coming next»): отправить
ревью из worfy было нельзя. ADR-0105 разрешал main только две записи на GitHub — ответ в нити и комментарий в
разговоре PR. Владелец 2026-11-20 (Q2 (а)) решил: Submit из диалога, который показывает каждый комментарий ровно, и
один запрос; новый ADR (ADR-0112).

- Требование: [Что происходит](../issues/11-finish-review-и-pr-review-submit.md#что-происходит)

## 2. Проверки до записи: свой PR, сдвинутый head, строки вне diff-а

Code: `src/main/github/pr-review-submit.ts:163-175` · key lines: 164, 172, 173, 175

```ts
      // 4. GitHub as it is now: the head, the author, the lines of the diff on the commit.
      const commit = draftCommitOf(draft)
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

- Что делает: читает PR на GitHub (head, base, автор) как аккаунт Project-а; Approve и Request changes на своём PR —
  отказ; head не тот, с которым открылся диалог, — отказ с head-ом сейчас (диалог показывает «Your comments are on
  <a>; the head is <b>.»); комментарий не на изменённой строке commit-а черновика или диапазон через две hunk — отказ
  всего Submit-а. Ни одного запроса записи.
- Почему здесь: Ticket называет `src/main/github/pr-review-submit.ts` и порядок «lint → head → отметка → один POST»
  («Что делаем», п. 2). `commit = draftCommitOf(draft)` — `anchoredOn ?? startedOn` по брифу Orchestrator-а (ADR-0112,
  п. 5; Amendment в spec.md).
- Без него: GitHub отверг бы весь review с одним комментарием вне diff-а (422), а Approve на своём PR — тоже; на
  сдвинутом head человек отправил бы, не увидев новых commit-ов.
- Требование: [Что делаем, п. 2 и 6](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: прототип отправлял остальные комментарии и помечал такие «Not posted» — здесь отказ всего
  Submit-а (решено без владельца, в «Итог»).

## 3. Сначала посмотреть на GitHub, потом отметка и один POST

Code: `src/main/github/pr-review-submit.ts:176-196` · key lines: 177, 180, 188, 192, 196

```ts
      // 5. A Submit GitHub did not confirm may have landed: look first.
      if (draft.state === 'submitting' || unconfirmed(draft.error)) {
        let found: { url: string | null } | null
        try {
          found = await this.posted(get, repo, pr, account, commit, texts)
        } catch (error) {
          this.health.failed(root, messageOf(error))
          throw new Refusal(`Not submitted: ${UNCONFIRMED} before, and worfy could not look whether it is on GitHub now: ${firstLine(messageOf(error))}`)
        }
        if (found !== null) {
          const marked = await this.markSubmitted(root, repo, pr, found.url)
          this.health.answered(root)
          return answer('already-submitted', marked, { reviewUrl: found.url })
        }
      }
      // 6. The mark, the file read again, one POST.
      const marking = await this.options.drafts.changeNow(root, repo, pr, (current) => markSubmitting(current, texts, commit))
      const marked = (await this.options.drafts.draft(root, repo, pr)).draft
      if (marking.problem !== null || marked === null || marked.state !== 'submitting')
        throw new Refusal(`Not submitted: the draft could not be marked before the POST${marking.problem === null ? '' : `: ${marking.problem}`}`)
      return await this.post(root, repo, pr, env, marked, answer)
```

- Что делает: если прошлый Submit не подтвердился (`submitting` после обрыва или ошибка «GitHub did not confirm»),
  сначала ищет на GitHub ревью этого аккаунта на том же commit-е с тем же body и state; нашёл — только отмечает
  `submitted`. Иначе ставит `submitting` в файл без отложенной записи (`changeNow`) и делает POST.
- Почему здесь: Ticket, «Что делаем», п. 3; образец — Send ответа (`src/main/github/pr-reply-send.ts`). Почему
  `changeNow` — запись `submitting` должна лечь на диск до POST; в Ticket-е `pr-review-draft.ts` — «только читать»,
  отступление записано в «Итог».
- Без него: ответ, потерянный после успешного POST, дал бы второй review при повторном щелчке.
- Требование: [Что делаем, п. 3 и 4](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: сверка по state строже spec-а (решено без владельца); ревью, отправленное с github.com
  руками с тем же текстом, тоже засчиталось бы как найденное.

## 4. Один POST и что значит его ошибка

Code: `src/main/github/pr-review-submit.ts:205-228` · key lines: 206, 213, 216, 217, 221

```ts
    const payload = reviewPayloadOf(marked)
    const body = JSON.stringify({ commit_id: draftCommitOf(marked), event: payload.event, body: payload.body, comments: payload.comments })
    const folder = await mkdtemp(join(tmpdir(), 'worfy-review-'))
    try {
      const file = join(folder, 'review.json')
      await writeFile(file, body)
      let printed: string
      try {
        printed = await this.options.run(['api', '--method', 'POST', `repos/${repo}/pulls/${pr}/reviews`, '--input', file], root, env, 'all')
      } catch (error) {
        this.health.failed(root, messageOf(error))
        const refused = refusedByGithub(error)
        const reason = refused !== null ? `GitHub refused the review: ${refused}` : `${UNCONFIRMED}: ${firstLine(messageOf(error))}. Submit again: worfy first looks whether it is on GitHub already`
        await this.options.drafts
          .changeNow(root, repo, pr, (current) => {
            if (current === null || current.state !== 'submitting') throw new Error('not submitting')
            return { ...current, state: 'draft', error: reason }
          })
          .catch(() => undefined)
        return answer('failed', reason)
      }
      this.health.answered(root)
      const url = urlOf(printed)
      return answer('submitted', await this.markSubmitted(root, repo, pr, url), { reviewUrl: url })
```

- Что делает: тело — `{commit_id, event, body, comments}` из отмеченного черновика, через файл `--input`; 4xx (кроме
  408) — «GitHub refused the review: <сообщение>», 5xx, обрыв, timeout — «GitHub did not confirm the review»; в обоих
  случаях черновик снова `draft` с причиной, автоматического повтора нет.
- Почему здесь: Ticket, «Что делаем», п. 2 и 3; тело «ровно как `payload`» — п. 2.
- Без него: повтор после 5xx без проверки дал бы два ревью; 4xx как «не подтверждено» заставлял бы искать ревью,
  которого нет.
- Требование: [Что делаем, п. 2 и 3](../issues/11-finish-review-и-pr-review-submit.md#что-делаем)
- Риски и пробелы test-ов: ответ GitHub при висящем pending review с github.com не проверен на настоящем GitHub (п. 8,
  sandbox).

## 5. Enter не отправляет

Code: `src/renderer/pr-review/FinishReviewDialog.tsx:272-285` · key lines: 276, 278, 281

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

## 6. PR inbox перечитывает PR сразу после отправки

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

## 7. Что сознательно не меняли

- Pending review на GitHub main не создаёт и не продолжает; resolve, re-request review, dismiss, merge — нет
  (ADR-0112, п. 8).
- Полоса сдвинутого head не называет комментарии, которые GitHub покажет как outdated (поток C.3 spec-а) — не сделано.

## 8. Как проверено

- `pnpm test test/contract/pr-review-submit.test.ts` — exit 0 (19 test-ов на gh stand-in, красный до модуля и до
  `refresh`).
- `pnpm test test/unit/finish-review-dialog.test.tsx` — exit 0; `pnpm test test/unit/review-comments.test.tsx` — exit 0.
- `pnpm test test/contract/harness-review-draft-lint.test.ts` — exit 0 (красный на старом скрипте: 2 failed).
- `pnpm test:e2e test/e2e/pr-review.spec.ts test/e2e/pr-inbox.spec.ts` — exit 0, 18 passed.
- Mutation testing `pr-review-submit.ts`: 15 mutant-ов, все убиты.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Проверить себя

1. Почему Submit отказывает целиком, если один комментарий не на изменённой строке, а не отправляет остальные?
   Строки: `src/main/github/pr-review-submit.ts:174-175`
   Ответ: GitHub отвергает весь review с таким комментарием, а молча выкинутый комментарий меняет смысл ревью;
   человек убирает или переносит его сам.
2. Что делает второй щелчок Submit после ответа 502 и почему он не создаёт второе ревью?
   Строки: `src/main/github/pr-review-submit.ts:177-189`
   Ответ: ошибка «did not confirm» включает поиск: main сначала читает ревью PR и ищет ревью этого аккаунта на том же
   commit-е с тем же body и state; нашёл — только отмечает `submitted`, POST не делает.
3. На каком commit-е стоят комментарии, если человек перенёс черновик на новый head?
   Строки: `src/main/github/pr-review-submit.ts:206-206`
   Ответ: `draftCommitOf` — `anchoredOn`, если он есть, иначе `startedOn`: строки комментариев — строки того commit-а.
