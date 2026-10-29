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

- [ ] Сначала падающий shell test: `harness/bin/tests/skill-blocks.test.sh` (или `epic-wave-ship-ticket.test.sh`)
      проверяет фразы `workflow.agents`, `Agents: eco`, `Agents: full —`; правила `eco` пункта 2 (мелкий Ticket
      без implementer-а, verifier остаётся; scout только на новую папку; один reviewer на `low`); список случаев,
      где `full` обязателен; строку отчёта с числом запущенных Subagent-ов (пункт 4).
- [ ] Schema принимает `"eco"`, `"full"`, отсутствие поля; отвергает другое значение — test по образцу
      `harness/bin/tests/review-depth.test.sh`, раздел 2 (`bin/project-connect --schema-only`).
- [ ] Shell test-ы Harness — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok`.
- [ ] Платный eval — только с «да» владельца и ценой из команды, которую eval реально запустит (решение 14 раздела «процесс»;
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
