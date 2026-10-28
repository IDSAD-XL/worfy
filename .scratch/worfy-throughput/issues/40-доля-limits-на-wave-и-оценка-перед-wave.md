# 40 — Доля Limits на Wave в журнале Autopilot и оценка перед Wave: «такая Wave обычно — около N % недели»

Type: task
Status: claimed 2026-10-28T19:59Z
Branch: worfy-throughput/40
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

- [x] Сначала падающий unit test оценки (`test/unit/autopilot-journal.test.ts` или новый рядом): три Wave с долями дают медиану; Wave со сбросом окна и Wave без свежего
      числа не считаются; меньше трёх Wave — «нет оценки».
- [x] Contract test журнала (`test/contract/autopilot-journal.test.ts`): `wave-started` с `limits` пишется и читается; строка без `limits` по-прежнему
      читается; неверное поле не ломает чтение остальных строк.
- [x] Contract test свежего usage с подставными часами (`test/contract/autopilot-limits.test.ts`): число старше
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

Сделаны шаги 1–4 из «Что делаем». Шаг 5 (калибровка) не сделан: ждёт PR #922 (Ticket 39), который меняет
`scripts/agent-cost.mjs`; на момент PR #922 открыт (`gh pr view 922 --json state` → `OPEN`).

- **Поле `limits`** в `wave-started` и `wave-finished` (`src/shared/autopilot/journal.ts`): `{five_hour, seven_day}`,
  у окна `utilization` (0..1 или null), `receivedAt` (ISO) и `resetsAt` (ISO или null), окно null, когда о нём ничего не
  известно. `resetsAt` добавлен сверх текста тикета: без него шаг 3 не отличит сброс окна внутри Wave. Строки без поля
  читаются как раньше; неверное значение `limits` отбрасывается, сама строка Wave читается.
- **Свежий usage**: `LimitsRefresher.refreshIfOlder(maxAgeMs)` (`src/main/agent/limits-usage.ts`) — один запрос, если окно
  старше 5 min или его нет; запрос, который уже идёт, ждётся, второй не начинается. Run (`src/main/autopilot/run.ts`)
  спрашивает перед отправкой «Run wave» (число `wave-started` — до начала Wave) и перед `wave-finished` (сверх тикета:
  иначе число конца Wave бывает старше 30 min, и шаг 3 такую Wave не считает). Ответ конца Wave свежий для старта
  следующей, поэтому на границе Wave — не больше одного запроса. После Force stop и выхода из приложения запрос не ждётся.
- **Оценка** — `waveEstimate` в `src/shared/autopilot/limits-estimate.ts`: медиана роста `seven_day` на Ticket по последним
  10 Wave; Wave без свежего числа (старше 30 min на любом конце), со сбросом окна (другой `resetsAt`, сброс до конца
  Wave или доля упала) не считается; меньше 3 Wave — `null`. Читаются 30 новейших run-ов Project-а
  (`readRecentRuns`, `src/main/autopilot/journal.ts`), IPC `autopilot.estimate` (read).
- **UI**: диалога старта у Autopilot нет — старт идёт кнопкой «Autopilot». Строка оценки — в конце hint-а активной
  кнопки: «A Wave like this usually takes about 4% of the week. Used now: 41%, resets in 2 d 5 h» (на число Ticket-ов
  готовой Wave) или «No estimate for a Wave yet: fewer than 3 past Waves with fresh Limits…». Без цен.
- **e2e не добавлен**: hint проверяет jsdom test `test/unit/canvas-actions.test.tsx`; правка `test/e2e/**` сделала бы
  вердикт Windows `pc` (решение Orchestrator-а для этого Ticket-а). Снимков в светлой и тёмной теме нет: строка — текст
  hint-а, а не новый элемент.
- **Калибровка**: не сделана (ждёт #922). Данных для неё тоже нет: в `~/Library/Application Support/worfy/autopilot/`
  36 журналов, последний от 2026-10-17, ни в одном нет `limits` (`grep -l '"limits"' … | wc -l` → 0, код выхода 0).
- **Проверка**: `pnpm lint` и `pnpm typecheck` — exit 0. `pnpm test` и `gate fast` — exit 1 и 2 только из-за contract test-ов
  file watcher-а (docs-watch-root, docs, card-protocol, claude-home-registry, workflow-reader watcher, harness-script-env) —
  известная проблема fseventsd на этом Mac; `clients`, `harness-script-env`, `harness-scripts` отдельно — exit 0.
- **Вручную** (не сделано): две настоящие Wave со сверкой долей с `/usage`.
