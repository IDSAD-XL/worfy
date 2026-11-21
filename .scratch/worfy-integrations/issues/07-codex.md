# 07 — Codex: Integration-ы через endpoint worfy на `127.0.0.1` ключами `mcp_servers.<имя>`, строки Codex в chip-е

Type: task
Status: done 2026-11-21T03:42Z
PR: #2128
Blocked by: 06
Source: [spec.md](../spec.md), «Ticket-ы», 7; «Волны», Wave 4; «Решение», 1; «Факты», 4а–4в; «Решения по реализации»
→ Session Codex, Статус; «Решения по test-ам»; «Вопросы владельцу», Q1 и Q8;
[critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md), возражение 1

Кто: агент.

Не платформенный Ticket (`src/main/vendors/codex/`, `src/shared/agent/`; endpoint `127.0.0.1` уже работает на всех
платформах). Глубина ревью — `medium`.

## Что происходит

- Q8 (а): Codex — в этом Epic-е, тем же proxy. worfy уже отдаёт Codex свои серверы через endpoint
  `src/main/mcp/http-server.ts` (`initialize`, `ping`, `tools/list`, `tools/call` — `http-server.ts:20-23`) ключами
  `mcp_servers.<имя>` с `url` и `bearer_token_env_var` Session в `config` `thread/start`
  (`src/main/vendors/codex/mcp.ts:168`, `:286-287`; Факт 4в). Этого хватает tools-only proxy.
- Свой OAuth Codex (`codex mcp login`, ключ «имя + hash адреса», Факт 4б) не используется: вход держит worfy.
- `McpServer` Integration-а и proxy — Ticket 06 (`src/main/integrations/proxy.ts`).
- Возражение 1 critic-а: этот Ticket и Ticket 09 правят один файл `src/shared/agent/mcp-status.ts`, поэтому 09 ждёт 07.
- Серверы пользователя Codex берёт из своего `config.toml`; worfy его не пишет («Не в этом Epic-е»).

## Что делаем

1. `src/main/vendors/codex/mcp.ts`: включённые Integration-ы Project-а идут через endpoint
   `src/main/mcp/http-server.ts` ключами `mcp_servers.<имя>` (имя — из Ticket-а 06) с `url` endpoint-а и
   `bearer_token_env_var` Session; token сервиса Codex не получает.
2. `src/main/mcp/http-server.ts` отдаёт tools Integration-а с фильтром Project-а и меткой в описании — тот же
   `McpServer`, что у Claude.
3. Строки Codex в chip-е «MCP n/m» (`src/shared/agent/mcp-status.ts`): источник `integration` и метка; статус
   `needs-sign-in` виден в строке.
4. Session Codex вне Project-а Integration-ов не получает.

## Готово, когда

- [ ] Contract `test/contract/integrations-codex.test.ts` (новый) на fake app-server-е
      (`test/fixtures/codex-app-server/`): `thread/start` Session Project-а держит `mcp_servers.<имя>` каждой
      включённой Integration-ы с `bearer_token_env_var`; две Integration-ы на одном адресе сервиса — два имени, каждая
      отвечает своими данными через stub `test/fixtures/integrations/`. Красный до правки — в «Итог».
  - evidence: test-run pass · `pnpm test test/unit/codex-mcp-row.test.ts test/contract/integrations-codex.test.ts` exit 0 · mac - · 0789154c9
- [ ] Тот же contract: значение token-а сервиса не появляется в аргументах процесса Codex, в `config` `thread/start`, в
      логе main, в Journal и в Flight recorder; фильтр tools режет `tools/list` и `tools/call` endpoint-а.
  - evidence: test-run pass · `pnpm test test/contract/integrations-codex.test.ts` exit 0 · mac - · 0789154c9
  - evidence: test-run pass · `pnpm test test/contract/integrations-codex.test.ts` exit 0 · mac - · b9685624d
- [ ] `test/unit/codex-mcp-row.test.ts`: строка Integration с источником `integration` и меткой.
  - evidence: test-run pass · `pnpm test test/unit/codex-mcp-row.test.ts` exit 0 · mac - · 0789154c9
- [ ] Настоящий binary Codex test-ы не запускают (`grep` по новым test-ам: только fake app-server).
  - evidence: commit pass · worfy-integrations/07: Integrations in the Codex Session through worfy's endpoint · - - · 0789154c9
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 0789154c9
  - evidence: gate pass · `gate fast` exit 0 · mac - · 0789154c9
  - evidence: gate pass · `gate fast` exit 0 · mac - · b9685624d
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44858054685/job/136718193369 · ci - · e9cb26edddfbdc6d913f2334986e860acee61d26

## Где в коде

- `src/main/vendors/codex/mcp.ts`, `src/main/mcp/http-server.ts`
- `src/shared/agent/mcp-status.ts`
- `test/contract/integrations-codex.test.ts` (новый), `test/unit/codex-mcp-row.test.ts`

Только читать: `src/main/integrations/proxy.ts` (06), `src/main/vendors/codex/protocol/`, `test/contract/mcp-http.test.ts`,
`test/contract/codex-session-mcp.test.ts`.

## Вне скоупа

- Применение `mcp.allowed` к серверам пользователя в Codex (Q8 worfy-mcp-live) и запись `config.toml` — вне Epic-а.
  Sign in у строки в chip-е — Ticket 09.

## Итог

Endpoint `src/main/mcp/http-server.ts` отдаёт сервер с `listTools()` — сервер Integration-ы из proxy Ticket-а 06:
`tools/list` и `tools/call` идут по одному списку, уже срезанному фильтром Project-а и с меткой в описании; вызов
срезанного tool-а отказывает до сервиса; подсказки MCP сервиса (`readOnlyHint`) идут дальше; отказ списка («Sign-in
needed», когда списка не было) — ошибка JSON-RPC с его текстом. `src/main/vendors/codex/mcp.ts`: `codexIntegrations`
берёт включённые Integration-ы Project-а тем же путём, что Session Claude (`sessionIntegrations`: имя сервера, фильтр,
Autopilot только с флажком), и `codexMcpSessions` кладёт их в `config` `thread/start` ключами `mcp_servers.<имя>` с
адресом endpoint-а и `bearer_token_env_var: WORFY_MCP_TOKEN` — один token Session на все серверы, путь `/mcp/<имя>`
различает их. Session вне Project-а их не получает. Строки chip-а (`codexIntegrationRow`, на выходе handle — событие
`mcp` и `codexMcpStatus()`): источник `integration` и метка; отказ входа proxy — `needs-auth` с текстом «Sign-in
needed: <метка>…»; действие только Reconnect; Sign in Codex для Integration-ы — `McpActionRefused`.

Красный до правки: `pnpm test test/unit/codex-mcp-row.test.ts test/contract/integrations-codex.test.ts` — exit 1 (13 из
23 упали: нет `codexIntegrations` и `codexIntegrationRow`). После — exit 0 (24 test-а). 15 mutant-ов кода, по одному на
поведение, — каждый exit 1 на этих двух файлах. Unit и contract test-ы затронутых модулей (`vendors/codex`,
`integrations`, `mcp`, `mcp-status`; 72 файла, 1290 test-ов) — exit 0. `pnpm test:e2e test/e2e/codex-session.spec.ts
test/e2e/codex-sessions-on-canvas.spec.ts test/e2e/session-mcp.spec.ts` под `/tmp/worfy-e2e.lock` — exit 0. Настоящий
Codex test-ы не запускают: `grep` по новым test-ам — только fake app-server (`WORFY_CODEX=fake`, `scriptNode()`). Token
сервиса проверен в аргументах и окружении процесса Codex, во всём журнале fake (там и `config` `thread/start`), в
`console` main и логе драйвера, в событиях Session (их читают Journal и Flight recorder) и в ответах endpoint-а (их
хранит транскрипт Codex); Autopilot-ом Journal и Flight recorder отдельно не прогонялись. Страницы
`docs/features/mcp-servers.md` (Codex) и `docs/features/vendors.md` дополнены.

Раунд 1 ревью PR #2128: отмена вызова. До правки `pnpm test test/contract/integrations-codex.test.ts` — exit 1 (2 новых
test-а: закрытое соединение и `notifications/cancelled`); после — exit 0 (13). Пять mutant-ов (без signal у tool-а,
закрытие соединения не отменяет, `notifications/cancelled` не читается, отмена чужой Session, отмена по любому id) —
каждый exit 1.

Решено без владельца:
1. Метки и отказ входа — на выходе handle (`observe` в `mcp.ts`), без правки `src/main/vendors/codex/session.ts` (не в
   «Где в коде»): строки, которые Session хранит, остаются как их дал Codex. Цена: событие `mcp` уходит, только когда
   изменились строки Codex; одна смена статуса proxy его не шлёт, chip узнаёт её при следующем чтении (открытие
   popover-а).
2. Отказ входа виден как `needs-auth` (в `McpServerRow` нет `needs-sign-in`) с текстом `signInNeeded(<метка>)`; у
   `pending` и `disabled` строка остаётся как у Codex. Действие — только Reconnect: `mcpServer/oauth/login` Codex вошёл
   бы в endpoint worfy, а не в сервис. Sign in у строки — Ticket 09.
3. Имена серверов — те же, что у Claude (занятые — серверы Claude Code из инвентаря). Сервер пользователя в
   `config.toml` Codex с тем же именем ключ `mcp_servers.<имя>` в этой Session заменит: `config.toml` worfy не читает.
   Долг для Ticket-а 09 (ревью PR #2128, раунд 1): замена молчаливая (`src/main/vendors/codex/mcp.ts:404`), а строка
   Claude при совпадении имени несёт предупреждение (`src/main/integrations/proxy.ts:101`).
4. Integration-ы идут вместе с canvas, как у Claude: Session, у которой canvas не нашёл Project, их не получает; список
   Profile-а без `worfy-canvas` их не отменяет. С одними Integration-ами `developerInstructions` — `null`: Codex
   оставляет инструкции своего config, а не получает пустую строку.
5. Вызов срезанного tool-а — ошибка JSON-RPC «Unknown tool», как у своих tools worfy, а не ответ `isError`, как у
   Claude.
6. Отмена вызова агентом доходит до сервиса (ревью PR #2128, раунд 1, вместо прежнего «не передаёт»): каждый
   `tools/call` endpoint-а получает signal, его отменяет закрытие соединения запроса до ответа (Stop, закрытая Session,
   предел Codex) и `notifications/cancelled` с id вызова от той же Session к тому же серверу. Id, повторённый, пока его
   вызов идёт, оставляет отменяемым только новый вызов (`shortcut:` в `http-server.ts`).
7. `src/shared/agent/mcp-status.ts` не менялся: источника `integration` и `label` Ticket-а 06 хватает.
8. Вне «Где в коде»: сценарий fake `test/fixtures/codex-scripts/integrations.jsonl` (его проверяет
   `test/contract/codex-fake.test.ts` по схеме 0.166.0), страницы `docs/features/mcp-servers.md` и `vendors.md`.
