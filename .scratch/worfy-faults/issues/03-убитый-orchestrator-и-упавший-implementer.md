# 03 — Умерший Claude Code Orchestrator-а и упавший implementer

Type: task
Status: open
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
- [ ] Contract test: implementer `failed`, 01 `claimed` — `wave-unfinished` после `settleMs`; одна команда Wave;
      `ticket-status` по одной строке на изменение; `checkRecovery` пустой.
- [ ] Contract test: implementer `failed`, 01 `open` — вторая Wave только с 01; `checkRecovery` пустой.
- [ ] После файла нет живых процессов stub-а (`stopAll()` в `afterEach`).
- [ ] Каждый test краснеет на испорченном ожидании — в «Итог».
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

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
