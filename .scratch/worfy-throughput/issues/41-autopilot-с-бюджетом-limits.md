# 41 — Autopilot с бюджетом Limits: доля недели на день, остановка между Wave-ами, продолжение после сброса

Type: task
Status: open
Blocked by: 40
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: меньше token-ов на Ticket, чтобы хватало Limits подписки», идея 8, строка L1
таблицы «Цель и числа», вопрос Q-L5.

## Что происходит

- Autopilot уже ждёт сброса Limits, но только после отказа: Session получила `rejected`, run идёт в `waiting`,
  таймер ставится на сброс отказавшего окна плюс 2 min (`src/main/autopilot/limits-wait.ts:1-10`;
  `RESUME_MARGIN_MS`, `src/shared/autopilot/resume-at.ts:14`). Нет времени сброса — повтор раз в 30 min (`:20`);
  дольше 24 h run не ждёт (`:27`).
- До отказа Autopilot тратит окно до конца: 7-дневное окно может кончиться в середине недели, и владельцу не
  остаётся Limits на работу руками. Утро 2026-10-28: 48 % недели за 2 d 3 h (spec, строка L1).
- Доли окна на начале и конце Wave пишет Ticket 40. Границ Ticket-ов внутри Wave Autopilot не видит: в журнале
  только `wave-started` и `wave-finished` (`src/shared/autopilot/journal.ts:46`, `:75`).

## Что делаем

1. Настройка Autopilot (Settings worfy, не Profile): бюджет включён / выключен; запас недели для работы руками (%);
   умолчания — по ответу владельца на Q-L5 (рекомендация: запас 15 %).
2. Доля на день = (100 % − запас − использовано) / дней до сброса `seven_day`. Чистая функция в
   `src/shared/autopilot/`.
3. Перед каждой Wave (перед `wave-started`, не внутри Wave) run сравнивает остаток доли дня с использованным с
   начала дня по журналу (`limits` из Ticket-а 40) и с оценкой Wave (Ticket 40). Остаток меньше оценки — Wave не
   начинается. Кончилась — run идёт в `waiting` с причиной `budget`, тем же путём, что
   после отказа; новая строка журнала `budget-stop` (доля дня, использовано, когда продолжит).
4. Когда продолжать: начало следующего дня по часам Machine или сброс 5-часового окна, если остался дневной бюджет —
   что раньше. Ночные окна: если run стоит из-за `five_hour`, а дневной бюджет есть, он продолжает ночью сам.
5. В Autopilot и в журнале — причина остановки словами: «дневная доля Limits использована, продолжу в …».

Нужен ПК: для merge — если в diff есть `test/e2e/**`. Трогает Harness: нет (код worfy). Вердикт Windows: `pc`, если в
diff есть `test/e2e/**` (`scripts/windows-verdict-scope.mjs:80`); иначе runner `full`.

## Готово, когда

- [ ] Сначала падающий unit test доли дня: запас, использовано, дни до сброса → доля; сброс окна посреди дня
      пересчитывает долю; бюджет выключен — остановки нет.
- [ ] Unit test времени продолжения: начало следующего дня против сброса 5-часового окна при остатке доли дня —
      берётся то, что раньше; доля дня кончилась — только начало следующего дня (или сброс `seven_day`, если он
      раньше).
- [ ] Contract test run-а (`test/contract/autopilot-limits.test.ts`; fake agent, подставные часы и Limits): доля
      кончилась — run не начинает следующую Wave, пишет `budget-stop`, продолжает в рассчитанное время; Wave в
      работе не прерывается.
- [ ] Contract test журнала (`test/contract/autopilot-journal.test.ts`): новый kind `budget-stop` пишется и
      читается.
- [ ] Contract test: отказ Limits по-прежнему ведёт тем же путём `limits-hit` → `waiting-until` → `resumed`.
- [ ] e2e (fake agent; `test/e2e/settings.spec.ts`, `test/e2e/autopilot.spec.ts`): настройка бюджета в Settings и
      причина остановки в Autopilot; снимки в двух темах.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; e2e — только свои spec-и; условие merge — `ci-ok`.
- [ ] (вручную) Одна ночь Autopilot с бюджетом: строки `budget-stop` / `resumed` в журнале — в «Итог».

## Где в коде

- `src/main/autopilot/run.ts`, `src/main/autopilot/limits-wait.ts`
- `src/shared/autopilot/resume-at.ts` (`:14`, `:20`, `:27`), `src/shared/autopilot/journal.ts` (новый kind)
- Settings worfy в `src/renderer/settings/`

## Вне скоупа

- Оценка Wave — Ticket 40. Preset по плану — Ticket 42. Остановка внутри Wave — нет (оставляет Wave
  наполовину, риск в spec-е).

## Итог
