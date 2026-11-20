# Code story — worfy-integrations 04: Вход по token-у: Bearer, Basic, свой заголовок, переменные-секреты stdio и token `gh` в `SecretStore`, проверка `initialize`, Sign out

Kind: pr · Epic: worfy-integrations · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 03 Integration хранила token в `SecretStore`, но никто его не посылал и не проверял: статус был
`signed-in`, как только секрет записан, даже неверный. Первая рабочая Integration — по token-у (Q10 (а)), поэтому
нужны заголовок входа для proxy, проверка token-а у самого сервиса и Sign out.

- Требование: [Что происходит](../issues/04-вход-по-token-у.md#что-происходит)

## 2. Секреты stdio — в окружении, не в аргументах

Code: `src/main/integrations/auth/tokens.ts:104-110` · key lines: 107, 108, 109

```ts
export function stdioLaunch(integration: Integration, read: SecretReader): StdioLaunch {
  const { transport } = integration
  if (transport.kind !== 'stdio') throw new Error(`Integration ${integration.id} is not a stdio server`)
  const env: Record<string, string> = { ...transport.env }
  for (const name of transport.secretEnv) env[name] = required(read, `env:${name}`)
  return { command: transport.command, args: [...transport.args], env }
}
```

- Что делает: собирает запуск stdio-сервера: команда и аргументы как их дал пользователь, переменные — обычные и
  секретные из `SecretStore` (`<id>:env:<NAME>`); секрета нет — `MissingSecretError` с именем переменной, без значения.
- Почему здесь: Ticket, «Что делаем», пункт 1, называет `tokens.ts` и переменные-секреты stdio; spec (Факт 3в) — token в
  аргументах процесса виден всем.
- Без него: proxy Ticket-а 06 собирал бы окружение сам, и секрет мог бы попасть в `args`.
- Требование: [Что делаем, пункт 1](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: базовое окружение процесса добавляет вызывающий (Ticket 06); contract запускает
  `stdio-stub.mjs` и видит, что ключ пришёл из окружения, а не из аргументов.

## 3. Ответ сервиса на `initialize` → статус

Code: `src/main/integrations/auth/tokens.ts:250-259` · key lines: 251, 255, 256, 259

```ts
  const failed = (message: string, transient = false): CheckOutcome => ({ status: { state: 'error', message }, transient })
  if (response.status >= 300 && response.status < 400) {
    return failed(`${host} answered ${response.status}, a redirect to another address; worfy does not send the sign-in there`)
  }
  if (response.status === 401 || response.status === 403) {
    if (atlassian) return failed(atlassianRefusal(text, response.status))
    if (response.status === 401) return { status: { state: 'needs-sign-in' }, transient: false }
    return failed(text === '' ? `${host} refused the sign-in (403)` : text)
  }
  if (!response.ok) return failed(`${host} answered ${response.status}${text === '' ? '' : `: ${text}`}`, response.status === 429 || response.status >= 500)
```

- Что делает: 3xx — `error` (fetch идёт с `redirect: 'manual'`, заголовок входа на другой адрес не уходит); 401 —
  `needs-sign-in`, 403 — `error` с текстом сервиса; у Atlassian оба — `error` с текстом и ссылкой на страницу, где admin
  включает вход по token-у; 429 и 5xx — `error` с пометкой `transient`. Текст уже прошёл `scrubServiceText`: token, его
  base64 и всё похожее на credential скрыты.
- Почему здесь: Ticket, «Что делаем», пункт 2, и «Риски» spec-а (admin клиента запретил). Почему 401 у Atlassian тоже
  `error` — решено в этом Ticket-е («Итог», пункт 3): верный token под запретом admin-а не отличить от неверного.
  Redirect и `transient` — ревью, раунд 2 («Итог», пункты 5 и 8).
- Без него: неверный token выглядел бы рабочим до первого вызова tool-а.
- Требование: [Что делаем, пункт 2](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: какой код отдаёт настоящий Atlassian при выключенном входе по token-у, не проверено —
  живого сервиса в test-ах нет.

## 4. `integrations.setSecret` проверяет token и отвечает статусом

Code: `src/main/ipc/integrations.ts:124-135` · key lines: 126, 128, 131, 133

```ts
    defineHandler(integrationsSetSecret, async ({ id, part, value }) => {
      const machine = store()
      const changed = machine.secret(id, part as IntegrationSecretPart) !== value
      machine.setSecret(id, part as IntegrationSecretPart, value)
      const integration = integrationOf(id)
      if (part !== 'access' || !checksToken(integration)) return { status: statusOf(machine, integration, errors) }
      errors.delete(id)
      const status = await verifyTokenSignIn(machine, id, { check, changed })
      // A token replaced or signed out while the service answered: its error is not the Integration's any more.
      if (status.state === 'error' && isCurrentToken(machine, id, value)) errors.set(id, status.message)
      return { status }
    }),
```

- Что делает: записывает секрет; если это token Integration-ы по http (`bearer`, `basic`, `header`), проверяет его через
  `verifyTokenSignIn` и отвечает статусом — никогда секретом. Сначала отмечает, сменился ли token (`changed`). Ошибку
  запоминает для `integrations.status`, только если token всё ещё тот, что проверяли.
- Почему здесь: Ticket, «Что делаем», пункт 6.
- Без него: экран Ticket-а 08 не узнал бы, принял ли сервис token.
- Требование: [Что делаем, пункт 6](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: ошибка живёт в памяти (`shortcut:`), после перезапуска — `needs-sign-in` до новой проверки.

## 5. Ответ о token-е, которого уже нет, ничего не пишет

Code: `src/main/integrations/auth/tokens.ts:318-324` · key lines: 318, 320, 322

```ts
  const checked = store.secret(id, 'access')
  const { status, transient } = await (options.check ?? checkSignIn)(integration, headers)
  if (!isCurrentToken(store, id, checked)) return status
  if (status.state !== 'signed-in') {
    if (!transient || options.changed !== false) store.setSignIn(id, null)
    return status
  }
```

- Что делает: запоминает token до запроса; если после ответа в `SecretStore` уже другой token или его нет (второй
  `setSecret`, Sign out), не трогает вход. Сбой по дороге (`transient`) оставляет прежний вход только при повторной
  проверке того же token-а; новый, никем не проверенный token его не наследует.
- Почему здесь: ревью, раунды 2 и 3 («Итог», пункты 5 и 8).
- Без него: медленный 401 неверного token-а A после быстрого `signed-in` верного B оставил бы B в хранилище со статусом
  `needs-sign-in`, и так — после перезапуска тоже.
- Требование: [Что делаем, пункт 2](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: один и тот же token, записанный дважды, проверяется дважды, и пишут оба ответа — они про один
  token. Contract держит ответ stub-а до `release` — без отсчёта по часам.

## 6. Статус: `signed-in` только после удачной проверки

Code: `src/main/ipc/integrations.ts:53-59` · key lines: 54, 56, 57

```ts
function statusOf(store: IntegrationStore, integration: Integration, errors: ReadonlyMap<string, string>): IntegrationStatus {
  if (!neededSecrets(integration).every((part) => store.hasSecret(integration.id, part))) return { state: 'needs-sign-in' }
  const error = errors.get(integration.id)
  if (error !== undefined) return { state: 'error', message: error }
  if (checksToken(integration) && integration.signIn === null) return { state: 'needs-sign-in' }
  return { state: 'signed-in' }
}
```

- Что делает: нет нужного секрета — `needs-sign-in`; последняя проверка с ошибкой — `error`; token по http без
  записанного входа (`signIn: null`) — `needs-sign-in`; иначе `signed-in`.
- Почему здесь: Ticket, «Что делаем», пункты 2 и 4 (после Sign out — `needs-sign-in`).
- Без него: отвергнутый token, оставшийся в `SecretStore`, показывался бы как `signed-in`.
- Требование: [Что делаем, пункт 4](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: stdio и OAuth по-прежнему `signed-in` по наличию секретов — их проверяют Ticket-ы 05 и 06.

## 7. Token аккаунта `gh` — копия в `SecretStore`

Code: `src/main/integrations/auth/tokens.ts:398-412` · key lines: 405, 406, 409, 411

```ts
export async function signInWithGhToken(options: GhTokenOptions & { store: TokenStore; id: string; check?: SignInCheck }): Promise<CheckedStatus> {
  const { account } = options
  if (account === null) throw new Error('the Project has no GitHub account')
  const integration = options.store.get(options.id)
  if (integration === undefined) throw new Error(`no Integration ${options.id} on this Machine`)
  // Before the copy: the gh token is a Bearer token. Kept for another way to sign in it would only lie in the store, or
  // overwrite the <e-mail>:<token> pair of a Basic Integration.
  if (integration.auth !== 'bearer' || !checksToken(integration)) throw new Error(`Integration ${options.id} does not sign in with a Bearer token over http`)
  const env = await accountAuth({ account: () => Promise.resolve(account), run: options.run })(options.root)
  const token = env.GH_TOKEN
  if (token === undefined) throw new Error(`gh gave no token for ${account}`)
  const changed = options.store.secret(options.id, 'access') !== token
  options.store.setSecret(options.id, 'access', token)
  return verifyTokenSignIn(options.store, options.id, { account, changed, ...(options.check === undefined ? {} : { check: options.check }) })
}
```

- Что делает: сначала убеждается, что Integration входит по Bearer token-у по http (пара e-mail:token Basic не
  перезаписывается); берёт token аккаунта `gh` Project-а через
  `accountAuth`, кладёт копию в `<id>:access` и проверяет её как token, введённый руками; login `gh` становится
  аккаунтом входа.
- Почему здесь: Ticket, «Что делаем», пункт 3, оставил выбор implementer-у; выбор и причина — «Итог», пункт 1.
- Без него: GitHub Integration требовала бы отдельный PAT даже там, где worfy уже знает token `gh`.
- Требование: [Что делаем, пункт 3](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: после `gh auth refresh` копия устаревает до нового входа; канала для экрана нет — его добавит
  Ticket 08.

## 8. Что сознательно не меняли

- Каналов не добавляли: Sign out, предложение token-а `gh` и вход им — функции main; канал для экрана — Ticket 08.
- MCP SDK не стал прямой зависимостью: проверка — один `POST initialize` через `fetch`.
- Stdio-сервер не запускается и не проверяется — это proxy Ticket-а 06.

## 9. Как проверено

- `pnpm test test/unit/integrations-auth-headers.test.ts test/contract/integrations-token-auth.test.ts` — до правки
  exit 1 (модуля `tokens.ts` нет), после — exit 0.
- Ревью, раунд 2: новые случаи contract-а — exit 1 до правки (8 из 22), exit 0 после; mutant без `scrubServiceText` в
  тексте отказа и в «Could not reach» — exit 1.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0 (весь `pnpm test`).

## Проверить себя

1. Почему неверный token, оставшийся в `SecretStore`, не показывается как `signed-in`?
   - Ответ: для token-а по http статус `signed-in` требует записанного входа, а неудачная проверка его стирает.
   - Строки: `src/main/ipc/integrations.ts:57`
2. Почему отказ Atlassian — `error` со ссылкой, а не `needs-sign-in`?
   - Ответ: Atlassian пускает token, только если admin организации включил такой вход; верный token под запретом не
     отличить от неверного, поэтому статус называет страницу admin-а.
   - Строки: `src/main/integrations/auth/tokens.ts:255`
3. Где у stdio-сервера секрет, а где его не бывает никогда?
   - Ответ: в `env` запуска; `args` копируются из transport-а как есть, секретов в них нет.
   - Строки: `src/main/integrations/auth/tokens.ts:107-109`

## 10. Что нашёл review и что осталось

> VERIFIED — worfy-integrations 04 (sign-in to an Integration by token), head 0323bd653629753d6d63e1a38bce3bef1c63adbf (4db29de14 + main merged in, which carries the flaky-test fix #2116)
>
> Gate (depth medium, three rounds — the cap): verifier (lens: implementer's claims, sonnet) — all 7 claims CONFIRMED, one medium test gap; reviewer (correctness) — round 1 MERGE with one medium race, round 2 FIX (one medium), round 3 code clean, one low test gap left (below).
>
> - What works: Bearer, Basic (<e-mail>:<token>), a custom header; connectionHeaders reads SecretStore on every call; stdio secrets only in the child env. setSecret checks a token with POST initialize (redirect: 'manual', 3xx → error, 15 s timeout): OK → signed-in; 401 → needs-sign-in; 403 → error with the service text, token scrubbed (Atlassian adds the admin page link). A NEW token with a transient failure (no answer, timeout, 429, 5xx) clears the sign-in (error in memory, needs-sign-in after restart); a re-check of the SAME token keeps it. Two checks racing on one Integration: only the one for the currently stored token writes. Sign out deletes the <id>:* keys; the gh token is copied only into bearer-over-http Integrations, after the check. No token in data files other than secrets.json, in channel answers, console or args; setSecret refused from a Linked machine.
> - Evidence: each round's tests red before / green after (8 of 22, then 4 of 25 red before); 59 tests in the 4 integration files EXIT=0; reviewers' mutants caught (race guard, scrub of refusal and unreachable text, custom-header scrub, redirect, transient classification, changed computed before the write in the ipc handler, gh checksToken); lint, typecheck, story-check, evidence-check EXIT=0; gate fast green EXIT=0.
> - Left at the round cap (low, not a ticket): the `changed` flag in signInWithGhToken (tokens.ts:408-409) has no test — signInWithGhToken is not wired to any channel yet; ticket 08 (the screen) wires it and its brief asks for a gh-path test with a 503/429 on a new token.
>
> Decided without the owner (to confirm): gh token stored as a copy (Integration belongs to the Machine, the gh account to a Project); Basic keeps <e-mail>:<token> with the e-mail as account; Atlassian 401/403 → error with a link; the check is a plain fetch, not the MCP SDK client; error status in memory only; no new IPC channels (ticket 08 adds them); tokenUrl/tokenNote in the catalogue; IntegrationStore.deleteSecrets added.
