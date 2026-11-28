# 17: Case-ы: grill-with-docs, continuous-audit, prototype, writing-for-agents, max-review

Type: task
Status: open
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», 17; «Решения владельца», «Что значит весь Harness» (12 новых case-ов);
«Решения по реализации» («Новые case-ы»); «Решения по test-ам» (новые case-ы); «Волны», Wave 5

Кто: агент. Глубина ревью — `medium`.

Платный Ticket: кредиты (Ticket 01); отладка одного case-а раньше стоила 9–17 USD, пять case-ов — до 85 USD. Потолок
Ticket-а — 95 USD, ниже 100 USD по правилу владельца; каждый платный запуск — с `--max-cost-usd` по остатку. Если пятый
case не помещается, он переходит в новый Ticket следующего месяца, а не поднимает потолок. Сначала
`pnpm eval:harness -- --changed origin/main --dry-run` с теми же аргументами. Кредиты следующего цикла.

## Что происходит

- У skill-ов `grill-with-docs`, `continuous-audit`, `prototype`, `writing-for-agents` и `max-review` нет case-а
  (`harness/evals/lib/coverage.json`, `uncovered`).
- `grill-with-docs` модель сама не вызывает (`disable-model-invocation: true`): его case — на процесс после
  `/worfy:grill-with-docs`, не на срабатывание.

## Что строить

- По case-у на skill, по 2–3 run-а, grader-ы на исход:
  - `grill-with-docs`: задаёт вопросы по одному и записывает решение в ADR или глоссарий fixture-а;
  - `continuous-audit`: на fixture-е с посаженными находками находит их и пишет Ticket-ы только для находок выше
    `low` (правило владельца 2026-10-22);
  - `prototype`: прототип лежит отдельно от кода продукта и отвечает на вопрос из prompt-а;
  - `writing-for-agents`: правка SKILL.md fixture-а следует правилам skill-а (description, длина, формат);
  - `max-review`: на diff-е с посаженным дефектом даёт вердикт с префиксом `MAX-REVIEW` и называет дефект; ничего не
    правит и не сливает.
- Карта покрытия: пять skill-ов уходят из `uncovered`.

## Где в коде

- `harness/evals/<case>/` (новые case-ы, имена — предложение)
- `harness/evals/lib/coverage.json`
- Только читать: `harness/skills/grill-with-docs/`, `harness/skills/continuous-audit/`, `harness/skills/prototype/`,
  `harness/skills/writing-for-agents/`, `harness/skills/max-review/`

## Test-ы

- Нынешние contract test-ы устройства case-а — бесплатно в `pnpm test`.
- Один платный отладочный прогон каждого case-а — он же платный `--changed` этого PR.
- Настоящий binary Codex не запускается.

## Готово, когда

- [ ] Пять case-ов (или четыре и новый Ticket на пятый) в `harness/evals/` и карте покрытия.
- [ ] `--dry-run` в описании PR; платные отладочные прогоны на кредитах, сумма Ticket-а ниже 95 USD; строки
      `eval:harness …` в PR.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
