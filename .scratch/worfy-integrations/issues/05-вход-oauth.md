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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/integrations-oauth.test.ts` exit 0 · mac - · 404167efa
- [ ] Тот же contract: истёкший access token обновляется без Restart Session — следующий `tools/call` через proxy
      проходит; 10 параллельных вызовов дают один запрос refresh на stub-е; неудачный refresh → `needs-sign-in` и ответ
      tool-а `isError` «Sign-in needed: <метка>…».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/integrations-oauth.test.ts` exit 0 · mac - · 404167efa
- [ ] Тот же contract: две Integration-ы на одном адресе stub-а — два разных client id, два partition, у каждой свои
      token-ы.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/integrations-oauth.test.ts` exit 0 · mac - · 404167efa
- [ ] Тот же contract: Sign out зовёт revocation endpoint stub-а, удаляет ключи `<id>:*` и чистит partition; token не
      появляется в `integrations.json`, в логе main, в Journal и в Flight recorder.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/integrations-oauth.test.ts` exit 0 · mac - · 404167efa
- [ ] Unit `test/unit/integrations-oauth-redirect.test.ts` (новый): перехват `http://127.0.0.1/worfy-oauth/<id>` только
      для своего `<id>` и `state`; loopback listener закрывается после ответа и через 10 минут.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/integrations-oauth-redirect.test.ts` exit 0 · mac - · 404167efa
- [ ] `integrations.signIn` с Linked machine Read only — отказ; Full access — разрешён (тот же contract).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/integrations-oauth.test.ts` exit 0 · mac - · 404167efa
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

Вход OAuth — `src/main/integrations/auth/oauth.ts`, `IntegrationOAuth`. Протокол — пакета `@modelcontextprotocol/sdk`
1.32.0 (`auth()`: discovery RFC 9728 и RFC 8414, DCR, PKCE S256, `resource`); worfy пишет provider-а над `SecretStore`
(`<id>:client` — JSON клиента с `issuer`, `<id>:access`, `<id>:refresh`; code verifier — в памяти на время входа), окно и
redirect. `signIn(id, { via })`: окно `BrowserWindow` на partition `persist:integration-<id>` (`windowOpener`; запрос к
`http://127.0.0.1/worfy-oauth/*` отменяет hook запросов окна, вход завершает только redirect своего `<id>` и `state`; окно
закрывается после обмена code) или системный браузер (`listenLoopback`: `127.0.0.1`, случайный порт, 404 на чужое,
закрывается после ответа или через 10 минут). Scope — каталога, явно в `auth()`; Linear в каталоге — `read write`.
Повторный вход клиента заново не регистрирует. `signOut(id)`: revocation (refresh, затем access) при наличии endpoint-а,
удаление `<id>:*`, `signIn: null`, `clearStorageData()` partition-а. Канал `integrations.signIn` (`project`, `write`,
вход `via: 'window' | 'browser'`) отвечает `signIn` без token-ов.

Proxy (`src/main/integrations/proxy.ts`) берёт `IntegrationOAuth.transport()` по умолчанию: `authProvider` пакета и
`fetch` с замком refresh. Замок: 401 запоминается против access token-а; refresh уходит к сервису, только если хранимый
access token отказан и этим refresh token-ом ещё не ходили; остальные получают копию ответа идущего refresh или хранимые
token-ы — refresh token не уходит дважды. Fingerprint соединения OAuth — момент входа (refresh соединение не меняет);
отказ входа больше не закрывает соединение под идущими вызовами (они отвечают «Sign-in needed», а не «Connection
closed»); ответ tool-а очищается и от token-ов, обновлённых на этом соединении. Окно входа `src/main/window.ts`
(`allowSignInNavigation`) пускает на любые адреса сервиса — иначе стена навигации main закрыла бы форму входа; новые
окна и разрешения остаются запрещены (`guardBrowserSession`).

Красный до правки: те же три файла test-ов на коде `origin/main` 37a931f63 — exit 1 (`integrations-oauth.test.ts` и
`integrations-oauth-redirect.test.ts` — модуля `oauth.ts` нет; `web-policy.test.ts` — `allowSignInNavigation is not a
function`). После правки — exit 0. Mutation testing — 26 mutant-ов кода `oauth.ts`, `proxy.ts`, канала и `window.ts`,
все убиты (замок: без копии идущего refresh, повтор отработанного refresh token-а, refresh при неотказанном access
token-е, 401 не запомнен, повтор старого ответа после нового отказа; scope; токены при повторном входе; `state` и `<id>`
redirect-а; окно и listener без 10 минут и не закрываются; общий partition; Sign out без revocation, без удаления ключей,
без partition; `invalid_grant` стирает клиента; proxy закрывает соединение при отказе, fingerprint по access token-у,
без OAuth по умолчанию, без очистки обновлённого token-а; канал `read`; стена навигации без исключения). Все unit и
contract test-ы затронутых модулей (30 файлов) — exit 0. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0;
`gate fast` — exit 0, `[gate] green (fast)` на 404167efa. e2e test-а Integrations нет (вход с экрана — Ticket 09).

Решено без владельца:
1. Замок refresh — в `fetch` transport-а (вывод spike-а 01, шаг 5), и строже «одного refresh за раз»: отработанный
   refresh token не уходит никогда, а refresh при неотказанном хранимом access token-е отвечается хранимыми token-ами —
   так закрыта гонка «401 пришёл после того, как другой вызов уже обновил token».
2. Scope: явный — из каталога. Linear — `read write` (живой вход spike-а). Atlassian — пусто, то есть список metadata:
   именно так прошёл живой вход владельца (`offline_access` и права чтения и записи, refresh token с ротацией);
   угаданный короткий список мог бы сломать вход (решение Orchestrator-а 2026-11-21).
3. Proxy окна не открывает никогда: provider proxy не регистрирует клиента и не уходит на страницу входа; Integration
   без access token-а отвечает «Sign-in needed» без запроса к сервису.
4. DCR регистрирует redirect URI окна без порта; вход в системном браузере шлёт тот же путь с портом listener-а —
   RFC 8252 7.3 велит серверу принимать любой порт loopback-адреса.
5. Аккаунт и site во входе — `null`: стандартного способа узнать их из ответа token-а нет.
6. «Open in system browser» — значение `via: 'browser'` канала; ссылку на экране ставит Ticket 09 рядом с Sign in.
7. Sign out — функция main (`signOut`), канал для экрана — Ticket 08, как Sign out token-а Ticket-а 04.

Второй круг ревью (FIX, три находки):
1. Ложный «Sign-in needed» во время refresh: 401 вызова B, ушедшего со старым token-ом, приходил после refresh вызова A,
   и transport пакета (`_hasCompletedAuthFlow`) бросал `Server returned 401 after successful authentication`. Теперь
   `fetch` замка шлёт такой запрос ещё раз, один, с хранимым token-ом. Test — та же раскладка времени задержками stub-а:
   оба вызова отвечают, один refresh, статус `signed-in`.
2. Ответ refresh 200 без access token-а (страница ошибки) больше не запирает Integration: он забывается, как 5xx, и
   следующий refresh снова идёт к сервису (`stub.refreshes()` — 2, вызов проходит). Механизм отличается от
   предложенного ревью («снимать `pending`, когда ответ отдан»): снятие `pending` для хорошего ответа открыло бы гонку
   refresh-а, пришедшего до `saveTokens`, — он ушёл бы к сервису с отработанным refresh token-ом.
3. Окно входа считалось окном worfy: `src/main/sign-in-windows.ts` (`markSignInWindow`, `appWindows`); `activate`
   (иконка Dock), `second-instance` (второй запуск, та же ошибка в `index.ts`) и `openNote` (щелчок по notification)
   пропускают окна входа.

Красный до правки: три новых test-а (`integrations-oauth.test.ts` — 2, `startup-failure.test.ts` и `notify.test.ts` —
по одному) — exit 1 на 383e23125, exit 0 после правки. Mutation testing — 6 новых mutant-ов (без повтора 401, без
забывания ответа без token-ов, `activate`, `second-instance`, `openNote`, `appWindows` без фильтра; старые mutant-ы
`401 не запомнен` и стены навигации — по новому коду), все убиты; весь набор — 32 mutant-а.

Долг: `integrations.remove` не отзывает token-ы OAuth-Integration и не чистит её partition — Ticket 08 или 09.
