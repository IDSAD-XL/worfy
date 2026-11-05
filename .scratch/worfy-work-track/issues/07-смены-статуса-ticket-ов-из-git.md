# 07 — Смены статуса Ticket-ов из git

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает» → «Источники», «Чтение»; [research 04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), п. 5; [01](../../worfy-autopilot-queue/issues/01-destination-и-масштаб.md), Q5

## Что происходит

- Смена статуса Ticket-а вне Run-а нигде не записана (ADR-0092); журнал Run-а пишет `ticket-status` только внутри Run-а.
- В git она есть: main — 1182 смены за 30 дней (почти всё — squash merge), remote-ветки — ещё 908 (research 04).
  Время есть в значении `Status:` у 71 % (`done 2026-11-05T07:39Z`), у остальных — только дата; форм значения не
  меньше шести.

## Что делаем

1. `src/shared/work-track/status-value.ts` — разбор значения `Status:` всех форм (`done 2026-11-05`, `done — 2026-11-05,
   [PR #N](…)`, `done 2026-11-05 07:39`, ISO с `Z`…): состояние и время или дата.
2. `src/main/work-track/ticket-status.ts` — `git log -p --since` по `.scratch/*/issues/*.md` на main и `--remotes --not
   origin/main`: факты `ticket-status` (Epic, Ticket, из какого в какое состояние, время: значение → коммит ветки →
   коммит main); дубли ветки и main — одна смена. `git` — только чтение.

## Готово, когда

- [ ] Unit test разбора: все формы из research 04 и неизвестная форма (`null`, без ошибки).
- [ ] Contract test на временном репозитории: claim и done в ветке, squash в main — две смены с временем значения;
      смена без времени — время коммита ветки; репозиторий не изменён.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/work-track-status-value.test.ts`, contract `test/contract/work-track-ticket-status.test.ts` (новые).
- Сначала падающий: модулей нет.

## Где в коде

- `src/shared/work-track/status-value.ts`, `src/main/work-track/ticket-status.ts` (новые)
- `test/unit/work-track-status-value.test.ts`, `test/contract/work-track-ticket-status.test.ts` (новые)

Только читать: `harness/bin/epic-status` (разбор `Status:` Harness-а), `harness/bin/TICKETS.md`.
