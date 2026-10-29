# 32 — Test размера стартового контекста агентов Harness: красный выше 35k token-ов

Type: task
Status: done 2026-10-29T05:16Z
PR: #951
Branch: worfy-throughput/32
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

- [x] Shell test из пункта 3 — три случая; exit 0 на зелёном пути.
- [x] Оценка на настоящих текстах против первого запроса реальных subagent-ов (по Ticket-у 19) — ошибка не
      больше 10 %; таблица в «Итог».
- [x] Порог читается из одного места; поднять его — правка с причиной в PR (комментарий у константы).
- [x] Shell test-ы Harness — exit 0; вердикт Windows — runner `full`; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
      #951: `ci-ok` зелёный, ПК прогнал `check/windows` — 36 проверок, 0 красных.

## Где в коде

- `harness/bin/start-context`, `harness/bin/tests/start-context.test.sh`, фикстуры рядом — новые
- Только читать: `harness/hooks/hooks.json`, `harness/hooks/inject-rules.mjs`, `harness/hooks/session-start.mjs`
  (предел секции 20 000 B, `:41`), `harness/agents/*.md`, `harness/skills/*/SKILL.md`

## Вне скоупа

- Сокращение текстов — Ticket 33.
- Контекст главной Session Orchestrator-а — Ticket 28.

## Итог

`harness/bin/start-context [--agent <имя>] [--profile <путь>] [--instructions <файл>]... [--json]` считает
стартовый контекст implementer-а, reviewer-а, verifier-а (тот же `agents/reviewer.md` с брифом verifier-а) и
scout-а: константа Claude Code агента + байты частей / 2,7. Части: определение агента без frontmatter с
раскрытым `${CLAUDE_PLUGIN_ROOT}`; то, что печатает сам hook `inject-rules.mjs common` для `SubagentStart`
(`common.md` и `$HARNESS_HOME/user/rules.md`); `CLAUDE.md` пользователя и work tree и первые 200 строк
`MEMORY.md` auto memory; типичный бриф; вывод `bin/profile` (или `profile.json` + `rules.md` из
`--profile`); для implementer-а — `SKILL.md` из `workflow.ticket_skill` Profile-а. Красная строка называет
агента, превышение и самую большую часть; exit code 1 выше порога, 2 — ошибка вызова. Порог `THRESHOLD =
35000` — одна константа в начале скрипта, комментарий у неё требует причину в PR при повышении.

### Калибровка (2026-10-29)

Транскрипты Subagent-ов `worfy:*` за 2026-10-22…29 (380 агентов), только чтение, через `agentType` из
`meta.json` и тот же счёт контекста, что в `scripts/agent-cost.mjs` (input + cache read + cache write).
Скрипт калибровки и его данные — в scratchpad, в репозиторий не входят.

- **Коэффициент.** Шаг «запрос → следующий запрос», где новое содержимое — только результат tool-а:
  прирост контекста минус output прошлого ответа = token-ы этого содержимого. Вывод `bin/profile` от 20 KB
  (JSON и `rules.md` по-русски), 294 шага: 2,68–2,77 байта на token; две загрузки skill `ship-ticket`:
  2,61; прочие шаги от 3 KB (код, логи), 3 820 шагов: 2,40. Взято 2,7.
- **Константа** = первый запрос минус (определение + правила hook-а + instructions + бриф, все байты из
  самого транскрипта) / 2,7, медиана за 26–29.10 (до 26.10 схемы tool-ов были больше): implementer 18 819
  (55 агентов), reviewer и verifier 5 867 (110), scout 6 402 (18). В скрипте округлено: 18 800, 5 900, 6 400.
- **Исключены** первые запросы Session-ов с большим числом MCP-коннекторов: список отложенных tool-ов
  длиннее на 65 KB, около +24 000 token-ов к константе (23 из 206 первых запросов за 26–29.10, медиана
  implementer-а там 101k). Это окружение, а не тексты Harness (Ticket 38); скрипт его не видит.

### Ошибка оценки

Скрипт запущен на копии Stable copy (тексты, которые агенты получали 26–29.10) с настоящими Profile-ом и
`CLAUDE.md`; факт — медиана по транскриптам за 26–29.10.

| Агент | Первый запрос: факт (n) | Оценка | Ошибка | + вывод `bin/profile`: факт (n) | Оценка | Ошибка |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| implementer | 34 599 (55) | 34 855 | +0,7 % | 46 452 (40) | 45 335 | −2,4 % |
| reviewer | 20 840 (17) | 21 334 | +2,4 % | 32 643 (12) | 31 814 | −2,5 % |
| verifier | 21 161 (93) | 21 704 | +2,6 % | 32 309 (81) | 32 184 | −0,4 % |
| scout | 14 763 (18) | 15 111 | +2,4 % | 24 470 (2) | 25 591 | +4,6 % |

- Skill `ship-ticket`, две загрузки через `Skill`: факт 22 158 token-ов, оценка 21 440 (−3,2 %).
- Проверка на отложенных данных: константы по 26–27.10, ошибка на агентах 28–29.10 с их собственными
  байтами — не больше 1,8 % (implementer, 19), 2,7 % (reviewer, 7), 2,9 % (verifier, 50), 1,6 % (scout, 1).
- Scout с выводом `bin/profile` — только 2 агента: для «10+ на роль» мало; первый запрос scout-а — 18.

### Настоящие тексты сейчас

На этой машине (Profile worfy, `rules.md` 23 KB, `CLAUDE.md` и `MEMORY.md` 9 KB): implementer **67 597 —
красный**, самая большая часть — `ship-ticket` 58 438 B (21 644 token-а), без skill-а 45 953; reviewer 31 855,
verifier 32 225, scout 25 619. В test-е (фикстура `rules.md` 23 250 B, без `CLAUDE.md`) implementer 61 696 —
известный красный: `KNOWN_OVER="implementer"` в `start-context.test.sh`, test печатает `KNOWN RED` и
краснеет, если список агентов выше порога изменится в любую сторону. Сократить тексты — Ticket 33; после него
список пустеет.

Наблюдения для Ticket-а 33:

- 105 из 117 implementer-ов за 22–29.10 skill `ship-ticket` не грузили вовсе (2 — через `Skill`, 10 — через
  `Read`), но и без него implementer выше порога: первый запрос 34,6k + вывод `bin/profile` 12k.
- Вывод `bin/profile` — 10,5k token-ов каждому агенту; reviewer и verifier до порога — меньше 3,2k.

Test-ы: `harness/bin/tests/start-context.test.sh` — exit 0, 36 проверок; mutation testing — 22 мутанта
скрипта (порог, `>` против `>=`, exit code, frontmatter, раскрытие корня plugin-а, самая большая часть,
skill, определение verifier-а, правила пользователя, части Profile-а, предел `MEMORY.md`, work tree против
main checkout, `--agent`, ошибки вызова, константа, заметка без Profile-а) — каждый краснит test.

Влит PR #951 (merge `c8b7c5cc`, 2026-10-29). Ошибка калибровки на честном окне (агенты, не входившие в
калибровку) — не больше 4,8 % (по ревью).
Замер на этой машине: implementer ~67,6k (46k без skill-а), reviewer 31,9k, verifier 32,2k, scout 25,6k.

### Долги (low)

- `KNOWN_OVER` без потолка: test не краснеет, если implementer растёт дальше, оставаясь в списке.
- Настоящие тексты считаются с пустыми instructions (`CLAUDE.md` и `MEMORY.md` не входят).
- Комментарий калибровки в скрипте называет не то окно.
- Читается только `CLAUDE.md` work tree, а не main checkout.
- Падение скрипта (необработанная ошибка) — exit 1, как превышение порога, а не 2.
