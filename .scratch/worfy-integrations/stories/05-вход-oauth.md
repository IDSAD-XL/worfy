# Code story — worfy-integrations 05: Вход OAuth: `OAuthClientProvider` пакета `@modelcontextprotocol/sdk` над `SecretStore`, окно worfy с partition, «Open in system browser», Sign out с revocation, канал `integrations.signIn`

Kind: pr · Epic: worfy-integrations · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

Integration с входом `oauth` после Ticket-ов 03, 04 и 06 войти не могла: у transport-а proxy место `authProvider`
пустое, окна входа нет. Spike 01 (шаг 5) показал, что пакет MCP SDK при параллельных вызовах шлёт несколько refresh с
одним refresh token-ом, а Atlassian и Linear этот token ротируют — второй refresh получает `invalid_grant`, и пакет
стирает вход.

- Требование: [Что происходит](../issues/05-вход-oauth.md#что-происходит)

## 2. Замок refresh в `fetch` transport-а

Code: `src/main/integrations/auth/oauth.ts:489-536` · key lines: 501, 506, 515, 516, 520, 531

```ts
    return async (input, init) => {
      const state = this.lock(id)
      const spent = refreshTokenOf(init)
      if (spent === null) {
        const sent = bearerOf(init)
        const response = await base(input, init)
        if (response.status !== 401 || sent === null) return response
        // A 401 to a token another call has refreshed since this one went out: sent again, once, with the kept token.
        // The SDK's transport, which has just finished a sign-in for that other call, would take it for a refusal of
        // the new token and give up («Server returned 401 after successful authentication»).
        const kept = keptOf(this.store, id).access
        if (kept === undefined || kept === sent || state.refused.has(kept)) {
          state.refused.add(sent)
          return response
        }
        await response.body?.cancel()
        const headers = new Headers(init?.headers)
        headers.set('authorization', `Bearer ${kept}`)
        const again = await base(input, { ...init, headers })
        if (again.status === 401) state.refused.add(kept)
        return again
      }
      const kept = keptOf(this.store, id)
      const last = state.last
      // The refresh of this token on its way, or done and its access token not refused since: its answer. A service that
      // does not rotate the refresh token gets a new refresh with it once the access token it gave was refused.
      if (last?.from === spent && (last.pending || kept.access === undefined || !state.refused.has(kept.access))) return replay(await last.answer)
      if (kept.refresh !== spent) {
        // Spent by a refresh before this one, or signed out since: never sent again.
        return kept.access === undefined ? jsonAnswer(400, { error: 'invalid_grant', error_description: 'signed out' }) : this.keptAnswer(kept)
      }
      if (kept.access !== undefined && !state.refused.has(kept.access)) return this.keptAnswer(kept)
      const answer = base(input, init).then(async (response): Promise<Captured> => ({ status: response.status, headers: [...response.headers.entries()], body: await response.text() }))
      const current = { from: spent, answer, pending: true }
      state.last = current
      const forget = (): void => {
        if (state.last === current) state.last = null
      }
      try {
        const captured = await answer
        // A refusal (invalid_grant) stays the answer to this token; a failure of the service — a 5xx, or a 2xx with no
        // access token, such as an error page — lets a later refresh try again.
        if (captured.status >= 500 || (captured.status < 300 && !carriesAccessToken(captured.body))) forget()
        else if (captured.status >= 300) current.pending = false
        return replay(captured)
      } catch (error) {
        forget()
        throw error
```

- Что делает: обычный запрос идёт как есть, и 401 запоминается против access token-а, который он нёс; 401 на token,
  который другой вызов уже обновил, уходит ещё раз, один, с хранимым token-ом — до transport-а пакета он не доходит
  (тот после только что законченного входа принял бы его за отказ нового token-а). Запрос refresh:
  идущий или уже сделанный refresh этим же token-ом отдаёт копию своего ответа; отработанный refresh token (хранимый
  уже другой) к сервису не уходит — ответ хранимыми token-ами; хранимый access token ещё не отказан — тоже хранимые
  token-ы. Только refresh хранимым token-ом после отказа его access token-а идёт к сервису, один. Ответ сервиса 5xx или
  2xx без access token-а (страница ошибки) забывается: следующий refresh снова идёт к сервису.
- Почему здесь: spike 01, шаг 5 — «место — `fetch` transport-а»: у `OAuthClientProvider` нет места вокруг refresh.
  Ticket, «Что делаем», пункт 1 — замок по выводу записки.
- Без него: десять вызовов после истечения дают десять refresh одним token-ом, сервис с ротацией отвечает
  `invalid_grant`, Integration теряет вход.
- Требование: [Готово, когда, пункт 2](../issues/05-вход-oauth.md#готово-когда)
- Риски и пробелы test-ов: замок живёт в памяти процесса: два процесса worfy на одной Machine его не делят. Зазор
  «ответ refresh пришёл, token-ы ещё не сохранены» закрыт флагом `pending`; его mutant убит contract-ом, но саму гонку
  test не воспроизводит по времени. Гонку «401 второго вызова пришёл после refresh первого» test воспроизводит
  задержками stub-а.

## 3. Provider proxy не регистрирует клиента и не открывает окно

Code: `src/main/integrations/auth/oauth.ts:300-320` · key lines: 302, 307, 311

```ts
    clientInformation: async () => {
      const { client } = keptOf(store, id)
      if (client === undefined && signIn === undefined) return unauthorized('sign-in needed: no client is registered')
      return client
    },
    saveClientInformation: async (information) => {
      // The proxy only stamps the kept client with its issuer; a new registration is a sign-in's.
      if (signIn === undefined && keptOf(store, id).client?.client_id !== information.client_id) return unauthorized('sign-in needed: the client must register again')
      store.setSecret(id, 'client', JSON.stringify(information))
    },
    tokens: (): OAuthTokens | undefined => {
      if (signIn !== undefined) return undefined
      const kept = keptOf(store, id)
      if (kept.access === undefined) return undefined
      return {
        access_token: kept.access,
        token_type: 'Bearer',
        ...(kept.refresh === undefined ? {} : { refresh_token: kept.refresh }),
        ...(kept.client?.issuer === undefined ? {} : { issuer: kept.client.issuer }),
      }
    },
```

- Что делает: один provider на два случая. Без `signIn` (provider transport-а proxy) клиента без записи нет —
  `UnauthorizedError`, новую регистрацию не сохраняет, token-ы берёт из `SecretStore`. Во входе человека `tokens()`
  пусто, поэтому пакет идёт на страницу входа, а не в refresh; `issuer` token-ов — клиента, как пакет их пометил.
- Почему здесь: ADR-0111, пункт 7 — окно без человека не открывается никогда; Ticket, «Что делаем», пункт 4 —
  `UnauthorizedError` → `needs-sign-in`.
- Без него: вызов tool-а без входа регистрировал бы клиента у сервиса при каждом старте Session, а повторный Sign in
  делал бы refresh вместо нового входа (другой аккаунт не выбрать).
- Требование: [Что делаем, пункты 1 и 4](../issues/05-вход-oauth.md#что-делаем)
- Риски и пробелы test-ов: путь `invalid_client` (сервис забыл клиента) stub не играет; его закрывают два слоя —
  `clientInformation` и `saveClientInformation`, по отдельности mutant-ами не проверены.

## 4. Окно ловит только свой redirect

Code: `src/main/integrations/auth/oauth.ts:160-165` · key lines: 161, 162, 163

```ts
    hooks.onBeforeRequest((details, callback) => {
      if (!isSignInRedirect(details.url)) return callback({})
      callback({ cancel: true })
      const found = redirectOutcome(details.url, id, state)
      if (found !== null) end(found)
    })
```

- Что делает: любой запрос страницы окна к `http://127.0.0.1/worfy-oauth/*` отменяется — до 127.0.0.1 он не доходит;
  вход завершает только redirect своего `<id>` и своего `state`.
- Почему здесь: Ticket, «Что делаем», пункт 2 — redirect перехватывается событием окна, без listener-а; spike 01,
  шаг 6 проверил это на stub-е.
- Без него: redirect чужой Integration или подделанный `state` завершил бы вход чужим code.
- Требование: [Готово, когда, пункт 5](../issues/05-вход-oauth.md#готово-когда)
- Риски и пробелы test-ов: настоящий `BrowserWindow` в test-ах не открывается — unit и contract идут через stand-in
  Electron; на живом сервисе окно проверит приёмка (Ticket 11). Стену навигации main для этого окна снимает
  `allowSignInNavigation` (`src/main/window.ts`): без неё форма входа сервиса не ушла бы дальше первой страницы. Окно
  входа не считается окном worfy (`src/main/sign-in-windows.ts`): иконка Dock, второй запуск и щелчок по notification
  открывают главное окно, а не поднимают окно входа.

## 5. Scope — явный, из каталога

Code: `src/main/integrations/auth/oauth.ts:578-593` · key lines: 578, 579, 593

```ts
      const scopes = (this.options.scopes ?? ((each: Integration) => catalogueEntry(each.service)?.scopes ?? []))(integration)
      const scope = scopes.length === 0 ? undefined : scopes.join(' ')
      const loopback = request.via === 'browser' ? await (this.options.listen ?? listenLoopback)({ id, state, timeoutMs }) : null
      wait = loopback
      let authorizationUrl: URL | null = null
      const provider = providerOf(this.store, id, () => this.saved(id), {
        redirectUrl: loopback?.redirectUrl ?? redirectUrlOf(id),
        state,
        scope,
        redirect: (url) => {
          authorizationUrl = url
        },
      })
      const serverUrl = integration.transport.url
      const fetchFn = this.fetchOf(id)
      const started = await auth(provider, { serverUrl, fetchFn, ...(scope === undefined ? {} : { scope }) })
```

- Что делает: scope-ы строки каталога идут в `auth()` явно; пакет берёт их и для DCR, и для страницы входа. Пустой
  список — scope-ы из metadata сервиса.
- Почему здесь: spike 01, «Метаданные сервисов» — без явного scope пакет просит всё из metadata, у Atlassian это и права
  записи. Linear — `read write` (живой вход spike-а); Atlassian оставлен пустым по решению Orchestrator-а: угаданный
  короткий список мог бы сломать вход.
- Без него: Linear просил бы все scope-ы metadata, не те, что выдал живой вход.
- Требование: [Что происходит](../issues/05-вход-oauth.md#что-происходит)
- Риски и пробелы test-ов: минимальный список Atlassian и даёт ли `offline_access` один refresh token — не проверено,
  это приёмка владельца (Ticket 11).

## 6. Соединение proxy переживает refresh

Code: `src/main/integrations/proxy.ts:513-517` · key lines: 515

```ts
  private fingerprint(id: string): string {
    const integration = this.store.get(id)
    if (integration?.auth === 'oauth') return JSON.stringify(['oauth', integration.signIn?.at ?? null])
    return JSON.stringify(this.secretsOf(id, { refresh: false }))
  }
```

- Что делает: соединение OAuth-Integration открывается заново только новым входом или Sign out; обновлённый access
  token transport берёт из provider-а на каждый запрос.
- Почему здесь: комментарий Ticket-а 06 у `fingerprint` просил убрать `access` из отпечатка OAuth — иначе вызовы шли бы
  по закрытому соединению.
- Без него: каждый refresh открывал бы новое соединение под идущими вызовами.
- Требование: [Готово, когда, пункт 2](../issues/05-вход-oauth.md#готово-когда)
- Риски и пробелы test-ов: contract проверяет один `initialize` за три истечения подряд.

## 7. Что сознательно не меняли

- `src/main/integrations/store.ts` — только чтение: удалить одну часть секрета нельзя, поэтому `keepOnly` стирает все
  ключи Integration-а и возвращает нужные.
- Кнопка Sign in на экране и запрет окна для Autopilot — Ticket 09; канал Sign out — Ticket 08.
- `integrations.remove` не отзывает token-ы OAuth-Integration и не чистит её partition — долг Ticket-а 08 или 09.

## 8. Как проверено

- `node scripts/vitest-electron.mjs test/contract/integrations-oauth.test.ts test/unit/integrations-oauth-redirect.test.ts test/contract/web-policy.test.ts` — exit 1 на коде `origin/main`, exit 0 после правки.
- Mutation testing: 32 mutant-а `oauth.ts`, `proxy.ts`, канала, `window.ts`, `index.ts`, `notify.ts` и
  `sign-in-windows.ts` — все убиты.
- Второй круг ревью: три новых test-а (повтор 401 после refresh, refresh с ответом 200 без token-ов, окно входа не
  считается окном worfy) — exit 1 до правки, exit 0 после.
- Все unit и contract test-ы затронутых модулей (30 файлов) — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Проверить себя

1. Почему замок стоит в `fetch` transport-а, а не в provider-е?
   - Ответ: у `OAuthClientProvider` нет места вокруг refresh — пакет сам шлёт запрос token-а через `fetch`, который
     получает transport; там видны и 401 обычных запросов, и тело запроса refresh.
   - Строки: `src/main/integrations/auth/oauth.ts:489-520`

2. Что получает вызов, чей 401 пришёл уже после того, как другой вызов обновил token-ы?
   - Ответ: его запрос уходит ещё раз с хранимым token-ом, до transport-а пакета 401 не доходит; а refresh такого
     вызова получает хранимые token-ы без запроса к сервису — отработанный token второй раз не уходит.
   - Строки: `src/main/integrations/auth/oauth.ts:497-520`

3. Почему Session без человека не открывает окно входа, даже если refresh отказан?
   - Ответ: provider proxy не отдаёт и не сохраняет нового клиента и ничего не делает в `redirectToAuthorization`, так
     что пакет кончает `UnauthorizedError`, а proxy отвечает «Sign-in needed».
   - Строки: `src/main/integrations/auth/oauth.ts:300-311`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-integrations 05 (OAuth sign-in: the MCP SDK's OAuthClientProvider over SecretStore, a worfy window with its own partition, «Open in system browser», Sign out with revocation, channel integrations.signIn), head 15649bf4240c5e0f21391dbf7e5268f39f237332
>
> Gate (depth medium, two rounds): reviewer (correctness) — round 1 FIX (one med, two lows), round 2 MERGE. The verifier (lens: implementer's claims) was stopped twice from worfy; the owner chose on 2026-11-21 to land on the reviewer's verdict alone.
>
> - What the user sees: an Integration signs in through discovery, one dynamic client registration per Integration, PKCE S256 and resource; tokens live in secrets.json under <id>:access, <id>:refresh, <id>:client; an expired token refreshes without Restart Session; two Integrations on one address get two clients and two partitions; Sign out revokes both tokens, deletes <id>:* and clears the partition; integrations.signIn is refused over a Linked machine with Read only.
> - Fixed in round 2: a call whose 401 arrives after another call's refresh is resent once with the stored token instead of answering «Sign-in needed»; a 2xx refresh answer without an access token is forgotten like a 5xx; the sign-in window no longer counts as an app window for the Dock icon, a second start and a notification click.
> - After the verdict: CI Windows was red on the Sign out test because its file keys used the platform separator; the test now joins them with '/' (test/contract/integrations-oauth.test.ts:10), and origin/main was merged in; oauth contract + redirect unit 37/37, lint, typecheck EXIT=0.
> - Evidence: contract integrations-oauth 19 tests and the redirect unit test red-before/green-after; 30 module unit+contract files 641 passed; 32 mutants each red on its own test; the reviewer's race scenarios R1–R3 green with one refresh each; pnpm lint, typecheck EXIT=0; gate fast green EXIT=0. No real service was signed in to.
> - Debt (low, ticket 09): the sign-in window still counts as an app window in the Autopilot confirmation owner (src/main/autopilot/chat-confirm.ts:226-228), menu commands (src/main/menu.ts:65) and event broadcasts (src/main/broadcast.ts:11, src/main/ipc/link.ts:146, src/main/ipc/linked.ts:77); integrations.remove of an OAuth Integration does not revoke its tokens or clear its partition (src/main/ipc/integrations.ts:182).
> - Not verified: the window sign-in in real Electron (webRequest on the service's 302 to 127.0.0.1); loopback redirect with a port at Atlassian and Linear; the minimal Atlassian scopes — at the owner's acceptance (ticket 11).
>
> Decided without the owner (to confirm): the refresh lock lives in the transport's fetch and never sends a used refresh token; the proxy never opens a sign-in window; Linear scopes read write, Atlassian from metadata; account and site null; the web policy allows navigation only for the sign-in window (src/main/window.ts, outside the ticket's file list); DCR registers the redirect URI without a port.

Code: `test/contract/integrations-oauth.test.ts:10-10` · key lines: 10

```ts
import { join, relative, sep } from 'node:path'
```

Code: `src/main/autopilot/chat-confirm.ts:226-228` · key lines: 226

```ts
  const focused = windows.getFocusedWindow()
  if (focused !== null && !focused.isDestroyed() && onScreen(focused)) return focused
  const live = windows.getAllWindows().filter((window) => !window.isDestroyed())
```

Code: `src/main/menu.ts:65-65` · key lines: 65

```ts
  const target = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
```

Code: `src/main/broadcast.ts:11-11` · key lines: 11

```ts
  for (const window of BrowserWindow.getAllWindows()) {
```

Code: `src/main/ipc/link.ts:146-146` · key lines: 146

```ts
    for (const window of BrowserWindow.getAllWindows()) {
```
