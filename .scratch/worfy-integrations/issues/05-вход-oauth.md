# 05 — Вход OAuth: `OAuthClientProvider` пакета `@modelcontextprotocol/sdk` над `SecretStore`, окно worfy с partition, «Open in system browser», Sign out с revocation, канал `integrations.signIn`

Type: task
Status: claimed 2026-11-21T01:51Z
Branch: worfy-integrations/05
Blocked by: 01, 03, 06
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Волны», Wave 4; «Решение», 3; «Как пользователь идёт по экранам», 4 и
10; «Факты», 3а, 5, 7 и 8; «Решения по реализации» → Proxy, Вход OAuth; «Риски» (сервис закроет DCR, admin клиента
запретил); «Вопросы владельцу», Q4, Q5 и Q10; [critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md),
возражения 2 и 3

Кто: агент.

Не платформенный Ticket (`src/main/`; окно Electron и loopback listener без веток по платформе). Глубина ревью —
`high`: token-ы OAuth, redirect и refresh.

## Что происходит

- Q4 (а): вход идёт в окне worfy со своим cookie partition на каждую Integration — второй аккаунт Atlassian не
  подхватывает вход первого; ссылка «Open in system browser» — для SSO и passkey.
- Q5 (а): регистрация клиента — Dynamic Client Registration на каждую Integration; она работает у Atlassian, Linear,
  Notion, Sentry (Факт 7). Client ID Metadata Document не публикуется («Не в этом Epic-е»).
- Возражение 2 critic-а: протокол не пишется заново. `OAuthClientProvider` пакета `@modelcontextprotocol/sdk` 1.32.0
  (`dist/esm/client/auth.d.ts:15`; `discoverOAuthProtectedResourceMetadata`, `startAuthorization` с `resource`,
  `refreshAuthorization`, `registerClient` — строки 268, 361, 418, 466; `clientMetadataUrl` — `:25`) делает discovery
  RFC 9728 и RFC 8414, DCR, PKCE S256 и `resource` (RFC 8707). worfy пишет только provider-а над `SecretStore`, окно и
  redirect.
- Ticket 06 оставил место `authProvider` у `StreamableHTTPClientTransport` proxy пустым; transport сам обновляет
  истёкший access token и бросает `UnauthorizedError`, когда не может (`dist/esm/client/streamableHttp.d.ts:62-73`).
- Записка spike-а 01 (`.scratch/worfy-integrations/spike-integrations.md`) говорит, делает ли пакет один refresh при
  параллельных вызовах; если нет, provider держит замок сам.
- Q10 (а): кнопку Sign in на экран и в chip ставит Ticket 09; этот Ticket даёт канал.

## Что делаем

1. `src/main/integrations/auth/oauth.ts` (новый): provider — реализация `OAuthClientProvider` над `SecretStore`
   Ticket-а 03: client id и secret (`<id>:client`), token-ы (`<id>:access`, `<id>:refresh`), code verifier (в памяти
   на время входа). Dynamic Client Registration — один раз на Integration. Замок refresh — по выводу записки 01.
2. Окно входа — `BrowserWindow` с partition `persist:integration-<id>`; redirect `http://127.0.0.1/worfy-oauth/<id>`
   перехватывается событием навигации окна, без listener-а; окно закрывается само после обмена code на token.
3. «Open in system browser»: loopback listener на `127.0.0.1` со случайным портом (RFC 8252), ждёт до 10 минут, потом
   закрывается.
4. Provider вставляется в `authProvider` transport-а proxy (`src/main/integrations/proxy.ts`, Ticket 06):
   refresh живёт в transport-е, не в своём коде; `UnauthorizedError` → статус `needs-sign-in` и ответ tool-а
   «Sign-in needed: <метка>…».
5. Канал `integrations.signIn` (`'project', 'write'`; окно открывается на Machine Project-а): запускает вход; ответ —
   видимые данные входа (аккаунт, site), без token-ов. Session без человека (Autopilot) этот канал не зовёт — правило
   держит Ticket 09.
6. Sign out для OAuth: revocation endpoint, если сервис его даёт; удаление ключей `<id>:*` из `SecretStore`;
   `session.fromPartition('persist:integration-<id>').clearStorageData()`.
7. Stub `test/fixtures/integrations/` растёт: 401 с `resource_metadata`, `/.well-known/oauth-protected-resource`,
   `/.well-known/oauth-authorization-server`, DCR, PKCE S256 с проверкой `code_verifier`, `resource`, refresh,
   revocation.

## Готово, когда

- [ ] Contract `test/contract/integrations-oauth.test.ts` (новый) на stub-е: discovery, DCR один раз на Integration,
      PKCE S256 и `resource` в запросах авторизации и token-а; token-ы ложатся в `SecretStore` под ключами `<id>:…`.
      Красный до правки — в «Итог».
- [ ] Тот же contract: истёкший access token обновляется без Restart Session — следующий `tools/call` через proxy
      проходит; 10 параллельных вызовов дают один запрос refresh на stub-е; неудачный refresh → `needs-sign-in` и ответ
      tool-а `isError` «Sign-in needed: <метка>…».
- [ ] Тот же contract: две Integration-ы на одном адресе stub-а — два разных client id, два partition, у каждой свои
      token-ы.
- [ ] Тот же contract: Sign out зовёт revocation endpoint stub-а, удаляет ключи `<id>:*` и чистит partition; token не
      появляется в `integrations.json`, в логе main, в Journal и в Flight recorder.
- [ ] Unit `test/unit/integrations-oauth-redirect.test.ts` (новый): перехват `http://127.0.0.1/worfy-oauth/<id>` только
      для своего `<id>` и `state`; loopback listener закрывается после ответа и через 10 минут.
- [ ] `integrations.signIn` с Linked machine Read only — отказ; Full access — разрешён (тот же contract).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/integrations/auth/oauth.ts` (новый)
- `src/main/integrations/proxy.ts` (место `authProvider`, Ticket 06)
- `src/shared/ipc/integrations.ts`, `src/main/ipc/integrations.ts` (канал `integrations.signIn`)
- `test/fixtures/integrations/` (stub OAuth)
- `test/contract/integrations-oauth.test.ts`, `test/unit/integrations-oauth-redirect.test.ts` (новые)

Только читать: `node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.d.ts` и `streamableHttp.d.ts` (1.32.0),
`src/main/integrations/store.ts` (Ticket 03), `.scratch/worfy-integrations/spike-integrations.md` (Ticket 01),
`src/main/browser/` (как worfy держит partition Browser profile-а).

## Вне скоупа

- Кнопка Sign in на экране и в chip-е, запрет окна для Autopilot — Ticket 09. Client ID Metadata Document (Q5 (б)) —
  вне Epic-а. Slack — вне каталога (Q6).

## Итог

Пусто до завершения Ticket-а.
