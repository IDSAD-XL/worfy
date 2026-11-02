# 21 — Account и Limits Codex

Type: task
Status: done 2026-11-02T23:08Z
PR: #1259
Blocked by: 11, 15, 19
Source: [spec.md](../spec.md), «Модель» (LimitWindow), «Риски», п. 5 и 6; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), части account и limits); решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md)); Ticket 03 ([03-codex-limits.md](03-codex-limits.md)); [ADR-0009](../../../docs/adr/0009-claude-code-login-check-account-info.md)

## Что делаем

Правятся только файлы частей `codex/account.ts` и `codex/limits.ts` (stub-и Ticket-а 17); `index.ts` — нет.

1. `src/main/vendors/codex/account.ts`: `check()` — `account/read` → одно подключение `{provider: 'openai', signedIn, email, plan}`; нет бинарника или
   аккаунта — `signedIn: false` без исключения. `startLogin()` — `account/login/start {type: "chatgpt"}` →
   `{kind: 'url', url: authUrl}`; worfy открывает его в браузере и ждёт `account/login/completed`. Вход по `apiKey` worfy не предлагает. Токены
   хранит Codex (ADR-0009).
2. `src/main/vendors/codex/limits.ts`: `read()` — `account/rateLimits/read` (с `excludeResetCreditDetails` для
   фонового опроса); notification `account/rateLimits/updated` → событие `limits`. Окна `primary` и `secondary` →
   `LimitWindow` (`vendor: 'codex'`, `id` — `primary` / `secondary`, `windowMinutes` — `windowDurationMins`,
   `usedPercent`, `resetsAt`), подпись по длительности: `5h`, `daily`, `weekly`, `monthly`. `state`: `reached` —
   `rateLimitReachedType` не `null` или `usedPercent >= 100`; иначе `ok` (порога `warning` Codex не присылает).
   Хранение — состояние Limits Codex рядом с состоянием Claude в `LimitsTracker` (`src/main/agent/limits.ts:58`).
3. Ошибка хода с `codexErrorInfo: "usageLimitExceeded"` → событие `limit_reached` (Ticket 11): окно на 100 % с
   `resetsAt` — `reason: 'window'` (можно ждать); без такого окна (план не включает Codex или квота) —
   `reason: 'quota'`, ждать нечего. Перед ожиданием — повторный
   `account/rateLimits/read` и `ordinaryUsageAllowed`.
4. Опрос Limits Codex идёт тем же `LimitsRefresher` (`src/main/agent/limits-usage.ts`), что и у Claude, только при
   входе в Codex.
   Учесть: `LimitsRefresher` читает `claudeUsageReader` напрямую, а не `limits.read()` driver-а: `LimitWindow`
   теряет точность и статус ответа. У `limits.read()` Claude нет сигнала отмены (`src/main/vendors/claude/limits.ts`;
   ревью Ticket-а 15). Опрос Codex через тот же refresher должен это учесть.

Глубина review — `high` (driver Codex).

## Готово, когда

- [ ] Contract test на фейке: `account-plus` — два окна, `account-pro` — одно недельное, `signed-out` — нет входа без
      ошибки, `login` — вход завершён после открытия URL (открытие подменено).
- [ ] Unit test: `usage-limit-window` — случай «ждать до `resetsAt`»; `usage-limit-quota` — случай «ждать нечего».
- [ ] Unit test подписей окон по длительности.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/vendors/codex/account.ts`, `limits.ts` (stub-и Ticket-а 17 заменяются)
- `src/main/agent/limits.ts` — `:58` (состояние Codex рядом с Claude)
- `src/main/agent/limits-usage.ts` — `:75` (`LimitsRefresher`: опрос по Vendor-ам)
- `test/unit/codex-limits.test.ts`, `test/contract/codex-account.test.ts` (новые)

Только читать: `src/shared/agent/limits.ts` (после Ticket-а 11), `src/main/vendors/claude/limits.ts` (Ticket 15).

## Итог

- `src/main/vendors/codex/account.ts` — часть account driver-а Codex. Каждый запрос — свой короткоживущий
  `codex app-server` (`app-server.ts`, Ticket 19) в папке worfy `<WORFY_DATA_DIR>/terminal-ai`, закрывается после ответа.
  - `check(signal)` — `account/read {refreshToken: false}` → одно подключение `{provider: 'openai', signedIn, email, plan}`.
    Вход считается только ChatGPT (`account.type === 'chatgpt'`); `apiKey`, `amazonBedrock`, `gcp` — «не вошёл»
    (spec: «Никогда — всё, что требует API-ключа»; решено без владельца, подтвердить).
  - Нет папки Codex (`CODEX_HOME`, иначе `~/.codex`) — «не вошёл», процесс не запускается: так опрос не создаёт
    `~/.codex` у того, кто Codex не ставил. App-server не запустился (нет Codex для платформы) — «не вошёл» без
    исключения, одна строка debug. App-server запустился, но не ответил — отказ.
  - `startLogin()` — `account/read` (уже вошёл — отказ без нового входа), `account/login/start {type: "chatgpt"}`,
    страница `authUrl` открывается через подменяемый `openUrl` (в приложении — `shell.openExternal`), затем ожидание
    `account/login/completed` своего `loginId` и `account/read`. `cancel()` шлёт `account/login/cancel`; выход процесса,
    отказ входа и 10 минут без завершения тоже заканчивают попытку; процесс закрывается в любом случае. Вход по
    `apiKey` worfy не предлагает. Токены хранит Codex (ADR-0009).
- `src/main/vendors/codex/limits.ts` — часть limits.
  - Окна `primary` / `secondary` → `LimitWindow` (`vendor: 'codex'`, `windowMinutes` из `windowDurationMins`); подпись —
    как у TUI Codex v0.166.0 (`get_limits_duration`): длительность в пределах 5 % от 5 ч, суток, недели, 30 дней, года —
    `5h`, `daily`, `weekly`, `monthly`, `annual`; иначе `usage` / `secondary usage`.
  - `state`: `reached` — `rateLimitReachedType` не `null` или `usedPercent >= 100`, иначе `ok`.
  - `codexLimitsEvent` — notification `account/rateLimits/updated` → событие `limits`.
  - `codexLimitReachedEvent` — `error` с `usageLimitExceeded` → `limit_reached`: сначала повторный
    `account/rateLimits/read`, при его отказе решают последние окна Session. Окно на 100 % с `resetsAt` — `window`
    (из нескольких — то, что сбрасывается позже), иначе `quota`. `ordinaryUsageAllowed` отдаётся вызывающему.
  - `read()` — `account/rateLimits/read {}`; `poll(signal)` — `account/read`, и только при входе
    `account/rateLimits/read {excludeResetCreditDetails: true}`; не вошёл — `null`.
- `src/main/agent/limits.ts` — `LimitsTracker` хранит окна других Vendor-ов рядом с состоянием Claude: `setWindows`,
  `windowsOf`, `subscribeWindows`; только в памяти, `limits.json` остаётся в форме Claude.
- `src/main/agent/limits-usage.ts` — `LimitsRefresher` опрашивает `vendors` (в приложении — Codex) при старте и каждые
  30 минут, по одному опросу на Vendor; `null` — окна Vendor-а забываются; отказ — одна строка лога, окна остаются.
  Опрос получает тот же сигнал, что и запрос Claude: `stop()` закрывает процесс Codex и не ждёт ответа. Путь Claude
  не менялся (долг Ticket-а 15 учтён: опрос Codex отменяемый, а не через `limits.read()` без сигнала).
- Test-ы: `test/contract/codex-account.test.ts` (фейк: `account-plus`, `account-pro`, `signed-out`, `login`,
  `limits-two-windows`; концы входа на stand-in app-server-е; ADR-0005 — ни `CODEX_HOME`, ни папка процесса не
  меняются), `test/unit/codex-limits.test.ts` (подписи, окна, `usage-limit-window` — ждать до `resetsAt`,
  `usage-limit-quota` — ждать нечего), новые случаи в `test/unit/limits-usage.test.ts` и `test/contract/limits.test.ts`.
  Сценарии фейка не добавлялись.
- Не сделано здесь: вызов `codexLimitReachedEvent` и `codexLimitsEvent` из Session Codex — это `session.ts`
  (Ticket 20), запись `limits` Session-ов Codex в `LimitsTracker` и показ — Ticket 26.
