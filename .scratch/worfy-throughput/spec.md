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
3. **2026-10-28 — процесс, Ticket-ы 19–35.** План по аналитике 2026-10-27 принят целиком; CI на GitHub-hosted
   runner-ах на каждый PR и push в `main` — первым. Решения и Wave — раздел «Решения владельца 2026-10-28:
   процесс» в конце spec-а; он заменяет строку «macOS- или Windows-раннер на PR» раздела «Не в этом Epic-е».

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

## Решения владельца 2026-10-28: процесс (Ticket-ы 19–35)

Даты решений: 2026-10-27 — «Все выводы по делу. И это все нужно реализовать приоритетно, прежде чем продолжать
работу», позже — «Продолжай работать, но пока без ПК, делай все что можешь чисто на маке»; 2026-10-28 — ответы
на вопросы плана (раздел «Решения» ниже) и «Переходим на CI раннеры, это приоритет». Источники: аналитика
процесса 2026-10-27 (стоимость по транскриптам Mac 04–27.10: 140 358 вызовов модели, 864 PR, 1 258 CI
run-ов); разбор красных run-ов workflow «Windows tests» с 2026-10-18 (156 run-ов); flaky test-ы gate full на Mac
2026-10-27; код на main `f85f8bc8`. Репозиторий `IDSAD-XL/worfy` публичный с 2026-10-27: GitHub-hosted runner-ы
для него бесплатны.

Этот раздел расширяет Epic Ticket-ами 19–35 и правит открытые 05, 07, 11, 12, 13 и `worfy-polish` 41. Основную
таблицу «Волны» и раздел 2026-10-20 он не меняет; Wave Ticket-ов 19–35 — в своей таблице ниже.

### Цель и числа

| # | Предложение | База (дата, источник) | Цель | Чем мерить |
| --- | --- | --- | --- | --- |
| 0 | Каждый PR и push в `main` проверяются на GitHub-hosted runner-ах; check `ci-ok` — условие merge вместо локального gate full (решение 0) | gate full на Mac — 732,7 s на #860, красный в 13 % run-ов, под load average 30–60 от параллельных агентов | merge без gate full на Mac; `ci-ok` красный только по делу (flaky — в карантине) | Ticket 35 («Итог»: время job-ов), Ticket 14 |
| 1 | Windows: сначала красные и flaky test-ы, потом run `full` на каждый PR автоматически, gate full на ПК раз в Wave | «Windows tests» красный в 38 % run-ов (Linux CI — 6 %; аналитика 04–27.10), 26 % с 2026-10-18 (разбор run-ов); Windows-Ticket от конца работы до merge — 2,5 h против 0,6 h у прочих; доля Windows-Ticket-ов 7 % → 57 % | красных run-ов ≤ 10 % за две недели; Windows-Ticket до merge ≤ 1 h | Ticket 19, Ticket 14, `gh run list --workflow windows-tests.yml` |
| 2 | Implementer ничего не ждёт; доработка — свежему агенту с коротким брифом; 1 h prompt cache, где ожидание неизбежно | перезапись cache после простоя > 5 min — $2 130, 22 % расхода; из них $1 457 — implementer-ы, которые ждут gate (по ценам API) | перезапись после простоя у implementer-ов ≤ $150 за такой же период; общая доля ≤ 8 % | Ticket 19 |
| 3 | e2e только по задетым путям, flaky test-ы в карантине; набор PR под одну проверку — если `wave-gate` останется (решение 0) | «конец implementer-а → merge» 0,21 → 0,59 h (неделя 1 → 3); `test:e2e` 398 s и `test:package` 117 s из 732,7 s gate full (70 %) | ≤ 0,3 h; macOS job `ci-ok` без UI-путей в diff ≤ 300 s | Ticket 14, время job-ов `ci-ok` |
| 4 | Цикл merge Orchestrator-а одним скриптом в фоне; свежий контекст на Wave | Orchestrator — 21 % расхода, около 295k token-ов контекста на вызов | −30–40 % стоимости Orchestrator-а; ≤ 150k token-ов на вызов в среднем | Ticket 19 |
| 5 | Test размера стартового контекста агента, порог около 35k token-ов | стартовый контекст implementer-а 28k → 88k (19–21.10) → 33k (26.10); test-а нет | test красный выше 35k; все агенты Harness ниже порога | Ticket 32 |

Сначала замер (как Q7 от 2026-10-20 — «замер до смены процесса»): Ticket 19 переносит скрипты аналитики в
репозиторий, и база выше считается заново тем же кодом, которым потом считается итог (Ticket 05).

### Решения

0. **CI на runner-ах — первым, Wave 0.** Решение владельца 2026-10-28: «Переходим на CI раннеры, это
   приоритет». Каждый PR и каждый push в `main` проверяются на GitHub-hosted runner-ах: Linux — lint,
   typecheck, unit- и contract-test-ы shard-ами; macOS — `test:e2e` и `test:package`; Windows — `full`
   (`pnpm test`). Один итоговый check `ci-ok` заменяет локальный gate full как условие merge. Ticket
   [35](issues/35-ci-на-github-runner-ах-на-каждый-pr-и-push-в-main.md); работа уже идёт (ветка
   `ci/runners-on-every-pr`). Это решение заменяет: строку «macOS- или Windows-раннер на PR» раздела «Не в
   этом Epic-е» (2026-10-16), Q4 раздела 2026-10-20 (job-ов на macOS нет), ADR-0056 пункт 1, ADR-0068 «CI на PR
   нет», ADR-0071 «только `workflow_dispatch`» — новым ADR Ticket-а 35. Что из этого следует:
   - **Ticket-ы, которые опирались на локальный gate full** (07, 13, 27, 29, 30), меняют цель: не экономить
     Mac, а ускорять и стабилизировать путь до merge через CI. Правки — в их файлах, раздел «Правка
     2026-10-28».
   - **`wave-gate` как путь по умолчанию — под вопросом.** Он нужен был, чтобы гонять один gate full на Mac на
     весь набор PR Wave. С `ci-ok` на каждом head и push в `main` этот довод уходит. Рекомендую: после merge
     Ticket-а 35 оценить, даёт ли проверка общего дерева набора что-то сверх `ci-ok`; это первый шаг Ticket-а
     07 (теперь `Blocked by: 35`). Нет — Profile на `merge_gate: "each"`, 07 и 29 закрываются этим ответом, а
     `land` (27) вливает по одному PR после `ci-ok`.
   - **Карантин flaky test-ов (20, 22, 23, 34) нужнее, чем раньше:** блокирующие run-ы теперь — job-ы `ci-ok`
     на трёх ОС, и flaky test без записи краснит merge каждого PR.
   - Ticket 12 (CI на Linux shard-ами) и Ticket 24 (Windows `full` на PR) пересекаются с 35: что 35 сделал,
     вычёркивается при claim; 24 теперь `Blocked by: 35`.
1. **Epic.** Решение владельца 2026-10-28: план принят целиком — расширить `worfy-throughput` Ticket-ами 19–34
   по Wave-ам ниже (35 добавлен тем же днём, решение 0). Слово владельца на правки Harness в 07, 13, 25–33
   (skills, agents, hooks, скрипты `harness/bin`, `rules.md` Profile-а) и на правки открытых Ticket-ов 05, 11,
   12, 13 и `worfy-polish` 41 дано. Отдельный Epic `worfy-cost` не заводится.
2. **Карантин flaky test-ов (Ticket 20).** Решение владельца 2026-10-28: одна запись на test, у записи —
   владелец (Ticket, который чинит) и дата выхода не позже 14 дней от входа; не больше 15 записей; просроченная
   запись снова краснит (test больше не пропускается, а `quarantine.test.ts` красный с именем записи); без
   автоматического повтора упавшего test-а ни в одном run-е. Форма по рекомендации: файл на запись в
   `test/quarantine/`, поля `file`, `test`, `platforms`, `reason`, `owner`, `since`, `until`; test в карантине
   пропускается в каждом блокирующем run-е и идёт отдельно, не блокируя, командой `WORFY_QUARANTINE=only pnpm
   test`. «Rerun only the failed step» владельца от 2026-10-20 остаётся ручным шагом Orchestrator-а.
3. **Карантин e2e.** Решение владельца 2026-10-28 (план принят целиком): отдельный Ticket 34 после возвращения
   ПК — e2e-файлы и `playwright.config.ts` в `PC_ONLY`. До тех пор flaky e2e (`quiet-windows.spec.ts`, проверка
   Dock) — ручной повтор упавшего шага.
4. **Чем считать задетые test-ы (Ticket 21).** Решение владельца 2026-10-28 (план принят целиком): граф модулей
   vite (`vitest related` / `vitest list`) плюс своя таблица для test-ов, которые запускают скрипты процессом
   или читают файлы как текст; неизвестный путь — весь набор; окончательный выбор — по фикстурам Ticket-а 21.
5. **Windows-runner.** Решение владельца 2026-10-28: «Full на каждый PR автоматически» (было в черновике:
   dispatch из `land` только для платформенных PR, `files` до 12 файлов, иначе `full`). Workflow «Windows
   tests» идёт в режиме `full` на каждый pull request сам — триггер `pull_request`, **никогда
   `pull_request_target`** (тот идёт с токеном на запись и secrets на коде из чужого fork-а). Вердикт
   `check/windows` PR-а со scope `runner` — из этого run-а на проверенном head; scope `pc` по-прежнему ждёт ПК
   (до Ticket-а 30 — gate full на ПК на head). Сам run на PR входит в Ticket 35 (решение 0); Ticket
   [24](issues/24-windows-tests-full-на-каждый-pr-автоматически.md) — вердикт из run-а
   (`scripts/windows-run-verdict.mjs`), ADR и правила. Черновой Ticket 24 «прицельный набор по diff» потерял
   довод цены: рекомендую и принято — **влить его в Ticket запуска** (`full` на каждый PR), а выбор файлов по
   diff оставить только как возможную опцию скорости отдельным Ticket-ом, если `full` (около 40 min) станет
   самым долгим шагом до merge. CI на Linux на каждый PR (Ticket 12) больше не вопрос цены; скоуп 12 этим
   решением не меняется (одна строка в его файле). **Шаг владельца, не код:** Settings → Actions → General →
   «Fork pull request workflows from outside collaborators» — оставить одобрение владельцем для внешних
   участников.
6. **Платформенный PR в наборе `wave-gate` (Ticket 29).** Решение владельца 2026-10-28 (план принят целиком):
   Ticket остаётся — PR с `check/windows` `success` на его head входит в набор; после Wave — run `windows-full`
   на `main`; нужен новый ADR (меняет ADR-0065, пункт 5). После решения 0 Ticket нужен, только если оценка
   Ticket-а 07 оставит `wave-gate`.
7. **gate full на ПК раз в Wave (Ticket 30, нужен ПК).** Решение владельца 2026-10-28 (план принят целиком):
   Ticket остаётся. PR со scope `pc` вливается после `ci-ok` (до Ticket-а 35 — run `full` на runner-е и gate
   full на Mac); ПК гоняет gate full на `main` один раз после Wave. Красный — один повтор упавших test-ов
   Session-ом на ПК, затем исправление вперёд; пока `main` красный на ПК, новые PR со scope `pc` не вливаются.
   Автоматического revert-а нет. Нужен новый ADR (меняет ADR-0056, пункт 2).
8. **Implementer и замок e2e (Ticket 25).** Решение владельца 2026-10-28 (план принят целиком): implementer
   ждёт замок не дольше 2 min, затем оставляет свои spec-и проверке перед merge и пишет это в отчёт как
   `e2e: deferred to gate full` (после Ticket-а 35 — «передано `ci-ok`»), не «зелено».
9. **Доработка (Ticket 26).** Решение владельца 2026-10-28 (план принят целиком): по умолчанию — новый
   implementer с коротким брифом (Ticket, PR, ветка, head, список находок, путь к отчёту verifier-а);
   `SendMessage` прежнему — только если он закончил меньше 5 min назад (его cache ещё жив).
10. **1 h prompt cache (Ticket 31).** Решение владельца 2026-10-28 (план принят целиком): не включать для всех.
    Сначала 25 и 26 убирают ожидание, Ticket 19 мерит, у каких ролей остались простои 5–60 min, и только им —
    `experimental.cacheTtl: 1h` в frontmatter агента. Подробности — «Prompt cache на 1 h» ниже.
11. **Что считается стартовым контекстом (Ticket 32).** Решение владельца 2026-10-28 (план принят целиком):
    весь первый запрос агента — system prompt Claude Code и схемы tool-ов (константа, откалиброванная по
    транскриптам), `CLAUDE.md`, правила от hook-ов (`common.md` и правила пользователя), определение агента,
    вывод `bin/profile` с `rules.md`, skill, который агент грузит до первой правки. Порог 35k для implementer,
    reviewer, scout и verifier; подсчёт по байтам с коэффициентом из транскриптов, без вызова API.
12. **Скрипт цикла merge (Ticket 27).** Решение владельца 2026-10-28 (план принят целиком): новый
    `harness/bin/land`, а не подкоманда `wave-gate` (`wave-gate` уже 997 строк, gate предупреждает о файлах
    длиннее 1000). После решения 0 основа `land` — `ci-ok` на head; `wave-gate` он вызывает, только если тот
    останется путём по умолчанию.
13. **Конец Wave у Orchestrator-а (Ticket 28).** Решение владельца 2026-10-28: «бриф и стоп». Orchestrator в
    конце Wave пишет короткий бриф (`bin/wave-brief`, Ticket 28) и останавливается; новую Session начинает
    worfy Autopilot или владелец. Merge — только через `bin/land` (Ticket 27) в фоне: ни своего
    `merge-once.sh`, ни ручного `gh pr merge`.
14. **Платный eval перед merge PR с правками правил Harness** (25, 26, 27, 28, 29, 31, 33). Решение владельца
    2026-10-28 (план принят целиком): `eval --changed` — только с «да» владельца на каждый PR, с ценой из
    команды, которую eval реально запустит (урок 2026-10-22: `--changed` гонял все случаи и стоил $30.29 при
    одобренных ~$1).
15. **Windows e2e на GitHub runner-е (Ticket 44).** Решение владельца 2026-10-28, после merge Ticket-а 35:
    Windows e2e — отдельный job в `ci-ok`. Сначала он не блокирует (только статистика), блокирующим становится
    примерно после пяти зелёных run-ов подряд. Начать с разбора красных Windows e2e (когда-то их было 128; ПК
    снимает свежую базу на `main` `2e70bf0f`).

### Что входит

- Новые Ticket-ы 19–35 (таблица Wave ниже).
- Правки открытых Ticket-ов этого Epic-а и `worfy-polish` 41 (таблица ниже) — в их файлах.

### Что не входит

- **Починка `image-protocol.test.ts` на Windows** («serves nothing over the store's size limit»: ждёт длинный
  путь, получает короткий `RUNNER~1`) — её делает отдельный агент.
- **`wave-gate-lock` DST case на Mac** (shell test замка e2e, красный на переходе на зимнее время) — PR #867.
- **Красные, которые повторяются на ПК каждый раз**, — `worfy-windows` 113 (уведомления при «окне в фокусе»)
  и 114 (e2e `browser-layer` при zoom 0.25). Остаются в `worfy-windows` (решение владельца 2026-10-23).
- **Аудит test-ов** — Ticket 15, без изменений. **Ticket 09** (тексты про `mergeable == UNKNOWN`) — не
  трогается: находки уровня low — не Ticket-ы (правило владельца 2026-10-22).
- **Поднятие timeout-ов отдельных test-ов** — запрещено правилом Profile-а; flaky test-ы лечатся причиной.

### Правки открытых Ticket-ов

| Ticket | Правка |
| --- | --- |
| 05 (повторный замер критического пути) | Добавлены пять чисел «Цель и числа», замер — скриптом Ticket-а 19. `Blocked by: 01, 02, 03, 13, 19, 20, 24, 25, 26, 27, 28, 29, 31, 33` (все Ticket-ы плана, кроме тех, что ждут ПК). |
| 07 (`wave-gate`: дерево набора под `.git/`, красная база ≠ виновник) | `Blocked by: 35`. Первый шаг — оценка, нужен ли `wave-gate` после `ci-ok` (решение 0); нет — Ticket закрывается этим ответом. Остальной текст не меняется. |
| 11 (PR вливается по задетым test-ам, полный набор — на `main`) | Пункт 1 «Что делаем» (команда выбора test-ов по diff) и два первых пункта «Готово, когда» перешли в Ticket 21. `Blocked by: 10, 12, 21`. Вопросы «чем считать задетые test-ы» и «flaky test на красном `main`» закрыты решениями 4 и 2. |
| 12 (CI на Linux на каждый PR shard-ами) | Одна строка: минуты Actions больше не вопрос цены, shard-ы на PR делает Ticket 35 — сверить при claim. Вопрос «flaky test на PR» закрыт решением 2 (Ticket 20). Скоуп не меняется. |
| 13 (e2e и `test:package` до merge только по путям diff) | Было «весь e2e или ни одного». Стало: таблица «путь → spec-и e2e», до merge — только spec-и, которые задевает diff; неизвестный путь в `src/main`, `src/preload`, `src/renderer` — весь `test:e2e`. После решения 0 — это выбор spec-ов для macOS job-а `ci-ok`, весь `test:e2e` — на push в `main`. Список spec-ов — не правкой `playwright.config.ts` (`PC_ONLY`). `Blocked by: 10, 21, 35`. |
| `worfy-polish` 41 (flaky test-ы Windows после пересчёта 2026-10-23) | `workflow-reader` и `workflow-branches-handles` перешли в Ticket 23 (краснеют и на GitHub Windows-runner-е). Добавлены три случая `test/contract/terminal.test.ts`, красные на ПК на main под нагрузкой 2026-10-27, и случаи токена замка e2e в `wave-gate-lock.test.sh` на Windows. `Status: blocked`, `Waits: owner` — нужен ПК. |

### Prompt cache на 1 h — что нашли

Источники (перечитаны 2026-10-28): https://code.claude.com/docs/en/prompt-caching.md, раздел «Cache lifetime»
(подразделы «Which TTL each request gets», «Choose the TTL yourself») и «Subagents and the cache»; цена —
https://platform.claude.com/docs/en/build-with-claude/prompt-caching, раздел «Pricing».

- Claude Code делит запросы на два bucket-а: «main conversation» (интерактивная Session, `-p`, Agent SDK) и
  «everything else» (subagent-ы, workflow, teammates, fork-и, compaction, заголовки Session).
- По умолчанию на подписке Claude в пределах плана main conversation получает 1 h, **subagent-ы — 5 min**
  (кроме нескольких служебных запросов, которыми Anthropic управляет на сервере): «Subagents fall outside the
  main-conversation TTL bucket, so they get five minutes even on a subscription until you choose a longer
  one». На usage credits, API key или облачном провайдере оба bucket-а — 5 min.
- Выбор TTL (значения `5m` или `1h`, Claude Code v2.1.242+; на Mac — 2.1.306): setting `promptCacheTtl` или env
  `CLAUDE_CODE_PROMPT_CACHE_TTL` для main conversation; setting `subagentPromptCacheTtl` или env
  `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` для остальных; `cacheTtl` в поле `experimental` frontmatter-а
  subagent-а (v2.1.248+; `1h` там игнорируется, пока подписка тратит usage credits); `ENABLE_PROMPT_CACHING_1H=1`
  — 1 h для обоих bucket-ов; `FORCE_PROMPT_CACHING_5M=1` — 5 min для обоих.
- **Порядок (уточнено при перепроверке):** первое совпадение из `FORCE_PROMPT_CACHING_5M` → env bucket-а →
  setting bucket-а → `cacheTtl` frontmatter-а агента → `ENABLE_PROMPT_CACHING_1H` → умолчание. Значит,
  frontmatter агента работает, только пока `subagentPromptCacheTtl` и его env не заданы.
- Проверка: `usage.cache_creation` — 1 h пишется в `ephemeral_1h_input_tokens`, 5 min — в
  `ephemeral_5m_input_tokens` (документация показывает это на `claude -p "hello" --output-format json`; для
  subagent-а — те же поля в его транскрипте).
- Цена: запись в cache с TTL 5 min — 1,25 × цены входного token-а, с TTL 1 h — 2 ×; чтение — 0,1 × (у Opus 5.5
  и Sonnet 5.5 — 0,05 ×, у Fable 5.1 — 0,025 ×).
- Что это значит для нас: implementer-ы (subagent-ы) сейчас на 5 min, и каждый простой дольше 5 min
  перезаписывает весь контекст по 1,25 ×. 1 h поднимает цену каждой записи до 2 × и окупается, только если у
  агента в среднем есть хотя бы один простой 5–60 min. Поэтому сначала убрать ожидание (25, 26), потом мерить
  (19) и включать адресно (31). В `~/.claude/settings.json` и в env Session на Mac TTL сейчас не задан
  (проверено 2026-10-28).

### Ограничения, которые соблюдает план

- **Windows-ПК на паузе до слова владельца.** Ticket, которому нужен ПК (30, 34, `worfy-polish` 41), —
  `Status: blocked`, `Waits: owner`. PR Ticket-ов 24 и 35 ждут ПК для merge, если меняют файлы из `PC_ONLY`
  (файлы workflow-ов, `vitest.config.ts`, `package.json`, `playwright.config.ts`).
- **Вердикт Windows.** `scripts/windows-verdict-scope.mjs` печатает `runner` или `pc`. Ticket-ы 20–23 не
  трогают файлы `PC_ONLY`.
- **Run-ы на GitHub-hosted runner-ах** бесплатны (публичный репозиторий с 2026-10-27), включая macOS и Windows.
  Платный eval — по-прежнему только с «да» владельца (решение 14).
- **Правки Harness** (skills, agents, hooks, `rules.md`, `profile.json`) — по слову владельца от 2026-10-28
  (решение 1). Правка `harness/` действует после обновления Stable copy и Harness из неё; правку `rules.md`
  Profile-а делает Orchestrator после merge, её diff — в «Итог».
- **Timeout-ы test-ов не поднимаются по одному.** Принятые ADR не правятся: новый ADR или раздел
  `## Amendments`. Номера ADR — `bin/preflight` на claim.

### Волны Ticket-ов 19–35

Правило то же, что в разделе «Волны»: Ticket стоит в первой Wave, где закрыты все его блокеры; при общем файле в
«Где в коде» Ticket с большим номером уходит в следующую Wave. Таблица — план, Wave пересчитывается при запуске
командой `/worfy:epic-wave tickets NN, NN of epic worfy-throughput`. После Ticket-а 35 «runner `full`» в колонке
вердикта — Windows job в `ci-ok` PR-а.

| Тикет | Что | Blocked by | Нужен ПК? | Трогает Harness? | Вердикт Windows | Волна |
| --- | --- | --- | --- | --- | --- | --- |
| 35 | CI на GitHub-hosted runner-ах на каждый PR и push в `main`, check `ci-ok` вместо gate full | — | нет (merge — если `PC_ONLY`, решает владелец) | да (тексты о gate перед merge) | `pc`, если меняет файлы `PC_ONLY` | 0 |
| 07 | Оценка `wave-gate` после `ci-ok`; если остаётся — дерево набора вне `.git/`, красная база ≠ виновник | 35 | нет | да (`bin/wave-gate`) | runner `full` | 1 |
| 19 | Замер стоимости и простоев агентов по транскриптам | — | нет | нет | не платформенный | 1 |
| 20 | Карантин flaky unit/contract test-ов: владелец и дата выхода | — | нет | нет (строка `rules.md` после merge) | runner `full` | 1 |
| 21 | Команда выбора test-ов по diff (из Ticket-а 11) | — | нет | нет | не платформенный | 1 |
| 24 | Вердикт `check/windows` из автоматического run-а `full` на PR | 35 | для merge — если меняет workflow | нет (строка `rules.md` после merge) | `pc` или `runner` | 1 |
| 25 | Implementer ничего не ждёт: замок e2e ≤ 2 min, PR — финиш | — | нет | да (`agents/implementer.md`, `rules.md`) | не платформенный | 1 |
| 13 | e2e до merge — только spec-и по задетым путям (правка) | 10, 21, 35 | нет | да (`bin/profile`, `bin/wave-gate`, `epic-wave`, `implementer.md`) | runner `full` | 2 |
| 22 | Flaky test-ы Mac под нагрузкой: причины | 20 | нет | нет | runner `full` | 2 |
| 23 | Flaky test-ы Windows, которые видны на runner-е | 20 | нет (runner) | нет | runner `full` | 2 |
| 32 | Test размера стартового контекста агентов | 19 | нет | да (новый `bin/start-context`) | runner `full` | 2 |
| 26 | Доработка — свежему implementer-у с коротким брифом | — | нет | да (`epic-wave`) | не платформенный | 3 |
| 33 | Сократить стартовый контекст ниже порога | 32 | нет | да (тексты агентов и skill-ов) | не платформенный | 3 |
| 27 | `bin/land`: `ci-ok` → метки → merge → `ticket done`, в фоне | 35 | нет | да (`bin/land`, `epic-wave`) | runner `full` | 4 |
| 31 | 1 h cache только ролям с неизбежным ожиданием | 19, 25, 26 | нет | да (frontmatter агентов) | не платформенный | 4 |
| 28 | Свежий контекст Orchestrator-а на Wave: `bin/wave-brief` | 27 | нет | да (`bin/wave-brief`, `epic-wave`, `rules/orchestrator.md`) | runner `full` | 5 |
| 29 | Платформенный PR с вердиктом Windows входит в набор `wave-gate` (если 07 его оставит) | 07, 24 | нет | да (`bin/wave-gate`, `epic-wave`) + ADR | runner `full` | 6 |
| 30 | gate full на ПК раз в Wave вместо каждого PR со scope `pc` | 29 | **да** | да (`epic-wave`, `rules.md`) + ADR | ПК | после ПК |
| 34 | Карантин e2e и flaky `quiet-windows.spec.ts` | 20 | **да** (файлы `PC_ONLY`) | нет | ПК | после ПК |
| `worfy-polish` 41 | Flaky test-ы Windows на ПК (с правкой выше) | — | **да** | нет | ПК | после ПК |
| 44 | Windows e2e на GitHub runner-е: job в `ci-ok`, сначала не блокирует, после пяти зелёных run-ов подряд — блокирует (решение владельца 2026-10-28) | 35 | только база красных e2e | нет | runner | 7 |
| 05 | Повторный замер после плана | 01, 02, 03, 13, 19, 20, 24, 25, 26, 27, 28, 29, 31, 33 | нет | нет | — | последним |

Почему так:

- **Wave 0 — 35** (решение 0): от него зависят условие merge и смысл 07, 13, 24, 27, 29, 30.
- **Wave 1** — без блокеров или только после 35, без общих файлов: замер (19), карантин (20), выбор test-ов
  (21), правило implementer-а (25), оценка `wave-gate` (07), вердикт Windows из run-а (24). 26 тоже без
  блокеров, но правит `epic-wave/SKILL.md`, как 07, — уходит дальше.
- **`harness/skills/epic-wave/SKILL.md` правят 07, 13, 26, 27, 28, 29, 30** — поэтому они идут друг за другом.
  Если оценка 07 уберёт `wave-gate`, 29 закрывается, и 30 зависит только от 35.
- **Нужен ПК** — 30, 34 и `worfy-polish` 41: ждут слова владельца.

### Риски

- **`ci-ok` краснит чаще, чем gate full.** Три ОС вместо одной, а flaky test-ы runner-ов (`claude-home-registry`,
  `link-access`, `workflow-reader`, `workflow-branches-handles` на Windows) раньше блокировали только
  платформенные PR. Лечится карантином (20) и починкой (22, 23); автоматического повтора нет (решение 2).
- **e2e на macOS-runner-е — другая машина.** Окна, Dock и фокус на runner-е без пользователя ведут себя иначе,
  чем на Mac владельца; красные, которых нет на Mac, — в карантин с владельцем, а не в повтор.
- **Карантин копит долг.** Test в карантине не проверяет код. Лечится датой выхода, пределом 15 записей и
  красным на просроченную запись; владелец каждой записи — Ticket.
- **Выбор test-ов пропустит связь.** Граф import-ов не видит test-ы, которые запускают скрипты процессом (87
  файлов). Таблица связей в Ticket-е 21, неизвестный путь — весь набор, полный run на push в `main` — страховка.
- **Платформенный PR в наборе.** Вердикт Windows стоит на head PR, а не на дереве набора; сочетание двух PR,
  которое ломает только Windows, найдёт run на `main`; цена — исправление вперёд.
- **gate full на ПК раз в Wave** пускает в `main` поломку Windows-кода со scope `pc` до run-а ПК. Пока `main`
  красный на ПК, новые PR со scope `pc` не вливаются (решение 7).
- **Свежий implementer на доработке** не помнит хода мысли прежнего. Бриф с путём к отчёту verifier-а и
  списком находок; рост кругов доработки покажет Ticket 19.
- **1 h cache дороже на коротких работах** (запись 2 × вместо 1,25 ×) — поэтому только по замеру.
- **Порог 35k по оценке, а не по API.** Коэффициент «байты → token-ы» откалиброван по транскриптам; при смене
  модели или версии Claude Code его надо пересчитать (Ticket 32 пишет, как).
- **Harness-правки действуют только после обновления Stable copy.** Ticket 05 мерит после.
