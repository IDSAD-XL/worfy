# Code story — worfy-harness-guarantees 08: Contract set без модели

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 08 · PR: - · Language: ru

## 1. Что было не так

На настоящем binary Claude Code проверялся только hook SessionStart, а полный eval Harness-а идёт лишь при смене SDK,
модели или Stable copy. PR, который поднимает SDK, не краснел, если hooks Harness-а на новом binary перестали
работать. PR строит набор из шести case-ов на binary SDK и stand-in-е Messages API, без модели, и запускает его в
`pnpm test`.

- Требование: [Что происходит](../issues/08-contract-set-без-модели.md#что-происходит)

## 2. Stand-in ведёт цепочку вызовов на разговор

Code: `src/main/harness/contract/messages-api-stand-in.ts:217-224` · key lines: 217, 219, 220
```ts
      const first = textOf(messages[0]?.content)
      requests.push({ system: textOf(json.system), first, last: textOf(messages.at(-1)?.content), tools })
      const next = chains.find((chain) => first.includes(chain.marker))?.calls.find((call) => !answered.has(call.id))
      if (next !== undefined && tools.includes(next.name)) {
        toolUse(res, next)
        return
      }
      text(res, stream, 'done')
```

- Что делает: узнаёт разговор (главный поток или Subagent) по метке в первом сообщении, записывает каждый запрос как
  текст и отдаёт следующий вызов цепочки, на который ещё нет `tool_result`; иначе — текст `done`.
- Почему здесь: Ticket велит перенести stand-in в `src/main/harness/contract/`, чтобы набор запускало и приложение
  (Ticket 09); цепочка — из spike-а 01: Bash у Subagent-а требует двух вызовов в двух разговорах.
- Без него: case 6 не получил бы хода Subagent-а, а case 5 не увидел бы, что пришло модели после Stop.
- Требование: [Что строить](../issues/08-contract-set-без-модели.md#что-строить)
- Риски и пробелы test-ов: отдельного unit test-а stand-in-а нет; его проверяют case-ы набора и старые contract
  test-ы, которые идут на `startMessagesApiStandIn` без изменений.

## 3. Runner отличает «не смог запустить» от красного case-а

Code: `src/main/harness/contract/runner.ts:222-247` · key lines: 226, 238, 241, 243, 246
```ts
export function judgeRun(trace: RunTrace): RunVerdict {
  if (trace.startError !== undefined) return { status: 'not-run', reason: `could not start the binary: ${trace.startError}` }
  const init = trace.lines.find((line) => line.type === 'system' && line.subtype === 'init')
  const stderr = `stderr: ${tail(trace.stderr)}`
  if (init === undefined)
    return { status: 'not-run', reason: `Claude Code printed no system/init (${trace.timedOut ? `stopped at the limit of ${trace.limitMs} ms` : `exit code ${String(trace.exitCode)}`}); ${stderr}` }
  const blocked = blockingHooks(trace.lines)
  const holding = blocked.length === 0 ? '' : `; hooks of the plugin blocked: ${[...new Set(blocked)].join('; ')}`
  const result = trace.lines.find((line) => line.type === 'result')
  const ended = trace.timedOut
    ? `Claude Code did not finish in ${trace.limitMs} ms and was stopped; ${trace.requests} turns asked the stand-in`
    : result === undefined
      ? `Claude Code printed no result (exit code ${String(trace.exitCode)})`
      : result.is_error === true
        ? `the turn ended with an error of the API or of Claude Code: ${tail(JSON.stringify(result), 400)}`
        : undefined
  if (trace.requests === 0) {
    const hung = hungHooks(trace.lines)
    const none = `Claude Code started with the plugin but asked the stand-in no turn (exit code ${String(trace.exitCode)})`
    if (blocked.length > 0 || hung.length > 0)
      return { status: 'failed', reason: `${none}${holding}${hung.length === 0 ? '' : `; hooks of the plugin that never answered: ${[...new Set(hung)].join(', ')}`}; ${stderr}` }
    return { status: 'not-run', reason: `${ended === undefined ? none : `${none}; ${ended}`}; ${stderr}` }
  }
  if (ended === undefined) return { status: 'ran', init }
  return blocked.length > 0 ? { status: 'failed', reason: `${ended}${holding}` } : { status: 'not-run', reason: `${ended}; ${stderr}` }
}
```

- Что делает: `not-run` — пока о Harness-е сказать нечего: binary не стартовал, нет `system/init`, или прогон без
  hook-а plugin-а, который его держал, кончился без хода к stand-in-у, ошибкой API (API недоступен), без `result` или
  пределом времени (медленная машина). Без хода `failed` только тогда, когда hook plugin-а блокировал (exit 2 или JSON с
  `decision: "block"`) или начал (`hook_started`) и не ответил; с ходами — когда любой обрыв прогона пришёлся на
  блокирующий hook. Полный прогон идёт в `check` case-а.
- Почему здесь: Ticket требует, чтобы Health (Ticket 09) писал «не смог запустить» и «guard не отказал» разными
  строками; spec называет риск «Stand-in отстаёт от API». Правила для прогона без хода — из review round 1 и 2
  PR #2345.
- Без него: Harness, чей UserPromptSubmit блокирует каждый prompt или чей Stop держит каждый ход, выглядел бы как
  «не смог запустить», и Health не покраснел бы.
- Требование: [Готово, когда, п. 2](../issues/08-contract-set-без-модели.md#готово-когда)
- Риски и пробелы test-ов: каждая ветка — unit test `test/unit/harness-contract-judge.test.ts`; на настоящем binary —
  несуществующий binary, сломанный `hooks.json`, блокирующий UserPromptSubmit и Stop, который держит ход и потом висит.
  Блокирующий hook узнаётся по `exit_code` 2 или JSON-ответу; другие формы блока Claude Code не сняты.

## 4. Stop при красном gate: gate — stub

Code: `src/main/harness/contract/cases.ts:120-130` · key lines: 125, 126, 129, 130
```ts
  prepare(context) {
    git(context, ['init', '-q'])
    git(context, ['commit', '-q', '--allow-empty', '-m', 'init'])
    // The gate is a stub: no gate runs. The resolver names the repository as registered, and the red
    // marker of its tree is what a red `gate.mjs fast` leaves (hooks/stop.mjs reads both).
    const resolver = join(context.scratch, 'gate-resolve-stub.mjs')
    writeFileSync(resolver, `process.stdout.write(${JSON.stringify(`${GATE_KEY}\t`)} + process.argv[3] + "\\tnpm\\n")\n`)
    const state = join(context.harnessHome, 'gate', 'state')
    mkdirSync(state, { recursive: true })
    writeFileSync(join(state, `red-${GATE_KEY}-${gateTag(git(context, ['rev-parse', '--show-toplevel']))}`), 'contract set: a red gate\n')
    return { CLAUDE_GATE_RESOLVE: resolver }
```

- Что делает: делает cwd репозиторием, кладёт resolver-stub, который называет его зарегистрированным, и маркер
  `red-<key>-<tag>` в state временного `HARNESS_HOME`; gate не запускается. `check` ждёт ещё один запрос главного
  потока с «The quality gate is red».
- Почему здесь: Ticket задаёт case (5) «gate — stub»; `hooks/stop.mjs` держит ход по resolver-у
  (`CLAUDE_GATE_RESOLVE`) и маркеру красного прогона. Почему stub именно resolver, а не запись в `gate/config.json`,
  не записано.
- Без него: Stop hook, который перестал держать ход, прошёл бы незамеченным; мутация `return 0` вместо `return 2`
  краснит этот case.
- Требование: [Что строить, case 5](../issues/08-contract-set-без-модели.md#что-строить)
- Риски и пробелы test-ов: имя маркера строится по выводу `git rev-parse --show-toplevel`, как в `stop.mjs`; на
  Windows это проверит только job CI.

## 5. Красный case на сломанном `hooks.json`

Code: `test/contract/harness-guarantees.test.ts:47-54` · key lines: 49, 50, 52, 53
```ts
  it('a copy of the Harness whose hooks.json does not parse (test/fixtures/harness-broken-hooks) gives a red case', async () => {
    const broken = join(scratch, 'harness-broken-hooks')
    cpSync(HARNESS, broken, { recursive: true })
    cpSync(join(REPO, 'test', 'fixtures', 'harness-broken-hooks'), broken, { recursive: true })
    const outcome = await runContractCase(PLUGIN_LOADED, options(broken))
    expectStatus(outcome, 'failed')
    expect(outcome.status === 'failed' && outcome.reason).toContain('hook-load-failed')
  })
```

- Что делает: копирует `harness/` во временную папку, кладёт сверху fixture `hooks/hooks.json`, который не JSON, и
  ждёт `failed` case-а `plugin-loaded` с `hook-load-failed` в причине.
- Почему здесь: Ticket требует, чтобы копия Harness со сломанным `hooks.json` давала красный case (`Test-ы`).
  Fixture — один файл поверх копии, а не полная копия Harness-а: полная копия в `test/fixtures/` отставала бы от
  `harness/`.
- Без него: набор мог бы быть зелёным при любом Harness-е, и это никто бы не заметил.
- Требование: [Test-ы](../issues/08-contract-set-без-модели.md#test-ы)
- Риски и пробелы test-ов: проверен один вид поломки; пропавший скрипт hook-а `plugin_errors` не даёт (spike 01), его
  ловят case-ы 4–6 при вызове.

## 6. Что сознательно не меняли

- Test `harness-plugin.test.ts:103` остался: он проверяет, что `WORFY_SESSION_KIND` доходит до hook-а, а case 2 —
  что правила полного Harness-а доходят до модели.
- `harness/` не тронут: Ticket разрешает hooks только читать.

## 7. Как проверено

- `pnpm test test/contract/harness-guarantees.test.ts` — exit 1 до кода (`Cannot find module`), exit 0 после.
- Четыре мутации копии Harness (временный test, не в PR) краснят каждая свой case: 4, 5, 6, 2.
- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0, `pnpm test` — exit 0; gate fast — exit 0.
- Review round 1: четыре новых test-а были красными на 32785ef5e (блокирующий UserPromptSubmit, Stop, который держит
  ход и потом висит, `check`, который бросает исключение, символ на границе chunk-ов); `test/unit/harness-contract-judge.test.ts` — exit 0.
- Review round 2: четыре unit test-а прогона без хода (предел, ошибка API, без hook-а, висящий hook) и test «a hook that
  hangs at the time limit ends with the run» были красными до правки; после — `test/unit/harness-contract-judge.test.ts`
  и `test/contract/harness-guarantees.test.ts` с временным HOME — exit 0.

## Проверить себя

1. Почему зависший прогон Claude Code не превращается в timeout test-а?
   Ответ: У runner-а свой предел `runLimitMs` ниже предела test-а; по нему процесс останавливается по своему pid, и
   case приходит как `not-run` — или как `failed`, если hook plugin-а блокировал ходы.
   Lines: `src/main/harness/contract/runner.ts:222-247`
2. Чем case 5 заменяет настоящий прогон gate?
   Ответ: Resolver-stub называет репозиторий зарегистрированным, а маркер `red-<key>-<tag>` — то, что оставляет
   красный `gate.mjs fast`; `stop.mjs` держит ход по ним.
   Lines: `src/main/harness/contract/cases.ts:120-130`

## 8. Что нашёл review и что осталось

> VERIFIED
>
> Round-2 findings:
> - **[med] runner.ts:187, a run with init but no turn always came out `failed`: fixed.** The `requests === 0` branch is now at `src/main/harness/contract/runner.ts:238-244`. It returns `failed` only when a hook blocked or started and never answered. Otherwise it returns `not-run` with the environment's reason.
>   - Scenario 1, real SDK binary, `ANTHROPIC_BASE_URL=http://127.0.0.1:9`:
>     - with retries at a 12 s limit, and at a 3 s limit: `not-run`, "did not finish … 0 turns";
>     - with `CLAUDE_CODE_MAX_RETRIES=0`: `not-run`, "the turn ended with an error of the API (ECONNREFUSED)".
>     - The raw stream has no `hook_started` without its answer. A SessionEnd hook does not show up as hung on the way out.
>   - Scenario 2, `judgeRun` with the time limit, init only and zero requests: `not-run`. Covered by `test/unit/harness-contract-judge.test.ts:45`.
>   - Mutant that puts back the round-2 code (no turn, so `failed`): 3 unit tests go red, at lines 40, 45 and 50. Mutant that drops `hung.length > 0`: the test at line 55 goes red.
> - **[low debt] runner.ts:127, at the limit only Claude Code was killed and hooks outlived the run: fixed.** `runner.ts:118-139` and `:153-164` read the process tree once and kill every descendant; on Windows they call `taskkill /T /F` through `killTool`.
>   - Probes: a hung UserPromptSubmit hook, a hung guard hook, and a hung Stop hook that started a detached `sleep 60` grandchild. In all three the hook and the grandchild were dead 0.5 s after the run.
>   - Mutant with no tree walk: the test at `test/contract/harness-guarantees.test.ts:103` goes red ("expected true to be false").
>   - Only descendants of the started pid are killed, so the kill does not reach too wide.
> - **[low debt] the Stop case can be red before its check runs:** unchanged, now listed under the ticket's known limits. Not a blocker.
> - **[low debt] a hung SessionStart or UserPromptSubmit hook gives `not-run`:** unchanged, also in the known limits. My probe confirms it: both hooks run before system/init, so the run comes out "printed no system/init".
>
> New findings (round 3, all non-blocking):
> - **[low] debt: `runner.ts:246`, a hook that hangs after a turn has reached the stand-in is still `not-run`.** The probe with a hung `guard.mjs` on the `guard-reset-hard` case gave `not-run`, "did not finish in 5000 ms; 1 turns". So a broken guard looks like an environment problem. The behaviour is old, but the rework now locks it in: the comment at `test/contract/harness-guarantees.test.ts:99-102` and the new test assert it. The `hungHooks` check could also run in this last branch.
> - **[low] debt: claim, `.scratch/worfy-harness-guarantees/issues/08-contract-set-без-модели.md:168,173`.** The ticket says the known limits stand "по решению review round 2" (by review round 2's decision). The round-2 verdict never named the third limit, a hook that hangs once turns have reached the stand-in.
> - **[low] debt: stale sentence, same file `:98`.** It still says a run at the limit is "остановлен по своему pid" (stopped by its own pid). The runner now kills the whole tree.
> - **[low] debt: `runner.ts:208-211` cannot fire on the real binary.** `hungHooks` with zero turns never triggers there: the only hooks before the first request (SessionStart, UserPromptSubmit) come before init. Only a synthetic unit test exercises it. Harmless.
>
> Commands, in my own worktree at e6c04462d with a temporary HOME:
> - `pnpm install --frozen-lockfile`: exit 0.
> - `node scripts/vitest-electron.mjs test/unit/harness-contract-judge.test.ts test/contract/harness-guarantees.test.ts`: exit 0, 30/30. An earlier call with a stray `run` filter ran 17 files, 576 tests: exit 0.
> - Two temporary probe test files (deleted afterwards): exit 0.
> - 3 mutants of `runner.ts`, each exit 1. Restored; `cmp` matched the copy and `git status` was clean.
> - `pnpm typecheck`: exit 0.
> - `story-check` against e6c04462d: exit 0.
> - `pgrep` afterwards found nothing left. The worktree is removed.
>
> Not checked:
> - Windows: the `taskkill /T` path and the hang test on the Windows binary; the CI Windows job decides that.
> - `pnpm lint` and the full `pnpm test`.
> - Health's real time limit, which ticket 09 sets.
>
> Nothing else found.
>
> Orchestrator: the four round-3 lows are not blockers; the ticket's stale sentence (line 98) and the «by review round 2's decision» wording go into the docs PR after the merge.
>
> Review depth: medium — worfy-harness-guarantees wave

Code: `src/main/harness/contract/runner.ts:238-244` · key lines: 238

```ts
  if (trace.requests === 0) {
    const hung = hungHooks(trace.lines)
    const none = `Claude Code started with the plugin but asked the stand-in no turn (exit code ${String(trace.exitCode)})`
    if (blocked.length > 0 || hung.length > 0)
      return { status: 'failed', reason: `${none}${holding}${hung.length === 0 ? '' : `; hooks of the plugin that never answered: ${[...new Set(hung)].join(', ')}`}; ${stderr}` }
    return { status: 'not-run', reason: `${ended === undefined ? none : `${none}; ${ended}`}; ${stderr}` }
  }
```

Code: `test/unit/harness-contract-judge.test.ts:45-45` · key lines: 45

```ts
  it('init, no turn and the time limit, no hook blocked or hung: not run (a slow machine)', () => {
```

Code: `test/contract/harness-guarantees.test.ts:103-103` · key lines: 103

```ts
  it('a hook that hangs at the time limit ends with the run: the runner stops the whole process group or tree', async () => {
```

Code: `test/contract/harness-guarantees.test.ts:99-102` · key lines: 99

```ts
  // Review round 2: at the limit the runner killed Claude Code alone, and a hook that hung outlived the run.
  // The Stop hook of this copy writes its pid and hangs, writing nothing, so no broken pipe ends it (its limit in
  // hooks.json is 900 s); it ends itself after 60 s at the very most. A hook that hangs while turns did reach the
  // stand-in is not counted as holding them: the run is "not run" at the limit (a known limit, written in the ticket's summary).
```
