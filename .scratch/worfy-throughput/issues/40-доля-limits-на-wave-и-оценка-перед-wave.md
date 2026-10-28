# 40 — Доля Limits на Wave в журнале Autopilot и оценка перед Wave: «такая Wave обычно — около N % недели»

Type: task
Status: open
Blocked by: 19
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: меньше token-ов на Ticket, чтобы хватало Limits подписки», идея 7, строки L1 и
L2 таблицы «Цель и числа».

## Что происходит

- worfy знает долю обоих окон Limits и время сброса (`src/shared/agent/limits.ts:24`, `:27-42`). Активный запрос
  usage — не чаще раза в 30 min, пока пассивные источники молчат (`src/main/agent/limits-usage.ts:25-26`).
- Журнал Autopilot — `<WORFY_DATA_DIR>/autopilot/<run>.jsonl` (`src/main/autopilot/journal.ts:1`). В нём есть
  `wave-started` и `wave-finished` с номером Wave и Ticket-ами (`src/shared/autopilot/journal.ts:46`, `:75`,
  схема `:234-236`) и `limits-hit` при отказе (`:76`, `:237`). Доли окон на начале и конце Wave в журнале нет.
- Поэтому сказать «Wave из трёх Ticket-ов стоила 9 % недели» нечем. `scripts/agent-cost.mjs` (Ticket 19) даёт
  token-ы и доллары, но не проценты Limits.

## Что делаем

1. В `wave-started` и `wave-finished` — необязательное поле `limits`: `{ five_hour, seven_day }`, у каждого
   `utilization` (0..1 или null) и `receivedAt` из текущего состояния Limits. Старые строки без поля читаются как
   раньше.
2. Перед `wave-started` worfy просит свежий usage, если число старше 5 min (тот же `LimitsRefresher`, один запрос,
   token-ов модели не тратит — `limits-usage.ts:6`).
3. Оценка — чистая функция в `src/shared/autopilot/`: по журналам прошлых run-ов Project-а — разница `seven_day`
   между концом и началом Wave на один Ticket, медиана последних 10 Wave; Wave без свежего числа (старше 30 min)
   или со сбросом окна внутри не считается. Мало данных (меньше 3 Wave) — оценки нет, так и пишется.
4. UI старта Autopilot: «Такая Wave обычно — около N % недели. Сейчас использовано X %, сброс через …». Без цен.
5. Калибровка: token-ы Wave — своя разбивка, а не данные Ticket-а 19 (тот считает по ролям за период). Берутся
   транскрипты Session Orchestrator-а этого run-а и её Subagent-ов между `wave-started` и `wave-finished`
   (`scripts/agent-cost.mjs --transcripts <папка Session> --since … --until …`; не хватает фильтра по Session —
   добавить `--session <id>`). Итог — token-ы на 1 % недели, в «Итог».

Нужен ПК: для merge — если в diff есть `test/e2e/**`. Трогает Harness: нет (код worfy). Вердикт Windows: `pc`, если в
diff есть `test/e2e/**` (`scripts/windows-verdict-scope.mjs:80`); иначе runner `full`.

## Готово, когда

- [ ] Сначала падающий unit test оценки (`test/unit/autopilot-journal.test.ts` или новый рядом): три Wave с долями дают медиану; Wave со сбросом окна и Wave без свежего
      числа не считаются; меньше трёх Wave — «нет оценки».
- [ ] Contract test журнала (`test/contract/autopilot-journal.test.ts`): `wave-started` с `limits` пишется и читается; строка без `limits` по-прежнему
      читается; неверное поле не ломает чтение остальных строк.
- [ ] Contract test свежего usage с подставными часами (`test/contract/autopilot-limits.test.ts`): число старше
      5 min — перед `wave-started` ровно один запрос usage; свежее — ни одного.
- [ ] e2e (fake agent, `test/e2e/autopilot.spec.ts`): диалог старта Autopilot показывает оценку и текущую долю;
      снимки в светлой и тёмной теме.
- [ ] «Итог»: калибровка шага 5 — token-ы на 1 % недели по двум настоящим Wave, команда и код выхода.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; e2e — только свои spec-и; условие merge — `ci-ok`.
- [ ] (вручную) Две настоящие Wave: доли на начале и конце в журнале, сверка с `/usage` — в «Итог».

## Где в коде

- `src/shared/autopilot/journal.ts` (`:46`, `:75`, `:234-236`)
- `src/main/autopilot/run.ts` (запись `wave-started` / `wave-finished`)
- `src/main/agent/limits-usage.ts` (`LimitsRefresher`)
- новая функция оценки в `src/shared/autopilot/`; UI старта Autopilot в `src/renderer/`

## Вне скоупа

- Остановка по бюджету — Ticket 41. Цены в долларах в UI — нет.

## Итог
