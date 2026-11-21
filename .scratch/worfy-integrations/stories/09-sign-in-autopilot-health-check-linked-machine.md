# Code story — worfy-integrations 09: Sign in на экране и в chip-е, Restart для Integration, включённой на ходу, Autopilot только с флажком, строки Health check, права Linked machine

Kind: pr · Epic: worfy-integrations · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

После Ticket-ов 05–08 окно входа OAuth было, но кнопки Sign in на экране не было; строка Integration в chip-е «MCP
n/m» не знала, что proxy нашёл вход отказанным, и её Sign in ушёл бы в `mcpAuthenticate` Claude Code (вход в
endpoint worfy, а не в сервис). Integration, включённую в работающей Session, Session не получала и не говорила об
этом. Отказ входа никуда не попадал, кроме ответа tool-а. Ревью 05/07/08 оставили долги: окно входа считалось окном
приложения, Sign out OAuth не отзывал token, Clean up молча ждал.

- Требование: [Что происходит](../issues/09-sign-in-autopilot-health-check-linked-machine.md#что-происходит)

## 2. Строка Integration говорит то, что нашёл proxy

Code: `src/main/integrations/rows.ts:35-44` · key lines: 38, 40, 43

```ts
export function integrationRow(row: McpServerRow, own: { id: string; label: string }, facts: IntegrationRowFacts, attended: boolean, vendorActions: (row: McpServerRow) => McpServerAction[]): McpServerRow {
  const refused = facts.signInError(own.id)
  const fields = integrationFields(own.label, own.id)
  if (refused !== null && row.status !== 'pending' && row.status !== 'disabled') {
    const needs = { ...row, ...fields, status: 'needs-auth' as const, tools: null, error: refused }
    return { ...needs, actions: [...(attended && facts.oauth(own.id) ? (['sign-in'] as const) : []), ...vendorActions(needs).filter((action) => action !== 'sign-in')] }
  }
  const labelled = { ...row, ...fields }
  return { ...labelled, actions: vendorActions(labelled).filter((action) => action !== 'sign-in') }
}
```

- Что делает: поверх строки Vendor-а ставит source `integration`, метку и id; если proxy нашёл вход отказанным —
  `needs-auth` с текстом «Sign-in needed: <метка>…». `sign-in` в строке бывает только свой — для OAuth и только когда
  у Session есть человек; `sign-in` Vendor-а выброшен всегда.
- Почему здесь: одна функция для Claude (`claude/mcp.ts`) и Codex (`codex/mcp.ts` строит свою строку тем же правилом);
  Ticket, «Что делаем», пункт 2, требует окно worfy, а не `mcpAuthenticate`.
- Без него: строка Integration показывала бы `connected` при отказанном входе, а Sign in открыл бы вход Claude Code.
- Требование: [Что делаем, пункты 2 и 4](../issues/09-sign-in-autopilot-health-check-linked-machine.md#что-делаем)
- Риски и пробелы test-ов: статус читается при каждом запросе строк; пока никто не звал tool, proxy не знает об
  отказе, и строка остаётся `connected`.

## 3. Vendor не входит за Integration

Code: `src/main/vendors/claude/mcp.ts:266-268` · key lines: 267

```ts
    // An Integration signs in in worfy's window (integrations.signIn), never through Claude Code (ticket 09).
    if (action === 'sign-in' && integrationsOf(query)?.labels.has(name) === true) throw new McpActionRefused(action)
    if (action === 'sign-in') return signIn(query, name, openWithShell)
```

- Что делает: `claudeMcp.act(…, 'sign-in')` для сервера Integration отказывает (`McpActionRefused`), не трогая
  `mcpAuthenticate`; у Codex такой же отказ был с Ticket-а 07.
- Почему здесь: Ticket, «Что происходит», называет `src/main/vendors/claude/mcp.ts:27-33` как место, где Sign in зовёт
  `mcpAuthenticate`.
- Без него: старый renderer или ошибка в нём довели бы Claude Code до входа в endpoint worfy.
- Требование: [Что делаем, пункт 2](../issues/09-sign-in-autopilot-health-check-linked-machine.md#что-делаем)
- Риски и пробелы test-ов: contract зовёт `act` на стоящем вместо Session handle с живым query.

## 4. Integration, включённая на ходу, — «not started» с Restart

Code: `src/main/integrations/rows.ts:51-57` · key lines: 52, 55, 56

```ts
export function joinedIntegrationRows(facts: IntegrationRowFacts, have: { names: ReadonlySet<string>; ids: ReadonlySet<string> }, attended: boolean): McpServerRow[] {
  if (!attended) return []
  return facts
    .current()
    .filter((each) => !have.ids.has(each.id) && !have.names.has(each.name))
    .map((each) => ({ name: each.name, status: 'not-started', tools: null, error: INTEGRATION_JOINED, ...integrationFields(each.label, each.id), actions: ['restart'] }))
}
```

- Что делает: при каждом запросе строк сравнивает набор, который Session получила бы сейчас, с её собственным (по id и
  по имени сервера) и добавляет строку `not-started` с `restart` для каждой новой. Session без человека — ни одной:
  её набор фиксирован на Wave.
- Почему здесь: Ticket, «Что делаем», пункт 3 (Restart with the same conversation) и пункт 4 (набор фиксируется в
  начале Wave, Q6 worfy-mcp-live).
- Без него: включённая Integration не доходила бы до Session до её следующего старта, и chip об этом молчал бы.
- Требование: [Что делаем, пункты 3 и 4](../issues/09-sign-in-autopilot-health-check-linked-machine.md#что-делаем)
- Риски и пробелы test-ов: Claude Code, перезапущенный после сбоя в Wave, перечитывает настройки, как mcp-live; это
  не проверено.

## 5. Codex: заменённый сервер config.toml и Restart

Code: `src/main/vendors/codex/mcp.ts:470-480` · key lines: 476, 477, 479

```ts
    const replaced = new Set(userServers)
    const ids = new Set(integrations.map((each) => each.id))
    const labelled = (rows: McpServerRow[]): McpServerRow[] => {
      const shown = rows.map((row) => {
        const integration = byName.get(row.name)
        if (integration === undefined) return row
        const note = replaced.has(row.name) ? configReplacedNote(row.name) : null
        return codexIntegrationRow(row, integration.label, integration.signInError(), { id: integration.id, oauth: integration.oauth, attended, note })
      })
      return facts === null ? shown : [...shown, ...joinedIntegrationRows(facts, { names: new Set(shown.map((row) => row.name)), ids }, attended)]
    }
```

- Что делает: строка Integration Codex-а получает id, OAuth-вход и пометку «Replaces the server <name> of your
  config.toml in this Session.», если имя сервера Integration совпало с сервером `config.toml` пользователя; новые
  Integration-ы — строками «not started». `codexMcp.restarts` теперь `true`, и Restart делает сама Session.
- Почему здесь: долг ревью 07 (ключ `mcp_servers.<name>` в `thread/start` молча заменял сервер пользователя);
  способ показать — строка под строкой chip-а — решение без владельца.
- Без него: пользователь терял свой сервер в Session Codex и не знал почему.
- Требование: [Что делаем, пункт 3](../issues/09-sign-in-autopilot-health-check-linked-machine.md#что-делаем)
- Риски и пробелы test-ов: имена из `config.toml` читает простой построчный разбор (`shortcut:`): сервер, описанный
  inline-таблицей, пометки не получит.

## 6. Строка Health check на пару Project + Integration

Code: `src/main/integrations/health.ts:45-62` · key lines: 53, 55, 58

```ts
    const integration = options.store.get(id)
    const subject = { id, label: integration?.label ?? id }
    const projects = options.projects()
    const all = projects.list()
    if (status === null || status.state === 'signed-in' || status.state === 'checking' || integration === undefined) {
      for (const project of all) options.reports.reportOk('integration', { id: project.id, name: project.name }, subject)
      return
    }
    const reason = status.state === 'needs-sign-in' ? `${integration.label}: sign-in needed` : `${integration.label}: ${status.message}`
    const oauth = integration.auth === 'oauth'
    const actions = oauth ? [{ id: 'integration-sign-in' as const, label: 'Sign in', integration: id }] : []
    for (const project of all) {
      const where = { id: project.id, name: project.name }
      if (enabledIn(projects, project.id, id)) options.reports.reportFailure('integration', where, reason, oauth ? OAUTH_STEP : TOKEN_STEP, actions, subject)
      else options.reports.reportOk('integration', where, subject)
    }
  }
}
```

- Что делает: слушает каждую смену статуса proxy и для каждого Project-а этой Machine, где Integration включена, пишет
  non-critical строку «<метка>: sign-in needed» (или текст сервиса), у OAuth — с действием Sign in; вход заново
  возвращает строки в OK.
- Почему здесь: Ticket, «Что делаем», пункт 5; `healthReports().reportFailure` и таблица `severityOf` названы в
  «Что происходит».
- Без него: отказ входа в Autopilot виден только в ответе tool-а, который человек не читает.
- Требование: [Что делаем, пункт 5](../issues/09-sign-in-autopilot-health-check-linked-machine.md#что-делаем)
- Риски и пробелы test-ов: привязка слушателя в `integrationProxy()` приложения проверена только e2e.

## 7. Sign in в chip-е — окно worfy

Code: `src/renderer/session/McpChip.tsx:407-419` · key lines: 409, 414, 416

```tsx
    // An Integration's Sign in is worfy's own sign-in window (integrations.signIn, worfy-integrations ticket 09), never
    // the Vendor's: then the rows are read again, the proxy having forgotten the refusal.
    const integration = action === 'sign-in' && row.source === 'integration' ? (row.integrationId ?? null) : null
    const done =
      integration !== null
        ? projectId === null || projectId === ''
          ? Promise.resolve(failed('this Session has no Project to sign in through'))
          : invoke('integrations.signIn', { projectId, id: integration }).then(async (result) => {
              if (!result.ok) return failed(failureReason('integrations.signIn', result.error))
              const rows = await invoke('agent.mcp', { sessionId })
              if (rows.ok && rows.value.servers !== null) acceptMcpServers(sessionId, rows.value.servers)
              failed(null)
            })
```

- Что делает: Sign in строки Integration зовёт `integrations.signIn` с Project-ом Session, затем перечитывает строки
  (`agent.mcp`); отказ — toast и строка ошибки, как у других действий.
- Почему здесь: Ticket называет `src/renderer/session/McpChip.tsx`.
- Без него: кнопка ушла бы в `agent.mcpAction`, которое Vendor отказывает (шаг 3).
- Требование: [Что делаем, пункт 2](../issues/09-sign-in-autopilot-health-check-linked-machine.md#что-делаем)
- Риски и пробелы test-ов: у Session без Project-а кнопка отвечает ошибкой; такой Session с Integration-ами не бывает.

## 8. Долги ревью: окно входа и Sign out OAuth

Code: `src/main/autopilot/chat-confirm.ts:226-233` · key lines: 229, 230

```ts
export function dialogOwner(windows: LocalWindows = BrowserWindow): BrowserWindow | null {
  const onScreen = (window: BrowserWindow): boolean => window.isVisible() && !window.isMinimized()
  const focused = windows.getFocusedWindow()
  if (focused !== null && !focused.isDestroyed() && !isSignInContents(focused.webContents) && onScreen(focused)) return focused
  const live = appWindows(windows.getAllWindows()).filter((window) => !window.isDestroyed())
  const shown = live.find(onScreen)
  if (shown !== undefined) return shown
  const [first] = live
```

- Что делает: подтверждение Autopilot встаёт на окно worfy, даже когда в фокусе окно входа; так же окно входа выпало
  из меню, broadcast, link и linked, а structural test следит, чтобы новый `getAllWindows()` в main его не забыл.
  Sign out и Remove OAuth Integration теперь отзывают token у сервиса и чистят partition (`signOutOf`,
  `src/main/ipc/integrations.ts:166-171`).
- Почему здесь: места названы в brief-е ревью 05 и 08; причина каждого — в комментарии рядом.
- Без него: диалог Autopilot мог открыться над страницей сервиса, где его никто не увидит.
- Требование: [Что происходит](../issues/09-sign-in-autopilot-health-check-linked-machine.md#что-происходит)
- Риски и пробелы test-ов: `interface-scale.ts` масштабирует и окна входа — оставлено (страница сервиса в масштабе
  worfy вреда не делает).

## 9. Что сознательно не меняли

- `src/main/integrations/auth/oauth.ts` (только чтение): вход не даёт аккаунта, поэтому строка показывает site или
  адрес сервера, и «с аккаунтом» пункта e2e не выполнено.
- Документы и русские страницы — Ticket 10; английская страница `docs/features/mcp-servers.md` обновлена, потому что
  поведение, которое она описывает, изменилось.

## 10. Как проверено

- До правки 13 файлов test-ов — exit 1 (12 файлов и 31 test красные; модуля `health` не было, `dialogOwner` вернул
  окно входа).
- 92 файла unit и contract затронутых модулей — exit 0; 22 mutant-а в копии под `mktemp -d` — каждый ловится своим
  test-ом.
- `pnpm test:e2e test/e2e/integrations.spec.ts` под замком — exit 0, снимки в двух темах.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — exit 0.

## Проверить себя

1. Почему строка Integration не предлагает Sign in в Session Autopilot, даже для OAuth?
   - Ответ: окно входа без человека не открывается никогда; Sign in добавляется только при `attended`.
   - Строки: `src/main/integrations/rows.ts:40`
2. Откуда Health check узнаёт, что вход отказан, если Session ничего не сообщает в main?
   - Ответ: proxy сообщает каждую смену статуса слушателю, и тот пишет строку каждому Project-у, где Integration
     включена.
   - Строки: `src/main/integrations/health.ts:53`, `src/main/integrations/health.ts:58`
3. Почему Session без человека не видит «not started» Integration, включённую посреди Wave?
   - Ответ: набор Autopilot фиксирован на Wave; строки «not started» строятся только для Session с человеком.
   - Строки: `src/main/integrations/rows.ts:52`
