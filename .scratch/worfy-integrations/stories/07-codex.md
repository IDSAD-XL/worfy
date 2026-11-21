# Code story — worfy-integrations 07: Codex: Integration-ы через endpoint worfy на `127.0.0.1` ключами `mcp_servers.<имя>`, строки Codex в chip-е

Kind: pr · Epic: worfy-integrations · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 06 Integration-ы Project-а получала только Session Claude: proxy (`src/main/integrations/proxy.ts`) отдаёт
сервер с `listTools()`, а Codex получает серверы worfy только через endpoint `src/main/mcp/http-server.ts`, который
знал лишь свои tools worfy (`server.tools`). Session Codex Integration-ов не видела, а строки chip-а «MCP n/m» у Codex
их не отличали бы от серверов worfy.

- Требование: [Что происходит](../issues/07-codex.md#что-происходит)

## 2. Endpoint отдаёт tools proxy

Code: `src/main/mcp/http-server.ts:132-144` · key lines: 136, 138, 140, 141, 142

```ts
    case 'tools/list':
    case 'tools/call': {
      let tools: readonly McpTool[]
      try {
        tools = await toolsOf(server)
      } catch (error) {
        return failure(id, INTERNAL_ERROR, error instanceof Error ? error.message : String(error))
      }
      if (message.method === 'tools/list') return answer(id, { tools: tools.map(listed) })
      const tool = tools.find((each) => each.name === params.name)
      if (tool === undefined) return failure(id, INVALID_PARAMS, `Unknown tool: ${String(params.name)}`)
      return answer(id, await called(tool, params.arguments))
    }
```

- Что делает: `tools/list` и `tools/call` берут один список — `listTools()` сервера, если он есть (сервер Integration-ы),
  иначе свои tools; вызов tool-а, которого нет в списке (фильтр Project-а его срезал), отказывает до сервиса. Отказ
  `listTools()` («Sign-in needed: …», когда списка ещё не было) — ошибка JSON-RPC с его текстом. Подсказки MCP сервиса
  (`readOnlyHint`) идут в `tools/list` дальше (`listed`, выше в файле).
- Почему здесь: Ticket, «Что делаем», пункт 2, называет `src/main/mcp/http-server.ts`: тот же `McpServer`, что у Claude.
- Без него: Codex видел бы у Integration-ы пустой список, а фильтр tools не резал бы `tools/call`.
- Требование: [Что делаем, пункт 2](../issues/07-codex.md#что-делаем)
- Риски и пробелы test-ов: endpoint без состояния — отмену вызова агентом (`notifications/cancelled`) он не передаёт
  proxy; вызов кончается по пределу proxy (10 минут). Отказ срезанного tool-а — ошибка JSON-RPC, как для своих tools
  worfy, а не ответ `isError`, как у Claude.

## 3. Integration-ы Project-а в `thread/start`

Code: `src/main/vendors/codex/mcp.ts:392-410` · key lines: 396, 397, 400, 404, 406, 409

```ts
    ])
    const given: { server: McpServer; instructions: string }[] = []
    if (listed.includes(CANVAS_SERVER_NAME)) given.push(canvas)
    if (browser !== null && (listed.includes(BROWSER_SERVER_NAME) || listed.includes(CANVAS_SERVER_NAME))) given.push(browser)
    const integrations = await integrationsOrNone(deps, request)
    if (given.length === 0 && integrations.length === 0) return null
    const endpoint = await orNull('MCP endpoint', request.cwd, () => deps.endpoint())
    if (endpoint === null) return null
    const servers = [...given.map((each) => each.server), ...integrations.map((each) => each.server)]
    const grant = endpoint.grant(servers)
    const config: Record<string, JsonValue> = {}
    // One key per server, not the whole `mcp_servers` table: the user's own servers stay as they are.
    for (const server of servers) config[`mcp_servers.${server.name}`] = { url: grant.urls[server.name]!, bearer_token_env_var: MCP_TOKEN_ENV }
    const byName = new Map(integrations.map((each) => [each.name, each]))
    const labelled = (rows: McpServerRow[]): McpServerRow[] =>
      rows.map((row) => {
        const integration = byName.get(row.name)
        return integration === undefined ? row : codexIntegrationRow(row, integration.label, integration.signInError())
      })
```

- Что делает: включённые Integration-ы Project-а получают ключи `mcp_servers.<имя>` с адресом endpoint-а и
  `bearer_token_env_var` Session рядом с `worfy-canvas`; один token Session на все серверы, путь `/mcp/<имя>` различает
  их. Session получает Integration-ы и тогда, когда список Profile-а не называет ни одного сервера worfy. Строки Codex
  для имён Integration-ов проходят `codexIntegrationRow` (`labelled`).
- Почему здесь: Ticket, «Что делаем», пункт 1; spike 01, шаг 4: одна переменная `WORFY_MCP_TOKEN` на Session.
- Без него: Codex не получил бы Integration-ов; token сервиса тут не нужен вовсе — он остаётся в proxy в main.
- Требование: [Что делаем, пункт 1](../issues/07-codex.md#что-делаем)
- Риски и пробелы test-ов: имена — те же, что у Claude (занятые — серверы Claude Code из инвентаря); сервер
  пользователя в `config.toml` Codex с тем же именем ключ `mcp_servers.<имя>` в этой Session заменит — `config.toml`
  worfy не читает. С одними Integration-ами `developerInstructions` — `null` (строка 417), и Codex оставляет
  инструкции своего config.

## 4. Откуда Integration-ы и их вход

Code: `src/main/vendors/codex/mcp.ts:219-240` · key lines: 222, 226, 229, 233, 237

```ts
export function codexIntegrations(deps: CodexIntegrationsDeps): CodexIntegrationsResolver {
  return async ({ cwd, unattended }) => {
    const dir = deps.dataDirOf(cwd)
    if (dir === null) return []
    const [{ readProjectIntegrations }, { sessionIntegrations, signInNeeded }] = await Promise.all([import('../../projects/settings'), import('../../integrations/proxy')])
    // The id of each server name, as the proxy is asked for it: what its status is read by.
    const ids = new Map<string, string>()
    const proxy = {
      sessionServer: (entry: Parameters<IntegrationProxy['sessionServer']>[0]) => {
        ids.set(entry.name, entry.id)
        return deps.proxy.sessionServer(entry)
      },
    }
    return sessionIntegrations({ entries: readProjectIntegrations(dir), store: deps.store, proxy, unattended, taken: deps.taken(cwd) }).map((each) => ({
      ...each,
      signInError: () => {
        const id = ids.get(each.name)
        return id !== undefined && deps.proxy.status(id)?.status.state === 'needs-sign-in' ? signInNeeded(deps.store.get(id)?.label ?? each.label) : null
      },
    }))
  }
}
```

- Что делает: тот же путь, что у Session Claude: поле `integrations` настроек Project-а, хранилище Machine,
  `sessionIntegrations` (имя сервера, фильтр, Autopilot только с флажком). Обёртка `sessionServer` запоминает id каждого
  имени, и `signInError()` читает статус proxy этой Integration-ы: `needs-sign-in` — текст «Sign-in needed: <метка>…».
- Почему здесь: Ticket, «Что делаем», пункты 3 и 4; `proxy.ts` для этого Ticket-а — только читать, поэтому id берётся
  обёрткой, а не новым полем `SessionIntegration`.
- Без него: строка не знала бы, что сервис отказал во входе: Codex видит endpoint worfy подключённым.
- Требование: [Что делаем, пункт 3](../issues/07-codex.md#что-делаем)
- Риски и пробелы test-ов: модули грузятся при первом старте Session, как остальное в `appCodexMcp`; путь приложения
  (`appCodexMcp`) прошли e2e Codex, но без Integration-ов в Project-е.

## 5. Строка Integration-ы

Code: `src/main/vendors/codex/mcp.ts:182-194` · key lines: 183, 184, 188, 191, 192

```ts
export function codexIntegrationRow(row: McpServerRow, label: string, signInError: string | null): McpServerRow {
  const refused = signInError !== null && row.status !== 'pending' && row.status !== 'disabled'
  const status = refused ? 'needs-auth' : row.status
  return {
    ...row,
    status,
    error: refused ? signInError : row.error,
    source: 'integration',
    sourceWord: null,
    label,
    actions: status === 'failed' || status === 'needs-auth' ? ['reconnect'] : [],
  }
}
```

- Что делает: источник `integration` и метка поверх строки Codex; отказ входа proxy — `needs-auth` с текстом «Sign-in
  needed», кроме сервера, который Codex ещё не поднял или выключил; действие — только Reconnect, своего Sign in Codex
  строка не предлагает.
- Почему здесь: Ticket, «Что делаем», пункт 3, и «Что происходит»: свой OAuth Codex не используется — его
  `mcpServer/oauth/login` вошёл бы в endpoint worfy, а не в сервис. Sign in у строки — Ticket 09.
- Без него: Integration в chip-е выглядела бы сервером worfy под slug-ом, а Sign in запускал бы вход Codex.
- Требование: [Что делаем, пункт 3](../issues/07-codex.md#что-делаем)
- Риски и пробелы test-ов: событие `mcp` уходит, только когда строки Codex изменились; одна смена статуса proxy его не
  шлёт — chip узнаёт её при следующем чтении (popover спрашивает статус при открытии).

## 6. Строки меняются на выходе handle, а Sign in Codex отказан

Code: `src/main/vendors/codex/mcp.ts:331-352` · key lines: 332, 345, 346, 349

```ts
            const event = result.value
            if (event.type === 'mcp' && event.servers !== null) return { ...result, value: { ...event, servers: rows(event.servers) } }
          }
          return result
        },
        ...(inner.return ? { return: (value?: unknown) => inner.return!(value) } : {}),
        ...(inner.throw ? { throw: (error?: unknown) => inner.throw!(error) } : {}),
      }
    },
  }
  // A Proxy rather than a copy: whatever the handle gains later reaches the Session unchanged.
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return events
      if (property === INTEGRATION_NAMES) return integrations
      if (property === 'codexMcpStatus' && typeof (target as Partial<CodexMcpLive>).codexMcpStatus === 'function') {
        return async () => {
          const got = await (target as SessionHandle & CodexMcpLive).codexMcpStatus()
          return got === null ? null : rows(got)
        }
      }
      if (property === 'close') {
```

- Что делает: событие `mcp` и ответ `codexMcpStatus()` наблюдаемого handle проходят `labelled`; свойство
  `INTEGRATION_NAMES` даёт `codexMcp.act` имена Integration-ов, и Sign in для них — `McpActionRefused`
  (`src/main/vendors/codex/mcp.ts:85`).
- Почему здесь: `src/main/vendors/codex/session.ts` не в «Где в коде»; строки, которые Session хранит сама, остаются
  такими, как их дал Codex, и `codexStartupRow` продолжает работать с ними.
- Без него: метка была бы только в одном из двух путей строк, а действие Sign in дошло бы до Codex.
- Требование: [Что делаем, пункт 3](../issues/07-codex.md#что-делаем)
- Риски и пробелы test-ов: not recorded.

## 7. Что сознательно не меняли

- `src/shared/agent/mcp-status.ts`: источник `integration` и поле `label` уже есть с Ticket-а 06; его правит Ticket 09.
- `src/main/vendors/codex/session.ts` и `src/main/integrations/proxy.ts` — не тронуты.
- `config.toml` Codex worfy не читает и не пишет («Вне скоупа»).

## 8. Как проверено

- До правки: `pnpm test test/unit/codex-mcp-row.test.ts test/contract/integrations-codex.test.ts` — exit 1 (13 из 23
  упали: нет `codexIntegrations`, `codexIntegrationRow`). После — exit 0 (24).
- 15 mutant-ов кода (endpoint без `listTools`, без подсказок, пустой список при отказе; Integration-ы не в grant; без
  списка worfy — ничего; пустые инструкции; строка без источника, без отказа входа, с действиями Codex; Sign in не
  отказан; событие и статус без меток; Autopilot без фильтра; отказ у `pending`; статус proxy не читается) — каждый
  exit 1 на этих двух файлах.
- Unit и contract test-ы затронутых модулей (72 файла, 1290 test-ов) — exit 0. `pnpm test:e2e
  test/e2e/codex-session.spec.ts test/e2e/codex-sessions-on-canvas.spec.ts test/e2e/session-mcp.spec.ts` под
  `/tmp/worfy-e2e.lock` — exit 0.

## Проверить себя

1. Почему token сервиса не попадает в Codex ни в каком виде?
   - Ответ: Codex получает только адрес endpoint-а и имя переменной с token-ом Session; соединение с сервисом и его
     token держит proxy в main, а endpoint отвечает tools proxy.
   - Строки: `src/main/vendors/codex/mcp.ts:404`
2. Почему у строки Integration-ы нет Sign in, хотя Codex умеет `mcpServer/oauth/login`?
   - Ответ: вход Codex пошёл бы на сервер, который Codex видит, — endpoint worfy, а не сервис; вход Integration-ы ведёт
     worfy.
   - Строки: `src/main/vendors/codex/mcp.ts:192`
3. Как фильтр Read only режет `tools/call`, если Codex зовёт tool по имени напрямую?
   - Ответ: endpoint ищет tool в том же списке `listTools()`, который фильтр уже срезал, и отказывает, не дойдя до
     сервиса.
   - Строки: `src/main/mcp/http-server.ts:141-142`
