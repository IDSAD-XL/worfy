# 08 — Flight Recorder читает прогноз, факт и Wait окна запуска

Type: task
Status: done 2026-11-01T15:55Z
PR: #1221
Branch: worfy-resource-planner/08
Blocked by: 05, 07
Source: [spec.md](../spec.md), «Решения» (Q10, Q13), «Journal» (последний абзац), «Что видит пользователь» (Run history); [ADR-0092](../../../docs/adr/0092-run-history.md) (шкала вычисляется при открытии); [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md), п. 3, 6

## Что происходит

- Разбор Journal для шкалы Run (worfy-flight-recorder Ticket 13) — `src/shared/flight-recorder/from-journal.ts`:
  Wait-ы `limits`, `limits-budget` (от `budget-stop` до `resumed`, `:248-249`), `background-tasks`, `gate-queue`
  (шапка `:12-17`); из `run-started` — `by` и `tickets` (`JournalFacts`, `:65-67`).
- Причины Wait — фиксированный список `WAIT_CAUSES` (`src/shared/flight-recorder/facts.ts:25`); итог «Waits by cause»
  складывает по нему (`src/shared/flight-recorder/summary.ts:140`).
- После Ticket-ов 05 и 07 Journal пишет `run-started.mode`, `forecast`, `start-window` и `run-stopped.actual`; разбор их
  не знает: `start-window` … `resumed` сейчас стал бы Wait `limits` по `waiting-until`.

## Что делаем

1. `WAIT_CAUSES` получает `start-window`; `from-journal.ts` открывает Wait `start-window` по строке `start-window`
   (detail — `reason`) и закрывает по `resumed`, как `limits-budget`. Wait, открытый на `run-stopped`, кончается там.
2. `JournalFacts` получает `mode?` (из `run-started`), `forecast?` (`low`, `high`, `waves`, `tickets`, `uncounted`,
   `samples`, `fit`) и `actual?` (`share`, `waves`, `counted`) — как написано, поле чужой формы — отсутствует.
3. Комментарий-таблица источников в `facts.ts` (`:58`) называет новую причину.
4. Экран не меняется: шапку Run показывает Ticket 11 этого Epic-а, после Ticket-а 18 Epic-а `worfy-flight-recorder`.

## Готово, когда

- [x] Unit test (`test/unit/flight-recorder-journal.test.ts`): `start-window` → `waiting-until` → `resumed` — один Wait
      `start-window` с detail `outside`, не Wait `limits`; открытый на `run-stopped` — кончается там.
- [x] Unit test: `mode`, `forecast` и `actual` Journal-а test-а доходят до `JournalFacts`; Journal до этого Epic-а —
      полей нет, остальное как раньше; `forecast` чужой формы — поля нет, `skipped` не растёт за счёт остальных строк.
- [x] Unit test итога (`test/unit/flight-recorder-summary.test.ts`): строка «Waits by cause» для `start-window`.
- [x] Test-ы краснеют на mutant-ах: `start-window` открывает Wait `limits-budget`; `resumed` не закрывает Wait окна.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-summary.test.ts`.
- Сначала падающий: `start-window` даёт Wait `start-window`.
- Прогнать все `test/unit/flight-recorder-*.test.ts` и `test/unit/critical-path.test.ts`.

## Где в коде

- `src/shared/flight-recorder/facts.ts` — `WAIT_CAUSES` `:25`, таблица источников `:58`
- `src/shared/flight-recorder/from-journal.ts` — шапка `:12-17`, `JournalFacts` `:65-67`, `budget-stop` `:248-249`
- `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-summary.test.ts`

Только читать: `src/shared/flight-recorder/summary.ts` (`:140`), `src/shared/flight-recorder/spans.ts`,
`src/shared/autopilot/journal.ts` (виды Ticket-ов 05, 07).

## Итог

- `src/shared/flight-recorder/facts.ts`: `WAIT_CAUSES` — `start-window` после `limits-budget`; таблица источников
  называет её у `waits`. Список причин читает и схема IPC (`src/shared/ipc/runs.ts`), она расширилась сама.
- `src/shared/flight-recorder/from-journal.ts`: строка `start-window` открывает Wait `start-window` (detail — `reason`),
  `waiting-until` за ней дописывает `until …` в тот же Wait, а не открывает Wait `limits`; `resumed` закрывает его,
  `run-stopped` — тоже, если Wait ещё открыт. Как у `limits-budget`, Wait стоит за Ticket-ами следующей Wave (пусто,
  если Wave больше не было): проверка окна идёт перед Wave, часто в ту же миллисекунду, что `wave-finished`.
  `JournalFacts` получил `mode?` (`run-started.mode`, только значения `RUN_MODES`), `forecast?` (первая строка
  `forecast`: `low`, `high`, `waves`, `tickets`, `uncounted`, `samples`, `fit`) и `actual?` (`actual` того
  `run-stopped`, что кончает Run). Форма проверяется по правилам схемы `src/shared/autopilot/journal.ts`; чужая форма —
  поля нет, строка не пропускается и `skipped` не растёт. Шапка файла называет новую причину и новые поля.
- Экран не менялся (шапку Run показывает Ticket 11).
- Решено без владельца, подтвердить:
  1. detail Wait `start-window` — `outside, until <ISO>`, а не голое `outside`: так же, как `limits-budget`
     (`daily-share, until …`), время следующего старта окна видно в подсказке Wait.
  2. Повторная строка `forecast` (её не пишет ни один писатель) не заменяет первую.
- Файлы вне раздела «Где в коде» (только test-ы, которые перечисляют `WAIT_CAUSES`): `test/unit/flight-recorder-spans.test.ts`
  (список причин), `test/unit/flight-recorder-summary-waits.test.ts` (Wait-ы по всем причинам шли по часу от 10:00,
  шестая вышла за четыре часа Run — теперь по 30 минут подряд).
- Test-ы: `test/unit/flight-recorder-journal.test.ts` — 6 новых (Wait окна с `outside` и `wave-too-long`, Wait окна на
  `run-stopped`, `mode`/`forecast`/`actual`, Journal до Epic-а, чужая форма, первая `forecast`);
  `test/unit/flight-recorder-summary.test.ts` — строка `start-window` в «Waits by cause», целиком. Сначала красные:
  4 test-а Journal-а (Wait и поля); test итога до правки красный только в typecheck (`'start-window'` не `WaitCause`).
- Mutant-ы (все 15 красные, `flight-recorder-journal` + `flight-recorder-summary`): `start-window` открывает Wait
  `limits-budget`; `resumed` не закрывает Wait окна; `run-stopped` не кончает его; Wait окна не берёт следующую Wave;
  строка `start-window` не открывает Wait (его открывает `waiting-until` как `limits`); detail без `reason`; любой
  `mode`; последняя `forecast` вместо первой; отрицательная доля; дробный счёт; `fit` без проверки; `counted > waves`;
  `actual` без Wave; `forecast` не читается; `actual` не читается.
- Ревью, раунд 1 (PR #1221):
  - Экран всё же правился. В `src/renderer/flight-recorder/span-words.ts` и
    `src/renderer/flight-recorder/SummaryStrip.tsx` у `WAIT_WORDS` появилась запись `'start-window': 'Start window'`.
    Оба словаря теперь `Record<WaitCause, string>`: новая причина без подписи даёт красный typecheck. Запасной
    вывод сырой причины убран. Test: `test/unit/flight-recorder-view.test.tsx` — подпись бара на дорожке Wait и
    строки «Waits by cause».
  - Строки Limits, budget и Start window ведут один общий Wait. Строка, пришедшая при уже открытом Wait, его не
    закрывает и нового не открывает. Так `start-window` при открытом Wait `limits` и `limits-hit` внутри Wait окна
    не дают второго Wait-а. Ни один писатель так не пишет, поведение закреплено test-ами. Wait `background-tasks`
    строка `start-window` не трогает.
  - Test-ы: `actual` берётся из последнего из двух `run-stopped`; `mode` — только из `run-started`, `mode`
    строки `forecast` его не подменяет. `toEqual` вместо `toMatchObject` для `actual`, `mode`, `forecast` и Wait
    `wave-too-long`.
  - Mutant-ы раунда (все красные): нет записи Start window в span-words; нет её в SummaryStrip; `actual` из
    первого `run-stopped`; `mode` из строки `forecast`; `start-window` заменяет открытый Wait; `start-window`
    закрывает открытый Wait и открывает свой; `limits-hit` заменяет открытый Wait; `start-window` закрывает Wait
    `background-tasks`.
  - Долг без правки: проверки формы `forecast` и `actual` повторяют zod-схему `src/shared/autopilot/journal.ts`
    вручную.
- Оценка автора: около 220 тыс. токенов вместе с раундом 1.

Влит cfe3fafa (#1221).
- Долг: `walkRun` (`src/shared/flight-recorder/journal-walk.mjs`) в `scripts/critical-path.mjs` считает Wait окна Start window как Limits.
