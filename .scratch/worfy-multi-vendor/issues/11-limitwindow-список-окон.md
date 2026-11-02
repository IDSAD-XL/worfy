# 11 — LimitWindow: нейтральная модель Limits и события `limits` / `limit_reached`

Type: task
Status: claimed 2026-11-02T08:09Z
Blocked by: —
Source: [spec.md](../spec.md), «Модель» (LimitWindow), «Соглашения»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), часть limits); решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md)); Ticket 10 ([10-третий-vendor-на-бумаге.md](10-третий-vendor-на-бумаге.md), «Какие правки нужны границе», п. 2 и 4); [ADR-0094](../../../docs/adr/0094-vendor-seam.md)

## Что происходит

- Хранимое состояние Limits Claude — запись по имени окна (`src/shared/agent/limits.ts:45-47`), `LIMIT_WINDOWS =
  ['five_hour', 'seven_day']` (`:24`), доля 0..1 (`:29`), статус SDK `allowed` / `allowed_warning` / `rejected`
  (`:32`). `allowed_warning` читают: `keepKnownStatus` (`:162`), подписи (`:235`), уровень полосы (`:256`), порог
  Terminal AI (`src/main/terminal-ai/limits-gate.ts:43`).
- Событие Session `rate_limit` несёт `fiveHourUtilization` и `sevenDayUtilization`
  (`src/shared/agent/events.ts:234-241`, перевод `:619-627`); его читает только `observeSessionLimits`
  (`src/main/agent/limits.ts:224-252`); форму держит `test/contract/agent-events.test.ts:110-115`.
- Нейтрального вида окна, который годится Codex и третьему Vendor-у, нет.

## Что делаем

Чистый refactor: Claude ведёт себя так же. Хранимое состояние Claude (`LimitsState`, `limits.json`) и все его
читатели не меняются; новое — нейтральный вид поверх него.

1. `LimitWindow` в `src/shared/agent/limits.ts`: `vendor`, необязательный `provider`, `id`, `label`,
   `usedPercent` (0..100 или `null` — не известно), `windowMinutes` (или `null`), `resetsAt` (Unix seconds или
   `null`), `state` — `ok`, `warning`, `reached` или `null` (не сказано); рядом — `receivedAt` и `source`.
2. `limitWindows(vendor, state)` — список окон Vendor-а из хранимого состояния. Claude: `five_hour` — 300 минут,
   `seven_day` — 10080, прочие окна SDK (`seven_day_opus`) — длительность из имени или `null`; `utilization × 100`;
   `allowed` → `ok`, `allowed_warning` → `warning`, `rejected` → `reached`.
3. События модели вместо `rate_limit`: `limits` (`vendor`, `windows: LimitWindow[]`) и `limit_reached` (`vendor`,
   `windowId` или `null`, `resetsAt` или `null`, `reason` — `window` или `quota`). Перевод Claude даёт `limits` на
   каждый `rate_limit_event` и ещё `limit_reached` при `rejected`. `observeSessionLimits` строит из них тот же
   `SessionLimitsStatus`, что и раньше (`status` Claude возвращается из `state`), — `limits-wait.ts` не меняется.
4. Не меняются: budget, прогноз, `resume-at`, `limits-gate`, LimitsMeter, Journal (`journalLimits`,
   `src/shared/autopilot/journal.ts:473-482`, и формат строки `limits`), свежесть пробы
   (`src/main/agent/limits-usage.ts:163-169`). Они читают хранимое состояние Claude; на `limitWindows` их переводят
   Ticket-ы 26 (панель) и 38 (Autopilot и Resource Planner).

Глубина review — `high` (граница, соглашения spec-а).

## Готово, когда

- [ ] Unit test `limitWindows`: каждое из трёх значений статуса Claude даёт свой `state`; `allowed_warning` →
      `warning`; доля 0.62 → 62; неизвестная доля → `null`.
- [ ] Unit test перевода: записанный `rate_limit_event` даёт `limits` с двумя окнами; `rejected` — ещё
      `limit_reached`. Изменённая форма ожидания в `test/contract/agent-events.test.ts:110-115` названа в PR.
- [ ] `test/unit/terminal-ai-limits-gate.test.ts` (в том числе случай `allowed_warning`, `:28-32`), test-ы budget,
      `resume-at`, `limits-estimate`, LimitsMeter, `limits-wait` и Journal проходят без правок.
- [ ] Contract test `observeSessionLimits`: те же `SessionLimitsStatus` из новых событий, что из `rate_limit` раньше.
- [ ] `pnpm typecheck`, `pnpm lint` и все unit и contract test-ы модулей Limits, Autopilot и Terminal AI — exit 0.

## Где в коде

- `src/shared/agent/limits.ts` — новые `LimitWindow`, `limitWindows` (рядом с `:24-54`)
- `src/shared/agent/events.ts` — `:234-241`, `:360-364`, `:619-627`
- `src/main/agent/limits.ts` — `:224-252` (`SessionLimitsStatus`, `observeSessionLimits`)
- Test-ы: `test/unit/limits.test.ts`, `test/contract/limits.test.ts`, `test/contract/agent-events.test.ts:110-115`

Только читать (не меняются, причина — п. 4): `src/shared/autopilot/journal.ts:473-482`,
`src/main/agent/limits-usage.ts:163-169`, `src/main/terminal-ai/limits-gate.ts:43`,
`src/main/autopilot/limits-wait.ts:121`, `src/shared/autopilot/budget.ts:172-181`.
