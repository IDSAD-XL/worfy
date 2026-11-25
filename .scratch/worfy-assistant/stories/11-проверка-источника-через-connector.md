# Code story — worfy-assistant 11: Проверка источника через connector claude.ai: одноразовый вызов Haiku 5.5 только с read tools одного connector-а

Kind: pr · Epic: worfy-assistant · Ticket: 11 · PR: - · Language: ru

## 1. Что было не так

Assistant должен читать Slack и Jira через connectors claude.ai, своих token-ов у worfy нет. Механизма такой проверки
не было: не было списка connectors без вызова модели, одноразового вызова Haiku 5.5 с tools одного connector-а,
проверки формы ответа и пути пунктов в ядро внимания. Spec требовал сначала выяснить, можно ли ограничить вызов одним
connector-ом и его read tools: с 634 tools у Haiku второй ход уже падал с «Prompt is too long» (ADR-0021).

- Требование: [Что строить](../issues/11-проверка-источника-через-connector.md#что-строить)

## 2. Один connector и только его read tools — в опциях вызова

Code: `src/main/vendors/claude/connector-check.ts:173-186` · key lines: 176, 177, 178, 179, 181

```ts
  return {
    cwd: input.cwd,
    model: CONNECTOR_CHECK_MODEL,
    settingSources: [],
    mcpServers: {},
    managedSettings: { allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverUrl: address }] },
    tools: [STRUCTURED_OUTPUT_TOOL],
    allowedTools: allowed,
    disallowedTools: [...ONE_SHOT_DISALLOWED_TOOLS, ...others],
    permissionMode: 'dontAsk',
    canUseTool,
    maxTurns: CONNECTOR_CHECK_MAX_TURNS,
    persistSession: false,
    systemPrompt: CONNECTOR_CHECK_SYSTEM_PROMPT,
```

- Что делает: без настроек пользователя и Project-а и без серверов worfy; policy tier пропускает только адрес этого
  connector-а; из встроенных tools — только structured answer; остальные tools connector-а убраны из контекста модели
  через `disallowedTools`, read tools разрешены под `dontAsk`.
- Почему здесь: Ticket называет narrator образцом изоляции, а `one-shot.ts` и `mcp-inventory.ts` — своими файлами.
  Запись `serverUrl` — форма, которой Session-ы пропускают connector с worfy-mcp-live 12 (`mcp-addresses.ts`).
  `strictMcpConfig` нет, потому что с `--strict-mcp-config` Claude Code не грузит connectors claude.ai вовсе (spike
  worfy-mcp-live 11, причина `restricted`).
- Без него: в вызов попали бы все серверы и plugin-ы пользователя, tools Claude Code и пишущие tools connector-а.
- Требование: [Готово, когда, пункт 3](../issues/11-проверка-источника-через-connector.md#готово-когда)
- Риски и пробелы test-ов: unit test читает опции как они уходят в SDK, но не запускает Claude Code. Что `serverUrl`
  пропускает настоящий connector — открытый ручной пункт worfy-mcp-live 12; здесь живого вызова нет.

## 3. Проверка до модели: сообщение держится, пока Claude Code не покажет один connector и его read tools

Code: `src/main/vendors/claude/connector-check.ts:300-311` · key lines: 305, 307, 308, 309, 310

```ts
export async function askConnector(start: ConnectorQueryStarter, spec: ConnectorCallSpec, text: string, timing: ConnectorTiming = CONNECTOR_TIMING): Promise<ConnectorCallEnd> {
  let release: (go: boolean) => void = () => undefined
  const released = new Promise<boolean>((done) => (release = done))
  let query: ConnectorQuery | null = null
  try {
    query = await start(spec, heldMessage(text, released))
    const asked = query
    const status = await settledStatus(() => asked.mcpServerStatus(), timing)
    const limit = limitOf(spec, status, await asked.getContextUsage({ detail: 'summary' }))
    if ('reason' in limit) return { kind: 'refused', reason: limit.reason }
    release(true)
    for await (const message of asked) {
```

- Что делает: Claude Code стартует с входом, который держит единственное сообщение. Сначала main спрашивает
  `mcpServerStatus()` и `getContextUsage({ detail: 'summary' })`. Сообщение уходит только если проверка не нашла
  причины отказа; иначе вход кончается без сообщения, и модель не вызвана.
- Почему здесь: первый шаг Ticket-а — можно ли ограничить вызов и сколько места займут tools. Опции отвечают «можно» по
  документации SDK; проверка до модели подтверждает это на каждом вызове и меряет token-ы tools, чьих схем
  `mcpServerStatus()` не отдаёт.
- Без него: ошибка в опциях или другая версия Claude Code молча отдали бы модели лишние tools, и это стоило бы вызова.
- Требование: [Готово, когда, пункт 1](../issues/11-проверка-источника-через-connector.md#готово-когда)
- Риски и пробелы test-ов: fake Claude Code в test-е отдаёт ответ только после сообщения; что настоящий
  `getContextUsage` отвечает до первого сообщения, не проверено вживую.

## 4. Причины отказа: чужой сервер, не read tool, Bash, потолок token-ов

Code: `src/main/vendors/claude/connector-check.ts:262-282` · key lines: 268, 275, 280, 281

```ts
function limitOf(spec: ConnectorCallSpec, status: unknown, usage: unknown): { reason: string } | { tokens: number } {
  const servers = Array.isArray(status) ? status.filter(isRecord) : []
  const own = servers.find((server) => server.name === spec.connector.name)
  if (own === undefined) return { reason: `Claude Code did not start ${spec.connector.name}` }
  if (own.status !== 'connected') return { reason: `${spec.connector.name} is ${String(own.status)}` }
  const others = servers.filter((server) => server !== own && server.status !== 'disabled' && server.status !== 'failed').map((server) => String(server.name))
  if (others.length > 0) return { reason: `Claude Code started ${others.join(', ')} next to ${spec.connector.name}` }
  if (!isRecord(usage) || !Array.isArray(usage.mcpTools)) return { reason: 'Claude Code did not say what the context holds' }
  const allowed = new Set(readToolsOf(spec.connector, spec.readTools).map((tool) => mcpToolName(spec.connector.name, tool)))
  let tokens = 0
  for (const tool of usage.mcpTools) {
    if (!isRecord(tool) || typeof tool.name !== 'string') return { reason: 'Claude Code did not say what the context holds' }
    const full = tool.name.startsWith('mcp__') ? tool.name : `mcp__${String(tool.serverName)}__${tool.name}`
    if (!allowed.has(full)) return { reason: `the context holds ${full}, which is not a read tool of ${spec.connector.name}` }
    tokens += typeof tool.tokens === 'number' ? tool.tokens : 0
  }
  const builtIns = Array.isArray(usage.systemTools) ? usage.systemTools.filter(isRecord).map((tool) => String(tool.name)) : []
  const denied = builtIns.filter((name) => DENIED_BUILT_INS.has(name))
  if (denied.length > 0) return { reason: `the context holds ${denied.join(', ')}` }
  if (tokens > CONNECTOR_TOOLS_MAX_TOKENS) return { reason: `the tools of ${spec.connector.name} take ${tokens} tokens, over ${CONNECTOR_TOOLS_MAX_TOKENS}` }
  return { tokens }
```

- Что делает: отказ, если connector не `connected`, рядом запущен другой сервер, в контексте tool не из read tools
  connector-а или встроенный tool, который пишет или ходит в сеть, или tools connector-а дороже
  `CONNECTOR_TOOLS_MAX_TOKENS` (20 000). Иначе отдаёт число token-ов tools.
- Почему здесь: spec, раздел о проверке источников: в вызове только read tools одного connector-а, ни tools Claude Code,
  ни `worfy-app`. Число 20 000 решено без владельца и записано в «Итог».
- Без него: проверка до модели знала бы только «стартовал ли connector», а не что видит модель.
- Требование: [Что строить, пункты 1 и 3](../issues/11-проверка-источника-через-connector.md#что-строить)
- Риски и пробелы test-ов: имя tool-а `mcp__claude_ai_Slack__…` взято из функции нормализации Claude Code 2.1.322; при
  другой нормализации проверка откажет каждому вызову, а не пропустит лишнее.

## 5. Форма ответа проверяется в main, по одному пункту

Code: `src/shared/assistant/source-items.ts:62-75` · key lines: 64, 69, 70

```ts
export function sourceItemsOf(answer: unknown, source: string): SourceItemsCheck | null {
  const envelope = envelopeSchema.safeParse(answer)
  if (!envelope.success) return null
  const check: SourceItemsCheck = { items: [], refused: [] }
  envelope.data.items.forEach((entry, index) => {
    const number = index + 1
    if (index >= SOURCE_ITEMS_MAX) return void check.refused.push(`item ${number} is past the ${SOURCE_ITEMS_MAX} an answer may carry`)
    const item = sourceItemSchema.safeParse(entry)
    if (!item.success) return void check.refused.push(`item ${number} fails the form: ${fieldsOf(item.error)}`)
    if (item.data.source !== source) return void check.refused.push(`item ${number} names another source than ${source}`)
    check.items.push(item.data)
  })
  return check
}
```

- Что делает: ответ вне конверта `{ items }` не даёт ни одного пункта. Внутри каждый пункт проверяется отдельно:
  неверная форма, ссылка не https, время без смещения или чужой источник — пункт отказан, строка называет номер и
  поля, без текста источника.
- Почему здесь: «Что строить», пункт 5: main проверяет форму, ответ, не прошедший проверку, пунктом не становится и
  пишется в журнал. Что один плохой пункт не губит остальные — решено без владельца.
- Без него: текст модели, прочитавшей чужие сообщения, шёл бы в пункты как есть, вместе с `javascript:`-ссылкой.
- Требование: [Готово, когда, пункт 4](../issues/11-проверка-источника-через-connector.md#готово-когда)
- Риски и пробелы test-ов: ответы — записанные fixture-ы, придуманные по форме SDK; настоящего ответа Haiku 5.5 нет.

## 6. Проверка как `CheckRun` планировщика: connector, вызов, расход, пункты

Code: `src/main/assistant/sources/connector-check.ts:82-98` · key lines: 85, 86, 90, 91, 92, 94, 97

```ts
  return async ({ since, now }) => {
    const connectors = (await deps.listConnectors()).filter((each) => recipe.isConnector(each.name))
    const connector = connectors.find((each) => each.status === 'connected') ?? connectors[0]
    if (connector === undefined) return fail('the user has no claude.ai connector for it')
    if (connector.status !== 'connected') return fail(`its connector is ${connector.status}: it waits in claude.ai`)
    const readTools = readToolsOf(connector, recipe.readTools)
    if (readTools.length === 0) return fail('its connector has no read tool the recipe names')
    const projects = deps.projects()
    const end = await deps.ask({ connector, readTools, outputSchema: sourceAnswerJsonSchema() }, messageOf(recipe, since ?? now - FIRST_CHECK_LOOKBACK_MS, now, projects))
    if (end.kind === 'refused') return fail(`the call was refused before the model: ${end.reason}`)
    deps.ledger.noteCall({ kind: 'source-check', source: recipe.kind, wakeId: null, model: end.model, usage: end.usage, costUsd: end.costUsd })
    if (end.kind === 'no-answer') return fail(`the call gave no answer (${end.detail})`)
    const check = sourceItemsOf(end.structured, recipe.kind)
    if (check === null) return fail('the answer is not in the form of items')
    for (const refused of check.refused) deps.log(`[assistant] the ${recipe.kind} check: ${refused}`)
    for (const item of check.items) deps.core.ingest(sourceEventOf(item, recipe.kind, projects))
  }
```

- Что делает: находит connector источника, отказывает без вызова, если его нет или он ждёт входа в claude.ai. Вызов,
  дошедший до модели, пишет `noteCall` в журнал расхода Ticket-а 05, и когда ответа не было. Пункты идут в ядро
  внимания событиями источника `slack` или `jira` с автором, ссылкой и полями сообщения.
- Почему здесь: бриф велит регистрироваться в планировщике Ticket-а 04 и писать в журнал Ticket-а 05, не повторяя их;
  «Что строить», пункт 6, — пункты в ядро внимания. Неудача бросает исключение, чтобы планировщик оставил `since` на
  прошлом успехе.
- Без него: рецепты Ticket-ов 12 и 13 некуда было бы подключить.
- Требование: [Что строить, пункт 6](../issues/11-проверка-источника-через-connector.md#что-строить)
- Риски и пробелы test-ов: `appSourceCheck` (сборка из частей приложения) не покрыт test-ом; его регистрирует рецепт
  Ticket-а 12.

## 7. Что сознательно не меняли

- `src/main/index.ts` не трогали: регистрацию делает рецепт (Ticket-ы 12 и 13), с ним появится и поведение для
  пользователя. Поэтому страница в `docs/features` не правилась.
- Своих token-ов Slack и Jira нет, recipe-ов нет — это Ticket-ы 12 и 13.

## 8. Как проверено

- `node scripts/vitest-electron.mjs test/unit/connector-check-options.test.ts test/unit/assistant-source-check.test.ts` —
  exit 1 до правки (модулей нет), exit 0 после.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (весь набор); `gate fast` — exit 0.

## Проверить себя

1. Почему вызов не ставит `strictMcpConfig`, как narrator?
   - Ответ: с ним Claude Code не грузит ни одного connector-а claude.ai; один connector оставляет запись `serverUrl` в
     policy tier.
   - Строки: `src/main/vendors/claude/connector-check.ts:176-178`
2. Что тратится, если Claude Code запустил рядом с connector-ом чужой сервер?
   - Ответ: ничего: проверка отказывает до сообщения, модель не вызвана, `noteCall` не пишется.
   - Строки: `src/main/vendors/claude/connector-check.ts:307-309`, `src/main/assistant/sources/connector-check.ts:90-92`
3. Почему ответ вне формы роняет проверку, а плохой пункт — нет?
   - Ответ: без конверта нет ни одного пункта, и следующая проверка должна покрыть то же время; плохой пункт
     отказан один, остальные пункты идут в ядро.
   - Строки: `src/main/assistant/sources/connector-check.ts:94-97`, `src/shared/assistant/source-items.ts:62-72`
