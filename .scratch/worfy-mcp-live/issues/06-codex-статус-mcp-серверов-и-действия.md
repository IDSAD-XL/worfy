# 06 — Codex: статус MCP-серверов и действия

Type: task
Status: claimed 2026-11-12T01:27Z
Blocked by: 02
Source: [spec.md](../spec.md), «Ticket-ы», строка 06; «Решения владельца» Q4, Q5, Q8, Q10; «Что уже есть в SDK и в
протоколе Codex»; «Не в этом Epic-е» (список для Codex); история 10

## Что происходит

- Codex Session получает от worfy только `worfy-canvas` и `worfy-browser` по списку Profile
  (`src/main/vendors/codex/mcp.ts:143–154`); серверы пользователя из конфигурации Codex остаются как есть, их статус
  worfy не читает.
- Протокол app-server-а 0.166.0 (`src/main/vendors/codex/protocol/`) даёт `mcpServerStatus/list`,
  `config/mcpServer/reload`, `mcpServer/oauth/login`, уведомления `mcpServer/startupStatus/updated` и
  `mcpServer/oauthLogin/completed`. worfy их не зовёт и не слушает.
- После Ticket-а 02 у `McpPart` есть `status` и `act`, у renderer-а — событие `mcp`; chip рисует Ticket 04.
- Владелец решил (Q8, вариант а): Codex показывает свои серверы пользователя как есть, без «не разрешён» и без Allow.

## Что делаем

1. `status` Codex в `src/main/vendors/codex/mcp.ts`: `mcpServerStatus/list` и уведомление
   `mcpServer/startupStatus/updated` сводятся к той же строке. `starting` → pending, `ready` → connected, `failed` и
   `cancelled` → failed; `authStatus: notLoggedIn` → needs-auth. Свои серверы worfy — источник worfy, остальные — user
   config. Статуса `not-allowed` и действия `allow` у строк Codex нет.
2. `act` Codex: `reconnect` и подхват нового сервера — `config/mcpServer/reload`, как решил spike.
3. Если `config/mcpServer/reload` не доходит до начатого thread-а, новый сервер Codex появляется через `restart` —
   общий путь Ticket-а 03 (`SessionRegistry.start` принимает `vendor`; resume того же thread-а после выхода старого
   процесса). 03 и 06 идут в одной Wave: Ticket, который вливается вторым, добавляет `restart` к таким строкам Codex и
   contract test на это.
4. `sign-in` — `mcpServer/oauth/login`: вход в системном браузере, завершение по `mcpServer/oauthLogin/completed`.
5. `turn-off` для этой Session — если spike нашёл способ в протоколе; если нет, у строк Codex этого действия нет, и
   «Итог» это говорит.
6. Fake app-server (`test/fixtures/codex-app-server/fake-app-server.mjs`) отвечает на эти запросы по fixture-ам spike-а
   и шлёт уведомления по сценарию test-а.

## Готово, когда

- [ ] Contract test `test/contract/codex-mcp-status.test.ts` над fake app-server: событие `mcp` со строками после
      `mcpServerStatus/list`; уведомление `mcpServer/startupStatus/updated` меняет строку; `reconnect` зовёт
      `config/mcpServer/reload`; `sign-in` зовёт `mcpServer/oauth/login` и завершается по уведомлению; ни у одной
      строки нет `not-allowed` и `allow`. Красный до правки — в «Итог».
  - evidence: test-run pass · `vitest run test/contract/codex-mcp-status.test.ts` exit 0 · mac - · a040aea2e1af09d515615f2b03e9967b4fcabe20
- [ ] Существующие `test/contract/codex-session-mcp.test.ts` и `test/contract/codex-mcp-app.test.ts` зелёные.
  - evidence: test-run pass · `vitest run test/contract/codex-session-mcp.test.ts test/unit/codex-mcp-app.test.ts` exit 0 · mac - · a040aea2e1af09d515615f2b03e9967b4fcabe20
- [ ] `test/contract/codex-compat.test.ts` держит форму этих запросов и уведомлений версии 0.166.0.
  - evidence: test-run pass · `vitest run test/contract/codex-compat.test.ts test/contract/codex-fake.test.ts` exit 0 · mac - · a040aea2e1af09d515615f2b03e9967b4fcabe20
- [ ] Ни один test не запускает настоящий Codex; `WORFY_CODEX=fake` с временным `CODEX_HOME`.
  - evidence: test-run pass · `vitest run test/contract/codex-fake.test.ts` exit 0 (launch.ts starts only the fake under the tests) · mac - · a040aea2e1af09d515615f2b03e9967b4fcabe20
- [ ] Все unit и contract test-ы модуля `src/main/vendors/codex/` зелёные; lint, typecheck и gate fast — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · a040aea2e1af09d515615f2b03e9967b4fcabe20
  - evidence: gate pass · `gate fast` exit 0 · mac - · cc1d8b766c2844cc1fc093048345b772ccf362c3

## Где в коде

- `src/main/vendors/codex/mcp.ts`
- `src/main/vendors/codex/session.ts`
- `test/fixtures/codex-app-server/fake-app-server.mjs`
- `test/contract/codex-mcp-status.test.ts` (новый)
- `test/contract/codex-compat.test.ts`

## Вне скоупа

- Применять `mcp.allowed` к серверам пользователя в Codex: решение о цене, отложено (Q8, «Не в этом Epic-е» spec-а).
- UI: тот же chip из Ticket-а 04, правок renderer-а нет.

## Итог

- Красный до правки: `vitest run test/contract/codex-mcp-status.test.ts` — 5 из 5 красные: событий `mcp` у Codex нет
  («not in time: the rows of the startup notifications»), `codexMcp.status is not a function`, `agent.mcpAction`
  Session Codex отклоняется `McpActionRefused` (у `codexMcp` не было `act`).
- Когда спрашивается статус. Записи живого Codex 0.166.0 (`test/fixtures/codex-messages/turn.jsonl` и другие) шлют
  `mcpServer/startupStatus/updated` с `threadId` на каждый сервер нового thread-а: `starting`, затем `ready`. Поэтому
  строка меняется сразу по уведомлению, а `mcpServerStatus/list {threadId}` (все страницы) Session спрашивает, когда ни
  один сервер больше не стартует, — за числом tools и состоянием входа. Ещё список спрашивается по запросу
  (`agent.mcp`) и после действия (`Session.mcpAction`). После каждого хода, как у Claude, Codex список не спрашивает:
  смены статуса приходят уведомлениями. Уведомления, пришедшие до ответа на `thread/start`, берутся после него; чужой
  thread (Subagent) не учитывается. Session без MCP-серверов не шлёт `mcp` и не спрашивает список сама — старые
  сценарии fake-а не изменились.
- Сведение к строке (`src/main/vendors/codex/mcp.ts`): `runtimeStatus` `notStarted`/`starting`/null → pending,
  `connected` → connected, `authenticationRequired` → needs-auth, `failed`/`cancelled` → failed, `disabled` →
  disabled; `authStatus: notLoggedIn` у неподключённого сервера → needs-auth (подключённый остаётся connected).
  Уведомление: `starting` → pending, `ready` → connected, `failed`/`cancelled` → failed, `failureReason:
  reauthenticationRequired` → needs-auth. Источник: серверы, которые worfy отдал этой Session (`mcp_servers.<имя>` в
  `config`), — worfy, остальные — user config; сервер plugin-а Codex — user config со словом `plugin` для tooltip-а.
- Действия: `reconnect` у failed (и у needs-auth сервера без HTTP) — `config/mcpServer/reload`; `sign-in` у needs-auth
  HTTP-сервера — `mcpServer/oauth/login {name, threadId}`, страница входа открывается в системном браузере (только
  http/https), действие завершается по `mcpServer/oauthLogin/completed` (неуспех — ошибка со словами Codex, предел
  ожидания 10 минут, как у входа в сам Codex). `not-allowed` и `allow` у строк Codex нет (Q8).
- `turn-off` у строк Codex нет: в протоколе 0.166.0 нет способа выключить сервер только для одного thread-а —
  `config/value/write` меняет `config.toml` пользователя для всех Session.
- `restart` к строкам Codex не добавлен: Ticket 03 ещё не влит, а по пункту 3 тикета `restart` и contract test на него
  добавляет тот Ticket, который вливается вторым.
- Fake app-server кода не менял: его шаги `expect`/`notify` уже играют любые методы. Новые сценарии —
  `test/fixtures/codex-scripts/mcp-status.jsonl` и `mcp-action.jsonl` с придуманными именами серверов.
- Вне списка «Где в коде» правлены: `test/contract/codex-fake.test.ts` (ответ `config/mcpServer/reload` — запроса без
  params — сверяется с `McpServerRefreshResponse`, как в `codex-compat`), `test/unit/codex-mcp-row.test.ts` (новый,
  сведение к строке), два сценария fake-а выше.
