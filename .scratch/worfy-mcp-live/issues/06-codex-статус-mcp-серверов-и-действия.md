# 06 — Codex: статус MCP-серверов и действия

Type: task
Status: open
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
- [ ] Существующие `test/contract/codex-session-mcp.test.ts` и `test/contract/codex-mcp-app.test.ts` зелёные.
- [ ] `test/contract/codex-compat.test.ts` держит форму этих запросов и уведомлений версии 0.166.0.
- [ ] Ни один test не запускает настоящий Codex; `WORFY_CODEX=fake` с временным `CODEX_HOME`.
- [ ] Все unit и contract test-ы модуля `src/main/vendors/codex/` зелёные; lint, typecheck и gate fast — exit 0.

## Где в коде

- `src/main/vendors/codex/mcp.ts`
- `src/main/vendors/codex/session.ts`
- `test/fixtures/codex-app-server/fake-app-server.mjs`
- `test/contract/codex-mcp-status.test.ts` (новый)
- `test/contract/codex-compat.test.ts`

## Вне скоупа

- Применять `mcp.allowed` к серверам пользователя в Codex: решение о цене, отложено (Q8, «Не в этом Epic-е» spec-а).
- UI: тот же chip из Ticket-а 04, правок renderer-а нет.
