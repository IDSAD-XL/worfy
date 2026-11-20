# Code story — worfy-pr-review 07: черновик ревью в main

Kind: pr · Epic: worfy-pr-review · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

Черновика ревью чужого PR не было: worfy хранил только черновики ответов в нитях (`state/pr-inbox/drafts/`). Review
mode (Ticket 09), Agent review (Ticket 08) и Submit (Ticket 11) нужен один файл на PR в формате, который принимает
`review-draft-lint`, с каналами, которые Linked machine не вызывает.

- Требование: [Что происходит](../issues/07-черновик-ревью-в-main.md#что-происходит)

## 2. Правка человека делает комментарий его

Code: `src/main/github/pr-review-draft.ts:71-83` · key lines: 73, 78, 80

```ts
export function putComment(draft: ReviewDraft, input: { ref?: ReviewCommentRef | undefined; comment: ReviewComment; anchor: string }): ReviewDraft {
  const next = editable(draft)
  const anchor = { text: input.anchor, by: 'person' as const }
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
  ближайший к старому месту, и отказывает, если его нет.
- Почему здесь: Ticket называет `src/main/github/pr-review-draft.ts` среди своих файлов; правило «правка человеком
  ставит `by: 'person'`» записано в Ticket-е и spec-е.
- Без него: `bin/pr-review-draft` (Ticket 08) меняет только записи `by: 'agent'` и переписал бы правку человека.
- Требование: [Что делаем, п. 1](../issues/07-черновик-ревью-в-main.md#что-делаем)
- Риски и пробелы test-ов: два комментария одного файла с одинаковым текстом различаются только местом; это
  проверено только тем, что берётся ближайший к `index`.

## 3. Поиск строки заново после нового head-а

Code: `src/main/github/pr-review-draft.ts:131-153` · key lines: 141, 143, 147, 148

```ts
export function reanchor(draft: ReviewDraft, head: string, read: (path: string) => string | null): ReviewDraft {
  const next = structuredClone(draft)
  const texts = new Map<string, string[] | null>()
  next.payload.comments.forEach((comment, index) => {
    const anchor = next.anchors[index]
    if (anchor === undefined || comment.side !== 'RIGHT' || (comment.start_side ?? 'RIGHT') !== 'RIGHT') return
    if (!texts.has(comment.path)) texts.set(comment.path, read(comment.path)?.split(/\r?\n/u) ?? null)
    const file = texts.get(comment.path) ?? null
    const lines = anchor.text.split(/\r?\n/u)
    const old = comment.start_line ?? comment.line
    const places = file === null || anchor.text.trim() === '' ? [] : placesOf(file, lines)
    if (places.length === 0) {
      next.anchors[index] = { ...anchor, moved: true }
      return
    }
    const start = places.reduce((best, place) => (Math.abs(place - old) < Math.abs(best - old) ? place : best))
    if (comment.start_line !== undefined) comment.start_line = start
    comment.line = start + lines.length - 1
    next.anchors[index] = { text: anchor.text, by: anchor.by }
  })
  next.anchoredOn = head
  return next
}
```

- Что делает: для комментария стороны `RIGHT` ищет в файле нового head-а строки `anchors[i].text` подряд (хвостовые
  пробелы не в счёт), берёт место, ближайшее к старому, и двигает диапазон целиком. Не нашлось — комментарий стоит
  на старой строке с `moved: true` («line moved»). `startedOn` не меняется, новый head пишется в `anchoredOn`.
- Почему здесь: Ticket и spec (раздел «Решения по test-ам», Seam 1) требуют поиск строки заново в main; поля
  `anchoredOn` и `moved` — решение без владельца, записано в «Итог» Ticket-а.
- Без него: после нового push комментарий указывал бы на чужую строку, и Submit отправил бы его не туда.
- Требование: [Что делаем, п. 3](../issues/07-черновик-ревью-в-main.md#что-делаем)
- Риски и пробелы test-ов: сторона `LEFT` не двигается; переименованный файл считается пропавшим (все его
  комментарии `moved`). Канала для re-anchor нет — его вызовет Ticket 09.

## 4. Не чаще раза в 500 ms, и ответ видит всё сразу

Code: `src/main/github/pr-review-draft.ts:326-341` · key lines: 330, 335, 337

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
      if (wait <= 0) await this.write(file)
      else if (pending.timer === null) {
        pending.timer = setTimeout(() => void this.exclusive(file, async () => this.write(file)).catch((error: unknown) => this.warn(`[pr-review] ${file} was not written: ${messageOf(error)}`)), wait)
        pending.timer.unref?.()
      }
      return { repo, pr, draft, problem: null }
    })
```

- Что делает: изменение сначала проверяется на том, что видит view (файл плюс очередь), — отказ сразу с причиной.
  Потом оно встаёт в очередь файла: если с прошлой записи прошло 500 ms, запись идёт сейчас, иначе ставится один
  таймер на остаток интервала. Ответ канала уже содержит изменение.
- Почему здесь: правило «не чаще раза в 500 ms» записано в Ticket-е и spec-е (раздел 6).
- Без него: набор текста в поле комментария писал бы файл на каждую правку.
- Требование: [Что делаем, п. 2](../issues/07-черновик-ревью-в-main.md#что-делаем)
- Риски и пробелы test-ов: изменения в очереди теряются, если процесс убит до записи; при обычном выходе их пишет
  `flushSync` на `will-quit` (test вызывает его напрямую, не через Electron).

## 5. Запись через временный файл и rename поверх того, что в файле сейчас

Code: `src/main/github/pr-review-draft.ts:366-381` · key lines: 366, 371, 372, 375

```ts
    const draft = applied(await this.read(file), pending.changes, file, pending.repo, pending.pr, this.warn)
    if (draft === null) return
    const tmp = `${file}.${randomUUID()}.tmp`
    try {
      await mkdir(dirname(file), { recursive: true })
      await (this.options.writeFile ?? ((path, text) => writeFile(path, text)))(tmp, serialize(draft))
      await rename(tmp, file)
    } catch (error) {
      // Inside exclusive(): no change came meanwhile, so the waiting ones go back as they were.
      this.pending.set(file, { ...pending, timer: null })
      throw new ReviewDraftRefusal(`The review draft was not saved: ${messageOf(error)}`)
    } finally {
      await rm(tmp, { force: true })
    }
    this.lastWrite.set(file, this.now())
    this.options.wrote?.(file)
```

- Что делает: читает файл заново и применяет к нему очередь, так что запись другого писателя (Agent review) и поля,
  которых эта версия не знает, остаются; пишет во временный файл рядом и переименовывает его на место. Сбой записи
  оставляет файл прежним, временный файл удаляется, очередь возвращается и уйдёт со следующей записью.
- Почему здесь: Ticket требует запись через временный файл и rename; так же пишет `src/main/github/pr-reply-send.ts`.
- Без него: обрыв на середине записи оставил бы полузаписанный JSON, и черновик не читался бы.
- Требование: [Готово, когда](../issues/07-черновик-ревью-в-main.md#готово-когда)
- Риски и пробелы test-ов: гонка с `bin/pr-review-draft` между чтением и rename здесь не проверена — это Ticket 08
  (возражение 3 critic-а).

## 6. Что сознательно не меняли

- Удаление отправленных черновиков старше 30 дней идёт при первом `prReview.drafts` Project-а после запуска, а не в
  `src/main/index.ts`: папку Profile-а даёт `bin/profile`, и запускать его для каждого Project-а при старте — лишняя
  цена.
- Страницы `docs/features/` не правились: UI черновика ещё нет (Ticket-ы 09–11).

## 7. Как проверено

`node scripts/vitest-electron.mjs test/unit/pr-review-draft-format.test.ts test/contract/pr-review-draft.test.ts` —
exit 0. Unit гоняет `harness/bin/review-draft-lint` на `payload` черновика с `lint.json` шаблона: чисто. Contract —
сбой записи на половине файла, пачка из пяти правок (не больше двух записей, между ними не меньше 500 ms), Discard,
30 дней, отказ Linked machine на каждом из шести каналов при доступе `all` и `read`.

## Проверить себя

1. Почему изменение в очереди применяется к файлу, прочитанному в момент записи, а не к копии в памяти?
   Ответ: чтобы не затереть то, что за это время записал другой писатель (Session Agent review через
   `bin/pr-review-draft`), и поля, которых эта версия не знает.
   Строки: `src/main/github/pr-review-draft.ts:366-372`
2. Что происходит с комментарием, строки которого не нашлись на новом head-е?
   Ответ: он остаётся на старой строке, а `anchors[i].moved` становится `true` — отметка «line moved»; при
   следующем поиске, если строки нашлись, отметка снимается.
   Строки: `src/main/github/pr-review-draft.ts:141-148`
3. Что видит view сразу после второй правки за 500 ms, хотя файл ещё старый?
   Ответ: правку: ответ канала строится из файла с применённой очередью, а запись ждёт таймера.
   Строки: `src/main/github/pr-review-draft.ts:330-339`
