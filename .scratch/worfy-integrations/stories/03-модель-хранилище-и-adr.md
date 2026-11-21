# Code story — worfy-integrations 03: Модель, каталог, хранилище Integration-ов и секретов, поле `integrations` Project-а, каналы `integrations.*`, новый ADR и Amendment ADR-0021

Kind: pr · Epic: worfy-integrations · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

Integration (один аккаунт одного сервиса с меткой, «Jira — client A») была в `CONTEXT.md`, но не в коде: MCP-серверы
Session-ов worfy знал только из `mcp.allowed` Profile-а. Владелец решил (Q2, Q3): Integration живёт на Machine, Project
включает её галочкой в своём `settings.json`, секреты — файл 0600 в папке 0700 за `SecretStore`, как у связи. Этот PR даёт
модель, каталог, хранилище, поле Project-а, каналы и ADR-0111; proxy, вход и экран — Ticket-ы 04–08.

- Требование: [Что происходит](../issues/03-модель-хранилище-и-adr.md#что-происходит)

## 2. Папка `integrations/` — 0700 с первой записи списка

Code: `src/main/integrations/store.ts:90-95` · key lines: 92, 93, 94

```ts
  private save(integrations: readonly Integration[]): void {
    // The folder holds secrets.json too: 0700 from the first write, whichever file comes first.
    mkdirSync(this.dir, { recursive: true, mode: SECRET_DIR_MODE })
    chmodSync(this.dir, SECRET_DIR_MODE)
    writeJsonFile(this.file, integrationsFileSchema, { version: 1, integrations: [...integrations] })
  }
```

- Что делает: перед каждой записью `integrations.json` создаёт папку с правами 0700 и выставляет их; сам список пишет
  `writeJsonFile` — во временный файл рядом и rename поверх.
- Почему здесь: Ticket, «Что делаем», пункт 3, называет `store.ts`, список «через временный файл и rename» и секреты 0600
  в 0700; в той же папке лежит `secrets.json`. Почему папка 0700 и со стороны списка — не записано, это выбор Ticket-а
  («Решено без владельца» в «Итог»).
- Без него: до первого секрета папка была бы 0755, и `FileSecretStore` сузил бы её только при первом `setSecret`.
- Требование: [Что делаем, пункт 3](../issues/03-модель-хранилище-и-adr.md#что-делаем)
- Риски и пробелы test-ов: на Windows режимов POSIX нет — test проверяет 0600 и 0700 только вне `win32`, как
  `test/contract/link-pairing.test.ts`.

## 3. Remove: сначала секреты, потом запись

Code: `src/main/integrations/store.ts:178-187` · key lines: 185, 186

```ts
  /**
   * Removes Integration `id` and every secret of it. The secrets go first: a remove cut short leaves an
   * Integration without its sign-in, never a secret without its Integration.
   */
  remove(id: string): void {
    const integration = this.get(id)
    if (integration === undefined) return
    for (const part of this.parts(integration)) this.secrets.delete(secretKey(id, part))
    this.save(this.list().filter((other) => other.id !== id))
  }
```

- Что делает: удаляет все ключи `<id>:access`, `<id>:refresh`, `<id>:client` и `<id>:env:<NAME>` из `secrets.json`, затем
  запись из списка.
- Почему здесь: порядок выбран в этом Ticket-е (ADR-0111, пункт 3): прерванное удаление оставляет Integration без входа,
  а не секрет без Integration.
- Без него: секрет удалённой Integration остался бы в файле, и никакой экран его бы уже не показал.
- Требование: [Что делаем, пункт 3](../issues/03-модель-хранилище-и-adr.md#что-делаем)
- Риски и пробелы test-ов: test проверяет итог (остался только секрет другой Integration), но не обрыв между двумя
  записями.

## 4. Save окна Project settings не стирает `integrations`

Code: `src/main/projects/settings.ts:64-76` · key lines: 65, 66, 73

```ts
  const prInbox = askedInbox ?? read().prInbox
  // `integrations` of the input is never written here: only writeProjectIntegrations changes the field.
  const integrations = read().integrations
  writeJsonFile(settingsPath(projectDataDir), projectSettingsSchema, {
    ...others,
    ...(defaultVendor === undefined ? {} : { defaultVendor }),
    ...(humanReview === undefined ? {} : { humanReview }),
    ...(productWriteFolders === undefined ? {} : { productWriteFolders }),
    ...(prInbox === undefined ? {} : { prInbox }),
    integrations,
    actionTemplates: { ...settings.actionTemplates, ...later },
  })
  return readProjectSettings(projectDataDir, harness)
```

- Что делает: `writeProjectSettings` всегда пишет сохранённое поле `integrations` и не берёт его из входа; поле меняет
  только `writeProjectIntegrations`.
- Почему здесь: Ticket, «Что делаем», пункт 4, называет `settings.ts`; поле добавлено в `projectSettingsSchema`, потому
  что `writeJsonFile` отбрасывает ключи, которых схема не знает.
- Без него: любой Save окна Project settings или запись Linked machine старой сборки стирали бы список Integration-ов
  Project-а.
- Требование: [Что делаем, пункт 4](../issues/03-модель-хранилище-и-adr.md#что-делаем)
- Риски и пробелы test-ов: правка схемы — в `src/shared/projects/action-templates.ts`, файла нет в «Где в коде»; это
  записано в «Итог».

## 5. Секрет и Add integration по связи не идут

Code: `src/shared/ipc/integrations.ts:103-120` · key lines: 108, 119

```ts
/** Keeps a token, the OAuth client or a secret variable of the Integration; the answer is its status. */
export const integrationsSetSecret = invokeChannel(
  'integrations.setSecret',
  z.object({ id: integrationIdSchema, part: integrationSecretPartSchema, value: z.string().min(1) }),
  z.object({ status: integrationStatusSchema }),
  'local',
)

/**
 * Removes the Integration from the Machine, with its secrets, and from every Project. One another Project has
 * enabled needs `confirmed`: without it the answer names those Projects and nothing is removed.
 */
export const integrationsRemove = invokeChannel(
  'integrations.remove',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema, confirmed: z.boolean().optional() }),
  z.discriminatedUnion('status', [z.object({ status: z.literal('removed') }), z.object({ status: z.literal('confirm'), projects: z.array(z.string()) })]),
  'local',
)
```

- Что делает: `integrations.setSecret` и `integrations.remove` (как и `integrations.add`) помечены `local`: адаптер связи
  их не регистрирует, и Linked machine получает `not open to Linked machines` даже с полным доступом.
- Почему здесь: spec, «Решено без владельца», 3 — секрет по связи не идёт; Ticket, «Что делаем», пункт 5, задаёт метки.
- Без него: token Jira клиента набирался бы на другой Machine и шёл по сети.
- Требование: [Решено без владельца, 3](../spec.md#решено-без-владельца-подтверждено-владельцем-2026-11-20)
- Риски и пробелы test-ов: contract test зовёт каналы через `createLinkIpc` с доступом `read` и `all`; живой связи двух
  Machine-ов в test-е нет.

## 6. Remove Integration, включённой в другом Project-е, — только с подтверждением

Code: `src/main/ipc/integrations.ts:113-127` · key lines: 118, 119, 123

```ts
    defineHandler(integrationsRemove, ({ projectId, id, confirmed }) => {
      dataDirOf(projectId)
      integrationOf(id)
      const projects = projectsOf()
      const others = projects.list().filter((project) => project.id !== projectId)
      const using = others.filter((project) => readProjectIntegrations(projects.dataDir(project.id)).some((entry) => entry.id === id && entry.enabled))
      if (using.length > 0 && confirmed !== true) return { status: 'confirm' as const, projects: using.map((project) => project.name) }
      store().remove(id)
      for (const project of projects.list()) {
        const dataDir = projects.dataDir(project.id)
        const entries = readProjectIntegrations(dataDir)
        if (entries.some((entry) => entry.id === id)) writeProjectIntegrations(dataDir, entries.filter((entry) => entry.id !== id))
      }
      return { status: 'removed' as const }
    }),
```

- Что делает: ищет другие Project-ы Machine, где Integration включена; без `confirmed` отвечает `confirm` с их именами и
  ничего не удаляет; с ним удаляет Integration и её запись из `settings.json` каждого Project-а.
- Почему здесь: Ticket, «Что делаем», пункт 5: «Remove Integration, включённой в других Project-ах, требует
  подтверждения (флаг в запросе)». Что выключенная запись не считается — выбор этого Ticket-а.
- Без него: Remove из одного Project-а молча ломал бы Jira другого клиента.
- Требование: [Что делаем, пункт 5](../issues/03-модель-хранилище-и-adr.md#что-делаем)
- Риски и пробелы test-ов: две записи Project-ов идут по одной; обрыв между ними оставит запись, которую `list` уже не
  покажет (Integration нет на Machine).

## 7. Что сознательно не меняли

- `src/main/link/secrets.ts` — только читать: сообщения `FileSecretStore` говорят «link secrets file» и для
  `integrations/secrets.json`; путь к файлу в сообщении верный, секрета в нём нет.
- `mcp.allowed` и policy tier не тронуты: Integration-ы в списке не живут (ADR-0021, Amendment 2026-11-20).
- Proxy, вход и экран — Ticket-ы 04–08; статус пока только «есть ли нужные секреты».

## 8. Как проверено

- `node scripts/vitest-electron.mjs test/unit/integrations-catalogue.test.ts` — до правки exit 1 (модуля нет), после —
  exit 0 (7 tests).
- `node scripts/vitest-electron.mjs test/contract/integrations-store.test.ts` — до правки exit 1 (модуля нет), после —
  exit 0 (14 tests).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0.

## Проверить себя

1. Почему `writeProjectSettings` не берёт `integrations` из входа, хотя схема входа его допускает?
   - Ответ: поле меняет только `writeProjectIntegrations`; окно Project settings и Linked machine старой сборки шлют
     настройки без него или со старой копией, и запись стёрла бы или откатила включения.
   - Строки: `src/main/projects/settings.ts:65-66`
2. Что видит Linked machine с полным доступом, если вызывает `integrations.setSecret`?
   - Ответ: отказ «not open to Linked machines»: канал помечен `local`, адаптер связи его не регистрирует.
   - Строки: `src/shared/ipc/integrations.ts:104-109`
3. Что останется на диске, если Remove оборвётся посередине?
   - Ответ: Integration в списке без части или всех секретов (needs-sign-in), но не секрет без Integration: секреты
     удаляются первыми.
   - Строки: `src/main/integrations/store.ts:182-186`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-integrations 03 (the Integration model, the Machine store with secrets apart, per-Project enabling, ADR-0111), head fb1dcb679dffbc4cef5072852f10d3e01556d85c
>
> Gate (depth medium, one round): verifier (lens: implementer's claims, sonnet) — all 7 claims CONFIRMED; reviewer (correctness) — MERGE, no critical/high/medium findings.
>
> - Model: an Integration lives on the Machine in <WORFY_DATA_DIR>/integrations/integrations.json (no secrets; temp file + rename); secrets in integrations/secrets.json through FileSecretStore (0600 file in a 0700 folder; keys <id>:access|refresh|client|env:<NAME>); label unique per Machine, case- and space-insensitive. A Project enables it in its settings.json field integrations ({id, enabled, tools, autopilot}); the Project settings Save keeps the stored field. Catalogue: https for every service, Custom server http|stdio, GitHub token only, Figma «may refuse worfy», no Slack.
> - Link access: list/status — project read; setEnabled/setTools/setAutopilot/rename — project write; add/setSecret/remove — local only, so a secret never goes over the link channels.
> - Evidence: catalogue + store tests red without src (exit 1) and green after (21 tests, exit 0), re-run by the verifier; mutants caught by the reviewer and verifier (setSecret opened to a Linked machine; Save dropping integrations) → red; 10 settings-related files 264 tests EXIT=0; pnpm lint + typecheck + test (876 files) EXIT=0; gate fast green EXIT=0; story-check, evidence-check, check-feature-docs EXIT=0. ADR-0111 matches the spec (Q2, Q3, Q9); ADR-0021 has a dated line.
> - Low findings (not tickets): one unreadable entry empties the whole list (only on a build rollback); FileSecretStore messages say «link secrets»; Remove that fails mid-way leaves orphan ids in Projects (harmless now — ticket 06 must resolve by the store, noted for its brief); Add may leave the Integration not enabled if settings.json fails; ADR-0111 point 8 «never over the link» holds for integrations.* channels, while Full access already gives a shell; the repo/home sha256 check proves little.
>
> Decided without the owner (to confirm): integrations field in projectSettingsSchema; secretEnv / headerName on transports; status before the proxy = all secrets present → signed-in; Remove asks only when enabled in another Project; folder 0700 from the first write; rename relabels Machine-wide; catalogue add refuses a foreign address; Figma OAuth only; link-access test list extended.
