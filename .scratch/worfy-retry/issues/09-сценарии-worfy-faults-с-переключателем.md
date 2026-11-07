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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-api.test.ts test/contract/autopilot-faults-codex.test.ts test/contract/autopilot-faults-process.test.ts test/contract/autopilot-faults-github.test.ts` exit 0 · mac - · 9f6a469181328c546051c4b8134d6284481e3279
- [ ] Contract test-ы с переключателем: 500, 529, обрыв связи — `checkRecovery` пустой, команда Wave одна.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-retry.test.ts` exit 0 · mac - · 9f6a469181328c546051c4b8134d6284481e3279
- [ ] `cap` и `in-flight` — Run остановлен `turn-error`, `checkRecovery` пустой.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-retry.test.ts` exit 0 · mac - · 9f6a469181328c546051c4b8134d6284481e3279
- [ ] Каждый новый случай И4 ловит свой испорченный fixture — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-invariants.test.ts` exit 0 · mac - · 9f6a469181328c546051c4b8134d6284481e3279
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

## Итог

- **`faultRun({ autoContinue: true })`** (`test/contract/autopilot-faults-setup.ts:128`, сборка — `:469`): Run получает
  `AutopilotDeps.retry` с включённым переключателем, таймер паузы на часах test-а (`FaultClock.schedule`) и
  `random: 0.5` — пауза ровно по плану (1, 5, 15, 30, 60 мин). Без поля `retry` не передаётся вовсе — Run как до
  worfy-retry; `autopilot-faults-api`, `-codex`, `-process`, `-github` не тронуты и зелёные.
- **`checkRecovery`, И4** (`test/autopilot-invariants.ts`): новое поле `expect.refused` (`:47`) и функция
  `retriesEnd` (`:210`), три новые строки правила:
  1. `errorText` Run-а, который пережил сбой, ищется и в `turn-retry.message`, не только в `session-error` (`:193`).
  2. Каждый `turn-retry` получает `resumed` раньше следующего шага (`turn-retry`, `retry-refused`, `wave-started`,
     `wave-finished`, `run-stopped`; `:203`); исключения — Stop человека (`user-stop`, `user-force-stop`,
     `app-quit`, `:201`) и убитое приложение (`stop: null`). Ожидание, которое перехватили Limits
     (`limits-hit` → `waiting-until` → `resumed`), — не нарушение.
  3. `retry-refused` стоит прямо перед `run-stopped` `turn-error` (`:225`), и причина `expect.refused` есть перед
     `run-stopped` (`:232`).
- **И1** кода не менял: текст продолжения (`retryText`) не содержит строки `/epic-wave`, поэтому командой Wave не
  считается; повторная команда Wave вместо продолжения — «sent 2 times». Это закреплено unit test-ом.
- **Испорченные fixture-ы — по одному на каждую новую строку** (`test/unit/autopilot-invariants.test.ts`, fixture-ы
  собраны в test-е из хорошего Run `api-500`, отдельных папок нет):
  - строка 1 — «I4 holds the error text of a survived Run to its turn-retry» (`:248`): `errorText`
    `/overloaded_error/` при `turn-retry` с 500 → `I4: no session-error or turn-retry matches …`;
  - строка 2 — «I4 sees a turn-retry without its resumed before the next step» (`:254`): у повтора 3 убран `resumed`
    → `I4: turn-retry 3 has no resumed before turn-retry`; повтор без `resumed` перед `wave-finished` → то же;
  - строка 2, исключение — «I4 lets a wait to retry end with a Force stop, …» (`:275`): Force stop во время
    ожидания, перехват Limits и убитое приложение — нарушений нет;
  - строка 3 — «I4 sees a retry-refused that is not the give-up …» (`:263`): `resumed` после `retry-refused` cap →
    `I4: retry-refused cap is followed by resumed, not run-stopped turn-error`; «I4 holds the reason of the give-up
    to the scenario» (`:270`): `refused: 'in-flight'` у Run с `cap` и `refused: 'cap'` у Run без отказа →
    `I4: no retry-refused … before run-stopped`;
  - И1 — «I1 does not count the continuation as a Wave command, …» (`:242`).
  Каждую строку проверил мутантом (строка правила выключена → падает свой test): 5 мутантов, все убиты.
- **Contract `test/contract/autopilot-faults-retry.test.ts`**, шесть сценариев на `faultRun({ autoContinue: true })`:
  - 500, 529 посреди потока, обрыв связи (новые скрипты `autopilot-fault-retry-500/-overloaded/-connection.jsonl`:
    ход worfy-faults 02 с двумя фоновыми implementer-ами, после ошибки — ход продолжения): `turn-retry` 1 из 5,
    пауза 1 мин по часам test-а, одно продолжение без `/epic-wave`, `resumed`, Wave 1 кончается, Wave 2 идёт,
    `no-ready-wave`; команды Wave — `[WAVE_1, WAVE_2]`; `checkRecovery` пустой; 529 — без `limits-hit`.
  - пять 529 подряд (`autopilot-retry-overloaded-5`): паузы 1, 5, 15, 30, 60 мин, `retry-refused` `cap`,
    `session-error` с «gave up after 5 retries», `run-stopped` `turn-error`; новый старт проходит (Wave 2);
    `checkRecovery` пустой с `refused: 'cap'`.
  - `git push` без результата, затем 500 (`autopilot-retry-in-flight`): `retry-refused` `in-flight` с
    `git push origin demo/01`, продолжения нет, `turn-error`; новый старт проходит; `checkRecovery` пустой.
  - Limits в Wave 2 по окну `seven_day` без `five_hour` (`autopilot-limits-weekly`): ожидание до сброса через 3 дня
    + 2 мин, одно продолжение Limits, `resumed`, `no-ready-wave`; `checkRecovery` пустой.
- Сначала падал: до правила И4 три сценария сбоев API давали `I4: no session-error matches …` (`turn-retry` правило
  не знало), три других проходили.
- Время: файл contract test-ов — около 2 с локально (5 прогонов подряд, exit 0); лог `linux-tests` — в PR.
- `src/` не изменён.
