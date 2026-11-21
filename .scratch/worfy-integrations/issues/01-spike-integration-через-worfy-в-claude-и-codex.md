# 01 — Spike: Integration через worfy в Claude Code и Codex, один refresh пакета MCP SDK и что нужно сервисам

Type: spike
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 1; «Волны», Wave 1; «Факты», 3в, 7 и 8; «Решения по реализации» → Proxy,
Вход OAuth, Имя сервера в Session; «Риски» (proxy не покрывает сервис, имя tool-а длиннее предела); «Вопросы
владельцу», Q1 и Q10; [critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md), возражение 2

Кто: агент — сценарий probe-а в sandbox, без входа и без вызова модели. Владелец — один живой вход на 10–15 минут по
шагам записки: Atlassian (два site-а) и Linear. Ticket ждёт этот шаг до `done`.

Не платформенный Ticket (сценарий spike-а и записка; код worfy не меняется). Глубина ревью — `medium`.

## Что происходит

- Решение 1 spec-а (Q1 (а)): Integration — `McpServer` worfy-proxy. Claude получает её SDK-сервером в процессе worfy,
  как `worfy-canvas` (`src/main/vendors/claude/mcp.ts:209-231`, `src/main/vendors/claude/options.ts:829-842`), Codex —
  по `127.0.0.1` с token-ом Session (`src/main/vendors/codex/mcp.ts:286-287`). Что две такие Integration-ы на одном
  адресе сервиса работают рядом с `managedSettings` с записями `serverUrl` (`options.ts:805-819`, поправка ADR-0021
  2026-11-13), никто не проверял.
- Факт 3в: SDK передаёт `mcpServers` аргументом процесса `--mcp-config <JSON>`; проверено на 0.3.289, на закреплённой
  в `package.json` 0.3.322 — нет.
- Предел длины имени tool-а `mcp__<сервер>__<tool>` не проверен; spec ставит имя сервера до 24 символов.
- Вход OAuth (Ticket 05) стоит на `OAuthClientProvider` пакета `@modelcontextprotocol/sdk` 1.32.0 (возражение 2
  critic-а). Делает ли `authProvider` transport-а один refresh при параллельных вызовах — неизвестно; если нет,
  provider Ticket-а 05 держит замок сам.
- Первая версия proxy — только tools («Решено без владельца», 4). Нужны ли выбранным сервисам `resources`, `prompts`,
  elicitation или sampling, покажут `capabilities` живых серверов.
- Probe уже есть: `scripts/spikes/harness-plugin/probe.ts` со сценариями `install`, `mcp-name` и `mcp-live` (sandbox:
  HOME и CLAUDE_CONFIG_DIR во временной папке, без входа, без модели; scrub и `--rescrub` чистят fixture-ы).

## Что делаем

1. Сценарий `integrations` в `scripts/spikes/harness-plugin/probe.ts` (новое значение `Scenario`, строка запуска в
   комментарии). Sandbox и правила — как у `mcp-live`: временные HOME и CLAUDE_CONFIG_DIR, без входа, без вызова
   модели, fingerprint настоящих настроек до и после.
2. Stub MCP-сервера на `127.0.0.1` рядом с probe-ом: streamable HTTP, проверяет `Authorization: Bearer`, каждому
   token-у отвечает своим набором данных; второй режим — 401 с `resource_metadata`, Dynamic Client Registration, PKCE,
   короткий срок access token-а, refresh.
3. Claude, по шагам:
   - две Integration-ы на одном stub-адресе с разными token-ами — SDK-серверами в `mcpServers` рядом с
     `managedSettings` с записями `serverUrl`: обе `connected` в `mcpServerStatus`, каждая отвечает данными своего
     token-а;
   - `disallowedTools` `mcp__<имя>__<tool>` убирает tool из `system/init`;
   - есть ли `--mcp-config` в аргументах процесса на SDK 0.3.322 и что в нём у SDK-сервера (token-а там быть не
     должно);
   - предел длины имени tool-а: с какой длины Claude Code или API отвергает имя.
4. Codex — по схеме app-server (`src/main/vendors/codex/protocol/`) и на fake app-server-е: `mcp_servers.<имя>` с
   `url` и `bearer_token_env_var` для двух Integration-ов на одном адресе endpoint-а worfy. Настоящий binary Codex не
   запускается.
5. Refresh: `Client` пакета `@modelcontextprotocol/sdk` 1.32.0 (та версия, что уже стоит peer-ом Agent SDK,
   `pnpm-lock.yaml:3929-3932`) со `StreamableHTTPClientTransport` и `authProvider` — `OAuthClientProvider` пакета; на
   stub-е 10 параллельных `tools/call` после истечения access token-а — сколько запросов refresh получает stub.
6. Окно spike-а для шага владельца: `BrowserWindow` со своим partition на каждый вход, `OAuthClientProvider` пакета
   (Dynamic Client Registration и PKCE), redirect на `127.0.0.1`. Token-ы — только в памяти процесса spike-а и во
   временной папке, которая удаляется в конце.
7. Агент прогоняет сценарий сам, пишет записку `.scratch/worfy-integrations/spike-integrations.md` (ответ на каждый
   пункт шагов 3–5 и как проверено; шаги владельца) и ставит `ticket block worfy-integrations 01 --waits owner` до
   шага владельца.
8. Шаг владельца (10–15 минут, по записке): из окна spike-а вход в Atlassian — два site-а, две Integration-ы — и в
   Linear. В записку: `capabilities` каждого сервера из `initialize`, число tools, срок access token-а, есть ли refresh
   token и сработал ли refresh, есть ли revocation endpoint. Агент со входом владельца ничего не запускает; token-ов,
   адресов site-ов владельца и e-mail-ов в записке нет.
9. Записка кончается решением «tools-only proxy достаточен: да/нет»; при «нет» — что добавить в Ticket 06 и какие
   сервисы пометить в каталоге (Ticket 03); вывод о замке refresh для Ticket-а 05; предел имени для Ticket-а 06.

## Готово, когда

- [ ] Сценарий `integrations` в `scripts/spikes/harness-plugin/probe.ts`: sandbox, без входа, без модели;
      `pnpm exec electron scripts/spikes/harness-plugin/probe.ts integrations` — exit 0, итог — в записке.
- [ ] Записка: две Integration-ы на одном адресе рядом с записями `serverUrl` — обе connected, каждая со своим
      token-ом; `disallowedTools` убирает tool из `system/init`; `--mcp-config` на 0.3.322 и нет ли в нём token-а;
      предел длины имени tool-а — числом.
- [ ] Записка: Codex по схеме и на fake app-server-е — две Integration-ы на одном адресе через `bearer_token_env_var`;
      настоящий Codex не запускался.
- [ ] Записка: число запросов refresh на stub-е при 10 параллельных вызовах и вывод для Ticket-а 05 (нужен ли замок в
      provider-е).
- [x] (вручную) Владелец вошёл из окна spike-а в Atlassian (два site-а) и Linear; в записке — `capabilities`, число
      tools, срок access token-а и refresh каждого сервера.
  - needs: mac
  - evidence: owner-check pass · 2026-11-21: 1 /var/folders/<tmp>/worfy-harness-probe/2026-11-20T23-30-08-619Z — 1 ок · mac dev · 5a00e0a59c23797e5c92fdababab5666425827a1
- [ ] Записка кончается решением «tools-only proxy достаточен: да/нет» с выводами для Ticket-ов 03, 05 и 06.
- [ ] Scrub probe-а пройден: новые fixture-ы и записка не держат token-ов, адресов site-ов владельца и e-mail-ов;
      `--rescrub` чистит новые fixture-ы.

## Где в коде

- `scripts/spikes/harness-plugin/probe.ts` (сценарий `integrations`), stub MCP-сервера рядом с ним
- `.scratch/worfy-integrations/spike-integrations.md` (новый)
- fixture-ы spike-а, если нужны: `test/fixtures/sdk-messages/plugin-integrations-*.jsonl`

Только читать: `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/mcp.ts`, `src/main/vendors/codex/mcp.ts`,
`src/main/mcp/http-server.ts`, `.scratch/worfy-mcp-live/spike-mcp-live.md`, `docs/adr/0021-mcp-servers-allowlist-in-profile.md`,
`node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.d.ts` и `streamableHttp.d.ts` (1.32.0).

## Вне скоупа

- Код worfy: модель — Ticket 03, вход — 04 и 05, proxy — 06, Codex — 07. Slack в spike-е не проверяется: в каталоге
  первой версии его нет (Q6), Slack — только через connector claude.ai.

## Итог

Пусто до завершения Ticket-а.
