# 13 — Eval-кейс `compaction-state`: probes о состоянии после compaction, с hook-ом и без

Type: task
Status: open
Blocked by: 10, 11, 12
Source: [spec.md](../spec.md), «Ticket-ы», 13; «Решения по реализации» → «Compaction», пункт «Eval (13)»; «Как это сделано
у конкурентов» (Factory Droids); «Готово, когда», пункт о compaction; «Решено без владельца», 1

Кто: агент.

Не платформенный Ticket (eval-кейс и запуск руками). Глубина ревью — `medium`.

**Цена.** Eval зовёт реальную модель. Сначала `scripts/eval-harness.mjs --dry-run`, затем запуск с `--max-cost-usd`;
цена каждого запуска — в «Итог».

## Что происходит

- Что агент помнит после compaction, сейчас не меряется. Hook Ticket-а 11 и инструкции Ticket-а 10 нужно сравнить с
  тем, что было без них.
- Factory меряет summary probes — контрольными вопросами; хуже всего у всех держится список затронутых файлов.
- По решению без владельца 1 половина compaction этого Epic-а считается сделанной, когда этот eval записал числа.

## Что делаем

1. Кейс `harness/evals/compaction-state`: длинная Session по сценарию, `/compact`, затем probes — цель, Ticket, пункты
   «Готово, когда», затронутые файлы, решения, следующий шаг.
2. Два прогона: без hook-а и инструкций, с ними.
3. Запуск руками, вне CI: `scripts/eval-harness.mjs --dry-run`, затем с `--max-cost-usd`.
4. Числа по каждому probe, модель и цена — в «Итог».

## Готово, когда

- [ ] Кейс `harness/evals/compaction-state` влит; в CI он не запускается.
- [ ] `--dry-run` прошёл, его вывод и оценка цены — в «Итог».
  - evidence: test-run pass · `node scripts/eval-harness.mjs --case compaction-state --dry-run` exit 0 · mac - · 4aef7eeef8da7f0a4ec606e1e69bc883d8de3d12
- [ ] «Итог» — числа по каждому probe без hook-а и с ним; с hook-ом probes о Ticket-е, пунктах «Готово, когда» и
      следующем шаге отвечены лучше, или «Итог» называет, почему нет.
  - evidence: test-run pass · node scripts/eval-harness.mjs --case compaction-state --max-cost-usd 3: with hook exit 0 (casesPassed 1 of 1, overallScore 0.96, 1.46 USD); HARNESS_DIR=baseline copy exit 1 (casesPassed 0 of 1, overallScore 0.41, 1.42 USD); sonnet-5, judge haiku-4-5 · mac - · c8f04f95bf91f90cee365e1f041a051424e940c5
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `harness/evals/compaction-state/` (новый)

Только читать: `scripts/eval-harness.mjs`, другие кейсы `harness/evals/`.

## Вне скоупа

- Изменения hook-а и правил по итогам eval-а — новый Ticket, если числа плохие.

## Итог

Кейс сделан 2026-11-18, ветка `worfy-continuity/13`. Платный прогон — за Orchestrator-ом; его числа — ниже, в разделе
«Числа прогона».

### Как устроен кейс

- **Session по сценарию** — `harness/evals/compaction-state/history.jsonl`: транскрипт Claude Code (30 записей), который
  `claude plugin eval` продолжает через `context.history_file` (`--resume <файл>`). Его пишет
  `node harness/evals/compaction-state/history.mjs > history.jsonl`. Сценарий: implementer Ticket-а demo/01 (функция
  `double`, точка входа `src/index.mjs`, поле `exports`) прочитал brief, Ticket, `docs/conventions.md` и чужие Ticket-ы,
  взял Ticket, получил красный и зелёный test, получил поправку Orchestrator-а (NaN и Infinity — числа; `src/sum.mjs` не
  трогать, его проверку — в `out_of_scope`), закоммитил `double` и остановился на красном `node --test`: `exports`
  указывает на `./src/index.js`. Около 6 тыс. токенов разговора, вместе с system prompt и правилами — 32,5 тыс.
  (`pre_tokens` границы compaction).
- **Fixture** — `scaffold.sh`: та же картина на диске. Папка run-а — linked worktree на ветке `demo/01` (Ticket взят и
  `double` закоммичен; `src/index.mjs`, `test/index.test.mjs` и `package.json` не закоммичены), main checkout проекта
  demo — в `.demo/` внутри неё: сценарий пишет только в текущую папку и `$HOME`. Так hook `after-compact.mjs` видит
  implementer-а и отдаёт файл Ticket-а и `git status --short`.
- **Compaction** — auto, до первого ответа: окно 100000 токенов и порог 5 % (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`,
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, как в spike-е 01). Эти переменные кейс задать не может: `claude plugin eval`
  разрешает в `env` кейса только `EVAL_*` («execution.env key … is not allowed — only EVAL_* keys»). Их ставит
  `scripts/eval-harness.mjs` только в вызове этого кейса (раунд 2, ниже); без них compaction нет, и grader `compacted`
  с весом 3 валит кейс.
- **Probes** — шесть вопросов в `PROBES.md` (из `probes.md` кейса): цель, Ticket, пункты «Готово, когда» с состоянием,
  затронутые файлы, решения, следующий шаг. Prompt только называет файл, поэтому модель, которая пишет summary, вопросов
  не видит (в запросе на summary нет ни prompt-а, ни `PROBES.md` — проверено на stub-е, ниже). Ответ — по памяти: из
  инструментов оставлен один `Read`. Каждый probe — свой grader `llm` (судья — haiku, три голоса), отсюда число на probe.
  Ещё три grader-а: `probes-read` (прочитан `PROBES.md`), `from-memory` (не открыт ни один файл работы), `compacted`.
- **Два варианта.** С hook-ом и инструкциями — `harness/` как есть. Без них — копия, которую делает
  `node harness/evals/compaction-state/baseline.mjs` во временной папке: в `hooks.json` нет `PreCompact` и `SessionStart`
  с matcher-ом `compact`, в `common.md` нет пункта «After a compaction…». Прогон — через существующий `HARNESS_DIR`:
  `HARNESS_DIR="$(node harness/evals/compaction-state/baseline.mjs)" pnpm eval:harness -- --case compaction-state`.
- **Вне CI:** `pnpm eval:harness` не запускает ни CI, ни gate; `test/contract/harness-evals.test.ts` бесплатно проверяет
  только, что кейс полон и fixture строится. `harness/evals/lib/coverage.json` связывает кейс с `hooks/rules/compaction.md`,
  `hooks/rules/common.md`, `hooks/hooks.json` и `hooks/inject-rules.mjs`; `--changed` такой правки кейс не запускает,
  а печатает строку, как его запустить (тег `alone`, раунд 2).

### Отступления от Ticket-а

- **Auto-compaction, а не `/compact`.** У кейса `claude plugin eval` один prompt за run. Если этот prompt — `/compact`,
  то после compaction вопросов задать уже нельзя. Spike 01 показал, что manual и auto отличаются только `trigger` и
  текстом `/compact`: `PreCompact` и `SessionStart` с `source: compact` срабатывают одинаково.
- **Файлы вне «Где в коде»** (согласованы с Orchestrator-ом): `harness/evals/lib/coverage.json` (запись кейса;
  `compaction.md` и `common.md` убраны из `uncovered`), `test/contract/harness-evals-shared.ts` (кейс в `CASES`),
  `test/contract/harness-evals.test.ts` (двадцать три кейса; папку состояния Harness оба test-а fixture-а берут через
  `git rev-parse --git-common-dir`, как `hooks/eval-env.cjs`), `docs/features/skills-agents-and-hooks.md` (кейс и его
  переменные). В раунде 2, по брифу Orchestrator-а: `scripts/eval-harness.mjs` (тег `alone`),
  `test/contract/harness-evals-run.test.ts` и `test/fixtures/eval-stub/claude.cjs` (test-ы тега `alone`; stub пишет обе
  переменные каждого вызова), `docs/features/harness.md`.

### Раунд 2: ревью PR #1996

- **Grader `compacted` — вес 3.** С весом 1 из 9 run без compaction набирал 8 / 9 = 0,89 и проходил порог 0,8. Чтобы
  один провал `compacted` валил run, нужен вес w с 8 / (8 + w) < 0,8, то есть больше 2. Взят 3: без compaction run
  набирает не больше 8 / 11 = 0,73. Вес 8 из примера брифа тоже годится, но с ним кейс прошёл бы и с тремя
  проваленными probes в run-е (13 / 16 = 0,81); с весом 3 — с двумя (9 / 11 = 0,82), как с весом 1 — с одним.
- **Тег `alone`.** Кейс теперь с тегом `alone`, а не `main`. `scripts/eval-harness.mjs` запускает его только по точному
  `--case compaction-state`, отдельным вызовом с `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` и
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5`. Общий запуск, glob в `--case` и `--changed` его пропускают со строкой
  «compaction-state is skipped: … run it with pnpm eval:harness -- --case compaction-state». Из окружения остальных
  вызовов обе переменные убраны, даже если их задал shell. Выбран пропуск, а не переменные в общем вызове: `--case` у
  `claude plugin eval` — один glob, и вынуть один кейс из вызова тега `main` нельзя.
- **Grader-ы probe-\*.** В каждый добавлено «Judge only the section under this heading; what the other sections say
  or admit does not matter», в `probe-files` — «src/sum.mjs named as unchanged is not a failure». Числа ниже, в
  «Числа прогона», получены с grader-ами первого раунда; повторный платный прогон — за Orchestrator-ом.
- **Документы:** обе переменные и команда запуска с `baseline.mjs` — в `docs/features/skills-agents-and-hooks.md` и
  `docs/features/harness.md`. Перевод в `docs/features/ru/` — Ticket 14.

### Проверка без затрат: stub вместо API

`claude plugin eval` и `scripts/eval-harness.mjs` прогнаны против местного stub-а Messages API (`ANTHROPIC_BASE_URL` на
127.0.0.1, ключ-заглушка, временные `HOME` и `CLAUDE_CONFIG_DIR`): ни одного платного вызова. Что увидели запросы к
stub-у:

| | с hook-ом | без hook-а (`baseline.mjs`) |
|---|---|---|
| compaction | `auto`, 32579 → 9666 токенов | `auto`, 32505 → 9194 токенов |
| `compaction.md` в запросе на summary | да | нет |
| контекст `after-compact.mjs` после compaction | да | нет |
| пункт «After a compaction» в правилах | да | нет |
| вопросы `PROBES.md` в запросе на summary | нет | нет |

Stub нашёл две ошибки, которые сорвали бы платный прогон: `env` в `prompt.md` (только `EVAL_*`) и `git init` копией
git без шаблонов (нет `.git/info/`, `scaffold.sh` теперь создаёт её сам). Ответы stub-а — заглушки, поэтому оценки этих
прогонов ничего не значат.

### `--dry-run` и цена

```
$ node scripts/eval-harness.mjs --case compaction-state --dry-run
eval:harness: no main case selected, the main call is skipped
eval:harness: no gui case selected, the gui call is skipped
eval:harness: budget 30 USD (BUDGET_USD)
eval:harness: dry run, nothing is started: claude (<repo>/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.322/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude) is not called; <plugin-copy> stands for the temporary copy of <repo>/harness
eval:harness: alone-compaction-state — CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5 claude plugin eval <plugin-copy> --scaffold --trust-plugin --ablation none --threshold 0.8 --no-publish --model claude-sonnet-5 --judge-model claude-haiku-4-5 --max-cost-usd 30 --output-dir <repo>/harness/evals/results/<time>-alone-compaction-state --tag alone --case compaction-state --allow-tools Bash Write Edit
EXIT=0
```

С `HARNESS_DIR=<копия baseline.mjs>` и `--max-cost-usd 3` — та же строка с бюджетом 3 USD и папкой результатов в копии,
exit 0.

`--dry-run` цены не считает; оценка — по токенам запросов к stub-у и ценам Claude Code 2.1.322 (`claude-sonnet-5` —
2 / 10 USD за миллион входа / выхода, запись в cache 2,5–4; `claude-haiku-4-5` — 1 / 5). Один run — три вызова модели:
compaction (около 33 тыс. входа, 3–5 тыс. выхода, ≈ 0,18 USD), чтение `PROBES.md` (около 10 тыс. входа, ≈ 0,04 USD),
ответ (около 11 тыс. входа, 1,5–3 тыс. выхода, ≈ 0,05 USD); судья — 18 вызовов haiku (≈ 0,06 USD). Итого ≈ 0,3 USD
за run, ≈ 1 USD за вариант (3 run-а), ≈ 2 USD за оба варианта; предел каждого запуска — 3 USD.

### Числа прогона

Платный прогон сделал Orchestrator 2026-11-18: Claude Code 2.1.322, модель агента `claude-sonnet-5`, судья
`claude-haiku-4-5` (три голоса на llm-grader), три run-а на вариант, предел 3 USD на вызов. Окружение shell-а —
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5`; без hook-а — `HARNESS_DIR=<копия из
baseline.mjs>`. Источник чисел — `aggregate-result.json` каждого варианта; результаты в репозиторий не входят.

| Grader | С hook-ом | Без hook-а |
|---|---|---|
| probe-goal (цель) | 3/3 | 0/3 |
| probe-ticket (Ticket: Epic, номер, файл, ветка) | 3/3 | 0/3 |
| probe-done-items (пункты «Готово, когда») | 3/3 | 0/3 |
| probe-files (тронутые файлы) | 2/3 | 0/3 |
| probe-decisions (решения) | 3/3 | 2/3 |
| probe-next-step (следующий шаг) | 3/3 | 1/3 |
| compacted (compaction была) | 3/3 | 3/3 |
| probes-read (`PROBES.md` прочитан) | 3/3 | 3/3 |
| from-memory (других файлов не открывал) | 3/3 | 2/3 |
| Оценка run-ов | 1,00 / 1,00 / 0,89 | 0,56 / 0,44 / 0,22 |
| overallScore | 0,96 | 0,41 |
| casesPassed | 1 из 1 | 0 из 1 |
| Цена варианта | 1,46 USD | 1,42 USD |

Цена run-а агента: с hook-ом 0,57 / 0,48 / 0,41 USD, без hook-а 0,47 / 0,43 / 0,52 USD; судья — около 0,02 USD на
run. Оба варианта — 2,88 USD, оценка `--dry-run` (≈ 1 USD на вариант) занижена примерно в полтора раза.

Вывод по пункту 3: критерий выполнен. С hook-ом probe о Ticket-е — 3/3 против 0/3, о пунктах «Готово, когда» — 3/3
против 0/3, о следующем шаге — 3/3 против 1/3. Без hook-а модель не знает формулировок пунктов «Готово, когда»: run 1
прямо пишет, что точного текста не помнит, и называет пункты, которых в Ticket-е нет. Run 3 без hook-а не ответил на
вопросы, а открыл файлы и спросил, что делать; это и есть единственный провал from-memory.

Оговорка о судье. Run-ы 1 и 2 без hook-а называют Epic `demo`, Ticket 01, файл `.scratch/demo/issues/01-alpha.md` и
ветку `demo/01`, как и run-ы с hook-ом, а probe-ticket у них провален тремя голосами из трёх. Критерий
`graders/probe-ticket.md` требует только Ticket, путь файла и ветку. Судья отдаёт голоса без причины, поэтому
причина провала неизвестна. Разницу 3/3 против 0/3 по probe-ticket поэтому нельзя считать доказанной. Вывод по
пункту 3 держится и без неё: остаются пункты «Готово, когда» (3/3 против 0/3) и следующий шаг (3/3 против 1/3).
Run 3 без hook-а принял `PROBES.md` и summary compaction за prompt injection и на вопросы не ответил.
