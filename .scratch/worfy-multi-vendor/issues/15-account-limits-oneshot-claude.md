# 15 — account, limits и oneShot Claude через driver

Type: task
Status: open
Blocked by: 11, 13
Source: [spec.md](../spec.md), «Модель» (таблица частей), «Решено без владельца», п. 6; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), части account, limits, oneShot); [ADR-0009](../../../docs/adr/0009-claude-code-login-check-account-info.md)

## Что происходит

- Проверка входа — `accountInfo()` процесса Claude Code без prompt-а (`src/main/ipc/first-run.ts:59-71`, путь SDK
  `:43`); план для Settings → Plan — `askSignedInAccount` (`:105`) и `src/main/ipc/plan-preset.ts:4`, `:48`.
- Черновик профиля Project — свой `query()` SDK (`src/main/ipc/projects.ts:89-105`) с read-only tool-ами и
  structured output (`src/main/projects/connect.ts:54`, `:92`, `:590-600`).
- Проба Limits — `query()` с методом `usage` (`src/main/agent/limits-usage.ts:177-215`, загрузка SDK `:281`).

## Что делаем

1. `src/main/vendors/account.ts` — `check()` → `{signedIn, email, plan}`, `startLogin()`; Claude
   (`src/main/vendors/claude/account.ts`) отвечает через `accountInfo()` как сейчас; `startLogin` Claude — нынешний
   путь входа first-run.
2. `src/main/vendors/limits.ts` — `read()` → `LimitWindow[]`; Claude (`claude/limits.ts`) — проба `usage` из
   `limits-usage.ts`; расписание опроса (`LimitsRefresher`) остаётся в `src/main/agent/limits-usage.ts` и зовёт
   driver.
3. `src/main/vendors/one-shot.ts` — `oneShot(prompt, opts)`; Claude (`claude/one-shot.ts`) — нынешний `query()`
   черновика. Опции черновика (read-only tool-ы, structured output) передаются через `opts` — так он работает
   сейчас (`connect.ts:598-600`).
4. first-run, Plan, черновик и проба Limits зовут driver; импорты SDK из этих файлов уходят.

Глубина review — `high` (граница).

## Готово, когда

- [ ] Test-ы first-run, Plan, черновика профиля и пробы Limits проходят без правок ожиданий.
- [ ] В `first-run.ts`, `projects.ts`, `connect.ts`, `limits-usage.ts` нет импорта SDK.
- [ ] `pnpm typecheck`, `pnpm lint`, unit и contract test-ы этих модулей — exit 0.

## Где в коде

- `src/main/vendors/account.ts`, `limits.ts`, `one-shot.ts`; `src/main/vendors/claude/account.ts`, `limits.ts`,
  `one-shot.ts`
- `src/main/ipc/first-run.ts` — `:43`, `:59-71`, `:105`, `:117`
- `src/main/ipc/plan-preset.ts` — `:4`, `:48-55`
- `src/main/ipc/projects.ts` — `:89-115`
- `src/main/projects/connect.ts` — `:37`, `:54-92`, `:590-613`
- `src/main/agent/limits-usage.ts` — `:177-215`, `:233`, `:267-281`
- Test-ы: `test/contract/first-run-checks.test.ts`, `test/contract/projects-connect.test.ts`,
  `test/unit/limits-usage.test.ts`
