# Code story — worfy-assistant 09: MCP-сервер `worfy-app`: чтение, предложения, действия по режимам, чужой текст как данные

Kind: pr · Epic: worfy-assistant · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

У Session Assistant-а (Ticket 10) не было ни одного tool-а: нынешние MCP-серверы worfy (`worfy-canvas`,
`worfy-mind-map`) находят Project по cwd Session-а и вне Project-а не работают, а Session Assistant-а работает в папке
данных worfy. Читать пункты ядра внимания, workflow, нити PR, хвост Session-а, Run-ы Autopilot-а и Limits, предлагать
шаги и делать действия по режиму обязанности ей было нечем; не было и правила, как чужой текст (PR, Slack, Jira, текст
пункта) доходит до модели.

- Требование: [Что строить](../issues/09-mcp-сервер-worfy-app.md#что-строить)

## 2. Чужой текст — блок с источником и автором

Code: `src/main/mcp/app-server.ts:149-166` · key lines: 161, 162, 165

```ts
/** An item as the agent reads it: what the core and the duties say, the outside text in blocks. */
function itemView(item: AttentionItem, actions: DutyLook['shown'][number]['proposals']) {
  return {
    id: item.id,
    projectId: item.projectId,
    source: item.source,
    kind: item.kind,
    state: item.state,
    duty: item.duty,
    startedAt: iso(item.startedAt),
    lastAt: iso(item.lastAt ?? item.startedAt),
    events: item.events,
    subject: { kind: item.subject.kind, id: item.subject.id, label: outsideText(item.subject.label, item.source) },
    text: outsideText(item.text, item.source),
    ...(item.pr === undefined ? {} : { pr: { repo: item.pr.repo, number: item.pr.number, title: outsideText(item.pr.title, 'github') } }),
    // An action's text may quote the item (`Open <label>`): a block too.
    actions: actions.map((each) => ({ action: each.action, mode: each.mode, text: outsideText(each.text, item.source) })),
  }
```

- Что делает: пункт ядра отдаётся агенту так, что его текст, подпись предмета, заголовок PR и текст действия лежат в блоках `outside-text` с источником; голой строкой чужой текст не идёт. Так же устроены ответы `pr_threads_read`, `workflow_read`, `session_tail_read` и `autopilot_runs_read`.
- Почему здесь: Ticket требует «чужой текст помечен как данные, с источником и автором»; форма блока — решение без владельца (Итог Ticket-а, пункт 3). Текст действия тоже блок: `Open <label>` цитирует подпись пункта.
- Без него: указание из комментария PR или строки Session-а приходит модели рядом с данными worfy в одном ряду, и граница 2 держится только на словах инструкций.
- Требование: [Что строить, пункт 5](../issues/09-mcp-сервер-worfy-app.md#что-строить)
- Риски и пробелы test-ов: test проверяет, что вне блоков нет текста-инъекции и что блоки несут источник и автора; что модель действительно не следует указаниям, test без модели не проверяет — это держат границы 1 и 3 (только tools `worfy-app`, действия по режиму).

## 3. Секретов в ответах нет

Code: `src/main/mcp/app-server.ts:139-147` · key lines: 141, 147

```ts
/** Every string of `value` with its secrets hidden; keys and shape as they were. */
function redacted(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map(redacted)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, redacted(inner)]))
  return value
}

const text = (value: unknown, isError = false): McpToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? redactSecrets(value) : JSON.stringify(redacted(value)) }], ...(isError ? { isError: true } : {}) })
```

- Что делает: каждая строка ответа — и ключи остаются, и форма — проходит `redactSecrets`, тот же фильтр, что у Terminal AI; ответ-отказ тоже.
- Почему здесь: фильтр уже есть в `src/shared/terminal-ai/redact.ts`; почему фильтр идёт по строкам, а не по готовому JSON — в диффе: замена внутри JSON-текста может съесть обратную косую черту экранирования и сломать JSON.
- Без него: token из вывода команды в хвосте Session-а или из комментария PR уходит в контекст модели.
- Требование: [Готово, когда](../issues/09-mcp-сервер-worfy-app.md#готово-когда)
- Риски и пробелы test-ов: фильтр знает только секреты известной формы (`ghp_`, `xoxb-`, `sk-…`, `NAME=value` с именем секрета); секрет без формы проходит. Текст предложения фильтруется до хранения, поэтому хранимый текст Prepare совпадает с отвеченным.

## 4. Действие — только в режиме self или pre-approved

Code: `src/main/mcp/app-server.ts:324-341` · key lines: 329, 330, 336, 337

```ts
    action_run: async (args) => {
      const shown = deps.duties.look(deps.items()).shown.find((each) => each.item.id === args.item)
      if (shown === undefined) throw new ToolError(`No item ${args.item} is shown now: items_list lists the items you may act on. Nothing was done.`)
      const proposal = shown.proposals.find((each) => each.action === args.action)
      if (proposal === undefined) throw new ToolError(`The duty ${shown.duty} has no action ${args.action} for item ${args.item}. Nothing was done.`)
      if (proposal.mode === 'ask') throw new ToolError(`The mode of ${args.action} in the duty ${shown.duty} is ask: propose it with proposal_create and let the user decide. Nothing was done.`)
      if (proposal.mode === 'hand-over') throw new ToolError(`The mode of ${args.action} in the duty ${shown.duty} is hand-over: the user does it; tell them. Nothing was done.`)
      const item = shown.item
      if (item.projectId === null && args.action !== 'wake-orchestrator' && args.action !== 'continue-session') throw new ToolError(`${args.action} needs an item of a Project. Nothing was done.`)
      if (item.projectId !== null) ownProject(item.projectId, `${args.action} is done only in a Project of this Machine`)
      if (args.action === 'wake-orchestrator' || args.action === 'continue-session') {
        // main checks again, sends its own text and writes the journal line itself.
        const result = await deps.closedList.act({ action: args.action, itemId: item.id, by: 'assistant' })
        if (!result.ok) throw new ToolError(`main refused ${args.action} (${result.reason}). Nothing was sent.`)
        return { action: args.action, item: item.id, done: result.line.text ?? args.action }
      }
      return { action: args.action, item: item.id, done: await act({ ...args, action: args.action }, item) }
    },
```

- Что делает: находит пункт среди тех, что обязанности показывают сейчас, берёт режим действия в его обязанности и при `ask` или `hand-over` отказывает, не дойдя до main; Project пункта должен быть Project-ом этой машины. Действие закрытого списка уходит в `act()` Ticket-а 08 с действием, пунктом и `by: 'assistant'` — без текста: main проверяет снова, шлёт свой текст и сам пишет строку журнала; его отказ (`busy`, `limits`…) приходит агенту с причиной.
- Почему здесь: Ticket: «действия — только те, что разрешает режим обязанности (Ticket 07)»; режимы и `look()` — Ticket 07. Что `pre-approved` разрешает как `self` — решение без владельца (Итог, пункт 2). Форма стыка повторяет `appClosedList().act()` Ticket-а 08 (PR в review): после его merge в приложении меняется одна строка wiring.
- Без него: модель, которой текст PR велел «разбуди Orchestrator», может сделать действие, которое пользователь оставил себе.
- Требование: [Готово, когда](../issues/09-mcp-сервер-worfy-app.md#готово-когда)
- Риски и пробелы test-ов: действие вне `APP_ACTIONS` (`reply-pr`, `fix-session`, `open`) отклоняет схема аргументов, до этого кода; test проверяет оба пути.

## 5. pr-follow и autopilot-start — через функции main с их проверками

Code: `src/main/mcp/app-server.ts:202-223` · key lines: 207, 210, 218, 221

```ts
  const act = async (args: AppToolArgs['action_run'] & { action: MainAction }, item: AttentionItem): Promise<string> => {
    const run = (): Promise<string> => {
      if (args.action === 'pr-follow') {
        if (args.follow === undefined) throw new ToolError('pr-follow needs follow: fixChecks, resolveConflicts or addressComments')
        const { repo, number } = prOf(item)
        return deps.prFollow(item.projectId!, repo, number, args.follow).then((result) => `${args.follow} on ${repo}#${number}: ${result.delivery === 'new' ? 'a new Session started' : `${result.delivery} to Session ${result.sessionId}`}`)
      }
      if (args.epic === undefined) throw new ToolError('autopilot-start needs epic: the Epic the dialog offers to run')
      return deps.autopilotStart({ projectId: item.projectId!, epic: args.epic, session: deps.sessionId() })
    }
    let done: string
    try {
      done = await run()
    } catch (error) {
      if (error instanceof ToolError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      deps.journal({ at: deps.now(), action: args.action, item, outcome: 'refused', text: reason })
      throw new ToolError(reason)
    }
    deps.journal({ at: deps.now(), action: args.action, item, outcome: 'done', text: done })
    return done
  }
```

- Что делает: pr-follow уходит в `ActionLauncher.prFollow`, который отказывает, пока идёт Autopilot; autopilot-start — в стартер `autopilot_start`, который сначала открывает диалог Start Autopilot. Отказ main и сделанное пишутся строкой журнала с пунктом.
- Почему здесь: Ticket называет примеры: «pr-follow отказывает, пока идёт Autopilot; `autopilot_start` всегда открывает диалог». Журнал этих двух действий пишет сервер: закрытый список Ticket-а 08 пишет только свои.
- Без него: сервер сам решал бы, можно ли следовать за PR или запускать Autopilot, и обходил бы проверки main.
- Требование: [Что строить, пункт 4](../issues/09-mcp-сервер-worfy-app.md#что-строить)
- Риски и пробелы test-ов: в приложении строка этих двух действий пока идёт в log main: журнал Ticket-а 08 строк извне не принимает. Session Assistant-а не зарегистрирована в registry до Ticket-а 10, и в приложении стартер `autopilot_start` ответит, что не знает Session — это отказ, а не запуск.

## 6. Сервер без cwd

Code: `src/main/mcp/app-server.ts:380-387` · key lines: 384, 386

```ts
/**
 * The server of the Assistant's Session, for Claude Code's options (ticket 10). It takes no cwd: it is the app's, and
 * answers wherever the Session runs.
 */
export async function worfyAppForSession(request: WorfyAppRequest, deps?: WorfyAppDeps): Promise<{ server: ClaudeMcpServer; instructions: string }> {
  const base = deps ?? (await appWorfyAppDeps())
  return { server: await claudeMcpServer(worfyAppServer({ ...base, sessionId: () => request.sessionId })), instructions: worfyAppInstructions() }
}
```

- Что делает: отдаёт сервер для опций Claude Code, не спрашивая cwd: он принадлежит приложению и отвечает Session-у, где бы она ни работала.
- Почему здесь: Ticket: «привязан к приложению, а не к cwd Session»; подключает его к Session Ticket 10.
- Без него: сервер, как `worfy-mind-map`, вернул бы null для Session в папке данных worfy.
- Требование: [Что строить, пункт 1](../issues/09-mcp-сервер-worfy-app.md#что-строить)
- Риски и пробелы test-ов: test поднимает сервер через `worfyAppForSession` и читает через него; настоящую Session с cwd вне Project-ов запускает только Ticket 10.

## 7. Два новых действия обязанностей

Code: `src/shared/assistant/duties.ts:27-27` · key lines: 27

```ts
export const DUTY_ACTIONS = ['open', 'wake-orchestrator', 'continue-session', 'fix-session', 'summary', 'pr-follow', 'autopilot-start'] as const
```

- Что делает: `pr-follow` и `autopilot-start` становятся действиями обязанностей со своим режимом; по умолчанию `ask` у «Waits for you» и «Work stands».
- Почему здесь: режим разрешает только действие, которое есть у обязанности; решение без владельца (Итог, пункт 1).
- Без него: режим обязанности не мог бы разрешить ни pr-follow, ни autopilot-start, и пункт Ticket-а о них не выполнить.
- Требование: [Готово, когда](../issues/09-mcp-сервер-worfy-app.md#готово-когда)
- Риски и пробелы test-ов: экран режимов — Ticket 15; новые действия видны там без отдельной правки, если экран читает `DUTY_ACTIONS`.

## 8. Что сознательно не меняли

Сервер ни к одной Session не подключён: это Ticket 10. Действия закрытого списка и журнал Assistant-а — Ticket 08.
Project-ы второй машины в приложении не читаются — Ticket 18. Страницы `docs/features` не менялись: поведения, видного
пользователю, пока нет; документация Assistant-а — Ticket 19.

## 9. Как проверено

`test/contract/worfy-app-tools.test.ts` (20 test-ов) и все unit и contract test-ы `src/main/assistant`,
`src/shared/assistant` и `src/main/mcp`; `pnpm lint && pnpm typecheck && pnpm test` и gate fast — коды выхода в отчёте
PR. Mutant-ы в своём worktree: без проверки режима `ask`, без блока у заголовка Ticket-а, без `redactSecrets`, без
проверки Project-а у Prepare — каждый ловит свой test.

## Проверить себя

1. Почему текст действия в ответе `items_list` тоже лежит в блоке чужого текста?
   - Ответ: текст действия main строит из пункта (`Open <label>`), и подпись пункта — чужой текст.
   - Lines: `src/main/mcp/app-server.ts:164-165`
2. Что сделает `action_run` с `wake-orchestrator`, если режим в обязанности — `ask`?
   - Ответ: откажет и попросит `proposal_create`; до закрытого списка main дело не дойдёт и строки журнала не будет.
   - Lines: `src/main/mcp/app-server.ts:329`
3. Почему сервер пишет строку журнала для pr-follow, но не для `wake-orchestrator`?
   - Ответ: закрытый список Ticket-а 08 сам пишет строку каждого своего действия; pr-follow идёт мимо него, и строку пишет сервер.
   - Lines: `src/main/mcp/app-server.ts:334-336`, `src/main/mcp/app-server.ts:218-221`
