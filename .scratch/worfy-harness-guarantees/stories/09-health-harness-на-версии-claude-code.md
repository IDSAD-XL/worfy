# Code story — worfy-harness-guarantees 09: Health: Harness на версии Claude Code

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

Claude Code в терминале обновляется сам, а Health только предупреждал, что он старше копии worfy. Держатся ли на новой
версии hooks Harness (guard, Stop), worfy не знал: contract set Ticket-а 08 шёл лишь в `pnpm test` на binary SDK.

- Требование: [Что происходит](../issues/09-health-harness-на-версии-claude-code.md#что-происходит)

## 2. Один запуск на пару версий, итог в кэше

Code: `src/main/first-run/harness-claude.ts:150-170` · key lines: 151, 154, 156, 161

```ts
  private async entry(claude: Extract<ClaudeFound, { kind: 'found' }>, harness: { dir: string; version: string }, copy: ClaudeCopy, again: boolean): Promise<Entry> {
    const key = keyOf(claude.version, harness.version)
    const under = this.running.get(key)
    if (under !== undefined) return under
    if (!again) {
      const kept = this.read().find((each) => keyOf(each.claudeVersion, each.harnessVersion) === key)
      if (kept !== undefined) return kept
    }
    const run = (async (): Promise<Entry> => {
      const result = await this.deps.runSet(claude.binary, harness.dir, copy)
      const entry: Entry = { claudeVersion: claude.version, harnessVersion: harness.version, at: (this.deps.now?.() ?? new Date()).toISOString(), outcomes: result.outcomes, warnings: result.warnings }
      this.write(entry)
      return entry
    })()
    this.running.set(key, run)
    try {
      return await run
    } finally {
      this.running.delete(key)
    }
  }
```

- Что делает: ключ — версия Claude Code и версия Harness. Есть итог в `harness-claude.json` — он и ответ; идёт запуск
  той же пары — ждёт его; иначе (или с `again`, это Run again) запускает набор и пишет итог в кэш.
- Почему здесь: Ticket требует «один раз на пару» и кэш в данных worfy (ADR-0005); файл — новый модуль рядом с
  check-ами `src/main/first-run/`.
- Без него: каждое открытие Health запускало бы шесть процессов Claude Code на каждую копию.
- Требование: [Готово, когда, пункт 1](../issues/09-health-harness-на-версии-claude-code.md#готово-когда)
- Риски и пробелы test-ов: итог `not-run` тоже кэшируется — случайный сбой окружения держится до Run again или новой
  версии. Набор, который бросил исключение, не кэшируется (test).

## 3. Каждый case — с PATH login shell и сбором plugin_warnings

Code: `src/main/first-run/harness-claude.ts:251-270` · key lines: 255, 262, 264

```ts
export function contractSetRun(loginEnv: () => Promise<Env>, run: typeof runContractSet = runContractSet, runLimitMs = HEALTH_RUN_LIMIT_MS): HarnessClaudeDeps['runSet'] {
  return async (binary, pluginDir) => {
    const env = await loginEnv()
    const passed: Record<string, string> = {}
    for (const name of PASSED_ON) {
      const value = getVar(env, name)
      if (value !== undefined && value !== '') passed[name] = value
    }
    const warnings = new Set<string>()
    const cases: ContractCase[] = CONTRACT_CASES.map((each) => ({
      ...each,
      prepare: (context) => ({ ...(each.prepare?.(context) ?? {}), ...passed }),
      check: (caseRun) => {
        for (const warning of pluginWarnings(caseRun.init)) warnings.add(warning)
        return each.check(caseRun)
      },
    }))
    const outcomes = await run(cases, { binary, pluginDir, runLimitMs })
    return { outcomes, warnings: [...warnings] }
  }
```

- Что делает: обёртывает case-ы Ticket-а 08, не правя их и runner: `prepare` добавляет PATH (и
  `CLAUDE_CODE_GIT_BASH_PATH`) login shell, `check` собирает `plugin_warnings` из `system/init`.
- Почему здесь: Ticket разрешает в `src/main/harness/contract/` только вызов runner-а; `claudeEnv` берёт PATH процесса
  worfy, а у копии, открытой из Finder, в нём нет `node`, которым стартуют hooks Harness.
- Без него: hooks не стартовали бы, и строки краснели бы не из-за Harness; предупреждения Claude Code 2.1.332 о
  `engines` не дошли бы до Health.
- Требование: [Что строить](../issues/09-health-harness-на-версии-claude-code.md#что-строить)
- Риски и пробелы test-ов: на настоящем binary проверено временным test-ом на 2.1.322; формы `plugin_warnings`
  2.1.332 test берёт из записи polish 175, сам binary 2.1.332 не запускался.

## 4. «Guard не отказал» и «не смог запустить» — разные строки

Code: `src/main/first-run/harness-claude.ts:213-223` · key lines: 215, 218, 222

```ts
  if (failed.length === 1) {
    const [one] = failed
    return make(copy, 'fail', `${label} · ${one!.id}: ${brief(one!.reason)}`, 'The guard and the gate may not hold on this Claude Code; Copy details has what each check saw', actions, details)
  }
  if (failed.length > 1) {
    return make(copy, 'fail', `${label} · ${failed.length} of ${total} checks failed: ${failed.map((each) => each.id).join(', ')}`, 'The guard and the gate may not hold on this Claude Code; Copy details has what each check saw', actions, details)
  }
  if (notRun.length > 0) {
    const [first] = notRun
    return make(copy, 'unknown', `${label} · the checks could not run: ${first!.id}: ${brief(first!.reason)}`, 'Nothing is known about the Harness on this Claude Code; Run again, or Copy details', actions, details)
  }
```

- Что делает: `failed` runner-а — красная строка с именем case-а; `not-run` — статус `unknown` («Couldn't check: …»),
  без toast-а; провал важнее незапуска.
- Почему здесь: Ticket требует разные тексты; runner Ticket-а 08 различает эти два ответа для Health (шапка
  `runner.ts`).
- Без него: stand-in, отставший от API, давал бы ложный красный «guard не отказал».
- Требование: [Готово, когда, пункт 2](../issues/09-health-harness-на-версии-claude-code.md#готово-когда)
- Риски и пробелы test-ов: уровень строк — non-critical (`severity.ts`); почему не critical — не записано в spec-е,
  решение этого Ticket-а.

## 5. Строки — среди сетевых строк Health, Run again — свой канал

Code: `src/main/ipc/first-run.ts:319-335` · key lines: 321, 330, 333

```ts
const harnessClaudeSpec = process.env.WORFY_HARNESS_CONTRACT
const harnessClaude: HarnessClaudeCheck | null =
  process.env.WORFY_AGENT === 'fake' && harnessClaudeSpec === undefined
    ? null
    : new HarnessClaudeCheck({
        cacheFile: join(dataRoot(), HARNESS_CLAUDE_CACHE),
        harness: () => {
          const dir = bundledHarnessDir()
          return { dir, version: bundledHarnessVersion(dir) }
        },
        claude: async (copy) => (copy === 'worfy' ? worfyClaude() : terminalClaude(await loginEnv())),
        runSet: process.env.WORFY_AGENT === 'fake' ? fakeSetRun(harnessClaudeSpec ?? '') : contractSetRun(loginEnv),
      })
if (harnessClaude !== null) {
  health.registerNetworkRows(() => harnessClaude.rows())
  for (const copy of ['worfy', 'terminal'] as const) health.registerRecheck(HARNESS_CLAUDE_ROWS[copy], () => harnessClaude.row(copy))
}
```

- Что делает: строки идут после локальных check-ов, как строки GitHub access, со своим re-check-ом на focus. Под
  `WORFY_AGENT=fake` набор — fake из `WORFY_HARNESS_CONTRACT`, а без переменной строк нет.
- Почему здесь: новая пара занимает секунды, и старт (`firstRun.startup`) не должен её ждать; e2e других функций
  считают строки Health (`CHECK_IDS`), поэтому по умолчанию в e2e строк нет.
- Без него: первый старт после обновления Claude Code ждал бы весь набор.
- Требование: [Решения по реализации, spec](../spec.md#решения-по-реализации)
- Риски и пробелы test-ов: связка в main проверена только e2e `health-harness-claude.spec.ts`, который локально не
  запускался — его гонит CI на macOS.

## 6. Как проверено

`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 в worktree. `test/unit/harness-claude-health.test.ts` был красным до
кода (нет модуля); test кнопок в `test/unit/settings-health.test.tsx` красный на старом `FirstRunChecks.tsx`.
Временный test (не в PR) прогнал `contractSetRun` на binary SDK 2.1.322 с `harness/`: строка `ok`.

## Проверить себя

1. Почему строка, где case не запустился, не красная и не даёт toast?
   Ответ: `not-run` значит, что о Harness ничего не известно (binary не стартовал, stand-in отстал), и красный был бы
   ложным «guard не отказал».
   Строки: `src/main/first-run/harness-claude.ts:220-223`
2. Зачем Health подменяет PATH в каждом case-е, если runner сам строит окружение?
   Ответ: `claudeEnv` берёт PATH процесса worfy; у приложения из Finder он без `node`, и hooks Harness не стартовали бы.
   Строки: `src/main/first-run/harness-claude.ts:255-262`
3. Что делает Run again, если запуск той же пары уже идёт?
   Ответ: ждёт идущий запуск, второй не начинает: ключ пары уже в `running`.
   Строки: `src/main/first-run/harness-claude.ts:151-153`
