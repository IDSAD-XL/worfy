# Code story — worfy-harness-guarantees 09: Health: Harness на версии Claude Code

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

Claude Code в терминале обновляется сам, а Health только предупреждал, что он старше копии worfy. Держатся ли на новой
версии hooks Harness (guard, Stop), worfy не знал: contract set Ticket-а 08 шёл лишь в `pnpm test` на binary SDK.

- Требование: [Что происходит](../issues/09-health-harness-на-версии-claude-code.md#что-происходит)

## 2. Один запуск на пару версий, итог в кэше

Code: `src/main/first-run/harness-claude.ts:232-263` · key lines: 237, 240, 242, 247, 249

```ts
  private async entry(claude: Extract<ClaudeFound, { kind: 'found' }>, harness: { dir: string; version: string }, copy: ClaudeCopy, again: boolean): Promise<Entry> {
    const key = keyOf(claude.version, harness.version)
    const under = this.running.get(key)
    if (under !== undefined) return under
    if (!again) {
      const kept = this.known(key)
      if (kept !== undefined) return kept
    }
    if (this.stopping.signal.aborted) throw new Error(STOPPED)
    const run = (async (): Promise<Entry> => {
      const result = await this.deps.runSet(claude.binary, harness.dir, copy, this.stopping.signal)
      const entry: Entry = { claudeVersion: claude.version, harnessVersion: harness.version, at: (this.deps.now?.() ?? new Date()).toISOString(), outcomes: result.outcomes, warnings: result.warnings }
      this.answers.set(key, entry)
      // A case that did not run (a time limit on a busy machine, worfy quitting) is not kept: the next start runs the
      // pair again. This app run keeps the answer (`answers`), so Health does not run it again on every check.
      if (entry.outcomes.every((each) => each.status !== 'not-run')) {
        try {
          this.write(entry)
        } catch (error) {
          // The answer still shows; only the next start runs the pair again.
          console.warn('[harness-claude] the answer could not be kept:', error instanceof Error ? error.message : 'error')
        }
      }
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

- Что делает: ключ — версия Claude Code и версия Harness. Есть ответ этого запуска worfy или итог в
  `harness-claude.json` — он и ответ; идёт запуск той же пары — ждёт его; иначе (или с `again`, это Run again)
  запускает набор. В файл пишет только ответ, где каждый case запустился, и ошибка записи ответа не теряет.
- Почему здесь: Ticket требует «один раз на пару» и кэш в данных worfy (ADR-0005); файл — новый модуль рядом с
  check-ами `src/main/first-run/`.
- Без него: каждое открытие Health запускало бы шесть процессов Claude Code на каждую копию, а `not-run` от
  перегруженной машины держался бы в кэше до новой версии.
- Требование: [Готово, когда, пункт 1](../issues/09-health-harness-на-версии-claude-code.md#готово-когда)
- Риски и пробелы test-ов: ответ `not-run` в этом запуске worfy повторяется только через Run again. Набор, который
  бросил исключение, не запоминается (test).

## 3. Каждый case — с PATH login shell и сбором plugin_warnings

Code: `src/main/first-run/harness-claude.ts:357-377` · key lines: 358, 362, 374

```ts
export function contractSetRun(loginEnv: () => Promise<Env>, run: typeof runContractSet = runContractSet, runLimitMs = HEALTH_RUN_LIMIT_MS): HarnessClaudeDeps['runSet'] {
  return async (binary, pluginDir, _copy, signal) => {
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
    const outcomes = await run(cases, { binary, pluginDir, runLimitMs, signal })
    return { outcomes, warnings: [...warnings] }
  }
}
```

- Что делает: обёртывает case-ы Ticket-а 08, не правя их: `prepare` добавляет PATH (и `CLAUDE_CODE_GIT_BASH_PATH`)
  login shell, `check` собирает `plugin_warnings` из `system/init`, `signal` идёт в runner.
- Почему здесь: `claudeEnv` берёт PATH процесса worfy, а у копии, открытой из Finder, в нём нет `node`, которым
  стартуют hooks Harness.
- Без него: hooks не стартовали бы, и строки краснели бы не из-за Harness; предупреждения Claude Code 2.1.332 о
  `engines` не дошли бы до Health.
- Требование: [Что строить](../issues/09-health-harness-на-версии-claude-code.md#что-строить)
- Риски и пробелы test-ов: на настоящем binary проверено временным test-ом на 2.1.322; формы `plugin_warnings`
  2.1.332 test берёт из записи polish 175, сам binary 2.1.332 не запускался.

## 4. «Guard не отказал» и «не смог запустить» — разные строки

Code: `src/main/first-run/harness-claude.ts:319-329` · key lines: 321, 324, 328

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

## 5. Health не ждёт набор: live rows

Code: `src/main/first-run/harness-claude.ts:291-297` · key lines: 292, 294, 295

```ts
export function showInHealth(check: HarnessClaudeCheck, health: Pick<HealthReports, 'registerLiveRows' | 'registerNetworkRows'>): void {
  check.onChange(health.registerLiveRows(() => check.current()))
  health.registerNetworkRows(() => {
    check.refresh().catch((error: unknown) => console.warn('[harness-claude] the check failed:', error instanceof Error ? error.name : 'error'))
    return Promise.resolve([])
  })
}
```

- Что делает: строки набора — live rows Health (`registerLiveRows`): Health читает их при каждой сборке отчёта.
  Сетевая проверка Health только запускает `refresh()` и сразу отвечает `[]`; строка новой пары — «running the
  checks…», готовый ответ уходит через `firstRun.reportChanged`.
- Почему здесь: `checkNetwork` ждёт все сетевые источники (`Promise.all`); набор — до 6 × 30 s на копию, и «Check
  again», «Use <login>» и строки GitHub access ждали бы его (review, раунд 1).
- Без него: кнопки Health висели бы на «Checking…» до конца набора.
- Требование: [Решения по реализации, spec](../spec.md#решения-по-реализации)
- Риски и пробелы test-ов: связка `showInHealth` с `HealthReports` проверена unit test-ом; сам main —
  только e2e `health-harness-claude.spec.ts`, который гонит CI на macOS.

## 6. Выход worfy останавливает набор

Code: `src/main/harness/contract/runner.ts:290-305` · key lines: 293, 301, 303, 305

```ts
    const args = ['-p', contractCase.prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--model', MODEL, '--setting-sources', '', '--permission-mode', 'bypassPermissions', '--plugin-dir', options.pluginDir]
    // On a stop the folder goes at once, after the kill (the listener of runBinary comes first): when worfy quits,
    // the `finally` below may never run.
    const removeNow = (): void => {
      try {
        removeTree(root)
      } catch {
        // A file the killed processes still hold (Windows): the folder stays in the system's temporary folder.
      }
    }
    // Stopped while it laid out the run: nothing starts, and the `finally` removes the folder.
    if (stopped()) return notRun(STOPPED)
    const running = runBinary(options.binary, args, context.cwd, env, options.runLimitMs, options.signal)
    options.signal?.addEventListener('abort', removeNow, { once: true })
    const spawned = await running.finally(() => options.signal?.removeEventListener('abort', removeNow))
    if (stopped()) return notRun(STOPPED)
```

- Что делает: на `will-quit` (`src/main/ipc/first-run.ts:336`) `stop()` отменяет `signal`; runBinary убивает дерево процессов тем же
  `stop()`, что и таймер, а case сразу удаляет свою временную папку и отвечает `not-run`; следующие case-ы не
  запускаются.
- Почему здесь: таймер runner-а умирает вместе с main, и без этого `claude -p` и его hooks оставались бы сиротами,
  а папки `contract-*` — в системной временной папке (review, раунд 1).
- Без него: после выхода во время набора — живые процессы Claude Code и мусор в tmp.
- Требование: [Решения по реализации, spec](../spec.md#решения-по-реализации)
- Риски и пробелы test-ов: test (`test/unit/contract-runner-stop.test.ts`) — на POSIX со shell script вместо
  `claude`; на Windows ветка `killTool` та же, что у таймера, но под stop не проверена.

## 7. Как проверено

`pnpm lint`, `pnpm typecheck` и unit и contract test-ы затронутых модулей (40 файлов) — exit 0 в worktree. Полный
`pnpm test` локально красный только на test-ах watcher-а и тайм-аутах под нагрузкой, не в этом коде; verdict — CI.
`test/unit/harness-claude-health.test.ts` был красным до кода (нет модуля); test кнопок в
`test/unit/settings-health.test.tsx` красный на старом `FirstRunChecks.tsx`. Каждый test правок review проверен
мутантом: 14 мутантов, все красные. Временный test (не в PR) прогнал `contractSetRun` на binary SDK 2.1.322 с
`harness/`: строка `ok`.

## Проверить себя

1. Почему строка, где case не запустился, не красная и не даёт toast?
   Ответ: `not-run` значит, что о Harness ничего не известно (binary не стартовал, stand-in отстал), и красный был бы
   ложным «guard не отказал».
   Строки: `src/main/first-run/harness-claude.ts:326-329`
2. Зачем Health подменяет PATH в каждом case-е, если runner сам строит окружение?
   Ответ: `claudeEnv` берёт PATH процесса worfy; у приложения из Finder он без `node`, и hooks Harness не стартовали бы.
   Строки: `src/main/first-run/harness-claude.ts:358-366`
3. Что делает Run again, если запуск той же пары уже идёт?
   Ответ: ждёт идущий запуск, второй не начинает: ключ пары уже в `running`.
   Строки: `src/main/first-run/harness-claude.ts:233-235`
