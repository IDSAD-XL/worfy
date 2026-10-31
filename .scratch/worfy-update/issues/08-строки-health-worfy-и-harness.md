# 08 — Строки Settings → Health: версия worfy и отстающий Harness

Type: task
Status: open
Blocked by: 01, 05
Source: решения владельца 2026-10-31, пункты 5 (красная строка в Settings → Health для обоих сигналов), 8 (недостающие инструменты видны в Health); [spec.md](../spec.md), «Решено без владельца», Р9, «Тексты (черновик)», «Health»

## Что происходит

- Settings → Health — проверки First run (`src/renderer/settings/HealthSection.tsx:11-12`, строки —
  `src/renderer/shell/FirstRunChecks.tsx`). Список проверок и групп — `src/main/first-run/checks.ts:302-323`;
  статусы — `ok`, `warn`, `fail` (`src/shared/ipc/first-run.ts:12`).
- Строка `harness` (`checks.ts:619-644`) для `outdated` — `warn` (`:630-640`).
- First run открывается сам, когда появился `fail`, которого не было при прошлом закрытии
  (`src/main/ipc/first-run.ts:217`).
- После Ticket-ов 01, 03, 05 main знает Available update, сбой сборки с `missing` и `harnessBehind`.

## Что делаем

1. `checks.ts`: новая проверка `worfy-update`, группа «worfy», заголовок «worfy version» — только при
   `updateEnabled` (Ticket 01; в dev-сборке строки нет). Строки — из «Тексты (черновик)»: `ok` без Update;
   `fail` с Available update (без `quiet`); `fail` после сбоя сборки (последняя строка `build.log`,
   действие `update-log` «Show log»); `fail` при `missing` — по инструменту, с командой установки
   (`pnpm` — `npm install -g pnpm`; `git` и `node` — как у их строк, `installCommand`, `:423`).
2. Строка `harness`: `outdated` не `sameVersion` и `harnessBehind` — `fail` (было `warn`), действие —
   прежнее «Update». `sameVersion` без `harnessBehind` — как сейчас `warn` «Replace».
3. `src/main/ipc/first-run.ts:217`: строки `worfy-update` и `harness` в состоянии `outdated` новым `fail`
   не считаются — First run из-за них сам не открывается (Р9). `fail` `harness` с `error` и
   `not-installed` — как сейчас.

## Готово, когда

- [ ] Contract test проверок: без Update — `worfy-update` `ok`; Available update — `fail` с версией;
      `quiet` — `ok`; сбой — `fail` и действие «Show log»; `missing: ['pnpm']` — `fail` с командой.
- [ ] Contract test: dev-сборка без `WORFY_UPDATE=1` — строки `worfy-update` нет.
- [ ] Contract test: Harness `outdated` — `fail`; `sameVersion` без `harnessBehind` — `warn`; с
      `harnessBehind` — `fail`.
- [ ] Contract test `firstRun.startup`: прошлое закрытие без `fail`, теперь `fail` у `worfy-update` и
      у `harness` (`outdated`) — `show: false`; `fail` у `git` — `show: true`.
- [ ] Unit test раздела Health: строка «worfy version» красная, действие «Show log» зовёт `update.showLog`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/first-run-checks.test.ts`: новые строки и правило открытия.
- Unit `test/unit/settings-health.test.tsx`: вид строки и действие.
- Сначала падающий: `fail` у `worfy-update` открывает First run.

## Где в коде

- `src/main/first-run/checks.ts` (`:302-323`, `:619-644`)
- `src/main/ipc/first-run.ts` (`:217`)
- `test/contract/first-run-checks.test.ts`
- `test/unit/settings-health.test.tsx`

Только читать: `src/shared/ipc/first-run.ts`, `src/renderer/shell/FirstRunChecks.tsx`,
`src/main/update/state.ts`.

## Итог

Заполняется при закрытии.
