# Code story — worfy-polish 154: Гонка в contract test-е Autopilot background-stalled: ждать таймер, а не строку journal; снять Windows exception

Kind: pr · Epic: worfy-polish · Ticket: 154 · PR: - · Language: ru

## 1. Что было не так

Contract test «the silence of a background implementer after the turn stays background-stalled, not turn-hung» на
Windows падал с первой попытки в 10 из 26 job-ов полного набора: `timed out waiting for run 1 to stop`, journal
кончался двумя строками `background-tasks`. Test двигал часы test-а, как только в journal была строка
`background-tasks` и ни одна Session не была занята. Run же взводит таймер фоновых задач позже — в своей очереди,
когда его цикл дошёл до фазы `tasks`. Если таймер взведён после последнего сдвига часов, он не срабатывает никогда.
Test был пропущен на Windows записью `windows-exception`.

- Требование: [Что происходит](../issues/154-гонка-в-test-е-autopilot-background-stalled.md#что-происходит)

## 2. Test ждёт взведённый таймер, а не строку journal

Code: `test/contract/autopilot-faults-ladder.test.ts:368-383` · key lines: 368, 370, 378, 380, 383

```ts
  it('the silence of a background implementer after the turn stays background-stalled, not turn-hung', async () => {
    // test/fixtures/agent-scripts/autopilot-background.jsonl: the Wave's turn ends with two implementers alive, which then say nothing.
    const stallMs = 60 * 60_000
    const h = faultRun({ scripts: ['autopilot-background'], marks: 'claimed', quietHungMs: QUIET_HUNG_MS, prs: false, backgroundStallMs: stallMs })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.kinds(1).includes('background-tasks') && h.registry.list().every((each) => each.state !== 'busy'), 'the end of the Wave turn with live tasks')
    // The journal line and the idle Sessions come before the run arms its limit of the tasks: it does so in its own
    // queue, once its cycle has reached phase `tasks` after the turn's end (run.ts, tasksTimer). A move of the clock
    // before that is lost to the timer, which a slow Windows runner then armed after the last move, so the run never
    // stopped (worfy-polish ticket 154). Both moves wait for the timer itself.
    await until(() => h.clock.pending().some((timer) => timer.ms === stallMs), 'the limit of the background tasks')

    h.clock.advance(QUIET_HUNG_MS + 60_000)
    await pause()
    expect(h.state().status).toBe('running')
    h.clock.advance(stallMs)
```

- Что делает: после конца хода test ждёт, пока на `FaultClock` появится таймер с задержкой `backgroundStallMs`
  (`pending()` отдаёт `ms` каждого таймера), и только потом делает оба сдвига часов. Первый сдвиг
  (`QUIET_HUNG_MS + 60_000`) теперь проверяет «не `turn-hung`» при уже стоящем таймере фоновых задач, второй
  доводит часы до его срока. `it` вместо `quarantined(...)`: исключение для Windows снято.
- Почему здесь: Ticket называет этот test и `FaultClock.pending()` как условие ожидания (пункты 1 и 3 «Что строить»);
  правило проекта — flaky test лечат ожиданием условия, а не timeout-ом.
- Без него: при задержке между строкой journal и взведением таймера дольше `pause()` (200 ms) таймер ставится после
  второго сдвига, и test ждёт остановку run-а до предела 15 s.
- Требование: [Что строить, п. 1 и 3](../issues/154-гонка-в-test-е-autopilot-background-stalled.md#что-строить)
- Риски и пробелы test-ов: условие ищет таймер по задержке `stallMs`; другой таймер с той же задержкой на часах test-а
  дал бы ложное «взведён». Сейчас такого нет: `prs: false`, а предел тихого хода — `QUIET_HUNG_MS`, 30 min.

## 3. Что сознательно не меняли

`src/main/autopilot/run.ts` не менялся: run таймер взводит всегда, только позже строки journal — когда
`feed` после конца хода переводит цикл в фазу `tasks`. Это не баг run-а, а слишком раннее условие test-а (пункт 2
«Что строить»). Предел `until` (5000 ms), timeout-ы и множитель не менялись. Другие ожидания в этом файле перед
сдвигом часов уже ждут условие на часах (`pending()` для предела тихого хода) или метку тишины Session, которую
Session ставит опросом часов (`lookMs: 20`), а не таймером на них, — им та же гонка не грозит.

## 4. Как проверено

Временная правка (не в commit-е): задержка 1000 ms в `workflow` из `autopilot-faults-setup.ts`, через которую run
читает тикеты после конца хода. С ней прежний test красный — `timed out waiting for run 1 to stop (15009 ms)`,
journal кончается двумя `background-tasks`, как на CI; новый зелёный и с задержкой 3000 ms. Без задержки на Mac
в 6 из 6 запусков таймер в момент прежнего условия ещё не взведён, он появляется через 30–46 ms. Под нагрузкой
(18 процессов `yes` на 18 ядрах) — 8 запусков файла с `--sequence.shuffle`, exit 0. Все contract test-ы Autopilot
и `test/unit/quarantine.test.ts` — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0.

## Проверить себя

1. Почему строки `background-tasks` в journal мало, чтобы двигать часы?
   - Ответ: строка и простой Session видны test-у раньше, чем очередь run-а обработала конец хода; таймер фоновых
     задач взводится только в фазе `tasks`, то есть позже.
   - Строки: `test/contract/autopilot-faults-ladder.test.ts:374-378`
2. Почему ждать таймер нужно уже перед первым сдвигом, а не только перед вторым?
   - Ответ: первый сдвиг проверяет, что тихая фоновая работа не стала `turn-hung`; смысл у этой проверки есть, только
     когда run уже ждёт фоновые задачи, а таймер, взведённый после первого сдвига, ещё и сдвигает свой срок.
   - Строки: `test/contract/autopilot-faults-ladder.test.ts:378-383`

## 5. Что нашёл review и что осталось

> VERIFIED — worfy-polish 154 (the race in the contract test «the silence of a background implementer after the turn stays background-stalled, not turn-hung»: it moved the test clock once the journal line and idle Sessions were there, before the run armed its background-tasks timer in its own queue; now it waits for the timer itself on the test clock before both moves; the Windows exception removed), head b8fce1630415e1103d2080d2f60860217ed6de1f
>
> Gate (depth medium, one round): orchestrator read of the code diff — one test file (+9/−4) and the deleted quarantine record; the wait `h.clock.pending().some((timer) => timer.ms === stallMs)` uses the existing until() (5000 ms, not raised); run.ts untouched (the run always arms the timer, later than the journal line). Implementer proof: with a 1000 ms delay in the workflow read the old test fails exactly as on CI («timed out waiting for run 1 to stop (15009 ms)»), the new one passes even at 3000 ms; on Mac the timer appeared 30–46 ms after the old condition in 6 of 6 probes; 22 autopilot contract files + quarantine unit 478 tests EXIT=0; full pnpm test EXIT=0; lint, typecheck EXIT=0; gate fast green (first run red only on test/contract/codex-session.test.ts:858, a wall-clock measure 941 < 950 in an untouched file — candidate flaky test); story-check EXIT=0. CI run 46019926768 green on the head: the test ran on windows (1/3) full-suite, green at the first attempt in 2159 ms, no FLAKY line.
> Consider: none
> Noted: similar pattern not checked at test/contract/autopilot-faults-github.test.ts:223,229 (clock moved after wave-started without waiting for the next read's timer); test/contract/codex-session.test.ts:858 wall-clock measure; test/contract/codex-account.test.ts:139 FLAKY on windows 3/3 of this run.
> Dismissed: none
> Review depth: medium — owner rule (test-only diff under ~20 lines, read by the orchestrator)
> Review tokens: not measured

Code: `test/contract/codex-session.test.ts:858-858` · key lines: 858

```ts
  it('output that never closes ends the events OUTPUT_AFTER_EXIT_MS after the exit', async () => {
```

Code: `test/contract/autopilot-faults-github.test.ts:223-223` · key lines: 223

```ts
    h.clock.advance(BASE_MS)
```

Code: `test/contract/codex-account.test.ts:139-139` · key lines: 139

```ts
  it('account-plus: the poll reads the account, then two windows, 5h and weekly, skipping the reset-credit details', async () => {
```
