# 16: Case-ы: connect-project, research, diagnosing-bugs, owner-check

Type: task
Status: open
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», 16; «Решения владельца», «Что значит весь Harness» (12 новых case-ов; 13
skill-ов без вызовов за 30 дней case-ов не получают); «Решения по реализации» («Новые case-ы»); «Решения по test-ам»
(новые case-ы); [вызовы skill-ов за 30 дней](../../../docs/product/harness-eval/research-вызовы-skill-ов-за-30-дней.md);
«Волны», Wave 5

Кто: агент. Глубина ревью — `medium`.

Платный Ticket: кредиты (Ticket 01); отладка одного case-а раньше стоила 9–17 USD. Потолок Ticket-а — 80 USD, ниже 100
USD по правилу владельца; каждый платный запуск — с `--max-cost-usd` по остатку. Сначала `pnpm eval:harness --
--changed origin/main --dry-run` с теми же аргументами. Кредиты следующего цикла.

## Что происходит

- У skill-ов `connect-project`, `research`, `diagnosing-bugs` и `owner-check` нет case-а: в
  `harness/evals/lib/coverage.json` они в `uncovered` (у `owner-check` — «bin/tests/owner-check.test.sh runs its record
  block»).
- С `connect-project` начинается подключение любого проекта; `research`, `diagnosing-bugs` и `owner-check` владелец
  вызывает чаще других.

## Что строить

- По case-у на skill, по 2–3 run-а, grader-ы на исход, а не на слова:
  - `connect-project`: на демо-репозитории (`harness/evals/lib/demo-project.sh`) предлагает Profile и `rules.md` и без
    подтверждения ничего не пишет (`--draft-only`);
  - `research`: на вопрос с первоисточником в fixture-е пишет файл с выводами и ссылками на источник, не выдумывает
    ссылок;
  - `diagnosing-bugs`: на fixture-е с багом сначала воспроизводит его падающим test-ом, потом чинит; скрытый test
    зелёный;
  - `owner-check`: записывает строку Evidence `owner-check` через `ticket evidence`; Fail заводит Ticket доработки в
    том же Epic-е.
- Сеть: case `research` без доступа в интернет — источник лежит в fixture-е.
- Карта покрытия: четыре skill-а уходят из `uncovered`.

## Где в коде

- `harness/evals/<case>/` (новые case-ы, имена — предложение)
- `harness/evals/lib/coverage.json`, `harness/evals/lib/demo-project.sh`
- Только читать: `harness/skills/connect-project/`, `harness/skills/research/`, `harness/skills/diagnosing-bugs/`,
  `harness/skills/owner-check/`, `harness/bin/tests/owner-check.test.sh`

## Test-ы

- Нынешние contract test-ы устройства case-а — бесплатно в `pnpm test`.
- Один платный отладочный прогон каждого case-а — он же платный `--changed` этого PR.
- Настоящий binary Codex не запускается.

## Готово, когда

- [ ] Четыре case-а в `harness/evals/` и карте покрытия.
- [ ] `--dry-run` в описании PR; платные отладочные прогоны на кредитах, сумма Ticket-а ниже 80 USD; строки
      `eval:harness …` в PR.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
