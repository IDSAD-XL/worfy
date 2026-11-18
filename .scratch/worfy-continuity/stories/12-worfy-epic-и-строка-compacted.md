# Code story — worfy-continuity 12: worfy: `WORFY_EPIC`, дописка к system prompt, Codex `compact_prompt`, строка «Context compacted»

Kind: pr · Epic: worfy-continuity · Ticket: 12 · PR: - · Language: ru

## 1. Что было не так

Hook `after-compact` Harness-а (Ticket 11) отдаёт Orchestrator-у после compaction `wave-brief` Epic-а из `WORFY_EPIC`,
но worfy эту переменную никому не ставил: hook брал Epic ветки или первый из Epics in play. Codex писал summary своим
prompt-ом, без правил Ticket-а 10. А на compaction Session view ничего не показывал: worfy лишь заново спрашивал
заполнение контекста.

Посылка тикета, что Session Orchestrator-а для Wave запускает `src/main/actions/launch.ts`, не подтвердилась:
`sendWave` только шлёт текст в Session, которую уже запустил `src/main/agent/orchestrator.ts`, а окружение процесса
фиксируется при старте. Поэтому Epic ставится там, где Session стартует.

- Требование: [Что происходит](../issues/12-worfy-epic-и-строка-compacted.md#что-происходит)

## 2. Epic берётся при старте unattended Session

Code: `src/main/agent/orchestrator.ts:749-754` · key lines: 752, 753

```ts
    try {
      // Marked as the Orchestrator for its autocompact window, and an unattended one with the Epic of its run;
      // the launch kept in the entry stays as it is.
      const epic = entry.launch.unattended ? this.waveEpic(entry.projectId) : null
      const launch: SessionLaunch = { ...entry.launch, orchestrator: true, ...(epic === null ? {} : { epic }) }
      run.session = this.deps.registry.start(entry.path, resume, (sessionId, event) => this.onEvent(entry, run, sessionId, event), entry.settings, launch, after, entry.vendor)
```

- Что делает: каждый старт Session Orchestrator-а проходит через `launch()`; unattended Session (Autopilot) получает Epic
  того Run-а, что держит Orchestrator, и несёт его в `SessionLaunch.epic` дальше, до driver-а. Attended Session Epic-а
  не получает.
- Почему здесь: и старт Run-а (`setUnattended`), и новая SDK session перед каждой следующей Wave
  (`newUnattendedSession`) идут через `launch()`; к этому времени `run.epic` уже Epic этой Wave, в том числе следующий
  Epic очереди. Файла нет в «Где в коде» — правка согласована с Orchestrator-ом (см. «Итог» Ticket-а).
- Без него: `WORFY_EPIC` не дошёл бы ни до одного процесса — `launch.ts` в окружение не попадает.
- Требование: [Что делаем, пункт 1](../issues/12-worfy-epic-и-строка-compacted.md#что-делаем),
  [Итог](../issues/12-worfy-epic-и-строка-compacted.md#итог)
- Риски и пробелы test-ов: «Run wave» руками в уже запущенный attended Orchestrator Epic-а не даёт — это записано в
  «Итог» и на странице `sessions.md`. Если Run шлёт Wave нового Epic-а очереди в ту же Session (`fresh === 'same'`),
  окружение остаётся от прежнего Epic-а; test этого случая нет.

## 3. Связь с Autopilot без цикла импортов

Code: `src/main/agent/app-orchestrators.ts:84-103` · key lines: 84, 88, 97, 99

```ts
let autopilotModule: Pick<typeof import('../ipc/autopilot'), 'existingAutopilot'> | null = null

/** The Epic of the Project's run that goes on or is starting; null with no Autopilot made yet, or no run. */
function runningEpic(projectId: string): string | null {
  return autopilotModule?.existingAutopilot()?.runningEpic(projectId) ?? null
}

/** What a Node shows before its Session says anything, when the transcript is not read. */
const NO_FACTS: TranscriptFacts = { model: null, statusBlock: null }

/** The app's Orchestrators, made on first use. */
export function sharedOrchestrators(): Orchestrators {
  if (shared === null) {
    void import('../ipc/autopilot').then(
      (module) => {
        autopilotModule = module
      },
      (error: unknown) => console.warn('[orchestrator] could not load Autopilot: no Session gets the Epic of a run', error),
    )
    const claude = new ClaudeHomeRegistry({ home: claudeHome() })
```

- Что делает: `waveEpic` Orchestrators отвечает `Autopilot.runningEpic` — Epic Run-а, который идёт или стартует, и `null`
  без Run-а. Модуль Autopilot грузится динамическим `import()`, когда создаются Orchestrators.
- Почему здесь: `ipc/autopilot.ts` сам импортирует этот модуль; статический импорт дал бы цикл. Так же Autopilot
  достаёт `src/main/mcp/browser-server.ts`. Условие Orchestrator-а — ленивый или динамический путь.
- Без него: Orchestrators не знали бы Epic Run-а, а `run.ts` — файл соседнего Ticket-а 06, его не трогаем.
- Требование: [Что делаем, пункт 1](../issues/12-worfy-epic-и-строка-compacted.md#что-делаем)
- Риски и пробелы test-ов: сама проводка (`waveEpic: runningEpic`) test-ом не покрыта; test-ы Orchestrators подставляют
  свой `waveEpic`. Run существует только после загрузки `ipc/autopilot`, поэтому `null` от ещё не загруженного модуля
  на деле не встречается — это вывод, не проверка.

## 4. Переменная и строка system prompt у Claude Code

Code: `src/main/vendors/claude/options.ts:760-767` · key lines: 764, 766

```ts
/** The environment of a Session's Claude Code: `env`, the Run's variables over it, the kind of a Product Session and the Epic of a Wave. */
function sessionEnv(input: SessionOptionsInput): Env {
  const own: Env = {
    ...(input.kind === 'product' ? { [SESSION_KIND_VARIABLE]: 'product' } : {}),
    ...(input.epic !== undefined && input.epic !== '' ? { [EPIC_VARIABLE]: input.epic } : {}),
  }
  return input.environment === undefined && Object.keys(own).length === 0 ? input.env : { ...input.env, ...input.environment, ...own }
}
```

- Что делает: `WORFY_EPIC` ложится в окружение Claude Code поверх переменных Run-а, рядом с `WORFY_SESSION_KIND`;
  Session без Wave получает `env` как был. Тот же `epic` добавляет в конец дописки к system prompt строку
  `waveInstructions` (`options.ts:844`): Epic и просьба запустить `wave-brief <epic>` после compaction.
- Почему здесь: Ticket называет `options.ts` и `sessionEnv`. Дописка — по «Итогу» spike-а 01, вопрос 4: она переживает
  compaction главной Session. Строка называет только Epic: Session стартует до того, как Run прочитал Ticket-ы Wave.
- Без него: hook после compaction не узнал бы Epic Run-а; при сбое hook-а (риск 13 spec-а) модели не осталось бы
  ничего, кроме ветки.
- Требование: [Что делаем, пункты 1 и 2](../issues/12-worfy-epic-и-строка-compacted.md#что-делаем)
- Риски и пробелы test-ов: Subagent-ы дописку не видят (spike 01) — их держит hook и `common.md`.

## 5. Строка «Context compacted»

Code: `src/shared/vendors/claude/events.ts:189-206` · key lines: 193, 197, 198, 205, 206

```ts
export function compactedText(message: unknown): string {
  const raw = message !== null && typeof message === 'object' ? (message as { compact_metadata?: unknown }).compact_metadata : undefined
  const metadata = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const trigger = typeof metadata.trigger === 'string' && metadata.trigger !== '' ? metadata.trigger : null
  const before = count(metadata.pre_tokens)
  const after = count(metadata.post_tokens)
  let text = 'Context compacted'
  if (trigger !== null) text += ` (${trigger})`
  if (before !== null) text += ` · ${shortTokens(before)}${after === null ? '' : ` → ${shortTokens(after)}`}`
  return text
}

function mapSystem(subtype: string, message: unknown): AgentEvent[] {
  if (QUIET_SYSTEM.has(subtype)) return []
  switch (subtype) {
    case 'compact_boundary':
      return [{ type: 'notice', kind: 'notification', text: compactedText(message) }]
```

- Что делает: `system/compact_boundary` становится notice `Context compacted (auto) · 812K → 41K`; без `post_tokens` —
  без второго числа; без метаданных — просто `Context compacted`. Notice вида `notification` Session view уже
  показывает строкой в ленте, поэтому `src/renderer/session/` не правился.
- Почему здесь: Ticket называет `events.ts` и формат строки; `post_tokens` в типе SDK необязателен. Числа — как у
  Context meter (`ContextMeter.tsx`, функция `tokens`), почему именно так — не записано.
- Без него: compaction в ленте не видна, раньше это сообщение давало событие `unknown`.
- Требование: [Что делаем, пункт 4](../issues/12-worfy-epic-и-строка-compacted.md#что-делаем)
- Риски и пробелы test-ов: Session, открытая заново из транскрипта, строки не покажет — разбор транскрипта
  (`src/shared/transcript/parse.ts`) вне следа Ticket-а. Снимка экрана нет: GUI на этом Mac агентам запускать нельзя.

## 6. Codex: `compact_prompt`, `WORFY_EPIC` и строка

Code: `src/main/vendors/codex/session.ts:941-946` · key lines: 943, 946

```ts
  const runEnv = opts.environment === undefined ? tokenEnv : { ...tokenEnv, ...opts.environment }
  // The Epic of a Session that runs a Wave (worfy-continuity ticket 12): the Harness's after-compact hook reads it.
  const env = opts.epic === undefined || opts.epic === '' ? runEnv : { ...runEnv, [EPIC_VARIABLE]: opts.epic }
  // The same variables pinned in every command's shell, where the owner's include_only does not drop them (codexPinned); none in Off.
  const pinned = opts.environment === undefined ? null : codexPinned(env, opts.environment)
  const config = { ...mcp?.config, ...(pinned === null ? {} : codexPinConfig(pinned)), compact_prompt: CODEX_COMPACT_PROMPT }
```

- Что делает: каждый thread — и `thread/start`, и `thread/resume` — получает `compact_prompt`: строка с задачей и
  `harness/hooks/rules/compaction.md` целиком (`CODEX_COMPACT_PROMPT`, `session.ts:149`, текст вшит при сборке через
  `?raw`). Codex Orchestrator Wave получает `WORFY_EPIC` в окружении app-server, не закреплённым в shell policy.
  Элемент `contextCompaction` даёт строку `Context compacted` (`items.ts:313-316`).
- Почему здесь: Ticket называет `codex/session.ts` и `items.ts`. «Итог» spike-а 01, вопрос 5: `compact_prompt` —
  замена prompt-а Codex, поэтому в нём весь prompt; stdout `PreCompact` Codex не читает; в `contextCompaction` нет ни
  trigger, ни чисел.
- Без него: summary Codex писался бы без разделов Harness-а.
- Требование: [Что делаем, пункт 3](../issues/12-worfy-epic-и-строка-compacted.md#что-делаем)
- Риски и пробелы test-ов: что настоящий Codex 0.166.0 пишет summary по этому prompt-у, запуском не проверено (brief
  запрещает настоящий Codex); test-ы идут на fake app-server. `compact_prompt` перекрывает такой же ключ config.toml
  пользователя — это записано на странице `sessions.md`.

## 7. Что сознательно не меняли

- `src/main/actions/launch.ts` и `src/main/autopilot/run.ts` — Session там не стартует; `run.ts` — файл Ticket-а 06.
- `src/renderer/session/` — notice уже показывается строкой.
- `src/shared/transcript/parse.ts` — нет в «Где в коде».
- Русская страница `docs/features/ru/sessions.md` — Ticket 14.

## 8. Как проверено

- Каждый новый test сначала красный: `test/unit/claude-compact-line.test.ts`, `test/contract/agent-compacted-line.test.ts`
  (на исходном `events.ts`), `test/unit/agent-options.test.ts`, `test/contract/orchestrator-wave-epic.test.ts`,
  `test/contract/codex-session.test.ts`, `test/unit/codex-history.test.ts` — красные до правки, зелёные после.
- `bash harness/hooks/tests/session-hooks.test.sh` — exit 0, 54 проверки; на копии Harness с обратным порядком выбора
  Epic-а в `after-compact.mjs` — exit 1, проваливается новая проверка «WORFY_EPIC comes before the Epic of the
  checkout's branch» (долг Ticket-а 11).
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (839 файлов test-ов); gate fast — exit 0.

## Проверить себя

1. Почему `WORFY_EPIC` ставит Orchestrators, а не `launch.ts`, где известен Epic Wave?
   - Строки: `src/main/agent/orchestrator.ts:752-754`
   - Ответ: окружение процесса фиксируется при старте, а `launch.ts` шлёт текст в Session, которая уже идёт; Session
     стартует в `launch()` Orchestrators, и для Autopilot Epic Run-а к этому времени уже известен.
2. Что увидит человек в Codex Session после compaction и почему без чисел?
   - Строки: `src/main/vendors/codex/items.ts:313-316`
   - Ответ: строку `Context compacted`; элемент `contextCompaction` не несёт ни trigger, ни числа токенов.
