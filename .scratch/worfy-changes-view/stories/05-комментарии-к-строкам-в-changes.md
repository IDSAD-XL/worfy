# Code story — worfy-changes-view 05: Комментарии к строкам в Changes: gutter, popover, лоток, список «To» и Send одним сообщением

Kind: pr · Epic: worfy-changes-view · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

После Ticket-ов 03 и 04 Node Changes показывал diff, а модель Comments on quotes знала комментарий к коду (вариант
`code`), но поставить комментарий на строку было нельзя. Этот PR даёт экран: «+» в gutter, клавишу `c` и меню строки,
popover, лоток внизу Node-а, список «To» из main и Send одним сообщением. Блок комментария в чате теперь открывает
Changes на своей строке.

- Требование: [Что происходит](../issues/05-комментарии-к-строкам-в-changes.md#что-происходит)

## 2. Кто привязан к Ticket-у: ручной Binding сильнее launch-а

Code: `src/main/changes/targets.ts:60-78` · key lines: 62, 71, 75

```ts
function storedTargets(stored: readonly ManualBinding[]): Map<string, BindingTarget> {
  const sessions = stored.filter((binding) => (binding.agentId ?? null) === null)
  return new Map([...sessions.filter(isLaunchBinding), ...sessions.filter((binding) => !isLaunchBinding(binding))].map((binding) => [binding.sessionId, binding.target]))
}

const SHORT_ID = 8

/** The Session Nodes of worfy bound to the Ticket, not archived, each with the session id its Binding is stored under. */
export function boundSessions(nodes: readonly LayoutNode[], stored: readonly ManualBinding[], ticket: TargetTicket): { nodeId: string; sessionId: string }[] {
  const targets = storedTargets(stored)
  return nodes.flatMap((node) => {
    if (node.kind !== SESSION_NODE_KIND || node.data.origin !== 'worfy' || isArchived(node)) return []
    const sessionId = node.data.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') return []
    const target = targets.get(sessionId)
    if (target?.kind !== 'ticket' || target.epic !== ticket.epic || target.num !== ticket.num) return []
    return [{ nodeId: node.id, sessionId }]
  })
}
```

- Что делает: собирает Session Node-ы worfy, не в архиве, с session id, чей Binding указывает на этот Ticket. Binding-и
  кладутся в Map сначала launch, потом ручные, поэтому ручной Binding той же Session перезаписывает launch.
- Почему здесь: Ticket называет `src/main/changes/targets.ts` (новый) и правило «как `ticketSession`, но без порога 24
  часа». Почему ручной Binding сильнее — так делает `ticketSession` в `src/main/actions/launch.ts`, который по брифу
  только читать; поэтому здесь своя копия правила, а не вызов.
- Без него: Session, которую пользователь вручную перепривязал к другому Ticket-у, осталась бы в «To» старого.
- Требование: [Что делаем, пункт 4](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: в отличие от `ticketSession`, здесь нет фильтра по Vendor-у — в «To» попадает и Session Codex
  (решено без владельца). Копия правила может разойтись с `launch.ts`, если там его поменяют.

## 3. Список «To» и значение по умолчанию (Q2)

Code: `src/main/changes/targets.ts:81-107` · key lines: 83, 84, 95, 99, 106

```ts
export function defaultTarget(targets: readonly ChangesTarget[]): string | null {
  const sessions = targets.filter((each) => each.kind === 'session')
  if (sessions.length > 0) return [...sessions].sort((a, b) => (b.lastAt ?? -1) - (a.lastAt ?? -1))[0]!.nodeId
  return targets.find((each) => each.kind === 'orchestrator')?.nodeId ?? null
}

/** The list «To» for the Ticket in the Project. */
export async function changesTargets(deps: TargetsDeps, projectId: string, ticket: TargetTicket): Promise<ChangesTargets> {
  const nodes = deps.nodes(projectId)
  const bound = boundSessions(nodes, deps.stored(projectId), ticket)
  const lastAt = bound.length === 0 ? new Map<string, number>() : await deps.lastAt(projectId, bound.map((each) => each.sessionId))
  const sessions: ChangesTarget[] = bound.map(({ nodeId, sessionId }) => ({
    kind: 'session',
    nodeId,
    sessionId: deps.live(projectId, nodeId) ?? sessionId,
    title: `Session ${sessionId.slice(0, SHORT_ID)}`,
    lastAt: lastAt.get(sessionId) ?? null,
  }))
  sessions.sort((a, b) => (b.lastAt ?? -1) - (a.lastAt ?? -1))
  const orchestrator = nodes.find((node) => node.kind === ORCHESTRATOR_KIND && !isArchived(node))
  const targets = [...sessions]
  if (orchestrator !== undefined) {
    const saved = readOrchestratorData(orchestrator.data).sessionId ?? null
    targets.push({ kind: 'orchestrator', nodeId: orchestrator.id, sessionId: deps.live(projectId, orchestrator.id) ?? saved, title: 'Orchestrator', lastAt: null })
  }
  return { targets, defaultNodeId: defaultTarget(targets), autopilot: deps.autopilot(projectId) }
}
```

- Что делает: Session-ы по свежести последней записи транскрипта, затем Orchestrator Project-а. По умолчанию — первая
  Session, без Session — Orchestrator. Session, которая идёт, называется своим живым id (`deps.live`), иначе — id из
  Layout-а.
- Почему здесь: правило по умолчанию — Q2 спеки и пункт 4 Ticket-а; порога 24 часа нет, как велит Ticket.
- Без него: комментарии по умолчанию шли бы Orchestrator-у даже при живой Session Ticket-а.
- Требование: [Что делаем, пункт 4](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: `lastAt` читается с диска по транскриптам; contract test подставляет свои времена, реальное
  чтение проверено только в e2e (без Session, со списком из одного Orchestrator-а).

## 4. Смена «To» переносит комментарии к коду

Code: `src/renderer/changes/line-comments.tsx:224-234` · key lines: 228, 230, 231

```tsx
  /** Another Session in «To»: the comments on code of this Ticket go with the choice. */
  const pickTarget = (nodeId: string) => {
    const next = targets.find((each) => each.nodeId === nodeId)
    if (next === undefined || next.nodeId === target?.nodeId) return
    const nextKey = quoteKey(projectId, next.nodeId, next.sessionId ?? NOT_STARTED)
    if (storeKey !== null && mine.length > 0) {
      removeDrafts(storeKey, mine.map((each) => each.id))
      for (const each of mine) addDraft(nextKey, each)
    }
    setChosen(nodeId)
  }
```

- Что делает: комментарий — черновик Session из «To» в общем store (`quoteKey`). При выборе другой Session комментарии к
  коду этого Ticket-а (`mine`) снимаются с прежней и кладутся новой; комментарии к сообщениям остаются у своих Session.
  Session без id хранит их под `not-started`.
- Почему здесь: Ticket, пункты 3 и 4: лоток показывает store выбранной Session, смена «To» переносит неотправленные.
- Без него: после смены «To» лоток был бы пуст, а старые комментарии ушли бы прежней Session при её Send.
- Требование: [Что делаем, пункты 3 и 4](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: перенос — две записи в localStorage без транзакции; при сбое между ними комментарий
  останется у прежней Session, не пропадёт.

## 5. Send — тот же раунд, что у Send самой Session

Code: `src/renderer/changes/line-comments.tsx:481-498` · key lines: 481, 488, 494, 495

```tsx
      const composed = composeRound(drafts, { text: general, attachments: [] }, imageOf)
      if ('error' in composed) {
        setError(composed.error)
        return
      }
      const { text, attachments } = composed.message
      if (text.trim() === '' && attachments.length === 0) return
      const result = await invoke('agent.send', { sessionId: live.id, text, ...(attachments.length > 0 ? { attachments } : {}) })
      if (!result.ok) {
        setError(result.error)
        return
      }
      const round = composed.round
      if (round.length > 0) markPending(key, { id: newId(), message: text, at: Date.now(), comments: [...round] })
      addSentLines(
        sentKey,
        round.filter(isMine).map((each): SentLine => ({ id: each.id, repository: each.repository, path: each.path, side: each.side, startLine: each.startLine, endLine: each.endLine, text: each.text, images: each.images.length, to: to.title, at: Date.now() })),
      )
```

- Что делает: `composeRound` собирает текст и картинки из всех черновиков Session и общего поля, `agent.send` шлёт одним
  сообщением, `markPending` держит раунд до его prompt-а в транскрипте. Ушедшие комментарии к строкам записываются в
  `sent-lines.ts`, чтобы остаться тусклыми. До этого `liveSession` запускает Session, если она не идёт.
- Почему здесь: Ticket, пункт 5: «то же, что Send поля ввода этой Session»; `composeRound` и `agent.send` по брифу
  только читать, поэтому вызываются как есть. Отдельный store отправленных — потому что `quote-store.ts` не хранит
  отправленные комментарии к коду (их блок в пузыре читается из текста сообщения).
- Без него: Session получила бы комментарии отдельными сообщениями или без кода и строк.
- Требование: [Что делаем, пункт 5](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: если Session при запуске получила новый id, раунд помечается под прежним ключом store; e2e
  проверяет только Orchestrator без привязанной Session. Отказ `agent.send` показан в лотке, но unit test на него нет.

## 6. «To» держит Session с комментариями (доработка, раунд 1)

Code: `src/renderer/changes/line-comments.tsx:198-206` · key lines: 202, 206

```tsx
  // The Session «To» keeps: the one the user picked, or the one shown once it held comments or took a Send. Main's
  // default may name another Session on the next read of the list (a Refresh, after a Send); «To» does not follow it
  // then, or the comments would stay in the store of a Session the tray no longer shows.
  const [chosen, setChosen] = useState<string | null>(null)
  const target = targets.find((each) => each.nodeId === chosen) ?? targets.find((each) => each.nodeId === answer?.defaultNodeId) ?? targets[0] ?? null
  const storeKey = target === null ? null : quoteKey(projectId, target.nodeId, target.sessionId ?? NOT_STARTED)
  const quotes = useQuotes(storeKey)
  const all = quotes.drafts
  if (chosen === null && target !== null && all.length > 0) setChosen(target.nodeId)
```

- Что делает: пока пользователь ничего не выбрал, «To» показывает умолчание main (Q2). Как только у показанной Session
  есть черновики, она закрепляется в `chosen`; после Send она закрепляется тоже (`setChosen((was) => was ?? to.nodeId)`).
- Почему здесь: отчёт проверки PR #2049, находка 2: список «To» читается заново при Refresh и после Send, и умолчание
  могло перейти на другую привязанную Session — черновики оставались в store прежней и пропадали из лотка и из Send.
- Без него: test «holding comments, it stays when main’s default turns to another Session on a Refresh» красный (мутант
  без строки 206), «a Session that took a Send stays…» — без закрепления после Send.
- Требование: [Что делаем, пункт 4](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: выбор не сохраняется между запусками worfy; если закреплённая Session пропадёт из списка,
  «To» вернётся к умолчанию, а её черновики останутся у неё.

## 7. Send берёт Session и комментарии на момент отправки (доработка, раунд 1)

Code: `src/renderer/changes/line-comments.tsx:444-458` · key lines: 445, 447, 448, 458

```tsx
  const send = async () => {
    if (target === null || storeKey === null || sending) return
    // «To» is locked while Send runs (Tray.tsx): the round goes to this Session and waits in its store.
    const to = target
    const key = storeKey
    setSending(true)
    setError(null)
    try {
      const live = await liveSession(to)
      if ('error' in live) {
        setError(live.error)
        return
      }
      // The comments as the store holds them now: one removed while the Session started does not go.
      const drafts = readQuotes(key).drafts
```

- Что делает: Send запоминает Session и ключ store-а при нажатии, а состав раунда читает из store-а после запуска
  Session. Пока `sending`, лоток блокирует «To», поле, × и Clear (`Tray.tsx`), а Edit, Delete и Save правки ждут
  (`openEdit`, `remove`, `save`).
- Почему здесь: отчёт проверки PR #2049, находка 1: «To» оставался доступен, пока Send ждал `sessions.start`; смена
  «To» переносила черновики, а `markPending` шёл по старому ключу — комментарии оставались в новом лотке и уходили
  повторно. Блокировка поля и Edit — пункт «Consider» того же отчёта.
- Без него: test-ы «while Send runs» красные на мутантах каждой блокировки и на составе из снимка `all`.
- Требование: [Что делаем, пункты 4 и 5](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: если Session без id получает его во время Send, а Refresh в это же время переносит
  черновики из `not-started`, раунд их не найдёт — они останутся черновиками (test-а нет).

## 8. Refresh ищет комментарии только в своём виде (доработка, раунд 1)

Code: `src/renderer/changes/line-comments.tsx:515-540` · key lines: 516, 524, 533, 540

```tsx
  const [refreshedIn, setRefreshedIn] = useState({ generation, view: viewOf(scope, hideWhitespace) })
  if (refreshedIn.generation !== generation) setRefreshedIn({ generation, view: viewOf(scope, hideWhitespace) })
  const latest = useRef({ mine, storeKey, refreshedIn, onEntry, scopes, lists })
  useEffect(() => {
    latest.current = { mine, storeKey, refreshedIn, onEntry, scopes, lists }
  })
  const onFileRead = useCallback((entry: FileEntry, diff: FileDiff, readOf: FileReadOf) => {
    read.current.set(entry.key, diff)
    const { mine: drafts, storeKey: key, refreshedIn: refresh, onEntry: isOn, scopes: scoped, lists: listed } = latest.current
    if (refresh.generation === 0 || readOf.generation !== refresh.generation || viewOf(readOf.scope, readOf.hideWhitespace) !== refresh.view) return
    if (key === null || diff.kind !== 'hunks') return
    const scopesOf = scoped.find((each) => each.repo === entry.repo)
    const listOf = listed?.find((each) => each.repo === entry.repo)
    const ids = { lost: [] as string[], found: [] as string[] }
    for (const comment of drafts) {
      if (!isOn(comment, entry)) continue
      // A comment on lines of another commit than the one this read shows on its side belongs to another scope: its
      // lines are true at its commit, and stay as they are.
      if (comment.commit !== commitOf(readOf.scope, comment.side, scopesOf, listOf)) continue
      const lines = sideLines(diff.hunks, comment.side)
      const at = anchorLines(sideText(diff.hunks, comment.side), comment)
      if ('mark' in at && at.mark === LINE_CHANGED) {
        // Lines this view does not show are no news: they may stand there unchanged.
        let shown = true
        for (let number = comment.startLine; number <= comment.endLine; number += 1) shown &&= lines.has(number)
        if (shown) ids.lost.push(comment.id)
```

- Что делает: при росте `generation` запоминается вид Node-а (scope и Hide whitespace). Чтение файла (`DiffPane`
  передаёт, для чего оно) двигает комментарии, только если оно из этого вида и этого Refresh, и только комментарий на
  commit-е, который чтение показывает на его стороне. «Line changed» ставится, только если строки комментария это
  чтение показывает.
- Почему здесь: отчёт проверки PR #2049, находка 3: после первого Refresh любое чтение (Commit, Uncommitted, Compare
  against, Hide whitespace) двигало комментарии — комментарий worktree получал номера строк другого scope с `commit`
  null или ложную «Line changed».
- Без него: test-ы «after a Refresh» красные на мутантах проверки вида, проверки commit-а и проверки показанных строк.
- Требование: [Что делаем, пункт 7](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: поиск идёт по тексту hunk-ов, не всего файла; строка, ушедшая за пределы показанных hunk-ов,
  не найдётся, а отметка поставится, только если исходные строки видны.

## 9. Переход к строке ждёт, пока Node станет видимым

Code: `src/renderer/changes/DiffPane.tsx:427-442` · key lines: 432, 437, 441, 442

```tsx
  useLayoutEffect(() => {
    const target = seek.current
    const box = scroller.current
    // A hidden view (the Session view is in front while the Canvas comes back) neither scrolls nor shows a flash: the
    // look waits for the box to have a size again, which its ResizeObserver reports with a render.
    if (target === null || box === null || box.clientHeight === 0) return
    if (Date.now() > target.until) {
      seek.current = null
      return
    }
    const hunk = Array.from(box.querySelectorAll<HTMLElement>('[data-testid="changes-hunk"]')).find((each) => each.dataset.key === target.key && each.querySelector(`[data-side="${target.side}"][data-line="${target.line}"]`) !== null)
    if (hunk !== undefined) {
      seek.current = null
      pending.current = null
      const marked = Array.from(hunk.querySelectorAll<HTMLElement>(`[data-side="${target.side}"][data-line="${target.line}"]`))
      marked[0]?.scrollIntoView?.({ block: 'center' })
```

- Что делает: запрошенная строка ищется в нарисованных hunk-ах; найденная прокручивается в середину и подсвечивается
  классом `is-flash` и атрибутом `data-flash`. Пока у области diff нет высоты (вид Session ещё впереди), поиск ждёт.
- Почему здесь: Ticket, пункт 6 — блок в пузыре открывает Changes на строке. Ожидание размера — по e2e: при переходе из
  вида Session на Canvas Node рисуется заново, и прокрутка скрытого блока терялась.
- Без него: Node открывался бы, но строка не была бы видна и не мигала бы.
- Требование: [Что делаем, пункт 6](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: поиск бросается через 10 с (`SEEK_MS`) — свёрнутый файл или ушедшая строка не прокрутятся,
  без сообщения пользователю.

## 10. Запрос строки живёт 5 секунд

Code: `src/renderer/changes/open.ts:233-237` · key lines: 236

```ts
/** The line asked for the Ticket's Node, while it is fresh (LINE_REQUEST_MS); null when there is none. */
export function lineRequestFor(request: LineRequest | null, projectId: string, subject: ChangesSubject, now = Date.now()): LineRequest | null {
  if (request === null || request.projectId !== projectId || request.epic !== subject.epic || request.num !== subject.num) return null
  return now - request.at <= LINE_REQUEST_MS ? request : null
}
```

- Что делает: запрос строки годен 5 секунд (`LINE_REQUEST_MS`). Каждый нарисованный экземпляр Node-а обрабатывает
  запрос с данным `seq` один раз, а Node, нарисованный заново, — ещё раз.
- Почему здесь: React Flow рисует только Node-ы в поле зрения, и Node Changes перемонтируется сразу после смены вида;
  одноразовый запрос съедал первый экземпляр. Найдено в e2e (два красных прогона).
- Без него: e2e «блок в чате открывает Changes на строке» падал — строка не мигала.
- Требование: [Что делаем, пункт 6](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: повторное открытие того же Node-а в течение 5 с снова прокрутит к строке; это заметно только
  при очень быстрых действиях.

## 11. Какой Ticket у блока в чате

Code: `src/renderer/session/QuotedPrompt.tsx:35-42` · key lines: 39, 40

```tsx
function useCodeSubject(branch: string): { projectId: string; subject: ChangesSubject } | null {
  const project = activeProject(useProjects())
  const { model } = useWorkflow(branch === '' ? undefined : project?.path)
  if (project === undefined || branch === '') return null
  const ticket = model?.tickets.find((each) => branchNamesTicket(branch, each))
  if (ticket !== undefined) return { projectId: project.id, subject: { epic: ticket.epic, num: ticket.num } }
  return null
}
```

- Что делает: Ticket блока ищется по ветке комментария среди Ticket-ов активного Project-а (`branchNamesTicket`:
  `<epic>/<NN>` или строка `Branch:`). Нашёлся — путь в блоке становится кнопкой, иначе остаётся текстом.
- Почему здесь: Ticket называет `QuotedPrompt.tsx` («переход к строке»); почему по ветке — так ветку пишет текст для
  агента из Ticket-а 04, другого признака Ticket-а в сообщении нет.
- Без него: блок не знал бы, какой Node Changes открыть.
- Требование: [Что делаем, пункт 6](../issues/05-комментарии-к-строкам-в-changes.md#что-делаем)
- Риски и пробелы test-ов: сообщение другого Project-а (не активного) не найдёт свой Ticket — путь будет текстом.

## 12. Что сознательно не меняли

`quote-comments.ts`, `quote-store.ts`, `launch.ts`, `getting-started.ts` и `agent.ts` — только читать по брифу. Чип
комментария к коду в лотке поля ввода Session не менялся. «New session in this worktree», комментарии к PR и Add to
comments — часть 2 спеки. Перевод страницы на русский — Ticket 06.

## 13. Как проверено

- `pnpm typecheck` — exit 0; eslint изменённых файлов — exit 0.
- `node scripts/vitest-electron.mjs` по `changes-tray`, `changes-view`, `changes-targets`, `changes-read`,
  `quote-comments*`, `quote-store`, `session-view` — exit 0, 8 файлов, 245 test-ов.
- `pnpm test:e2e test/e2e/changes-comments.spec.ts` — exit 0, 1 passed.
- `node scripts/check-feature-docs.mjs` — exit 0.
- Новые test-ы на origin/main `bbf82a57f` — exit 1 (нет `sent-lines`, нет канала `changes.targets`).
- Доработка, раунд 1: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (862 файла test-ов, 19 756 test-ов);
  `test/unit/changes-tray.test.tsx` — 20 test-ов, exit 0; 16 мутантов шагов 6–8 и popover-а — каждый даёт exit 1.

## Проверить себя

1. Почему Binding-и в Map кладутся сначала launch, потом ручные?
   - Ответ: в Map побеждает последняя запись по ключу session id, так ручной Binding перезаписывает launch той же Session.
   - Строки: `src/main/changes/targets.ts:60-63`
2. Почему комментарий на commit-е `abc1234` не двигается после Refresh в «All changes» над worktree?
   - Ответ: новая сторона этого чтения — worktree (commit null), а строки комментария верны на его commit-е; чтение
     другого commit-а показывает другие номера строк, поэтому такой комментарий пропускается.
   - Строки: `src/renderer/changes/line-comments.tsx:531-533`
3. Почему отправленные комментарии хранятся в `sent-lines.ts`, а не в store Session?
   - Ответ: `quote-store.ts` не хранит отправленные комментарии к коду и в этом Ticket-е только для чтения; Send после
     `markPending` записывает ушедшие строки в свой список.
   - Строки: `src/renderer/changes/line-comments.tsx:494-498`

## 14. Что нашёл review и что осталось

> VERIFIED — changes-view 05 round 2, head 00db8a874efb516e1b79d4d66a40866fb7c7097e
>
> Second gate round (depth medium), scope: the three med findings of round 1 and the rework diff b267bf761..229bf46b9.
>
> - «To» enabled during Send: fixed. Tray.tsx:99 disables «To» while sending, ×/Clear/field locked (Tray.tsx:75,83,125); send fixes target and store key at press time and re-reads drafts after the Session starts (line-comments.tsx:444-458), markPending on that key (:494); remove/edit/Save refuse while sending (:309,:329,:350). Lock released in finally.
> - Default «To» flipping on reload: fixed. Pin once the shown Session holds drafts (line-comments.tsx:206) or took a Send (:501); without either it follows main's default (Q2).
> - Re-anchoring on any scope after Refresh: fixed. DiffPane.tsx:338 passes {scope, hideWhitespace, generation}; re-anchor only in reads of the Refresh's own view and generation and only when the comment's commit matches the read's side (line-comments.tsx:512-540).
> - Verifier: changes-tray.test.tsx 20/20; two mutants of its own (pin line removed; commit check removed) each red. Implementer: 16 mutants killed; full pnpm lint/typecheck/test exit 0 (19 756 tests); gate fast green. ci-ok pass on the head.
>
> Consider [low]:
> - line-comments.tsx:206 — the pin applies only while `chosen === null`; if a pinned Session leaves the targets list, «To» shows the default and never re-pins, so drafts written there can drift on a later default change.
> - line-comments.tsx:124 (used at :533) — for scope Commit, commitOf returns the commit's sha for both sides, but the old side is its first parent; an old-side comment from Uncommitted can re-anchor against the parent's text (false «Line changed» or shift).
> - line-comments.tsx:310,330 — Edit/Delete during Send silently do nothing (no disabled state or toast).
> - Outside the diff: save takes commit/branch from the current scope if the scope changed while the popover was open (pre-existing).
>
> Not verified: e2e changes-comments.spec.ts not rerun this round; evidence lines for items 3-5 point at round-1 commit 8d4712631.
