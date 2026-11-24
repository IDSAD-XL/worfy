# 01 — Spike: Integration через worfy в Claude Code и Codex, один refresh пакета MCP SDK и что нужно сервисам

Type: spike
Status: done 2026-11-21T01:19Z
PR: #2108
Branch: worfy-integrations/01
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
  - evidence: test-run pass · `pnpm exec electron scripts/spikes/harness-plugin/probe.ts integrations --fixtures test/fixtures/sdk-messages` exit 0 · mac - · 4b516d1611426663c83dd7cb9da533b468754f6b
  - evidence: review pass · PR #2108 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Записка: две Integration-ы на одном адресе рядом с записями `serverUrl` — обе connected, каждая со своим
      token-ом; `disallowedTools` убирает tool из `system/init`; `--mcp-config` на 0.3.322 и нет ли в нём token-а;
      предел длины имени tool-а — числом.
  - evidence: test-run pass · `probe.ts integrations` exit 0, facts claude, claude_fake_api, claude_serverurl_only in summary.json; note sections 3.1-3.5 · mac - · 4b516d1611426663c83dd7cb9da533b468754f6b
  - evidence: review pass · PR #2108 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Записка: Codex по схеме и на fake app-server-е — две Integration-ы на одном адресе через `bearer_token_env_var`;
      настоящий Codex не запускался.
  - evidence: test-run pass · `probe.ts integrations` exit 0, fact codex (ajv schema 0.166.0, fake app-server); note section step 4 · mac - · 4b516d1611426663c83dd7cb9da533b468754f6b
  - evidence: review pass · PR #2108 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Записка: число запросов refresh на stub-е при 10 параллельных вызовах и вывод для Ticket-а 05 (нужен ли замок в
      provider-е).
  - evidence: test-run pass · `probe.ts integrations` exit 0, fact refresh (10 parallel: 10, 0 with rotation, 1 with single-flight fetch); note section step 5 · mac - · 4b516d1611426663c83dd7cb9da533b468754f6b
  - evidence: review pass · PR #2108 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [x] (вручную) Владелец вошёл из окна spike-а в Atlassian (два site-а) и Linear; в записке — `capabilities`, число
      tools, срок access token-а и refresh каждого сервера.
  - needs: mac
  - evidence: owner-check pass · 2026-11-21: 1 /var/folders/<tmp>/worfy-harness-probe/2026-11-20T23-30-08-619Z — 1 ок · mac dev · 5a00e0a59c23797e5c92fdababab5666425827a1
- [ ] Записка кончается решением «tools-only proxy достаточен: да/нет» с выводами для Ticket-ов 03, 05 и 06.
  - evidence: commit pass · f91f809f4: note ends with «tools-only proxy достаточен: да», conclusions for tickets 03, 05, 06 · - - · f91f809f4943ad2a2c13de7ef62de07b73881d3a
  - evidence: review pass · PR #2108 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Scrub probe-а пройден: новые fixture-ы и записка не держат token-ов, адресов site-ов владельца и e-mail-ов;
      `--rescrub` чистит новые fixture-ы.
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0 (in pnpm lint) and `probe.ts --rescrub test/fixtures/sdk-messages` exit 0 with no change · mac - · 4b516d1611426663c83dd7cb9da533b468754f6b
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44842259267/job/136658694291 · ci - · 95f9a1d31a7d29813f5ed4048c064d412d58ed8e

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

Часть агента (шаги 1–7) сделана 2026-11-20, записка — [spike-integrations.md](../spike-integrations.md). Шаг
владельца (шаг 8) сделан 2026-11-20: вход в Atlassian два раза и в Linear, итог — раздел записки «Итог шага
владельца». Решение — **tools-only proxy достаточен: да** (последний раздел записки).

Коротко:

- Две Integration-ы на одном адресе (SDK-серверы рядом с `managedSettings` с `serverUrl`) — обе `connected`;
  `tools/call` через Claude Code (fake Messages API на `127.0.0.1`) дошёл до каждой её token-ом. Policy tier
  SDK-серверы не режет.
- `disallowedTools` MCP-tool из `system/init` и из `tools` модели не убирает, только отклоняет вызов («Permission …
  denied»); встроенный tool убирает. Фильтр tools — в `tools/list` proxy (Ticket 06).
- `--mcp-config` на 0.3.322 есть; в нём только серверы `http` с заголовком (token виден в аргументах), SDK-серверов
  и token-ов proxy там нет.
- Предел имени: полное имя `mcp__<сервер>__<tool>` до 128 символов включительно; длиннее Claude Code выбрасывает
  молча.
- Codex: две записи `mcp_servers.<имя>` с `url` на одном endpoint-е и одной `bearer_token_env_var` проходят схему
  0.166.0 и fake app-server; путь различает Integration-ы; token только в окружении.
- Refresh: 10 параллельных вызовов — 10 refresh; с ротацией refresh token-а Integration теряет вход. Замка в пакете
  нет; для Ticket 05 — один refresh за раз в `fetch` transport-а (проверено: 1 refresh, 10 из 10).
- Шаг владельца: Atlassian — `capabilities` `logging` и `tools{listChanged}`, 26 tools, access token 8 ч; Linear —
  `tools{listChanged}`, 70 tools, ~24 ч. У обоих refresh сработал и сменил refresh token (ротация), revocation —
  200/200. Полное имя tool-а при сервере в 24 символа — до 62. Различаются ли site-ы двух входов Atlassian — не
  проверено (`sites: "not read"`).
- Решение: `resources` и `prompts` сервисы не объявляют — tools-only proxy достаточен. Ticket 06: пересылать
  `tools/list_changed` и `instructions` сервиса, `logging` не объявлять. Ticket 05: замок refresh обязателен (оба
  сервиса ротируют), scope явный. Ticket 03: пометок сервисов не нужно, явный scope в шаблоне.

### Решено без владельца

1. Fake Messages API на `127.0.0.1` (`ANTHROPIC_BASE_URL`, фиктивный ключ) вместо вызова модели — чтобы пройти
   `tools/call` через Claude Code и увидеть `tools` запроса. Запрос не уходит с машины.
2. Роль Codex играет probe по документированному поведению (Факт 4а); настоящий binary не запускался (бриф).
3. Unit-test-ов у кода spike-а нет, как у всего `probe.ts`; проверка — прогон сценария, exit 0.
4. Новый fixture `plugin-integrations-two-integrations.jsonl` потребовал записи его событий в
   `test/fixtures/sdk-events/claude.json` (так требует `test/unit/claude-events.test.ts`) — файл вне списка
   «Где в коде», правка механическая, как в spike-е worfy-mcp-live 01.
5. Шаг владельца отзывает token-ы в конце (revocation endpoint есть у Atlassian и Linear).
6. Сравнение site-ов двух входов Atlassian оставлено непроверенным, повторного входа не просим: решения для
   Ticket-ов 03, 05 и 06 от него не зависят; проверить можно в приёмке Ticket-а 05.
