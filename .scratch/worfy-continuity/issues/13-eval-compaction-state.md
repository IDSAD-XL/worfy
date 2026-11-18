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
  разрешает в `env` кейса только `EVAL_*` («execution.env key … is not allowed — only EVAL_* keys»). Их ставит shell,
  который запускает `pnpm eval:harness`; без них compaction нет, и это ловит grader `compacted`.
- **Probes** — шесть вопросов в `PROBES.md` (из `probes.md` кейса): цель, Ticket, пункты «Готово, когда» с состоянием,
  затронутые файлы, решения, следующий шаг. Prompt только называет файл, поэтому модель, которая пишет summary, вопросов
  не видит (в запросе на summary нет ни prompt-а, ни `PROBES.md` — проверено на stub-е, ниже). Ответ — по памяти: из
  инструментов оставлен один `Read`. Каждый probe — свой grader `llm` (судья — haiku, три голоса), отсюда число на probe.
  Ещё три grader-а: `probes-read` (прочитан `PROBES.md`), `from-memory` (не открыт ни один файл работы), `compacted`.
- **Два варианта.** С hook-ом и инструкциями — `harness/` как есть. Без них — копия, которую делает
  `node harness/evals/compaction-state/baseline.mjs` во временной папке: в `hooks.json` нет `PreCompact` и `SessionStart`
  с matcher-ом `compact`, в `common.md` нет пункта «After a compaction…». Прогон — через существующий `HARNESS_DIR`.
  `scripts/eval-harness.mjs` не менялся.
- **Вне CI:** `pnpm eval:harness` не запускает ни CI, ни gate; `test/contract/harness-evals.test.ts` бесплатно проверяет
  только, что кейс полон и fixture строится. `harness/evals/lib/coverage.json` связывает кейс с `hooks/rules/compaction.md`
  и `hooks/rules/common.md`, так что платный `--changed` выберет его только при правке этих двух файлов.

### Отступления от Ticket-а

- **Auto-compaction, а не `/compact`.** У кейса `claude plugin eval` один prompt за run. Если этот prompt — `/compact`,
  то после compaction вопросов задать уже нельзя. Spike 01 показал, что manual и auto отличаются только `trigger` и
  текстом `/compact`: `PreCompact` и `SessionStart` с `source: compact` срабатывают одинаково.
- **Файлы вне «Где в коде»** (согласованы с Orchestrator-ом): `harness/evals/lib/coverage.json` (запись кейса;
  `compaction.md` и `common.md` убраны из `uncovered`), `test/contract/harness-evals-shared.ts` (кейс в `CASES`),
  `test/contract/harness-evals.test.ts` (двадцать три кейса; папку состояния Harness оба test-а fixture-а берут через
  `git rev-parse --git-common-dir`, как `hooks/eval-env.cjs`), `docs/features/skills-agents-and-hooks.md` (одна фраза о
  кейсе).

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
eval:harness: no gui case selected, the gui call is skipped
eval:harness: budget 30 USD (BUDGET_USD)
eval:harness: dry run, nothing is started: claude (<repo>/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.322/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude) is not called; <plugin-copy> stands for the temporary copy of <repo>/harness
eval:harness: main-compaction-state — claude plugin eval <plugin-copy> --scaffold --trust-plugin --ablation none --threshold 0.8 --no-publish --model claude-sonnet-5 --judge-model claude-haiku-4-5 --max-cost-usd 30 --output-dir <repo>/harness/evals/results/<time>-main-compaction-state --tag main --case compaction-state --allow-tools Bash Write Edit
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

Прогон Orchestrator-а — ниже.
