# 15 — account, limits и oneShot Claude через driver

Type: task
Status: done 2026-11-02T12:25Z
PR: #1242
Blocked by: 11, 13
Source: [spec.md](../spec.md), «Модель» (таблица частей), «Решено без владельца», п. 6; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), части account, limits, oneShot); [ADR-0009](../../../docs/adr/0009-claude-code-login-check-account-info.md)

## Что происходит

- Проверка входа — `accountInfo()` процесса Claude Code без prompt-а (`src/main/ipc/first-run.ts:59-71`, путь SDK
  `:43`); план для Settings → Plan — `askSignedInAccount` (`:105`) и `src/main/ipc/plan-preset.ts:4`, `:48`.
- Черновик профиля Project — свой `query()` SDK (`src/main/ipc/projects.ts:89-105`) с read-only tool-ами и
  structured output (`src/main/projects/connect.ts:54`, `:92`, `:590-600`).
- Limits probe — `query()` с методом `usage` (`src/main/agent/limits-usage.ts:177-215`, загрузка SDK `:281`).

## Что делаем

Типы частей и файлы-обёртки Claude создал Ticket 13; этот Ticket правит только `claude/account.ts`,
`claude/limits.ts`, `claude/one-shot.ts`, тип `src/main/vendors/limits.ts` и их вызывающих, `claude/index.ts` — нет.

1. `account.check()` Claude (`src/main/vendors/claude/account.ts`) — одно подключение `{provider: 'anthropic',
   signedIn, email, plan}` через `accountInfo()`, как сейчас; `startLogin` Claude — нынешний путь входа first-run
   (`{kind: 'terminal'}` или как его делает first-run сейчас — без изменения поведения).
2. `limits.read()` Claude (`claude/limits.ts`) — Limits probe `usage` из `limits-usage.ts`, ответ — через
   `limitWindows` (Ticket 11); расписание опроса (`LimitsRefresher`) остаётся в `src/main/agent/limits-usage.ts` и зовёт
   driver.
3. `oneShot(prompt, opts)` Claude (`claude/one-shot.ts`) — нынешний `query()` черновика. Опции черновика
   передаются через `opts` ровно так, как их передаёт `src/main/ipc/projects.ts:89-105` сейчас: `allowedTools`,
   `disallowedTools`, `outputFormat` и plugin Harness (`connect.ts:598-600`).
4. first-run, Plan, черновик и Limits probe зовут driver; импорты SDK из этих файлов уходят.
5. `src/main/vendors/limits.ts`: копия `LimitWindow` (комментарий `shortcut:`) заменяется импортом из
   `src/shared/agent/limits.ts` (Ticket 11 влит).
6. Правило «Claude вошёл» (`subscriptionType` есть или `tokenSource` не `none`) сейчас в трёх местах:
   `src/main/first-run/checks.ts:308`, `src/main/agent/session.ts:636`, `src/main/vendors/claude/account.ts:12`.
   Ticket оставляет одно — в `claude/account.ts`; `checks.ts` зовёт его. `session.ts` — файл Ticket-а 14 той же Wave,
   его копию убирает Ticket 16 (ждёт 14 и 15). Решено Orchestrator-ом 2026-11-02 по поручению владельца, подтвердить
   при приёмке.

Глубина review — `high` (граница).

## Готово, когда

- [ ] Regression test: `oneShot` Claude для черновика передаёт в `query()` те же `allowedTools`, `disallowedTools`,
      `outputFormat` и plugin Harness, что `sdkDraftQuery` до переноса (снимок опций до и после совпадает).
- [ ] Test-ы first-run, Plan, черновика профиля и Limits probe проходят без правок ожиданий.
- [ ] В `first-run.ts`, `projects.ts`, `connect.ts`, `limits-usage.ts` нет импорта SDK.
- [ ] `pnpm typecheck`, `pnpm lint`, unit и contract test-ы этих модулей — exit 0.

## Где в коде

- `src/main/vendors/claude/account.ts`, `limits.ts`, `one-shot.ts` (файлы Ticket-а 13)
- `src/main/vendors/limits.ts` — копия `LimitWindow` → импорт из `src/shared/agent/limits.ts`
- `src/main/first-run/checks.ts` — `:306-308` (правило входа Claude)
- `src/main/ipc/first-run.ts` — `:43`, `:59-71`, `:105`, `:117`
- `src/main/ipc/plan-preset.ts` — `:4`, `:48-55`
- `src/main/ipc/projects.ts` — `:89-115`
- `src/main/projects/connect.ts` — `:37`, `:54-92`, `:590-613`
- `src/main/agent/limits-usage.ts` — `:177-215`, `:233`, `:267-281`
- Test-ы: `test/contract/first-run-checks.test.ts`, `test/contract/projects-connect.test.ts`,
  `test/unit/limits-usage.test.ts`, `test/contract/claude-one-shot.test.ts` (новый)

## Итог

PR #1242. Поведение first-run, Settings → Plan, черновика профиля и Limits probe не изменилось; они зовут
части `account`, `limits` и `oneShot` driver-а Claude.

Долг:

- Черновик профиля Project ещё не стоит на нейтральном `vendorDriver('claude').oneShot`: он запускает Claude Code
  через `claudeOneShotQuery` (свои `allowedTools`, `disallowedTools`, `outputFormat`, `canUseTool` и Stop по
  `draftId`), а ответ SDK читает общим `readOneShot` driver-а (`src/main/vendors/claude/one-shot.ts`) — тем же,
  что и `claudeOneShot`, со своими текстами ошибок. Перевод черновика на нейтральный `oneShot` делает Ticket 23.

Ревью — комментарии PR #1242: раунд 1 — REJECTED, раунд 2 — VERIFIED.

- Долг (low): `src/main/projects/connect.ts:570` — проверку «черновик остановлен после чтения ответа» не покрывает
  test (mutant выживает).
- Долг (low): `src/main/vendors/claude/one-shot.ts:135` — проверку `subtype` в `readOneShot` не закрепляет test: ни
  один test не подаёт result с ошибочным `subtype`, но с `structured_output`, и без проверки такой ответ был бы
  принят.
- Consider (low): `LimitsRefresher` читает `claudeUsageReader` напрямую; у `limits.read()` нет вызывающих, и его
  запрос нельзя прервать (`src/main/vendors/claude/limits.ts:154-157`). Ticket 21 учитывает это.
- Consider (low): `oneMessage()` отдаёт `connect.ts` тип SDK `SDKUserMessage` (`src/main/vendors/claude/one-shot.ts`);
  `vendor-sdk-imports.test.ts` сигнатуры не проверяет.
- Consider (low): нейтральный `claudeOneShot` сообщает activity черновика «The draft is ready».
- Consider (low): `claudeOneShot` теряет отмену, пришедшую, пока стартует `claudeOneShotQuery`: listener
  добавляется после `await`, `signal.aborted` заново не проверяется.
- Принято: 13 выживших mutant-ов low (хвост stderr, тексты ошибок, `removeEventListener` / `clearTimeout`, путь к
  исполняемому файлу в собранном приложении); `checks()` first-run берёт у driver-а только правило входа и версию, а
  не `account.check()`.
