# 06 — Продолжение ручного хода Orchestrator-а вне Run-а: ошибка API и отказ Limits

Type: task
Status: open
Blocked by: 03, 04, 05
Source: [spec.md](../spec.md), «Что видит владелец», п. 2 и 5; «Как работает» → «Где живёт»; «Риски», п. 6; «Вопросы владельцу», Q5

## Что происходит

- Вне Run-а Autopilot-а ход Orchestrator-а с ошибкой или с отказом Limits просто кончается; дальше Session ждёт
  человека. Ночью Orchestrator часто ведёт Wave-ы сам, без Run-а, с фоновыми агентами.
- Run Autopilot-а после Ticket-ов 04 и 05 повторяет сам; Session Run-а помечена unattended (`setUnattended`,
  `src/main/agent/orchestrator.ts`).
- События Session — `sharedRegistry().observe` (как `observeSessionLimits` в `src/main/ipc/autopilot.ts:194`);
  сообщение — `Session.send`.

## Что делаем

1. **`src/main/agent/orchestrator-continue.ts`** — по Session Orchestrator-а каждого Project-а с включённым
   переключателем: следит за `prompt`, `result`, `tool_use`, `tool_result`, `limits`, `limit_reached`.
2. **Молчит, пока Run владеет Session** (Run Autopilot-а этого Project-а идёт): тогда отвечает Run. Test ловит два
   продолжения на одну ошибку.
3. **Ошибка API:** `turnFailureKind` → `retryDecision` → таймер `retryDelay` → `retryText` в Session; счётчик — до
   удачного хода. **Отказ Limits:** `hitOf` / `resumeAt` (с правилами Ticket-а 05) → таймер → `continueText`.
4. **Человек написал** во время ожидания (событие `prompt` не от worfy) — ожидание снято. Выключили переключатель,
   закрыли Session, вышли из приложения — таймер отменён.
5. **Строки в транскрипте** — событие `notice` worfy (модель его не получает): «worfy: API error 529, retry 2 of 5 at
   14:20», «worfy: sent "continue" (retry 2 of 5)», «not retried: <действие> may or may not have run»,
   «worfy: waiting for the Limits, resumes 14:20». Проверить первым шагом, что `notice` сохраняется в транскрипте
   после перезапуска приложения; если нет — записать в «Итог» и показывать строку только в живом окне.
6. Состояние ожидания (вид, попытка, время) — наружу для Ticket-а 07, методом модуля.

## Готово, когда

- [ ] Contract test: on, ручной ход 529, затем удачный — одно продолжение, строки в транскрипте; off — ничего не ушло.
- [ ] Contract test: человек написал во время ожидания — продолжения нет.
- [ ] Contract test: отказ Limits вне Run-а — ожидание сброса по stub-у, одно продолжение.
- [ ] Contract test: идёт Run — модуль ничего не шлёт; Run повторил один раз.
- [ ] Contract test: `git push` без результата — продолжения нет, строка «not retried».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный. Ревью не ниже `high`.

## Тесты

- Contract `test/contract/orchestrator-continue.test.ts` (новый): настоящие `SessionRegistry`, `Orchestrators` на fake
  agent, часы и таймер test-а.
- Скрипты `test/fixtures/agent-scripts/orchestrator-continue-overloaded.jsonl`, `orchestrator-continue-limits.jsonl`
  (новые).
- Сначала падающий: on, 529 — ожидание продолжения красное.
- Прогнать `test/contract/orchestrator*.test.ts`, `test/contract/autopilot*.test.ts`.

## Где в коде

- `src/main/agent/orchestrator-continue.ts` (новый)
- `src/main/agent/app-orchestrators.ts` (подключение)
- `test/contract/orchestrator-continue.test.ts`, `test/fixtures/agent-scripts/orchestrator-continue-*.jsonl` (новые)

Только читать: `src/main/agent/orchestrator.ts`, `src/main/agent/limits.ts`, `src/main/autopilot/turn-retry.ts`,
`src/main/autopilot/limits-wait.ts`, `src/shared/agent/continue-plan.ts`, `src/shared/agent/turn-failure.ts`.
