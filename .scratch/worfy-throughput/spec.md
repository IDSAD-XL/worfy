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
  (`.scratch/worfy-polish/issues/04-три-нестабильных-e2e-ждут-состояние.md:43`).
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
   красный и при повторе gate находит виноватый PR делением набора пополам, ни один PR вне зелёного
   префикса не вливается; база и дерево main сверяются на каждом мерже; платформенные PR и PR с меткой
   `needs-mac-gate` вливаются по-старому; решение записано в ADR-0065 (Ticket 01).
2. Пока идут проверка набора и мержи вне Autopilot, экран не гаснет (`caffeinate` самих команд);
   заблокированный экран перед gate full — одна строка «экран заблокирован», а не красный e2e
   (Ticket 02).
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
  разные деревья, а main может уйти, пока идёт проверка. Ticket 01 записывает SHA базы и дерево после
  каждого PR порядка мержа: перед первым мержем база должна совпасть, после каждого мержа дерево main
  — с проверенным префиксом; первое несовпадение — стоп.
- **Flaky test в общем gate full** краснит весь набор. Деление пополам тогда находит «виноватого»,
  которого нет. Ticket 01 сначала повторяет gate full на всём наборе: зелёный повтор — flaky test
  записан, мерж идёт (урок `docs/lessons/agents.md:38-46`).
- **Один красный PR задерживает соседей** на 1+⌈log₂ N⌉ прогонов gate full (повтор и деление, около
  11,5 min каждый). При 10 PR — до шести прогонов вместе с первым, всё равно меньше 10 прогонов сейчас.
  Прогон долгий: `wave-gate` идёт в фоне и продолжает с записанного состояния после обрыва.
- **Платформенные PR не ускоряются.** PR, которым нужен вердикт Windows (ADR-0056, пункт 2), и PR
  Session на Windows-ПК с меткой `needs-mac-gate` остаются вне набора. Ticket-ы 01 и 02 этого Epic-а —
  сами платформенные (скрипты Harness): их вердикт Windows — в их «Готово, когда».
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
  `worfy-windows` и шаг на Windows-ПК, 05 — замер и отчёт. В команду Wave Autopilot 04 и 05 не входят:
  их Status — `blocked — research: …; Autopilot не берёт`, как у `worfy-reliability` 02.
- **Платформенные PR.** 01 и 02 меняют скрипты Harness — по ADR-0056, пункт 2, это платформенные PR:
  перед мержем — вердикт Windows (их «Готово, когда»). 03 меняет только текст агента — не платформенный.
- **Конец Ticket-а** — `pr-green-ci`: PR, зелёный CI на Linux, gate full на Mac перед мержем, мерж —
  Orchestrator. Пока Ticket 01 не влит и Harness не обновлён — мерж по старой схеме, по одному.
- **Когда правка Harness действует.** Живой Harness — копия, которую несёт сборка worfy
  (`src/main/harness/bundled.ts:1-5`). Правка `harness/` действует на Mac после обновления Stable copy
  и Harness из неё. Ручной пункт «новая процедура на настоящей Wave» — после этого.
- **Ветки** — `worfy-throughput/<NN>`; worktree — `.claude/worktrees/<NN>`, если путь занят деревом
  другого Epic-а — `.claude/worktrees/tp-<NN>`.
- **ADR.** Ticket 01 меняет три правила — rebase и gate full на каждый PR (`rules.md` Profile-а),
  CI на Linux заново перед мержем и gate full на Windows заново после rebase (ADR-0056, пункт 6; теперь
  только для PR вне набора) — и задаёт revert при красном CI на main. Для него зарезервирован **ADR-0065**
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
| 01 | `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/profiles/README.md`, `harness/profiles/draft.schema.json`, `harness/README.md`, `harness/bin/profile`, `harness/bin/tests/profile.test.sh`, `docs/adr/0065-one-gate-full-per-wave-merge-set.md` | 1 |
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

## Решения владельца 2026-10-20: скорость test-ов (Ticket-ы 10–15)

Дата решения: 2026-10-20. Разбор вопросов (grilling) Q1–Q7 с владельцем; ответ владельца — «Да на все
семь, начинай с Q7». Решения ниже записаны в ADR
[0081](../../docs/adr/0081-per-pr-linux-ci-shards-and-affected-tests.md) (статус «принят» 2026-10-20: per-PR CI
на Linux с shard-ами и выбор test-ов по diff; полный набор — на `main` batch-ем). Он частично заменяет
ADR-0068 (batch CI на `main`, CI на PR нет) и ADR-0065 (один gate full на набор PR Wave).

### Откуда

Замер 2026-10-20 по main `0419b38c`.

| Факт | Значение |
| --- | --- |
| Test-файлов в `test/unit`, `test/contract`, `test/e2e` | 173 (10-07), 252 (10-10), 294 (10-13), 347 (10-16), 404 (10-19), 435 сейчас (224 / 123 / 88) |
| Рост | около 20 файлов в день, в 2,5 раза за 13 дней |
| Test case-ов | около 3260 unit, около 2190 contract, около 290 e2e; ещё 38 test-файлов Harness |
| Выбор test-ов в gate | `harness/hooks/gate.mjs` сужает набор только по пакету; worfy — один пакет, поэтому любая правка `.ts` запускает весь список скриптов. `--changed`, `related` и shard-ов нет. В cache кладётся только зелёный результат, по отпечатку содержимого |
| Playwright | `workers: 1`, `fullyParallel: false` (`playwright.config.ts`); 87 из 88 e2e-файлов запускают Electron (`launchApp` → `_electron.launch`, `test/e2e/helpers.ts:146`), кроме `linked-autopilot.spec.ts` |
| CI на PR | нет (ADR-0068) |
| `ci.yml`, job `check` на `main` | медиана 14,4 min, максимум 18,3 min по 37 зелёным CI run-ам; шаг unit + contract — около 16 из 18 min на стандартном runner-е `ubuntu-latest` (для приватного репозитория — 2 vCPU; по логу CI не подтверждено) |
| gate fast / full на Mac | настоящее время run-а неизвестно: gate не печатает длительность шагов, времени по файлам нет |
| Тяжёлые test-ы | 87 unit- и contract-файлов запускают настоящие процессы; в `test/` около 500 вызовов `setTimeout` / `sleep` / `waitForTimeout` (482–528 в зависимости от способа подсчёта); комментарий в `vitest.config.ts`: contract test один идёт около 1 s, в полном наборе на нагруженном Mac — 4–5 s |
| Flaky test-ы под нагрузкой | `worfy-polish` 30 (contract test-ы краснят gate full чужих PR), 32 (`wave-gate.test.sh` дольше предела), 34 (flaky test-ы gate full 2026-10-19) |

Что из этого следует: набор test-ов растёт быстрее, чем ускоряется его run, а каждый PR с кодом
перед мержем гоняет весь набор. Сколько времени это стоит на Mac, никто не знает — поэтому первым идёт
замер (Q7).

### Решения

- **Q1 — метрика.** Время на часах от «код готов, проверки зелёные» до merge, по каждому Ticket-у.
- **Q2 — бюджет.** Ticket без UI вливается не позже 15 min после зелёных проверок, Ticket с UI — не
  позже 30 min.
- **Q3 — что нужно для merge.** PR вливается после CI на Linux и test-ов, которые задевает его diff.
  gate full на каждый PR не нужен; исключение — платформенный PR и PR с меткой `needs-mac-gate`
  (ADR-0065, пункт 5). Полный набор идёт на `main` batch-ем. Красный `main` — автоматический поиск
  виноватого commit-а делением пополам (bisect) и revert.
- **Q4 — CI на PR возвращается, только Linux.** unit + contract — в 3–4 параллельных shard-ах на
  `ubuntu-latest`. Job-ов на macOS по-прежнему нет. Это заменяет часть ADR-0068 «CI на PR нет» и прежнее
  правило владельца «без матриц в CI».
- **Q5 — e2e и собранное приложение.** Перед merge — только когда diff трогает renderer, main process,
  упаковку или watcher-ы (список путей — в Profile-е Project-а). Иначе — ночной run на `main`.
- **Q6 — аудит test-ов.** Убирать или сливать дублирующие test-ы — только с доказательством, что код
  остаётся покрыт (coverage или mutation testing), и только после того, как влиты Q3–Q5. Правило для
  новых Ticket-ов: test — в одном слое; второй слой требует причины в описании PR.
- **Q7 — первым.** Замер до любой смены процесса.

### Ticket-ы

| Ticket | Что | Решение | Blocked by |
| --- | --- | --- | --- |
| [10](issues/10-время-шагов-gate-и-test-файлов.md) | gate печатает и пишет время шагов; vitest и Playwright пишут JSON с временем по файлам; скрипт печатает N самых медленных файлов | Q7 | — |
| [11](issues/11-pr-вливается-по-задетым-test-ам-полный-набор-на-main.md) | Выбор test-ов по diff для PR; полный набор на `main` batch-ем; bisect и revert на красном `main` | Q3 | 10, 12 |
| [12](issues/12-ci-на-linux-на-каждый-pr-shard-ами.md) | CI на Linux на каждый PR, unit + contract в 3–4 shard-ах | Q4 | 10 |
| [13](issues/13-e2e-и-package-до-мержа-только-по-путям-diff.md) | e2e и `test:package` до merge — только по списку путей; ночной run всего набора на `main` | Q5 | 10, 11 |
| [14](issues/14-бюджет-времени-от-зелёных-проверок-до-мержа.md) | Время от зелёных проверок до merge по Ticket-у и отчёт о превышении бюджета | Q1, Q2 | 10 |
| [15](issues/15-аудит-test-ов-и-правило-одного-слоя.md) | Аудит дублирующих test-ов и правило одного слоя | Q6 | 11, 12, 13 |
| [16](issues/16-shell-test-ы-harness-параллельно.md) | Shell test-ы Harness идут параллельно: `harness-scripts.test.ts` (517 s из 519 s шага `test`) больше не держит весь `pnpm test` | замер 10; «да» владельца 2026-10-20 | — |
| [17](issues/17-e2e-в-несколько-worker-ов.md) | e2e в несколько worker-ов Playwright: после 16 последовательный e2e — 565 s, около 73 % gate full 12,9 min | замер 10 после 16; приоритет — за владельцем | — |
| [18](issues/18-окно-не-показывается-fallback-и-диагностика.md) | Окно не показывается в e2e при 3 worker-ах: fallback show по timer-у после `did-finish-load`, диагностика timeout-а первого окна, switch-и отрисовки для каждого e2e-запуска | разбор 2026-10-21 после 17 (2 из 4 gate full красные) | — |

### Порядок

1. **10 — первым** (Q7). implementer работает над ним с 2026-10-20; claim не сделан, потому что файла
   Ticket-а не было на `main` до этого docs PR. Без его чисел нельзя выбрать число shard-ов (12), проверить
   выигрыш выбора test-ов (11) и поставить базу бюджета (14).
2. **16** — сразу, параллельно с merge 10: замер 10 показал, что один файл `test/contract/harness-scripts.test.ts`
   идёт 517 s из 519 s шага `test`; владелец 2026-10-20 сказал «да» отдельному Ticket-у до 11–13.
   Число shard-ов 12 считать после 16. Влит 2026-10-21 (#626): gate full на Mac 18,5 → 12,9 min,
   `pnpm test` 517 → 133 s. После него узкое место — последовательный e2e: Ticket 17 влит 2026-10-21 (#655), e2e в 3 worker-а на
   macOS: 565 → 212 s, gate full 780 → 501 s под нагрузкой. Ticket 18 влит 2026-10-21 (#661): fallback show
   окна и диагностика старта; после него 3 worker-а — 204–227 s, 289 passed, без flaky.
3. **12 и 14** — после 10, параллельно: 12 правит CI и тексты ожидания CI, 14 — скрипт замера.
4. **11** — после 10 и 12 (`Blocked by: 10, 12`): PR без полного набора безопасен, только
   когда у него есть CI на Linux, а 11 и 12 правят одни тексты Harness (`harness/skills/epic-wave/SKILL.md`,
   `harness/skills/ship-ticket/SKILL.md`) и `harness/bin/wave-gate`.
5. **13** — после 11: те же тексты Harness и тот же шаг перед merge.
6. **15** — последним, когда влиты 11, 12 и 13 (условие Q6).

### Волны Ticket-ов 10–18

План по правилу раздела «Волны» выше: общий файл в «Где в коде» — Ticket с большим номером уходит в
следующую Wave. Основную таблицу «Волны» этот раздел не меняет; Wave этих Ticket-ов берётся командой
`/worfy:epic-wave tickets NN, NN of epic worfy-throughput`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 10 | `harness/hooks/gate.mjs`, `harness/hooks/gate-log.mjs`, `harness/hooks/tests/gate-log.test.sh`, `vitest.config.ts`, `scripts/vitest-electron.mjs`, `playwright.config.ts`, новый скрипт в `scripts/` | 1 |
| 12 | `.github/workflows/ci.yml`, `test/contract/ci-workflow.test.ts`, `harness/bin/profile`, `harness/bin/tests/profile.test.sh`, `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh`, `harness/profiles/README.md`, `harness/profiles/draft.schema.json`, `docs/adr/0081-…` | 2 |
| 14 | `scripts/critical-path.mjs`, `test/unit/critical-path.test.ts` | 2 |
| 11 | `harness/hooks/gate.mjs`, `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh`, `vitest.config.ts`, `scripts/vitest-electron.mjs`, новый скрипт выбора test-ов в `scripts/` | 3 |
| 13 | `harness/bin/profile`, `harness/bin/tests/profile.test.sh`, `harness/bin/wave-gate`, `harness/skills/epic-wave/SKILL.md`, `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh`, `harness/profiles/README.md`, `harness/profiles/draft.schema.json` | 4 |
| 15 | `test/`, `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh`, `docs/lessons/testing.md` | 5 |
| 16 | `test/contract/harness-scripts.test.ts`, `test/git-bash.ts`, `vitest.config.ts`, `harness/{bin,hooks}/tests/*.test.sh` | 2 |
| 17 | `playwright.config.ts`, `test/e2e/helpers.ts`, `test/e2e/*.spec.ts`, `harness/bin/profile`, `harness/bin/wave-gate` | 6 |
| 18 | `src/main/window.ts`, `src/main/window-show.ts`, `src/main/quiet-windows.ts`, `src/main/index.ts`, `playwright.config.ts`, `test/e2e/helpers.ts`, `test/e2e/start-diagnosis.ts`, `test/e2e/linked-notify.spec.ts`, `test/unit/start-diagnosis.test.ts`, `test/unit/window-show.test.ts`, `test/unit/quiet-windows.test.ts`, `test/unit/e2e-notifications.test.ts`, `test/unit/playwright-json-report.test.ts` | 7 |

### Не решено — вопросы к инструментам

Владелец решил «что», а не «чем». Эти вопросы лежат в разделе «Открытые вопросы» своих Ticket-ов, и
исполнитель не решает их сам — сначала числа Ticket-а 10, затем вопрос владельцу:

- как считать задетые test-ы — `vitest related`, `vitest --changed` или свой граф import-ов плюс
  таблица для test-ов, которые запускают скрипты процессом (Ticket 11);
- как искать виноватый commit на красном `main` и кто делает revert (Ticket 11);
- что делать с красным Windows run-ом на `main`: ADR-0071, пункт 6, опирался на исправление вперёд
  ADR-0068, пункт 3, который заменён (Ticket 11);
- 3 или 4 shard-а и как делить файлы между ними (Ticket 12);
- flaky test: чинить сразу или убирать в карантин (Ticket 12);
- кто и где запускает ночной e2e на `main` без job-а на macOS (Ticket 13);
- что считать Ticket-ом «с UI» для бюджета Q2 (Ticket 14).

### Риски

- **Красный `main` чаще.** Без полного набора на PR сбой в незадетом по графу test-е попадает в `main` и
  находится batch-ем. Цена — bisect и revert (Q3). Ticket 11 меряет, сколько таких сбоев.
- **Граф import-ов не видит процессы.** 87 файлов test-ов запускают настоящие процессы (скрипты Harness,
  `bash`, `git`); правка `harness/bin/*` не задевает их по import-ам. Ticket 11 без таблицы таких связей
  пропускал бы именно contract test-ы.
- **Минуты Actions.** 3–4 shard-а на каждый push в PR — больше минут, чем один batch CI run на Wave.
  2026-10-17 бюджет Actions уже кончался (ADR-0068). Ticket 12 считает минуты на PR до и после.
- **Платформенные PR.** 10–13 меняют скрипты Harness — по ADR-0056, пункт 2, это платформенные PR:
  перед merge нужен вердикт Windows (ADR-0071: полный `pnpm test` на Windows-runner-е GitHub).
