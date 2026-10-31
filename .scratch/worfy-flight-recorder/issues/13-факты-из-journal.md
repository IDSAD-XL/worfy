# 13 — Факты из Journal

Type: task
Status: open
Blocked by: 11, 12
Source: [spec.md](../spec.md), «Модель» («Wait, блокировка, повтор», «Неполная история» — каркас Run), «Источники и что меняется в них» (строка Journal), «Ticket-ы» (13), «Соглашения для Ticket-ов этого Epic-а» (fixture ночного Run); решение 03, Q5 ([03-модель-spans.md](03-модель-spans.md)); решение 04, Q4, Q7 ([04-дыры-источников.md](04-дыры-источников.md)); решение 08, Q5 ([08-неполная-история.md](08-неполная-история.md))

## Что происходит

- После Ticket-а 11 Journal (`<data dir>/autopilot/<run>.jsonl`) знает `ticket-status`, `gate-queue-finished` и
  три необязательных поля; после Ticket-а 10 обход событий — `src/shared/flight-recorder/journal-walk.mjs`; после
  Ticket-а 12 есть модель spans (`spans.ts`).
- Виды событий Journal сейчас: `run-started`, `wave-started`, `narrow-round`, `wave-finished`, `budget-stop`,
  `limits-hit`, `waiting-until`, `resumed`, `session-error`, `refused-dialog`, `human-input`, `background-tasks`,
  `run-stopping`, `gate-queue`, `run-stopped`, `orchestrator-returned`, `tasks-killed`
  (`src/shared/autopilot/journal.ts:185`).
- Journal-ы Run-ов до этого Epic-а не имеют `ticket-status`, `gate-queue-finished` и новых полей.

## Что делаем

`src/shared/flight-recorder/from-journal.ts` — чистая функция: строки Journal одного Run → факты модели Ticket-а 12.
Journal задаёт каркас Run (решение 08, Q5).

1. **Run и Wave**: `run-started` … `run-stopped` (причина остановки), `wave-started` … `wave-finished`, номер Wave
   внутри Run, Ticket-ы Wave.
2. **Wait-ы** (решение 03, Q5): `limits` (`limits-hit` → `resumed`), `limits-budget` (`budget-stop` → `resumed`),
   `background-tasks` (из событий `background-tasks`), `gate-queue` (`gate-queue` → `gate-queue-finished`).
3. **Статусы Ticket-ов** из `ticket-status`: claim, блокировка-отметка с `reason` и `waits`, снятие, `done`.
4. **Повторы**: `narrow-round` и перезапуск после `session-error` — новая попытка `#N` со ссылкой на причину.
5. **Отметки на дорожке Orchestrator**: `refused-dialog` и `human-input` — отметки, не Wait (решение 03, Q5).
6. **Старый Journal** (без `ticket-status`): claim Ticket-а — по `wave-started`, где он назван.
7. Fixture ночного Run (соглашения spec-а): обезличенный Journal Run `2026-10-17T22-29-32-707Z-58e783`, пути
   домашней папки заменены. Ticket-ы 14–16 идут раньше (Wave 2) и могли уже положить его; тогда этот Ticket берёт
   тот же файл, иначе кладёт сам.

## Готово, когда

- [ ] Unit test на fixture ночного Run: число Wave, Ticket-ы каждой Wave, причина остановки и длительность Run
      совпадают с Journal.
- [ ] Unit test Wait-ов: по одному Run на каждую причину (`limits`, `limits-budget`, `background-tasks`,
      `gate-queue`) — span Wait с причиной, началом и концом; `gate-queue` без `gate-queue-finished` (старый
      Journal) — обрыв по правилу модели.
- [ ] Unit test статусов: `ticket-status` `claimed` → `blocked` (с `reason`, `waits`) → `claimed` → `done` дают
      claim, отметку блокировки, снятие, `done`.
- [ ] Unit test старого Journal: без `ticket-status` claim Ticket-а — время `wave-started`, где он назван.
- [ ] Unit test повторов: `narrow-round` и `session-error` с новой Wave дают `#2` со ссылкой на причину.
- [ ] Unit test: `refused-dialog` и `human-input` — отметки дорожки Orchestrator, не Wait.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-journal.test.ts` (новый): fixture ночного Run и короткие Journal-ы-литералы на
  каждый случай.
- Сначала падающий: Journal с `limits-hit` и `resumed` — Wait `limits` с этими временами.
- Прогнать `test/unit/flight-recorder-*.test.ts` и `test/unit/critical-path.test.ts`.

## Где в коде

- `src/shared/flight-recorder/from-journal.ts` (новый)
- `test/unit/flight-recorder-journal.test.ts` (новый)
- `test/fixtures/flight-recorder/night-run/` — общий fixture Ticket-а 10, только читать

Только читать: `src/shared/flight-recorder/journal-walk.mjs`, `src/shared/flight-recorder/spans.ts`,
`src/shared/autopilot/journal.ts`.
