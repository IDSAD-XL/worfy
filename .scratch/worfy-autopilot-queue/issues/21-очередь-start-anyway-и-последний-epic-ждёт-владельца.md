# 21 — Очередь: «Start anyway» в окне очереди и последний Epic, ждущий владельца

Type: task
Status: open
Blocked by: —
Source: приёмка [20](20-приёмка-с-владельцем.md#итог), Q1 и Q2 — приняты владельцем 2026-11-07 («по всем +»); решение
владельца утром 2026-11-07 по Ticket-у 14 (Q2, «по всем +»): «Start anyway» снимает проверку «Epic идёт на другой
Machine» для всей очереди; [spec.md](../spec.md), «Решения владельца», 18; «Решено без владельца», 6

## Что происходит

- **Окно очереди без «Start anyway» (Q1 приёмки).** «Run all accepted» → окно запуска → «Start Autopilot», когда Epic
  очереди идёт на другой Machine или в другом Project-е того же репозитория: main отказывает с `runningElsewhere`, окно
  показывает только error toast. `startQueue` (`src/renderer/autopilot/start-modal.ts:145-152`) не передаёт `override`
  и не умеет его передать. Main очередь с `override` принимает: `start` (`src/main/autopilot/run.ts:1122-1131`)
  пропускает проверку, `beginEpic` (`run.ts:1547`) не проверяет следующие Epic-и. Прямой вызов IPC с `override: true`
  при приёмке дал `run-started` с `override: true`. У Run-а одного Epic-а кнопка есть — строка Autopilot
  (`src/renderer/canvas/actions/AutopilotAction.tsx:293-302`, кнопка `:330-358`). Снимки:
  `../evidence/20/21-queue-runs-elsewhere-toast-only-light.png`, `../evidence/20/22-single-epic-runs-elsewhere-start-anyway-light.png`.
- **Последний Epic очереди, ждущий только владельца, останавливает Run с `blocked-tickets` (Q2 приёмки).** `moveOn`
  (`src/main/autopilot/run.ts:1519-1521`) при пустом остатке очереди (`nextEpic` — `null`) возвращает `false` до правила
  очереди `epicOutcome` (`src/shared/autopilot/epic-queue.ts:72-82`). Итог: нет `epic-finished` `waits-owner`, у рамки
  Epic-а нет чипа «Waits for owner», строка — «Epic 3/3: billing · stopped: blocked tickets». Тот же Epic в середине
  очереди — пропуск с `epic-finished` `waits-owner` и чипом (снимок `../evidence/20/16-waits-for-owner-chip-light.png`).
  Владелец видит две разные причины для одного и того же состояния Epic-а.

## Что делаем

1. **Окно очереди.** Отказ `runningElsewhere` при старте из окна очереди («Run all accepted» и просьба агента с
   очередью) показывает, как у одиночного Epic-а, причину и кнопку «Start anyway» (на какой Machine или в каком
   Project-е идёт Epic). «Start anyway» повторяет старт той же очереди, в том же порядке и Run mode, с `override: true`.
   Проверка снимается для всей очереди (решение владельца 2026-11-07). Остальные отказы — toast, как сейчас.
2. **Последний Epic.** Правило очереди применяется и к последнему Epic-у Run-а очереди (больше одного Epic-а): когда
   `epicOutcome` даёт `waits-owner`, пишется `epic-finished` `waits-owner` с `tickets`, рамка показывает «Waits for
   owner», затем Run останавливается. Причина остановки — одна для владельца: `waits-owner` (новая в
   `AUTOPILOT_STOP_REASONS`), строка «Epic 3/3: billing · stopped: waits for owner». Поведение «нечего отправить» на
   Machine с `serve` (`gateQueueTurn`, `run.ts:2041`) для новой причины то же, что для `blocked-tickets`.
3. Run одного Epic-а не меняется: его Epic, ждущий владельца, по-прежнему `blocked-tickets` (решено без владельца —
   подтвердить в «Итог»).

## Готово, когда

- [ ] Unit test окна очереди: отказ `runningElsewhere` → причина и кнопка «Start anyway»; нажатие → `autopilot.start`
      с той же очередью, Run mode и `override: true`; другой отказ — только toast, кнопки нет.
- [ ] Contract test: очередь из двух Epic-ов, второй идёт в другом Project-е — старт без `override` отказан, с
      `override` — Run идёт по обоим Epic-ам, `run-started` с `override: true`, без `epic-finished` `elsewhere`.
- [ ] Contract test: последний Epic очереди ждёт только владельца → `epic-finished` `waits-owner` с номерами Ticket-ов
      и `run-stopped` с причиной `waits-owner`; тот же Epic в середине очереди — как сейчас; Run одного Epic-а —
      `blocked-tickets`, как сейчас.
- [ ] Unit test строки и чипа: остановка `waits-owner` — «stopped: waits for owner» и чип «Waits for owner» у
      последнего Epic-а.
- [ ] e2e — при необходимости: «Run all accepted» → отказ → «Start anyway» → «Epic 1/2» (`test/e2e/autopilot-start-modal.spec.ts`).
- [ ] Снимки окна с «Start anyway» и строки последнего Epic-а в обеих темах — `../evidence/21-*.png`.
- [ ] Страница Feature `autopilot` (en и ru): «Start anyway» у очереди и остановка на последнем Epic-е, ждущем владельца.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/start-autopilot-modal.test.tsx` (окно очереди), `test/unit/autopilot-queue-line.test.ts` (строка и
  чип); contract `test/contract/autopilot-queue.test.ts` (override очереди, последний Epic); при необходимости — e2e
  `test/e2e/autopilot-start-modal.spec.ts`.
- Сначала падающий: окно очереди без «Start anyway» при `runningElsewhere`; последний Epic, ждущий владельца, без
  `epic-finished` `waits-owner`.

## Где в коде

- `src/renderer/autopilot/start-modal.ts:131-152` (`refused`, `startQueue`), `:172` (`runAllAccepted`)
- `src/renderer/autopilot/StartAutopilotModal.tsx:349-356` (старт из окна и его ответ)
- `src/renderer/canvas/actions/AutopilotAction.tsx:289-302`, `:325-358` (образец: «Start anyway» одиночного Epic-а)
- `src/main/autopilot/run.ts:1519-1534` (`moveOn`), `:2022-2026` (остановка цикла), `:2041` (`gateQueueTurn`), `:2095`,
  `:2871` (списки причин «нечего отправить»)
- `src/shared/autopilot/cycle.ts:49-70` (`AUTOPILOT_STOP_REASONS`), `src/shared/autopilot/epic-queue.ts:72-94`
  (`epicOutcome`, `nextEpic`)
- `src/shared/ipc/autopilot.ts` (`autopilotStatusLine`, причина остановки в строке),
  `src/shared/flight-recorder/from-journal.ts:150` (слова причин Run history)
- `test/unit/start-autopilot-modal.test.tsx`, `test/unit/autopilot-queue-line.test.ts`,
  `test/contract/autopilot-queue.test.ts`, `test/e2e/autopilot-start-modal.spec.ts`

- `docs/adr/0100-run-epic-queue.md:23` (поправка: «Очередь кончилась — `run-stopped` с причиной последнего Epic-а» —
  кроме Epic-а, ждущего владельца)
- `docs/features/autopilot.md:54-56`, `docs/features/ru/autopilot.md:54-56` (сейчас: «для очереди — только error toast, без
  chip и без Start anyway»), абзац о чипе «Waits for owner» (`docs/features/autopilot.md:131`, тот же в `ru`)
