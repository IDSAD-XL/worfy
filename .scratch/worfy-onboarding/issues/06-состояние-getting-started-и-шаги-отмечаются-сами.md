# 06 — Состояние Getting started и шаги, которые отмечаются сами

Type: task
Status: open
Blocked by: 02, 05
Source: решения владельца 2026-10-26, пункты 2 (шесть шагов отмечаются сами; пропуск; ничего не блокирует), 3 (существующий пользователь — раздел сам не открывается); [spec.md](../spec.md), «Как устроено», «Решено без владельца», Р2, Р3, Р7 (решено без владельца, подтверждено владельцем 2026-10-26)

## Что происходит

- После Ticket-а 05 есть файл `getting-started.json` (`src/main/getting-started/state.ts`) с записью
  `demo`, и домен IPC `gettingStarted`. Шагов, видимости раздела и деления на нового и существующего
  пользователя нет.
- Факты для шагов уже есть в main:
  - отчёт First run — `remember` (`src/main/ipc/first-run.ts:178-182`), его зовут `firstRun.startup`,
    `firstRun.checks` и `firstRun.run`; проверки и их id — `src/main/first-run/checks.ts:302-323`;
  - конец хода Session — событие `result` (`src/shared/agent/events.ts:235-245`); Orchestrator-ы
    Project-ов — `src/main/agent/orchestrator.ts` (`Orchestrators`, `:180`);
  - Stage-ы Ticket-ов — `StageHub` (`src/main/workflow/stages.ts:336`, `open` `:342`; экземпляр
    приложения — `stageHub`, `src/main/ipc/pipeline.ts:36`). После Ticket-а 02 у demo есть Stage-ы
    Implementing, Agent review и `rework`.
  - Status Ticket-а — модель workflow (`src/main/workflow/watch.ts`).
- В e2e First run сам не открывается (`WORFY_FIRST_RUN_AUTO=0`, `test/e2e/launch-env.ts:93`). Для
  Getting started такой переменной нет.

## Что делаем

1. `state.ts`: схема файла дополняется полями `user: 'new' | 'existing'`, `section: 'shown' | 'hidden'`,
   `steps: { [1..6]: ISO-время }`, `reworkSeen: boolean`, `noticeShown: boolean`. Битый файл — в
   сторону и пустое состояние (как `readJsonFile`, `src/main/storage/json-file.ts`).
2. Первое чтение без файла (Р7): Project-ы в списке есть (кроме demo) → `existing`, раздел `hidden`;
   нет → `new`, раздел `shown`. Потом не пересчитывается.
3. `src/main/getting-started/progress.ts` (новый) отмечает шаги по фактам (Р2, Р3):
   1. отчёт First run без `fail` у проверок списка Р2 (на Windows — со своими проверками);
   2. запись `demo` есть и Project в списке;
   3. первый `result` Session Orchestrator-а demo;
   4. Ticket `todo` 01 впервые на Stage после Implementing;
   5. Stage Agent review пройден; `rework: true`, увиденный хоть раз, ставит `reworkSeen`;
   6. Status Ticket-а `done`.
   Отмеченный шаг не снимается; шаги отмечаются в любом порядке. Подписка на Stage-ы demo открыта,
   пока есть запись `demo`; пропал Project — подписка закрыта, шаги остаются.
4. Каналы: `gettingStarted.state` (снимок), событие `gettingStarted.changed`, `gettingStarted.setSection
   { section }` (Skip и Command palette, Ticket 07), `gettingStarted.noticeSeen` (уведомление
   существующему пользователю, Ticket 08 — ставит `noticeShown`). Все `local`.
5. `WORFY_GETTING_STARTED_AUTO=0` — раздел не показывается сам (состояние `hidden` при первом
   чтении); по умолчанию `0` в `test/e2e/launch-env.ts`.

## Готово, когда

- [ ] Unit test `progress`: отчёт с `fail` у `gh` и `qmd` — шаг 1 отмечен; с `fail` у `git-identity` —
      нет; на Windows `fail` у `git-bash` — нет.
- [ ] Unit test: снимки Stage-ей Implementing → Agent review → Implementing (`rework`) → Gate & merge →
      Done дают шаги 4, 5, 6 и `reworkSeen`; без `rework` — шаг 5 и `reworkSeen: false`.
- [ ] Unit test: конец первого хода Orchestrator-а demo — шаг 3; ход Orchestrator-а другого Project-а
      — нет.
- [ ] Contract test состояния: нет файла и один Project в списке — `existing`, `hidden`; пустой список
      — `new`, `shown`; повторное чтение не пересчитывает; битый файл — пустое состояние, файл в
      стороне.
- [ ] Отмеченный шаг остаётся после перезапуска (contract test: запись, новое чтение).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Unit `test/unit/getting-started-progress.test.ts` (новый): `progress` с подменёнными источниками —
  отчёт, события Session, снимки Stage-ей, модель workflow.
- Contract `test/contract/getting-started-state.test.ts` (новый): файл во временной папке данных.
- Сначала падающий: снимок с Agent review — шаг 4 не отмечен.

## Где в коде

- `src/main/getting-started/state.ts`
- `src/main/getting-started/progress.ts` (новый)
- `src/shared/ipc/getting-started.ts`, `src/main/ipc/getting-started.ts`
- `src/main/ipc/first-run.ts` (`remember`, `:178-182` — слушатель отчёта)
- `test/unit/getting-started-progress.test.ts` (новый)
- `test/contract/getting-started-state.test.ts` (новый)
- `test/e2e/launch-env.ts` (`:93`)

Только читать: `src/main/ipc/pipeline.ts`, `src/main/workflow/stages.ts`, `src/main/agent/orchestrator.ts`,
`src/shared/agent/events.ts`, `src/main/first-run/checks.ts`.

## Итог

Заполняется при закрытии.
