# worfy-review: ревью, минимальное изменение и диагностика по идеям Thermos, ponytail и pstack

Status: по решению владельца 2026-10-09 («Хорошие идеи, сохрани их и добавь в планы к имплементации» —
после разбора таблицы из 7 пунктов)
Source: исследование [2026-10-09-ponytail-pstack-thermos.md](../../docs/research/2026-10-09-ponytail-pstack-thermos.md)
(разбор трёх внешних наборов prompt-ов и skills для агентов); [CONTEXT.md](../../CONTEXT.md) — термины;
Epic [worfy-harness](../worfy-harness/spec.md) (Harness как plugin `worfy`) — формат и соглашения;
[ADR-0047](../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) (Harness меняется через PR в
`harness/`, Stable copy не пересобирается во время Autopilot); [ADR-0055](../../docs/adr/0055-harness-scripts-in-node.md)
(новые скрипты Harness — на Node, bash только в test-ах).
Ticket-ы: Epic `worfy-review`, 7 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у worfy-harness
(`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket` и вычисление Wave в
worfy (`src/shared/workflow/waves.ts`).

## Откуда идеи

Три внешних источника, все под лицензией MIT. Устанавливать их целиком не будем: берём идеи и
формулировки (исследование, раздел «Что не берём и почему», пункт «Как заимствуем»). Как назвать
источник и когда нужна пометка MIT — раздел «Решения владельца», пункт 1.

- **Thermos** — plugin Cursor с двумя review-skills: ревью корректности и ревью качества кода.
  Отсюда — проверки поломки локальной сборки, утечки feature flag, правило «не сообщать о намеренной
  поломке», линза упрощения и правило 1000 строк.
- **ponytail** — skill, который просит агента делать самое маленькое полное изменение. Отсюда —
  порядок выбора решения, комментарий `shortcut:` и список таких комментариев.
- **pstack** — набор skills Lauren Tan (Cursor). Отсюда — сортировка находок по четырём группам,
  ревью на двух моделях и журнал решений `decisions.tsv`.

Кроме них — диагностика зависания Electron: в main process worfy сейчас нет обработчиков падения
renderer и дочерних процессов.

## Цель

Ревью в Harness находит больше настоящих дефектов и меньше лишнего. Implementer пишет меньше кода.
Зависание или падение worfy оставляет запись, по которой видно, что случилось.

Epic готов, когда:

1. Reviewer проверяет поломку локальной сборки и утечки feature flag. Orchestrator сортирует его
   находки на четыре группы, и в отчёте видны отклонённые находки с причиной (Ticket 01).
2. Есть линза «упрощение» с описанием в репозитории. Владелец добавил её в свой Profile (Ticket 02).
3. Gate предупреждает, когда diff делает файл длиннее 1000 строк (Ticket 03).
4. Падение renderer или дочернего процесса worfy оставляет запись. Таймаут шага Autopilot через CDP
   (Chrome DevTools Protocol — управление окном worfy снаружи) сохраняет стек процесса (Ticket 05).
5. Прогон Wave без человека пишет журнал решений (Ticket 06).
6. Implementer идёт по порядку выбора решения и помечает упрощения комментарием `shortcut:` (Ticket 04).
7. Есть режим расширенного ревью перед рискованным merge (Ticket 07, низкий приоритет).

## Как устроено

- **Исходник Harness — `harness/`.** Установленный plugin — копия этой папки. Правка вступает в силу
  только после `pnpm install:stable` (ADR-0047). Ticket проверяется test-ами в `harness/bin/tests/*.test.sh` и
  `harness/hooks/tests/`. Поведение агента проверяют eval-кейсы в `harness/evals/`. Их платный прогон
  сейчас заблокирован: Ticket 27 Epic-а worfy-harness (eval-кейсы через `claude plugin eval`) ждёт решения
  владельца о git в песочнице. Поэтому eval-кейс в этом Epic-е — желательный пункт, а не обязательный.
  Новая папка кейса с `prompt.md` роняет contract test «holds exactly the eight cases»
  (`test/contract/harness-evals.test.ts:82-89`). Поэтому Ticket, который добавляет кейс, в том же PR
  дописывает его имя в `CASES` (`:18-27`) и меняет число в названии test-а.
- **Линзы ревью** — названия в Profile, поле `review.lenses`. Profile лежит вне git:
  `~/.claude/worfy-harness/projects/worfy/profile.json`. Сейчас там `корректность`, `границы модулей`,
  `тесты`. Описаний линз в репозитории нет: reviewer получает только название. Правка Profile — шаг
  владельца на его машине, в PR её нет. В PR идёт описание линзы.
- **Где работают линзы.** Lens reviewers (по одному reviewer-у на линзу) запускает только
  ship-ticket, шаг 7. Линзы по умолчанию — поле Profile `review.ticket_lenses`, без него — две или три
  из `review.lenses` по теме изменения (`harness/profiles/README.md`, строки этих полей). В Wave
  Implementer идёт по шагам 1–8 Profile без шага 7. Diff в Wave проверяет один verifier (reviewer с
  линзой «отчёт Implementer-а», `harness/skills/epic-wave/SKILL.md`, раздел 3). Линзы Profile в Wave
  не запускаются — ни три нынешние, ни новая.
  - Ticket 01 меняет оба места: четыре группы находок — в ship-ticket, шаг 7, и в epic-wave, раздел 3.
  - Ticket 02 skills не меняет. Линзу «упрощение» включает правка Profile — шаг владельца. В
    `review.ticket_lenses` по контракту «две или три» линзы, а у worfy их уже три. Владелец либо
    заменяет одну из них, либо убирает поле, и тогда линзы по теме изменения выбирает Orchestrator.
  - В Wave линза «упрощение» работает только через режим расширенного ревью Ticket-а 07 — перед
    рискованным merge.
- **Уровни находок** остаются `high` / `med` / `low`. Четыре группы Ticket-а 01 — это способ, которым
  Orchestrator показывает находки. Это не новая шкала.

## Решения владельца

2026-10-09, после таблицы из 7 пунктов: все 7 пунктов принимаются в план реализации («Хорошие идеи,
сохрани их и добавь в планы к имплементации»).

Решения плана — по исследованию, без отдельного слова владельца; подтвердить при взятии Wave 1
(строка в `HANDOFF.md`, раздел «Ждёт владельца»):

1. Внешние plugin-ы не ставим. Берём идеи и формулировки, как в исследовании (раздел «Что не
   берём и почему», пункт «Как заимствуем»):
   - правило, переписанное своими словами, называет источник: проект, путь к файлу и SHA коммита;
   - дословно взятый текст несёт ещё и пометку MIT: строку copyright владельца источника и SHA
     коммита, с которого текст взят. Ссылка — на этот коммит, а не на `main`;
   - строка источника (`Source: <проект>, <путь>, <SHA>`) и пометка MIT стоят в том же файле
     `harness/`, в конце раздела с заимствованным текстом, по-английски.

   Прочитанные версии (проверено через GitHub API 2026-10-09):
   - ponytail — `Copyright (c) 2026 DietrichGebert`; тег v5.1.0, коммит
     `9cc65d03aa2da1db7121b912d03596409ee340b8`;
   - Thermos и pstack лежат в `cursor/plugins`, коммит `ccb5507cec1546dc88135c1139c811e6c59115ba`
     (main на 2026-10-08). У репозитория лицензии в корне нет: она в каждой папке.
     `thermos/LICENSE` и `cursor-team-kit/LICENSE` (там вторая копия skill-а ревью качества кода) —
     `Copyright (c) 2026 Cursor`; `pstack/LICENSE` — `Copyright (c) 2026 Lauren Tan`.
2. Слова целиком заглавными буквами из источников («EXTREMELY», «NOTHING») не переносим. По
   исследованию, такой нажим даёт у новых моделей Claude лишние срабатывания.
3. Режим расширенного ревью (Ticket 07) — по запросу или по пометке риска у Ticket-а, низкий
   приоритет.

Открытые вопросы каждого Ticket-а — в его разделе «Риски»: решает исполнитель, а итог пишет в «Итог».

## Не в этом Epic-е

- Ревью на моделях другого семейства (не Claude): нужен внешний CLI.
- Сверка находок с комментариями других ботов в PR.
- Skill `verify-worfy`, который управляет приложением по CDP (идея из pstack).
- Несколько параллельных реализаций одного Ticket-а (`arena` из pstack).
- Карта кода в контексте Subagent-а (из ponytail).
- Запуск линз Profile в каждой Wave (epic-wave, раздел 3): сейчас там только verifier.

## Риски

- **Больше ложных находок.** Ambitious prompt линзы упрощения находит и лишнее. Фильтры Ticket-а 02 и
  группа Dismissed Ticket-а 01 — ответ на это.
- **Стоимость.** Каждая новая линза — ещё один reviewer на diff. Режим Ticket-а 07 стоит в 2–4 раза
  больше обычного ревью.
- **Источники быстро меняются.** У ponytail пять релизов за четыре дня. Текст не синхронизируем, а
  переписываем один раз.

## Порядок относительно worfy-windows и worfy-harness

Открытые Ticket-ы двух других Epic-ов правят те же файлы, что и этот Epic. Список ниже — все
пересечения на 2026-10-09: разделы «Где в коде» всех открытых Ticket-ов сверены с Ticket-ами этого
Epic-а тем же правилом, что `filesOverlap` (`src/shared/workflow/waves.ts:145`). Перед каждой Wave
сверка идёт заново, по открытым PR (раздел «Соглашения для Ticket-ов этого Epic-а»).

Epic [worfy-windows](../worfy-windows/spec.md) (порт worfy и Harness на Windows):

- [03](../worfy-windows/issues/03-gate-на-node.md) (Gate на Node) — `harness/hooks/gate.sh` (удаляет),
  `harness/hooks/gate.mjs` (создаёт; с Ticket-ом 03 этого Epic-а, если тот вливается позже),
  `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`,
  `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh`,
  `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/profiles/README.md`,
  `harness/README.md`, `harness/hooks/tests/rules-hooks.test.sh`;
- [04](../worfy-windows/issues/04-hooks-harness-на-node.md) (hooks Harness на Node) —
  `harness/hooks/gate.mjs` (с 03), `harness/profiles/README.md`, `harness/README.md`,
  `harness/hooks/tests/rules-hooks.test.sh`;
- [07](../worfy-windows/issues/07-тексты-skills-для-двух-систем.md) (тексты skills для двух систем) —
  `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`,
  `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/profiles/README.md`;
- [11](../worfy-windows/issues/11-окно-меню-уведомления-и-ctrl-на-windows.md) (окно, меню,
  уведомления и Ctrl на Windows) — `src/main/index.ts`, общий с 05. Его блокер (worfy-windows/02) уже
  влит, поэтому 11 может идти одновременно с Wave 1 этого Epic-а;
- [12](../worfy-windows/issues/12-сборка-nsis-и-stable-copy-на-windows.md) (сборка NSIS и Stable copy
  на Windows) — `README.md`, тот же раздел «Stable copy», что правит 05, часть Б;
- [13](../worfy-windows/issues/13-первый-запуск-на-windows.md) (первый запуск на Windows) —
  `test/contract/harness-migrate.test.ts`, общий с 07;
- [17](../worfy-windows/issues/17-очередь-gate-на-mac.md) (очередь Gate на Mac) —
  `harness/skills/epic-wave/SKILL.md` (общий с 01, 06, 07),
  `harness/bin/tests/epic-wave-ship-ticket.test.sh` (с 01, 04), `harness/README.md` (с 07),
  `src/main/index.ts` (с 05). Кроме того, 17 добавляет папку `harness/skills/gate-queue/`, а 07 —
  `harness/skills/max-review/`. Оба правят одну строку `test/contract/harness-migrate.test.ts:241`,
  хотя у 17 этого файла в «Где в коде» нет.

Epic [worfy-harness](../worfy-harness/spec.md) (E3, Harness как plugin):

- [27](../worfy-harness/issues/27-eval-кейсы-harness-через-plugin-eval.md) (eval-кейсы через
  `claude plugin eval`, Status `blocked`) — папка `harness/evals/` и
  `test/contract/harness-evals.test.ts` (общие с eval-кейсами 01 и 02), `harness/README.md` (с 07).

Вычисление Wave (`src/shared/workflow/waves.ts`) смотрит на Ticket-ы одного Epic-а. Общие файлы двух
Epic-ов оно не видит. Поэтому Ticket этого Epic-а и Ticket другого Epic-а с общим файлом не идут
параллельно. Правило: тот Ticket, который вливается в main вторым, делает rebase на main и заново
прогоняет свои проверки:

- Ticket-ы текстов и скриптов Harness (01–04, 06, 07) — test-ы из своего «Где в коде»
  (`agents-text.test.sh`, `epic-wave-ship-ticket.test.sh`, `rules-hooks.test.sh` и новые
  `.test.sh`), и contract test-ы, которые он правит (`harness-evals.test.ts`,
  `harness-migrate.test.ts`), через `pnpm test`;
- Ticket 05 (код worfy) — typecheck, unit и e2e test-ы: `GATE_SCOPE=all` gate full на ветке после
  rebase, под замком `/tmp/worfy-e2e.lock`. Раздел «Stable copy» в `README.md` после rebase
  сверяется глазами: test-ов у него нет.

Про Gate на Node — отдельное правило в Ticket-е 03, раздел «Риски».

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-harness](../worfy-harness/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»:
сначала падающий test, только чтение чужих файлов, ручные пункты «(вручную)», Autopilot над worfy —
только на Stable copy, `GH_TOKEN=$(gh auth token -u IDSAD-XL)` вместо `gh auth switch`. Отличия:

- **Кто ведёт** — Session на Mac владельца: Orchestrator в worfy или Autopilot Stable copy (команда
  `/worfy:epic-wave tickets NN, NN of epic worfy-review`). Gate full — на Mac. Session на Windows-ПК
  ведёт `worfy-windows` и Ticket-ы этого Epic-а не берёт. Прямого канала между Session-ами нет: всё о
  второй Session читается из репозитория — Status Ticket-ов, открытые PR и их файлы, main,
  `HANDOFF.md` (ADR-0056, пункт 4).
- **Ветки** — `worfy-review/<NN>` (поле Profile `tickets.branch` = `<эпик>/<NN>`); worktree —
  `.claude/worktrees/<NN>`.
- **ADR.** Ticket-ам этого Epic-а новый ADR не нужен. Если понадобится, номер выдаёт Orchestrator в
  момент взятия: следующий свободный (`HANDOFF.md`, «Где остальное»). Принятые ADR не правятся.
- **Перед каждой Wave — две проверки, в этом порядке.**
  1. PR Session на Windows с меткой `needs-mac-gate` — как в [worfy-link](../worfy-link/spec.md),
     раздел «Соглашения для Ticket-ов этого Epic-а», пункт «Перед каждой Wave — PR с меткой
     `needs-mac-gate`».
  2. Открытые PR других Epic-ов (ADR-0056, пункт 5): `gh pr list --state open --json
     number,headRefName,files`. Их файлы сравниваются с «Где в коде» Ticket-ов Wave тем же
     правилом, что внутри Wave. Ticket с общим файлом ждёт мержа того PR. Пересечение и отложенный
     Ticket — в отчёте Wave. Список раздела «Порядок относительно worfy-windows и worfy-harness» —
     подсказка, он не заменяет эту сверку.
- **Мерж в main — по очереди** (ADR-0056, пункт 6). За раз вливается один PR. Второй перед мержем
  обновляется от свежего main и проверяется заново — по правилу раздела «Порядок относительно
  worfy-windows и worfy-harness».
- **Платформенные PR** (ADR-0056, пункт 2). Ticket-ы 03, 04 и 06 меняют скрипты Harness:
  `harness/hooks/gate.sh`, новые `harness/bin/shortcut-ledger` и `harness/bin/decision-log`. Их PR
  мержатся только после gate full на Windows-ПК владельца. Строка вердикта Gate и код выхода — в
  отчёт Ticket-а; «не удалось проверить» — не зелено. Прогон делает Session на Windows-ПК, просьба
  о нём — комментарием в PR. Переходные исключения (Gate ещё не на Node, test-ы ещё не починены под
  Windows) — ADR-0056, «Последствия».
- **Gate.** Пункт «`gate.sh fast` — код 0 и строка `[gate] зелено (fast)`» в «Готово, когда» — это Gate
  fast той версии, что в main: после worfy-windows/03 — `gate.mjs`. Ticket, который меняет только
  `harness/`, гоняет Gate с `GATE_SCOPE=all`: в реестре Gate у worfy нет `^harness/`, и Gate fast
  по такому diff-у пишет «ничего не прогналось» (`HANDOFF.md`, «Ждёт владельца» и «Риски и долги»).
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. e2e и `.app` (Ticket 05)
  проверяются локально перед мержем: `GATE_SCOPE=all gate.sh full` на ветке, под замком
  `/tmp/worfy-e2e.lock` (команда — `rules.md` Profile-а worfy).
- **После мержа в `harness/`** — `pnpm install:stable` вне прогона Autopilot (ADR-0047). Без этого
  правка не действует на Harness, которым работает Autopilot.
- **Язык.** Текст Harness — английский (ADR-0044), в том числе новые пометки и строки в skills.
  Кириллица в `harness/` — только из списков `ALLOWED` test-ов текстов. Документы Project-а —
  русские, термины — из `CONTEXT.md`.
- **Заимствования** — раздел «Решения владельца», пункт 1: источник с SHA коммита у каждого
  заимствованного правила, пометка MIT у дословного текста.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/agents/reviewer.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/bin/tests/agents-text.test.sh`, `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/evals/reviewer-intended-breakage/`, `test/contract/harness-evals.test.ts` | 1 |
| 02 | `harness/agents/reviewer.md`, `harness/profiles/README.md`, `harness/bin/tests/agents-text.test.sh`, `harness/evals/reviewer-simplification/`, `test/contract/harness-evals.test.ts` | 2 |
| 03 | `harness/hooks/gate.sh`, `harness/hooks/gate.mjs`, `harness/hooks/tests/gate-file-size.test.sh` | 1 |
| 04 | `harness/agents/implementer.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/bin/tests/agents-text.test.sh`, `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/bin/shortcut-ledger`, `harness/bin/tests/shortcut-ledger.test.sh` | 3 |
| 05 | `src/main/index.ts`, `src/main/diagnostics/process-gone.ts`, `test/unit/process-gone.test.ts`, `scripts/hang-sample.mjs`, `README.md` | 1 |
| 06 | `harness/bin/decision-log`, `harness/bin/tests/decision-log.test.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/hooks/rules/orchestrator.md`, `harness/hooks/tests/rules-hooks.test.sh` | 2 |
| 07 | `harness/skills/max-review/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/README.md`, `harness/bin/tests/max-review.test.sh`, `test/contract/harness-migrate.test.ts` | 3 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, 03 и 05.** Блокеров нет. Общих файлов нет: 01 — тексты reviewer-а и двух skills и
  свой eval-кейс, 03 — Gate (`gate.sh` или `gate.mjs`), 05 — код worfy и скрипт для Stable copy.
- **Wave 2 — 02 и 06.** 02 ждёт 01: общие `harness/agents/reviewer.md` и
  `test/contract/harness-evals.test.ts`. 06 блокеров не имеет, но делит с 01
  `harness/skills/epic-wave/SKILL.md` и поэтому сдвинут из Wave 1. Между собой 02 и 06 файлов не
  делят.
- **Wave 3 — 04 и 07.** 04 ждёт 02: оба правят `harness/bin/tests/agents-text.test.sh`, и формат
  комментария `shortcut: <предел>, <когда переделать>` первым записывает Ticket 02 — в фильтре линзы
  в `reviewer.md`. Ticket 04 переносит тот же формат в `implementer.md`. 07 ждёт 01 и 02. Общих
  файлов нет: 04 — `implementer.md` и `ship-ticket`, 07 — новый skill, `epic-wave` и
  `harness-migrate.test.ts`.

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`): папка с `/` на конце
пересекается с каждым файлом в ней. Внутри каждой Wave плана общих файлов нет, каждый блокер — в Wave
раньше.
