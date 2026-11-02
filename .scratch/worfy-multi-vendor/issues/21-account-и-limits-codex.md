# 21 — Account и Limits Codex

Type: task
Status: open
Blocked by: 11, 15, 19
Source: [spec.md](../spec.md), «Модель» (LimitWindow), «Риски», п. 5 и 6; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), части account и limits); решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md)); Ticket 03 ([03-codex-limits.md](03-codex-limits.md)); [ADR-0009](../../../docs/adr/0009-claude-code-login-check-account-info.md)

## Что делаем

1. `src/main/vendors/codex/account.ts`: `check()` — `account/read` → вход, email, `planType`; нет бинарника или
   аккаунта — `signedIn: false` без исключения. `startLogin()` — `account/login/start {type: "chatgpt"}`, worfy
   открывает `authUrl` в браузере и ждёт `account/login/completed`. Вход по `apiKey` worfy не предлагает. Токены
   хранит Codex (ADR-0009).
2. `src/main/vendors/codex/limits.ts`: `read()` — `account/rateLimits/read` (с `excludeResetCreditDetails` для
   фонового опроса); notification `account/rateLimits/updated` → событие `limits`. Окна `primary` и `secondary` →
   `LimitWindow` (`vendor: 'codex'`, `id` — `primary` / `secondary`, `windowMinutes` — `windowDurationMins`,
   `usedPercent`, `resetsAt`), подпись по длительности: `5h`, `daily`, `weekly`, `monthly`. `reached` —
   `rateLimitReachedType` не `null` или `usedPercent >= 100`.
3. Ошибка хода с `codexErrorInfo: "usageLimitExceeded"` → событие с двумя случаями: окно на 100 % с `resetsAt`
   (можно ждать) и без такого окна (план не включает Codex или квота — ждать нечего). Перед ожиданием — повторный
   `account/rateLimits/read` и `ordinaryUsageAllowed`.
4. Опрос Limits Codex идёт тем же `LimitsRefresher` (`src/main/agent/limits-usage.ts`), что и у Claude, только при
   входе в Codex.

Глубина review — `high` (driver Codex).

## Готово, когда

- [ ] Contract test на фейке: `account-plus` — два окна, `account-pro` — одно недельное, `signed-out` — нет входа без
      ошибки, `login` — вход завершён после открытия URL (открытие подменено).
- [ ] Unit test: `usage-limit-window` — случай «ждать до `resetsAt`»; `usage-limit-quota` — случай «ждать нечего».
- [ ] Unit test подписей окон по длительности.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/vendors/codex/account.ts`, `limits.ts` (новые)
- `src/main/vendors/codex/index.ts` — части account и limits
- `src/main/agent/limits-usage.ts` — `:75` (`LimitsRefresher`: опрос по Vendor-ам)
- `test/unit/codex-limits.test.ts`, `test/contract/codex-account.test.ts` (новые)

Только читать: `src/shared/agent/limits.ts` (после Ticket-а 11), `src/main/vendors/claude/limits.ts` (Ticket 15).
