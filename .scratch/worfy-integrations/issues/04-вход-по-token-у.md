# 04 — Вход по token-у: Bearer, Basic, свой заголовок, переменные-секреты stdio и token `gh` в `SecretStore`, проверка `initialize`, Sign out

Type: task
Status: open
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Волны», Wave 2; «Решение», 3; «Факты», 5 и 7; «Решения по реализации»
→ Вход по token-у, Где лежит; «Решения по test-ам»; «Риски» (admin клиента запретил); «Вопросы владельцу», Q3 и Q10;
[critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md), возражение 3

Кто: агент.

Не платформенный Ticket (`src/main/`; stdio-процесс здесь не запускается — только хранение его секретов). Глубина ревью
— `high`: секреты.

## Что происходит

- Q10 (а), ответ владельца 2026-11-20: первая рабочая Integration — по token-у; две Jira в двух Project-ах работают
  после Ticket-ов 03, 04, 06 и 08 (конец Wave 4). OAuth — Ticket 05.
- Token покрывает Linear (API key Bearer), GitHub (PAT в `Authorization: Bearer`), Notion (MCP token на Business и
  Enterprise) и Atlassian (Basic e-mail:API token, у service account — Bearer); token Atlassian не привязан к site
  (Факты 5 и 7).
- Оговорка Факта 5: Atlassian API token работает, только если admin организации клиента включил вход по token-у
  (Admin → Rovo → Rovo MCP server → Authentication); без этого Jira клиента входит только по OAuth.
- Хранилище и ключи `<id>:access`, `<id>:env:<NAME>` — Ticket 03 (`src/main/integrations/store.ts`, `FileSecretStore`).
- Token аккаунта `gh` worfy уже знает для Project-а (`accountAuth`, `src/main/github/prs.ts`).

## Что делаем

1. `src/main/integrations/auth/tokens.ts` (новый): Bearer (Linear API key, GitHub PAT, Notion MCP token, Atlassian
   service account), Basic (Atlassian e-mail и API token), свой заголовок (Custom server), переменные-секреты stdio — в
   `SecretStore` под ключами Ticket-а 03. Функция заголовка входа для proxy (Ticket 06) читает `SecretStore` при каждом
   соединении.
2. Проверка: `initialize` сервиса с этим заголовком (`Client` пакета `@modelcontextprotocol/sdk` или прямой `POST`); 401
   и 403 → статус `needs-sign-in` или `error` с текстом сервиса без token-а; у Atlassian — текст отказа и ссылка на
   страницу admin-а, а не «error».
3. GitHub: предложение token-а аккаунта `gh` Project-а с предупреждением о его scope-ах. Как proxy получает этот
   token — через `accountAuth` при каждом соединении или копией в `SecretStore` — решает implementer по коду
   `accountAuth`; выбор и причина — в «Итог».
4. Sign out для token-а: удаление ключей `<id>:*` из `SecretStore`, статус `needs-sign-in`.
5. Каталог (`src/shared/integrations/catalogue.ts`): у Atlassian API token — пометка «works only if your organization
   admin turned on API token sign-in» и ссылка на страницу token-ов.
6. Канал `integrations.setSecret` (`'local'`, Ticket 03) пишет секрет и запускает проверку; ответ — статус, не секрет.
7. Stub-ы `test/fixtures/integrations/` (новые, общие для Epic-а): streamable HTTP на `127.0.0.1`, проверяет Bearer,
   Basic и свой заголовок; stdio-сервер, который читает секрет из окружения.

## Готово, когда

- [ ] Unit `test/unit/integrations-auth-headers.test.ts` (новый): Bearer, Basic (base64 e-mail:token), свой заголовок,
      переменные-секреты stdio — в окружении, не в `args`. Красный до правки — в «Итог».
- [ ] Contract `test/contract/integrations-token-auth.test.ts` (новый) на stub-е: верный token → `signed-in` и
      `initialize` прошёл; неверный → `needs-sign-in`; 403 с текстом → `error` с этим текстом; две Integration-ы на
      одном адресе stub-а с разными token-ами проверяются каждая своим token-ом; Sign out удаляет ключи `<id>:*`.
- [ ] Тот же contract: token не появляется в `integrations.json`, в ответе канала, в логе main и в Journal (поиск
      значения token-а — пусто).
- [ ] Тот же contract: `integrations.setSecret` с Linked machine (любой уровень доступа) — отказ.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/integrations/auth/tokens.ts` (новый)
- `src/shared/integrations/catalogue.ts`, `src/main/ipc/integrations.ts`
- `test/fixtures/integrations/` (новые stub-ы)
- `test/unit/integrations-auth-headers.test.ts`, `test/contract/integrations-token-auth.test.ts` (новые)

Только читать: `src/main/integrations/store.ts` (Ticket 03), `src/main/link/secrets.ts`, `src/main/github/prs.ts`
(`accountAuth`), `src/shared/terminal-ai/redact.ts` (`redactSecrets`).

## Вне скоупа

- OAuth — Ticket 05; соединение proxy с сервисом — 06; поле ввода token-а на экране — 08. Slack-token-ы любого вида —
  никогда (Q6).

## Итог

Пусто до завершения Ticket-а.
