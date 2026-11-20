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

Code: `src/renderer/changes/line-comments.tsx:211-221` · key lines: 215, 217, 218

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

Code: `src/renderer/changes/line-comments.tsx:443-460` · key lines: 443, 450, 456, 457

```tsx
      const composed = composeRound(all, { text: general, attachments: [] }, imageOf)
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
      if (round.length > 0) markPending(storeKey, { id: newId(), message: text, at: Date.now(), comments: [...round] })
      addSentLines(
        sentKey,
        round.filter(isMine).map((each): SentLine => ({ id: each.id, repository: each.repository, path: each.path, side: each.side, startLine: each.startLine, endLine: each.endLine, text: each.text, images: each.images.length, to: target.title, at: Date.now() })),
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

## 6. Переход к строке ждёт, пока Node станет видимым

Code: `src/renderer/changes/DiffPane.tsx:420-435` · key lines: 425, 430, 434, 435

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

## 7. Запрос строки живёт 5 секунд

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

## 8. Какой Ticket у блока в чате

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

## 9. Что сознательно не меняли

`quote-comments.ts`, `quote-store.ts`, `launch.ts`, `getting-started.ts` и `agent.ts` — только читать по брифу. Чип
комментария к коду в лотке поля ввода Session не менялся. «New session in this worktree», комментарии к PR и Add to
comments — часть 2 спеки. Перевод страницы на русский — Ticket 06.

## 10. Как проверено

- `pnpm typecheck` — exit 0; eslint изменённых файлов — exit 0.
- `node scripts/vitest-electron.mjs` по `changes-tray`, `changes-view`, `changes-targets`, `changes-read`,
  `quote-comments*`, `quote-store`, `session-view` — exit 0, 8 файлов, 245 test-ов.
- `pnpm test:e2e test/e2e/changes-comments.spec.ts` — exit 0, 1 passed.
- `node scripts/check-feature-docs.mjs` — exit 0.
- Новые test-ы на origin/main `bbf82a57f` — exit 1 (нет `sent-lines`, нет канала `changes.targets`).

## Проверить себя

1. Почему Binding-и в Map кладутся сначала launch, потом ручные?
   - Ответ: в Map побеждает последняя запись по ключу session id, так ручной Binding перезаписывает launch той же Session.
   - Строки: `src/main/changes/targets.ts:60-63`
2. Зачем запросу строки срок в 5 секунд, а не одно использование?
   - Ответ: Node Changes перемонтируется сразу после перехода из вида Session; одноразовый запрос съедал первый экземпляр,
     а новый экземпляр должен обработать его ещё раз.
   - Строки: `src/renderer/changes/open.ts:233-237`
3. Почему отправленные комментарии хранятся в `sent-lines.ts`, а не в store Session?
   - Ответ: `quote-store.ts` не хранит отправленные комментарии к коду и в этом Ticket-е только для чтения; Send после
     `markPending` записывает ушедшие строки в свой список.
   - Строки: `src/renderer/changes/line-comments.tsx:456-460`
