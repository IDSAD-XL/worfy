# 07 — `epic-wave` и `ship-ticket` идут по `workflow.pipeline`; правило Windows — Check «windows»

Type: task
Status: claimed 2026-10-17T23:37Z
Blocked by: 02
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 4, 5, 11 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md);
[ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2.

## Что происходит

- **Ждать ли вердикта другой платформы, skill `epic-wave` узнаёт из текста:** «the PRs the project's
  rules send to another platform's verdict (worfy: ADR-0056, item 2)»
  (`harness/skills/epic-wave/SKILL.md:578-583`). Сами правила — `rules.md` Profile-а worfy, раздел о
  gate перед мержем, со ссылкой на ADR-0056. Вердикт Windows приходит строкой отчёта Session на ПК.
- **Порядок шагов Ticket-а** в `ship-ticket` и `epic-wave` один для всех Project-ов: ревью, затем
  мерж по `workflow.finish` и `workflow.merge` (`harness/profiles/README.md:151-153`).
- После Ticket-а 02 есть `bin/ticket mark` (в том числе `check/<name>` и `skipped`), фильтр отметок
  в проверке CI и поле `workflow.pipeline` в `_resolved.pipeline`.

## Что делаем

1. **Skills читают Pipeline:** `bin/profile --field _resolved.pipeline` в разделе 0 `epic-wave` и в
   начале `ship-ticket`.
2. **Agent review** — там, где он стоит в Pipeline: после CI (worfy) или до PR (Atakama, Silent
   mode: ревью идёт по локальной ветке, отметка — на её head SHA, PR открывается после
   `review success`). Нет Agent review в Pipeline — ревью агентом нет.
3. **Check «<name>».** Перед мержем skill ждёт `check/<name>` `success` или `skipped` на head SHA
   каждого PR. Orchestrator ставит `skipped`, когда PR не требует этой проверки по правилам Project-а
   (для `windows` — ADR-0056, пункт 2, решает, какой PR платформенный), и `success` или `failure` —
   по вердикту Session на ПК (gate full, код 0 и `[gate] зелено (full)`). Набор `wave-gate`
   (ADR-0065) берёт только PR с пройденными Check-ами; `PLATFORM=(…)` в блоке набора
   (`harness/skills/epic-wave/SKILL.md:605-613`) заполняется из PR, у которых Check не `skipped`.
4. **Human review и Awaiting merge** — skill не мержит: Ticket остаётся ждать людей, Wave
   продолжается без него (как `workflow.merge: null` сейчас).
5. **Deploy** — после мержа skill не закрывает Ticket, пока Deploy не пройден, если Deploy есть в
   Pipeline; у worfy — `pnpm install:stable` Orchestrator-а (ставит отметку, Ticket 02).
6. **Правка Profile-а worfy (Orchestrator после мержа):** `rules.md` — абзац о вердикте Windows
   ссылается на Check «windows» вместо текста; diff — в «Итог».

Не входит: код worfy; новые виды Stage.

## Готово, когда

- [x] `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` — exit 0: блоки skills читают
      `_resolved.pipeline`; Check без отметки держит PR вне набора; `skipped` — пропускает.
- [x] `bash harness/bin/tests/skill-blocks.test.sh` — exit 0.
- [x] `bash harness/bin/tests/agents-text.test.sh` — exit 0 (текст skills без ссылки на ADR-0056 как на
      правило ожидания).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную, Orchestrator) первая Wave после `pnpm install:stable`: платформенный PR ждёт
      `check/windows`, обычный — `skipped`; номера PR — в «Итог».
      не проверено: шаг Orchestrator-а после merge, правки Profile-а и `pnpm install:stable`.

## Тесты

Сначала падающий случай в `epic-wave-ship-ticket.test.sh`: Pipeline с Check «windows» и PR без
отметки — skill не включает его в набор. `gh` и gate — stub-ы; без платных прогонов.

## Где в коде

- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`

## Итог

**Что сделано.** Оба skill-а читают Pipeline: `bin/profile --field _resolved.pipeline` — один и тот же
блок в разделе 0 `epic-wave` и в разделе 0 `ship-ticket`, он печатает по Stage на строку (`check windows`
для Check). Правила по видам Stage — в разделе 0 `epic-wave`, `ship-ticket` ссылается на них:

- **Agent review** — там, где стоит в Pipeline. После `ci` — на PR, как раньше в `epic-wave`. До `ci` —
  на ветке без PR: implementer останавливается после шага 6, отметка `review` — на head ветки, PR
  открывается после `review success` с того же head. Нет `agent-review` — раздел 3 `epic-wave` и шаг 7
  `ship-ticket` пропускаются, это пишется в отчёт.
- **Check «<name>»** — новый абзац «Checks before merge» в разделе 4 `epic-wave`: кто и когда ставит
  `check/<name>` (`skipped` — по правилам `rules.md`, `pending` — проверка запрошена, `success`/`failure` —
  по отчёту Session на ПК о коммите, коде выхода gate full и строке вердикта) и блок, который читает
  отметки на head каждого готового PR (Full mode — commit status через `gh api …/commits/<sha>/status`,
  Silent mode — файл отметок в `HARNESS_HOME`). Строки блока: `ready`, `ready, PLATFORM`, `waits`,
  `failed`. В набор `wave-gate` идут только `ready`; `PLATFORM=(…)` блока набора заполняется из
  `ready, PLATFORM` — PR, у которых Check не `skipped`. Без stage `check` в Pipeline — запасной путь:
  платформенные PR по правилам Project-а («those the project's rules send to another platform's
  verdict») идут в `PLATFORM=(…)` и вливаются по-старому после вердикта другой платформы. Ссылки на
  ADR-0056 в skill-ах нет.
- **Human review / Awaiting merge** — skill не мержит (с `human-review` — пока `reviewDecision` не
  `APPROVED`); Ticket остаётся `claimed` с открытым PR, Wave идёт дальше, в отчёте — `waits: people (…)`.
- **Deploy** — абзац «Deploy before close» и блок `DEPLOYED=`: Ticket закрывается, только когда его
  merge-коммит — предок коммита с отметкой деплоя (commit status `deploy` `success` от вершины main до
  merge-коммита; с `environment` — успешный GitHub Deployment). `DEPLOYED=none` — Ticket остаётся
  `claimed`, в отчёте — `waits: deploy`. Возобновление Wave знает оба случая.

Test-ы: `harness/bin/tests/epic-wave-ship-ticket.test.sh`, раздел 9 — блоки идут под bash и zsh со
stub-ом Profile-а, stub-ом `gh`, который только читает, и временными `HOME` и `HARNESS_HOME`; проверка,
что настоящий `~/.claude` не изменился. Шесть мутантов блоков (SHA не сверяется, `skipped` теряется,
`none` считается готовым, `failure` не валит, Deployment без проверки предка, `rev-list` без нижней
границы) — каждый ловится. `skill-blocks`, `agents-text`, `review-depth`, `silent-mode`,
`decision-log`, `max-review`, `wave-gate` — exit 0. Круг доработки: пять мутантов запасного пути
(убран абзац набора, убран вердикт для PR по-старому, убран пункт раздела 0, убрана подсказка в
строке блока, убран абзац шага 9 `ship-ticket`) — каждый даёт EXIT=1.

**Решено без владельца, подтвердить.**

- `ship-ticket` с Pipeline по умолчанию (`ci` перед `agent-review`) теперь открывает PR и ждёт CI до
  ревью агентами, а не после: так стоит в Pipeline.
- PR с `check/<name>` `success` вливается по-старому, и rebase делает новый head без отметок. Поэтому
  rebase — до запроса вердикта Windows, и блок отметок — ещё раз прямо перед `gh pr merge`.
- «Не удалось проверить» от Session на ПК и отчёт о другом коммите — новой отметки нет, PR ждёт.

**Правка Profile-а worfy — шаг Orchestrator-а после мержа** (файлы вне репозитория:
`~/.claude/worfy-harness/projects/worfy/`). Без неё Pipeline worfy — по умолчанию, без Check «windows» и
Deploy. Тогда действует запасной путь skill-ов: блок отметок пишет каждому PR
`ready (PLATFORM if the project's rules make it a platform PR)`. Какие PR платформенные, Orchestrator
по-прежнему решает по правилам Project-а и вносит их в `PLATFORM=(…)`. Такой PR вливается по-старому,
только после вердикта Windows. Это держится на тексте `rules.md`, а не на отметке. **Правку
`profile.json` и `rules.md` нужно сделать до первого `pnpm install:stable` с этой правкой или
одновременно с ним.** Иначе Stable copy получит новые skill-ы, а новый абзац `rules.md` о Check
«windows» без `workflow.pipeline` будет ссылаться на отметку, которую никто не ждёт.

`profile.json`, в `workflow` (порядок из spec, «Решения владельца», пункт 4):

```diff
     "ci_batch_run": "gh workflow run ci.yml --ref $ref -f job=check",
+    "pipeline": [
+      { "kind": "queued" }, { "kind": "implementing" }, { "kind": "ci" }, { "kind": "agent-review" },
+      { "kind": "check", "name": "windows" }, { "kind": "gate-merge" }, { "kind": "deploy" },
+      { "kind": "closing" }, { "kind": "done" }
+    ],
     "preflight": "…/bin/preflight --epic <эпик>"
```

С `deploy` Ticket-ы Wave остаются `claimed`, пока Orchestrator не запустит `pnpm install:stable`; если
`install:stable` после каждой Wave не делается, Stage `deploy` лучше пока не включать.

`rules.md`, раздел «Команды существуют только после тикета 01», пункт «Gate перед мержем PR с кодом»:

```diff
   набором после одного `GATE_SCOPE=all` gate full на общем дереве: `bin/wave-gate`, skill `epic-wave`,
-  раздел 4, «Gate before merge». Платформенные PR (ADR-0056, пункт 2) и PR с меткой `needs-mac-gate` —
-  по-старому: rebase, свой `GATE_SCOPE=all bash ~/.claude/worfy-harness/plugin/hooks/gate.sh full`, код 0
-  и строка «[gate] зелено». `full` = lint, typecheck, test, `test:e2e`, `test:package`:
+  раздел 4, «Gate before merge». **Вердикт Windows — Check «windows» Pipeline-а** (ADR-0067): перед
+  мержем на head-коммите каждого PR стоит `check/windows` `success` или `skipped`, его ставит
+  Orchestrator (`~/.claude/worfy-harness/plugin/bin/ticket mark <эпик> <NN> check/windows <вердикт> --sha <head>`).
+  Какой PR платформенный, решает ADR-0056, пункт 2: обычному — `skipped`; платформенному — `pending`,
+  затем по отчёту Session на Windows-ПК о том же коммите `success` (gate full, код 0 и
+  «[gate] зелено (full)») или `failure`. «Не удалось проверить» — без отметки, PR ждёт. PR с
+  `check/windows` `success` и PR с меткой `needs-mac-gate` — по-старому: rebase до запроса вердикта
+  Windows, свой `GATE_SCOPE=all bash ~/.claude/worfy-harness/plugin/hooks/gate.sh full`, код 0 и строка
+  «[gate] зелено». `full` = lint, typecheck, test, `test:e2e`, `test:package`:
```

С Stage `deploy` в `rules.md` нужен ещё абзац: кто и когда запускает `pnpm install:stable` после Wave.
