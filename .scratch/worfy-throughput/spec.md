# worfy-throughput: Ticket проходит путь claim → merge быстрее — один gate full на Wave, экран не блокируется, вердикт Windows без ручного разбора

Status: по решению владельца 2026-10-16 («Согласен с твоими идеями улучшения, давай делать»);
разбиение на Ticket-ы, «Готово, когда» и «Соглашения» — предложение этого docs-PR
Source: замер критического пути Ticket-ов скриптом `scripts/critical-path.mjs` (`worfy-reliability` 04)
по пяти закрытым Epic-ам, сделан Session Orchestrator-а 2026-10-16 по main `99b18c8`; разбор кода
и Harness по тому же main. [CONTEXT.md](../../CONTEXT.md) — термины; ADR
[0034](../../docs/adr/0034-autopilot-keeps-display-awake.md),
[0056](../../docs/adr/0056-windows-checks-and-two-sessions.md); Epic
[worfy-reliability](../worfy-reliability/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-throughput`, 5 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-reliability (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`,
`ticket` и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Откуда

Замер — `node scripts/critical-path.mjs --epic <эпик> --repo IDSAD-XL/worfy --csv` по Epic-ам
`worfy-polish`, `worfy-reliability`, `worfy-week`, `worfy-review`, `worfy-ui`: 81 Ticket, полные
данные по всем шагам — у 61.

| Шаг | Сумма | Доля | Медиана |
| --- | --- | --- | --- |
| claim → PR | 41 h | 22 % | — |
| PR → зелёный CI | 83 h | 45 % | 16 min |
| CI → вердикт Gate | 13 h | 7 % | 9 min |
| Gate → merge | 45 h | 25 % | 12 min |
| Total claim → merge | — | — | 79 min (среднее 179 min) |

Что из этого следует:

- **Самые длинные хвосты — ожидание вне конвейера, а не работа агентов.** `worfy-review` 06 —
  49 h PR → CI; `worfy-review` 05 — 9 h Gate → merge; `worfy-polish` 13 — 9 h (ждал gate full на
  Windows-ПК). PR → CI в сумме — 45 %, но медиана — 16 min: сумму делают доработка и долгие
  ожидания.
- **Экран Mac заблокировался ночью 2026-10-16 — мержи стояли около 5,5 h.** Прогон Autopilot
  `worfy-polish` остановился в 04:39 по местному времени (`run-stopped`, причина `blocked-tickets`,
  журнал прогона от 2026-10-15 16:17Z). Дальше PR вливала Session Orchestrator-а вне Autopilot, и
  экран никто не держал. Следующий мерж в main — 10:09 (`git log origin/main`, PR #372). Пока экран
  заблокирован, Electron не показывает окно, и каждый e2e падает на первом окне (урок
  `docs/lessons/agents.md:47-54`).
- **Мерж идёт строго по очереди, и каждый мерж дорогой.** Каждый PR с кодом перед мержем: rebase на
  свежий main, `GATE_SCOPE=all gate full` (около 11,5 min, замер на #360 и #345), затем CI на Linux.
  Wave 1 `worfy-polish` (10 Ticket-ов): последний PR готов к Gate на 293-й минуте после старта Wave,
  последний мерж — на 307-й, а сумма Gate → merge по Wave — 611 min. Wave, начатая 2026-10-15 в 16:17:
  последний PR готов на 592-й минуте, последний мерж — на 892-й.
- **Implementer-ы с тяжёлыми e2e.** `worfy-polish` 04 — 220 min до PR, 05 — 216 min: 10 повторов e2e
  под нагрузкой CPU, а замок e2e `/tmp/worfy-e2e.lock` у всех implementer-ов и Orchestrator-а один.
  Оба Ticket-а — охота на flaky test-ы, и повторы требовал их собственный «Готово, когда»
  (`.scratch/worfy-polish/issues/04-три-нестабильных-e2e-ждут-состояние.md:26-28`).
- **Доработка:** 22 Ticket-а из 81 (27 %), всего 28 кругов. Ревью и Linux CI дешёвые. Ожидание
  Limits — 0 h.

Сверка с кодом и Harness (main `99b18c8`) нашла, что часть мер уже есть, — это учтено в Ticket-ах:

- Autopilot **уже** держит экран включённым весь прогон: `powerSaveBlocker` типа
  `prevent-display-sleep` (`src/main/autopilot/power.ts:19`, берётся в `src/main/autopilot/run.ts:566-567`,
  ADR-0034), и подсказка кнопки Autopilot это говорит («The display stays on until the run ends»,
  `src/renderer/canvas/actions/AutopilotAction.tsx:60`). Ночью 2026-10-16 прогона уже не было.
- Правило «implementer-ы Wave не гоняют весь `pnpm test:e2e`» уже соблюдается, но нигде не записано:
  его ставит бриф Orchestrator-а («целиком его implementer-ам Wave запускать нельзя»,
  `.scratch/worfy-polish/issues/05-waitfortimeout-в-e2e-на-ожидание-состояния.md:38-39`). В Harness и
  Profile про e2e implementer-а — ни слова.

## Цель

Путь Ticket-а от «готов к мержу» до main короче: Wave вливается после одного gate full, а не после
gate full на каждый PR. Мержи не стоят из-за заблокированного экрана. Правило о e2e implementer-а
записано. Вердикт Windows для платформенного PR — gate full на ПК без ручного разбора известных
падений. Эффект измерен тем же скриптом.

Epic готов, когда:

1. Orchestrator вливает все готовые PR Wave после одного `GATE_SCOPE=all gate full` на общем дереве;
   красный gate находит виноватый PR делением набора пополам, ни один PR не вливается при красном
   наборе; решение записано в ADR-0065 (Ticket 01).
2. Пока Orchestrator вливает PR вне Autopilot, экран не гаснет; заблокированный экран перед gate full
   — одна строка «экран заблокирован», а не красный e2e (Ticket 02).
3. Harness и Profile говорят implementer-у: e2e — только spec-и, которые Ticket трогает; весь
   `test:e2e` — в gate full Orchestrator-а перед мержем; повторы e2e — только по слову Ticket-а
   (Ticket 03).
4. Платформенный PR получает вердикт Windows — gate full на ПК, код 0 и `[gate] зелено (full)` — без
   временного реестра Gate и без сверки со списком известных падений (Ticket 04).
5. Повторный замер по Epic-ам после этого показывает: медиана и сумма Gate → merge на Wave ниже, чем в
   разделе «Откуда» (Ticket 05).

## Решения владельца

2026-10-16, после разбора замера: «Согласен с твоими идеями улучшения, давай делать».

1. **Пять идей — пять Ticket-ов:** один gate full на Wave (01), экран и заблокированный экран (02),
   e2e implementer-а (03), вердикт Windows (04), повторный замер (05).
2. **Правки Harness и Profile** этого Epic-а (01, 02, 03) идут по этому слову владельца.

Решено без владельца, подтвердить:

- **Ticket 02 сужен.** Идея была «Autopilot держит экран включённым». Это уже сделано (ADR-0034,
  раздел «Откуда»). Дыра — в другом: мержи вне прогона Autopilot ведёт Session Orchestrator-а, и
  экран не держит никто. Ticket 02 закрывает именно её и делает правилом проверку заблокированного
  экрана перед gate full.
- **Ticket 03 — запись уже действующего правила.** Оба замеренных тяжёлых implementer-а (`worfy-polish`
  04, 05) гоняли повторы e2e по собственному «Готово, когда», и это правило Ticket 03 сохраняет.
  Выигрыш Ticket-а 03 — меньше ожидания общего замка e2e и ясный шаблон «Готово, когда», а не
  десятки минут на Ticket. Ticket 05 это проверит.
- **Новый Ticket о реестре Gate на Windows не заводится.** Запись в реестре Gate пишет
  `harness/bin/project-connect` (`:391-396`), на Windows его запускает «Add project» —
  `worfy-windows` 30. До него — один ручной шаг Session на ПК (Ticket 04).

## Не в этом Epic-е

- **Ускорение работы implementer-а до PR** (claim → PR, 22 %) — модели, effort, длина брифа. Замер не
  показал там очевидного ожидания.
- **Ожидания владельца** (`worfy-review` 06 — 49 h, `worfy-review` 05 — 9 h): это решения человека,
  не конвейер.
- **Сокращение доработки (27 %)** — тема ревью, а не мержа; `worfy-reliability` 02 уже разбирал
  застрявшие Ticket-ы.
- **macOS- или Windows-раннер на PR** — правило владельца: Actions дешёвые, только Linux.
- **Закрытая крышка и экран, заблокированный вручную** — worfy их не обходит (ADR-0034, пункт 3).
- **Новые Ticket-ы `worfy-windows`.** Ticket 04 упорядочивает уже заведённые: 53, 51, 14, 30.

## Риски

- **Общее дерево ≠ main после мержей.** Squash-мерж на GitHub и локальное слияние веток могут дать
  разные деревья. Ticket 01 сверяет хеш дерева main после последнего мержа с проверенным; не совпало
  — gate full на main сразу, новых мержей нет.
- **Flaky test в общем gate full** краснит весь набор. Деление пополам тогда находит «виноватого»,
  которого нет. Ticket 01 повторяет красный e2e-файл отдельно, прежде чем делить набор (урок
  `docs/lessons/agents.md:38-46`).
- **Один красный PR задерживает соседей** на log₂(N) прогонов gate full (около 11,5 min каждый). При
  10 PR — до четырёх прогонов, всё равно меньше, чем 10 прогонов сейчас.
- **Общий файл с `worfy-windows`.** `worfy-windows` 07 и 17 (оба open) правят
  `harness/skills/epic-wave/SKILL.md`, разделы 1 и 4, — те же, что Ticket 01. Перед Wave — проверка
  открытых PR второго Epic-а (ADR-0056, пункт 5).
- **Profile вне репозитория.** `rules.md` Profile-а worfy лежит в
  `~/.claude/worfy-harness/projects/worfy/` (CONTEXT.md, термин Profile; `harness/profiles/README.md:39-41`).
  Его правку PR не показывает: она — шаг Orchestrator-а после мержа, diff — в «Итог» Ticket-а.

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-reliability](../worfy-reliability/spec.md), раздел «Соглашения для Ticket-ов этого
Epic-а»: сначала падающий test, только чтение чужих файлов, ручные пункты «(вручную)», Autopilot над
worfy — только на Stable copy, без `gh auth switch`, мерж в main — по очереди. Отличия:

- **Кто ведёт.** Autopilot может брать 01, 02 и 03 (команда `/worfy:epic-wave tickets 01, 03 of epic
  worfy-throughput`): их код — `harness/` и тексты Harness. Правку `rules.md` Profile-а и ручные пункты
  делает Orchestrator после мержа. 04 и 05 ведёт только Session Orchestrator-а: 04 — порядок Ticket-ов
  `worfy-windows` и шаг на Windows-ПК, 05 — замер и отчёт. В команду Wave Autopilot 04 и 05 не входят.
- **Конец Ticket-а** — `pr-green-ci`: PR, зелёный CI на Linux, gate full на Mac перед мержем, мерж —
  Orchestrator. Пока Ticket 01 не влит и Harness не обновлён — мерж по старой схеме, по одному.
- **Когда правка Harness действует.** Живой Harness — копия, которую несёт сборка worfy
  (`src/main/harness/bundled.ts:1-5`). Правка `harness/` действует на Mac после обновления Stable copy
  и Harness из неё. Ручной пункт «новая процедура на настоящей Wave» — после этого.
- **Ветки** — `worfy-throughput/<NN>`; worktree — `.claude/worktrees/<NN>`, если путь занят деревом
  другого Epic-а — `.claude/worktrees/tp-<NN>`.
- **ADR.** Ticket 01 меняет правило «каждый PR перед мержем — rebase и свой gate full»
  (`rules.md` Profile-а) и уточняет ADR-0056, пункт 6. Для него зарезервирован **ADR-0065**
  (следующий свободный на main `99b18c8`; в открытых PR номеров ADR нет). ADR — часть Ticket-а 01.
  Остальным Ticket-ам новый ADR не нужен. Принятые ADR не правятся.
- **Скрипты Harness — на Node** (`#!/usr/bin/env node`), как `harness/bin/ticket`: Harness идёт и на
  Windows (ADR-0055).
- **Без платных прогонов.** Ни одного запуска настоящего Claude Code или Agent SDK ради test-ов. Test-ы
  Harness — shell test-ы `harness/bin/tests/*.test.sh` на временном репозитории и stub-е gate.
- **Чужие данные — только чтение.** Журналы Autopilot и `.scratch/` читаются; в отчёты идут номера
  Ticket-ов, PR и время, без личных путей.
- **«Готово, когда» новых Ticket-ов** (правило Ticket-а 03): implementer гоняет e2e только своих
  spec-ов; строка про gate full — «gate full — шаг Orchestrator-а перед merge».
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. e2e и `.app` — локально перед
  мержем: `GATE_SCOPE=all` gate full (команда — `rules.md` Profile-а worfy).
- **Язык.** Документы — русские, термины — латиницей, из `CONTEXT.md`; текст Harness, коммитов и код —
  английский.

## Порядок

Первым — 01: он даёт основной выигрыш (Gate → merge — четверть всего времени, и вся она — очередь).
Параллельно с ним — 03 (свой файл) и 04 (работа Session на Windows-ПК, файлов этого репозитория не
трогает). 02 — после 01: оба правят `harness/skills/epic-wave/SKILL.md`, и 02 встраивает проверку
экрана в скрипт Ticket-а 01. 05 — последним: ему нужны Epic-и, которые прошли по новой процедуре.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/profiles/README.md`, `harness/bin/profile`, `harness/bin/tests/profile.test.sh`, `docs/adr/0065-one-gate-full-per-wave-merge-set.md` | 1 |
| 02 | `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`, `harness/skills/epic-wave/SKILL.md`, `docs/lessons/agents.md` | 2 |
| 03 | `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh` | 1 |
| 04 | — | 1 |
| 05 | — | 3 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, 03 и 04.** Блокеров нет, общих файлов нет. Autopilot берёт 01 и 03; 04 ведёт
  Orchestrator вместе с Session на Windows-ПК.
- **Wave 2 — 02.** `Blocked by: 01`, общие с 01 файлы `harness/bin/wave-gate`, его test и
  `harness/skills/epic-wave/SKILL.md`.
- **Wave 3 — 05.** `Blocked by: 01, 02, 03`. Ведёт Orchestrator, когда по новой процедуре прошли
  хотя бы две Wave-ы по 5 и больше Ticket-ов.

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts:158`). Правка `rules.md`
Profile-а worfy в таблицу не входит: файл вне репозитория. Если исполнителю нужен файл вне своего
списка, он дописывает его в «Где в коде» при claim.
