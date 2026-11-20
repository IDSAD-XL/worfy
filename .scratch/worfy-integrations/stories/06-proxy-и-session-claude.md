# Code story — worfy-integrations 06: Proxy и Session Claude: `@modelcontextprotocol/sdk` прямой зависимостью, `McpServer` с JSON Schema сервиса, одно соединение на Integration, фильтр tools, «Sign-in needed», SDK-серверы в `mcpServers`

Kind: pr · Epic: worfy-integrations · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

После Ticket-ов 03 и 04 Integration хранилась на Machine, включалась в Project и умела проверить свой token, но ни одна
Session её не получала: не было proxy, который держит соединение с сервисом, и пути, которым его tools попадают в
Claude Code. Свои серверы worfy отдаёт Claude Code через `createSdkMcpServer`, а он принимает только zod shape — tools
сервиса приходят готовой JSON Schema.

- Требование: [Что происходит](../issues/06-proxy-и-session-claude.md#что-происходит)

## 2. Второй вид входа tool-а — JSON Schema сервиса

Code: `src/main/vendors/mcp.ts:93-99` · key lines: 93, 97, 98

```ts
export type McpTool = McpToolCommon & ({ readonly shape: z.ZodRawShape; readonly inputSchema?: undefined } | { readonly inputSchema: McpJsonSchema; readonly shape?: undefined })

/** The input schema the agent sees for `tool`: the service's own, or its zod shape as JSON Schema. */
export function mcpInputSchema(tool: McpTool): Record<string, unknown> {
  if (tool.inputSchema !== undefined) return tool.inputSchema
  return z.toJSONSchema(z.object(tool.shape), { io: 'input', unrepresentable: 'any' })
}
```

- Что делает: tool сервера worfy описан либо zod shape (свои tools worfy), либо готовой JSON Schema (tools Integration-ы);
  `mcpInputSchema` даёт агенту схему в обоих случаях. Рядом `McpServer` получил `listTools()` — tools, которые спрашивают,
  когда агент их перечисляет.
- Почему здесь: Ticket, «Что делаем», пункт 2, называет `McpTool` в `src/main/vendors/mcp.ts`.
- Без него: tool сервиса пришлось бы переводить в zod, и схема сервиса дошла бы до модели искажённой.
- Требование: [Что делаем, пункт 2](../issues/06-proxy-и-session-claude.md#что-делаем)
- Риски и пробелы test-ов: endpoint Codex (`src/main/mcp/http-server.ts`) берёт схему через `mcpInputSchema`, но
  Integration-ы туда ещё не идут — это Ticket 07.

## 3. SDK-сервер Claude на низкоуровневом `Server`

Code: `src/main/vendors/claude/mcp.ts:273-286` · key lines: 275, 277, 280, 281, 283

```ts
async function lowLevelServer(server: McpServer): Promise<ClaudeMcpServer> {
  const [{ Server }, { CallToolRequestSchema, ListToolsRequestSchema }] = await Promise.all([import('@modelcontextprotocol/sdk/server/index.js'), import('@modelcontextprotocol/sdk/types.js')])
  const instance = new Server({ name: server.name, version: server.version }, { capabilities: { tools: {} } })
  const tools = (): Promise<readonly McpTool[]> => (server.listTools === undefined ? Promise.resolve(server.tools) : server.listTools())
  instance.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await tools()).map(listedTool) }))
  instance.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name
    const tool = (await tools()).find((each) => each.name === name)
    if (tool === undefined) return { content: [{ type: 'text', text: `No tool ${name} on ${server.name}` }], isError: true }
    // The answer goes on as the tool gave it: a service's blocks are MCP's own (the proxy passes them through).
    return (await tool.call(request.params.arguments ?? {}, { signal: extra.signal })) as CallToolResult
  })
  return { type: 'sdk', name: server.name, instance }
}
```

- Что делает: сервер с `listTools()` или со схемами сервиса — `Server` пакета MCP SDK в процессе worfy: `tools/list`
  отвечает списком proxy, `tools/call` идёт к tool-у этого списка с отменой агента; имени нет в списке — отказ `isError`.
  Свои серверы worfy остаются на `createSdkMcpServer`.
- Почему здесь: Ticket, «Что делаем», пункт 2; spike 01 (3.1) проверил, что такой `Server` годится как `instance`
  SDK-сервера Claude Code.
- Без него: tools сервиса не дошли бы до Claude Code вовсе.
- Требование: [Что делаем, пункт 2](../issues/06-proxy-и-session-claude.md#что-делаем)
- Риски и пробелы test-ов: contract проверяет этот сервер MCP-клиентом через in-memory transport, как его видел бы
  Claude Code; настоящий Claude Code с ним в test-ах не говорит.

## 4. Session-сервер proxy: фильтр, метка, длинные имена

Code: `src/main/integrations/proxy.ts:272-289` · key lines: 276, 277, 278, 281, 284, 287

```ts
    const list = async (): Promise<readonly McpTool[]> => {
      const integration = this.store.get(entry.id)
      if (integration === undefined) throw new Error(`${label} is no longer on this Machine: restart the Session without it.`)
      label = integration.label
      const all = await this.serviceTools(entry.id, label)
      const shown = filterTools(all, entry.tools)
      const hidden = shown.filter((tool) => !toolNameFits(entry.name, tool.name)).map((tool) => tool.name)
      this.setStatus(entry.id, { hidden })
      return shown
        .filter((tool) => toolNameFits(entry.name, tool.name))
        .map((tool): McpTool => ({
          name: tool.name,
          description: `[${label}] ${tool.description ?? ''}`.trimEnd(),
          inputSchema: { ...tool.inputSchema, type: 'object' } as McpJsonSchema,
          ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
          call: (args, extra) => this.callTool(entry.id, label, tool.name, args, extra?.signal),
        }))
    }
```

- Что делает: список tools сервиса на одну Session (спрашивается один раз и держится), урезанный фильтром Project-а
  (`all`, `read-only` по `readOnlyHint`, список имён); tool с полным именем длиннее 128 символов выпадает и попадает в
  статус (`hidden`); описание каждого начинается с метки. Вызов идёт только к tool-у этого списка — отфильтрованный tool
  отказывает до сервиса (шаг 3).
- Почему здесь: Ticket, «Что делаем», пункт 4; spike 01: `disallowedTools` MCP-tool из списка модели не убирает (3.3),
  имя длиннее 128 Claude Code выбрасывает молча (3.5). Метка в начале описания, а не в конце — «Итог», решение 1.
- Без него: модель видела бы все tools сервиса при Read only, а два аккаунта одного сервиса нельзя было бы различить.
- Требование: [Что делаем, пункт 4](../issues/06-proxy-и-session-claude.md#что-делаем)
- Риски и пробелы test-ов: у сервиса без `readOnlyHint` фильтр `read-only` даёт пустой список — экран (Ticket 08)
  должен это объяснить.

## 5. Одно соединение и разбор отказов

Code: `src/main/integrations/proxy.ts:366-384` · key lines: 371, 375, 376, 377, 378, 379

```ts
  private async withConnection<T>(id: string, work: (live: Live) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; failure: Failure }> {
    for (let attempt = 0; ; attempt++) {
      let live: Live | null = null
      let secrets: string[] = []
      try {
        live = await this.connection(id)
        secrets = live.secrets
        return { ok: true, value: await work(live) }
      } catch (error) {
        const failure = await this.failureOf(error, secrets.length > 0 ? secrets : this.secretsOf(id))
        if (failure.kind !== 'service') await this.drop(id, live)
        if (failure.kind === 'expired' && attempt === 0) continue
        if (failure.kind === 'sign-in') this.setStatus(id, { status: { state: 'needs-sign-in' } })
        if (failure.kind === 'connection') this.setStatus(id, { status: { state: 'error', message: failure.message } })
        if (failure.kind !== 'service') console.warn(`[integrations] ${id}: ${failure.kind === 'connection' ? 'the connection failed' : failure.kind === 'sign-in' ? 'sign-in needed' : failure.kind}`)
        return { ok: false, failure }
      }
    }
  }
```

- Что делает: каждый вызов любой Session идёт через одно соединение Integration-ы (`connection` открывает новое, только
  если его нет или сменились секреты). 401, не сохранённый token и `UnauthorizedError` OAuth — статус `needs-sign-in`, а
  вызов tool-а отвечает «Sign-in needed: <метка>. Ask the user to sign in in worfy.»; 404 (сервис забыл session) —
  соединение открывается заново один раз; прочий сбой соединения — статус `error` с текстом без секретов. Строка лога —
  id и вид сбоя, без текста.
- Почему здесь: Ticket, «Что делаем», пункты 3 и 4; spec, «Решения по реализации» → Proxy.
- Без него: каждая Session открывала бы своё соединение, а отказ входа был бы для агента молчанием.
- Требование: [Что делаем, пункт 3](../issues/06-proxy-и-session-claude.md#что-делаем)
- Риски и пробелы test-ов: OAuth-ветки (`UnauthorizedError`, единственный refresh в `fetch` transport-а) здесь только
  место — их проверит Ticket 05.

## 6. Stdio-сервер: секрет в окружении, stderr не читается

Code: `src/main/integrations/proxy.ts:426-445` · key lines: 434, 435, 436, 439, 440, 442

```ts
  private async open(id: string): Promise<Live> {
    const integration = this.store.get(id)
    if (integration === undefined) throw new IntegrationGone()
    const sdk = await this.loadSdk()
    const secrets = this.secretsOf(id)
    const fingerprint = JSON.stringify(secrets)
    const client = new sdk.Client({ name: 'worfy', version: '1.0.0' }, { capabilities: {} })
    if (integration.transport.kind === 'http') {
      const headers = connectionHeaders(this.store, id)
      const oauth = this.options.oauth?.(integration)
      const transport = new sdk.StreamableHTTPClientTransport(new URL(integration.transport.url), { requestInit: { headers }, ...oauth })
      await client.connect(transport)
    } else {
      const launch = stdioLaunch(integration, (part) => this.store.secret(id, part))
      const base = this.options.baseEnv === undefined ? await defaultBaseEnv(sdk) : await this.options.baseEnv()
      // stderr is not read: a server may print what it was started with.
      const transport = new sdk.StdioClientTransport({ command: launch.command, args: launch.args, env: { ...base, ...launch.env }, stderr: 'ignore' })
      await client.connect(transport)
    }
    const live: Live = { client, secrets, fingerprint }
```

- Что делает: http — заголовки входа Ticket-а 04 читаются при каждом открытии соединения, место OAuth (`authProvider`,
  `fetch`) пустое до Ticket-а 05. Stdio — процесс запускает сам worfy через `StdioClientTransport` пакета (`cross-spawn`:
  `.cmd` на Windows), секреты — в `env`, аргументы — как дал пользователь; базовое окружение — короткий безопасный список
  пакета с PATH окружения агента.
- Почему здесь: Ticket, «Что делаем», пункт 3; ADR-0111, пункт 1 — token сервиса не попадает в аргументы процесса.
- Без него: секрет stdio-сервера мог бы оказаться в `args` и в `ps`.
- Требование: [Что делаем, пункт 3](../issues/06-proxy-и-session-claude.md#что-делаем)
- Риски и пробелы test-ов: запуск `.cmd` на Windows проверит только job-ы Windows CI (платформенный Ticket).

## 7. Имя сервера в Session

Code: `src/main/integrations/proxy.ts:85-101` · key lines: 89, 92, 94, 96, 99

```ts
export function integrationServerNames(integrations: readonly { id: string; label: string }[], taken: readonly string[]): IntegrationServerName[] {
  const claude = new Set(taken.map((name) => name.toLowerCase()))
  const used = new Set<string>()
  return integrations.map(({ id, label }) => {
    const slug = serverNameSlug(label)
    const clash = (name: string): string | null => (used.has(name) ? 'another Integration of this Project' : claude.has(name) ? 'a server of Claude Code' : null)
    // A slug under worfy's prefix gets a suffix too: worfy-canvas-2 is not worfy's, and never shadows a server of it.
    const first = slug.startsWith(WORFY_PREFIX) ? "worfy's own servers (worfy-…)" : clash(slug)
    let name = slug
    for (let n = 2; first !== null && (name === slug || clash(name) !== null); n++) {
      const suffix = `-${n}`
      name = `${cut(slug, SERVER_NAME_MAX - suffix.length)}${suffix}`
    }
    used.add(name)
    return { id, name, warning: first === null ? null : `The name ${slug} is taken by ${first}: this Integration's server is ${name}.` }
  })
}
```

- Что делает: slug метки (латиница, цифры, `-`, до 24 символов); совпадение с другой Integration-ой Project-а, с сервером
  Claude Code из последнего ответа инвентаря или префикс `worfy-` — суффикс `-2`, `-3`… в тех же 24 символах и
  предупреждение для строки.
- Почему здесь: Ticket, «Что делаем», пункт 6; предел 24 — spike 01 (3.5): `mcp__` + 24 + `__` оставляют tool-у 97
  символов.
- Без него: Integration могла бы занять имя сервера пользователя или `worfy-canvas`.
- Требование: [Что делаем, пункт 6](../issues/06-proxy-и-session-claude.md#что-делаем)
- Риски и пробелы test-ов: первая Session после запуска worfy стартует раньше первого ответа инвентаря, и совпадение с
  сервером Claude Code тогда не видно — «Итог», решение 7.

## 8. Session Claude получает Integration-ы рядом с `worfy-canvas`

Code: `src/main/vendors/claude/options.ts:851-856` · key lines: 854, 855

```ts
  }
  // An Integration is not on the Profile's list and the policy tier does not cut an SDK server (the spike of
  // worfy-integrations ticket 01, 3.2): only a Turn off for this Session leaves it out.
  for (const integration of input.integrations ?? []) {
    if (!off.includes(integration.name)) servers[integration.name] = sdkServerConfig(integration.server)
  }
```

- Что делает: включённые Integration-ы Project-а (`sdkQueryFactory` находит их через настройки Project-а и хранилище
  Machine, неизвестный id пропускает, Session без человека получает только «Available to Autopilot») идут в
  `mcpServers` SDK-серверами; список Profile-я и `managedSettings` их не называют; Turn off for this Session — Restart
  без неё.
- Почему здесь: Ticket, «Что делаем», пункт 7; ADR-0111, пункт 10.
- Без него: Integration была бы настроена, но агент её не видел бы.
- Требование: [Что делаем, пункт 7](../issues/06-proxy-и-session-claude.md#что-делаем)
- Риски и пробелы test-ов: Session Codex Integration-ы не получает — Ticket 07.

## 9. Строка Integration-ы в chip-е «MCP n/m»

Code: `src/main/vendors/claude/mcp.ts:99-104` · key lines: 102, 103

```ts

/** `row` as an Integration's when `labels` names it; an Integration is never one of worfy's own servers. */
function withLabel(row: McpServerRow, labels: ReadonlyMap<string, string> | undefined): McpServerRow {
  const label = labels?.get(row.name)
  return label === undefined ? row : { ...row, source: 'integration', sourceWord: null, label }
}
```

- Что делает: Claude Code сообщает Integration как сервер `sdk`; строка получает источник `integration` и метку по тому,
  что сказал старт этой Session (`labelIntegrations`, ключ — query), и, подключённая, — Turn off.
- Почему здесь: Ticket, «Что делаем», пункт 8, называет `src/shared/agent/mcp-status.ts`; почему метки хранятся по
  query, а не в `session.ts`, — «Итог», решение 8.
- Без него: Integration в chip-е выглядела бы своим сервером worfy под slug-ом.
- Требование: [Что делаем, пункт 8](../issues/06-proxy-и-session-claude.md#что-делаем)
- Риски и пробелы test-ов: действие Sign in у строки — Ticket 09.

## 10. Что сознательно не меняли

- Proxy передаёт только tools: `resources`, `prompts`, elicitation, sampling — вне Epic-а («Решено без владельца», 4
  spec-а).
- Статус proxy (`signed-in` / `needs-sign-in` / `error`, число и размер tools, скрытые tools) живёт в памяти main;
  каналом его покажет Ticket 08.
- `session.ts` и `QueryRequest` не менялись.

## 11. Как проверено

- До правки: `pnpm test test/unit/integration-server-name.test.ts test/unit/mcp-status-row.test.ts
  test/contract/integrations-proxy.test.ts test/contract/integrations-claude-session.test.ts` — exit 1 (модуля
  `proxy.ts` нет, `labelIntegrations` нет, источников четыре). После — exit 0.
- Все unit и contract test-ы затронутых модулей (38 файлов) — exit 0; `test/e2e/session-mcp.spec.ts` под замком — exit 0.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0.

## Проверить себя

1. Почему фильтр Read only режет `tools/list` proxy, а не `disallowedTools` Claude Code?
   - Ответ: `disallowedTools` MCP-tool из списка модели не убирает, только запрещает вызов (spike 01, 3.3); список
     proxy убирает tool из того, что видит модель, а вызов не из списка отказывает до сервиса.
   - Строки: `src/main/integrations/proxy.ts:277`
2. Что получает Session, когда сервис ответил 401 посреди её работы?
   - Ответ: ответ tool-а `isError` «Sign-in needed: <метка>…», статус Integration-ы `needs-sign-in`, соединение
     закрыто, чтобы следующий вызов вошёл с новым token-ом.
   - Строки: `src/main/integrations/proxy.ts:376-378`
3. Почему token сервиса не виден в `ps` процесса Claude Code?
   - Ответ: Integration — SDK-сервер в процессе worfy, не запись `http` с заголовками: `--mcp-config` её не несёт, а
     заголовки и секреты stdio живут только в main.
   - Строки: `src/main/vendors/claude/options.ts:855`
