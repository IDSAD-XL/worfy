# worfy-reliability: надёжность Autopilot и уроки из сбоев

Status: по решению владельца 2026-10-15 («Берем А В E F в отдельные тикеты, D не берем вовсе»);
разбиение на Ticket-ы, «Готово, когда» и «Соглашения» — предложение этого docs-PR
Source: исследование [PR #325](https://github.com/IDSAD-XL/worfy/pull/325),
`docs/research/2026-10-15-frontier-ai-runtime-ideas.md` (ветка
`research/frontier-ai-agent-runtime-2026-10`, в main ещё нет; идеи A–H, проверено по коду main
`fa29974` 2026-10-15); [CONTEXT.md](../../CONTEXT.md) — термины; ADR
[0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0005](../../docs/adr/0005-worfy-own-state-inventory.md),
[0029](../../docs/adr/0029-autopilot-waits-for-background-tasks.md),
[0046](../../docs/adr/0046-autopilot-narrow-round-without-owner.md); Epic
[worfy-review](../worfy-review/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-reliability`, 9 Ticket-ов, нумерация с `01` (05–09 добавлены 2026-10-16 по решению владельца). Шапка — тот же диалект, что у
worfy-review (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket` и
вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Откуда идеи

Исследование PR #325 собрало новости frontier AI за 1–14 октября 2026 и предложило восемь идей (A–H).
Само исследование — входные данные, а не план: его раздел «How to use this research» требует
сверить каждую идею с кодом и Epic-ами. Сверка 2026-10-15 по main `fa29974`:

- **A** — матрица совместимости закреплённой версии Claude Code и Agent SDK: рестарт и resume
  Session не повторяют действий, отказ в разрешении не превращается в разрешение. Часть уже
  покрыта contract test-ами (Ticket 01, «Что происходит»), но проверки «не отправлено дважды» после
  рестарта нет.
- **B** — «Memento»: свежий агент с короткой записью попыток вместо ещё одного круга того же агента
  (исследование Anthropic о самовоспроизведении, 2026-10-12, Appendix A; выигрыш там показан на
  задаче развёртывания на незнакомом железе, не на коде). Применимость к worfy не проверена.
- **E** — сбой превращается в классифицированный инцидент и детерминированный регрессионный test,
  а не в ещё одно правило prompt-а.
- **F** — измерить критический путь Ticket-а (claim → PR → CI → Gate → merge) по уже записанным
  событиям, а не ускорять отдельных агентов.

## Цель

Autopilot не повторяет внешних действий после рестарта, и это закреплено test-ами. Решения о
застрявших Ticket-ах и уроках из сбоев опираются на разбор настоящих журналов, а не на догадки.
Видно, на каком шаге Ticket ждёт дольше всего.

Epic готов, когда:

1. Contract test-ы на fake SDK доказывают: после рестарта Session, relaunch Orchestrator-а и resume
   после Limits worfy не отправляет второй раз ход, который повторил бы внешнее действие (commit,
   merge, команда Wave); отклонённый вызов tool не выполняется после рестарта. В `docs/lessons/`
   есть правило обновления SDK (Ticket 01).
2. Есть отчёт о застрявших Ticket-ах по журналам Autopilot и разделам «Итог» с ответом «да/нет» на
   вопрос, помог бы свежий агент с записью попыток сверх ADR-0046 (Ticket 02). Владелец его прочёл.
3. Есть предложение процесса «сбой → инцидент → регрессионный test или урока нет» и решение
   владельца по нему (Ticket 03).
4. Скрипт строит отчёт о критическом пути Ticket-ов из журнала Autopilot, Status-ов, git и PR;
   unit test-ы на fixture-журнале зелёные (Ticket 04).
5. Версия SDK, fixtures настоящих сообщений и fake SDK сверяются test-ами; разницу форм двух версий
   печатает скрипт (Ticket 05).
6. Процесс Ticket-а 03 встроен: README уроков с классами и записью «Инцидент» (06), `Проверка:` у
   каждого урока и `scripts/check-lessons.mjs` в `pnpm lint` (07), урок про `fseventsd` (08), шаг
   классификации в skill `retro` (09).

## Решения владельца

2026-10-15, после разбора исследования PR #325: «Берем А В E F в отдельные тикеты, D не берем вовсе».

1. **A, B, E, F** — по одному Ticket-у: 01 (A), 02 (B), 03 (E), 04 (F).
2. **D** (Dynamic Workflows у Managed Agents) — не берём совсем: ни Ticket-а, ни исследования.
3. **C и G** сейчас не берём (раздел «Не в этом Epic-е»).

2026-10-16 («со всем согласен»), по отчётам Ticket-ов 02 и 03:

4. **02 — ответ «нет» принят**: follow-up по «Memento» не заводится; 7 случаев «доработка вносит новый
   дефект» — входные данные Ticket-а 03.
5. **03 — процесс принят**: шесть классов без изменений; инцидент — подраздел «Инцидент» в «Итог»
   Ticket-а, где случился сбой; встраивание — В1 и В2 (Ticket-ы 06, 07), затем В3 (09); В4 — только
   если инциденты продолжат теряться; `Проверка:` — всем урокам вместе с В2; отказ hook-а на `rm -rf`
   — уже `worfy-harness` 48; flaky test вылечен после 10 повторов без красного под нагрузкой полного
   `pnpm test`; «временный сбой машины» — после зелёного повтора того же commit-а. Подробно — «Итог»
   Ticket-а 03.
6. **Compatibility suite** (идея A исследования PR #325, P0) — Ticket 05; Ticket 01 закрыл из идеи A
   только рестарт без повтора действий и правило обновления SDK.

## Не в этом Epic-е

- **C — выбор модели по цене и качеству** (Haiku для узких шагов): нужен платный прогон eval на
  наборе задач. Платный прогон — только по решению владельца.
- **G — ревью моделью другого поставщика** (Gemini, GPT, Meta): код Project-а ушёл бы стороннему
  поставщику. Это — только по решению владельца; worfy-review тоже отложил такое ревью до внешнего CLI.
- **D — Dynamic Workflows у Managed Agents** — решение владельца 2: не берём.
- **H** — в исследовании «только наблюдать».
- **Настройки compaction** (пункт A исследования про `idleCompaction` и compaction Subagent-ов): в
  `src/` worfy таких настроек нет, проверять нечего.
- **UI для критического пути** — только отчёт скрипта (Ticket 04).
- **Автоматический перезапуск застрявшего Ticket-а** — Ticket 02 только исследует.

## Риски

- **Ложная уверенность из fake SDK.** Contract test-ы проверяют, что делает сам worfy. Повтор хода
  внутри Claude Code при resume ими не ловится: это закрывает правило обновления SDK (Ticket 01).
- **Мало данных.** Журналов Autopilot на Mac владельца 19 (2026-10-15), застрявших Ticket-ов — единицы.
  Ticket 02 может ответить «данных не хватает» — это допустимый итог.
- **Транскрипты и секреты.** Журналы и транскрипты остаются на машине; в отчёты не попадают секреты,
  токены и личные пути.

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-review](../worfy-review/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, только чтение чужих файлов, ручные пункты «(вручную)», Autopilot над worfy — только на
Stable copy, без `gh auth switch`, мерж в main — по очереди. Отличия:

- **Кто ведёт.** Autopilot может брать 01, 04 и 05–09 (команда `/worfy:epic-wave tickets 05, 06, 07 of
  epic worfy-reliability`). 02 и 03 — research: их ведёт Session Orchestrator-а, итог — отчёт в
  `docs/research/`, который читает владелец. В команду Wave Autopilot 02 и 03 не входят.
- **Конец Ticket-а** — `pr-green-ci`, как у других Epic-ов: PR, зелёный CI на Linux, gate full на Mac
  перед мержем, мерж — Orchestrator.
- **Ветки** — `worfy-reliability/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **ADR.** Ticket-ам этого Epic-а новый ADR не нужен. Если понадобится, номер выдаёт Orchestrator в
  момент взятия: следующий свободный. Принятые ADR не правятся.
- **Без платных прогонов.** Ни одного запуска настоящего Claude Code или Agent SDK на подписке или API
  ради test-ов и исследований: unit и contract — fake SDK (`src/main/agent/fake-query.ts`).
- **Код Project-а не уходит сторонним поставщикам.** Ни в модели других семейств, ни во внешние сервисы.
- **Чужие данные — только чтение.** Журналы Autopilot (`~/Library/Application Support/worfy/autopilot/`),
  транскрипты и `.scratch/` читаются; worfy и скрипты ничего не пишут в репозитории Project-ов
  (ADR-0005). В отчёт идут выводы и номера Ticket-ов, а не куски транскриптов.
- **Правки Harness и Profile** — только по слову владельца и через PR в `harness/` (Ticket 03).
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. e2e и `.app` — локально перед
  мержем: `GATE_SCOPE=all` gate full на ветке (команда — `rules.md` Profile-а worfy).
- **Язык.** Документы — русские, термины — латиницей, из `CONTEXT.md`; текст коммитов и код — английский.

## Порядок

Зависимостей между Ticket-ами нет. Первым берётся 01: в исследовании это единственная идея с
приоритетом P0, и она закрывает действия, которые нельзя повторять (commit, merge). Остальные — в
любом порядке после или параллельно, если общих файлов нет.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `test/contract/agent-session.test.ts`, `test/contract/orchestrator.test.ts`, `test/contract/autopilot-limits.test.ts`, `test/contract/permissions.test.ts`, `docs/lessons/agents.md` | 1 |
| 02 | `docs/research/2026-10-NN-застрявшие-ticket-ы.md` | 1 |
| 03 | `docs/research/2026-10-NN-сбой-инцидент-test.md` | 1 |
| 04 | `scripts/critical-path.mjs`, `test/unit/critical-path.test.ts`, `test/fixtures/critical-path/` | 1 |
| 05 | `test/contract/sdk-compat.test.ts`, `test/unit/sdk-compat-diff.test.ts`, `scripts/sdk-compat.mjs`, `test/fixtures/sdk-messages/README.md`, `test/fixtures/sdk-compat/` | 2 |
| 06 | `docs/lessons/README.md` | 2 |
| 07 | `scripts/check-lessons.mjs`, `test/unit/check-lessons.test.ts`, `test/fixtures/check-lessons/`, `package.json`, `docs/lessons/agents.md`, `docs/lessons/process.md`, `docs/lessons/testing.md`, `docs/lessons/ci-merge.md` | 2 |
| 08 | `docs/lessons/agents.md`, `HANDOFF.md` | 3 |
| 09 | `harness/skills/retro/SKILL.md`, `test/contract/harness-retro-skill.test.ts` | 3 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, 02, 03 и 04.** Блокеров нет. Общих файлов нет: 01 — contract test-ы и урок, 02 и 03
  — свои отчёты в `docs/research/`, 04 — новый скрипт, его test и fixture. Autopilot берёт из неё 01 и
  04; 02 и 03 ведёт Orchestrator.
- **Wave 2 — 05, 06, 07.** Добавлены 2026-10-16 по решению владельца, когда Wave 1 влита. Блокеров
  нет, общих файлов нет: 05 — test-ы и скрипт совместимости SDK, 06 — `docs/lessons/README.md`, 07 —
  скрипт проверки уроков и строки `Проверка:` в четырёх файлах уроков.
- **Wave 3 — 08 и 09.** 08 — общий с 07 файл `docs/lessons/agents.md`, уходит в следующую Wave (и
  его урок сразу проходит проверку 07). 09 ждёт 06 (`Blocked by: 06`): шаг skill-а опирается на классы
  README. Общих файлов у 08 и 09 нет. 09 — PR в `harness/`: после мержа `pnpm install:stable`.

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`): папка с `/` на
конце пересекается с каждым файлом в ней. Если Ticket 01 правит код `src/` (раздел «Что делаем»,
пункт 4), исполнитель дописывает файлы в «Где в коде» при claim.
