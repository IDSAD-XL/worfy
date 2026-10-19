# 09 — Уведомление «ждёт тебя» следит за моделью workflow, а не за снимками Stage: без опроса gh, git и `bin/profile`

Type: task
Status: open
Blocked by: —
Source: follow-up Ticket-а 06 (PR #501); решение владельца 2026-10-19, Q-c: #501 влит как есть, это — отдельный
Ticket, приоритет low; решения владельца 2026-10-20, grilling Q1–Q16 (здесь Q9–Q11; [spec.md](../spec.md),
«Решения владельца», блок 2026-10-20).

## Что происходит

- Уведомление «`<epic> NN` ждёт тебя» (Ticket 06) подписано на снимки Stage каждого Project-а из списка worfy:
  `hub.open(root, subscriber)` у Stage hub-а (`src/main/workflow/waits-notify.ts:101-102`), установка —
  `src/main/index.ts:141` (`{ hub: stageHub, projects: () => projectStore().list() }`), один раз на app, есть ли
  окно worfy или нет.
- Подписка держит открытым `ProjectStages` Project-а, а тот раз в минуту считает снимок заново:
  `setInterval(() => void this.refresh(), … 60_000)` (`src/main/workflow/stages.ts:279`). Каждый расчёт
  запускает `bin/profile` (`:117`), а для Project-а с Ticket-ами в работе ещё `git rev-parse` (`:208`),
  `git for-each-ref` (`:214`) и `gh` через трекер PR (`:151`; трекер зовёт `gh`, когда прошёл его интервал,
  60 s). Оценка владельца — около 6 процессов в минуту на Project с работой, когда ни одно окно не открыто.
- Уведомлению нужно одно поле — `waits` Ticket-а. Оно есть в модели workflow (`src/shared/workflow/types.ts:37`),
  которую `workflowHub` (`src/main/ipc/workflow.ts:12`) ведёт наблюдением за файлами, без gh и git. Там же
  `title` (`:23`), `state` (`:25`), `statusAt` (`:31`) и `blockedReason` (`:35`).
- Ключ ожидания сейчас — (Epic, NN, `statusAt`) (`waits-notify.ts:27`). У перенесённых Ticket-ов `statusAt` —
  дата без времени, у Ticket-а без строки Status — `null`: два разных ожидания в один день дают один ключ.
- Повтор после ошибки чтения — пауза, которая удваивается от интервала до `MAX_INTERVAL_MS`
  (`waits-notify.ts:107-115`).

## Что делаем

1. `installWaitsNotifications` подписывается на `workflowHub` (`WorkflowHub.open`, `src/main/workflow/watch.ts:565`)
   вместо Stage hub-а. Подписчик hub-а получает изменение, а не модель (`watch.ts:552`, `:574`). Брать ли
   изменения или каждый раз модель целиком (`workflowHub.model(root)`, как `src/main/ipc/checks.ts:53`) —
   выбор implementer-а, не решение владельца.
2. **Модели нет (Q9).** Нет модели workflow Project-а (первое чтение упало, `model()` — `null`) — hub
   пробует снова с той же удваивающейся паузой, что сейчас (`waits-notify.ts:107-115`). Пока модели нет,
   уведомлений нет. Первая модель — исходный снимок: Ticket-ы, которые в ней уже ждут, уведомления не дают
   (прежнее правило «старт не уведомляет», не повод уведомить о всех разом).
3. **Текст (Q10).** Тело уведомления — `Blocked reason` Ticket-а. Без него — «`<Epic> <NN> — <title Ticket-а>`».
   Запасной текст с именем Stage (`waits-notify.ts:55`) уходит: Stage без снимка неизвестен.
4. **Ключ (Q11).** `statusAt` с временем (`2026-10-17T09:41Z`) — ключ (Epic, NN, `statusAt`), как сейчас.
   `statusAt` нет или в нём только дата — ключ (Epic, NN, слово Status, `Blocked reason`). Одно уведомление
   на смену Status или причины.
5. Клик открывает вкладку Pipeline Project-а — как сейчас. Уведомляет только `Waits: owner`; `team`, `agent`
   и имя Machine не уведомляют (имя Machine — Ticket 10).

## Готово, когда

- [ ] `pnpm test test/unit/notify.test.ts` — exit 0: переход в `Waits: owner` в модели workflow — одно
      уведомление; повтор и старт с уже `owner` — ни одного; stub Stage hub-а не открывается ни разу.
- [ ] Там же: тело — `Blocked reason`; без него — «`<Epic> <NN> — <title>`».
- [ ] Там же: `statusAt` — дата без времени: смена `Blocked reason` при той же дате — второе уведомление,
      та же причина снова — ни одного; `statusAt` с временем — новое время, новое уведомление.
- [ ] Там же: первое чтение модели упало — повтор через 1, 2, 4… интервала (поддельные часы), уведомлений нет;
      первая удачная модель с Ticket-ом в `owner` — ни одного уведомления, следующий переход — одно.
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
