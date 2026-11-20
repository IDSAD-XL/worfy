# Code story — worfy-integrations 04: Вход по token-у: Bearer, Basic, свой заголовок, переменные-секреты stdio и token `gh` в `SecretStore`, проверка `initialize`, Sign out

Kind: pr · Epic: worfy-integrations · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 03 Integration хранила token в `SecretStore`, но никто его не посылал и не проверял: статус был
`signed-in`, как только секрет записан, даже неверный. Первая рабочая Integration — по token-у (Q10 (а)), поэтому
нужны заголовок входа для proxy, проверка token-а у самого сервиса и Sign out.

- Требование: [Что происходит](../issues/04-вход-по-token-у.md#что-происходит)

## 2. Секреты stdio — в окружении, не в аргументах

Code: `src/main/integrations/auth/tokens.ts:103-109` · key lines: 106, 107, 108

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

Code: `src/main/integrations/auth/tokens.ts:238-243` · key lines: 239, 240, 241

```ts
  if (response.status === 401 || response.status === 403) {
    if (atlassian) return { state: 'error', message: atlassianRefusal(text, response.status) }
    if (response.status === 401) return { state: 'needs-sign-in' }
    return { state: 'error', message: text === '' ? `${host} refused the sign-in (403)` : text }
  }
  if (!response.ok) return { state: 'error', message: `${host} answered ${response.status}${text === '' ? '' : `: ${text}`}` }
```

- Что делает: 401 — `needs-sign-in`, 403 — `error` с текстом сервиса; у Atlassian оба — `error` с текстом и ссылкой на
  страницу, где admin включает вход по token-у; прочие коды — `error` с кодом. Текст уже прошёл `scrubServiceText`:
  token, его base64 и всё похожее на credential скрыты.
- Почему здесь: Ticket, «Что делаем», пункт 2, и «Риски» spec-а (admin клиента запретил). Почему 401 у Atlassian тоже
  `error` — решено в этом Ticket-е («Итог», пункт 3): верный token под запретом admin-а не отличить от неверного.
- Без него: неверный token выглядел бы рабочим до первого вызова tool-а.
- Требование: [Что делаем, пункт 2](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: какой код отдаёт настоящий Atlassian при выключенном входе по token-у, не проверено —
  живого сервиса в test-ах нет.

## 4. `integrations.setSecret` проверяет token и отвечает статусом

Code: `src/main/ipc/integrations.ts:123-132` · key lines: 127, 129, 130

```ts
    defineHandler(integrationsSetSecret, async ({ id, part, value }) => {
      const machine = store()
      machine.setSecret(id, part as IntegrationSecretPart, value)
      const integration = integrationOf(id)
      if (part !== 'access' || !checksToken(integration)) return { status: statusOf(machine, integration, errors) }
      errors.delete(id)
      const status = await verifyTokenSignIn(machine, id, { check })
      if (status.state === 'error') errors.set(id, status.message)
      return { status }
    }),
```

- Что делает: записывает секрет; если это token Integration-ы по http (`bearer`, `basic`, `header`), проверяет его через
  `verifyTokenSignIn` и отвечает статусом — никогда секретом. Ошибку запоминает для `integrations.status`.
- Почему здесь: Ticket, «Что делаем», пункт 6.
- Без него: экран Ticket-а 08 не узнал бы, принял ли сервис token.
- Требование: [Что делаем, пункт 6](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: ошибка живёт в памяти (`shortcut:`), после перезапуска — `needs-sign-in` до новой проверки.

## 5. Статус: `signed-in` только после удачной проверки

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

## 6. Token аккаунта `gh` — копия в `SecretStore`

Code: `src/main/integrations/auth/tokens.ts:362-370` · key lines: 365, 368, 369

```ts
export async function signInWithGhToken(options: GhTokenOptions & { store: TokenStore; id: string; check?: SignInCheck }): Promise<CheckedStatus> {
  const { account } = options
  if (account === null) throw new Error('the Project has no GitHub account')
  const env = await accountAuth({ account: () => Promise.resolve(account), run: options.run })(options.root)
  const token = env.GH_TOKEN
  if (token === undefined) throw new Error(`gh gave no token for ${account}`)
  options.store.setSecret(options.id, 'access', token)
  return verifyTokenSignIn(options.store, options.id, { account, ...(options.check === undefined ? {} : { check: options.check }) })
}
```

- Что делает: берёт token аккаунта `gh` Project-а через `accountAuth`, кладёт копию в `<id>:access` и проверяет её как
  token, введённый руками; login `gh` становится аккаунтом входа.
- Почему здесь: Ticket, «Что делаем», пункт 3, оставил выбор implementer-у; выбор и причина — «Итог», пункт 1.
- Без него: GitHub Integration требовала бы отдельный PAT даже там, где worfy уже знает token `gh`.
- Требование: [Что делаем, пункт 3](../issues/04-вход-по-token-у.md#что-делаем)
- Риски и пробелы test-ов: после `gh auth refresh` копия устаревает до нового входа; канала для экрана нет — его добавит
  Ticket 08.

## 7. Что сознательно не меняли

- Каналов не добавляли: Sign out, предложение token-а `gh` и вход им — функции main; канал для экрана — Ticket 08.
- MCP SDK не стал прямой зависимостью: проверка — один `POST initialize` через `fetch`.
- Stdio-сервер не запускается и не проверяется — это proxy Ticket-а 06.

## 8. Как проверено

- `pnpm test test/unit/integrations-auth-headers.test.ts test/contract/integrations-token-auth.test.ts` — до правки
  exit 1 (модуля `tokens.ts` нет), после — exit 0.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0 (весь `pnpm test`).

## Проверить себя

1. Почему неверный token, оставшийся в `SecretStore`, не показывается как `signed-in`?
   - Ответ: для token-а по http статус `signed-in` требует записанного входа, а неудачная проверка его стирает.
   - Строки: `src/main/ipc/integrations.ts:57`
2. Почему отказ Atlassian — `error` со ссылкой, а не `needs-sign-in`?
   - Ответ: Atlassian пускает token, только если admin организации включил такой вход; верный token под запретом не
     отличить от неверного, поэтому статус называет страницу admin-а.
   - Строки: `src/main/integrations/auth/tokens.ts:239`
3. Где у stdio-сервера секрет, а где его не бывает никогда?
   - Ответ: в `env` запуска; `args` копируются из transport-а как есть, секретов в них нет.
   - Строки: `src/main/integrations/auth/tokens.ts:106-108`
