# 09 — Уведомление «ждёт тебя» следит за моделью workflow, а не за снимками Stage: без опроса gh, git и `bin/profile`

Type: task
Status: open
Blocked by: —
Source: follow-up Ticket-а 06 (PR #501); решение владельца 2026-10-19, Q-c: #501 влит как есть, это — отдельный
Ticket, приоритет low.

## Что происходит

- Уведомление «`<epic> NN` ждёт тебя» (Ticket 06) подписано на снимки Stage каждого Project-а из списка worfy:
  `hub.open(root, subscriber)` у Stage hub-а (`src/main/workflow/waits-notify.ts:101-102`), установка —
  `src/main/index.ts:134` (`{ hub: stageHub, projects: () => projectStore().list() }`), один раз на app, есть ли
  окно worfy или нет.
- Подписка держит открытым `ProjectStages` Project-а, а тот раз в минуту считает снимок заново:
  `setInterval(() => void this.refresh(), … 60_000)` (`src/main/workflow/stages.ts:279`). Каждый расчёт
  запускает `bin/profile` (`:117`), а для Project-а с Ticket-ами в работе ещё `git rev-parse` (`:208`),
  `git for-each-ref` (`:214`) и `gh` через трекер PR (`:151`; трекер зовёт `gh`, когда прошёл его интервал,
  60 s). Оценка владельца — около 6 процессов в минуту на Project с работой, когда ни одно окно не открыто.
- Уведомлению нужно одно поле — `waits` Ticket-а. Оно есть в модели workflow (`src/shared/workflow/types.ts:37`),
  которую `workflowHub` (`src/main/ipc/workflow.ts:12`) ведёт наблюдением за файлами, без gh и git.

## Что делаем

1. `installWaitsNotifications` подписывается на `workflowHub` (`WorkflowHub.open`, `src/main/workflow/watch.ts:565`)
   вместо Stage hub-а. Подписчик hub-а получает изменение, а не модель (`watch.ts:573-574`): модель Project-а
   берётся у hub-а заново (как `workflowHub.model(root)` в `src/main/ipc/checks.ts:53`).
2. Ключ ожидания (Project, Epic, NN, `statusAt`), правило «старт не уведомляет», повтор после ошибки чтения и
   клик на вкладку Pipeline — прежние.
3. Текст уведомления — `Blocked reason` Ticket-а. Запасной текст с именем Stage (`waits-notify.ts:55`) уходит:
   Stage без снимка неизвестен. Без `Blocked reason` — запасной текст без Stage (например, «ждёт тебя»).

## Готово, когда

- [ ] `pnpm test test/unit/notify.test.ts` — exit 0: переход в `Waits: owner` в модели workflow — одно
      уведомление; повтор и старт с уже `owner` — ни одного; stub Stage hub-а не открывается ни разу.
- [ ] Test: за 3 минуты поддельных часов без изменений файлов уведомление не запускает ни одного процесса
      (stub `gh`, `git` и `bin/profile` не вызваны). Красный на main.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.

## Тесты

Сначала падающие случаи в `test/unit/notify.test.ts`: подписка на stub `workflowHub` и счётчик вызовов stub
Stage hub-а. Время — поддельные часы vitest.

## Где в коде

- `src/main/workflow/waits-notify.ts`
- `src/main/notify.ts`
- `src/main/index.ts`
- `test/unit/notify.test.ts`

## Итог

Заполняется при закрытии.
