# Code story — worfy-harness-guarantees 08: Contract set без модели

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 08 · PR: - · Language: ru

## 1. Что было не так

На настоящем binary Claude Code проверялся только hook SessionStart, а полный eval Harness-а идёт лишь при смене SDK,
модели или Stable copy. PR, который поднимает SDK, не краснел, если hooks Harness-а на новом binary перестали
работать. PR строит набор из шести case-ов на binary SDK и stand-in-е Messages API, без модели, и запускает его в
`pnpm test`.

- Требование: [Что происходит](../issues/08-contract-set-без-модели.md#что-происходит)

## 2. Stand-in ведёт цепочку вызовов на разговор

Code: `src/main/harness/contract/messages-api-stand-in.ts:216-223` · key lines: 216, 218, 219
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

Code: `src/main/harness/contract/runner.ts:162-174` · key lines: 162, 165, 167, 171, 174
```ts
    if (spawned.error !== undefined) return notRun(`could not start ${options.binary}: ${spawned.error.code ?? spawned.error.message}`)
    const lines = parseLines(spawned.out)
    const requests = standIn.requests()
    if (spawned.timedOut) return notRun(`Claude Code did not finish in ${options.runLimitMs} ms and was stopped; ${requests.length} turns asked the stand-in; stderr: ${tail(spawned.err)}`)
    const init = lines.find((line) => line.type === 'system' && line.subtype === 'init')
    if (init === undefined) return notRun(`Claude Code printed no system/init (exit code ${String(spawned.code)}); stderr: ${tail(spawned.err)}`)
    if (requests.length === 0) return notRun(`Claude Code never asked the stand-in of the Messages API (exit code ${String(spawned.code)}); stderr: ${tail(spawned.err)}`)
    const result = lines.find((line) => line.type === 'result')
    if (result === undefined) return notRun(`Claude Code printed no result (exit code ${String(spawned.code)}); stderr: ${tail(spawned.err)}`)
    if (result.is_error === true) return notRun(`the turn ended with an error of the API or of Claude Code: ${tail(JSON.stringify(result), 400)}`)
    const run: CaseRun = { ...context, lines, init, requests, toolResult: (callId) => standIn?.toolResult(callId), exitCode: spawned.code, stderr: spawned.err }
    const why = contractCase.check(run)
    return why === null ? { id, title, status: 'passed' } : { id, title, status: 'failed', reason: why }
```

- Что делает: прогон без старта binary, без `system/init`, без запроса к stand-in-у, без `result`, с ошибкой API или
  дольше предела — `not-run` с причиной и хвостом stderr; только состоявшийся прогон идёт в `check` case-а, и его
  отказ — `failed`.
- Почему здесь: Ticket требует, чтобы Health (Ticket 09) писал «не смог запустить» и «guard не отказал» разными
  строками; spec называет риск «Stand-in отстаёт от API».
- Без него: binary, который не стартовал, выглядел бы как сломанный Harness, и наоборот.
- Требование: [Готово, когда, п. 2](../issues/08-contract-set-без-модели.md#готово-когда)
- Риски и пробелы test-ов: test-ом проверены две ветки — несуществующий binary (`not-run`) и сломанный `hooks.json`
  (`failed`); ветки «нет init», «ошибка API» и предел времени test-а не имеют.

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

Code: `test/contract/harness-guarantees.test.ts:45-52` · key lines: 47, 48, 50, 51
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

## Проверить себя

1. Почему зависший прогон Claude Code не превращается в timeout test-а?
   Ответ: У runner-а свой предел `runLimitMs` ниже предела test-а; по нему процесс останавливается по своему pid, и
   case приходит как `not-run` с причиной и stderr.
   Lines: `src/main/harness/contract/runner.ts:162-174`
2. Чем case 5 заменяет настоящий прогон gate?
   Ответ: Resolver-stub называет репозиторий зарегистрированным, а маркер `red-<key>-<tag>` — то, что оставляет
   красный `gate.mjs fast`; `stop.mjs` держит ход по ним.
   Lines: `src/main/harness/contract/cases.ts:120-130`
