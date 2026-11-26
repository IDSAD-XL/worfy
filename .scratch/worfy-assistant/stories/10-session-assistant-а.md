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

Code: `src/main/vendors/claude/assistant-session.ts:79-100` · key lines: 83, 86, 87, 89, 90, 91, 92, 94

```ts
export function assistantSessionOptions(input: AssistantSessionOptionsInput): Options {
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
    managedSettings: { allowManagedMcpServersOnly: true, allowedMcpServers: [] },
    allowedTools: [...ALLOWED_TOOLS],
    disallowedTools: [...ONE_SHOT_DISALLOWED_TOOLS],
    permissionMode: 'dontAsk',
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
  claude.ai. Разрешены ровно tools `worfy-app` (`allowedTools`) под `dontAsk`, который отказывает остальным без
  вопроса. `canUseTool` нет: под `dontAsk` Claude Code его не вызывает. Нет и `allowManagedPermissionRulesOnly`: с ним
  Claude Code не читает `allowedTools`, и `dontAsk` отказывал каждому tool-у `worfy-app` (нашло ревью, раунд 1). Модель —
  `opus`. Id Session — новый, без `resume` и без транскрипта.
- Почему здесь: тикет называет образцом Session черновика профиля и одноразовый вызов (`one-shot.ts`); отдельный
  файл драйвера Claude — как `connector-check.ts` Ticket-а 11, чистая функция, которую unit test читает целиком.
  Почему `opus` и почему без транскрипта — решения без владельца, записаны в «Итог».
- Без него: у Session были бы Bash, запись файлов и сеть (граница 1), грузились бы `CLAUDE.md` и hooks Project-а, а
  connectors claude.ai заняли бы контекст.
- Требование: [Готово, когда, пункты 1, 3, 4 и 6](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: unit test проверяет options, которые уходят в SDK. Contract test
  `test/contract/assistant-session-claude.test.ts` запускает с ними настоящий Claude Code против локальной подставки
  Messages API: вызов `memory_note` доходит до обработчика и пишет память, вызов Bash отклонён, и его команда не
  выполнилась. Модели нет: как настоящая модель пользуется tools, test не проверяет.

## 3. Harness печатает Session-у Assistant-а свои правила

Code: `harness/hooks/inject-rules.mjs:59-65` · key lines: 61, 62, 63

```js
function forThisSession(part) {
    const kind = process.env[KIND_VARIABLE]
    if (KINDS.includes(part)) return kind === part
    if (part === "orchestrator") return !KINDS.includes(kind)
    if (part === "common") return kind !== "assistant"
    return true
}
```

- Что делает: часть `assistant` печатается только в Session с `WORFY_SESSION_KIND=assistant`, часть `product` —
  только в Product Session, а `orchestrator` — только в Session ни того, ни другого вида. Часть `common` Session
  Assistant-а не получает: около 7k символов правил отчётов, test-ов и gate, которые Session без своих tools не
  применяет, а платила бы за них на каждом пробуждении. Правила —
  `harness/hooks/rules/assistant.md`, `hooks.json` запускает часть на SessionStart.
- Почему здесь: тикет называет `harness/hooks/inject-rules.mjs` и `rules/product.md` местом правил по виду Session.
- Без него: Session Assistant-а получала бы правила Orchestrator-а — тикеты, gate, merge.
- Требование: [Готово, когда, пункт 2](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: `rules-hooks.test.sh` проверяет hook и `hooks.json`; contract test с настоящим Claude
  Code против локальной подставки Messages API показывает, что hook видит переменную окружения. Как модель следует
  правилам, test не проверяет.

## 4. Одна Session за раз, каждая — новая

Code: `src/main/assistant/session/runner.ts:103-113` · key lines: 104, 105, 111, 112

```ts
  wake(wake: AssistantWake, message?: string): Promise<AssistantRun> {
    const run = this.queue.then(() => this.run(wake, message))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Closes the running Session; the wakes queued behind it, and any after, start nothing and end `stopped`. */
  stop(): void {
    this.stopped = true
    this.current?.close()
  }
```

- Что делает: пробуждение ставится в очередь за предыдущим; каждое стартует новую Session с новым id и закрывает её
  после `result`. Упавшая Session не останавливает очередь. `stop()` закрывает идущую Session, а пробуждения в
  очереди и после него ничего не запускают и кончаются `stopped`.
- Почему здесь: тикет требует новую Session на каждое пробуждение; почему одну за раз — решение без владельца.
- Без него: два пробуждения подряд запустили бы две Session, которые читают и пишут одну память одновременно; без
  `stop()` идущая Session и очередь пробуждений запускали бы Session opus после того, как пользователь выключил
  Assistant-а (ADR-0114, решение 10).
- Требование: [Готово, когда, пункт 4](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: длинная Session задерживает следующее пробуждение до своего предела времени — 15 минут
  (раздел 8). Что `close()` настоящего SDK кончает поток сообщений, test показывает на подставке query, не на SDK.

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

Code: `src/main/assistant/session/runner.ts:192-207` · key lines: 197, 198, 199, 201, 203, 204

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
  вызывает — включение Ticket-а 15. `stop` останавливает и Session (`parts.sessions.stop()`).

## 8. Предел времени Session

Code: `src/main/assistant/session/runner.ts:129-137` · key lines: 129, 131, 134, 137

```ts
    this.current = query
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      log(`[assistant] the Session of wake ${wake.id} ran past its time limit and is closed`)
      query.close()
    }, this.options.timeLimitMs ?? ASSISTANT_SESSION_TIME_LIMIT_MS)
    // Closed, not by its result: by stop() or the time limit.
    const cut = (): AssistantRun['outcome'] | null => (this.stopped ? 'stopped' : timedOut ? 'timed-out' : null)
```

- Что делает: Session дольше `ASSISTANT_SESSION_TIME_LIMIT_MS` (15 минут) закрывается и кончается `timed-out`;
  `stop()` и предел времени отличаются от поломки по флагам, а не по ошибке, которую бросил закрытый query.
  Расход такой Session — `noteCall` с нулевым `usage`, как у сломавшейся.
- Почему здесь: Session идут по одной, и зависшая держала бы всю очередь. `action_run autopilot-start` ждёт диалог
  пользователя до 10 минут (`chat-confirm.ts`), а пользователя обычно нет; 15 минут — решение без владельца.
- Без него: зависшая Session держала бы очередь пробуждений без конца, предел ходов 40 этого не ловит.
- Требование: [Готово, когда, пункт 4](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: test ставит предел 20 мс на подставке query; 15 минут — значение без замера.

## 9. Память в первом сообщении — данные, и не больше 32 000 символов

Code: `src/main/assistant/session/memory.ts:158-169` · key lines: 160, 161, 163, 166

```ts
  for (const entry of entries) {
    // One more element of a JSON array: its text and a comma.
    const cost = JSON.stringify(entry.value).length + 1
    full = full || size + cost > maxChars
    if (full) {
      leftOut[entry.list] += 1
      continue
    }
    ;(memory[entry.list] as unknown[]).push(entry.value)
    size += cost
  }
  return { memory, leftOut }
```

- Что делает: `memoryForPrompt` кладёт каждый текст памяти в объект `outside-text` с источником `assistant-memory` —
  так же `worfy-app` отдаёт чужой текст. Обязанности и правила идут всегда; предложения, обязательства и ответы — от
  новых к старым, пока память не превысит `MEMORY_PROMPT_MAX_CHARS`; на первой записи, что не влезла, заполнение
  кончается. `wakePrompt` называет, сколько старых записей не вошло, и что они остаются в файле.
- Почему здесь: `memory_note` может унести в память текст, который Session прочла в чужом комментарии, и в первом
  сообщении следующей Session он читался бы как её собственная память. Полная память — около 55k tokens opus на
  каждое пробуждение. `assistant.md` говорит, что запись памяти — заметка, а не указание.
- Без него: указание из чужого текста, записанное в память, стало бы частью первого сообщения; каждое пробуждение
  стоило бы десятки тысяч tokens.
- Требование: [Готово, когда, пункт 5](../issues/10-session-assistant-а.md#готово-когда)
- Риски и пробелы test-ов: рамка — защита по договорённости, как у остального чужого текста: test показывает, что
  заметка с указанием приходит объектом `outside-text`, а не что модель её не выполнит. Для обязательств и ответов,
  не вошедших в сообщение, tool-а чтения нет.

## 10. Что сознательно не меняли

- `src/main/index.ts` не менялся: Assistant выключен (ADR-0114, решение 10), `startAssistant()` вызовет выключатель
  Ticket-а 15. С выключенным Assistant-ом ничего нового не работает и не тратит.
- `SESSION_KINDS` Session Node-ов не расширен: Session Assistant-а не стоит на Canvas.
- Fake агента для Session Assistant-а нет: под `WORFY_AGENT=fake` она не стартует; e2e — Ticket-ы 14–16.

## 11. Как проверено

- До реализации: `node scripts/vitest-electron.mjs test/unit/assistant-session-options.test.ts
  test/unit/assistant-session.test.ts test/contract/worfy-app-tools.test.ts` — exit 1, три файла не грузятся;
  `bash harness/hooks/tests/rules-hooks.test.sh` — exit 1.
- После: `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (934 файла, 21 071 test, после rebase на origin/main); `gate fast` — exit 0,
  `[gate] green (fast)`; `pnpm build` — exit 0.
- Ревью, раунд 1, до правки: `node scripts/vitest-electron.mjs test/contract/assistant-session-claude.test.ts
  test/unit/assistant-session-options.test.ts` — exit 1 (настоящий Claude Code: «Permission to use
  mcp__worfy-app__memory_note has been denied because Claude Code is running in don't ask mode»);
  `test/unit/assistant-session.test.ts` — exit 1 (нет `stop`, предела времени и `memoryForPrompt`);
  `rules-hooks.test.sh` — exit 1 (Session Assistant-а получала `common`).
- После правки: те же — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (935 файлов, 21 080 test-ов);
  `gate fast` — exit 0, `[gate] green (fast)`.

## Проверить себя

1. Почему у Session Assistant-а нет Bash, даже если `disallowedTools` забудет какой-то новый tool записи?
   - Ответ: `tools: []` убирает все встроенные tools, а `dontAsk` отказывает каждому tool-у, которого нет в
     `allowedTools` (там только tools `worfy-app`), — `disallowedTools` только третий слой.
   - Строки: `src/main/vendors/claude/assistant-session.ts:89-94`
2. Что случилось бы с новым предложением, если бы `Duties` писал свою копию памяти без слияния?
   - Ответ: `Duties` пишет копию, прочитанную раньше; без слияния следующая запись обязанностей стёрла бы
     предложения, обязательства и ответы, записанные после неё.
   - Строки: `src/main/assistant/duties/memory.ts:88-88`
3. Откуда пробуждение по сообщению пользователя берёт его текст, если `WakeLoop.userMessage()` текста не принимает?
   - Ответ: `userMessage` запоминает текст в `said` до вызова цикла; цикл синхронно вызывает `onWake`, и тот
     забирает текст для пробуждения с причиной `user`.
   - Строки: `src/main/assistant/session/runner.ts:198-201`
