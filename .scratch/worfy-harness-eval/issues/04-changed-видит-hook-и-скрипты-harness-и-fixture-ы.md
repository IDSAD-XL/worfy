# 04: `--changed` видит hook-скрипты, скрипты и библиотеки Harness и fixture-ы

Type: task
Status: open
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 04; «Решения владельца», «Что значит весь Harness» (`--changed` видит
hook-скрипты, скрипты и библиотеки Harness и общие fixture-ы); «Решения по реализации» («`--changed`»); «Решения по
test-ам» (test-ы карты покрытия); «Волны», Wave 1

Кто: агент. Глубина ревью — `medium`; reviewer в отдельной копии убирает по одной новую строку карты и смотрит, что
test краснеет.

## Что происходит

- `pnpm eval:harness -- --changed <base>` выбирает case-ы по карте `harness/evals/lib/coverage.json`
  (`scripts/eval-harness-coverage.mjs`, `casesFor` `:110`). Карта знает только файлы правил: всё под `skills/`,
  `agents/*.md`, `hooks/rules/*.md`, `hooks/hooks.json` и `hooks/inject-rules.mjs` (`ruleFiles` `:29`, `INJECTION`
  `:13`).
- Правка `harness/hooks/guard.mjs`, `stop.mjs`, `gate.mjs`, скрипта `harness/bin/*`, библиотеки `harness/lib/*.cjs` не
  выбирает ни одного case-а. Общие fixture-ы `harness/evals/human-review-setup-fixture/` и
  `harness/evals/pr-reply-fixture/` — папки без `prompt.md`, поэтому не case и тоже ничего не выбирают (`:123-124`).
- Case `compaction-state` с тегом `alone` `--changed` пропускает всегда и только печатает, как его запустить
  (`scripts/eval-harness.mjs:13-18`).

## Что строить

- Карта покрытия получает второй вид файлов — файлы, которые case-ы исполняют: hook-скрипты `harness/hooks/*.mjs`,
  скрипты `harness/bin/*`, библиотеки `harness/lib/*`, общие fixture-ы. Каждый такой файл ведёт к case-ам, которые его
  используют, или стоит в `uncovered` с причиной, как файлы правил сегодня.
- Общий fixture выбирает case-ы, которые его берут (по `scaffold.sh` case-а или по записи карты — выбирает Ticket).
- `compaction-state` запускается, когда меняются его файлы: `--changed` делает для него отдельный вызов с его
  переменными, как `--case compaction-state`.
- `coverageProblems` проверяет и новый вид: каждый hook-скрипт, скрипт и библиотека Harness — в карте ровно один раз.
- Платный прогон: правка `harness/evals/lib/coverage.json` по правилу `harness/README.md` («When to run the evals»,
  `:236-246`) выбирает все case-ы — это полный набор. Его делает точка отсчёта, Ticket 05 (Blocked by 04). PR этого
  Ticket-а идёт с `--changed origin/main --dry-run` в описании и называет 05.
- `harness/README.md`, раздел «Which cases check which rule file» (`:194-232`), описывает новый вид файлов.

## Где в коде

- `scripts/eval-harness-coverage.mjs` — `MAP` `:11`, `INJECTION` `:13`, `ruleFiles` `:29`, `coverageProblems` `:63`, `casesFor`
  `:110`
- `harness/evals/lib/coverage.json`
- `scripts/eval-harness.mjs:13-18` — тег `alone`; `:309-345` — `--changed` и вызов тега `alone`
- `harness/README.md:194-232`
- `test/contract/harness-evals-run.test.ts` — test-ы карты

## Test-ы

- Test-ы карты покрытия: правка `harness/hooks/guard.mjs`, `harness/bin/ticket`, `harness/lib/evidence.cjs`,
  `harness/evals/pr-reply-fixture/gh.mjs` выбирает свои case-ы; правка файла `compaction-state` даёт его отдельный
  вызов; файл без записи — проблема карты.
- Сначала падающий test: правка `harness/hooks/guard.mjs` сегодня выбирает ноль case-ов.
- Без моделей в CI; настоящий binary Codex не запускается.

## Готово, когда

- [ ] Карта покрытия знает hook-скрипты, скрипты и библиотеки Harness и общие fixture-ы; `coverageProblems` требует
      каждый из них ровно один раз.
- [ ] `--changed` выбирает по ним case-ы и запускает `compaction-state` отдельным вызовом, когда меняются его файлы.
- [ ] `pnpm eval:harness -- --changed origin/main --dry-run` в описании PR; PR называет Ticket 05 своим полным
      прогоном.
- [ ] `harness/README.md` описывает новый вид файлов карты.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
