# 36 — Режим `eco`: сколько Subagent-ов запускает Ticket — поле Profile

Type: task
Status: claimed 2026-10-29T03:16Z
Branch: worfy-throughput/36
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: меньше token-ов на Ticket, чтобы хватало Limits подписки», идея 1, строка L3
таблицы «Цель и числа»; шкала глубины ревью — [`worfy-review` 08](../../worfy-review/issues/08-глубина-ревью-четыре-ступени.md).

## Что происходит

- В Wave каждый Ticket — implementer и verifier (reviewer с линзой «отчёт implementer-а»). Глубина gate Wave —
  `F review.depth.wave`, без поля — `low` (`harness/skills/epic-wave/SKILL.md:506-511`). Scout идёт, только если
  список файлов Ticket-а неполный (`:240-243`).
- В ship-ticket число reviewer-ов задаёт глубина ревью (`harness/skills/ship-ticket/SKILL.md:343-346`, таблица
  `:355-357`). Без поля `review.depth.first_round` — «как было»: два-три reviewer-а по `review.ticket_lenses`
  (`:371-378`; поля — `harness/profiles/README.md:217-219`).
- Делает ли Orchestrator мелкий Ticket сам, без implementer-а, — правила нет: каждый Ticket получает implementer-а.
- Сколько token-ов уходит на агентов одного Ticket-а — базы нет; `scripts/agent-cost.mjs` (Ticket 19) считает по
  ролям за период, не по Ticket-у.

## Что делаем

1. Поле Profile `workflow.agents`: `"eco"` или `"full"`; нет поля — `"full"`, то есть как сейчас. Строка — в
   `harness/profiles/README.md` и `harness/profiles/draft.schema.json`.
2. Что меняет `eco` (текст skill-ов `epic-wave` и `ship-ticket`):
   - мелкий Ticket — только документы или одна правка в одном файле по «Где в коде» — Orchestrator делает сам, без
     implementer-а; verifier остаётся;
   - scout — только когда в «Где в коде» нет ни одного существующего файла или Ticket трогает папку, которой в
     прошлых Ticket-ах Epic-а не было; иначе Orchestrator читает файлы по `file:line` сам;
   - ship-ticket: один reviewer одной линзой, глубина `low`, если аргумент или слово владельца не говорят иное;
   - круг доработки и узкий круг Wave — без изменений.
3. `full` обязателен и в `eco`: PR меняет `harness/bin`, hooks или скрипты, PR платформенный (ADR-0056, пункт 2)
   или в diff есть удаление файлов, завершение процессов, замена копии (те же случаи, что блокируют merge по шкале
   `worfy-review` 08). Skill пишет в отчёт `Agents: eco` или `Agents: full — <причина>`.
4. Отчёт Wave и ship-ticket называет число запущенных Subagent-ов Ticket-а.

Нужен ПК: нет. **Трогает Harness: да** — skill-ы `epic-wave`, `ship-ticket`, `profiles/README.md`, schema; слово
владельца дано (Q-L0 spec-а: «да» 2026-10-28). Вердикт Windows: не платформенный PR, если не меняются скрипты `harness/bin` (test-ы в
`harness/bin/tests/` не в счёт). Общий файл с 07, 13, 26, 27, 28 — `epic-wave/SKILL.md`, с 33 — `ship-ticket/SKILL.md`: claim после 28 и 33.

## Готово, когда

- [x] Сначала падающий shell test: `harness/bin/tests/skill-blocks.test.sh` (или `epic-wave-ship-ticket.test.sh`)
      проверяет фразы `workflow.agents`, `Agents: eco`, `Agents: full —`; правила `eco` пункта 2 (мелкий Ticket
      без implementer-а, verifier остаётся; scout только на новую папку; один reviewer на `low`); список случаев,
      где `full` обязателен; строку отчёта с числом запущенных Subagent-ов (пункт 4).
- [x] Schema принимает `"eco"`, `"full"`, отсутствие поля; отвергает другое значение — test по образцу
      `harness/bin/tests/review-depth.test.sh`, раздел 2 (`bin/project-connect --schema-only`).
- [x] Shell test-ы Harness — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok`.
- [x] Платный eval — только с «да» владельца и ценой из команды, которую eval реально запустит (решение 14 раздела «процесс»;
      урок 2026-10-22: $30,29 вместо одобренных ~$1).
- [ ] (вручную, после обновления Stable copy) Одна Wave с `eco`: число Subagent-ов на Ticket и token-ы по
      `scripts/agent-cost.mjs` — в «Итог» рядом с прошлой Wave такого же размера.

## Где в коде

- `harness/skills/epic-wave/SKILL.md` (`:240-243`, `:506-511`)
- `harness/skills/ship-ticket/SKILL.md` (`:343-357`, `:371-378`)
- `harness/profiles/README.md` (`:217-219`), `harness/profiles/draft.schema.json`
- `harness/bin/tests/skill-blocks.test.sh` или `epic-wave-ship-ticket.test.sh`

## Вне скоупа

- Модель и effort агентов — Ticket 37. Preset по плану — Ticket 42. Шкала ревью чужого PR — без изменений.

## Итог

PR #950, head `cdfb6890`. Implementer Ticket-а 36, 2026-10-29, Mac владельца.

### Что сделано

- Поле Profile `workflow.agents`: `"eco"`, `"full"` или `null`; нет поля или `null` — `full`, агенты как сейчас.
  Строка — `harness/profiles/README.md:186`, schema — `harness/profiles/draft.schema.json:114`
  (`enum: ["eco", "full", null]`). `null` принят, как у соседних полей `workflow` (`merge_gate`, `ci`).
- `epic-wave`, раздел 1 (`SKILL.md:245`): абзац «Agents mode» — режим по Ticket-у в preflight по «Где в коде»; scout в
  `eco` — только если ни одного файла из списка ещё нет или Ticket трогает папку, которой нет в «Где в коде» прошлых
  Ticket-ов Epic-а; мелкий Ticket (только документы или одна правка в одном файле) — без implementer-а, verifier остаётся.
- `epic-wave`, раздел 2 (`:343`): мелкий Ticket Orchestrator делает сам, в своём worktree по `F worktree.implementer`, и
  отдаёт verifier-у поля отчёта implementer-а; в плане в колонке «Who» — `orchestrator`.
- `epic-wave`, раздел 3 (`:535`): gate в `eco` не меняется — verifier остаётся, круг доработки и узкий круг как были.
- `epic-wave`, раздел 5 (`:1547`): под таблицей для каждого Ticket-а строки `Agents: …` и `Subagents: <число> — <имена>`.
- `ship-ticket`, шаг 7 (`SKILL.md:381`): в `eco` каждый круг ревью своего diff-а — глубина `low`, один reviewer одной
  линзой, если аргумент или слово владельца не задают другую; это раньше полей `review.depth`. Режим решается по diff-у
  круга до старта reviewer-ов.
- Случаи, где `full` обязателен и в `eco` (скрипт или hook — `bin/` и `hooks/` Harness или скрипт репозитория;
  платформенный PR по `rules.md` Project-а; diff с удалением файлов, завершением процессов, заменой копии), и строки
  отчёта `Agents: eco` / `Agents: full — <причина>` и `Subagents: …` — одним и тем же предложением в обоих skill-ах;
  test сверяет их слово в слово.
- В тексте plugin-а нет номеров ADR и путей репозитория worfy (`plugin-neutral.test.sh`): «платформенный PR» описан
  словами — PR, которому по `rules.md` Project-а нужен вердикт другой ОС.

### Test-ы

- Раздел 9e в `harness/bin/tests/epic-wave-ship-ticket.test.sh` (`:870`): фразы обоих skill-ов и README, плюс schema
  через `bin/project-connect --schema-only` по образцу `review-depth.test.sh`, раздел 2 — без поля, `eco`, `full`, `null`
  проходят; `"lean"`, `"ECO"` и число отвергнуты с `"path": "profile.workflow.agents"`; `HARNESS_HOME` после run-а пуст.
- До правки skill-ов, README и schema: exit 1, `passed 423, failed 24` (красные — все новые проверки, в том числе три
  отказа schema: она принимала любое значение). После: exit 0, `passed 447, failed 0`.
- Отдельный файл test-а не заведён: «Где в коде» называет `skill-blocks.test.sh` или `epic-wave-ship-ticket.test.sh`.

### Проверки

Каждый shell test — под временным HOME (пустые `.zshenv`, `.zprofile`, `.zshrc`, `HARNESS_HOME` на настоящий дом Harness):

| Test | Exit |
| --- | --- |
| `harness/bin/tests/epic-wave-ship-ticket.test.sh` | 0 (447/0) |
| `harness/bin/tests/skill-blocks.test.sh` | 0 (86/0) |
| `harness/bin/tests/agents-text.test.sh` | 0 (228/0) |
| `harness/bin/tests/plugin-neutral.test.sh` | 0 (31/0) |
| `harness/bin/tests/profile.test.sh` | 0 (81/0) |
| `harness/bin/tests/review-depth.test.sh` | 0 (105/0) |
| `harness/bin/tests/project-connect.test.sh` (schema) | 0 (200/0) |
| `harness/bin/tests/skills-allowed.test.sh` (schema) | 0 (15/0) |
| `harness/hooks/tests/rules-hooks.test.sh` | 0 (201/0) |
| `test/contract/harness-scripts.test.ts` целиком и `projects-connect`, `harness-plugin`, `ci-workflow`, `e3-owner-check`, `harness-migrate` (читают schema или README) | 0 (6 файлов, 348 passed, 1 skipped) |
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| gate fast | первый run — 2: flaky test `test/contract/claude-home-registry.test.ts:597` (watcher, «no matching change yet»); файл отдельно дважды — exit 0; повтор gate fast — exit 0, `[gate] green (fast)` |

Платный eval не запускался.

### Вердикт Windows

`node scripts/windows-verdict-scope.mjs cad8e228 HEAD` — `runner`, exit 0: в diff нет скриптов `harness/bin` и
`harness/hooks`, только test в `harness/bin/tests/`. Вердикт — job `windows / full-suite` в `ci-ok`.

### CI

Run 40812733980 на head `cdfb6890`: `ci-ok` — success. Зелёные `lint-typecheck`, `linux-tests` 1–4/4, `macos-tests`,
`macos-e2e` 1–2/2, `windows (1/3)`–`(3/3) / full-suite` (404, 301, 833 s), `windows-e2e` 2–4/4. Красный один job —
`windows-e2e (1/4)`: 1 failed, 86 passed, `test/e2e/arrange-by-epic.spec.ts:136` («Arrange by Epic from ⌘K…»,
`toEqual`). Этот job пока не блокирует (`NON_BLOCKING` в `ci-ok`), а PR не меняет код приложения и e2e. Поэтому
общий подсчёт checks PR даёт `CI=fail`, а условие merge — `ci-ok` — зелёное.

### Не сделано

- Ручной пункт: одна Wave с `eco` и число Subagent-ов и token-ов по `scripts/agent-cost.mjs` рядом с прошлой Wave —
  после обновления Stable copy.
- `bin/profile` не проверяет значение `workflow.agents` (только schema черновика `connect-project`): профиль, правленный
  руками, с другим значением skill читает как есть. Правка `harness/bin` сделала бы PR платформенным; вне скоупа.
