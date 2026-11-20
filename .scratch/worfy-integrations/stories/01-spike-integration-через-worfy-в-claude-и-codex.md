# Code story — worfy-integrations 01: Spike: Integration через worfy в Claude Code и Codex, один refresh пакета MCP SDK и что нужно сервисам

Kind: pr · Epic: worfy-integrations · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

Spec Epic-а решил: Integration — proxy-сервер worfy, Claude получает его SDK-сервером в процессе worfy, Codex — через
endpoint worfy на `127.0.0.1`. Никто не проверял, что две такие Integration-ы на одном адресе сервиса работают рядом с
записями `serverUrl`, что `disallowedTools` убирает tool, есть ли `--mcp-config` на SDK 0.3.322, какой предел у имени
tool-а и делает ли пакет `@modelcontextprotocol/sdk` 1.32.0 один refresh при параллельных вызовах. Код worfy этот PR не
меняет: это сценарий probe-а, stub сервиса и записка.

- Требование: [Что происходит](../issues/01-spike-integration-через-worfy-в-claude-и-codex.md#что-происходит)

## 2. Proxy Integration — низкоуровневый Server пакета

Code: `scripts/spikes/harness-plugin/probe.ts:1316-1321` · key lines: 1317, 1318, 1319

```ts
function proxyServer(sdk: McpSdk, name: string, upstream: McpClient): InstanceType<McpSdk['Server']> {
  const server = new sdk.Server({ name, version: '0.0.1' }, { capabilities: { tools: {} } })
  server.setRequestHandler(sdk.ListToolsRequestSchema, () => upstream.listTools())
  server.setRequestHandler(sdk.CallToolRequestSchema, (request: { params: Record<string, unknown> }) => upstream.callTool(request.params))
  return server
}
```

- Что делает: SDK-сервер для `mcpServers` Session, у которого `tools/list` и `tools/call` уходят в `Client` сервиса со
  своим token-ом. Сценарий даёт Claude Code два таких сервера на один адрес stub-а с разными token-ами.
- Почему здесь: spec («Решения по реализации» → Proxy) строит SDK-сервер Claude на низкоуровневом `Server` пакета,
  потому что `createSdkMcpServer` принимает только zod; spike проверяет, что Agent SDK принимает такой `instance`.
- Без него: пункт «каждая отвечает данными своего token-а» нечем было бы проверить в форме Ticket-а 06.
- Требование: [Что делаем, п. 3](../issues/01-spike-integration-через-worfy-в-claude-и-codex.md#что-делаем)
- Риски и пробелы test-ов: proxy без `resources`, `prompts` и уведомлений сервера; `tools/call` через Claude Code
  пройден через fake Messages API на `127.0.0.1`, не через настоящую модель.

## 3. Token сервиса не уходит в аргументы процесса

Code: `scripts/spikes/harness-plugin/probe.ts:1501-1509` · key lines: 1504, 1506, 1507, 1508

```ts
      const has = (token: string) => args.some((a) => a.includes(token))
      step.process = {
        flags: args.filter((a) => a.startsWith('--')),
        mcp_config_present: at >= 0,
        mcp_config: config,
        header_token_in_args: has(intToken('header')),
        proxy_tokens_in_args: has(intToken('alpha')) || has(intToken('beta')),
        proxy_tokens_in_env: Object.values(first?.env ?? {}).some((v) => typeof v === 'string' && (v.includes(intToken('alpha')) || v.includes(intToken('beta')))),
      }
```

- Что делает: читает аргументы и окружение процесса Claude Code, которые поймал `spawnClaudeCodeProcess`, и ищет в них
  fake token-ы. Итог прогона: `--mcp-config` есть, token сервера `http` с заголовком в нём виден, token-ов proxy нет
  ни в аргументах, ни в окружении.
- Почему здесь: Факт 3в spec-а проверен на 0.3.289, на закреплённой 0.3.322 — нет; тикет просит проверить.
- Без него: решение «Integration — SDK-сервер, а не `http` с `headers`» держалось бы на старой версии SDK.
- Требование: [Готово, когда, п. 2](../issues/01-spike-integration-через-worfy-в-claude-и-codex.md#готово-когда)
- Риски и пробелы test-ов: проверены только аргументы первого процесса Session; SDK-серверы в Claude Code уходят
  другим путём, его spike не читал.

## 4. Один refresh за раз — в fetch transport-а

Code: `scripts/spikes/harness-plugin/integrations-oauth.mjs:296-308` · key lines: 300, 302, 303, 306

```js
export function singleFlightFetch(base = fetch) {
  const inFlight = new Map()
  return async (input, init) => {
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : null
    const key = body !== null && (init?.method ?? 'GET').toUpperCase() === 'POST' && new URLSearchParams(body).get('grant_type') === 'refresh_token' ? `${String(input)} ${body}` : null
    if (key === null) return base(input, init)
    if (!inFlight.has(key)) {
      const pending = base(input, init).finally(() => setTimeout(() => inFlight.delete(key), 0))
      inFlight.set(key, pending)
    }
    return (await inFlight.get(key)).clone()
  }
}
```

- Что делает: второй запрос refresh с тем же refresh token-ом, пока первый в пути, получает копию первого ответа.
- Почему здесь: пакет 1.32.0 зовёт `auth()` на каждый 401 сам; 10 параллельных вызовов дали 10 refresh, а с ротацией
  refresh token-а Integration теряла вход. У `OAuthClientProvider` нет места вокруг refresh, у transport-а есть опция
  `fetch`.
- Без него: с ротацией refresh token-а после истечения access token-а все вызовы — `Unauthorized`, до нового входа.
- Требование: [Что делаем, п. 5](../issues/01-spike-integration-через-worfy-в-claude-и-codex.md#что-делаем)
- Риски и пробелы test-ов: ключ — адрес и тело запроса; refresh с другим телом (другой scope) пройдёт вторым запросом.
  Проверено на stub-е; ротирует ли Atlassian или Linear refresh token — покажет шаг владельца.

## 5. Окно spike-а ловит redirect без listener-а

Code: `scripts/spikes/harness-plugin/integrations-oauth.mjs:151-155` · key lines: 152, 153, 154

```js
      ses.webRequest.onBeforeRequest((details, callback) => {
        if (!details.url.startsWith(redirectPrefix)) return callback({})
        callback({ cancel: true })
        finish(() => resolve(details.url))
      })
```

- Что делает: запрос окна на `http://127.0.0.1/worfy-oauth/<слот>` отменяется, его адрес с code и state отдаётся
  пакету (`finishAuth`). Partition окна без `persist:`, cookies только в памяти.
- Почему здесь: spec («Вход OAuth — Ticket 05») планирует redirect, который перехватывается событием навигации окна,
  без listener-а; шаг владельца входит в Atlassian и Linear этим же окном.
- Без него: окну понадобился бы loopback listener, а Ticket 05 — проверка другого пути.
- Требование: [Что делаем, п. 6](../issues/01-spike-integration-через-worfy-в-claude-и-codex.md#что-делаем)
- Риски и пробелы test-ов: проверено на stub-е, который отвечает 302 сразу; страницы входа Atlassian и Linear — шаг
  владельца.

## 6. Вход владельца отзывается при любом исходе и не пишет ответ сервиса

Code: `scripts/spikes/harness-plugin/probe.ts:1802-1814` · key lines: 1804, 1809, 1812

```ts
          } catch {
            // A fixed text: the message of JSON.parse quotes a piece of the answer, which names the site.
            report.sites = 'not read'
          }
        }
      } catch (err) {
        report.failed_at = stage
        Object.assign(report, errorShape(err))
      } finally {
        await client?.close().catch(() => undefined)
        report.revoke = await revokeSlot(slot)
        await electronSession.fromPartition(partition).clearStorageData()
        out[slot] = report
```

- Что делает: каждый вход сценария `integrations-sign-in` отзывает свои token-ы в `finally`, даже если отчёт по
  серверу упал; ошибка попадает в отчёт классом и HTTP-статусом, неразобранный список site-ов — строкой «not read».
  На SIGINT, SIGTERM и необработанную ошибку тот же `revokeSlot` отзывает все входы до выхода.
- Почему здесь: замечание Orchestrator-а к PR: при падении `tools/list` или Ctrl+C token-ы реальных аккаунтов
  владельца оставались живыми, а текст ошибки `JSON.parse` цитирует кусок ответа с адресом site-а.
- Без него: живые token-ы Atlassian и Linear после spike-а и адрес site-а владельца в `summary.json`.
- Требование: [Что делаем, п. 8](../issues/01-spike-integration-через-worfy-в-claude-и-codex.md#что-делаем)
- Риски и пробелы test-ов: `kill -9` и падение самого Electron не ловятся — записка говорит, как отозвать доступ
  руками. Проверено на stub-е (`stub-tools-fail`, `stub-bad-sites`, `stub-tools-hang` с SIGINT), не на сервисах.

## 7. Что сознательно не меняли

Код worfy (`src/`) не тронут: модель, вход, proxy и Codex — Ticket-ы 03–07. Настоящий Codex не запускался, вход в
настоящие сервисы — только в сценарии `integrations-sign-in`, который запускает владелец.

## 8. Как проверено

- `pnpm exec electron scripts/spikes/harness-plugin/probe.ts integrations --fixtures test/fixtures/sdk-messages` —
  exit 0, факты в `summary.json` и в записке `spike-integrations.md`.
- `pnpm exec electron scripts/spikes/harness-plugin/probe.ts --rescrub test/fixtures/sdk-messages` — exit 0, файлы не
  изменились.
- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0, test-ы fixture-ов `sdk-messages` (10 файлов) — exit 0.

## Проверить себя

1. Почему proxy строится на низкоуровневом `Server`, а не на `createSdkMcpServer`?
   Строки: `scripts/spikes/harness-plugin/probe.ts:1316-1321`
   Ответ: tools сервиса приходят с готовой JSON Schema, а `createSdkMcpServer` принимает только zod; `Server` отдаёт
   ответ `tools/list` сервиса как есть.
2. Почему Integration не передают Claude Code сервером типа `http` с заголовком входа?
   Строки: `scripts/spikes/harness-plugin/probe.ts:1501-1509`
   Ответ: такой сервер уходит в `--mcp-config`, и token виден в аргументах процесса; у SDK-сервера token остаётся в
   процессе worfy.
3. Что ломается без одного refresh за раз, если сервис ротирует refresh token?
   Строки: `scripts/spikes/harness-plugin/integrations-oauth.mjs:296-308`
   Ответ: второй параллельный refresh несёт использованный token, сервер отвечает `invalid_grant`, пакет стирает
   token-ы, и Integration теряет вход.
