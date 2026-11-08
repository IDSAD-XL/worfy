# 05 — Eval-ы переименованных skills и проверка на Stable copy

Type: task
Status: done 2026-11-08T09:15Z
PR: #1642
Blocked by: 01, 02, 03
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 7; «Как работает» → «Документация, ADR, eval-ы»; «Риски», п. 2, 4

Не платформенный: случаи eval и запись прогона; платный прогон — на Mac владельца. Глубина ревью — `low`.

## Что происходит

- Eval-ы Harness — случаи `harness/evals/<case>/` (`case.yaml`, `prompt.md`, `graders/`, `scaffold.sh`), прогон
  `pnpm eval:harness` → `claude plugin eval` на учётной записи владельца (`scripts/eval-harness.mjs:1-4`). Не в CI и не
  в gate.
- Бюджет прогона — не выше `BUDGET_USD = 30` (`scripts/eval-harness.mjs:81`); `--max-cost-usd <x>` только снижает его;
  `--dry-run` печатает план вызовов и ничего не тратит.
- Plugin под test-ом — временная копия `harness/` (`scripts/eval-harness.mjs:13-15`): в прогоне стоит только `worfy`, без
  `mattpocock-skills`, так что случай видит только копии worfy.
- Случаев на skills Matt Pocock нет: Ticket 01 записал их файлы в `uncovered` (`harness/evals/lib/coverage.json`).

## Что делаем

1. Случаи eval (английский текст, tag `main`):
   - `skill-grilling-trigger` — просьба «grill me on this plan» → вызов Skill `worfy:grilling`, ни одного
     `mattpocock-skills:`;
   - `skill-wayfinder-refs` — `/worfy:wayfinder` на demo-проекте → вызовы `worfy:grilling` и `worfy:domain-modeling`;
     Ticket карты записан по `TICKETS.md` (`Type:`, `Status:` через `bin/ticket`, без `resolved`);
   - `skill-to-tickets-format` — `/worfy:to-tickets` → Ticket-ы в `tickets.root` с шапкой `TICKETS.md`, `epic-status`
     их читает без «old header»;
   - `skill-code-review` — `/worfy:code-review` с точки отсчёта → отчёт по двум осям (стандарты и spec).
2. `coverage.json`: файлы skills, которые покрыты, — в `cases`; остальные остаются в `uncovered` с причиной.
3. **Платный прогон** (разрешён заранее до 100 USD): сначала
   `pnpm eval:harness -- --dry-run --max-cost-usd 30 --case 'skill-*'` — план и бюджет в «Итог»; затем тот же вызов без
   `--dry-run`. Строки расхода по каждому вызову — в «Итог».
4. **Stable copy владельца** после merge 01–03 и Update: в списке slash-команд есть `/worfy:grilling` и
   `/worfy:code-review`; plugin `mattpocock-skills`, который владелец поставил сам до worfy, на месте (правило Q5, подтверждено владельцем 2026-11-07).

## Готово, когда

- [ ] Четыре случая в `harness/evals/`; `test/contract/harness-evals.test.ts` и
      `node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.
  - evidence: test-run pass · `pnpm test test/contract/harness-evals.test.ts test/contract/harness-evals-run.test.ts test/contract/harness-third-party-skills.test.ts` exit 0; `node scripts/eval-harness.mjs --dry-run --changed origin/main` exit 0 · mac - · a5fdef05e5c991e395ca1016174a1d7bdad98e9d
- [ ] Dry run: план вызовов и бюджет записаны в «Итог»; бюджет не выше 30 USD.
  - evidence: test-run pass · `pnpm eval:harness -- --dry-run --max-cost-usd 10 --case skill-*` exit 0, 4 calls, budget 10 USD · mac - · a5fdef05e5c991e395ca1016174a1d7bdad98e9d
- [ ] Платный прогон: каждый случай проходит в большинстве run-ов; расход по вызовам и итог — в «Итог».
  - evidence: test-run pass · `pnpm eval:harness -- --max-cost-usd 10 --case skill-*` exit 0, 4 of 4 cases passed, 4.72 USD · mac - · a5fdef05e5c991e395ca1016174a1d7bdad98e9d
- [ ] (вручную) На Stable copy Mac: `/worfy:grilling` и `/worfy:code-review` в списке slash-команд поля ввода.
  - needs: mac stable
- [ ] (вручную) На Stable copy Mac после Update: `mattpocock-skills`, поставленный владельцем до worfy, не удалён.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · a5fdef05e5c991e395ca1016174a1d7bdad98e9d
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42448218940/job/128633210122 · ci - · 685e647b66f502955d78fd13292b1887cd82e8c7

## Тесты

- Contract `test/contract/harness-evals.test.ts` — случаи и карта покрытия.
- Сначала падающий: grader `skill-grilling-trigger` красный на копии Harness без Ticket-а 01 (`HARNESS_DIR` на
  `main` до 01) — в dry run это видно по плану, в платном прогоне — по результату; если платить за красный прогон
  жалко, показать красный grader на записанном транскрипте.

## Где в коде

- `harness/evals/skill-grilling-trigger/**` (новый)
- `harness/evals/skill-wayfinder-refs/**` (новый)
- `harness/evals/skill-to-tickets-format/**` (новый)
- `harness/evals/skill-code-review/**` (новый)
- `harness/evals/lib/coverage.json`
- `test/contract/harness-evals.test.ts`
- `.scratch/worfy-skills/evidence/05-*` (новые)

Только читать: `scripts/eval-harness.mjs`, `scripts/eval-harness-coverage.mjs`, `harness/evals/lib/demo-project.sh`,
`harness/evals/status-block/` (образец случая).


## Итог

Четыре случая eval (tag `main`, по 3 run-а): `harness/evals/skill-grilling-trigger`, `skill-wayfinder-refs`,
`skill-to-tickets-format`, `skill-code-review`. `coverage.json` относит к ним `SKILL.md` пяти skills: grilling, wayfinder,
domain-modeling, to-tickets, code-review. Остальные файлы копии остались в `uncovered`, у каждого своя причина:
- `agents/openai.yaml` — manifest Codex, Claude Code его не читает;
- форматы domain-modeling — случай проверяет вызов skill-а, а не формат;
- прочие — случая пока нет.

Graders:
- grilling — вызов Skill `worfy:grilling`; ни одного вызова Skill другого plugin-а; вопросы раунда в формате `**Q1**`;
- wayfinder — вызовы `worfy:grilling` и `worfy:domain-modeling`; файл `.scratch/cli/map.md`; Ticket карты с `Type:` и
  `Status: open` по `bin/TICKETS.md`; ни Write, ни Edit не пишут Status вне open/claimed/blocked/done;
- to-tickets — файл `.scratch/greet/issues/01-*.md`; шапка `Type: task` / `Status: open` / `Blocked by:`; ни Write, ни Edit
  не пишут old header;
- code-review — не меньше двух вызовов Agent; заголовки `Standards` и `Spec`. Два regex-grader-а проверяют, что раздел
  Standards называет `export default` или JSDoc, а раздел Spec — нет `test/alpha.test.mjs`. `CODING_STANDARDS.md` fixture-а о
  test-ах молчит, так что каждый дефект принадлежит одной оси. llm-judge больше нет.

Grader «ни одного Skill другого plugin-а» может упасть. В run-е стоит только worfy, поэтому вызов чужого имени отказан. Но
отказанный вызов всё равно остаётся tool call-ом в trace. Его делает копия, в тексте которой осталась ссылка на upstream-имя.
Grader-ы «called» такую копию пропускают, если после отказа модель вызывает имя `worfy:`.

Contract test (`test/contract/harness-evals.test.ts`, describe «the cases of the copied skills») сверяет каждый grader с тем,
кто читает то же самое:
- шапки обоих случаев — с `epic-status --json` на fixture-е случая: хорошая шапка без `statusError`, old header —
  `"old header"`;
- слова Type — со строкой `bin/TICKETS.md`;
- формат раунда — с текстом `skills/grilling`;
- regex-grader-ы — со своими `pattern` и `flags`.

**Сначала падающий.** Без копии skills test красный. С убранной `harness/skills/grilling` тот же файл дал
`Tests 2 failed | 117 passed`, exit 1: «each worfy:<skill> … is a skill of the plugin» и «the round grader …». На `main` до
Ticket-а 01 (`1b0f76311^`) нет ни одного из `skills/{grilling,domain-modeling,wayfinder,to-tickets,code-review}/SKILL.md`
(`git cat-file -e` → 128). `worfy:grilling` там вызвать нечем, и grader `grilling-called` красный в каждом run-е. Красный
платный прогон не запускали.

**Dry run** (`pnpm eval:harness -- --dry-run --max-cost-usd 10 --case 'skill-*'`, exit 0):
- бюджет 10 USD (`--max-cost-usd 10`), вызов gui пропущен;
- 4 вызова `claude plugin eval` с `--tag main --case <случай>`: `main-skill-code-review`, `main-skill-grilling-trigger`,
  `main-skill-to-tickets-format`, `main-skill-wayfinder-refs`;
- у каждого `--model claude-sonnet-5 --judge-model claude-haiku-4-5 --threshold 0.8`. Первый получает `--max-cost-usd 10`,
  следующие — остаток бюджета.

`node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.

**Платный прогон** на commit-е a5fdef05e — последнем commit-е, где менялись grader-ы
(`pnpm eval:harness -- --max-cost-usd 10 --case 'skill-*'`, claude 2.1.289, exit 0):

| Вызов | run 1 | run 2 | run 3 | Итого вызова | Score | Прошли run-ы |
| --- | --- | --- | --- | --- | --- | --- |
| skill-code-review | 1.00, 0.34 USD | 1.00, 0.35 USD | 1.00, 0.34 USD | 1.03 USD | 1.00 | 3 из 3 |
| skill-grilling-trigger | 1.00, 0.30 USD | 0.67, 0.37 USD | 1.00, 0.22 USD | 0.89 USD | 0.89 | 2 из 3 |
| skill-to-tickets-format | 1.00, 0.29 USD | 1.00, 0.22 USD | 1.00, 0.17 USD | 0.68 USD | 1.00 | 3 из 3 |
| skill-wayfinder-refs | 1.00, 0.63 USD | 1.00, 0.72 USD | 1.00, 0.77 USD | 2.12 USD | 1.00 | 3 из 3 |

Итого 4.72 USD из 10. Каждый случай прошёл: `casesPassed 1 of 1` в каждом вызове.

В run 2 случая grilling `worfy:grilling` вызван, но в последнем сообщении нет `**Q1**`: grader `numbered-round` — «pattern not
found». Транскрипт run-а был во временной папке и не сохранился.

Прошлые прогоны:
- первая попытка в круге 1 — отказ до старта, 0.00 USD: credential store Docker в домашней папке держит symbolic link-и. По
  правилу владельца Q6 (2026-10-29) Orchestrator убирает их на время прогона и возвращает после;
- прогон круга 1 — 4.52 USD, на grader-ах до правок ревью. Заменён этим.

Run-ы шли с собственными HOME и `CLAUDE_CONFIG_DIR` во временной папке `claude plugin eval`. Транскрипты и результаты в
репозиторий не кладутся (`harness/evals/results/` в `.gitignore`).
