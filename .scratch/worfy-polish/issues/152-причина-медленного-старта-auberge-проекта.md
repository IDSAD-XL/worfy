# 152 — Причина медленного старта Auberge-размерного Project-а: замер и починка до конца карантина 2026-12-09

Type: bug
Status: open
Blocked by: 151
Source: решение владельца 2026-11-26 (раунд Q1–Q12 вечернего отчёта 2026-11-25), Q1; Ticket-ы worfy-polish 150
(карантин, таблица 84 job-ов `macos-e2e`) и 151 (запись ядра внимания, PR #2234); пункты 3 и 4 «Готово, когда»
Ticket-а 151 (предел от замеренной базы, снятие карантина) перенесены сюда вариантом (б) владельца.

Кто: агент. Срок: починка влита до 2026-12-09 — конца карантина
`test/quarantine/epic-frame-auberge-start-macos-ci.json`.

## Что происходит

macOS e2e test «an Auberge-sized Project is interactive within 3 s and pans and zooms smoothly over its biggest Epic»
(`test/e2e/epic-frame.spec.ts:1116`) в карантине до 2026-12-09 (Ticket 150). На GitHub Actions он меряет старт
Project-а Auberge-размера (`N`) — 42 Epic-а, 682 Ticket-а (`generateAuberge`, `epic-frame.spec.ts:1001-1002`), — против
предела `min(6 × R, 7300)` ms, где `R` — медиана трёх стартов Project-а из одного Ticket-а на том же runner-е
(`test/e2e/start-budget.ts:16`, `:24`, `:31-34`). В 4 из 84 первых попыток 2026-11-22…25 `N` был выше 7300 ms
(7716–10258 ms).

Ticket 151 (PR #2234) убрал повторные записи ядра внимания на старте: файл пишется один раз вместо 96, 51 → 9 ms
локально. Это около 6 % старта; остальное не объяснено. Владелец решил (Q1, вариант (б)): потолок
`RUNNER_START_CAP_MS` = 7300 остаётся, карантин остаётся, исправление ядра вливается, а причину ищет этот Ticket.

Зацепка из чисел: 2026-10-28 runner мерил `N` 1736–4853 ms и `R` 565–1274 ms (комментарии `start-budget.ts:9-24`);
в красных job-ах 2026-11-22…25 `R` — 1880–3857 ms, медиана `N` — 4963 ms. Медленнее стал и старт Project-а из одного
Ticket-а, то есть, вероятно, общий путь старта, а не только то, что растёт с числом Ticket-ов.

## Что строить

1. **Замер, не оценка.** Профиль старта Project-а Auberge-размера: main process (CPU profile, `--cpu-prof`, или
   `performance.mark` вокруг чтения workflow, Layout-а, ядра внимания, первой отправки в renderer) и renderer (от
   получения workflow до первого кадра Epic-а). Где уходит время — таблицей в «Итог»: этап, ms на runner-е, доля `N`.
2. **Когда стало медленнее.** По истории job-ов `macos-e2e` найти, с какого commit-а или смены образа runner-а выросли
   `N` и `R`; оба числа test печатает строкой `auberge-size: interactive …` и annotation `perf`
   (`epic-frame.spec.ts:1208-1214`). Найденный commit — в «Итог».
3. **Починка причины.** Исправить то, что замер назвал главным, так, чтобы test проходил с потолком 7300 ms на
   runner-е с запасом. Потолок `RUNNER_START_CAP_MS` = 7300 и `START_MS` = 3000 не поднимаются, timeout-ы test-а не
   меняются (правило проекта: timeout-ы не подстраивают по одному).
4. **Предел от замеренной базы** (пункт 3 «Готово, когда» Ticket-а 151, перенесён сюда решением владельца Q1 (б)):
   предел test-а на CI зависит от базы, замеренной на том же runner-е, а не от одной скорости runner-а, — например,
   отношение `N / R` против предела, выведенного из распределения 84 job-ов Ticket-а 150, или база без ядра в том же
   job-е. Потолок 7300 ms остаётся верхней границей этого правила, а не заменяется им. Выбор и числа — в «Итог»;
   `test/unit/e2e-start-budget.test.ts` проверяет правило.
5. **Снять карантин** (пункт 4 «Готово, когда» Ticket-а 151, перенесён сюда): удалить `test/quarantine/epic-frame-auberge-start-macos-ci.json` и вернуть `test(...)` вместо
   `quarantined('epic-frame-auberge-start-macos-ci')(...)`, когда test зелёный на runner-е. Если до 2026-12-09
   причина не найдена или не исправлена — «Итог» говорит, что найдено, и Orchestrator решает по `rules-merge.md`
   (карантин дольше 14 дней — не продлевается сам).

## Где в коде

- `test/e2e/epic-frame.spec.ts:999-1101` (Project Auberge-размера), `:1103` (`interactiveAfter`), `:1116` (test).
- `test/e2e/start-budget.ts` — `startBudget` (правило от базы, п. 4); `START_MS` и `RUNNER_START_CAP_MS` не поднимать.
- `test/unit/e2e-start-budget.test.ts` — test правила.
- `test/quarantine/epic-frame-auberge-start-macos-ci.json` — удалить в конце.
- Зацепка: `src/main/assistant/core/install.ts:89-97` — догоняющее чтение journal Autopilot-а на старте всё ещё кладёт
  в ядро каждую строку отдельно (`autopilotAttention` на строку), вне пачки, которую ввёл Ticket 151.
- Путь старта Project-а: `src/main/workflow/reader.ts` (чтение workflow), `src/main/assistant/core/sources.ts:133-150`,
  `src/main/assistant/core/attention-core.ts`, `src/main/storage/json-file.ts:81-93` (после Ticket-а 151 — сверить),
  `src/renderer/canvas/` (первый кадр Epic-а). Точный файл починки назовёт замер.
- Только читать: `.github/workflows/ci.yml` (job `macos-e2e`), `test/e2e/quarantine.ts`.

## Решения

- Локальный e2e не запускать: правило владельца 2026-11-11 действует. Замер — в CI (временный шаг или переменная в
  job-е `macos-e2e` ветки этого Ticket-а, профиль — artifact) или test-ом без окна на том же Project-е
  Auberge-размера. Временный шаг профиля в CI удаляется до merge.
- Ни один job не перезапускается ради зелёного: ручной повтор упавшего job-а — не путь к merge.

## Test-ы

- Test, который ловит найденную причину (unit или contract), сначала красный на нынешнем коде.
- macOS e2e test Auberge-размерного старта — зелёный в job-е `macos-e2e` на head PR без карантина.

## Готово, когда

- [ ] «Итог»: таблица этапов старта на runner-е (ms и доля `N`) и commit или смена runner-а, после которых старт
      стал медленнее.
- [ ] Test на найденную причину — сначала красный, после починки зелёный.
- [ ] Предел Auberge-test-а на CI зависит от замеренной базы, не от одной скорости runner-а; потолок
      `RUNNER_START_CAP_MS` = 7300 остаётся верхней границей, `START_MS` = 3000 не поднят;
      `test/unit/e2e-start-budget.test.ts` проверяет новое правило. (Пункт 3 Ticket-а 151.)
- [ ] Карантин снят: `test/quarantine/epic-frame-auberge-start-macos-ci.json` удалён, test объявлен через `test`;
      `test/unit/quarantine.test.ts` зелёный. (Пункт 4 Ticket-а 151.)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job `macos-e2e` с этим test-ом —
      зелёный с первой попытки.
