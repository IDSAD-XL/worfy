# 152 — Причина медленного старта Auberge-размерного Project-а: замер и починка до конца карантина 2026-12-09

Type: bug
Status: claimed 2026-11-27T09:24Z
Branch: worfy-polish/152
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

## Итог

### Замер на runner-е

Временный профиль старта (в PR его нет): CPU profile renderer-а и main process, `performance.mark`, Long Animation
Frames и время каждого IPC-вызова, в job-е `macos-e2e` ветки этого Ticket-а, четыре push-а, 2026-11-27. Таблица — push
3 (CPU profile без minify), `N` = 5511 ms, `R` = 1770 ms; от начала загрузки страницы окна.

| Этап | Окно, ms | ms | Доля `N` |
| --- | --- | --- | --- |
| Загрузка страницы и разбор bundle-а | 0–692 | 692 | 12.6 % |
| Старт приложения, IPC, рендеры до Canvas-а (items Assistant-а: `Intl` в `shortTime`, `takeCarriedNote` из `localStorage` 64 ms); main занят | 692–1832 (ответ workflow — 1832) | 1140 | 20.7 % |
| Первый рендер Canvas-а (`buildEpicNodes` 128 ms), кадр с DOM на 2472 | 1911–2833 | 922 | 16.7 % |
| Полный повторный рендер всех карточек после ответа Pipeline-а (новые `cards` на 3042) | 2940–3771 | 831 | 15.1 % |
| Ещё один полный рендер после второй смены `cards` + замер Stepper-а 171 ms + `branchesInWork` 111 ms | 3899–4979 | 1080 | 19.6 % |
| Проверки Playwright, снимки trace, последний кадр | 4979–5511 | 532 | 9.7 % |
| Промежутки между этапами | — | 314 | 5.7 % |

Главное — два повторных рендера всех карточек (34.7 % `N`): ответы, пришедшие после первого кадра (имена Stage-ей
Pipeline-а, репозитории Project-а, ответ ELK с теми же местами), давали `buildEpicNodes` новые объекты Node-ов каждого
Epic-а при той же раскладке, и React Flow рисовал все 682 карточки заново; `TicketNode` создавал `subject` слотов
каждый рендер, так что слоты (badges, actions) рисовались тоже; `branchesInWork` проходил 682 Ticket-а один раз на
каждую карточку (187 ms). ELK не держит интерактивность: его ответы приходили после неё.

Остальное `N` (вне файлов Ticket-а, не правилось): main `pipeline.get` ждёт 961–1342 ms — 11 вызовов `gh pr list`
подряд (`src/main/github/prs.ts`); `useLayoutEffect` без deps в `src/renderer/session/composer/Pickers.tsx` — 137 ms
повторных layout-ов; замер переполнения в `src/renderer/pipeline/Stepper.tsx` — 247 ms; около 125 вызовов
`limits.open`, `autopilot.estimate` и `stories.running` от каждой рамки Epic-а; синхронная часть `spawn()` в main —
около 300 ms.

### Когда стало медленнее

Ни один commit и ни одна смена образа. 108 job-ов `macos-e2e` main 2026-11-09…25 (раньше test не печатал строку
`auberge-size`), все на `macos-26-arm64`, образы 20261028.624 → 20261103.629 → 20261111.635:

| Период | Медиана `N`, ms | Медиана `R`, ms | Медиана `N / R` |
| --- | --- | --- | --- |
| 11-09…12 | 3979 | 1130 | 3.42 |
| 11-13…16 | 3654 | 1118 | 3.42 |
| 11-17…20 | 3864 | 1250 | 3.21 |
| 11-21…25 | 4157 | 1241 | 3.36 |

`N` за период — 1814–7534 ms на одном и том же коде: разброс между машинами runner-а, не шаг во времени. Числа
2026-10-28 в `start-budget.ts` (`N` 1736–4853 ms) — четыре отдельных замера в пределах того же разброса. Красные
job-ы Ticket-а 150 — медленные машины, на которых `6 × R` упирался в потолок 7300 ms.

### Починка

- `src/renderer/canvas/sources/epics.ts`: если новые входы дают Epic-у ту же раскладку (те же Ticket-ы, сохранённое,
  свёрнутость, `doneExpanded`, `reserve` и `layout`), `buildEpicNodes` оставляет прежние объекты Node-ов.
- `src/renderer/canvas/nodes/TicketNode.tsx`: слоты карточки — `memo`-компонент, `subject` — `useMemo`.
- `src/renderer/canvas/badges/use-checks.ts`: `branchesInWork` читает один список Ticket-ов один раз (`WeakMap`).
- `src/renderer/canvas/arrangement-record.ts`: эффект записи раскладки срабатывает и на `settled` — без этого ответ ELK
  с прежними местами больше не менял Node-ы, и запись первого открытия не писалась (red на
  `test/unit/epic-arrangement-record.test.tsx` и `test/e2e/arrange-by-epic.spec.ts:138` в CI push-а 4).

Test-ы: `test/unit/epic-node-memo.test.tsx` (поздние ответы не рисуют слоты заново; тот же Node при новых `cards`) и
`test/unit/checks-badges.test.tsx` (один список — один массив): на коде `main` exit 1, 3 failed; с починкой exit 0.

Эффект на runner-е, push 4 (быстрая машина, `R` = 930 ms): `N` = 2338 ms, `N / R` = 2.51; два повторных рендера —
длинные кадры 146 и 110 ms вместо 831 и 1080 ms; первый рендер 393 ms. До починки `N / R` трёх push-ей — 3.21, 2.53,
3.11: по одной выборке на push эффект в `N / R` не отделить от разброса машин, его показывают длинные кадры.

### Предел от замеренной базы

`START_RATIO` 6 → 5, формула прежняя: `min(7300, max(3000, 5 × R))` на GitHub Actions. Из тех же 108 job-ов: `N / R` —
медиана 3.33, 95-й процентиль 4.63, максимум 5.44 (код до починки). 5 выше 95-го процентиля: код до починки прошёл бы
в 103 из 108 job-ов; потолок решает только при `R` ≥ 1460 ms, то есть `R` задаёт предел в 83 из 108 job-ов (при 6 — в
56). `RUNNER_START_CAP_MS` = 7300 и `START_MS` = 3000 не менялись. `test/unit/e2e-start-budget.test.ts` проверяет 5,
переход на потолок на 1460 ms и выборку push-а 4.

### Карантин

`test/quarantine/epic-frame-auberge-start-macos-ci.json` удалён, test объявлен через `test(...)`.
