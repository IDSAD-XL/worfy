# Code story — worfy-polish 125: Pull requests читает GitHub сразу при открытии вкладки, а не ждёт таймера

Kind: pr · Epic: worfy-polish · Ticket: 125 · PR: - · Language: ru

## 1. Что было не так

PR inbox читал PR-ы Project-а только по таймеру — раз в 5 минут, после ошибки до 30 минут. Вне очереди читался только
Project, которого ещё не читали, или Project, у которого снова включили переключатель. Человек открывал вкладку Pull
requests, чтобы увидеть свежее состояние, а видел снимок возрастом до 5 минут: review comment из песочницы появился
только через несколько минут.

- Требование: [Что происходит](../issues/125-pull-requests-читает-github-при-открытии.md#что-происходит)

## 2. Main: чтение по открытию и его пределы

Code: `src/main/github/inbox.ts:482-502` · key lines: 485, 488, 493, 498, 500, 501

```ts
  async readOnOpen(projectId: string): Promise<void> {
    const project = this.projectOf(projectId)
    const running = this.states.get(projectId)?.running
    if (running) return running
    if (!this.openReadDue(project)) return
    // A read queued in front of this one, by a tick or another open, may have read the Project already.
    await this.serial(() => (this.openReadDue(project) ? this.pollIfDue(project, true) : (this.states.get(projectId)?.running ?? Promise.resolve())))
  }

  /** Whether an open of the view may read the Project now: the rules of readOnOpen. */
  private openReadDue(project: PrInboxProject): boolean {
    if (!this.options.enabled(project)) return false
    const state = this.states.get(project.id)
    if (state === undefined) return true
    if (state.running) return false
    const now = this.now()
    if (now - state.startedAt < INBOX_OPEN_READ_MS) return false
    // The backoff after a failed read: the interval was doubled, and GitHub is not asked again before its time.
    if (state.intervalMs > this.base && now < state.nextAt) return false
    return this.accountPause(state.account) === null
  }
```

- Что делает: читает Project сейчас, через ту же очередь `serial`, что и тики, и тот же `pollIfDue` с `now = true`,
  который пропускает проверку `nextAt`. Не читает: Project с выключенным переключателем; Project, чьё последнее чтение
  началось меньше 30 с назад (`startedAt` ставит `poll` в начале каждого чтения, удачного или нет); Project после
  упавшего чтения, пока не прошёл удвоенный интервал; аккаунт на паузе по rate limit. Идущее чтение не запускается
  второй раз: открытие возвращает его promise. Проверка повторяется внутри очереди, поэтому два открытия подряд дают
  одно чтение — второе находит `startedAt` первого.
- Почему здесь: Ticket называет `inbox.ts` «рядом с `ensureRead` и очередью `serial`». Следующий тик через 5 минут
  получается сам: `poll` ставит `nextAt = now + intervalMs`. Удвоение после сбоя соблюдается по брифу Orchestrator-а
  («respect the existing backoff»), в Ticket-е его нет.
- Без него: вкладка показывает снимок последнего тика; без порога каждое переключение вкладок стоило бы поиска и
  страницы details из лимита GitHub API.
- Требование: [Что делаем, п. 1–4](../issues/125-pull-requests-читает-github-при-открытии.md#что-делаем)
- Риски и пробелы test-ов: каждое правило — свой contract test в `test/contract/pr-inbox.test.ts` (describe «the read
  on opening the view»), все красные до правки. Порог считается от начала чтения: чтение, которое идёт дольше 30 с,
  после конца может быть повторено следующим открытием сразу. После 401 починенный вход ждёт тика или Health check-а —
  цена удвоения.

## 3. Канал: `opened` у `prInbox.get`

Code: `src/main/ipc/pr-inbox.ts:47-52` · key lines: 49, 50

```ts
    defineHandler(prInboxGet, async ({ projectId, opened }) => {
      // The view was opened (worfy-polish 125): a read out of turn, within the limits of readOnOpen.
      if (opened === true) await inbox().readOnOpen(projectId)
      else await inbox().ensureRead(projectId)
      return inbox().snapshot(projectId)
    }),
```

- Что делает: тот же канал, что и обычный запрос снимка, с необязательным полем `opened`
  (`src/shared/ipc/pr-inbox.ts`). С ним main сначала читает по правилам шага 2, потом отвечает снимком.
- Почему здесь: Ticket оставляет выбор «новый канал или параметр `prInbox.get`» implementer-у. Параметр: ответ тот же
  снимок, область та же (`project`, `read`), и Project machine старой версии поле отбрасывает и отвечает как раньше.
- Без него: renderer не может попросить чтение вне очереди.
- Требование: [Где в коде](../issues/125-pull-requests-читает-github-при-открытии.md#где-в-коде)
- Риски и пробелы test-ов: contract test «prInbox.get with `opened`…» проверяет через `registerIpc`: обычный запрос не
  читает, с `opened` — читает, повтор за 30 с — нет. Linked machine, которая просит Project machine, отдельно не
  проверена.

## 4. Renderer: показ вида — это открытие

Code: `src/renderer/pr-inbox/PrInboxView.tsx:880-886` · key lines: 883, 885

```tsx
  const openRead = usePrInboxReading(project.id)
  // Each time the view is shown — its tab, an entry of open.ts, another Project while it is shown — main reads GitHub
  // now, within its limits (worfy-polish 125); the views of the shell stay mounted, so this follows the shown view.
  const shown = useNavigation((store) => store.view === 'pull-requests')
  useEffect(() => {
    if (shown) readPrInboxOnOpen(project.id)
  }, [shown, project.id])
```

- Что делает: при каждом переходе вида в `pull-requests` и при смене Project-а, пока вид показан, просит `prInbox.get`
  с `opened`. Пока ответ не пришёл, строка состояния пишет «Reading pull requests…» и «Last read 3m ago» вместо
  «Next search in N min»; строки прежнего чтения остаются.
- Почему здесь: виды shell смонтированы всегда и только скрыты (`AppShell.tsx`), поэтому mount компонента — не
  открытие. Все входы — вкладка, палитра, группа sidebar, уведомление через `openPrInboxOf` — меняют один и тот же
  `useNavigation().view`.
- Без него: main не узнаёт, что вкладку открыли.
- Требование: [Что делаем, п. 1 и 5](../issues/125-pull-requests-читает-github-при-открытии.md#что-делаем)
- Риски и пробелы test-ов: 4 unit test-а в `test/unit/pr-inbox-view.test.tsx` (красные до правки) и e2e
  `pr-inbox.spec.ts` «opening the view reads GitHub at once…». Индикатор показывает только чтение по открытию: чтение по
  таймеру строку не меняет, как и раньше.

## 5. Какой ответ держит вид

Code: `src/renderer/pr-inbox/usePrInbox.ts:47-56` · key lines: 53, 54

```ts
const applied = new Map<string, number>()
let requests = 0
let subscribed = false

/** Whether the answer to `request` is the newest of the Project so far; it is then the one the entry holds. */
function newest(projectId: string, request: number): boolean {
  if (!users.has(projectId) || (applied.get(projectId) ?? 0) > request) return false
  applied.set(projectId, request)
  return true
}
```

- Что делает: ответ отбрасывается, только если вид уже показал ответ на более поздний запрос. Раньше отбрасывался любой
  ответ не на последний отправленный запрос.
- Почему здесь: при первом показе нового Project-а уходят два запроса — обычный (`usePrInbox`) и с `opened`. По
  старому правилу быстрый ответ обычного отбрасывался, и вид стоял пустым до конца чтения GitHub.
- Без него: вид нового Project-а пуст на время чтения GitHub.
- Требование: [Что делаем, п. 5](../issues/125-pull-requests-читает-github-при-открытии.md#что-делаем)
- Риски и пробелы test-ов: ответ раньше отправленного запроса, пришедший первым, теперь кратко показывается до
  следующего; старый ответ после нового по-прежнему отбрасывается. Отдельного test-а на порядок ответов нет; его
  косвенно покрывают test-ы «selecting a PR» и `markSeen`.

## 6. Что сознательно не меняли

- Снимок main не получил поля «идёт чтение»: индикатор живёт в renderer-е и знает только о своём запросе.
- Триггер уведомлений GitHub (`inbox-notifications.ts`) и `refresh(repo, number)` — без изменений.

## 7. Как проверено

`node scripts/vitest-electron.mjs` по 25 файлам unit и contract test-ов модулей PR inbox — exit 0 (750 test-ов).
`pnpm test:e2e test/e2e/pr-inbox.spec.ts test/e2e/pr-search.spec.ts` под замком e2e — exit 0 (13 test-ов).
`pnpm lint` — exit 0, `pnpm typecheck` — exit 0.

## Проверить себя

1. Почему второе из двух открытий подряд не запускает второе чтение, хотя оба прошли первую проверку до очереди?
   - Ответ: внутри очереди проверка повторяется, а к тому времени первое чтение поставило `startedAt`, и 30 с ещё не
     прошли.
   - Строки: `src/main/github/inbox.ts:482-502`
2. Почему вызов привязан к показанному виду, а не к mount компонента?
   - Ответ: виды shell смонтированы всегда и только скрыты, mount случается один раз при старте окна.
   - Строки: `src/renderer/pr-inbox/PrInboxView.tsx:880-886`
3. Что видел бы человек при переходе на другой Project во вкладке Pull requests со старым правилом отбрасывания
   ответов?
   - Ответ: пустой вид «Reading pull requests…» до конца чтения GitHub: ответ обычного запроса отбрасывался бы, потому
     что после него ушёл запрос с `opened`.
   - Строки: `src/renderer/pr-inbox/usePrInbox.ts:47-56`

## 8. Что нашёл review и что осталось

> VERIFIED — worfy-polish 125 (the Pull requests view reads GitHub at once when shown, not after the 5-minute timer), head 903e7a0a647ba0688e6d6f4c23b9862d18410e99
>
> Gate (depth medium, one round): verifier (lens: implementer's report) — every claim backed, two low bookkeeping notes; reviewer (lens: correctness) — one low (a test gap), no high or med.
>
> - Every showing of the view (tab, palette, sidebar group, notification / digest / badge entries, Project switch while shown) sends prInbox.get {opened:true}; main runs PrInbox.readOnOpen in the same serial queue as the timer tick (no double GitHub calls), at most once per 30 s from the start of the Project's last read, honouring the doubled interval after a failure and the account rate pause; the next timer search comes 5 min after an open read. usePrInbox drops an answer older than the one shown (request number only grows); the read indicator clears on its own answer. An older main without `opened` answers as before (plain zod object).
> - Tests: 8 contract + 4 unit tests red before; 25 unit+contract files 750 passed EXIT=0; pr-inbox + pr-inbox-view 144/144 EXIT=0 (re-run by both reviewers); e2e pr-inbox.spec.ts + pr-search.spec.ts whole 13 passed EXIT=0; lint, typecheck, story-check, evidence-check EXIT=0; mutants: backoff check removed → red, renderer rule restricted to the last request → red. Local gate fast not run: file-watcher tests red on this Mac (fseventsd); CI is the verdict.
>
> Decided without the owner (to confirm): a parameter `opened` on prInbox.get rather than a new channel; the 30 s threshold counts from the start of the last read of any kind; after a failed read an open waits the doubled interval (someone who just fixed sign-in waits for the tick or Health check); the read indicator lives in the renderer only.
>
> Consider [low]: inbox.ts:501 — the account-pause check in openReadDue has no test (a mutant returning true survives; poll skips gh during a pause today); a quick markSeen/get answer can beat the slow open-read answer once — the rows come back with the next prInbox.changed.
