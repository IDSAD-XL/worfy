# 09 — Сценарии worfy-faults с включённым Auto-continue

Type: task
Status: open
Blocked by: 04, 05
Source: [spec.md](../spec.md), «Совместимость с worfy-faults»; [worfy-faults](../../worfy-faults/spec.md), «Правила восстановления (инварианты)», «Сценарии», Q3; Ticket-ы [worfy-faults 01](../../worfy-faults/issues/01-проверка-правил-восстановления.md) и [02](../../worfy-faults/issues/02-contract-setup-и-сбои-api.md) — влиты до старта этого Ticket-а

## Что происходит

- worfy-faults 01 даёт `checkRecovery` (`test/autopilot-invariants.ts`, правила И1–И8); 02 — `faultRun`
  (`test/contract/autopilot-faults-setup.ts`) и сценарии API 500, 529, обрыв связи, которые ждут `turn-error`.
- После Ticket-ов 04 и 05 этого Epic-а с выключенным переключателем те сценарии не меняются; с включённым — Run
  переживает временную ошибку.
- В таблице И4 worfy-faults нет строк `turn-retry` и `retry-refused`.

## Что делаем

1. **`faultRun({ autoContinue: true })`** — поле setup-а: переключатель Project-а и часы повтора test-а. Без поля —
   выключен, старые сценарии не трогаются.
2. **`checkRecovery`:** И4 — Run, который пережил `turn-retry`, кончается `resumed` перед следующим ходом;
   `retry-refused` стоит перед `run-stopped` `turn-error`. И1 — продолжение повтора не считается командой Wave.
   Испорченный fixture на каждую новую строку правила.
3. **`test/contract/autopilot-faults-retry.test.ts`** — те же три сбоя API, что в worfy-faults 02, с переключателем:
   `turn-retry`, `resumed`, `checkRecovery` пустой; 5 ошибок подряд → `retry-refused` `cap`; внешнее действие без
   результата → `retry-refused` `in-flight`; Limits в Wave 2 с окном `seven_day` без `five_hour` → `resumed`.

## Готово, когда

- [ ] Сценарии worfy-faults 02 и 06 без поля `autoContinue` — без правки и зелёные.
- [ ] Contract test-ы с переключателем: 500, 529, обрыв связи — `checkRecovery` пустой, команда Wave одна.
- [ ] `cap` и `in-flight` — Run остановлен `turn-error`, `checkRecovery` пустой.
- [ ] Каждый новый случай И4 ловит свой испорченный fixture — в «Итог».
- [ ] Файл contract test-ов — не дольше 20 с по логу `linux-tests` (предел worfy-faults).
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/autopilot-faults-retry.test.ts` (новый); unit `test/unit/autopilot-invariants.test.ts`
  (дописать).
- Сначала падающий: 500 с переключателем — `checkRecovery` сообщает о нарушении И4, пока правило не знает `turn-retry`.

## Где в коде

- `test/contract/autopilot-faults-setup.ts`
- `test/autopilot-invariants.ts`, `test/unit/autopilot-invariants.test.ts`
- `test/contract/autopilot-faults-retry.test.ts` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-retry-*.jsonl` (новые)

Только читать: `test/contract/autopilot-faults-api.test.ts`, `test/contract/autopilot-retry.test.ts`,
`src/main/autopilot/turn-retry.ts`, `src/shared/autopilot/journal.ts`.
