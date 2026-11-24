# 03 — Модель Health check: статус `unknown`, уровень строки, строки Project-а, сообщения фич о сбоях

Type: task
Status: done 2026-11-18T20:49Z
PR: #2018
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 3; «Решение», пункты 1, 2 и 4; «Уровни: проверка → уровень»; «Когда
проверять»; «Решения по реализации», 1; «Решения по test-ам»; «Решения владельца», Q2, Q4, Q7, Q8;
[critic 2026-11-18](../../../docs/product/critic/worfy-auth-check-2026-11-18.md), возражение 2 (`opensFirstRun`)

Кто: агент.

Не платформенный Ticket (схема в `src/shared` и main process, без веток по платформе). Глубина ревью — `medium`.

## Что происходит

- Строки Health check — `CHECKS` (`src/main/first-run/checks.ts:208-228`), статус `ok | warn | fail`
  (`src/shared/ipc/first-run.ts:12`), ids строк — `checkIdSchema` (`first-run.ts:15-41`), ids кнопок —
  `firstRunActionSchema` (`:52`), группы — `checkGroupSchema` (`:55`), поля строки — `checkSchema` (`:58-76`). Уровня
  строки нет; строк Project-а нет: Health check описывает только Machine. Connected Project-ы с Profile-ами уже
  приходят в проверки (`CheckDeps.projects`, `checks.ts:122`; `ProjectProfile` — `:87-94`).
- First run открывается сам при старте на новой строке в `fail`, если у неё не `opensFirstRun: false`
  (`src/main/ipc/first-run.ts:215`; поле — `src/shared/ipc/first-run.ts:71-75`). Отчёт для этого решения строится
  целиком до ответа (`ipc/first-run.ts:214`): сетевая строка задержала бы старт.
- Фичи сообщают о сбое входа только в log (spec, «Проблема»). Общего места, куда фича пишет «у меня сбой» и «снова
  работает», нет.

## Что делаем

1. `src/shared/ipc/first-run.ts`:
   - `checkStatusSchema` — плюс `unknown` (проверить не удалось: нет сети, timeout, GitHub 5xx);
   - поле `severity: 'critical' | 'non-critical'` у строки;
   - поле `project?: { id, name }` у строки Project-а; группа `Projects` в `checkGroupSchema`;
   - новые ids строк этого Epic-а сразу: GitHub access Project-а, вход Codex, Browser profile, Linked machine (имена —
     на выбор Ticket-а, например `github-access`, `codex-login`, `browser-profile`, `linked-machine`);
   - новые ids кнопок сразу: «Use <login>», Open link (SSO), «Sign in to Codex…», «Open Browser», «Link a machine…»;
     у кнопки — пометка `safe?: true`;
   - выводимое состояние строки — функция рядом со схемой: `ok`; `unknown`; есть кнопка `safe` — `fixable`; иначе
     `needs-user`.
2. `src/shared/health/severity.ts` (новый): таблица уровней spec-а — одна функция со всеми ids этого Epic-а. `gh` и
   `gh-auth` — critical только при Project-е с origin на GitHub; GitHub access — critical, кроме случая «`github.account`
   пуст, а токен окружения работает» (non-critical); `unknown` никогда не critical. Ticket-ы 05, 06 и 08 её не правят.
   Рядом — чистая функция худшего уровня для иконки: `critical` / `non-critical` / `ok` / `pending` (первого отчёта
   нет или идёт «Check again»).
3. `src/main/first-run/health-reports.ts` (новый):
   - `reportFailure(id, project?, reason, step)` и `reportOk(id, project?)` для фич; хранит последнее сообщение на пару
     (id, Project);
   - отчёт Health check сливает строки проверок и сообщения: сообщение о сбое ставит строку не в `ok` сразу, без
     запроса в сеть; `reportOk` снимает её без проверки;
   - после сообщения о сбое — одна повторная проверка строки этого Project-а, не чаще раза в минуту на Project
     (callback регистрирует Ticket строки, например 05);
   - событие в renderer при каждом изменении отчёта (новый event-канал рядом с `firstRunChecks`,
     `src/shared/ipc/first-run.ts:108`).
4. Когда проверять (Q8): при фокусе окна worfy — только строки не в `ok`, если последней проверке больше 5 минут.
   Таймера и опроса сети нет.
5. `opensFirstRun: false` у всех строк Project-а и у всех строк из сообщений фич (Q7). Сетевые строки (`gh api` на
   repo) в отчёт, по которому `firstRunStartup` решает открыть First run (`ipc/first-run.ts:206-216`), не входят: они
   дописываются после, и старт не ждёт сети.
6. Старые строки получают `severity` из таблицы; вид в renderer не меняется до Ticket-а 04.

## Готово, когда

- [ ] Unit test (новый `test/unit/health-severity.test.ts`): каждая строка таблицы spec-а; `gh` и `gh-auth` с Project-ом
      на GitHub и без; `unknown` — никогда не critical; худший уровень: critical, non-critical, ok, pending.
  - evidence: test-run pass · `pnpm test test/unit/health-severity.test.ts` exit 0 · mac - · cccc3c6f2322f41b6767a3dfd7699c1ea8b46a5f
  - evidence: review pass · PR #2018 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test: выводимое состояние — `safe` кнопка даёт `fixable`, кнопка без `safe` и строка без кнопки —
      `needs-user`.
  - evidence: test-run pass · `pnpm test test/unit/health-severity.test.ts` exit 0 · mac - · cccc3c6f2322f41b6767a3dfd7699c1ea8b46a5f
  - evidence: review pass · PR #2018 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test (новый `test/contract/health-reports.test.ts`): `reportFailure` меняет отчёт и шлёт событие без
      запроса в сеть; `reportOk` снимает строку; повторная проверка — не чаще раза в минуту на Project; при фокусе
      проверяются только строки не в `ok` и старше 5 минут.
  - evidence: test-run pass · `pnpm test test/contract/health-reports.test.ts` exit 0 · mac - · cccc3c6f2322f41b6767a3dfd7699c1ea8b46a5f
  - evidence: test-run pass · `pnpm test test/contract/health-reports.test.ts` exit 0 · mac - · 72cb9b123d1c48b0d8164ec1d52bb48efee7989f
  - evidence: review pass · PR #2018 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test (`test/contract/first-run-checks.test.ts`): строка Project-а и строка из сообщения в `fail` не
      открывают First run при старте; сетевая строка не входит в отчёт решения о старте.
  - evidence: test-run pass · `pnpm test test/contract/first-run-checks.test.ts` exit 0 · mac - · cccc3c6f2322f41b6767a3dfd7699c1ea8b46a5f
  - evidence: review pass · PR #2018 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Test, что значение токена не попадает в отчёт и log: сообщение с известным токеном в `reason` — test ищет его во
      всём выводе (`reason` и `step` фичи не должны его нести; модуль не печатает их в log).
  - evidence: test-run pass · `pnpm test test/contract/health-reports.test.ts` exit 0 · mac - · cccc3c6f2322f41b6767a3dfd7699c1ea8b46a5f
  - evidence: test-run pass · `pnpm test test/contract/health-reports.test.ts` exit 0 · mac - · 72cb9b123d1c48b0d8164ec1d52bb48efee7989f
  - evidence: review pass · PR #2018 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Все unit и contract test-ы модуля зелёные: `test/contract/first-run-checks.test.ts`,
      `test/unit/first-run-dialog.test.tsx`, `test/unit/first-run-concepts.test.tsx`, `test/unit/first-run-windows.test.ts`,
      `test/unit/settings-health.test.tsx`.
  - evidence: test-run pass · `pnpm test test/contract/first-run-checks.test.ts test/unit/first-run-dialog.test.tsx test/unit/first-run-concepts.test.tsx test/unit/first-run-windows.test.ts test/unit/settings-health.test.tsx` exit 0 · mac - · cccc3c6f2322f41b6767a3dfd7699c1ea8b46a5f
  - evidence: test-run pass · `pnpm test test/contract/first-run-checks.test.ts test/unit/first-run-dialog.test.tsx test/unit/first-run-concepts.test.tsx test/unit/first-run-windows.test.ts test/unit/settings-health.test.tsx` exit 0 · mac - · 72cb9b123d1c48b0d8164ec1d52bb48efee7989f
  - evidence: review pass · PR #2018 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · cccc3c6f2322f41b6767a3dfd7699c1ea8b46a5f
  - evidence: gate pass · `gate fast` exit 0 · mac - · 72cb9b123d1c48b0d8164ec1d52bb48efee7989f
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44388883061/job/135120503709 · ci - · 084af085d10f2d26c807e7eda52621ddc68af6f3

## Где в коде

- `src/shared/ipc/first-run.ts`
- `src/shared/health/severity.ts` (новый)
- `src/main/first-run/health-reports.ts` (новый)
- `src/main/first-run/checks.ts` (`severity` у строк)
- `src/main/ipc/first-run.ts` (слияние, решение о старте, событие, фокус окна)
- `test/unit/health-severity.test.ts` (новый), `test/contract/health-reports.test.ts` (новый),
  `test/contract/first-run-checks.test.ts`

## Вне скоупа

- Иконка, порядок строк, кнопка Fix, palette — Ticket 04.
- Сами проверки GitHub access — Ticket 05; сообщения фич — Ticket-ы 07 и 08.
