# Code story — worfy-pr-review 09: Review mode и выбор способа ревью

Kind: pr · Epic: worfy-pr-review · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

Start review в полосе «что дальше» был ссылкой на вкладку Files GitHub. Ticket-ы 05–08 дали поиск PR, diff PR в
Changes, локальный черновик ревью и Agent review, но экрана, который их собирает, не было. Владелец 2026-11-20
потребовал выбор, кто пишет ревью, и решил (Q3 а): отметки Viewed свои, один раз взятые с github.com, обратно не
пишутся.

- Требование: [Что происходит](../issues/09-review-mode-и-выбор-способа-ревью.md#что-происходит)

## 2. Первое открытие: черновик на head и один read отметок Viewed

Code: `src/main/github/pr-review-draft.ts:476-490` · key lines: 478, 479, 482, 485, 489

```ts
  async start(root: string, repo: string, pr: number, input: { head: string; files: readonly { path: string; blob: string }[]; viewed: (() => Promise<string[]>) | null }): Promise<PrReviewDraftAnswer> {
    const file = await this.file(root, repo, pr)
    const running = this.starts.get(file)
    if (running !== undefined) return running.then(() => this.draft(root, repo, pr))
    const started = (async (): Promise<PrReviewDraftAnswer> => {
      const current = await this.draft(root, repo, pr)
      if (current.draft !== null || current.problem !== null) return current
      let viewed: string[] = []
      try {
        viewed = input.viewed === null ? [] : await input.viewed()
      } catch (error) {
        this.warn(`[pr-review] the files Viewed on github.com of ${repo}#${pr} were not read: ${messageOf(error)}`)
      }
      return this.change(root, repo, pr, (draft) => draft ?? startedDraft(repo, pr, input.head, input.files, viewed), { now: true })
    })()
```

- Что делает: новый канал `prReview.start` (`local`). Черновик уже есть — он возвращается, GitHub не спрашивается.
  Черновика нет — `viewedOnGithub` один раз читает GraphQL `files { path viewerViewedState }` и черновик создаётся на
  head с отметками `VIEWED` по `path` и blob новой стороны. Два одновременных старта делят одно обещание. Сбой чтения —
  черновик без отметок, без повтора.
- Почему здесь: Ticket называет `src/main/github/pr-review-draft.ts` для отметок Viewed с github.com. Канал в
  `src/shared/ipc/pr-review.ts`, который Ticket называет «только читать», — решение без владельца, записано в «Итог».
- Без него: отметки читались бы на каждом открытии или их пришлось бы писать из renderer-а; правило «один раз и только
  чтением» не выполнить.
- Требование: [Что делаем, п. 4](../issues/09-review-mode-и-выбор-способа-ревью.md#что-делаем)
- Риски и пробелы test-ов: Start review теперь сразу создаёт пустой черновик. Больше 30 страниц по 100 файлов не
  читается — не проверено test-ом.

## 3. Один commit черновика для строк, «N new commits» и Submit

Code: `src/renderer/pr-review/ReviewMode.tsx:107-109` · key lines: 107, 108, 109

```tsx
  const draftCommit = draft === null ? null : draftCommitOf(draft)
  const moved = draftCommit !== null && subject !== null && !sameCommit(draftCommit, subject.headOid)
  const scope: ChangesScope = since && moved && draftCommit !== null ? { kind: 'compare', repo, ref: draftCommit } : { kind: 'all' }
```

- Что делает: `draftCommitOf(draft) = anchoredOn ?? startedOn` — commit, на котором пронумерованы строки комментариев.
  Head ушёл от него — полоса «N new commits since you started», Show new commits — scope `compare` от этого commit-а.
  Комментарии рисуются на строках только при scope All changes и commit-е черновика, равном head; иначе — списком над
  diff-ом.
- Почему здесь: spec.md:528 шлёт Submit с `commit_id = startedOn`, а `bin/pr-review-draft` нумерует строки на
  `anchoredOn ?? startedOn` (review Ticket-а 08). Ticket 09 не вызывает `reanchor`; Ticket 11 должен слать ту же функцию.
- Без него: комментарий, нарисованный на строке head, ушёл бы на GitHub с номером строки другого commit-а.
- Требование: [Что делаем, п. 5](../issues/09-review-mode-и-выбор-способа-ревью.md#что-делаем)
- Риски и пробелы test-ов: Submit (Ticket 11) ещё не написан — совпадение commit-ов там test-ом не проверено.

## 4. Linked machine — по окну, не по уровню доступа

Code: `src/renderer/pr-review/review-store.ts:15-21` · key lines: 19, 20

```ts
/**
 * LINKED_REVIEW_HINT in a window of a Linked machine, whatever level it was given, else null: the `prReview.*` channels
 * are `local`, so the draft is never reached from another Machine, even with Full access.
 */
export function reviewAway(): string | null {
  return windowMachine() === null ? null : LINKED_REVIEW_HINT
}
```

- Что делает: в окне Linked machine Start review неактивен с «Review on the machine of the Project», а View changes
  открывает Review mode только для чтения: diff и нити через каналы `project` / `read`, без черновика, Viewed и полосы.
- Почему здесь: каналы `prReview.*` — `local` (Ticket-ы 07 и 08); уровень Read only (`useReadOnly`) пропустил бы окно
  с Full access, где те же каналы отказали бы.
- Без него: на Linked machine с Full access Start review был бы активен, а `prReview.start` отказывал бы.
- Требование: [Что делаем, п. 7](../issues/09-review-mode-и-выбор-способа-ревью.md#что-делаем)
- Риски и пробелы test-ов: e2e проверяет только уровень Read only; Full access — не проверен.

## 5. Как проверено

- `test/unit/review-mode.test.tsx` — 12 test-ов: меню и запоминание выбора, Linked machine, клавиши, Viewed и новый
  blob, «N new commits», Ask the agent / Stop / Take over, read only. До правки — exit 1 (нет модуля).
- `test/contract/pr-review-draft.test.ts` — 5 новых test-ов Start review на gh stand-in (он валит test на `--method`
  и `mutation`): один read, второй и два одновременных старта, черновик уже есть, сбой чтения, без reader-а; до правки —
  exit 1, 6 failed.
- `test/e2e/pr-review.spec.ts` — 3 test-а: Review myself из inbox и поиска, Agent review на fake agent с записью
  через `harness/bin/pr-review-draft`, Linked machine Read only; снимки в обеих темах. Exit 0 вместе с
  `pr-inbox.spec.ts` и `pr-search.spec.ts` (16 passed).
- `pnpm test`, `pnpm lint`, `pnpm typecheck` — exit 0.

## Проверить себя

1. Почему повторное открытие PR не читает отметки Viewed с github.com снова?
   Ответ: `start` возвращает существующий черновик до любого вызова `viewed`; GitHub читается только при создании черновика.
   Строки: `src/main/github/pr-review-draft.ts:481-485`
2. Где комментарии черновика, когда после начала ревью в PR пришёл новый push?
   Ответ: commit черновика не равен head, поэтому они не на строках diff-а head, а списком над ним; Show new commits
   показывает diff от commit-а черновика.
   Строки: `src/renderer/pr-review/ReviewMode.tsx:107-109`
3. Почему на Linked machine с Full access Start review тоже неактивен?
   Ответ: каналы `prReview.*` — `local`; признак берётся из машины окна, а не из уровня доступа.
   Строки: `src/renderer/pr-review/review-store.ts:19-20`
