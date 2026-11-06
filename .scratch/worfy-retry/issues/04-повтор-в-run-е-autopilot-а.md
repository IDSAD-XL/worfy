# 04 — Повтор хода в Run-е Autopilot-а: `TurnRetry`, Journal и строка на Canvas

Type: task
Status: done 2026-11-06T02:26Z
PR: #1468
Blocked by: 02, 03
Source: [spec.md](../spec.md), «Что видит владелец», п. 3–4; «Как работает» → «Повтор после ошибки API (A)», «Где живёт»; «Совместимость с worfy-faults»; «Сценарии» (строки Ticket-а 04); [worfy-polish 50](../../worfy-polish/issues/50-autopilot-не-стартует-после-остановки-run-а.md), «Что происходит»

## Что происходит

- Случай `result` в `Autopilot.onEvent` (`src/main/autopilot/run.ts:1092-1129`) сначала спрашивает `hitOf` (отказ
  Limits → `limitsHit`, `:1670`), иначе отдаёт `turn-ended` в цикл; ход с `isError` → `turn-error`
  (`src/shared/autopilot/cycle.ts:288`).
- Ожидание и продолжение уже есть для Limits: `LimitsWait` с `wallTimer` (`src/main/autopilot/limits-wait.ts:78`),
  `resume` (`run.ts:1689`) с graceful Stop в одном сообщении; состояние `waiting` в `snapshot` (`run.ts:2068`).
- Journal — `JOURNAL_EVENT_KINDS` (`src/shared/autopilot/journal.ts:280`); строка Canvas — `autopilotStatusLine`
  (`src/shared/ipc/autopilot.ts:215`), `waitingFor` (`:53`).

## Что делаем

1. **`src/main/autopilot/turn-retry.ts`** — класс `TurnRetry` по образцу `LimitsWait`: счётчик попыток, таймер по часам
   стены, `isCurrent(id)`, `passed()` (удачный ход — сброс), `cancel()`. Зависимости — `now`, `schedule`, `send`,
   `enabled()` (настройка Project-а из Ticket-а 02).
2. **`run.ts`:** в случае `result` после `hitOf` — если переключатель включён и `turnFailureKind` даёт `transient`,
   то `retryDecision` (Ticket 03) по событиям хода: `retry` → Journal `turn-retry`, таймер, `publish`; `refused` →
   Journal `retry-refused`, дальше `turn-ended` как сегодня. Выключен — ничего нового, `turn-ended` идёт в цикл.
3. По таймеру — `retryText` в Session, Journal `resumed`; Stop во время ожидания уходит с продолжением одним
   сообщением, как у Limits. Stop до таймера в состоянии без хода — `user-stop` сразу; Force stop, закрытие Session,
   выход — таймер отменён. Ход, начатый во время ожидания (фоновая задача, человек), держит таймер; удачный — снимает
   ожидание. Переключатель выключили во время ожидания — ожидание снято, `turn-ended` с ошибкой идёт в цикл.
4. **Journal:** `turn-retry` (`attempt`, `of`, `error`, `message` до 300 символов, `until`), `retry-refused` (`reason`,
   `actions?`); описание в шапке `journal.ts`, схема через `event(…)`.
5. **Состояние:** `AutopilotState.waitingFor: 'retry'`, `retry: { attempt, of }`, `resumesAt`; строка Canvas
   `API error · retry 2/5 · 14:20`.

## Готово, когда

- [ ] Contract test: переключатель off, 500 → `run-stopped` `turn-error`, как сегодня (скрипт worfy-faults не нужен:
      свой fixture).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-retry.test.ts` exit 0 · mac - · 8ff83b09c7d0863c5a3c32ef2fefd497f36057c5
- [ ] Contract test: on, 500 → `turn-retry` 1/5, по таймеру test-а `resumed`, Run дальше; команда Wave ушла один раз;
      продолжение одно и без `/epic-wave`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-retry.test.ts` exit 0 · mac - · 8ff83b09c7d0863c5a3c32ef2fefd497f36057c5
- [ ] Contract test: on, 529 пять раз подряд — паузы по `retryDelay`, затем `retry-refused` `cap`, `turn-error`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-retry.test.ts` exit 0 · mac - · 8ff83b09c7d0863c5a3c32ef2fefd497f36057c5
- [ ] Contract test: on, 400 → `retry-refused` `not-transient`; `git push` без результата → `in-flight`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-retry.test.ts` exit 0 · mac - · 8ff83b09c7d0863c5a3c32ef2fefd497f36057c5
- [ ] Contract test: on, отказ Limits не уходит в повтор (`limits-hit`, не `turn-retry`).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-retry.test.ts` exit 0 · mac - · 8ff83b09c7d0863c5a3c32ef2fefd497f36057c5
- [ ] Contract test: ожидание и удачный ход фоновой задачи — продолжения нет; Stop во время ожидания — `user-stop`,
      продолжения нет; выход — таймер отменён.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-retry.test.ts` exit 0 · mac - · 8ff83b09c7d0863c5a3c32ef2fefd497f36057c5
- [ ] Unit test `autopilotStatusLine`: вид `retry`. Снимки строки Canvas в двух темах.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный (Linux, macOS, Windows). Ревью не ниже `high`.

## Тесты

- Contract `test/contract/autopilot-retry.test.ts` (новый), setup — по образцу `harness()`
  (`test/contract/autopilot-limits.test.ts:210`), часы и таймер test-а.
- Скрипты `test/fixtures/agent-scripts/autopilot-retry-500.jsonl`, `autopilot-retry-overloaded-5.jsonl`,
  `autopilot-retry-in-flight.jsonl` (новые; `wait_message`, `result` с `is_error`, затем удачный ход).
- Сначала падающий: on, 500 — ожидание `turn-retry` красное.
- Прогнать `test/contract/autopilot*.test.ts`, `test/unit/autopilot-*.test.ts`.

## Где в коде

- `src/main/autopilot/turn-retry.ts` (новый)
- `src/main/autopilot/run.ts`
- `src/shared/autopilot/journal.ts`
- `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts` (зависимости `retry` в `new Autopilot`, `:149`)
- `test/contract/autopilot-retry.test.ts`, `test/fixtures/agent-scripts/autopilot-retry-*.jsonl` (новые)

Только читать: `src/main/autopilot/limits-wait.ts`, `src/shared/autopilot/cycle.ts`, `src/shared/agent/continue-plan.ts`,
`src/shared/agent/turn-failure.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`.
