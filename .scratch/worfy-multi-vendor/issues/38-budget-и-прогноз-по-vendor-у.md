# 38 — Budget, прогноз и остановка по Limits Vendor-а

Type: task
Status: open
Blocked by: 37
Source: [spec.md](../spec.md), «Решено без владельца», п. 4, «Риски», п. 5 и 6; решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md)); Ticket 03 ([03-codex-limits.md](03-codex-limits.md), «Когда лимит кончился», «Хватит ли данных»); [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md)

## Что происходит

- Budget — по окну `seven_day` (`src/shared/autopilot/budget.ts:172-181`); оценка Wave и прогноз Epic-а — рост
  `seven_day` (`limits-estimate.ts:26-32`, `:129`; `forecast.ts`); ожидание сброса — `resume-at.ts`,
  `src/main/autopilot/limits-wait.ts`; строка `limits` Journal — `{five_hour, seven_day}` (`journal.ts:351`).

## Что делаем

1. Budget и прогноз берут окна Vendor-а Orchestrator-а Run (поле `vendor` из Ticket-а 37). Claude — как сейчас.
   Codex — самое длинное из пришедших окон; калибровка — процент за Wave; до 5 выборок — «мало данных», и строки
   прогноза Codex помечены широкой неопределённостью.
2. `usageLimitExceeded` Codex: окно на 100 % с `resetsAt` — Wait `limits` до сброса и повторный
   `account/rateLimits/read`, как у Claude; без такого окна — остановка Run с новой причиной `vendor-quota` и текстом
   ошибки, без ожидания.
3. Journal: строка `limits` Run-а на Codex — `{windows: LimitWindow[]}`; старые строки читаются как раньше
   (Flight Recorder и `limits-estimate` понимают оба вида).

Глубина review — `high` (budget и остановка Run).

## Готово, когда

- [ ] Unit test budget и прогноза Codex: одно недельное окно (Pro), два окна (Plus); выборки по Wave.
- [ ] Unit test: `usage-limit-window` — ожидание до `resetsAt`; `usage-limit-quota` — остановка `vendor-quota`.
- [ ] Unit test Journal: старая строка `limits` и новая читаются; test-ы Claude без правок ожиданий.
- [ ] Все unit и contract test-ы модуля Autopilot, `pnpm typecheck`, `pnpm lint` — exit 0.

## Где в коде

- `src/shared/autopilot/budget.ts` — `:101`, `:172-181`
- `src/shared/autopilot/resume-at.ts`, `limits-estimate.ts`, `forecast.ts`, `journal.ts` — `:143`, `:351`, `:479`
- `src/main/autopilot/run.ts`, `src/main/autopilot/limits-wait.ts`
- Test-ы: `test/unit/autopilot-budget.test.ts`, `test/unit/autopilot-resume-at.test.ts`,
  `test/unit/autopilot-limits-estimate.test.ts`, `test/contract/autopilot-limits.test.ts`
