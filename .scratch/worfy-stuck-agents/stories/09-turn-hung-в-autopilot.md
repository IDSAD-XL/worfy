# Code story — worfy-stuck-agents 09: `turn-hung` в Autopilot: замолчавший ход останавливает Run, ничего не прерывая

Kind: pr · Epic: worfy-stuck-agents · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

У фазы `turn` цикла Autopilot не было таймера: из неё выводили только конец хода, ошибка, закрытие Session и Stop.
Ход Orchestrator-а, который завис и молчит, держал Run в фазе `turn` сколько угодно — ночь терялась. После Ticket-а 03
Session уже знает `quietSince` — с какого момента её ход без признаков жизни, — и шлёт событие `quiet`. Этот PR даёт
Run-у порог `QUIET_HUNG_MS` (30 минут): ход, который молчит дольше, останавливает Run с причиной `turn-hung`. По ответу
владельца на вопрос 3 spec-а (вариант (а)) ничего не прерывается: Session уходит человеку как после любой другой
остановки (ADR-0050, «After any other stop»).

- Требование: [Что происходит](../issues/09-turn-hung-в-autopilot.md#что-происходит)

## 2. Цикл: `turn-quiet` останавливает только в фазе `turn`

Code: `src/shared/autopilot/cycle.ts:444-446` · key lines: 446

```ts
    case 'turn-quiet':
      // Only the Orchestrator's own turn: the silence of its background tasks is `background-stalled` (phase `tasks`).
      return state.phase === 'turn' ? stop(state, 'turn-hung') : stay(state)
```

- Что делает: новое событие цикла `turn-quiet` даёт `stop(state, 'turn-hung')` в фазе `turn`; в `settling`, `tasks`,
  `starting`, `sending` и после остановки — ничего. Причина `turn-hung` добавлена в `AUTOPILOT_STOP_REASONS`, константа
  `QUIET_HUNG_MS` = 30 минут стоит рядом с `SETTLE_MS`, а в `STOP_OUTCOMES` (`from-journal.ts`) `turn-hung` — `failed`.
- Почему здесь: Ticket, «Что делаем», пункт 1, называет и событие, и фазу, и место константы; почему 30 минут — пункт 7
  «Решено без владельца» spec-а.
- Без него: Run не мог бы выйти из фазы `turn` по тишине; молчание в фазе `tasks` осталось бы `background-stalled`, как
  требует пункт 3.
- Требование: [Что делаем, пункт 1](../issues/09-turn-hung-в-autopilot.md#что-делаем)
- Риски и пробелы test-ов: `turn-quiet` при уже начатом graceful Stop тоже даёт `turn-hung`, а не `user-stop`; это
  решение не записано и отдельным test-ом не проверено.

## 3. Run слушает `quiet` своей Session

Code: `src/main/autopilot/run.ts:1967-1970` · key lines: 1969

```ts
      case 'quiet':
        // The Session marked its turn quiet, or a sign of life ended the quiet: the limit of a hung turn follows it.
        this.hungTimer(run)
        return
```

- Что делает: каждое событие `quiet` Session Orchestrator-а (пометка тишины или её конец) пересчитывает таймер
  зависшего хода. Сам `quietSince` Run читает из `controls()` Session — для этого в `RunSession` добавлен
  необязательный `controls?()`; `session.ts` не менялся.
- Почему здесь: Ticket, «Что делаем», пункт 2: Run следит за `quietSince` Session Orchestrator-а. Бриф запретил новый
  getter в `session.ts`; `controls()` с `quietSince` там уже есть после Ticket-а 03.
- Без него: таймер ставился бы только на шаге цикла, а пометка тишины приходит между шагами.
- Требование: [Что делаем, пункт 2](../issues/09-turn-hung-в-autopilot.md#что-делаем)
- Риски и пробелы test-ов: события фильтруются по id Session Run-а, а `quietSince` читается у текущей `run.session`;
  смена Session между Wave-ами проверена только тем, что новая Session начинает без тишины.

## 4. Таймер зависшего хода

Code: `src/main/autopilot/run.ts:3010-3028` · key lines: 3014, 3016, 3017, 3022

```ts
  private hungTimer(run: Run): void {
    const clock = this.deps.tasksClock ?? realClock
    if (run.hungTimer !== null) clock.clearTimeout(run.hungTimer)
    run.hungTimer = null
    const since = run.cycle.phase === 'turn' ? this.quietSince(run) : null
    if (since === null) return
    const hung = (): Promise<void> => (run.cycle.phase === 'turn' && this.quietSince(run) === since ? this.feed(run, { type: 'turn-quiet' }) : Promise.resolve())
    const left = since + (this.deps.quietHungMs ?? QUIET_HUNG_MS) - this.now()
    if (left <= 0) {
      void run.enqueue(hung)
      return
    }
    const timer = clock.setTimeout(() => {
      if (run.hungTimer !== timer) return
      run.hungTimer = null
      void run.enqueue(hung)
    }, left)
    run.hungTimer = timer
  }
```

- Что делает: в фазе `turn`, пока Session говорит, что ход молчит, ставит таймер на `quietSince + quietHungMs`. Отсчёт
  от начала тишины, а не от пометки (пометка приходит через 10 минут). Когда таймер срабатывает, в очереди Run-а ещё раз
  проверяет фазу и тот же `quietSince` — сигнал жизни между ними отменяет остановку. На каждом шаге цикла (`feed`) и в
  `stopTimers` таймер пересчитывается или снимается.
- Почему здесь: Ticket, «Что делаем», пункт 2: dep `quietHungMs`, как `settleMs` и `backgroundStallMs`; таймер идёт на
  `tasksClock`, чтобы test двигал часы сам.
- Без него: событие `turn-quiet` никто бы не послал.
- Требование: [Что делаем, пункты 2 и 3](../issues/09-turn-hung-в-autopilot.md#что-делаем)
- Риски и пробелы test-ов: `quietSince` Session считается по её часам (`Date.now`), остаток — по `this.now()` Run-а
  (`limits.now`, иначе `Date.now`); в приложении это одни часы, но если подменить только одни, отсчёт разойдётся.
  Остановка сама идёт обычным путём `end()`: при живом ходе это `giveBackAsItRuns`, без Interrupt.

## 5. Fault scenarios на часах test-а

Code: `test/contract/autopilot-faults-setup.ts:441-450` · key lines: 441, 449

```ts
  const quiet = options.quietHungMs === undefined ? {} : { markMs: QUIET_MARK_MS, lookMs: 20, now: () => clock.now, outside: () => Promise.resolve(NO_OUTSIDE_SIGNS) }
  const registry = new SessionRegistry(
    {
      sessionsOf: (each) => (each === 'codex' ? codex : claude),
      partsOf: (each) => (each === 'codex' ? { capabilities: codexCapabilities, commands: codexCommands } : STATIC_CLAUDE_PARTS),
    },
    undefined,
    undefined,
    quiet,
  )
```

- Что делает: новая опция `faultRun` `quietHungMs` ставит слежение Session за тишиной на часы test-а (пометка через
  `QUIET_MARK_MS`, взгляд каждые 20 мс реального времени, без признаков жизни вне событий агента) и передаёт Run-у
  порог. Без опции всё как раньше: остальные сценарии двигают часы на часы вперёд и не должны получать `turn-hung`.
- Почему здесь: Ticket, «Тесты» и «Готово, когда»: Fault scenario 7 на fake agent и на fake Codex; правило владельца —
  пороги через deps, без поднятия timeout-ов test-ов.
- Без него: 30 минут тишины пришлось бы ждать по-настоящему.
- Требование: [Готово, когда](../issues/09-turn-hung-в-autopilot.md#готово-когда)
- Риски и пробелы test-ов: признаки жизни вне событий (файлы task-ов, gate, e2e lock) в сценариях заглушены — их правило
  проверено unit и contract test-ами Ticket-а 03, не здесь. Отрицательный сценарий — hook; открытый запрос разрешения в
  unattended Session отдельным сценарием не проверен (без Auto-approval такой запрос сразу отказывается).

## 6. Что сознательно не меняли

- `src/main/agent/session.ts`, `src/shared/agent/quiet.ts` — только читались; новый getter не нужен.
- ADR-0050 — без поправки: ответ владельца (а) и есть его правило «After any other stop».
- `docs/features/ru/` и тексты Guide (`src/renderer/guide/topics/autopilot/*.json`) — вне следа Ticket-а.
- Автоматический Interrupt замолчавшего хода — вне скоупа (вариант (б) вопроса 3).

## 7. Как проверено

- `node scripts/vitest-electron.mjs test/unit/autopilot-cycle.test.ts test/unit/flight-recorder-journal.test.ts test/unit/flight-recorder-reason-words.test.tsx`
  — новые test-ы красные до кода, зелёные после.
- `node scripts/vitest-electron.mjs test/contract/autopilot-faults-ladder.test.ts` — exit 0; без изменения `run.ts`
  сценарий 7 и сценарий с hook-ом красные (`timed out waiting for the limit of a hung turn`).
- `node scripts/vitest-electron.mjs test/contract/autopilot-faults-codex.test.ts test/contract/codex-fake.test.ts` —
  exit 0; без изменения `run.ts` сценарий 7 на Codex красный.
- `pnpm lint && pnpm typecheck && pnpm test` в окружении Session Autopilot (`TMPDIR` с пробелом,
  `GIT_CONFIG_PARAMETERS` с `safe.bareRepository=explicit`) — много красных test-ов вне этого PR. С `TMPDIR` без
  пробела и без `GIT_CONFIG_PARAMETERS` — exit 1 на одном test-е `gate-failures-rerun.test.ts` (SIGTERM при повторе
  e2e, ожидание по времени под нагрузкой); тот же файл отдельно — exit 0.
- gate fast в том же чистом окружении — exit 0, `[gate] green (fast)` (lint, typecheck, весь `pnpm test`).

## Проверить себя

1. Почему ход, в котором hook идёт 40 минут, не даёт `turn-hung`, хотя Run сам hook-и не считает?
   - Строки: `src/main/autopilot/run.ts:3014-3015`
   - Ответ: Run берёт `quietSince` у Session, а Session при открытом hook-е тишины не видит (`quietFor` даёт 0) — значит
     `quietSince` null и таймер не ставится.
2. От какого момента считаются 30 минут — от пометки тишины или от последнего признака жизни?
   - Строки: `src/main/autopilot/run.ts:3017-3017`
   - Ответ: от `quietSince`, то есть от последнего признака жизни; пометка через 10 минут лишь сообщает Run-у о тишине.
3. Почему молчание background implementer-а после хода не превращается в `turn-hung`?
   - Строки: `src/shared/autopilot/cycle.ts:446-446`
   - Ответ: после конца хода цикл в фазе `tasks`, а `turn-quiet` действует только в `turn`; к тому же Session без хода
     не `busy`, и её `quietSince` null. Там остаётся `background-stalled`.

## 8. Что нашёл review и что осталось

> VERIFIED
> Consider: [low] src/shared/autopilot/cycle.ts:444-446 — a turn-quiet during a graceful Stop ends the run as turn-hung, while main-red (cycle.ts:450) ends as user-stop then; undocumented, no test. Follow-up: one sentence in docs/features/autopilot-faults.md and a cycle unit test, or map to user-stop when stopping.
> Noted: [low] acceptance item 5 — evidence covers the running hook only; the open permission request half rests on quietFor (src/shared/agent/quiet.ts:41) tested in ticket 03, and the story says so.
> Review depth: low — default: the profile has no review.depth.wave
> Review tokens: 72896
> Could not verify:

Code: `src/shared/autopilot/cycle.ts:444-446` · key lines: 444

```ts
    case 'turn-quiet':
      // Only the Orchestrator's own turn: the silence of its background tasks is `background-stalled` (phase `tasks`).
      return state.phase === 'turn' ? stop(state, 'turn-hung') : stay(state)
```

Code: `src/shared/agent/quiet.ts:41-41` · key lines: 41

```ts
 */
```
