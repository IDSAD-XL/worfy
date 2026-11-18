# Code story — worfy-continuity 08: Update во время работы: "Restart now" рядом с "Restart when idle", Run в Wait не держит Update

Kind: pr · Epic: worfy-continuity · Ticket: 08 · PR: - · Language: ru

## 1. Что было не так

"Restart now" предлагался, только пока ничего не работает: во время turn-а `plan()` отвечал отказом `BUSY`, и
toast, меню chip-а версии, Settings и Command palette показывали одну "Restart when idle". Run Autopilot-а в Wait
(Limits, budget, Start window) тоже считался работой: ночной Run держал Update до своего конца. Так решил владелец в
worfy-update (решение 7), пока работа после перезапуска терялась; Ticket-ы 04–06 научили worfy приостанавливать и
продолжать её, и Q1 этого Epic-а — вариант (а): решение 7 меняется.

- Требование: [Что происходит](../issues/08-update-во-время-работы.md#что-происходит), [spec](../spec.md#update-во-время-работы-ticket-08)

## 2. "Restart now" не смотрит на работу

Code: `src/main/update/restart.ts:491-498` · key lines: 496, 497

```ts
  /**
   * What `action` would do now, or the refusal. `look`: whether something at work refuses it — as last
   * seen, or `fresh`: the Sessions and Autopilot looked at now (Autopilot is looked at only every 2 s);
   * `none` for "Restart now", which the quit's grace lets the work end for.
   */
  private plan(action: 'install' | 'rollback', look: IdleLook): Plan | RestartAnswer {
    if (look !== 'none' && !(look === 'fresh' ? this.options.idle.recheck() : this.options.idle.idle)) return BUSY
    const { dir } = this.options
```

- Что делает: `plan()` получает, как смотреть на работу: `last` (как видели в последний раз), `fresh` (заново) или `none`. "Restart now" идёт с `none` и отказа `BUSY` больше не получает; "Restart when idle" и Roll back по-прежнему смотрят и отказываются, пока что-то работает.
- Почему здесь: Ticket называет `src/main/update/restart.ts` и отказ `BUSY` (`plan()`); нажатие — согласие на grace и приостановку через координатор Ticket-а 04 (Что делаем, пункт 1). Почему Roll back не изменён — не записано: Ticket говорит только о "Restart now".
- Без него: "Restart now" во время turn-а снова отвечает «a Session is working or Autopilot runs», и кнопка рядом с "Restart when idle" ничего не делает.
- Требование: [Что делаем, пункт 1](../issues/08-update-во-время-работы.md#что-делаем)
- Риски и пробелы test-ов: выход через настоящий `QuitGrace` и `quitForUpdate` с причиной `update` проверен contract test-ом на подставных шагах; провязку `appUpdate()` (её `quit` идёт через координатор с причиной `update`, а не через голый `app.quit()`) проверяет `test/contract/update-wiring.test.ts`; отказавший "Restart now" всё равно снимает желание "Restart when idle" — contract test `"Restart now" that is refused still drops the wish…`; grace с настоящими Session-ами — test-ы Ticket-а 04.

## 3. Нажатие "Restart now" поверх ожидания "Restart when idle"

Code: `src/main/update/restart.ts:333-347` · key lines: 337, 341, 343

```ts
  /** An install; `untilIdle`: only while nothing works (the wish of "Restart when idle"). */
  private now(untilIdle: boolean): Promise<RestartAnswer> {
    if (this.quittingNow) return Promise.resolve(QUITTING)
    if (this.inFlight?.kind === 'install') {
      if (!untilIdle) this.inFlight.untilIdle = false
      return this.inFlight.answer
    }
    if (this.inFlight !== null) return Promise.resolve({ outcome: 'refused', reason: 'a roll back is under way' })
    const flight: Flight = { kind: 'install', answer: Promise.resolve(QUITTING), untilIdle }
    this.inFlight = flight
    flight.answer = this.installNow(flight).finally(() => {
      if (this.inFlight === flight) this.inFlight = null
    })
    return flight.answer
  }
```

- Что делает: у каждой установки свой `Flight` с флагом `untilIdle`. Желание "Restart when idle" ставит `true`, "Restart now" — `false`; нажатие "Restart now", пока установка желания уже спрашивает GitHub, снимает флаг у неё же, и последний взгляд перед helper-ом работу уже не проверяет.
- Почему здесь: не записано; так в diff-е одна установка за раз, как было до Ticket-а (`inFlight`).
- Без него: "Restart now", нажатый во время сравнения, получил бы ответ установки желания — отказ `BUSY`, если за это время начался turn.
- Требование: [Что делаем, пункт 1](../issues/08-update-во-время-работы.md#что-делаем)
- Риски и пробелы test-ов: случай «желание спрашивает, нажат Restart now, начался turn» — contract test `pressed while "Restart when idle" asks for its restart…`.

## 4. Run в Wait не работа

Code: `src/main/update/idle.ts:36-46` · key lines: 37, 40, 45

```ts
/** The Waits that do not hold a restart (worfy-continuity ticket 08): the Limits, the budget's two, the Start window. */
const QUIET_WAITS: ReadonlySet<IdleRun['waitingFor']> = new Set(['limits', 'daily-share', 'five-hour', 'start-window'])

/** The run sits in a Wait the restart may cut: it is suspended with it and goes on with it after the start. */
const inQuietWait = (run: IdleRun): boolean => run.status === 'waiting' && !run.stopping && QUIET_WAITS.has(run.waitingFor)

/** Nothing works: spec R6. */
export function idle({ sessions, autopilot }: IdleSources): boolean {
  if (sessions().some((session) => inTurn(session.state) || session.backgroundTasks > 0)) return false
  return autopilot().every(inQuietWait)
}
```

- Что делает: `idle()` берёт список Run-ов Autopilot-а и считает, что ничего не работает, когда каждый из них ждёт Limits, budget (`daily-share`, `five-hour`) или Start window и не останавливается. Run с Wave в работе, Wait retry после ошибки API и ожидание Orchestrator-а — работа.
- Почему здесь: Ticket называет `src/main/update/idle.ts:30–32` и Wait-ы Limits, Start window, budget (Что делаем, пункт 2). Почему retry и ожидание Orchestrator-а держат перезапуск — не записано: Ticket их не называет, они оставлены работой.
- Без него: ночной Run в Wait Limits держит "Restart when idle" до утра.
- Требование: [Что делаем, пункт 2](../issues/08-update-во-время-работы.md#что-делаем), [spec](../spec.md#update-во-время-работы-ticket-08)
- Риски и пробелы test-ов: unit test-ы `idle()` на каждый Wait; contract test на настоящем Run-е в Wait Limits (`faultRun`) — перезапуск начинается, после старта тот же Wait.

## 5. Откуда idle берёт Run-ы

Code: `src/main/update/idle.ts:58-66` · key lines: 60, 61, 65

```ts
/** The runs of `projectIds` that go on, as the rule reads them; none when Autopilot has stopped. */
export function autopilotRuns(autopilot: IdleAutopilot, projectIds: readonly string[]): IdleRun[] {
  if (!autopilot.anyRunning()) return []
  const runs: IdleRun[] = projectIds.filter((projectId) => autopilot.running(projectId)).map((projectId) => autopilot.state(projectId))
  // shortcut: while a Project's run goes on, a stopped run that still waits for its Orchestrator's tasks is seen
  // only through those tasks of its Session (IdleSession.backgroundTasks), not by itself; redo when Autopilot names
  // such runs.
  return runs.length > 0 ? runs : [AT_WORK]
}
```

- Что делает: из `Autopilot` читает состояние каждого Project-а, чей Run идёт. Если Autopilot что-то держит (`anyRunning`), а ни один Project не идёт — это старт или остановленный Run, который ждёт задачи Orchestrator-а, и это работа.
- Почему здесь: не записано; бриф запрещает править `src/main/autopilot/run.ts` (его меняет Ticket 07), поэтому список собран из публичных `running()` и `state()`.
- Без него: `idle()` нечем отличить Run в Wait от Run-а с Wave — у Autopilot есть только `anyRunning()`.
- Требование: [Что делаем, пункт 2](../issues/08-update-во-время-работы.md#что-делаем)
- Риски и пробелы test-ов: `shortcut:` — остановленный Run, ждущий задачи, рядом с другим Run-ом виден только через фоновые задачи своей Session; подключение в `src/main/ipc/update.ts` (`appIdleWatch`) проверяет `test/contract/update-wiring.test.ts` на подставных Autopilot-е и Project-ах: до загрузки модулей Autopilot считается работающим, Run одного Project-а в Wait Limits не держит, Run с Wave в работе держит.

## 6. Причина в restart.json

Code: `src/main/update/restart.ts:55-66` · key lines: 64

```ts
  from: z.object({ sha: z.string(), version: z.string(), number: z.number().int().positive().optional() }),
  harness: z.literal(true),
  harnessTaken: z.literal(true).optional(),
  /**
   * Why worfy quits (worfy-continuity ticket 08): `update`, the cause the quit's coordinator also writes into the
   * Runs' `run-suspended`. The start after takes a Run's cause from that line (src/shared/autopilot/checkpoint.ts)
   * and a Session's from `at` (src/main/agent/continuity.ts); the record says it too, for whatever reads it after a
   * quit that wrote no line. Records written before the ticket have none.
   */
  cause: z.literal('update').optional(),
  at: z.iso.datetime(),
})
```

- Что делает: запись перезапуска несёт `cause: 'update'`; `launch()` пишет её при каждом перезапуске в Update и при Roll back.
- Почему здесь: Ticket, пункт 3, — «причина перезапуска — в `restart.json`». `run-continued` и `notice` уже говорят `update` через `run-suspended` (Ticket 04) и `at` этой записи (Ticket 05); бриф велел не трогать `run.ts`, `continuity.ts` и `index.ts`.
- Без него: запись перезапуска сама не говорит, почему worfy вышел.
- Требование: [Что делаем, пункт 3](../issues/08-update-во-время-работы.md#что-делаем)
- Риски и пробелы test-ов: поле при старте пока никто не читает; contract test проверяет цепочку целиком: `restart.json` с `update`, `run-suspended` с `update`, после старта `run-continued` после `update`.

## 7. Обе кнопки в toast-е

Code: `src/renderer/update/toasts.ts:151-156` · key lines: 153, 154

```ts
  function showReady(version: string, idle: boolean): void {
    readyButton = idle ? 'now' : 'idle'
    const button = (when: 'now' | 'idle') => ({ label: RESTART_LABEL[when], run: () => restart(when) })
    const actions = idle ? ([button('now'), later] as const) : ([button('idle'), button('now'), later] as const)
    showToast({ kind: 'action', key: READY_KEY, testId: READY_KEY, text: `worfy ${version} ready`, actions })
  }
```

- Что делает: toast «worfy <version> ready» показывает "Restart now" и "Later", пока ничего не работает, а во время работы — "Restart when idle", "Restart now" и "Later"; кнопки меняются на месте, когда меняется `idle`. Меню chip-а, строка Settings и Command palette («Restart now» рядом с «Update worfy») делают то же.
- Почему здесь: Ticket называет `src/renderer/update/toasts.ts` и `store.ts` и все четыре места (Что делаем, пункт 1); `UpdateChip.tsx`, `UpdatesBlock.tsx` и `palette/commands.ts` вне списка Ticket-а, их одобрил Orchestrator.
- Без него: во время работы "Restart now" не найти нигде, кроме Settings после конца работы.
- Требование: [Что делаем, пункт 1](../issues/08-update-во-время-работы.md#что-делаем)
- Риски и пробелы test-ов: unit test-ы каждого места; e2e (toast, меню chip-а, Settings, Command palette) подают снимок с `idle: false` так, как его послал бы main, и локально не запускались — их проверяет только CI.

## 8. Что сознательно не меняли

- Roll back по-прежнему отказывает, пока что-то работает: Ticket говорит только о "Restart now".
- `src/main/autopilot/run.ts`, `src/main/agent/continuity.ts`, `src/main/index.ts`, `src/main/quit-grace.ts` — только чтение (бриф; `run.ts` и `quit-grace.ts` меняет Ticket 07).
- Русский перевод `docs/features/ru/updates.md` — Ticket 14.

## 9. Как проверено

- `node scripts/vitest-electron.mjs test/unit/update-idle.test.ts test/contract/update-restart.test.ts` — сначала красные (14 и 5 test-ов), после правки exit 0.
- Новый `test/contract/update-restart-continuity.test.ts` — exit 0; с пустым набором тихих Wait-ов (мутант) красный.
- UI unit test-ы (toast, chip, Settings, Command palette) — сначала 9 красных, после правки exit 0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (840 файлов).
- Второй раунд: `test/contract/update-wiring.test.ts` и новые expect-ы в `update-restart.test.ts`, `updates-block.test.tsx` — каждый красный на своём мутанте (голый `app.quit()` в провязке, `NOT_LOADED` → `[]` или тихий Wait, пустой список Project-ов, убранный `this.intent.cancel()`, обратный порядок кнопок, тот же testId у обеих кнопок), exit 0 без мутантов.
- e2e `update-toasts`, `update-toolbar`, `update-settings` локально не запускались (правило владельца 2026-11-11); их проверяет CI.

## Проверить себя

1. Почему "Restart now" во время turn-а больше не отказывает, а Roll back отказывает?
   - Строки: `src/main/update/restart.ts:496`, `src/main/update/restart.ts:497`
   - Ответ: "Restart now" строит план с `none` — нажатие считается согласием на grace и приостановку; Roll back строит план с `last` и `fresh` и получает `BUSY`, пока что-то работает.
2. Что будет, если "Restart now" нажать, пока "Restart when idle" уже спрашивает GitHub и тут начинается turn?
   - Строки: `src/main/update/restart.ts:337`
   - Ответ: нажатие снимает `untilIdle` у установки, которая уже идёт, и она запускает helper, не глядя на начавшийся turn; обе кнопки получают `quitting`.
3. Почему Run в Wait retry держит "Restart when idle", а Run в Wait Limits — нет?
   - Строки: `src/main/update/idle.ts:37`
   - Ответ: тихие Wait-ы — только Limits, budget и Start window, их называет Ticket; retry в этот набор не входит, и Run в нём считается работой.
