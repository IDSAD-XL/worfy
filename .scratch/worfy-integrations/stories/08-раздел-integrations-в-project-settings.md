# Code story — worfy-integrations 08: Раздел Integrations в Project settings и Settings → Integrations: Add integration, ввод token-а, фильтр tools, Available to Autopilot, «From Claude Code»

Kind: pr · Epic: worfy-integrations · Ticket: 08 · PR: - · Language: ru

## 1. Что было не так

После Ticket-ов 03, 04 и 06 Integration хранилась на Machine, проверяла свой token и доходила до Session Claude через
proxy, но у пользователя не было экрана: завести Integration, ввести token, включить её в Project, выбрать tools и
увидеть их цену можно было только из test-ов. Статус proxy жил в памяти main, и ни один канал его не показывал.

- Требование: [Что происходит](../issues/08-раздел-integrations-в-project-settings.md#что-происходит)

## 2. Цена tools — после фильтра Project-а

Code: `src/renderer/integrations/cost.ts:15-19` · key lines: 17, 18

```ts
/** The count and tokens of `tools`, as toolsCost counts them: their JSON array (sizes, commas, brackets) over 4. */
export function costOf(tools: readonly IntegrationToolInfo[]): ToolsCostView {
  const json = tools.reduce((sum, tool) => sum + tool.size, 0) + Math.max(tools.length - 1, 0) + 2
  return { count: tools.length, tokens: Math.ceil(json / 4) }
}
```

- Что делает: считает «N tools · ~K tokens» строки так же, как `toolsCost` proxy: длина JSON-массива tools (размер
  каждого tool-а, запятые, скобки), делённая на 4. Строка считает её по tools после фильтра Project-а (`filtered`
  рядом), поэтому «12 of 41 tools · ~3k tokens» — то, что Session этого Project-а получает в каждом запросе.
- Почему здесь: Ticket, «Что делаем», пункт 1, называет «41 tools · ~9k tokens» и папку `src/renderer/integrations/`;
  что цена считается после фильтра — решение без владельца: proxy режет `tools/list` тем же фильтром (Ticket 06), а
  `disallowedTools` Claude Code tool из контекста модели не убирает.
- Без него: цена на экране расходилась бы с тем, что идёт в модель, и обещала бы экономию контекста, которой нет.
- Требование: [Что делаем, пункт 1](../issues/08-раздел-integrations-в-project-settings.md#что-делаем)
- Риски и пробелы test-ов: префикс `[label] `, который proxy добавляет к описаниям, в цену не входит; contract test
  сверяет `costOf(filtered(...))` с `toolsCost(filterTools(...))` на одних tools.

## 3. Канал `integrations.tools`: весь список, без входа — ни запроса

Code: `src/main/ipc/integrations.ts:233-251` · key lines: 236, 238, 241, 245

```ts
    defineHandler(integrationsTools, async ({ projectId, id }) => {
      dataDirOf(projectId)
      const machine = store()
      const known = statusOf(machine, integrationOf(id), errors)
      // Without its secret the service would only refuse: nothing is started for it.
      if (known.state === 'needs-sign-in') return { status: known, tools: null, hidden: [] }
      const proxy = proxyOf()
      try {
        const tools = await proxy.serviceToolsOf(id)
        const after = proxy.status(id)
        const status = after?.status ?? { state: 'signed-in' as const }
        // A list kept from before a refused sign-in is not this answer's: the row shows the sign-in, not old tools.
        return { status, tools: status.state === 'signed-in' ? tools.map(toolInfo) : null, hidden: after?.hidden ?? [] }
      } catch (error) {
        const after = proxy.status(id)
        const status = after !== null && after.status.state !== 'signed-in' ? after.status : { state: 'error' as const, message: error instanceof Error ? error.message : 'the service did not list its tools' }
        return { status, tools: null, hidden: after?.hidden ?? [] }
      }
    }),
```

- Что делает: отдаёт экрану весь список tools сервиса до фильтра (с `readOnly` и размером каждого) и статус после
  запроса; Integration без секрета или с token-ом, который никто не проверил, — `needs-sign-in` без запроса к сервису.
- Почему здесь: Ticket, «Где в коде», разрешает канал в `src/shared/ipc/integrations.ts`, если экрану его не хватает;
  Ticket 06 в «Итог» оставил показ статуса proxy этому Ticket-у.
- Без него: строка не знала бы ни числа tools, ни `readOnlyHint` для фильтра Read only, а Test спрашивал бы сервис с
  непроверенным token-ом.
- Требование: [Что делаем, пункт 1](../issues/08-раздел-integrations-в-project-settings.md#что-делаем)
- Риски и пробелы test-ов: канал зовёт новый публичный метод proxy `serviceToolsOf` — правка `proxy.ts`, который Ticket
  отмечает «только читать» (шаг 6).

## 4. Сироты: записи Project-а без Integration-ы Machine

Code: `src/main/ipc/integrations.ts:276-298` · key lines: 276, 285, 292

```ts
      const dangling = (whole === null ? [] : entries).flatMap(({ project, used }) => {
        const count = used.filter((entry) => !integrations.some((integration) => integration.id === entry.id)).length
        return count === 0 ? [] : [{ projectId: project.id, name: project.name, count }]
      })
      return { items, dangling }
    }),
    defineHandler(integrationsCleanUp, () => {
      const whole = store().wholeList()
      // Cleaning up against a list that could not be read would erase every Project's settings for good.
      if (whole === null) return { removed: 0 }
      const known = new Set(whole.map((integration) => integration.id))
      const projects = projectsOf()
      let removed = 0
      for (const project of projects.list()) {
        const dataDir = projects.dataDir(project.id)
        const entries = readProjectIntegrations(dataDir)
        const kept = entries.filter((entry) => known.has(entry.id))
        if (kept.length === entries.length) continue
        writeProjectIntegrations(dataDir, kept)
        removed += entries.length - kept.length
      }
      return { removed }
    }),
```

- Что делает: `integrations.machine` называет Project-ы, которые ещё хранят записи Integration-ов, которых на Machine
  нет (Remove оборвался); Settings → Integrations показывает их одной строкой с Clean up, а `integrations.cleanUp`
  удаляет только такие записи. Integration, которую не использует ни один Project, показана «Not used in any Project»
  с Remove. Пока список Machine не известен целиком (`integrations.json` повреждён или другой версии и отложен в
  сторону, или его нет), сирот нет и Clean up ничего не стирает: иначе каждая запись Project-а выглядела бы удалённой,
  и один щелчок стёр бы их навсегда (`IntegrationStore.wholeList`, раунд 2 review). Список Integration-ов Machine
  при этом виден целиком: новые Integration-ы с Sign out и Remove (раунд 3).
- Почему здесь: brief оркестратора просил показать и убрать сирот (низкая находка Ticket-а 03); Ticket, «Что делаем»,
  пункт 4, называет Settings → Integrations.
- Без него: оборванный Remove оставлял бы в Project-е запись, которую не видно и не убрать.
- Требование: [Что делаем, пункт 4](../issues/08-раздел-integrations-в-project-settings.md#что-делаем)
- Риски и пробелы test-ов: секрет без Integration-ы не найти — `SecretStore` не перечисляет ключи; такие сироты экран
  не показывает.

## 5. «Two tool sets»: про аккаунт, не про контекст

Code: `src/renderer/integrations/ClaudeServers.tsx:201-210` · key lines: 203, 205

```tsx
              {twin !== undefined && server.allowed ? (
                <div className="w-int__warnline" role="note" data-testid="claude-server-twin">
                  <b>Two {short} tool sets in this Project.</b> {server.name} and the Integration {twin.label} are both on: Sessions get two sets of {short} tools and may use the wrong account.
                  <span className="w-int__acts">
                    <Button disabled={locked} onClick={() => void write(server.name, false)}>
                      Turn off {server.name} in this Project
                    </Button>
                  </span>
                </div>
              ) : null}
```

- Что делает: когда сервер Claude Code — сервис каталога, а Integration того же сервиса включена, строка предупреждает
  о двух наборах tools и предлагает выключить сервер в Project-е (пишет `mcp.allowed` Profile-а).
- Почему здесь: Ticket, «Что делаем», пункт 3; текст не обещает экономию контекста — факт 3г spec-а ошибочен,
  `disallowedTools` MCP-tool из контекста не убирает.
- Без него: Session получала бы два набора Jira разных аккаунтов молча.
- Требование: [Что делаем, пункт 3](../issues/08-раздел-integrations-в-project-settings.md#что-делаем)
- Риски и пробелы test-ов: сервер с сервисом сопоставляется по имени («claude.ai Atlassian», «linear»), не по адресу:
  строки MCP в renderer адресов не несут.

## 6. Весь список tools у proxy

Code: `src/main/integrations/proxy.ts:277-283` · key lines: 281, 282

```ts
  /**
   * The service's whole tool list for the screen's count and Test (worfy-integrations ticket 08), before any filter,
   * on the shared connection; it fails as a Session's tools/list does, and leaves status() as that would.
   */
  serviceToolsOf(id: string): Promise<ServiceTool[]> {
    return this.serviceTools(id, this.store.get(id)?.label ?? id)
  }
```

- Что делает: открывает наружу приватный `serviceTools` — список сервиса на общем соединении до фильтра.
- Почему здесь: not recorded в Ticket-е; Ticket отмечает `proxy.ts` «только читать», а без метода экран не получил бы
  список без второго соединения с сервисом.
- Без него: каналу пришлось бы открывать своё соединение, то есть второй `initialize` на Integration.
- Требование: [Что делаем, пункт 2](../issues/08-раздел-integrations-в-project-settings.md#что-делаем)
- Риски и пробелы test-ов: правка вне списка файлов Ticket-а; contract test `integrations-screen` проверяет, что имена
  `tools/list` Session-сервера равны отфильтрованным именам канала.

## 7. Fake agent перечисляет Integration-ы Project-а

Code: `src/main/agent/fake-query.ts:544-550` · key lines: 546, 549

```ts
  /** The Integrations as servers in the SDK's shape, without those the request turned off; never on the Profile's list. */
  private integrationServers(): Record<string, unknown>[] {
    const off = this.request.mcpOff ?? []
    return this.integrations
      .filter((each) => !off.includes(each.name))
      .map((each) => ({ name: each.name, status: 'connected', scope: 'sdk', tools: each.tools.map((name) => ({ name })) }))
  }
```

- Что делает: test-овый агент отвечает `mcpServerStatus()` вместе с Integration-ами Project-а — так, как Claude Code
  перечисляет SDK-серверы worfy; tools берутся из `listTools` proxy при старте запроса.
- Почему здесь: Ticket, «Готово, когда», требует e2e со строкой Integration-ы в chip-е «MCP n/m» на fake query.
- Без него: e2e не увидел бы Integration-у в chip-е — fake отвечал только серверами своего сценария.
- Требование: [Готово, когда](../issues/08-раздел-integrations-в-project-settings.md#готово-когда)
- Риски и пробелы test-ов: `reloadPlugins` fake-а Integration-ы не добавляет; Integration, включённая на ходу, приходит в
  новую Session (Restart — Ticket 09).

## 8. Что сознательно не меняли

- Sign in через OAuth: способ показан неактивным «— not available yet»; кнопка — Ticket 09.
- Строка MCP chip-а (`McpChip.tsx`, `mcp-status.ts`) не менялась: Ticket-ы 05 и 07 идут параллельно.
- Секрет без Integration-ы не перечисляется: `SecretStore` не умеет список ключей.

## 9. Как проверено

- До правки: новые `test/unit/integrations-section.test.tsx`, `test/unit/add-integration-dialog.test.tsx`,
  `test/unit/project-settings-shell.test.tsx` и `test/contract/integrations-screen.test.ts` на `src` из `origin/main` —
  exit 1 (модулей раздела нет). После — exit 0.
- Mutant-ы (13): `changed` в `signInWithGhToken` true и false, цена без запятых, Read only без фильтра, Read only без
  `readOnlyHint`, `integrations.tools` при `needs-sign-in`, Clean up всех записей, Remove без подтверждения, раздел после
  неудачного чтения статусов, Add на Linked machine, Label с учётом регистра, Settings без строки сирот, Remove в
  Settings без подтверждения — каждый ловится своим test-ом (exit 1).
- Раунд 2: Clean up и сироты против непрочитанного списка, `call` раздела в диалоге и «From Claude Code», список по
  умолчанию у Profile без `mcp.allowed` — test-ы exit 1 до правки, exit 0 после; шесть mutant-ов — exit 1.
- `pnpm test:e2e test/e2e/integrations.spec.ts` под замком — exit 0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — exit 0.

## Проверить себя

1. Почему цена на строке считается после фильтра Tools, а `integrations.tools` отдаёт список до него?
   - Ответ: модель получает только то, что пропустил фильтр proxy, — это и есть цена; а весь список нужен экрану, чтобы
     предложить Read only и Choose… и сказать «of N».
   - Строки: `src/renderer/integrations/cost.ts:17`, `src/main/ipc/integrations.ts:241`
2. Что увидит пользователь, если Remove из Settings оборвался после удаления Integration-ы, но до записи Project-ов?
   - Ответ: строку «… still name(s) Integrations no longer on this Machine» с Clean up; Clean up удалит только записи
     без Integration-ы на Machine.
   - Строки: `src/main/ipc/integrations.ts:276`, `src/main/ipc/integrations.ts:292`
3. Почему предупреждение о двух наборах tools не говорит об экономии контекста?
   - Ответ: выключение сервера Claude Code через `disallowedTools` не убирает MCP-tool из контекста модели; риск — два
     аккаунта одного сервиса рядом.
   - Строки: `src/renderer/integrations/ClaudeServers.tsx:203`
