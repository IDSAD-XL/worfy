# Code story — worfy-pr-follow 01: Действия PR в main: action templates, `{sha}`, причины кнопок, канал `actions.prFollow`, маршрут и отказы

Kind: pr · Epic: worfy-pr-follow · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

У Project-а было четыре действия: Ship ticket, Run wave, Process gate queue и Draft replies. Ни одно не отдаёт
Session свой PR с красным CI, конфликтом или замечаниями. Draft replies всегда запускает новую Session без Binding-а.
В строке PR inbox нет признака fork-а. `waitingThreads` и `ticketOfRow` лежат в `src/renderer`, и main их взять не может.

- Требование: [Что происходит](../issues/01-действия-в-main.md#что-происходит)

## 2. Причины и отказы — одна чистая функция

Code: `src/shared/actions/pr-follow.ts:24-62` · key lines: 25, 26, 27, 41, 42, 43, 44, 60

```ts
const REASONS: Readonly<Record<PrFollowAction, (row: PrFollowRow, viewer: string | null) => boolean>> = {
  resolveConflicts: (row) => row.mergeStateStatus === 'DIRTY',
  fixChecks: (row) => row.ci === 'failing',
  addressComments: (row, viewer) => row.reviewDecision === 'CHANGES_REQUESTED' || waitingThreads(row, viewer) > 0,
}

/** The actions the PR has a reason for, in the order of PR_FOLLOW_ACTIONS; the first one goes on the button. */
export function prFollowReasons(row: PrFollowRow, viewer: string | null): PrFollowAction[] {
  return PR_FOLLOW_ACTIONS.filter((action) => REASONS[action](row, viewer))
}

/**
 * Why no action may follow the PR at all, or null when they may: `row` undefined — the PR is closed or not in the PR
 * inbox; a PR whose author is not `viewer` (also before the first search, when no viewer is known); a PR from a fork.
 */
export function prFollowRefusal(ref: PrFollowRef, row: PrFollowRow | undefined, viewer: string | null): string | null {
  const name = `${ref.repo}#${ref.pr}`
  if (row === undefined) return `${name} is closed or no longer in the PR inbox`
  if (viewer === null) return 'The PR inbox has not read your GitHub login yet'
  if (!sameLogin(row.author, viewer)) return `${name} is not your pull request`
  if (row.isCrossRepository === true) return `${name} comes from a fork: a Session cannot push to it`
  return null
}

/** The head as a refusal names it: its first seven characters, as git shortens a commit. */
const headOf = (row: PrFollowRow): string => (row.headRefOid === null ? 'its head' : row.headRefOid.slice(0, 7))

const GONE: Readonly<Record<PrFollowAction, (head: string) => string>> = {
  resolveConflicts: (head) => `The pull request no longer has a merge conflict on ${head}`,
  fixChecks: (head) => `CI is no longer failing on ${head}`,
  addressComments: (head) => `Nothing waits for your answer on ${head} any more`,
}

/** Why `action` cannot run on the PR now — a refusal of prFollowRefusal, or its reason is gone — or null when it can. */
export function prFollowBlock(action: PrFollowAction, ref: PrFollowRef, row: PrFollowRow | undefined, viewer: string | null): string | null {
  const refusal = prFollowRefusal(ref, row, viewer)
  if (refusal !== null || row === undefined) return refusal
  return REASONS[action](row, viewer) ? null : GONE[action](headOf(row))
}
```

- Что делает: даёт причины действий в порядке `PR_FOLLOW_ACTIONS`: `DIRTY`, потом `failing`, потом
  `CHANGES_REQUESTED` или нити, ждущие ответа. Отказывает PR-у без строки (закрыт или уже не в PR inbox), чужому PR-у
  и PR-у из fork. Если причины действия больше нет, называет короткий head: «CI is no longer failing on 3f2a9c1».
- Почему здесь: Ticket называет новый `src/shared/actions/pr-follow.ts`. Его читают кнопки Ticket-ов 04 и 05 и main,
  чтобы кнопка и сервер не расходились, как Ship ticket в `gates.ts`. Порядок `DIRTY` первым записан в spec-е: пока PR в
  конфликте, CI не запускается.
- Без него: кнопка и main считали бы причины по-разному, и щелчок по активной кнопке получал бы отказ без объяснения.
- Требование: [Что делаем, пункт 3](../issues/01-действия-в-main.md#что-делаем)
- Риски и пробелы test-ов: закрытый PR узнаётся только по отсутствию строки. В snapshot попадают одни открытые PR, а
  строка не несёт `state`. Без viewer-а (до первого поиска) любой PR считается не пользователя.

## 3. `{sha}` — только 40 hex

Code: `src/shared/actions/render-template.ts:33-46` · key lines: 34, 45

```ts
/** A commit hash as `{sha}` takes it: 40 hex characters, no space, no line break, nothing around them. */
const SHA = /^[0-9a-fA-F]{40}$/

/** Fills every `{name}` of the template; any unknown name or name without a value fails the render. */
export function renderTemplate(template: string, values: TemplateValues, action?: Action): RenderResult {
  const unknown = unknownPlaceholders(template)
  if (unknown.length > 0) return { ok: false, error: `Unknown placeholder ${unknown.map((name) => `{${name}}`).join(', ')}` }
  const missing = [...template.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]!).filter((name, index, all) => KNOWN.has(name) && values[name as Placeholder] === undefined && all.indexOf(name) === index)
  if (missing.length > 0) {
    const where = action === undefined ? '' : ` in ${ACTION_LABELS[action]}`
    return { ok: false, error: `${missing.map((name) => `{${name}}`).join(', ')} has no value${where}` }
  }
  if (values.sha !== undefined && !SHA.test(values.sha)) return { ok: false, error: '{sha} is not a commit hash of 40 hex characters' }
  return { ok: true, text: template.replace(/\{([^{}]*)\}/g, (_match, name: string) => values[name as Placeholder]!) }
```

- Что делает: render отказывает, если значение `{sha}` — не ровно 40 hex-символов. Пробел, перевод строки или
  лишний символ дают отказ, а не текст.
- Почему здесь: текст уходит в Session с `bypassPermissions`. Ticket требует ту же строгость, что у `{repo}`
  (`src/shared/ipc/actions.ts`, `githubRepoSchema`).
- Без него: head с переводом строки и командой после него стал бы вторым сообщением Session.
- Требование: [Что делаем, пункт 2](../issues/01-действия-в-main.md#что-делаем)
- Риски и пробелы test-ов: регистр hex не проверяется. GitHub отдаёт head строчными буквами, заглавные безвредны.

## 4. Маршрут щелчка в main

Code: `src/main/actions/launch.ts:358-406` · key lines: 359, 366, 373, 374, 384, 386, 389, 390, 391, 397, 400, 404

```ts
  async prFollow(projectId: string, repo: string, pr: number, action: PrFollowAction, near?: CanvasSpot): Promise<PrFollowResult> {
    if (this.autopilot?.running(projectId) === true) throw new Error(PR_FOLLOW_AUTOPILOT_HINT)
    const follow = this.deps.prFollow
    if (follow === undefined) throw new Error('This build cannot follow pull requests')
    const key = JSON.stringify([projectId, repo.toLowerCase(), pr])
    // Taken before the first await: two clicks that arrive together do not start two Sessions. A new Session keeps it
    // until its Binding is written (or given up): before that the route cannot find it, and a second click on the same
    // PR would start a second Session on the same Ticket and branch.
    if (this.following.has(key)) throw new Error(prFollowStartingHint(action, repo, pr))
    this.following.add(key)
    let held: Promise<void> | null = null
    try {
      const root = this.deps.projectRoot(projectId)
      const template = this.deps.settings(projectId).actionTemplates[action]
      if (!isActionConfigured(template)) throw new Error(emptyTemplateHint(action))
      const [{ row, viewer }, model] = await Promise.all([follow.pull(projectId, repo, pr), this.deps.workflow(root)])
      const state = prFollowState({ action, template, repo, pr, row, viewer })
      if (!state.enabled) throw new Error(state.reason)
      // A PR outside the workflow (no Ticket names it, or the workflow cannot be read) still gets its Session, unbound.
      const ticket = row === undefined || model.error !== null ? undefined : ticketOfRow(row, model.tickets)
      const target: BindingTarget | null = ticket === undefined ? null : { kind: 'ticket', epic: ticket.epic, num: ticket.num }
      const stored = storedTargets(follow.stored(projectId))
      if (target !== null) {
        // shortcut: only a stored Binding (Run wave's launch one, or a manual one) ties the Orchestrator to the Epic; a Wave typed into it by hand binds by its transcript's signals, which this does not read. Read them (sessionBindings) when such a Wave gets a second Session on its PR.
        const orchestrator = await follow.busyOrchestrator(projectId)
        const bound = orchestrator?.sessionId == null ? undefined : stored.get(orchestrator.sessionId)
        if (bound?.kind === 'epic' && bound.epic === target.epic) throw new Error(prFollowWaveHint(target.epic))
      }
      const node = target === null ? null : await this.ticketSession(projectId, target, stored)
      if (node !== null) {
        try {
          const session = await follow.started(projectId, node)
          const delivery = session.send(state.text)
          session.notice(prFollowNotice(action, repo, pr, delivery))
          return { nodeId: node, sessionId: session.id, text: state.text, delivery }
        } catch (error) {
          console.warn(`[actions] ${projectId}: the Session of ${node} did not take ${ACTION_LABELS[action]}; a new one starts`, error)
        }
      }
      const view = this.deps.sessions.create(projectId, near, PR_REPLY_VENDOR)
      const session = this.deps.registry.get(view.sessionId)
      session.send(state.text)
      held = target === null ? this.untilKnown(session, ENDED) : this.bindWhenKnown(projectId, session, target, ENDED)
      return { nodeId: view.nodeId, sessionId: view.sessionId, text: state.text, delivery: 'new' }
    } finally {
      if (held === null) this.following.delete(key)
      else void held.finally(() => this.following.delete(key))
    }
  }
```

- Что делает: сначала отказы, где чтение не нужно: Autopilot, пустой шаблон. Затем свежее чтение PR и вердикт
  `prFollowState` по нему, так что `{sha}` — head этого чтения. Затем отказ, если занят Orchestrator с Binding-ом на
  Epic Ticket-а этого PR-а. Дальше текст получает Session Ticket-а через `started`, `send` и `notice`, иначе новая
  Session Node на Claude Code с Binding-ом launch на Ticket. Lock щелчка по PR (строка 366) держится, пока новая
  Session не назвала свой id и её Binding не записан (строки 400 и 404). Иначе второй щелчок по тому же PR не нашёл бы
  её по маршруту и запустил бы вторую Session на тот же Ticket и ту же ветку.
- Почему здесь: Ticket называет `prFollow()` в `src/main/actions/launch.ts`. Путь `started` / `send` / `notice` —
  тот, что влил worfy-continuity (ADR-0108, пункт 5). Свой путь продолжения Ticket писать запрещает.
- Без него: щелчок по устаревшей кнопке отдал бы Session старый head. Wave и кнопка чинили бы один PR вдвоём.
- Требование: [Что делаем, пункт 8](../issues/01-действия-в-main.md#что-делаем)
- Риски и пробелы test-ов: Orchestrator привязан к Epic-у только сохранённым Binding-ом (`shortcut:` в строке 381).
  Wave, набранная руками, привязана сигналами транскрипта, которые здесь не читаются. Если `started` падает, щелчок
  уходит в новую Session (строка 394); это покрывает test «does not start again». Пока Claude Code не назвал id,
  lock держится не дольше `WAIT_MS` (10 мин), и всё это время щелчок по PR получает «is already starting». Ожидание
  кончается и раньше, когда Session перешла в `error` (Claude Code не вошёл, нет сети, процесс вышел) или в `closed`:
  следующий щелчок и есть повтор. Ship ticket и Run wave ждут и через `error`, потому что такая Session стартует
  заново на следующий send и её Binding ещё придёт. Отказ говорит, что закрытие Node снимает ожидание.

## 5. Какая Session Ticket-а моложе 24 часов

Code: `src/main/actions/launch.ts:413-432` · key lines: 415, 418, 420, 428, 430

```ts
  private async ticketSession(projectId: string, target: Extract<BindingTarget, { kind: 'ticket' }>, stored: ReadonlyMap<string, BindingTarget>): Promise<string | null> {
    const bound = this.deps.prFollow!.nodes(projectId).flatMap((node) => {
      if (node.kind !== SESSION_NODE_KIND || node.data.origin !== 'worfy' || isArchived(node)) return []
      const vendor = node.data.vendor ?? UNNAMED_VENDOR
      const sessionId = node.data.sessionId
      if (vendor !== PR_REPLY_VENDOR || typeof sessionId !== 'string' || sessionId === '') return []
      const bindingTarget = stored.get(sessionId)
      if (bindingTarget?.kind !== 'ticket' || bindingTarget.epic !== target.epic || bindingTarget.num !== target.num) return []
      return [{ nodeId: node.id, sessionId }]
    })
    if (bound.length === 0) return null
    const lastAt = await this.deps.prFollow!.lastAt(projectId, bound.map((each) => each.sessionId))
    const now = this.deps.now?.() ?? Date.now()
    const young = bound.flatMap((each) => {
      const at = lastAt.get(each.sessionId)
      return at !== undefined && now - at < FOLLOW_SESSION_MS ? [{ ...each, at }] : []
    })
    young.sort((a, b) => b.at - a.at)
    return young[0]?.nodeId ?? null
  }
```

- Что делает: берёт Session Node worfy не в архиве, на Claude Code, с session id, чей Binding (manual сильнее
  launch) — Ticket этого PR-а. Из них оставляет те, чья последняя запись транскрипта моложе 24 часов, и выбирает самую
  свежую.
- Почему здесь: правило Q7 spec-а: 24 часа, тот же порог, что у автоархива. Время `lastAt` — то же, что читает
  автоархив (`registry.sessions(...).history`).
- Без него: текст ушёл бы в Session недельной давности или в Session на Codex, где skill pr-fix не работает.
- Требование: [Вопросы владельцу, Q7](../spec.md#вопросы-владельцу)
- Риски и пробелы test-ов: Session без session id (Claude Code его ещё не назвал) пропускается, и запускается новая.

## 6. Свежее чтение PR в приложении

Code: `src/main/ipc/actions.ts:47-59` · key lines: 53, 54, 56

```ts
/**
 * The fresh read of one PR over a PR inbox: the Project read once when it never was, the PR's details read again
 * (PrInbox.refresh), then its row in the Project's snapshot, by repository (in any case) and number.
 */
export function prInboxPull(inbox: Pick<PrInbox, 'ensureRead' | 'refresh' | 'snapshot'>): PrFollowDeps['pull'] {
  return async (projectId, repo, pr) => {
    await inbox.ensureRead(projectId)
    await inbox.refresh(repo, pr)
    const snapshot = inbox.snapshot(projectId)
    const row = snapshot.groups.flatMap((group) => group.rows).find((each) => each.repo.toLowerCase() === repo.toLowerCase() && each.number === pr)
    return { row, viewer: snapshot.viewer }
  }
}
```

- Что делает: приложение читает Project, если он ещё не прочитан, затем перечитывает PR (`PrInbox.refresh`) и только
  после этого берёт его строку из snapshot-а по repository (без учёта регистра) и номеру.
- Почему здесь: Ticket называет `src/main/ipc/actions.ts` для зависимостей launcher-а; функция вынесена, чтобы test
  проверил её без fake `pull`.
- Без него: `{sha}` пришёл бы из старого snapshot-а, а отказы считались бы по PR другого repository с тем же номером.
- Требование: [Что делаем, пункт 8](../issues/01-действия-в-main.md#что-делаем)
- Риски и пробелы test-ов: если свежее чтение упало (сеть, ошибка GitHub) или аккаунт ждёт rate limit, строка остаётся
  прежней. Это записано на странице `docs/features/projects.md`, и skill сам сверяет head.

## 7. Hook кнопки для Ticket-ов 04 и 05

Code: `src/renderer/canvas/actions/gates.ts:63-70` · key lines: 66, 67, 68, 69

```ts
export function usePrFollowState(projectId: string, row: PrInboxRow, action: PrFollowAction): ActionState {
  const templates = useActionTemplates(projectId)
  const viewer = usePrInbox(projectId).snapshot?.viewer ?? null
  const readOnly = useReadOnly()
  if (readOnly !== null) return { enabled: false, reason: readOnly }
  if (templates === undefined) return READING
  return prFollowState({ action, template: templates[action], repo: row.repo, pr: row.number, row, viewer })
}
```

- Что делает: read-only экран отказывает первым. Пока не пришли шаблоны, отказ «Reading the Project settings…».
  Дальше вердикт `prFollowState` по строке, viewer-у PR inbox и шаблону Project-а.
- Почему здесь: Ticket называет `usePrFollowState` в `gates.ts` рядом с `useShipTicketState`. Ticket-ы 04 и 05
  берут его и своей копии не пишут.
- Без него: Ticket-ы 04 и 05 написали бы по своей копии правил кнопки.
- Требование: [Что делаем, пункт 5](../issues/01-действия-в-main.md#что-делаем)
- Риски и пробелы test-ов: пока PR inbox не ответил, viewer — null, и hook коротко показывает «The PR inbox has not
  read your GitHub login yet».

## 8. Что сознательно не меняли

- `src/main/github/inbox-groups.ts`: тип `InboxPull` не тронут. Признак fork-а несёт `ReadPull` в
  `src/main/github/inbox.ts`, потому что файла групп нет в списке Ticket-а.
- В строке PR inbox `isCrossRepository` необязателен (`optional`), а не `default(false)`. Так тип строки не требует
  поля во всех fixture-ах test-ов, а старый snapshot без поля читается как не-fork.
- `waitingThreads`, `sameRepo` и `ticketOfRow` экспортируются и из прежних renderer-модулей, чтобы `PrInboxView` и
  test-ы не менялись.
- Кнопок в UI нет: это Ticket-ы 04 и 05. E2e нет: ticket его не требует.

## 9. Как проверено

- `pnpm lint && pnpm typecheck && pnpm test` — exit 0.
- Раунд 2 review: 10 mutant-ов, каждый краснеет. Это снятый dedupe, lock, отпущенный до Binding-а, `throw` вместо новой
  Session, read-only после «reading», без `inbox.refresh`, строка по одному номеру, Binding Subagent-а, поле
  `isCrossRepository` вне запроса и `false` в `toPull` или `rowOf`.
- Раунд 3 review: 5 mutant-ов ожидания id краснеют. Это снятая проверка конечного state, `ENDED` без `closed` или без
  `error`, и ожидание `CLOSED` вместо `ENDED` для PR с Ticket-ом и без него.
- gate fast — см. отчёт PR.
- Вне списка Ticket-а с согласия Orchestrator-а: `test/contract/pr-inbox.test.ts` (разбор `isCrossRepository`),
  `test/unit/link-access.test.ts` (канал `actions.prFollow` — `write`) и
  fixture-ы шаблонов в `test/contract/projects.test.ts`, `test/contract/remote-calls.test.ts`,
  `test/unit/edit-profile.test.tsx`, `test/unit/terminal-shell.test.ts`, `test/unit/vendor-badge.test.tsx`.

## Проверить себя

1. Кнопка Fix checks была активна, а за минуту до щелчка CI на новом head позеленел. Что получит пользователь?
   - Строки: `src/main/actions/launch.ts:373-375`
   - Ответ: отказ «CI is no longer failing on <head>»: вердикт берётся по строке свежего чтения, а не по прежней.
2. Session Ticket-а запущена Ship ticket 25 часов назад, но процесс её ещё жив. Куда уйдёт текст?
   - Строки: `src/main/actions/launch.ts:426-431`
   - Ответ: в новую Session Node: решает возраст последней записи транскрипта, а не живой процесс.
3. Почему `{sha}` проверяется в render, а не только в канале IPC?
   - Строки: `src/shared/actions/render-template.ts:33-46`
   - Ответ: head приходит не от renderer-а, а из GitHub через свежее чтение main, и render — последнее место перед
     Session с `bypassPermissions`.

## 10. Что нашёл review и что осталось

> VERIFIED
> Noted: round 3 (ba5232fe2..cfb385368, read by the orchestrator): the wait of a PR action ends on `error` or `closed` (ENDED, src/main/actions/launch.ts), Ship ticket and Run wave keep waiting through `error` (CLOSED) so a Session that restarts on the user's next send still gets its Binding; the refusal reads "… is already starting for repo#N: wait for its Session, or close its Node to start again" (prFollowStartingHint); test/contract/actions.test.ts:755 runs error and closed, each with and without a Ticket naming the PR, and the 5 mutants of the end-state check fail it.
> Consider: a PR-action Session in `error` that the user revives by a message gets no Ticket Binding (the wait ended), so a later click on the PR starts a second Session (low).
> Noted: rounds 1–2 — 36 mutants of round 1 (26 killed, the 10 survivors fixed in round 2), 2 more on the lock release; the lock holds until the new Session's Binding is written, a click into the Ticket's own Session holds none; isCrossRepository parsed (test/contract/pr-inbox.test.ts); prInboxPull refreshes and matches by repository and number.
> Checks: implementer on cfb385368 — lint EXIT=0, typecheck EXIT=0, 7 touched unit+contract files (217 tests) EXIT=0, story-check EXIT=0, gate fast [gate] green EXIT=0; verifier round 2 (own copy) — 52 files, 1583 tests EXIT=0.
> Review depth: medium — round 3, delta read by the orchestrator (3 files, 74 lines)
> Review tokens: 0

Code: `test/contract/actions.test.ts:755-755` · key lines: 755

```ts
    ] as const)('a new Session that ends in %s before its id frees the lock (a PR %s): the next click starts a new one', async (state, whose) => {
```
