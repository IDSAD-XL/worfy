# Code story — worfy-assistant 10: Session Assistant-а: cwd вне Project-ов, третий вид Session в Harness, только tools `worfy-app`, файл памяти

Kind: pr · Epic: worfy-assistant · Ticket: 10 · PR: - · Language: ru

## 1. Что было не так

Части Assistant-а лежали в main, но не были связаны. Решение о пробуждении (Ticket 06) и закрытый список действий
(Ticket 08) ничем не запускались. Session, которую будить, не было. Сервер `worfy-app` (Ticket 09) отказывал в
действиях закрытого списка заглушкой, а pr-follow и autopilot-start, которые просил Assistant, писал только в log main.
Предложения жили в памяти main и терялись при перезапуске. Обязательств Assistant-а и ответов пользователя не хранил
никто. Harness знал два вида Session: обычный и Product Session.

- Требование: [Что строить](../issues/10-session-assistant-а.md#что-строить)

## 2. Session Assistant-а: только tools worfy-app, вне Project-ов, новая на каждое пробуждение

Code: `src/main/vendors/claude/assistant-session.ts:78-102` · key lines: 84, 87, 88, 90, 91, 92, 93, 95

```ts
export function assistantSessionOptions(input: AssistantSessionOptionsInput): Options {
  const canUseTool: CanUseTool = (toolName, toolInput) =>
    Promise.resolve(ALLOWED_TOOLS.includes(toolName) ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: ASSISTANT_TOOL_DENIED })
  const executable = claudeExecutablePath(input.runtime)
  return {
    cwd: input.cwd,
    env: { ...withoutApiKeys(input.env), [SESSION_KIND_VARIABLE]: ASSISTANT_SESSION_KIND },
    model: ASSISTANT_SESSION_MODEL,
    sessionId: input.sessionId,
    persistSession: false,
    settingSources: [],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: input.instructions },
    tools: [],
    mcpServers: { [WORFY_APP_SERVER_NAME]: sdkServerConfig(input.server) },
    managedSettings: { allowManagedMcpServersOnly: true, allowedMcpServers: [], allowManagedPermissionRulesOnly: true },
    allowedTools: [...ALLOWED_TOOLS],
    disallowedTools: [...ONE_SHOT_DISALLOWED_TOOLS],
    permissionMode: 'dontAsk',
    canUseTool,
    maxTurns: ASSISTANT_MAX_TURNS,
    ...(input.harnessPlugin === null ? {} : { plugins: [{ type: 'local' as const, path: input.harnessPlugin, skipMcpDiscovery: true }] }),
    ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
    ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
  }
}
```

- Что делает: собирает options одной Session Assistant-а. cwd — папка в данных worfy вне Project-ов, без файлов
  настроек (`settingSources: []`). В окружении `WORFY_SESSION_KIND=assistant`, без API-ключей. Встроенных tools нет
  (`tools: []`), MCP-сервер один — `worfy-app`, policy tier не пускает ни серверов пользователя, ни connectors
  claude.ai. Разрешены ровно tools `worfy-app` под `dontAsk`, `canUseTool` отказывает остальным. Модель —
  `opus`. Id Session — новый, без `resume` и без транскрипта.
- Почему здесь: тикет называет образцом Session черновика профиля и одноразовый вызов (`one-shot.ts`); отдельный
  файл драйвера Claude — как `connector-check.ts` Ticket-а 11, чистая функция, которую unit test читает целиком.
  Почему `opus` и почему без транскрипта — решения без владельца, записаны в «Итог».
- Без него: у Session были бы Bash, запись файлов и сеть (граница 1), грузились бы `CLAUDE.md` и hooks Project-а, а
  connectors claude.ai заняли бы контекст.
- Требование: [Готово, когда, пункты 1, 3, 4 и 6](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: unit test проверяет options, которые уходят в SDK. Что настоящий Claude Code с ними не
  предлагает модели ни одного встроенного tool-а, проверено только по документации SDK (`tools: []` — «Disable all
  built-in tools»), живого запуска с моделью не было.

## 3. Harness печатает Session-у Assistant-а свои правила

Code: `harness/hooks/inject-rules.mjs:57-62` · key lines: 59, 60

```js
function forThisSession(part) {
    const kind = process.env[KIND_VARIABLE]
    if (KINDS.includes(part)) return kind === part
    if (part === "orchestrator") return !KINDS.includes(kind)
    return true
}
```

- Что делает: часть `assistant` печатается только в Session с `WORFY_SESSION_KIND=assistant`, часть `product` —
  только в Product Session, а `orchestrator` — только в Session ни того, ни другого вида. Правила —
  `harness/hooks/rules/assistant.md`, `hooks.json` запускает часть на SessionStart.
- Почему здесь: тикет называет `harness/hooks/inject-rules.mjs` и `rules/product.md` местом правил по виду Session.
- Без него: Session Assistant-а получала бы правила Orchestrator-а — тикеты, gate, merge.
- Требование: [Готово, когда, пункт 2](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: `rules-hooks.test.sh` проверяет hook и `hooks.json`; contract test с настоящим Claude
  Code против локальной подставки Messages API показывает, что hook видит переменную окружения. Как модель следует
  правилам, test не проверяет.

## 4. Одна Session за раз, каждая — новая

Code: `src/main/assistant/session/runner.ts:79-83` · key lines: 80, 81

```ts
  wake(wake: AssistantWake, message?: string): Promise<AssistantRun> {
    const run = this.queue.then(() => this.run(wake, message))
    this.queue = run.catch(() => undefined)
    return run
  }
```

- Что делает: пробуждение ставится в очередь за предыдущим; каждое стартует новую Session с новым id и закрывает её
  после `result`. Упавшая Session не останавливает очередь.
- Почему здесь: тикет требует новую Session на каждое пробуждение; почему одну за раз — решение без владельца.
- Без него: два пробуждения подряд запустили бы две Session, которые читают и пишут одну память одновременно.
- Требование: [Готово, когда, пункт 4](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: длинная Session задерживает следующее пробуждение, предела времени Session нет — только
  предел ходов 40.

## 5. Один файл памяти, два писателя

Code: `src/main/assistant/duties/memory.ts:85-105` · key lines: 88, 103

```ts
export function memoryFileStore(file: string): MemoryStore {
  return {
    read: () => readJsonFile(file, assistantMemorySchema),
    write: (memory) => writeJsonFile(file, assistantMemorySchema, { ...withoutSessionPart(memory), ...sessionPartOf(readJsonFile(file, assistantMemorySchema)) }),
  }
}

/** The store of the Assistant's part of the memory file. */
export interface SessionMemoryStore {
  read(): SessionMemoryPart
  /** Writes `part` whole: a key it leaves out is dropped from the file. Throws when the file cannot be written. */
  write(part: SessionMemoryPart): void
}

/** The Assistant's part over `file`: a write keeps the duties' part as the file has it. */
export function sessionMemoryStore(file: string): SessionMemoryStore {
  return {
    read: () => sessionPartOf(readJsonFile(file, assistantMemorySchema)),
    write: (part) => writeJsonFile(file, assistantMemorySchema, { ...withoutSessionPart(readJsonFile(file, assistantMemorySchema) ?? EMPTY_MEMORY), ...sessionPartOf({ ...EMPTY_MEMORY, ...part }) }),
  }
}
```

- Что делает: обязанности (Ticket 07) и часть Assistant-а — предложения, обязательства, ответы пользователя — пишутся
  в один `memory.json`. Каждая запись читает файл и оставляет часть другого писателя как есть.
- Почему здесь: ADR-0114 называет память одним файлом состояния; файл `memory.json` завёл Ticket 07 и написал, что
  Ticket 10 может его перенести.
- Без него: `Duties` держит копию памяти и пишет её целиком — без этого он стирал бы новые предложения и
  обязательства старой копией.
- Требование: [Готово, когда, пункт 5](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: оба писателя синхронные в одном потоке main; запись из другого процесса test не
  проверяет — её нет.

## 6. pr-follow и autopilot-start — строки журнала Assistant-а, closed list — настоящий

Code: `src/main/mcp/app-server.ts:130-148` · key lines: 133, 146

```ts
export function journalTo(journal: ActionJournal, log: (message: string, error: unknown) => void = (message, error) => console.warn(message, error)): (entry: AssistantActionEntry) => void {
  return (entry) => {
    try {
      journal.append(actionJournalLineOf(entry))
    } catch (error) {
      log('[assistant] a line of the journal of actions could not be written', error)
    }
  }
}

/**
 * The closed list as `worfy-app` reaches it: the one `current` answers now (ticket 08's appClosedList()), or a refusal
 * while none runs — the Assistant is off.
 */
export function closedListOf(current: () => ClosedListSeam | null): ClosedListSeam {
  return {
    act: (request) => current()?.act(request) ?? { ok: false, reason: 'the closed list of actions is not running: the Assistant is off', line: {} },
  }
}
```

- Что делает: `journalTo` пишет действие `worfy-app` строкой журнала Ticket-а 08 — с пунктом ядра, его обязанностью,
  режимом и ответом функции main в поле `detail`. `closedListOf` отдаёт запрос `appClosedList()`, а пока список
  не запущен — отказ «Assistant is off». В приложении `appWorfyAppDeps` берёт оба.
- Почему здесь: пункт «Готово, когда» тикета называет `journal` в `appWorfyAppDeps`; бриф просит подключить
  стык закрытого списка к `appClosedList()` с проверкой на null.
- Без него: действия Assistant-а вне закрытого списка не попадали бы в журнал (граница 6), а действия закрытого
  списка через `worfy-app` всегда отказывались бы.
- Требование: [Готово, когда, пункт 7](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: contract test проверяет строку журнала на подставке журнала в памяти; файл журнала —
  тот же `actionJournalFile`, что у закрытого списка, его test-ы Ticket-а 08.

## 7. Решение о пробуждении и закрытый список, связанные с Session

Code: `src/main/assistant/session/runner.ts:145-160` · key lines: 150, 151, 152, 154, 156, 157

```ts
export function composeAssistant(parts: AssistantParts): Assistant | null {
  let loop: WakeLoop | null = null
  // The text of the user's message, for the wake the decision makes of it while userMessage runs.
  let said: string | undefined
  let lastRun: Promise<AssistantRun> | null = null
  const stopList = parts.startClosedList((itemId) => void loop?.escalate(itemId))
  loop = parts.startWake((wake) => {
    const message = wake.reason === 'user' ? said : undefined
    said = undefined
    lastRun = parts.sessions.wake(wake, message)
  })
  if (loop === null) {
    stopList?.()
    return null
  }
  const running = loop
```

- Что делает: пункт, с которым закрытый список не справился, идёт в `escalate` решения о пробуждении; каждое
  пробуждение стартует Session, а пробуждение по сообщению пользователя несёт его текст. Если ядро внимания не
  работает, закрытый список останавливается и ничего не остаётся запущенным.
- Почему здесь: Ticket-ы 06 и 08 записали, что их запускает Ticket 10.
- Без него: решение о пробуждении и закрытый список так и оставались бы незапущенными.
- Требование: [Готово, когда, пункт 4](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: test идёт на подставках цикла и списка; `startAssistant` в приложении никто не
  вызывает — включение Ticket-а 15.

## 8. Что сознательно не меняли

- `src/main/index.ts` не менялся: Assistant выключен (ADR-0114, решение 10), `startAssistant()` вызовет выключатель
  Ticket-а 15. С выключенным Assistant-ом ничего нового не работает и не тратит.
- `SESSION_KINDS` Session Node-ов не расширен: Session Assistant-а не стоит на Canvas.
- Fake агента для Session Assistant-а нет: под `WORFY_AGENT=fake` она не стартует; e2e — Ticket-ы 14–16.

## 9. Как проверено

- До реализации: `node scripts/vitest-electron.mjs test/unit/assistant-session-options.test.ts
  test/unit/assistant-session.test.ts test/contract/worfy-app-tools.test.ts` — exit 1, три файла не грузятся;
  `bash harness/hooks/tests/rules-hooks.test.sh` — exit 1.
- После: `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (934 файла, 21 071 test, после rebase на origin/main); `gate fast` — exit 0,
  `[gate] green (fast)`; `pnpm build` — exit 0.

## Проверить себя

1. Почему у Session Assistant-а нет Bash, даже если `disallowedTools` забудет какой-то новый tool записи?
   - Ответ: `tools: []` убирает все встроенные tools, `dontAsk` с разрешёнными только tools `worfy-app` и
     `canUseTool` отказывают остальным — `disallowedTools` только третий слой.
   - Строки: `src/main/vendors/claude/assistant-session.ts:90-96`
2. Что случилось бы с новым предложением, если бы `Duties` писал свою копию памяти без слияния?
   - Ответ: `Duties` пишет копию, прочитанную раньше; без слияния следующая запись обязанностей стёрла бы
     предложения, обязательства и ответы, записанные после неё.
   - Строки: `src/main/assistant/duties/memory.ts:88-88`
3. Откуда пробуждение по сообщению пользователя берёт его текст, если `WakeLoop.userMessage()` текста не принимает?
   - Ответ: `userMessage` запоминает текст в `said` до вызова цикла; цикл синхронно вызывает `onWake`, и тот
     забирает текст для пробуждения с причиной `user`.
   - Строки: `src/main/assistant/session/runner.ts:151-154`
