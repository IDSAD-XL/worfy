# 04: Потери cache

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 04; «Решения по реализации» («Чистые модули», `cache-loss.ts`); «Решения по
test-ам», Seam 1; «Не в этом Epic-е» (Epic 2); «Волны», Wave 2; [critic 2026-11-28](../../../docs/product/critic/worfy-limits-ledger-2026-11-28.md),
возражение 2 — причина «after a Limits wait» решает, открывать ли Epic 2

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- `scripts/agent-cost.mjs --idle` считает перезаписи после простоя (`:476`, `:573`), но не называет причину потери и
  не видит потерь после смены модели, compaction и ожидания Limits.
- Продолжение после ожидания Limits идёт в ту же Session тремя путями: Run Autopilot-а
  (`src/main/autopilot/limits-wait.ts:37-43`), Auto-continue (`src/main/agent/orchestrator-continue.ts`), закрытый список
  Assistant-а (`src/main/assistant/actions/limits-waits.ts:1-9`). Журналы Autopilot-а этого Mac ни разу не записали
  `limits-hit` (critic 2026-11-28, возражение 2), поэтому одного журнала мало: отказ виден и в транскрипте, как ответ
  `<synthetic>` с текстом отказа.

## Что строить

- `src/shared/usage/cache-loss.ts` — чистый модуль: последовательность `UsageRecord` одного разговора → потери.
- Потеря — не первый ответ разговора, который записал больше половины своего контекста (правило из Ticket-а 01).
- Причина — первая подходящая по порядку:
  1. compaction — отметка `compacted`;
  2. смена модели — у прошлого ответа другая `model`;
  3. ожидание Limits — между прошлым ответом и этим есть ответ с `limitsRefused`, или пауза покрывает строки
     `limits-hit` и `resumed` журнала Run-а (`src/shared/autopilot/journal.ts:649-651`);
  4. пауза дольше жизни cache — 5 min или 1 h, по тому, куда писал прошлый ответ;
  5. смена списка tools — только живая Session worfy, по событию `mcp` (`src/shared/agent/events.ts:147`);
  6. иначе — «unknown».
- Цена потери — записанные token-ы × (вес записи − вес чтения).
- Оценка перечитывания для строк перед действием (Ticket 11): контекст × вес записи против контекста × вес чтения, и
  оценка нового старта по контексту первого ответа новой Session.

## Где в коде

- `src/shared/usage/cache-loss.ts` (новый, имя — предложение)
- `test/unit/usage-cache-loss.test.ts` (новый, имя — предложение)
- Только чтение: `src/shared/autopilot/journal.ts` (строки `limits-hit`, `resumed`), `src/shared/agent/events.ts`
  (`mcp`)

## Test-ы

- Unit test-ы: fixture на каждую причину и на «unknown»; порядок причин (compaction после смены модели — compaction);
  ожидание Limits узнаётся по `limitsRefused` без журнала и по журналу без `limitsRefused`; цена потери; первый ответ
  разговора — не потеря; оценка перечитывания и нового старта.
- Сначала падающий test: красный до модуля, это пишется в «Итог».
- Без моделей и без сети.

## Готово, когда

- [ ] `cache-loss.ts` находит потери, называет причину по порядку и считает цену (unit test на каждую причину).
- [ ] Ожидание Limits узнаётся и по транскрипту (`limitsRefused`), и по журналу Run-а.
- [ ] Оценка перечитывания и нового старта для строк перед действием (unit test-ы).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
