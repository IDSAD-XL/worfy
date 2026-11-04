# 02 — Contract setup и сбои API: 500, 529, обрыв связи, Limits в Wave 2

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Сценарии» (строки API 500, API 529, обрыв связи, Limits), «Что уже есть», «Решено без владельца», п. 1, 2, 5, «Где идёт набор»; [worfy-polish 50](../../worfy-polish/issues/50-autopilot-не-стартует-после-остановки-run-а.md), «Что происходит»

## Что происходит

- `harness()` в `test/contract/autopilot-limits.test.ts:210` собирает настоящие `SessionRegistry`, `Orchestrators`,
  `ActionLauncher`, Journal и `Autopilot` над fake agent с фиксированными часами; таймер ожидания Limits — в руках
  test-а. Этот файл не правим: новый setup повторяет сборку, перенос старых test-ов — не в этом Epic-е.
- Поля `AutopilotDeps` (`src/main/autopilot/run.ts`) для test-ов: `settleMs`, `limits`, `backgroundStallMs`,
  `tasksClock`, `prs` / `prsEveryMs` / `prsClock`, `endReadMs`.
- Ход с ошибкой → `turn-error` с событием `session-error` (`src/shared/autopilot/cycle.ts:288`); его текст — в
  Journal (`Autopilot.feed`, `run.ts`). Остановку после API 500 при живых задачах и новый старт проверяет e2e polish 50
  (`test/e2e/autopilot.spec.ts:1054`) — без общих правил.
- Ответ 529 (`overloaded_error`) и обрыв связи посреди потока ответа test-ами Autopilot не проверены; что 529 не
  принимается за Limits — тоже.

## Что делаем

1. **`test/contract/autopilot-faults-setup.ts`** — `faultRun(options)`: временный git-Project с Epic `demo` (Ticket-ы
   01, 02 готовы, 03 после них), fake agent со скриптом сценария, часы и таймеры test-а. Сразу —
   все поля, нужные Ticket-ам 03, 04, 06, чтобы в Wave 3 setup никто не правил:
   - `processes` — Claude process stub (`test/contract/claude-process-stub.ts`) для проверки «живых процессов не
     осталось» (смерть Claude Code сценарий играет директивой `crash`, не SIGKILL);
   - `prs` — свой `PrTracker` с `ghRunner` (`command: STUB_COMMAND`, `timeoutMs`), `now`, `baseIntervalMs`,
     `maxIntervalMs` и `GH_STUB_DIR` сценария; по умолчанию — gh через `test/contract/gh-world.ts`;
   - `vendor` — `claude` или `codex` (fake Codex, временный `CODEX_HOME`), Vendor Orchestrator-а Project-а.

   Возвращает Autopilot, функции, которые двигают часы и запускают таймеры, чтение Journal, сообщения
   Orchestrator-у, лог gh, снимок Project-а — всё, что ждёт `checkRecovery` (Ticket 01). `afterEach` — `stopAll()` stub-а и удаление папок.
   Сборка — по образцу `harness()`, без импорта из test-файла.
2. **Скрипты** (копии `autopilot-background.jsonl` / `orchestrator.jsonl` с заменой одного `result`):
   - `autopilot-fault-api-500.jsonl` — `result` `is_error`, `API Error: 500 {…"api_error"…}`;
   - `autopilot-fault-overloaded.jsonl` — несколько `stream_event`, затем `result` `is_error`
     `API Error: 529 {…"overloaded_error"…}`;
   - `autopilot-fault-connection.jsonl` — `result` `is_error` «API Error: Connection error.».
3. **`test/contract/autopilot-faults-api.test.ts`** — по test-у на сценарий: Run стартует, сбой, проверка
   `checkRecovery` с ожиданием `turn-error` и текстом ошибки; затем новый старт той же Session проходит (И6), и в
   новом Run команда Wave уходит один раз.
4. **Limits в Wave 2:** Wave 1 проходит, ход Wave 2 отказан Limits (`autopilot-limits.jsonl`, как в
   `autopilot-limits.test.ts:364`), таймер test-а «наступает сброс» → `resumed`; `checkRecovery` — Wave 1 не ушла
   снова, Wave 2 — один раз и одно продолжение.

## Готово, когда

- [ ] Contract test: API 500 — `run-stopped` `turn-error`, `session-error` с «API Error: 500»; `checkRecovery` пустой;
      новый Run стартует и шлёт команду Wave один раз.
- [ ] Contract test: 529 посреди потока — то же; в Journal нет `limits-hit` (не принят за Limits).
- [ ] Contract test: обрыв связи — то же.
- [ ] Contract test: Limits в Wave 2 — `limits-hit`, `waiting-until`, `resumed`; команда Wave 1 одна, продолжение одно;
      `checkRecovery` пустой.
- [ ] Каждый test краснеет, если испортить ожидание (вторая отправка команды Wave в setup-е) — записано в «Итог».
- [ ] Contract test: `faultRun({ vendor: 'codex' })` доходит до `wave-started` (поле для Ticket-а 06 работает).
- [ ] Файл contract test-ов идёт не дольше 20 с по логу `linux-tests` (предел этого Epic-а); после него нет живых процессов stub-а.
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux и Windows).

## Тесты

- Contract `test/contract/autopilot-faults-api.test.ts` (новый).
- Сначала падающий: API 500 с `checkRecovery`, пока setup не отдаёт сообщения Orchestrator-у.
- Прогнать `test/contract/autopilot*.test.ts`, `test/contract/orchestrator*.test.ts`, `test/unit/autopilot-*.test.ts`.

## Где в коде

- `test/contract/autopilot-faults-setup.ts` (новый; поля `processes`, `prs`, `vendor`)
- `test/contract/autopilot-faults-api.test.ts` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-api-500.jsonl` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-overloaded.jsonl` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-connection.jsonl` (новый)

Только читать: `test/contract/autopilot-limits.test.ts` (`harness()`), `test/contract/autopilot-background.test.ts`,
`test/contract/claude-process-stub.ts`, `test/contract/gh-world.ts`, `src/main/github/prs.ts` (`PrTracker`),
`src/main/autopilot/run.ts`,
`src/main/agent/fake-query.ts`, `test/autopilot-invariants.ts`.
