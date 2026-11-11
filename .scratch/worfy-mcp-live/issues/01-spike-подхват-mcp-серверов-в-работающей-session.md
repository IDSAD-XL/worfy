# 01 — Spike: подхват MCP-серверов в работающей Session

Type: spike
Status: claimed 2026-11-11T21:22Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 01; «Решения владельца» (Q3, Q5, Q9, Q11); «Что уже есть в SDK и в
протоколе Codex»; «Риски» (живой подхват невозможен, живая проверка connector-а, недокументированный вход OAuth);
возражение 1 критика ([docs/product/critic/worfy-mcp-live-2026-11-11.md](../../../docs/product/critic/worfy-mcp-live-2026-11-11.md))

Кто: агент — он сам запускает сценарий probe-а (sandbox, без входа, без вызова модели). Владелец — одна живая проверка
connector-а claude.ai по шагам заметки; этот Ticket её не ждёт.

## Что происходит

- Session получает набор MCP-серверов при старте: `managedSettings` с `allowManagedMcpServersOnly` и
  `allowedMcpServers` (`src/main/vendors/claude/options.ts:724–729`), свои серверы worfy через `options.mcpServers`
  (`:738–761`). Список Profile читается один раз (`src/main/vendors/claude/query.ts:90`, `:336–337`).
- SDK 0.3.322 (`package.json`) даёт `mcpServerStatus`, `reconnectMcpServer`, `toggleMcpServer`, `setMcpServers`,
  `reloadPlugins`, `applyFlagSettings`. Вызова, меняющего `managedSettings` на ходу, в `sdk.d.ts` нет. Вход OAuth в
  `sdk.d.ts` не описан; в `sdk.mjs` есть недокументированные `mcpAuthenticate` и `mcpSubmitOAuthCallbackUrl`.
- Probe уже есть: `scripts/spikes/harness-plugin/probe.ts`. Сценарии `install` и `mcp-name` работают в sandbox (HOME
  и CLAUDE_CONFIG_DIR во временной папке, без входа) и не вызывают модель; `mcpStatus` (`:383`) зовёт
  `q.mcpServerStatus()`; scrub и `--rescrub` чистят fixture-ы. Сценарий `mcp-name` перезапускали 2026-11-10 на SDK
  0.3.322 (`.scratch/worfy-polish/issues/100-*.md`).
- ADR-0048 (`docs/adr/0048-harness-plugin-spike-results.md:121–122`) уже нашёл: сервер в `mcpServers`
  (`source: dynamic`) `allowedMcpServers` отсекает по имени. Сервер, который отсёк список, `system/init` не сообщает
  (fixture-ы `test/fixtures/sdk-messages/plugin-mcp-name-*.jsonl`).
- Подхватывает ли работающий query сервер, записанный в конфигурацию на ходу, и сервер, который worfy только что внёс
  в allowlist, никто не проверял. Перечисляет ли query без allowlist-а connector-ы claude.ai — тоже.
- Codex 0.166.0: `mcpServerStatus/list`, `config/mcpServer/reload`, `mcpServer/oauth/login`, уведомление
  `mcpServer/startupStatus/updated`. Подхватывает ли `config/mcpServer/reload` новый сервер в уже начатом thread-е —
  неизвестно.

## Что делаем

1. Читаем `sdk.d.ts`, `sdk.mjs` и CHANGELOG SDK 0.3.322 и схемы Codex (`src/main/vendors/codex/protocol/`): что
   обещает каждый вызов и что сказано о policy tier на ходу.
2. Добавляем в `scripts/spikes/harness-plugin/probe.ts` сценарий `mcp-live` (новое значение `Scenario`, строка в
   комментарии с командами запуска). Sandbox и правила — как у `mcp-name`: временные HOME и CLAUDE_CONFIG_DIR, без
   входа, без вызова модели, fingerprint настоящих настроек до и после. Тестовый сервер — маленький stdio-сервер с
   придуманным именем (`example-notes`) рядом с probe-ом.
3. Сценарий стартует query с теми же `managedSettings`, что worfy, и по шагам:
   - пишет `example-notes` в конфигурацию sandbox-а (`~/.claude.json` sandbox-а, как `claude mcp add`), пока query
     работает, и смотрит `mcpServerStatus` без вызова, после `reloadPlugins`, после `setMcpServers` с его
     конфигурацией;
   - смотрит, отсекает ли `allowedMcpServers` сервер из `setMcpServers`;
   - вносит имя в allowlist вторым `managedSettings`: сначала ищет, может ли работающий query его получить
     (`applyFlagSettings` меняет только flag tier — проверяем, не влияет ли он на список); затем новый query с resume
     того же разговора и вторым `managedSettings`, после выхода первого процесса (путь Restart);
   - зовёт `toggleMcpServer` и `reconnectMcpServer` и записывает ответы;
   - запускает query инвентаря (spec, Q11): без allowlist-а, без своих серверов worfy, без сообщения модели; ждёт
     выхода серверов из `pending`, читает `mcpServerStatus`, закрывает. Записывает: видны ли серверы вне списка с
     именем и статусом; сколько он идёт; остаётся ли после него транскрипт в `projects` sandbox-а;
   - если форму видно без входа (например, на тестовом сервере, который отвечает 401 и требует OAuth): что отвечает
     `mcpAuthenticate(serverName, redirectUri, { redirectUriOnly })` и что ждёт `mcpSubmitOAuthCallbackUrl`.
4. Ответы control-вызовов идут в fixture-ы: `system/init` — в `test/fixtures/sdk-messages/plugin-mcp-live-*.jsonl`
   тем же `keepInit`, ответы control-вызовов — в `test/fixtures/mcp-live/`. Всё проходит через scrub probe-а;
   `--rescrub` чистит и новую папку.
5. Codex: `config/mcpServer/reload` в начатом thread-е, `mcpServerStatus/list`, `mcpServer/oauth/login` — по схеме и на
   fake app-server-е; живой Codex не запускается.
6. Агент запускает сценарий сам: `pnpm exec electron scripts/spikes/harness-plugin/probe.ts mcp-live --fixtures …`.
7. В заметку — шаги живой проверки connector-а claude.ai для владельца, на 10–15 минут: его вход Claude Code,
   connector, подключённый во время работающего query; подхватывается ли он и каким вызовом; перечисляет ли его query
   инвентаря без allowlist-а; можно ли войти через `mcpAuthenticate`. Агент со входом владельца ничего не запускает.
8. Пишем заметку: ответ на каждый пункт шагов 3 и 5 с тем, как проверено; выбранный вызов для каждого пути (сервер из
   конфигурации, сервер в allowlist, connector — «ждёт живой проверки»); нужен ли Restart с тем же разговором и для
   каких путей; решение по query инвентаря; решение по OAuth с запасным путём.

## Готово, когда

- [ ] Сценарий `mcp-live` в `scripts/spikes/harness-plugin/probe.ts`: sandbox, без входа, без вызова модели; агент
      прогнал его, exit code и итог — в заметке.
- [ ] Заметка `.scratch/worfy-mcp-live/spike-mcp-live.md`: ответ на каждый пункт шагов 3 и 5, как проверено (чтение
      SDK, сценарий в sandbox, fake app-server), выбранный вызов по каждому пути, решение по query инвентаря и по OAuth
      с запасным путём.
- [ ] В заметке — шаги живой проверки connector-а для владельца и место для её итога. Сама проверка в этот Ticket не
      входит.
- [ ] Fixture-ы `test/fixtures/sdk-messages/plugin-mcp-live-*.jsonl` и `test/fixtures/mcp-live/` — только придуманные
      имена серверов, без URL, путей домашней папки и id учётных записей; `--rescrub` по обеим папкам ничего не
      меняет.
- [ ] Настоящие настройки не изменились: fingerprint до и после совпадает (`summary.json` probe-а).
- [ ] lint и gate fast — exit 0.

## Где в коде

- `scripts/spikes/harness-plugin/probe.ts`
- `scripts/spikes/harness-plugin/` — stdio-сервер `example-notes` (новый файл)
- `.scratch/worfy-mcp-live/spike-mcp-live.md` (новый)
- `test/fixtures/sdk-messages/plugin-mcp-live-*.jsonl` (новые)
- `test/fixtures/mcp-live/` (новый)

Только читать: `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts`,
`src/main/vendors/codex/mcp.ts`, `src/main/vendors/codex/protocol/ts/ClientRequest.ts`,
`src/main/vendors/codex/protocol/ts/v2/McpServerStatus.ts`, `docs/adr/0048-harness-plugin-spike-results.md`.

## Вне скоупа

- Код в `src/`: он начинается в Ticket-е 02.
- Живая проверка connector-а: её делает владелец по шагам заметки; её ждут только пункты connector-а в Ticket-ах 03
  и 05.
- Живой Codex: только fake и схема.
