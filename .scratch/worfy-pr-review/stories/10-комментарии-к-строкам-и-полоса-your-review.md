# Code story — worfy-pr-review 10: Комментарии к строкам чужого PR: «+» в gutter, `c`, диапазон, Suggest change, Pending и «Written by the agent», полоса Your review, Discard

Kind: pr · Epic: worfy-pr-review · Ticket: 10 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 09 Review mode показывал diff, дерево, нити и Viewed, а комментарии черновика только рисовал: написать,
поправить или удалить комментарий к строке было нельзя, полоса не считала файлы, Discard и Finish review не было, строка
списка не говорила, что у PR есть черновик. Комментарий агента к строке вне diff-а PR GitHub отверг бы (422), и человек
его не видел.

- Требование: [Что происходит](../issues/10-комментарии-к-строкам-и-полоса-your-review.md#что-происходит)

## 2. Когда комментарий можно писать

Code: `src/renderer/pr-review/ReviewMode.tsx:191-196` · key lines: 194, 195

```tsx
  // ── the comments on lines (ticket 10) ──
  // They stand on their lines while the diff shown is All changes of the commit the draft is numbered on; new ones are
  // made only then, so each is numbered on that commit.
  const onLines = scope.kind === 'all' && !moved
  const canChange = local && subject !== null && draft !== null && draft.state === 'draft'
  const lineComments = useReviewComments({
```

- Что делает: «+», `c` и Move to line работают только при `canChange && onLines`: черновик на этой машине прочитан, не
  отправлен, и diff показывает All changes commit-а черновика (`draftCommitOf`). Edit и Delete — при `canChange`.
- Почему здесь: бриф велит рисовать и привязывать новые комментарии к `draftCommitOf`; Submit (Ticket 11) шлёт их с этим
  commit-ом. Что ничего не пишется, пока черновик не прочитан, — урок ревью Ticket-а 09.
- Без него: комментарий, написанный на строке нового head-а или в Since my review, ушёл бы с номером строки другого
  commit-а; при сбое чтения черновика `saveComment` создал бы новый черновик поверх.
- Требование: [Что делаем, п. 1](../issues/10-комментарии-к-строкам-и-полоса-your-review.md#что-делаем)
- Риски и пробелы test-ов: пока head ушёл вперёд, нового комментария не написать — это решение без владельца, записано в
  «Итог».

## 3. Сохранение: новый или правка с `ref`

Code: `src/renderer/pr-review/review-comments.tsx:317-333` · key lines: 323, 327, 329

```tsx
  const saveOpen = async () => {
    const open = popoverNow.current
    if (open === null || open.text.trim() === '' || !canChange) return
    const text = open.text.trim()
    const edited = editing
    let input: { ref?: ReviewCommentRef; comment: ReviewComment; anchor: string }
    if (edited !== null) input = { ref: refOf(edited), comment: { ...edited.comment, body: text }, anchor: draft?.anchors[edited.index]?.text ?? open.code }
    else {
      if (!canAdd) return
      const side = sideOf(open.side)
      input = { comment: { path: open.path, line: open.endLine, side, ...(open.endLine > open.startLine ? { start_line: open.startLine, start_side: side } : {}), body: text }, anchor: open.code }
    }
    if (!(await save(open, input))) return
    setEditing(null)
    if (popoverNow.current === open) putPopover(null)
    setPicked(null)
  }
```

- Что делает: ⌘↵ или Save. Новый комментарий — в именах запроса GitHub: `line` — последняя строка, `start_line` и
  `start_side` — у диапазона; `anchor` — текст строк. Правка — тот же комментарий с новым текстом и `ref` (место, файл,
  старый текст): main находит его, даже если агент сдвинул записи, и ставит `by: 'person'`. Ошибка main остаётся в
  popover-е, текст не теряется.
- Почему здесь: Ticket называет адресат `prReview.saveComment` и правило «правка человеком делает комментарий его»;
  формат `ref` задан каналом Ticket-а 07 (`src/shared/ipc/pr-review.ts`).
- Без него: правка комментария агента осталась бы «Written by the agent», а при записи агента в тот же момент main
  поправил бы чужой комментарий.
- Требование: [Что делаем, п. 1–2](../issues/10-комментарии-к-строкам-и-полоса-your-review.md#что-делаем)
- Риски и пробелы test-ов: popover взят у Changes (`LineComment.tsx`) с выключенными картинками; правку комментария,
  который агент как раз удалил, проверяет только отказ main (contract Ticket-а 07).

## 4. «Not on a changed line»

Code: `src/renderer/pr-review/review-comments.tsx:176-185` · key lines: 178, 181, 183

```tsx
  /** Whether the comment is on lines the diff of the PR lacks; a file not read yet is not known to be. */
  const isOff = (comment: ReviewComment): boolean => {
    if (!entries.some((entry) => entry.file.path === comment.path)) return filesRead
    const file = known?.get(comment.path)
    if (file === undefined) return false
    if (file === 'none') return true
    const has = (side: ReviewComment['side'], at: number): boolean => file[lineSideOf(side)].has(at)
    return !has(comment.side, comment.line) || (comment.start_line !== undefined && !has(comment.start_side ?? comment.side, comment.start_line))
  }
  const offLines = onLines ? comments.filter(({ comment }) => isOff(comment)) : []
```

- Что делает: комментарий к файлу не из PR (когда список файлов прочитан без ошибки), к файлу без hunk-ов или к строке,
  которой нет в hunk-ах своей стороны, встаёт в список над diff-ом с Move to line и Delete. Строки файлов с
  комментариями читает `changes.file` (main держит ответ по head в памяти).
- Почему здесь: spec, «Решения по реализации», 7: такой комментарий в POST не идёт, пока человек его не перенесёт или не
  удалит.
- Без него: комментарий агента к неверной строке был бы невидим (под строкой, которой нет), а Submit получил бы 422.
- Требование: [Что делаем, п. 3](../issues/10-комментарии-к-строкам-и-полоса-your-review.md#что-делаем)
- Риски и пробелы test-ов: пока файл не прочитан, комментарий считается «на строке»; файл, свёрнутый как Large diff,
  своих комментариев под строками не покажет, пока его не развернуть.

## 5. Finish review неактивна, но с причиной

Code: `src/renderer/pr-review/ReviewBar.tsx:32-38` · key lines: 34

```tsx
function FinishButton({ why }: { why: string }) {
  return (
    <button type="button" className="w-pr-inbox-button w-pr-inbox-button--primary" data-testid="pr-review-finish" aria-disabled="true" title={why} onClick={(event) => event.preventDefault()}>
      Finish review
    </button>
  )
}
```

- Что делает: кнопка стоит в обеих полосах: «Coming next» у человека, «Waits until the agent finishes or you stop it»,
  пока Session пишет. `aria-disabled`, а не `disabled`, чтобы tooltip был виден.
- Почему здесь: Ticket, п. 4 — до Ticket-а 11 неактивна с tooltip «Coming next» и неактивна, пока Session пишет.
- Без него: полоса не показывала бы, куда ведёт ревью, а Ticket 11 менял бы раскладку полосы.
- Требование: [Что делаем, п. 4](../issues/10-комментарии-к-строкам-и-полоса-your-review.md#что-делаем)
- Риски и пробелы test-ов: Discard в той же полосе спрашивает «Discard N pending comments?» в Dialog kit-а; ⌘⇧↵ пока
  ничего не делает.

## 6. Chip `Review draft`

Code: `src/renderer/pr-inbox/PrInboxView.tsx:314-315` · key lines: 315

```tsx
/** A draft the chip `Review draft` stands for: one with comments, not submitted yet. */
const draftShown = (draft: PrReviewDraftRow | undefined): draft is PrReviewDraftRow => draft !== undefined && draft.state !== 'submitted' && draft.comments > 0
```

- Что делает: строка inbox и результатов поиска с таким черновиком получает chip с tooltip «3 pending comments, started
  on 3f2a9c1». Список черновиков — `useReviewDrafts` (`prReview.drafts`), заново после каждой правки окна и по
  `prReview.changed`.
- Почему здесь: Ticket называет `PrInboxView.tsx` для chip-а; порог «есть комментарии» — решение без владельца
  («Итог»): черновик создаётся уже на Start review.
- Без него: после перезапуска worfy не видно, у какого PR лежит начатое ревью.
- Требование: [Что делаем, п. 5](../issues/10-комментарии-к-строкам-и-полоса-your-review.md#что-делаем)
- Риски и пробелы test-ов: черновик, который пишет Agent review в окне без Review mode, обновит chip только по
  `prReview.changed`.

## 7. Как проверено

- `node scripts/vitest-electron.mjs test/unit/review-comments.test.tsx` — до правки exit 1 (13 из 15 красные), после —
  exit 0.
- `pnpm test:e2e test/e2e/pr-review.spec.ts test/e2e/changes.spec.ts test/e2e/pr-inbox.spec.ts test/e2e/pr-search.spec.ts`
  — exit 0, 18 passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Проверить себя

1. Почему у комментария, сохранённого при сдвинутом head-е, нет «+»?
   Ответ: `canAdd` требует `onLines`, а он ложен, когда head ушёл от commit-а черновика: номер строки был бы не того
   commit-а, с которым уйдёт Submit.
   Строки: `src/renderer/pr-review/ReviewMode.tsx:194-195`
2. Что делает правка комментария агента с его автором и как main находит запись?
   Ответ: она идёт с `ref` (место, файл, старый текст), main ищет ближайшую запись с этим файлом и текстом и ставит
   `by: 'person'`.
   Строки: `src/renderer/pr-review/review-comments.tsx:323`
3. Когда комментарий на файле PR не считается «не на строке», хотя его строки ещё не проверены?
   Ответ: пока ответ `changes.file` по этому файлу не пришёл: `known` его не знает, и `isOff` даёт false.
   Строки: `src/renderer/pr-review/review-comments.tsx:179-180`
