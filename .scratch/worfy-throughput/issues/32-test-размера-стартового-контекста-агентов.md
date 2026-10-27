# 32 — Test размера стартового контекста агентов Harness: красный выше 35k token-ов

Type: task
Status: open
Blocked by: 19
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 5, решение 11;
аналитика 2026-10-27: стартовый контекст implementer-а
28k → 88k (19–21.10) → 33k (26.10).

## Что происходит

- Что попадает в начало контекста агента: system prompt Claude Code и схемы tool-ов; `CLAUDE.md`; правила hook-а
  `SubagentStart` — `inject-rules.mjs common` (`harness/hooks/hooks.json:51-60`; `harness/hooks/rules/common.md`
  5 920 B и правила пользователя `$HARNESS_HOME/user/rules.md`); определение агента
  (`harness/agents/implementer.md` 23 410 B, `reviewer.md` 23 287 B, `scout.md` 4 819 B); первая команда
  implementer-а — `bin/profile`, который печатает `rules.md` Profile-а (у worfy 23 250 B); skill, который агент
  грузит до работы (`ship-ticket` 57 818 B).
- Test-а на размер нет: `agents-text.test.sh` проверяет формулировки, gate предупреждает только об исходниках
  длиннее 1000 строк. Рост до 88k никто не заметил, пока не посчитала аналитика.

## Что делаем

1. `harness/bin/start-context [--agent <name>] [--profile <path>] [--json]`: на каждого агента — список частей
   и их байты, оценка token-ов = байты / коэффициент + константа Claude Code; итог против порога 35 000.
   Коэффициент и константа — в начале скрипта, с датой и источником калибровки.
2. Калибровка: по Ticket-у 19 — первый запрос 10+ subagent-ов каждой роли за последнюю неделю против суммы байт
   их частей; метод и числа — в комментарии скрипта и в «Итог».
3. `harness/bin/tests/start-context.test.sh`: на фикстуре — части меньше порога — код 0; часть, раздутая выше
   порога, — код 1 с именем агента и самой большой частью; на настоящих текстах `harness/` и фикстурном
   `rules.md` 23 KB — код 0 или явный красный, который чинит Ticket 33.

Нужен ПК: нет. **Трогает Harness: да** — новый скрипт `harness/bin/start-context` и его shell test (тексты
агентов и skill-ов не меняет); слово владельца дано 2026-10-28 (решение 1). Вердикт Windows: runner `full`
(скрипт Harness).

## Готово, когда

- [ ] Shell test из пункта 3 — три случая; exit 0 на зелёном пути.
- [ ] Оценка на настоящих текстах против первого запроса реальных subagent-ов (по Ticket-у 19) — ошибка не
      больше 10 %; таблица в «Итог».
- [ ] Порог читается из одного места; поднять его — правка с причиной в PR (комментарий у константы).
- [ ] Shell test-ы Harness — exit 0; вердикт Windows — runner `full`; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

## Где в коде

- `harness/bin/start-context`, `harness/bin/tests/start-context.test.sh`, фикстуры рядом — новые
- Только читать: `harness/hooks/hooks.json`, `harness/hooks/inject-rules.mjs`, `harness/hooks/session-start.mjs`
  (предел секции 20 000 B, `:41`), `harness/agents/*.md`, `harness/skills/*/SKILL.md`

## Вне скоупа

- Сокращение текстов — Ticket 33.
- Контекст главной Session Orchestrator-а — Ticket 28.

## Итог
