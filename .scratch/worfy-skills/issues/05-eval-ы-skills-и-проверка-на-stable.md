# 05 — Eval-ы переименованных skills и проверка на Stable copy

Type: task
Status: open
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
  - evidence: test-run pass · `pnpm test test/contract/harness-evals.test.ts test/contract/harness-evals-run.test.ts test/contract/harness-third-party-skills.test.ts` exit 0; `node scripts/eval-harness.mjs --dry-run --changed origin/main` exit 0 · mac - · cc5fe50da9d360a5a02d6e7d73cde53c4bcb2001
- [ ] Dry run: план вызовов и бюджет записаны в «Итог»; бюджет не выше 30 USD.
  - evidence: test-run pass · `pnpm eval:harness -- --dry-run --max-cost-usd 30 --case skill-*` exit 0, 4 calls, budget 30 USD · mac - · cc5fe50da9d360a5a02d6e7d73cde53c4bcb2001
- [ ] Платный прогон: каждый случай проходит в большинстве run-ов; расход по вызовам и итог — в «Итог».
  - evidence: test-run pass · `pnpm eval:harness -- --max-cost-usd 30 --case skill-*` exit 0, 4 of 4 cases passed, 4.52 USD · mac - · 4ce69910a
- [ ] (вручную) На Stable copy Mac: `/worfy:grilling` и `/worfy:code-review` в списке slash-команд поля ввода.
  - needs: mac stable
- [ ] (вручную) На Stable copy Mac после Update: `mattpocock-skills`, поставленный владельцем до worfy, не удалён.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · cc5fe50da9d360a5a02d6e7d73cde53c4bcb2001

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

Четыре случая eval (tag `main`, по 3 run-а) — `harness/evals/skill-grilling-trigger`, `skill-wayfinder-refs`,
`skill-to-tickets-format`, `skill-code-review`; `coverage.json` относит к ним `SKILL.md` skills grilling, wayfinder,
domain-modeling, to-tickets и code-review. Остальные файлы копии остались в `uncovered`: у `agents/openai.yaml` причина
«manifest Codex, Claude Code его не читает», у прочих — «случая пока нет, покрыты только четыре skills».

Graders, которые нужны случаям:
- grilling — вызов Skill `worfy:grilling`, ни одного вызова Skill другого plugin-а, вопросы раунда в формате `**Q1**`;
- wayfinder — вызовы `worfy:grilling` и `worfy:domain-modeling`, файл `.scratch/cli/map.md`, Ticket карты с `Type:` и
  `Status: open` по `bin/TICKETS.md`, ни одного Status вне open/claimed/blocked/done;
- to-tickets — файл `.scratch/greet/issues/01-*.md`, шапка `Type: task` / `Status: open` / `Blocked by:`, без old header;
- code-review — не меньше двух вызовов Agent, заголовки `Standards` и `Spec`, llm-judge проверяет находки обеих осей.

Contract test (`test/contract/harness-evals.test.ts`, describe «the cases of the copied skills») сверяет каждый grader с тем, кто
читает то же самое: шапку — с `epic-status --json` (хорошая шапка без `statusError`, old header — `"old header"`), формат
раунда — с текстом `skills/grilling`, заголовки — с `skills/code-review`.

**Сначала падающий.** Без копии skills test красный: с убранной `harness/skills/grilling` тот же файл даёт
`Tests 2 failed | 117 passed`, exit 1. Падают «each worfy:<skill> … is a skill of the plugin» и «the round grader …». На
`main` до Ticket-а 01 (`1b0f76311^`) нет ни одного из `skills/{grilling,domain-modeling,wayfinder,to-tickets,code-review}/SKILL.md`
(`git cat-file -e` → 128): `worfy:grilling` там вызвать нечем, и grader `grilling-called` красный в каждом run-е. Красный
платный прогон не запускали — он стоил бы денег без новой информации.

**Dry run** (`pnpm eval:harness -- --dry-run --max-cost-usd 30 --case 'skill-*'`, exit 0): бюджет 30 USD
(`--max-cost-usd 30`). Вызов gui пропущен. 4 вызова `claude plugin eval` с `--tag main --case <случай>`:
`main-skill-code-review`, `main-skill-grilling-trigger`, `main-skill-to-tickets-format`, `main-skill-wayfinder-refs`. У каждого
`--model claude-sonnet-5 --judge-model claude-haiku-4-5 --threshold 0.8`; первый получает `--max-cost-usd 30`, следующие —
остаток бюджета. `node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.

**Платный прогон** (`pnpm eval:harness -- --max-cost-usd 30 --case 'skill-*'`, claude 2.1.289, exit 0):
- первая попытка отказана до старта, 0.00 USD: credential store Docker в домашней папке держал symbolic link-и, sandbox Bash
  такие не исключает. По правилу владельца Q6 (2026-10-29) Orchestrator убрал ссылки на время прогона и возвращает их после него;
- вторая попытка, расход по вызовам:

| Вызов | run 1 | run 2 | run 3 | Итого вызова (с judge) | Score | Прошли run-ы |
| --- | --- | --- | --- | --- | --- | --- |
| skill-code-review | 1.00, 0.45 USD | 1.00, 0.37 USD | 0.67, 0.31 USD | 1.13 USD | 0.89 | 2 из 3 |
| skill-grilling-trigger | 1.00, 0.27 USD | 1.00, 0.19 USD | 1.00, 0.20 USD | 0.67 USD | 1.00 | 3 из 3 |
| skill-to-tickets-format | 1.00, 0.19 USD | 1.00, 0.21 USD | 1.00, 0.27 USD | 0.66 USD | 1.00 | 3 из 3 |
| skill-wayfinder-refs | 1.00, 0.64 USD | 1.00, 0.72 USD | 1.00, 0.69 USD | 2.06 USD | 1.00 | 3 из 3 |

Итого 4.52 USD из 30. Каждый случай прошёл: `casesPassed 1 of 1` в каждом вызове. В run 3 случая code-review judge (haiku)
трижды сказал FAIL про `findings-on-both-axes`, хотя ответ называет default export и JSDoc в Standards и нет
`test/alpha.test.mjs` в Spec. Это ложный FAIL judge-а, а не поведение skill-а.

Прогон шёл на commit-е до переименования grader-а `no-mattpocock-skill` → `no-other-plugin-skill`. Новый grader отказывает вызов
Skill любого plugin-а, кроме `worfy:`, — это шире старого. Contract test проверяет оба случая. Переименование понадобилось
потому, что `harness-third-party-skills.test.ts` запрещает имя upstream-plugin-а в `harness/`. Run-ы шли с собственными HOME
и `CLAUDE_CONFIG_DIR` во временной папке `claude plugin eval`. Транскрипты и результаты в репозиторий не кладутся
(`harness/evals/results/` в `.gitignore`).
