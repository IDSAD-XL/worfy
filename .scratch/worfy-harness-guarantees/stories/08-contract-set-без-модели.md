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
