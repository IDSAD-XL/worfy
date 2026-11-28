# 07: Service и каналы учёта

Type: task
Status: open
Blocked by: 02, 03, 04, 05, 06
Source: [spec.md](../spec.md), «Ticket-ы», 07; «Решения по реализации» («Service и каналы», «Калибровка по текущему
7-дневному окну», «Assistant», «Хранение и приватность»); «Риски» («Работа вне этой Machine», «Чтение транскриптов
дорого»); «Волны», Wave 3

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Модули Wave 2 считают по входу, но в приложении их никто не собирает: записи ответов (05, 06), срезы (03), потери
  cache (04), калибровка (02).
- Источники уже есть в main: readers Work track и Flight Recorder с кэшем в памяти, состояние Limits (`LimitsTracker`,
  `src/main/agent/limits.ts:83`), журналы Run-ов (`journalDir`, `src/main/autopilot/journal.ts:40`; доля Run-а
  `actual` в `run-stopped`, `src/shared/autopilot/journal.ts:672`), журнал Assistant-а (`appAssistantUsage`,
  `src/main/assistant/budget/ledger.ts`; вызовы с `usage` и `costUsd`, `src/shared/assistant/budget.ts:33-54`).
- Образец каналов — `src/shared/ipc/work-track.ts` и `src/main/ipc/work-track.ts`.

## Что строить

- `src/main/usage/service.ts`: собирает записи ответов этой Machine (readers, проход по чужим папкам, Codex), вызовы
  Assistant-а из `usage.json` (роль Assistant), `seven_day` из состояния Limits и журналы; отдаёт:
  - срезы и итог для периода, Run-а, Ticket-а или Session;
  - потери cache по причинам;
  - коэффициент `k` с разбросом, долю окна `U`, от которой он посчитан, и причину, если оценки нет;
  - для Run-а — факт журнала `actual` и «Not counted» (факт минус оценка).
- Каналы `src/shared/ipc/ledger.ts` (схемы) и `src/main/ipc/ledger.ts` (handlers), по образцу Work track.
- Ничего не пишется на диск (ADR-0092); результат держит кэш в памяти, как у Work track.

## Где в коде

- `src/main/usage/service.ts` (новый, имя — предложение)
- `src/shared/ipc/ledger.ts`, `src/main/ipc/ledger.ts` (новые, имена — предложение)
- регистрация handler-ов и preload — там же, где у Work track (`src/main/ipc/work-track.ts`, `src/preload/index.ts`)
- `test/contract/usage-service.test.ts` (новый, имя — предложение)

## Test-ы

- Contract test service-а на fixture-ах транскриптов, `limits.json`, `usage.json` и журнала Run-а во временных
  `CLAUDE_CONFIG_DIR` и `WORFY_DATA_DIR`: срезы периода с Assistant-ом; `k` и `U` в ответе; доля окна ниже порога —
  оценки нет и причина названа; Run — `actual` и «Not counted»; на диск ничего не записано (папка данных не изменилась).
- Сначала падающий test: красный до service-а, это пишется в «Итог».
- Без моделей и без сети.

## Готово, когда

- [ ] Канал учёта отдаёт срезы, потери cache, `k` с разбросом и `U` для периода, Run-а, Ticket-а и Session (contract
      test).
- [ ] Вызовы Assistant-а из `usage.json` — роль Assistant; Run — `actual` журнала и «Not counted».
- [ ] Учёт ничего не пишет на диск (contract test).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
