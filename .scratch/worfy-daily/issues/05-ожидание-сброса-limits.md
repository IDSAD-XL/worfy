# 05 — Ожидание сброса Limits и продолжение

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), тема A, риск 3; [CONTEXT.md](../../../CONTEXT.md), термины Limits и Autopilot; Ticket 22 worfy-mvp (Limits); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md)

## Что делаем

**Что есть сейчас.** Каждое SDK-сообщение каждой Session проходит через `appLimits().observe`
(`src/main/agent/app-registry.ts:65`; `src/main/agent/limits.ts:100-108`). Функция
`limitUpdatesFromSdk` (`src/shared/agent/limits.ts:69-93`) разбирает `rate_limit_event`:

- статус — `allowed`, `allowed_warning` или `rejected` (`:26`);
- `resetsAt`;
- `utilization` по окнам `five_hour` и `seven_day`.

Состояние пишется в `<dataRoot>/limits.json`. На `rejected` никто не реагирует: Limits только
показываются.

**Первый шаг — проверка, итог в «Итог» до кода:**

- Как SDK сообщает об упоре в Limits внутри Session: `rate_limit_event` со статусом `rejected`,
  `result` с ошибкой или и то, и другое.
- В каких единицах приходит `resetsAt`. Status line отдаёт `resets_at` в Unix-секундах (Ticket 22
  worfy-mvp).

Где смотреть: `test/fixtures/sdk-messages` и обработка `result` в `src/main/agent/session.ts:478`.
Записать вместе с версией Claude Code.

**`src/shared/autopilot/resume-at.ts`** — чистая функция. Вход: события Limits, состояние
`limits.json` и `now`. Выход: время продолжения или «неизвестно».

- Время продолжения — `resetsAt` того окна, в которое упёрлись, плюс небольшой запас.
- При «неизвестно» — повторная проверка через фиксированный интервал.
- Есть предел ожидания. Превышен — прогон останавливается с причиной.
- Интервал и предел — константы с комментарием.

**`src/main/autopilot/limits-wait.ts`** — что происходит, когда Session прогона получила
`rejected`:

1. Прогон переходит в состояние `waiting`. keep-awake держится.
2. Ставится таймер до времени продолжения.
3. По таймеру Orchestrator получает текст-константу: «Продолжай с того места, где остановился. Перед
   продолжением добавь в HANDOFF запись о паузе по Limits: с какого и до какого времени».

HANDOFF пишет сам Orchestrator: worfy в репозиторий Project не пишет (ADR-0005).

**Остальное:**

- `src/main/agent/limits.ts` — подписка на смену статуса по одной Session. Сейчас есть только общая
  рассылка.
- `run.ts` — состояние `waiting`. Таймер отменяется на Stop и на `will-quit`.
- Журнал: события `limits-hit` (окно и `resetsAt`), `waiting-until`, `resumed`.
- Строка состояния Autopilot: «waiting for limits · resumes 14:20».
- Формат события уже менялся: несовпадение даёт `[]` без ошибки (`src/shared/agent/limits.ts:4-8`).
  Если `result` говорит об ошибке Limits, а событие не разобралось, ожидание всё равно идёт по
  `limits.json`.

## Готово, когда

- [ ] В «Итог» записано, как SDK сообщает об упоре в Limits и в каких единицах `resetsAt`, с версией Claude Code.
- [ ] Fake-сценарий `rejected` с `resetsAt` на фиксированных часах: прогон переходит в `waiting`. В момент сброса Orchestrator ровно один раз получает текст продолжения, и прогон снова `running`.
- [ ] Если в событии нет `resetsAt`, время берётся из `limits.json`. Если нет и там — повторная проверка по интервалу, а по пределу — остановка с причиной в журнале.
- [ ] Stop во время ожидания отменяет таймер, сообщение не уходит.
- [ ] Текст продолжения просит Orchestrator записать паузу в HANDOFF. Сам worfy в репозиторий Project не пишет: test сравнивает дерево временного Project до и после.
- [ ] В журнале `limits-hit`, `waiting-until` и `resumed` идут по порядку.
- [ ] Снимки строки состояния `waiting` в двух темах сверены с F-SPEC.

Настоящий упор в Limits этот Ticket не проверяет. Wave-ы Autopilot на стабильной копии начинаются
только после него (Wave 4 плана), а Ticket-ы 06–09 ждут его закрытия. Поэтому настоящий упор —
условие готовности Epic 4 в [spec.md](../spec.md). В «Итог» записать: «настоящий упор в Limits не
проверен, его проверяет условие готовности Epic».

## Тесты

- `test/unit/autopilot-resume-at.test.ts` (новый) — секунды и миллисекунды, окна `five_hour` и `seven_day`, нет `resetsAt`, предел.
- `test/contract/autopilot-limits.test.ts` (новый) — fake-сценарий `test/fixtures/agent-scripts/autopilot-limits.jsonl`, фиксированные часы (`LimitsTracker` принимает `now`, `src/main/agent/limits.ts:36`).
- Сначала падающий test: `rejected` с `resetsAt`, а после сброса Orchestrator продолжения не получает.

## Где в коде

- `src/shared/autopilot/resume-at.ts` (новый)
- `src/main/autopilot/limits-wait.ts` (новый)
- `src/main/autopilot/run.ts` (из 04: файл создаёт Ticket 04)
- `src/main/agent/limits.ts`
- `src/renderer/canvas/actions/AutopilotAction.tsx` (из 04: файл создаёт Ticket 04)
- `test/fixtures/agent-scripts/autopilot-limits.jsonl` (новый)
- `test/unit/autopilot-resume-at.test.ts` (новый)
- `test/contract/autopilot-limits.test.ts` (новый)
