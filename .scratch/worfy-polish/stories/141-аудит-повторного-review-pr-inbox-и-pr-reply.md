# Code story — worfy-polish 141: Аудит повторного review: PR inbox и pr-reply

Kind: pr · Epic: worfy-polish · Ticket: 141 · PR: - · Language: ru

## 1. Что было не так

Четыре находки аудита повторного review (`.scratch/audit-pr-rereview-2026-11-13/`) про PR inbox и skill `pr-reply`.
Skill и заголовок «Answer N open threads» считали ждущими ответа пользователя все нерешённые threads, даже на PR коллеги,
где пользователь в thread-е не писал. Drafts ответов читались каждые 5 s и на focus окна, пока вид Pull requests
смонтирован, а shell держит скрытые виды смонтированными. Markdown каждого комментария разбирался заново на каждый
render панели — на каждое чтение drafts и каждое нажатие клавиши.

- Требование: [Что происходит](../issues/141-аудит-повторного-review-pr-inbox-и-pr-reply.md#что-происходит)

## 2. Skill pr-reply: на чужом PR ждёт только thread, где пользователь писал

Code: `harness/skills/pr-reply/SKILL.md:65-72` · key lines: 65, 66, 67, 69, 70

```markdown
- **A review thread** waits when `isResolved` is false, its last comment is not the viewer's, and the viewer owes
  the answer: on the viewer's own pull request (its `author.login` is the viewer) every such thread; on someone
  else's pull request only a thread the viewer wrote in, one with a comment of the viewer's in `comments`. A
  colleague's thread the viewer never wrote in waits for its author, not for the viewer. This is the rule of
  worfy's "Needs my answer" group (worfy looks for the viewer's comment among the last three comments of a thread
  only, so on a long thread its count can be lower). Its last comment is the one in `latest`, never the last of `comments`, which a
  long thread cuts. A resolved thread, one whose last comment is the viewer's, and a thread on someone else's pull
  request the viewer never wrote in get no draft.
```

- Что делает: review thread ждёт ответа, когда он не resolved, последний комментарий (`latest`) не viewer-а и ответ
  должен viewer: на своём PR — любой такой thread, на чужом — только тот, где есть комментарий viewer-а в `comments`.
  Остальные threads чужого PR drafts не получают.
- Почему здесь: Ticket называет раздел 3 skill-а (`SKILL.md:63-71`) и требует правило `owesAnswer` приложения
  (`src/main/github/inbox-groups.ts`), тот же смысл, что у `waitingThreads` в `src/shared/pr-inbox/rows.ts`.
- Без него: на PR коллеги skill пишет drafts ответов в threads, где ход не за пользователем.
- Требование: [Что делаем, п. 1](../issues/141-аудит-повторного-review-pr-inbox-и-pr-reply.md#что-делаем)
- Риски и пробелы test-ов: test проверяет текст skill-а, а не поведение модели; платный eval `pr-reply-three-threads`
  не запускался. `comments` читает первые 50 комментариев thread-а: комментарий viewer-а дальше 50-го skill не увидит.

## 3. «Answer N open threads» считает waitingThreads

Code: `src/renderer/pr-inbox/usePrInbox.ts:511-516` · key lines: 513, 516

```ts
    case 'needs-answer': {
      // Only the threads where the move is the user's (main's rule for this group): on a colleague's PR not every open one.
      const waiting = waitingThreads(row, viewer)
      return {
        tone: 'answer',
        title: waiting > 0 ? `Answer ${plural(waiting, 'open thread', 'open threads')}` : 'Your answer is awaited',
```

- Что делает: в группе `needs-answer` число в заголовке — `waitingThreads(row, viewer)`: нерешённые threads, где
  последний комментарий не пользователя, а на чужом PR — только с его комментарием. Без viewer-а — ноль, заголовок
  «Your answer is awaited». В группе `needs-review` текст «N open threads from others» по-прежнему считает
  `unresolvedThreads`.
- Почему здесь: Ticket называет `nextStep` (`usePrInbox.ts:500-525`) и предписывает `waitingThreads`; по нему уже
  считают badge на Card (`src/renderer/canvas/badges/review-threads.ts`).
- Без него: на PR коллеги заголовок называет больше threads, чем пользователь должен ответить.
- Требование: [Что делаем, п. 2](../issues/141-аудит-повторного-review-pr-inbox-и-pr-reply.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 4. Drafts читаются только при показанном виде Pull requests

Code: `src/renderer/pr-inbox/DraftThread.tsx:161-179` · key lines: 166, 170, 171, 172, 173, 179

```tsx
  // Another PR or Project: what a read of the earlier one brings later is dropped.
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [load])

  useEffect(() => {
    if (!shown) return
    load()
    const timer = setInterval(load, DRAFTS_POLL_MS)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [load, shown])

```

- Что делает: чтение сразу, таймер на 5 s и чтение на focus окна запускаются, только пока `shown` — вид shell-а
  `pull-requests` (`useNavigation`, строка 138). Скрыли вид — таймер и подписка на focus снимаются; показали снова —
  одно чтение сразу. Флаг `live`, по которому отбрасывается поздний ответ для прежнего PR, вынесен в свой effect по
  `load`: скрытие вида его не трогает, смена PR или Project — сбрасывает, как раньше.
- Почему здесь: Ticket называет `usePrReplyDrafts` (`DraftThread.tsx:124-168`); то, что shell держит скрытые виды
  смонтированными, записано в `src/renderer/shell/AppShell.tsx`.
- Без него: скрытый вид каждые 5 s зовёт `prInbox.drafts`, всё время, пока открыто окно.
- Требование: [Что делаем, п. 3](../issues/141-аудит-повторного-review-pr-inbox-и-pr-reply.md#что-делаем)
- Риски и пробелы test-ов: ответ на чтение, начатое до скрытия, ещё применяется — это безвредно, test-а на это нет.

## 5. CommentBody под React.memo

Code: `src/renderer/pr-inbox/CommentBody.tsx:5-16` · key lines: 10, 16

```tsx
// Memoised (worfy-polish 141): the pane renders again on every read of the drafts and every key typed in a reply, and
// parsing the markdown of every comment each time made typing lag; the same text and repository draw nothing new.
import { memo } from 'react'
import { Markdown } from '../markdown/Markdown'

export const CommentBody = memo(function CommentBody({ body, repo }: { body: string; repo: string | null }) {
  return (
    <div className="w-pr-inbox-comment__body" data-testid="pr-inbox-comment-body">
      <Markdown text={body} breaks github={{ repo }} />
    </div>
  )
})
```

- Что делает: тот же `body` и `repo` (сравнение строк) — React не рисует компонент заново и markdown не разбирается.
- Почему здесь: Ticket называет `CommentBody.tsx` и предписывает `React.memo`; цифра ~195 ms на разбор — из аудита.
- Без него: каждое чтение drafts и каждое нажатие клавиши в поле ответа заново разбирает markdown всех комментариев.
- Требование: [Что делаем, п. 4](../issues/141-аудит-повторного-review-pr-inbox-и-pr-reply.md#что-делаем)
- Риски и пробелы test-ов: время разбора test не меряет, только число render-ов markdown.

## 6. Test-ы: красные на origin/main

Code: `test/unit/draft-thread.test.tsx:208-242` · key lines: 211, 213, 225, 228, 230, 239

```tsx
  it('reads no drafts while the Pull requests view is hidden, on its timer or on the focus of the window; reads them at once when it is shown (worfy-polish 141)', async () => {
    // Only the interval is fake: waitFor keeps its real setTimeout.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      preload(draftsOf([item(0)]))
      await showView('canvas')
      const { PrDrafts } = await import('../../src/renderer/pr-inbox/DraftThread')
      render(
        <PrDrafts projectId={PROJECT} repo={API} number={118} readOnly={null} threads={[{ id: 'T0', path: 'src/a.ts', line: 1 }]}>
          {(renderItem, list) => <div>{renderItem === null ? null : list.map(renderItem)}</div>}
        </PrDrafts>,
      )
      const idle = async (): Promise<void> =>
        act(async () => {
          vi.advanceTimersByTime(15_000)
          window.dispatchEvent(new Event('focus'))
        })
      await idle()
      expect(draftReads()).toBe(0)
      // Shown: one read at once, then one each 5 seconds.
      await showView()
      await waitFor(() => expect(screen.getAllByTestId('pr-draft')).toHaveLength(1))
      expect(draftReads()).toBe(1)
      await act(async () => {
        vi.advanceTimersByTime(5_000)
      })
      expect(draftReads()).toBe(2)
      // Hidden again: the timer and the focus read nothing.
      await showView('canvas')
      await idle()
      expect(draftReads()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
```

- Что делает: пока вид скрыт, ни таймер (fake `setInterval`), ни focus окна не зовут `prInbox.drafts`; при показе — одно
  чтение, через 5 s — второе; скрыт снова — чтений больше нет. Fake только interval: `waitFor` идёт на настоящем
  `setTimeout`.
- Почему здесь: Ticket, «Готово, когда», пункт про 168.
- Без него: опрос скрытого вида ничем не закреплён.
- Требование: [Готово, когда](../issues/141-аудит-повторного-review-pr-inbox-и-pr-reply.md#готово-когда)
- Риски и пробелы test-ов: остальные три test-а — `test/unit/pr-inbox-view.test.tsx` (PR коллеги, «Answer 1 open
  thread»), `test/unit/pr-inbox-comment-body.test.tsx` (счёт render-ов markdown через обёртку над настоящим
  `Markdown`) и `test/contract/harness-evals.test.ts` (текст раздела 3 skill-а). Все четыре красные на старом коде.

## 7. Что сознательно не меняли

Число «N open threads from others» в группе `needs-review` — это threads других людей, его ticket не трогает. Находка 170
(выбор PR при старте окна) и правило комментариев conversation в skill-е — вне скоупа ticket-а. Старые Code story,
цитирующие сдвинутые строки, не правились: их фрагменты читаются по head их собственного PR.

## 8. Как проверено

Четыре новых или изменённых test-а — красные на старом коде (exit 1), зелёные после правки. Test-ы модулей PR inbox,
markdown и skill-а pr-reply (17 файлов, 715 test-ов) — exit 0. `pnpm lint`, `pnpm typecheck` — exit 0. `pnpm test` при
load average 82–95 — 6 timeout-ов в файлах `pr-inbox-view`, `pr-search-view`, `review-comments` и `land.test.sh`; эти
файлы отдельно — exit 0. E2e `pr-inbox`, `pr-inbox-digest`, `pr-search`, `pr-review`, `pr-follow-ticket` под замком
e2e — 22 passed, exit 0.

## Проверить себя

1. Почему на чужом PR thread, где последний комментарий коллеги, может не ждать пользователя?
   - Ответ: на чужом PR ответ должен тот, кто писал в thread-е; если пользователь там не писал, ход за автором PR, а
     не за ним.
   - Строки: `harness/skills/pr-reply/SKILL.md:66-68`
2. Почему флаг `live` вынесен в отдельный effect, а не остался в effect-е опроса?
   - Ответ: effect опроса теперь перезапускается и при скрытии вида; если бы он сбрасывал `live`, ответ на начатое
     чтение терялся бы. Отдельный effect по `load` сбрасывает флаг только при смене PR или Project.
   - Строки: `src/renderer/pr-inbox/DraftThread.tsx:161-167`
3. Где число открытых threads осталось прежним и почему?
   - Ответ: в группе `needs-review` — там пользователя просят о review, и текст называет threads других людей.
   - Строки: `src/renderer/pr-inbox/usePrInbox.ts:500-503`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-polish 141 (audit findings 162, 169, 168, 171: the pr-reply skill drafts only threads the viewer owes, «Answer N open threads» counts them, drafts are not polled while the Pull requests view is hidden, a comment body is not redrawn on every inbox update), head e385f406c745a5f95ddae91de273e053345a1d4f
>
> Gate (depth medium, one round): reviewer (lens: correctness) — MERGE with one low; the Orchestrator fixed it (e385f406c with the Code story) and ran the paid Harness evals of the skill.
>
> - What the user sees: on a colleague's PR /worfy:pr-reply drafts only threads the user wrote in (on the user's own PR every unresolved thread whose last comment is not theirs, as before); the «Answer N open threads» button counts the same threads (a colleague's PR with none of them shows «Your answer is awaited»); the hidden Pull requests view reads no drafts (no 5 s timer, no focus handler) and reads them once when shown; a comment's markdown is drawn again only when its text or repo changes.
> - Fixed by the Orchestrator: the skill says worfy's group looks for the user's comment among the last three comments of a thread only, so on a long thread the button's count can be lower than the drafts.
> - Evidence: every new test red on origin/main; reviewer 5 of 5 mutants caught; the three PR files 662 passed; e2e pr-inbox, pr-inbox-digest, pr-search, pr-review, pr-follow-ticket whole 22 passed (implementer); harness-evals contract 789 passed EXIT=0 on e385f406c; paid evals pr-reply-three-threads 2/2 score 1.00 ($0.68), pr-reply-guards score 1.00 ($0.66); gate fast green on aba37e865; story-check ok.
> - Not verified: nothing beyond ci-ok, which land waits for.
