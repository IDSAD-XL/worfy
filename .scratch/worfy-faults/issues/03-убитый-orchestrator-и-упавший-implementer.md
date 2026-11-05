# 03 — Умерший Claude Code Orchestrator-а и упавший implementer

Type: task
Status: claimed 2026-11-05T11:29Z
Blocked by: 02
Source: [spec.md](../spec.md), «Сценарии» (строки «Claude Code Orchestrator-а умер во время фоновой записи», «Implementer упал …»), «Правила восстановления» (И1, И3, И4, таблица причин И4)

## Что происходит

- Implementer-ы — Subagent-ы внутри процесса Claude Code Orchestrator-а; worfy видит их по `task_started` /
  `task_notification` (`test/fixtures/agent-scripts/autopilot-background.jsonl`). Статусы `task_notification` в SDK —
  `completed`, `failed`, `stopped`; worfy читает `status` строкой (`src/shared/vendors/claude/events.ts:78`).
- SIGKILL процесса Claude process stub Session в `error` не переводит: Session только запоминает выход процесса
  (`watch`, `src/main/agent/session.ts:540-543`), fake query ждёт дальше на `wait_release`, а процессы stub-а
  закрыты (`children`, `test/contract/claude-process-stub.ts:56`). Смерть Claude Code в рабочих test-ах — директива
  `crash` после `wait_release`: `test/contract/autopilot-background.test.ts:624-628` (живые задачи),
  `test/contract/autopilot-limits.test.ts:498-501` («Claude Code process exited with code 1»).
- Ошибка Session → `session-error` в Run (`Autopilot.onEvent`, `src/main/autopilot/run.ts`).
- Конец хода без задач и без ошибки → `evaluate` (`src/shared/autopilot/cycle.ts`): Ticket Wave ещё в работе
  (`claimed`) → `settling`, затем `settle-timeout` → `wave-unfinished` (`cycle.ts:303`); Ticket вернулся в `open` →
  новая Wave с ним (`send-wave`), а `no-progress` — только если следующая Wave та же, что прошлая (`sameSet`).
- Сценариев «Claude Code умер, пока implementer пишет в фоне» и «implementer упал» нет.

## Что делаем

1. **Claude Code умер.** Скрипт `autopilot-fault-orchestrator-died.jsonl`: строки `autopilot-background.jsonl` до
   первого `result` (оба implementer-а запущены), затем `{"fake":"wait_release","name":"die"}` и
   `{"fake":"crash","error":"Claude Code process exited with code 1"}` — как в `autopilot-background.test.ts:628`.
   Test ставит 01 в `claimed`, отпускает `die`. Ожидание: `session-error` с текстом выхода, `run-stopped`
   `session-error`; `checkRecovery` пустой (И1 — команда Wave одна, И3 — `claimed` 01 записан один раз); новый старт
   идёт в новую Session Orchestrator-а и шлёт команду Wave один раз. Claude process stub (поле `faultRun` из
   Ticket-а 02) здесь только для проверки: после test-а нет живых процессов.
2. **Implementer упал, Ticket остался `claimed`.** Скрипт `autopilot-fault-implementer-failed.jsonl`:
   `task_notification` `status: failed` у первого implementer-а, `completed` у второго, затем последний ход
   Orchestrator-а кончается без задач. Test ставит 02 в `done`, 01 остаётся `claimed`. Ожидание: `settling`, по
   часам test-а через `settleMs` — `wave-unfinished`; команда Wave одна; И3 — 02 `done` один раз, у 01 лишних строк нет.
3. **Implementer упал, Orchestrator вернул Ticket в `open`.** Тот же скрипт; test ставит 01 в `open`, 02 в `done`.
   Ожидание: новая Wave только с 01 (вторая строка `/epic-wave` называет 01, И1 её не считает повтором), не
   `no-progress`.

## Готово, когда

- [ ] Contract test: Claude Code умер при живых implementer-ах — `session-error`, `run-stopped` `session-error`;
      `checkRecovery` пустой; новый Run стартует, команда Wave одна.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-process.test.ts` exit 0 · mac - · eaef63df129abbf20cb57c3375bf94a0a55e06bc
- [ ] Contract test: implementer `failed`, 01 `claimed` — `wave-unfinished` после `settleMs`; одна команда Wave;
      `ticket-status` по одной строке на изменение; `checkRecovery` пустой.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-process.test.ts` exit 0 · mac - · eaef63df129abbf20cb57c3375bf94a0a55e06bc
- [ ] Contract test: implementer `failed`, 01 `open` — вторая Wave только с 01; `checkRecovery` пустой.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-process.test.ts` exit 0 · mac - · eaef63df129abbf20cb57c3375bf94a0a55e06bc
- [ ] После файла нет живых процессов stub-а (`stopAll()` в `afterEach`).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-process.test.ts` exit 0 · mac - · eaef63df129abbf20cb57c3375bf94a0a55e06bc
- [ ] Каждый test краснеет на испорченном ожидании — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-process.test.ts` on 4 spoiled-expectation mutants exit 1, each red in its test · mac - · eaef63df129abbf20cb57c3375bf94a0a55e06bc
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · eaef63df129abbf20cb57c3375bf94a0a55e06bc
  - evidence: gate pass · `gate fast` exit 0 · mac - · eaef63df129abbf20cb57c3375bf94a0a55e06bc

## Тесты

- Contract `test/contract/autopilot-faults-process.test.ts` (новый).
- Сначала падающий: сценарий 1 с ожиданием `turn-error` — красный на `session-error`.
- Прогнать `test/contract/autopilot*.test.ts`, `test/contract/orchestrator*.test.ts`.

## Где в коде

- `test/contract/autopilot-faults-process.test.ts` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-orchestrator-died.jsonl` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-implementer-failed.jsonl` (новый)

Только читать: `test/contract/autopilot-faults-setup.ts`, `test/contract/claude-process-stub.ts`,
`test/contract/autopilot-background.test.ts`, `test/fixtures/agent-scripts/autopilot-background.jsonl`,
`src/main/autopilot/run.ts`, `src/shared/autopilot/cycle.ts`.

## Итог

- `test/contract/autopilot-faults-process.test.ts` — три сценария на `faultRun()`, каждый кончается `checkRecovery`
  с пустым списком:
  - `:82` — Claude Code Orchestrator-а умер при двух живых implementer-ах: `session-error` «Claude Code process exited
    with code 1», `run-stopped` `session-error`, набор задач пуст до ошибки. Новый старт — вторая unattended Session,
    её команда Wave одна. 01 остаётся `claimed` за умершим implementer-ом, поэтому новая Wave — только 02
    (`/epic-wave Ticket-ы 02 эпика demo`).
  - `:126` — implementer `failed`, 01 `claimed`: `wave-unfinished`, `wave-finished` нет, команда Wave одна;
    `ticket-status`: 01 — `claimed`, 02 — `claimed`, `done`.
  - `:156` — implementer `failed`, 01 вернули в `open`: Wave 2 только с 01, команды `WAVE_1` и
    `/epic-wave Ticket-ы 01 эпика demo`; Run остановлен Force stop-ом.
- Смерть Claude Code — как в жизни: test шлёт SIGKILL процессу stub-а unattended Orchestrator-а, потом отпускает
  `die`, и fake query бросает `crash`. Процесс test берёт через `QueryRequest.spawned` (`stubs()`, `:64`). Без
  SIGKILL процесс stub-а жив после `crash`, и Session ждёт его `EXIT_WAIT_MS` (7,5 с) до своего SIGKILL —
  сценарий 1 шёл 7,9 с вместо 0,3 с.
- `settleMs` — настоящее время (`setTimeout` в `run.ts:1894`, часы test-а его не двигают): `SETTLE_MS = ms(150)`.
  Test проверяет, что `run-stopped` пришёл не раньше `settleMs` после строки `background-tasks` с пустым набором.
- Процессы: `afterAll` проверяет `processes.alive() === 0` у каждого `faultRun` файла после `afterEach` setup-а.
- Время файла на Mac: 1,9 с (три прогона подряд, все exit 0).
- Испорченные ожидания (каждый раз красный нужный test, exit 1):
  - сценарий 1 ждёт `turn-error` — красный на `session-error`;
  - сценарий 2 с `settleMs: 0` — красный: `expected 22 to be greater than or equal to 450`;
  - сценарий 3 ждёт Wave 2 с 01 и 02 — красный;
  - команда Wave 1 дважды (`[WAVE_1, WAVE_1]`) — красные сценарии 1 и 2.
