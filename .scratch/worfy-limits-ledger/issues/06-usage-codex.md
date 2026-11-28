# 06: Usage Codex

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 06; «Решения по реализации» («Codex», «Калибровка по текущему 7-дневному окну» —
Codex без оценки доли); «Решения по test-ам», Seam 2; «Риски» («Codex отдаёт неполные числа»); «Не в этом Epic-е»;
«Волны», Wave 2

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Вживую Codex шлёт `thread/tokenUsage/updated` (`src/main/vendors/codex/items.ts:259-267`), но worfy делает из него
  только событие `context`. В счётчиках хода есть `cachedInputTokens` и `cacheWriteInputTokens`
  (`src/main/vendors/codex/protocol/ts/v2/TokenUsageBreakdown.ts`).
- История Codex (`HistoryPart`, `src/main/vendors/history.ts:21-29`) отдаёт только список и транскрипт. Протокол умеет
  `account/usage/read` с `threadId` (`protocol/ts/v2/GetAccountTokenUsageParams.ts`), ответ — `ThreadUsage` с группами
  по модели (`ThreadUsageBreakdownGroup.ts`). worfy зовёт только `account/rateLimits/read`
  (`src/main/vendors/codex/limits.ts:122`).
- `costUsd` Codex всегда 0 (`src/main/vendors/codex/items.ts:386`).

## Что строить

- Живые счётчики: из `thread/tokenUsage/updated` — запись `UsageRecord` хода (Vendor `codex`, модель, `input`,
  `output`, `cacheRead` из `cachedInputTokens`, запись из `cacheWriteInputTokens`); событие `context` остаётся как есть.
- История: новый необязательный `usage(id)` у `HistoryPart`; у Codex — запрос `account/usage/read` с `threadId`, суммы
  по thread-у и по модели. Vendor без `usage` — без истории token-ов.
- Счётчик `null` в группе — «unknown», не ноль. `estimatedUsageCreditsMicros` не показывается.
- Оценки доли окна у Codex в этом Epic-е нет: только token-ы и доля чтения из cache.
- fake app-server отвечает на `account/usage/read` и шлёт `thread/tokenUsage/updated` со счётчиками.

## Где в коде

- `src/main/vendors/codex/items.ts` — `thread/tokenUsage/updated`
- `src/main/vendors/codex/history.ts` — `usage(id)` у `HistoryPart` Codex
- `src/main/vendors/history.ts` — необязательный `usage` у `HistoryPart`
- `test/fixtures/codex-app-server/fake-app-server.mjs` — ответ `account/usage/read`, счётчики хода
- `test/contract/codex-fake.test.ts`, `test/contract/codex-compat.test.ts` — рядом с ними новый contract test usage (имя — предложение)

## Test-ы

- Contract test: fake app-server шлёт `thread/tokenUsage/updated` — worfy отдаёт запись хода с cache-счётчиками;
  `account/usage/read` — суммы thread-а по модели; `null` в группе — «unknown».
- Сначала падающий test: красный на нынешнем коде, это пишется в «Итог».
- Без моделей и без сети (`WORFY_CODEX=fake`); настоящий binary Codex не запускается.

## Готово, когда

- [ ] Живой ход Codex даёт запись token-ов с cache-счётчиками (contract test).
- [ ] `HistoryPart.usage(id)` Codex отдаёт суммы thread-а по модели через `account/usage/read`; `null` — «unknown».
- [ ] fake app-server умеет оба сообщения.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
