# Code story — worfy-pr-review 07: черновик ревью в main

Kind: pr · Epic: worfy-pr-review · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

Черновика ревью чужого PR не было: worfy хранил только черновики ответов в нитях (`state/pr-inbox/drafts/`). Review
mode (Ticket 09), Agent review (Ticket 08) и Submit (Ticket 11) нужен один файл на PR в формате, который принимает
`review-draft-lint`, с каналами, которые Linked machine не вызывает.

- Требование: [Что происходит](../issues/07-черновик-ревью-в-main.md#что-происходит)

## 2. Правка человека делает комментарий его, и текст строк ровно по диапазону

Code: `src/main/github/pr-review-draft.ts:82-98` · key lines: 86, 87, 88, 93

```ts
export function putComment(draft: ReviewDraft, input: { ref?: ReviewCommentRef | undefined; comment: ReviewComment; anchor: string }): ReviewDraft {
  const next = editable(draft)
  const size = sizeOf(input.comment)
  const lines = linesOf(input.anchor, size)
  if (lines.length !== size) throw new ReviewDraftRefusal(`The text of the commented lines has ${lines.length} lines, the comment covers ${size} lines`)
  const text = lines.length === input.anchor.split(LINE_END).length ? input.anchor : input.anchor.replace(/\r?\n$/u, '')
  const anchor = { text, by: 'person' as const }
  if (input.ref === undefined) {
    next.payload.comments.push(input.comment)
    next.anchors.push(anchor)
  } else {
    const index = locate(next, input.ref)
    next.payload.comments[index] = input.comment
    next.anchors[index] = anchor
  }
  return next
}
```

- Что делает: новый комментарий добавляется в конец, правка заменяет найденный комментарий; в обоих случаях
  `anchors[i]` получает текст строк и `by: 'person'`. `locate` ищет комментарий того же файла с тем же текстом,
  ближайший к старому месту, и отказывает, если его нет. Текст строк должен иметь столько строк, сколько покрывает
  комментарий (`start_line..line`); один перевод строки в конце, лишний для этого счёта, отрезается.
- Почему здесь: Ticket называет `src/main/github/pr-review-draft.ts` среди своих файлов; правило «правка человеком
  ставит `by: 'person'`» записано в Ticket-е и spec-е. Проверка числа строк — находка 3 раунда ревью 1 (раздел «Итог»
  Ticket-а).
- Без него: `bin/pr-review-draft` (Ticket 08) меняет только записи `by: 'agent'` и переписал бы правку человека. Без
  проверки строк диапазон 10–12 с текстом одной строки после поиска заново становился `start_line` = `line`, и файл
  черновика переставал разбираться.
- Требование: [Что делаем, п. 1](../issues/07-черновик-ревью-в-main.md#что-делаем)
- Риски и пробелы test-ов: два комментария одного файла с одинаковым текстом различаются только местом; это
  проверено только тем, что берётся ближайший к `index`. Текст из двух строк, где вторая пустая, для комментария на
  одну строку неотличим от одной строки с переводом строки в конце: он берётся как одна строка.

## 3. Поиск строки заново после нового head-а

Code: `src/main/github/pr-review-draft.ts:146-173` · key lines: 155, 156, 159, 161, 168

```ts
export function reanchor(draft: ReviewDraft, head: string, read: (path: string) => string | null): ReviewDraft {
  const next = structuredClone(draft)
  const texts = new Map<string, string[] | null>()
  next.payload.comments.forEach((comment, index) => {
    const anchor = next.anchors[index]
    if (anchor === undefined || comment.side !== 'RIGHT' || (comment.start_side ?? 'RIGHT') !== 'RIGHT') return
    if (!texts.has(comment.path)) texts.set(comment.path, read(comment.path)?.split(/\r?\n/u) ?? null)
    const file = texts.get(comment.path) ?? null
    // The range keeps its size: a text written by another writer (bin/pr-review-draft) may have more or fewer lines.
    const size = sizeOf(comment)
    const lines = linesOf(anchor.text, size)
    const old = comment.start_line ?? comment.line
    // A line end at the very end of the file starts no line of its own.
    const length = file === null ? 0 : file.at(-1) === '' ? file.length - 1 : file.length
    // A place where the whole range would not fit — past the end of the file — is no place.
    const places = file === null || anchor.text.trim() === '' ? [] : placesOf(file, lines).filter((place) => place + size - 1 <= length)
    if (places.length === 0) {
      next.anchors[index] = { ...anchor, moved: true }
      return
    }
    const start = places.reduce((best, place) => (Math.abs(place - old) < Math.abs(best - old) ? place : best))
    if (comment.start_line !== undefined) comment.start_line = start
    comment.line = start + size - 1
    next.anchors[index] = { text: anchor.text, by: anchor.by }
  })
  next.anchoredOn = head
  return next
}
```

- Что делает: для комментария стороны `RIGHT` ищет в файле нового head-а строки `anchors[i].text` подряд (хвостовые
  пробелы не в счёт), берёт место, ближайшее к старому, и двигает диапазон целиком, сохраняя его размер из самого
  комментария, а не из текста. Место, где диапазон вышел бы за конец файла, не считается. Не нашлось — комментарий
  стоит на старой строке с `moved: true` («line moved»).
  `startedOn` не меняется, новый head пишется в `anchoredOn`.
- Почему здесь: Ticket и spec (раздел «Решения по test-ам», Seam 1) требуют поиск строки заново в main; поля
  `anchoredOn` и `moved` — решение без владельца, записано в «Итог» Ticket-а. Размер из комментария — находка 3 раунда
  ревью 1: текст пишет и `bin/pr-review-draft`, который `putComment` не проверяет. Конец файла — находка раунда ревью
  2: строка за концом файла дала бы ошибку GitHub 422 при Submit.
- Без него: после нового push комментарий указывал бы на чужую строку, и Submit отправил бы его не туда.
- Требование: [Что делаем, п. 3](../issues/07-черновик-ревью-в-main.md#что-делаем)
- Риски и пробелы test-ов: сторона `LEFT` не двигается; переименованный файл считается пропавшим (все его
  комментарии `moved`). Канала для re-anchor нет — его вызовет Ticket 09.

## 4. Не чаще раза в 500 ms, ответ видит всё сразу, и сбой записи не даёт сохранить дважды

Code: `src/main/github/pr-review-draft.ts:366-387` · key lines: 370, 375, 380, 383

```ts
  private async change(root: string, repo: string, pr: number, change: Change): Promise<PrReviewDraftAnswer> {
    const file = await this.file(root, repo, pr)
    return this.exclusive(file, async () => {
      // Refused now, with the reason, when it does not apply to what the view sees.
      const draft = change((await this.answer(file, repo, pr)).draft)
      const pending = this.pending.get(file) ?? { changes: [], timer: null, repo, pr }
      pending.changes.push(change)
      this.pending.set(file, pending)
      const wait = (this.lastWrite.get(file) ?? -Infinity) + WRITE_INTERVAL_MS - this.now()
      if (wait <= 0) {
        try {
          await this.write(file)
        } catch (error) {
          // The change is taken and waits: the view shows it, told it is not on disk yet, so it is not saved twice.
          return { repo, pr, draft, problem: `The review draft is not written yet: ${messageOf(error)}. worfy writes it with the next change, and when it quits` }
        }
      } else if (pending.timer === null) {
        pending.timer = setTimeout(() => void this.exclusive(file, async () => this.write(file)).catch((error: unknown) => this.warn(`[pr-review] ${file} was not written: ${messageOf(error)}`)), wait)
        pending.timer.unref?.()
      }
      return { repo, pr, draft, problem: null }
    })
```

- Что делает: изменение сначала проверяется на том, что видит view (файл плюс очередь), — отказ сразу с причиной.
  Потом оно встаёт в очередь файла: если с прошлой записи прошло 500 ms, запись идёт сейчас, иначе ставится один
  таймер на остаток интервала. Ответ канала уже содержит изменение. Если запись сейчас не удалась, изменение остаётся
  в очереди, а ответ — успех с черновиком и `problem` «not written yet».
- Почему здесь: правило «не чаще раза в 500 ms» записано в Ticket-е и spec-е (раздел 6). Один исход сбоя — находка 1
  раунда ревью 1; «изменение ждёт следующей записи» уже было записано в «Итог» Ticket-а, поэтому выбран успех с
  отметкой, а не отказ.
- Без него: набор текста в поле комментария писал бы файл на каждую правку. Отказ при изменении, которое всё равно
  в очереди, давал view повод сохранить комментарий ещё раз — и он попадал в файл дважды.
- Требование: [Что делаем, п. 2](../issues/07-черновик-ревью-в-main.md#что-делаем)
- Риски и пробелы test-ов: изменения в очереди теряются, если процесс убит до записи; при обычном выходе их пишет
  `flushSync` на `will-quit` (test вызывает его напрямую, не через Electron). После сбоя повтора по таймеру нет:
  запись идёт со следующим изменением или при выходе. Как view показывает `problem` рядом с черновиком — Ticket 09.

## 5. Запись через временный файл и rename поверх того, что в файле сейчас

Code: `src/main/github/pr-review-draft.ts:413-431` · key lines: 416, 420, 425

```ts
    const tmp = `${file}.${randomUUID()}.tmp`
    let written = false
    try {
      const draft = applied(await this.read(file), pending.changes, file, pending.repo, pending.pr, this.warn)
      if (draft !== null) {
        await mkdir(dirname(file), { recursive: true })
        await (this.options.writeFile ?? ((path, text) => writeFile(path, text)))(tmp, serialize(draft))
        await rename(tmp, file)
        written = true
      }
      // Right after the rename, with no await between: a quit (flushSync) while the temporary file is removed must not
      // find the written changes still waiting. Inside exclusive(): no change came meanwhile, so what waited is what was written.
      this.drop(file)
    } finally {
      await (this.options.removeTemp ?? ((path) => rm(path, { force: true })))(tmp)
    }
    if (!written) return
    this.lastWrite.set(file, this.now())
    this.options.wrote?.(file)
```

- Что делает: читает файл заново и применяет к нему очередь, так что запись другого писателя (Agent review) и поля,
  которых эта версия не знает, остаются; пишет во временный файл рядом и переименовывает его на место. Очередь
  снимается сразу после rename, без `await` между ними: сбой чтения, разбора или записи оставляет файл прежним,
  временный файл удаляется, а очередь ждёт следующей записи.
- Почему здесь: Ticket требует запись через временный файл и rename; так же пишет `src/main/github/pr-reply-send.ts`.
  Снятие очереди после успеха — находка 1 раунда ревью 1; снятие до удаления временного файла — находка раунда
  ревью 2.
- Без него: обрыв на середине записи оставил бы полузаписанный JSON, и черновик не читался бы; файл, на миг
  испорченный другим писателем, стирал бы очередь, хотя view уже получил успех. Выход worfy (`flushSync`) пока
  удаляется временный файл применил бы записанное изменение второй раз, и Submit отправил бы комментарий дважды.
- Требование: [Готово, когда](../issues/07-черновик-ревью-в-main.md#готово-когда)
- Риски и пробелы test-ов: гонка с `bin/pr-review-draft` между чтением и rename здесь не проверена — это Ticket 08
  (возражение 3 critic-а).

## 6. Discard убирает и файл, который не разбирается

Code: `src/main/github/pr-review-draft.ts:282-296` · key lines: 288, 292, 294

```ts
  async discard(root: string, repo: string, pr: number): Promise<PrReviewDraftAnswer> {
    const file = await this.file(root, repo, pr)
    return this.exclusive(file, async () => {
      const text = await this.read(file)
      let draft: ReviewDraft | null = null
      try {
        draft = text === null ? null : parseAny(text, file)
      } catch {
        // Not a draft: removed below.
      }
      if (draft !== null && ownDraft(draft, file, repo, pr).state === 'submitting') throw new ReviewDraftRefusal('This review is being submitted: it is not discarded')
      this.drop(file)
      await rm(file, { force: true })
      return { repo, pr, draft: null, problem: null }
    })
```

- Что делает: читает файл; если это не черновик (не JSON, другая форма) — удаляет его без разбора. Черновик
  разбирается — тогда отказ, если он `submitting` или принадлежит другому PR. Очередь файла снимается.
- Почему здесь: Ticket: «Discard удаляет файл». Удаление неразбираемого файла — находка 2 раунда ревью 1.
- Без него: файл, обрезанный или записанный в другой форме, нельзя было ни изменить, ни удалить (Save, Viewed и
  Discard отказывали, `prune` его пропускает) — черновик PR застревал навсегда.
- Требование: [Что делаем, п. 4](../issues/07-черновик-ревью-в-main.md#что-делаем)
- Риски и пробелы test-ов: черновик другого PR по тому же пути возможен только при совпадении имён файлов схемы
  `<owner>-<name>-<N>.json`; схема записана в spec-е и не менялась.

## 7. Что сознательно не меняли

- Удаление отправленных черновиков старше 30 дней идёт при первом `prReview.drafts` Project-а после запуска, а не в
  `src/main/index.ts`: папку Profile-а даёт `bin/profile`, и запускать его для каждого Project-а при старте — лишняя
  цена.
- Схема имени файла `<owner>-<name>-<N>.json` — из spec-а, не менялась.
- Страницы `docs/features/` не правились: UI черновика ещё нет (Ticket-ы 09–11).

## 8. Как проверено

`node scripts/vitest-electron.mjs test/unit/pr-review-draft-format.test.ts test/contract/pr-review-draft.test.ts` —
exit 0 (20 unit, 18 contract). Unit гоняет `harness/bin/review-draft-lint` на `payload` черновика с `lint.json`
шаблона: чисто; поле, которого GitHub не знает, внутри `payload` в тело запроса не попадает. Contract — сбой записи на
половине файла (успех с «not written yet», комментарий записан один раз), файл, испорченный между изменением и
записью, пачка из пяти правок (не больше двух записей, между ними не меньше 500 ms), Discard (в том числе
неразбираемого файла), 30 дней, отказ Linked machine на каждом из шести каналов при доступе `all` и `read`.

## Проверить себя

1. Почему изменение в очереди применяется к файлу, прочитанному в момент записи, а не к копии в памяти?
   Ответ: чтобы не затереть то, что за это время записал другой писатель (Session Agent review через
   `bin/pr-review-draft`), и поля, которых эта версия не знает.
   Строки: `src/main/github/pr-review-draft.ts:416-420`
2. Почему после неудачной записи канал отвечает успехом, а не отказом?
   Ответ: изменение остаётся в очереди и будет записано; отказ заставил бы view сохранить его ещё раз, и новый
   комментарий попал бы в файл дважды. Ответ несёт `problem` «not written yet».
   Строки: `src/main/github/pr-review-draft.ts:375-381`
3. Почему после поиска строк заново `line` считается от размера диапазона комментария, а не от числа строк текста?
   Ответ: текст может написать другой писатель с другим числом строк; диапазон из текста мог дать `start_line` =
   `line`, и файл переставал разбираться.
   Строки: `src/main/github/pr-review-draft.ts:155-168`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-pr-review 07 (local store of PR review drafts in main), head 8f642554ac3817f945789583049c76de981504d1
>
> Gate (depth medium, three rounds): verifier (lens: implementer's report) VERIFIED on round 1; reviewer (lens: correctness) round 1 three med + round 2 one med — all fixed test-first; round 3 delta read by the Orchestrator.
>
> - Verifier (9827d707c): every claim backed — draft schema .loose() with anchoredOn/submittedAt/moved; reviewPayloadOf body runs clean through review-draft-lint; person edits; RIGHT-side re-anchor to the nearest match; atomic tmp+rename; 500 ms coalescing; re-read before write; Discard refuses a submitting draft; 30-day prune; all six channels local on a Linked machine; ADR-0005 Amendment. 12 mutants red.
> - Round 1 fixes (5933c028f): a failed write keeps the change queued and answers success with problem «not written yet» (re-Save no longer duplicates); write() drops the queue only after a successful rename, read/parse inside try; Discard removes an unparsable file but never a valid draft of another PR; putComment refuses an anchor whose line count differs from the range; reanchor keeps the comment's range size; payload test carries an unknown key. Round-2 reviewer re-ran every scenario: closed.
> - Round 2 fix (code 7fe051346): drop() right after rename, before the tmp cleanup — a quit (flushSync) in that window no longer writes a comment twice (contract test red before ['A.','B.','B.'], green after); reanchor skips places where the range would run past the end of the file (unit test red/green).
> - Tests: pr-review-draft-format + pr-review-draft 38 passed, EXIT=0; lint, typecheck, story-check, evidence-check EXIT=0. Local gate fast red only on file-watcher contract tests (fseventsd at 112 % CPU on this Mac; untouched files). ci-ok pass on the head.
>
> Decided without the owner (to confirm): extra fields anchoredOn/moved/submittedAt; payload.event absent until Finish; 30-day cleanup of submitted drafts at the first drafts call per Profile, not at startup (spec said at startup); re-anchor RIGHT side only; no IPC channel for re-anchor (ticket 09 calls it); a failed write answers success + problem instead of a refusal.
>
> Consider [low]: draft file name owner-name-N.json collides for a-b/c#1 and a/b-c#1 (spec-defined; same in pr-reply-send.ts:50); prune() skips an unparsable file (Discard removes it now).
