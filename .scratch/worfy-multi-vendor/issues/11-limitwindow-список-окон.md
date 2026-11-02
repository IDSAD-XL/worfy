# 11 — LimitWindow: Limits — список окон Vendor-а

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Модель» (LimitWindow), «Решено без владельца», п. 3 и 4, «Соглашения»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), часть limits); решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md)); [ADR-0094](../../../docs/adr/0094-vendor-seam.md)

## Что происходит

- Limits — запись по имени окна (`src/shared/agent/limits.ts:45-47`), имена Claude зашиты: `LIMIT_WINDOWS =
  ['five_hour', 'seven_day']` (`:24`), подписи `5-hour` / `7-day` (`:233`). Доля — 0..1 (`:29`), отказ — `status`
  SDK (`:32`).
- Три источника Claude: событие SDK (`limitUpdatesFromSdk`, `:80`), statusline (`:113`), проба `usage` (`:134`);
  слияние — `mergeLimits` (`:165`).
- Событие Session `rate_limit` несёт `fiveHourUtilization` и `sevenDayUtilization` (`src/shared/agent/events.ts:234-241`,
  `:619-627`).
- Окна по имени читают: `src/shared/autopilot/budget.ts:101`, `:172-181`; `forecast-lines.ts:27`;
  `limits-estimate.ts:26-32`, `:129`; `resume-at.ts:39`, `:74`; `src/main/autopilot/run.ts:1575`;
  `src/main/autopilot/limits-wait.ts:121`; `src/main/terminal-ai/limits-gate.ts:41-44`; панель —
  `src/renderer/shell/toolbar/LimitsMeter.tsx:14`.

## Что делаем

Чистый refactor: Claude ведёт себя так же, пользователь разницы не видит.

1. Тип и схема `LimitWindow` в `src/shared/agent/limits.ts`: `vendor`, `id`, `label`, `usedPercent` (0..100),
   `windowMinutes`, `resetsAt` (Unix seconds или `null`), `reached` (`true` / `false` / `null`), и, как сейчас,
   `receivedAt` и `source`. `LimitsState` — `{ windows: LimitWindow[] }`.
2. Адаптеры Claude (SDK, statusline, `usage`) дают окна с `vendor: 'claude'`: `five_hour` — 300 минут, `seven_day` —
   10080, прочие окна SDK (`seven_day_opus`) — с длительностью, если её можно вывести из имени, иначе `null`.
   `reached` — `status === 'rejected'`.
3. Helper `findWindow(state, vendor, id)` и `longestWindow(state, vendor)`; все читатели выше переходят на них.
   Пороги (`WORKING_FROM`, `BLOCKED_FROM`, `FIVE_HOUR_FULL`) переводятся в проценты, поведение то же.
4. Событие `rate_limit` заменяется на `limits` со списком `LimitWindow` (main его читает в
   `observeSessionLimits`, `src/main/agent/limits.ts:239`; renderer его не читает).
5. `limits.json` старого вида (запись по имени) читается и переводится в список; пишется новый вид. Сборка до
   этого Ticket-а новый файл отложит в сторону — это кэш, он наполнится заново.
6. Journal не меняется: строка `limits` остаётся `{five_hour, seven_day}` (`src/shared/autopilot/journal.ts:351`,
   `:479`), её строит helper из списка.

Глубина review — `high` (граница, соглашения spec-а).

## Готово, когда

- [ ] Unit test: каждый из трёх источников Claude даёт те же окна, что и раньше, в новом виде; слияние и правило
      `SAME_WINDOW_RESET_GAP_S` — те же.
- [ ] Unit test: `limits.json` старого вида читается без потерь `reached` и `resetsAt`.
- [ ] Test-ы budget, `resume-at`, `limits-estimate`, `limits-gate`, LimitsMeter и Autopilot проходят с теми же
      ожидаемыми числами; поправленные строки построения состояния названы в PR.
- [ ] Вне адаптеров Claude, Journal и helper-ов строк `five_hour` / `seven_day` в `src/` нет.
- [ ] `pnpm typecheck`, `pnpm lint` и все unit и contract test-ы модулей Limits, Autopilot и Terminal AI — exit 0.

## Где в коде

- `src/shared/agent/limits.ts` — `:24-54`, `:80`, `:113`, `:134`, `:165`, `:212-286`
- `src/main/agent/limits.ts` — `:58`, `:224-257`
- `src/shared/agent/events.ts` — `:234-241`, `:360-364`, `:619-627`
- `src/shared/autopilot/budget.ts` — `:101`, `:172-181`
- `src/shared/autopilot/forecast-lines.ts` — `:27`
- `src/shared/autopilot/limits-estimate.ts` — `:26-32`, `:129`
- `src/shared/autopilot/resume-at.ts` — `:39`, `:74`
- `src/main/autopilot/run.ts` — `:1575`
- `src/main/autopilot/limits-wait.ts` — `:121`
- `src/main/terminal-ai/limits-gate.ts` — `:41-44`
- `src/renderer/shell/toolbar/LimitsMeter.tsx` — `:14`
- Test-ы: `test/unit/limits.test.ts`, `test/contract/limits.test.ts`, `test/unit/limits-meter.test.tsx`,
  `test/unit/autopilot-budget.test.ts`, `test/unit/autopilot-resume-at.test.ts`,
  `test/unit/autopilot-limits-estimate.test.ts`, `test/unit/terminal-ai-limits-gate.test.ts`,
  `test/contract/autopilot-limits.test.ts`

Только читать: `src/shared/autopilot/journal.ts` (`:143`, `:351`, `:479` — формат не меняется).
