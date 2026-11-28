# 14: Матрица срабатывания 22 skill-ов

Type: task
Status: open
Blocked by: 01, 02, 03
Source: [spec.md](../spec.md), «Ticket-ы», 14; «Решения владельца», «Что значит весь Harness» (срабатывание всех skill-ов,
которые вызывает модель: 2 фразы «должен», 1 «не должен», по 3 run-а) и «Провал» (skill, который перехватывает чужие
фразы или молчит, сначала получает новый description, потом вопрос владельцу); «Решено советником» (фразы «не должен»
— из области соседних skill-ов); «Решения по реализации» («Срабатывание»); «Волны», Wave 5

Кто: агент. Глубина ревью — `medium`.

Платный Ticket: кредиты (Ticket 01), оценка 20–60 USD; потолок Ticket-а — `--max-cost-usd 60`, ниже 100 USD по правилу
владельца. Сначала `pnpm eval:harness -- --dry-run` с теми же аргументами. Кредиты следующего цикла: Orchestrator
берёт Ticket, когда остаток кредитов месяца покрывает потолок.

## Что происходит

- Модель сама выбирает skill. Проверку «нужный skill сработал на обычные слова» имеют 4 case-а (например
  `harness/evals/skill-grilling-trigger/`).
- Skill-ов, которые вызывает модель (без `disable-model-invocation: true`), на main `c66e7215a` — 22. Решение владельца
  называло 21: после него добавился `orchestrator-rules` (worfy-polish 160, #2289). Его вызывают правила
  Orchestrator-а в определённые моменты, а не слова человека: его фразы «должен» — эти моменты; если осмысленных фраз
  нет, он идёт в `uncovered` карты покрытия с причиной.

## Что строить

- На каждый из 22 skill-ов — case с тремя фразами: 2 «должен сработать» и 1 «не должен» (из области соседнего skill-а).
  Grader «должен» требует вызова нужного skill-а, grader «не должен» запрещает его. По 3 run-а.
- Run короткий: проверка кончается на первом вызове skill-а.
- Case-ы и их фразы — в `harness/evals/` и в карте покрытия `harness/evals/lib/coverage.json`, как нынешние case-ы.
- Матрица — таблица «skill × фраза → k из n» и кто кого перехватывает; запись прогона — по Ticket-у 03.
- Skill, который молчит на своих фразах или перехватывает чужие: сначала Ticket в worfy-polish на новый description;
  после второго провала подряд — вопрос владельцу. Ничего не удаляется.

## Где в коде

- `harness/evals/<skill>-trigger/` (новые case-ы, имена — предложение), образец — `harness/evals/skill-grilling-trigger/`
- `harness/evals/lib/coverage.json`
- `harness/skills/*/SKILL.md` — только читать: description и `disable-model-invocation`
- `test/contract/harness-evals.test.ts` — устройство case-ов

## Test-ы

- Нынешние contract test-ы устройства case-а (`test/contract/harness-evals.test.ts`, `harness-evals-run.test.ts`) —
  бесплатно в `pnpm test`.
- Платный прогон матрицы — он же платный `--changed` этого PR по `harness/README.md` («When to run the evals»).
- Настоящий binary Codex не запускается.

## Готово, когда

- [ ] 22 case-а срабатывания (или 21 и `orchestrator-rules` в `uncovered` с причиной) в `harness/evals/` и карте.
- [ ] `--dry-run` в описании PR; платный прогон на кредитах ниже 60 USD; строки `eval:harness …` в PR.
- [ ] Матрица и запись прогона в репозитории; перехваты и молчания названы.
- [ ] Ticket-ы worfy-polish на description по правилу провала — номера в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
