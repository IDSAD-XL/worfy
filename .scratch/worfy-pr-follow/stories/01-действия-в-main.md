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

Code: `src/main/actions/launch.ts:344-388` · key lines: 345, 356, 357, 367, 369, 372, 373, 374, 380, 383

```ts
  async prFollow(projectId: string, repo: string, pr: number, action: PrFollowAction, near?: CanvasSpot): Promise<PrFollowResult> {
    if (this.autopilot?.running(projectId) === true) throw new Error(PR_FOLLOW_AUTOPILOT_HINT)
    const follow = this.deps.prFollow
    if (follow === undefined) throw new Error('This build cannot follow pull requests')
    const key = JSON.stringify([projectId, repo.toLowerCase(), pr])
    // Taken before the first await: two clicks that arrive together do not start two Sessions.
    if (this.following.has(key)) throw new Error(`${ACTION_LABELS[action]} is already starting for ${repo}#${pr}`)
    this.following.add(key)
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
      if (target !== null) this.bindWhenKnown(projectId, session, target)
      return { nodeId: view.nodeId, sessionId: view.sessionId, text: state.text, delivery: 'new' }
    } finally {
      this.following.delete(key)
    }
  }
```

- Что делает: сначала отказы, где чтение не нужно: Autopilot, пустой шаблон. Затем свежее чтение PR и вердикт
  `prFollowState` по нему, так что `{sha}` — head этого чтения. Затем отказ, если занят Orchestrator с Binding-ом на
  Epic Ticket-а этого PR-а. Дальше текст получает Session Ticket-а через `started`, `send` и `notice`, иначе новая
  Session Node на Claude Code с Binding-ом launch на Ticket.
- Почему здесь: Ticket называет `prFollow()` в `src/main/actions/launch.ts`. Путь `started` / `send` / `notice` —
  тот, что влил worfy-continuity (ADR-0108, пункт 5). Свой путь продолжения Ticket писать запрещает.
- Без него: щелчок по устаревшей кнопке отдал бы Session старый head. Wave и кнопка чинили бы один PR вдвоём.
- Требование: [Что делаем, пункт 8](../issues/01-действия-в-main.md#что-делаем)
- Риски и пробелы test-ов: Orchestrator привязан к Epic-у только сохранённым Binding-ом (`shortcut:` в строке 364).
  Wave, набранная руками, привязана сигналами транскрипта, которые здесь не читаются. Если `started` падает, щелчок
  уходит в новую Session (строка 377). Связка `PrInbox.refresh` → `snapshot` проверена только по типам: contract test
  идёт через fake.

## 5. Какая Session Ticket-а моложе 24 часов

Code: `src/main/actions/launch.ts:395-414` · key lines: 397, 400, 402, 410, 412

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

## 6. Hook кнопки для Ticket-ов 04 и 05

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

## 7. Что сознательно не меняли

- `src/main/github/inbox-groups.ts`: тип `InboxPull` не тронут. Признак fork-а несёт `ReadPull` в
  `src/main/github/inbox.ts`, потому что файла групп нет в списке Ticket-а.
- В строке PR inbox `isCrossRepository` необязателен (`optional`), а не `default(false)`. Так тип строки не требует
  поля во всех fixture-ах test-ов, а старый snapshot без поля читается как не-fork.
- `waitingThreads`, `sameRepo` и `ticketOfRow` экспортируются и из прежних renderer-модулей, чтобы `PrInboxView` и
  test-ы не менялись.
- Кнопок в UI нет: это Ticket-ы 04 и 05. E2e нет: ticket его не требует.

## 8. Как проверено

- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (847 файлов test-ов, 19347 test-ов).
- gate fast — см. отчёт PR.
- Вне списка Ticket-а с согласия Orchestrator-а: `test/unit/link-access.test.ts` (канал `actions.prFollow` — `write`) и
  fixture-ы шаблонов в `test/contract/projects.test.ts`, `test/contract/remote-calls.test.ts`,
  `test/unit/edit-profile.test.tsx`, `test/unit/terminal-shell.test.ts`, `test/unit/vendor-badge.test.tsx`.

## Проверить себя

1. Кнопка Fix checks была активна, а за минуту до щелчка CI на новом head позеленел. Что получит пользователь?
   - Строки: `src/main/actions/launch.ts:356-358`
   - Ответ: отказ «CI is no longer failing on <head>»: вердикт берётся по строке свежего чтения, а не по прежней.
2. Session Ticket-а запущена Ship ticket 25 часов назад, но процесс её ещё жив. Куда уйдёт текст?
   - Строки: `src/main/actions/launch.ts:408-413`
   - Ответ: в новую Session Node: решает возраст последней записи транскрипта, а не живой процесс.
3. Почему `{sha}` проверяется в render, а не только в канале IPC?
   - Строки: `src/shared/actions/render-template.ts:33-46`
   - Ответ: head приходит не от renderer-а, а из GitHub через свежее чтение main, и render — последнее место перед
     Session с `bypassPermissions`.
