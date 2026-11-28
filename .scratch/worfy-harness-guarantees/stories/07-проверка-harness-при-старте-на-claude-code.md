# Code story — worfy-harness-guarantees 07: Проверка Harness при старте на Claude Code

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

`sdkInit` выбрасывал `plugins` и `plugin_errors` из `system/init`: Session, где plugin `worfy` не загрузился, ничего не
говорила. У драйвера Claude не было части `harnessHooks`, и Autopilot на Claude Code стартовал без проверки, хотя без
hooks Harness guard-ы и gate не держатся.

- Требование: [Что происходит](../issues/07-проверка-harness-при-старте-на-claude-code.md#что-происходит)

## 2. `system/init` несёт plugin-ы и их ошибки

Code: `src/shared/vendors/claude/events.ts:39-44` · key lines: 39, 44

```ts
  plugins: z.array(z.object({ name: str, path: optStr })).nullish().catch(null),
  plugin_errors: z
    .array(z.unknown())
    .nullish()
    .catch(null)
    .transform((entries) => (entries ?? []).flatMap((entry) => pluginError.safeParse(entry).data ?? [])),
```

- Что делает: читает `plugins` и `plugin_errors` в схеме `system/init`; запись ошибки чужой формы отбрасывается, а
  `plugins` чужой формы читается как отсутствующий — тогда событие их не несёт и ничего не проверяется.
- Почему здесь: Ticket называет `sdkInit` (`events.ts:25-33`) в «Где в коде»; формы — fixture spike-а 01.
- Без него: событие `init` не знало бы, загрузился ли Harness, и notice не из чего было бы сделать.
- Требование: [Что строить](../issues/07-проверка-harness-при-старте-на-claude-code.md#что-строить)
- Риски и пробелы test-ов: одна плохая строка `plugins` гасит проверку всей Session; test есть, но реальный Claude
  Code такую форму не присылал.

## 3. Чья это ошибка: папка с `@inline`, а не `worfy`

Code: `src/main/vendors/claude/harness-hooks.ts:74-81` · key lines: 77, 78, 80

```ts
  const folders = new Set<string>()
  if (typeof given === 'string') folders.add(basename(given))
  if (loaded !== undefined && loaded.path !== null && loaded.path !== '') folders.add(basename(loaded.path))
  const ours = (plugin: string): boolean =>
    bareName(plugin) === HARNESS || (plugin.endsWith('@inline') && folders.has(bareName(plugin))) || (typeof given === 'string' && /^inline\[\d+\]$/.test(plugin))
  const errors = (init.pluginErrors ?? []).filter((error) => ours(error.plugin)).map(({ type, message }) => ({ type, message }))
  if (loaded === undefined && typeof given === 'string') return [{ type: 'not-loaded', message: `Claude Code did not load the plugin ${HARNESS} from ${given}.` }, ...errors]
  return errors
```

- Что делает: ошибка — ошибка Harness, если её `plugin` — `worfy@…`, `<папка>@inline` (папка, которую worfy дал, или
  `path` строки `worfy`), или `inline[N]`; plugin `worfy`, которого нет, — проблема, только если worfy его дал.
- Почему здесь: spike 01 записал, что для сломанного `hooks.json` поле `plugin` — имя папки копии с `@inline`
  (`init-plugin-errors.jsonl`, строка 2), поэтому сверка по имени `worfy` ошибку бы не нашла.
- Без него: notice не появился бы на единственном случае, где Claude Code сообщает ошибку Harness.
- Требование: [Итог, расхождение 1](../issues/07-проверка-harness-при-старте-на-claude-code.md#итог)
- Риски и пробелы test-ов: другой inline plugin в папке с тем же именем считался бы Harness; worfy такого не даёт.

## 4. Notice шлёт handle после первого `system/init`

Code: `src/main/vendors/claude/session.ts:567-574` · key lines: 569, 573

```ts
  private checkHarness(init: Extract<AgentEvent, { type: 'init' }>): void {
    if (this.harnessChecked) return
    this.harnessChecked = true
    const notice = harnessNotice(harnessLoadProblems(init, this.harnessGiven), { given: this.harnessGiven, init })
    if (notice === null) return
    console.warn(`[claude] the Harness did not load in ${this.label}: ${notice.text.split('\n')[0] ?? ''}`)
    this.out.push(notice)
  }
```

- Что делает: один раз на процесс Claude Code проверяет первый init против Harness, который назвала фабрика
  (`QueryRequest.harnessGiven`), и кладёт notice «Harness did not load» сразу за `init`.
- Почему здесь: только main знает, какую папку Harness получил query (`sessionHarnessPlugin` в `query.ts`); Ticket
  называет место notice в renderer «по месту», а кто его шлёт — не записано.
- Без него: renderer показал бы строку только по имени `worfy` и не заметил бы, что plugin-а нет совсем.
- Требование: [Готово, когда, пункт 1](../issues/07-проверка-harness-при-старте-на-claude-code.md#готово-когда)
- Риски и пробелы test-ов: init приходит каждый ход; notice — только первого. Ошибка, появившаяся позже в том же
  процессе (`reload-plugins`), notice не даёт.

## 5. Часть `harnessHooks`: список hooks без модели

Code: `src/main/vendors/claude/harness-hooks.ts:117-126` · key lines: 119, 122, 123

```ts
export function hooksListingAnswer(listing: unknown): HarnessHooksAnswer {
  if (!isObject(listing) || !Array.isArray(listing.hooks)) return { trust: 'unknown', reason: 'Claude Code answered the hooks listing in a shape worfy does not know.' }
  const rows = (listing.hooks as unknown[]).filter((row): row is Json => isObject(row) && typeof row.pluginName === 'string' && bareName(row.pluginName) === HARNESS)
  for (const event of REQUIRED_EVENTS) {
    const listed = rows.filter((row) => row.event === event)
    if (listed.length === 0) return { trust: 'unknown', reason: `Claude Code lists no ${event} hook of the plugin ${HARNESS}.` }
    if (listed.some((row) => row.disabled === true)) return { trust: 'unknown', reason: `Claude Code keeps the ${event} hooks of the plugin ${HARNESS} from running.` }
  }
  return { trust: 'approved', reason: null }
}
```

- Что делает: по ответу `get_hooks_listing` отвечает `approved`, когда у plugin-а `worfy` есть строки PreToolUse и
  Stop и ни одна не `disabled`; иначе `unknown` с причиной.
- Почему здесь: без сообщения Claude Code `system/init` не шлёт (проверено в этом Ticket-е на binary SDK 0.3.322 с
  временным HOME), а `get_hooks_listing` подтвердил spike 01: сломанный `hooks.json` убирает строки plugin-а,
  `disableAllHooks` ставит `disabled: true`.
- Без него: Autopilot стартовал бы на Claude Code со сломанным или выключенным Harness.
- Требование: [Итог, расхождение 2](../issues/07-проверка-harness-при-старте-на-claude-code.md#итог)
- Риски и пробелы test-ов: нет скрипта hook-а — строки на месте, проверка отвечает `approved`; настоящий Claude Code в
  test-ах не запускается, ответ — записанной формы.

## 6. Отказ Autopilot называет причину

Code: `src/main/agent/orchestrator.ts:591-595` · key lines: 593, 595

```ts
    // trust() and check() never throw by their contract; a part that does anyway refuses, as `unknown` does.
    const unknown = { trust: 'unknown' as const, reason: null }
    const answer = hooks.check !== undefined ? await hooks.check(root).catch(() => unknown) : { trust: await hooks.trust(root).catch(() => 'unknown' as const), reason: null }
    if (answer.trust === 'approved') return null
    return answer.reason === null ? hooks.refusal : `${hooks.refusal} ${answer.reason}`
```

- Что делает: берёт `check()` части, если она есть, и ставит причину после текста отказа; у Codex `check` нет, и
  отказ прежний.
- Почему здесь: Ticket называет `unattendedRefusal` (`orchestrator.ts:569`) в «Где в коде».
- Без него: отказ на Claude Code не говорил бы, что именно не так с hooks.
- Требование: [Готово, когда, пункт 3](../issues/07-проверка-harness-при-старте-на-claude-code.md#готово-когда)
- Риски и пробелы test-ов: не записано

## 7. Старый Harness не проверяется

Code: `src/main/vendors/claude/harness-hooks.ts:155-159` · key lines: 159

```ts
  // shortcut: the old Harness (ADR-0049) is not checked — its hooks are lines of ~/.claude/settings.json that worfy
  // does not tell from the user's own, and Autopilot starts on it as before this check; redo when a machine with the
  // old Harness must be refused too, or drop it once the move to the plugin (src/main/harness/migrate/) has no old
  // Harness left to find.
  if (plugin === null) return { trust: 'approved', reason: null }
```

- Что делает: старый Harness (ADR-0049) не проверяется — worfy не даёт ему plugin, и часть отвечает `approved`.
- Почему здесь: его hooks — строки `~/.claude/settings.json`, которые worfy не отличает от hooks пользователя; так
  записано в комментарии `shortcut:` и в «Итог» Ticket-а.
- Без него: отказывали бы машины без переезда на plugin и Autopilot e2e, где лежит старый `bin/epic-status`.
- Требование: [Итог, расхождение 4](../issues/07-проверка-harness-при-старте-на-claude-code.md#итог)
- Риски и пробелы test-ов: Autopilot на старом Harness стартует, даже если его hooks выключены.

## 8. Как проверено

`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 в worktree. На дереве `origin/main` те же test-ы красные: handle дал
`['init', 'init']` без notice, блока `notice-block` нет. E2e `test/e2e/harness-did-not-load.spec.ts` локально не
запускался — его гонит CI.

## Проверить себя

1. Почему сверка ошибок по имени `worfy` пропустила бы сломанный `hooks.json`?
   Ответ: Claude Code называет в `plugin_errors` папку inline-plugin-а с `@inline`, а не имя из манифеста.
   Строки: `src/main/vendors/claude/harness-hooks.ts:77-78`
2. Почему часть `harnessHooks` не читает `system/init`, как просил Ticket?
   Ответ: без сообщения Claude Code его не шлёт, а сообщение позвало бы модель; поэтому часть читает список hooks.
   Строки: `src/main/vendors/claude/harness-hooks.ts:117-126`
3. Что увидит Autopilot на машине со старым Harness?
   Ответ: старт без проверки — часть отвечает `approved`, потому что worfy не дал plugin.
   Строки: `src/main/vendors/claude/harness-hooks.ts:159-159`
