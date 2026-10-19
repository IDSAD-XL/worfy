# 06 — Застрявшие Ticket-ы выделены; уведомление, когда Ticket ждёт владельца

Type: task
Status: done 2026-10-19T07:50Z
PR: #501
Blocked by: 04, 05
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 1, 7, 8 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md).

## Что происходит

- После Ticket-а 03 у каждого Ticket-а есть Stage, `enteredAt` (время входа из структурированных
  данных) и `waits`; у Stage в Pipeline — необязательный `stuck_after` (Ticket 02).
- Доска (Ticket 04) и stepper (Ticket 05) застрявших не выделяют.
- **Уведомления** — `Notifier` (`src/main/notify.ts:136`): сегодня только о конце хода Session
  (`:169`, `:200`); `Note` привязана к Session (`:50-63`), клик открывает её (`openNote`, `:251`).
  Показ — `electronNotifyDeps` (`:280-288`).
- Иконка уведомления — отдельный Ticket `worfy-polish` 31; этот Ticket её не трогает.

## Что делаем

1. **Порог.** `stuckOf(stage, now)` в `src/shared/workflow/pipeline.ts`: `stuck_after` Stage из
   Profile-а, иначе по умолчанию — 2 h для Implementing, Agent review, CI, Gate & merge; 24 h для
   Human review, Awaiting merge и любого Stage с `Waits: owner` или `team`; у прочих — нет порога.
   Время — `now − enteredAt`; без `enteredAt` Ticket не «застрял».
2. **Выделение.** Карточка доски, строка секции Pipeline и stepper на Card — рамка «stuck» и время на
   Stage в подсказке («on CI for 3 h»). Пересчёт — раз в минуту и на каждое событие
   `pipeline.changed`.
3. **Уведомление о `Waits: owner`.** `src/main/workflow/waits-notify.ts` следит за снимками Stage:
   Ticket, у которого `waits` стало `owner`, даёт одно уведомление через `Notifier` — заголовок
   `<epic> NN ждёт тебя`, текст — `Blocked reason` или имя Stage (например «worfy-link 16 ждёт тебя:
   приёмка»). Ключ — (Project, Epic, NN, `statusAt`): то же ожидание второй раз не уведомляет. На
   старте worfy о Ticket-ах, уже стоявших в `Waits: owner`, не уведомляет. Клик — вкладка Pipeline
   Project-а. Прочие переходы — только доска.
4. `Note` получает вариант без Session (цель — Project и Ticket); показ и интервал уведомлений
   (`NOTIFY_INTERVAL_MS`, `:45`) — прежние.

## Готово, когда

- [ ] `pnpm test test/unit/pipeline.test.ts` — exit 0: пороги по умолчанию и из `stuck_after`; Stage без
      порога; `Waits: team` на CI — 24 h.
- [ ] `pnpm test test/unit/notify.test.ts` — exit 0: переход в `Waits: owner` — одно уведомление с
      текстом выше; повтор того же снимка и старт с уже `owner` — ни одного; клик открывает доску.
- [ ] `pnpm test test/unit/pipeline-board.test.tsx test/unit/ticket-stepper.test.tsx` — exit 0: рамка
      «stuck» с поддельным временем.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную) Stable copy: `ticket block <epic> <NN> "приёмка" --waits owner` на Ticket-е
      тестового Project-а — уведомление приходит, клик открывает доску; снимок —
      `../evidence/06-ждёт-тебя.png`.

## Тесты

Сначала падающие случаи в `test/unit/pipeline.test.ts` и `test/unit/notify.test.ts`. Время — поддельные
часы vitest; `Notification` Electron — stub, как в нынешнем `notify.test.ts`.

## Где в коде

- `src/shared/workflow/pipeline.ts`
- `src/renderer/pipeline/PipelineBoard.tsx`
- `src/renderer/pipeline/Stepper.tsx`
- `src/renderer/shell/sidebar/PipelineSection.tsx`
- `src/main/workflow/waits-notify.ts` (новый)
- `src/main/notify.ts`
- `test/unit/pipeline.test.ts`
- `test/unit/notify.test.ts`
- `test/unit/pipeline-board.test.tsx`
- `test/unit/ticket-stepper.test.tsx`

## Итог

PR #501 влит 2026-10-18, merge commit `15d3ab40`. Head `0d1a6c1b` (rebase на main `46716b04`): gate full на
Mac — зелёный со второго запуска. Первый был красным на flaky test-е вне PR: `test/contract/terminal.test.ts`
«open starts $SHELL -l … output comes back» (ожидание `vi.waitFor` в `test/contract/terminal-harness.ts:288`);
файл отдельно — 6 из 6 зелёных. Не платформенный PR — `check/windows` skipped. Ревью: круг 1 (high) — две
находки med и шесть low, все исправлены в `dbc899ec`; круг 2 (medium) — блокеров нет, 13 из 14 мутантов убиты.

Долги (low):

- `src/shared/workflow/pipeline.ts:349` — граница 48 ч в `onStageFor` (`hours < 48`): мутант `<= 48`
  выживает. Нужен test `onStageFor('CI', 48 * HOUR_MS)` → `on CI for 2 d`.
- Нет test-а на остановку уведомления «ждёт владельца» при выходе: `app.on('will-quit', stopNotifications)`,
  `src/main/index.ts:135`.
