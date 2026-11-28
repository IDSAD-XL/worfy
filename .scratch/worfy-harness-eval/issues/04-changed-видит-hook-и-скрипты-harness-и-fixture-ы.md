# 04: `--changed` видит hook-скрипты, скрипты и библиотеки Harness и fixture-ы

Type: task
Status: claimed 2026-11-28T02:59Z
Branch: worfy-harness-eval/04
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/harness-evals-run.test.ts` exit 0 · mac - · f52661db91c7bb08347c914628587ea4314d0a97
- [ ] `--changed` выбирает по ним case-ы и запускает `compaction-state` отдельным вызовом, когда меняются его файлы.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/harness-evals-run.test.ts` exit 0 · mac - · f52661db91c7bb08347c914628587ea4314d0a97
- [ ] `pnpm eval:harness -- --changed origin/main --dry-run` в описании PR; PR называет Ticket 05 своим полным
      прогоном.
- [ ] `harness/README.md` описывает новый вид файлов карты.
  - evidence: commit pass · worfy-harness-eval/04: --changed sees hook scripts, Harness scripts and libraries, shared fixtures · - - · f52661db91c7bb08347c914628587ea4314d0a97
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Итог

Ветка `worfy-harness-eval/04`.

- Карта `harness/evals/lib/coverage.json` получила раздел `scripts`: файл, который исполняют case-ы, → список того, что
  ведёт к case-ам. В списке — имена case-ов, `"*"` (все case-ы) или пути карты: файл правил под case-ом или другая
  запись `scripts`. Библиотека называет скрипты, которые её загружают (`lib/evidence.cjs` → `bin/ticket`,
  `bin/evidence-check`, `bin/land`, `hooks/after-compact.mjs`). Скрипт называет case-ы, чьи skill-ы велят агенту его
  запускать, и скрипты, которые его вызывают. Hook, который идёт в каждой Session, называет case-ы, чья оцениваемая
  работа через него проходит: `hooks/guard.mjs` — восемь case-ов с commit-ами, переписыванием истории и фильтром вывода
  проверок, а не все 28. `hooks/eval-env.cjs` и `bin/profile` — `"*"`. Файлы без case-а (call log `hooks/calls.mjs`,
  qmd, `connect-project`, `gate.sh` для agent teams, `gh-token-env.mjs` при `github: null` демо-профиля и другие) стоят в
  `uncovered` с причиной.
- Общие fixture-ы карта не хранит: `fixtureUsers` находит их по строкам `scaffold.sh` (не комментариям), которые
  называют файл в другой папке `evals/`. Так нашёлся и третий общий fixture: `evals/pr-fix-checks/fixture/` берут
  `pr-fix-comments`, `pr-fix-conflicts` и `pr-fix-conflicts-silent`; раньше его правка выбирала только `pr-fix-checks`.
- `coverageProblems`: каждый файл `hooks/` (кроме двух файлов правил), `bin/` и `lib/` — в карте ровно один раз; повтор
  ключа ловится по тексту карты, потому что `JSON.parse` оставляет последний из двух равных ключей. Плюс проблемы: пустая
  запись, имя, которое не case и не путь карты, ссылка на файл из `uncovered`, папка `evals/`, которую не берёт ни один
  `scaffold.sh`.
- `--changed`, выбравший `compaction-state`, запускает его отдельным вызовом с двумя его переменными, как
  `--case compaction-state` (`scripts/eval-harness.mjs`).
- Сначала падающий test: новые test-ы в `test/contract/harness-evals-run.test.ts` до правки — 19 красных
  (`fixtureUsers is not a function`, нет раздела `scripts`, `compaction-state` пропускался). Прежний test ждал, что правка
  `harness/bin/profile` выбирает ноль case-ов, — это и было поведение до Ticket-а.
- Платный прогон не делался (решение владельца 2026-11-28): правка `coverage.json` выбирает все case-ы, это полный набор
  Ticket-а 05. `pnpm eval:harness -- --changed origin/main --dry-run` — exit 0, три вызова: `main`, `gui` и
  `alone-compaction-state`.
- Локально `pnpm lint` и `pnpm typecheck` — exit 0, `pnpm test` — exit 1: один test из 21802,
  `bin/tests/land.test.sh`, убит по пределу 360 s под нагрузкой машины (его файлы PR не меняет, test не
  перезапускался); проверка — `ci-ok` на head PR.
- Красный `linux-tests (1/4)` на первом head (`critic-verdict`, ENOENT в `cpSync` на `.git/demo-origin.git/objects`):
  гонка с отсоединённым `git maintenance run --auto`. Локальный push запускает `receive-pack` без `GIT_CONFIG_COUNT`
  (в `GIT_TRACE` видно `unset GIT_CONFIG_COUNT`), так что `maintenance.auto=false` из окружения fixture-а до него не
  доходит, и после push стартует `git maintenance run --auto --quiet --detach`. С `receive.autogc false` в config
  самого bare-репозитория этот процесс не стартует (проверено `GIT_TRACE` на игрушечном репозитории и на
  `demo-project.sh local-green`). Само падение воспроизвести не удалось. Исправление: `receive.autogc false` во всех
  трёх bare-репозиториях fixture-ов (`lib/demo-project.sh`, `implementer-story/scaffold.sh`,
  `pr-fix-checks/fixture/pr-fix.cjs`). `gc.auto` и `receive.autogc` в `GIT_CONFIG_COUNT` не добавлены: до
  `receive-pack` окружение не доходит, а commit и fetch уже закрыты `maintenance.auto=false`.
- Feature pages `docs/features/harness.md` и `docs/features/skills-agents-and-hooks.md`: `--changed` больше не
  пропускает `compaction-state`. В `harness/README.md`, кроме раздела карты, в «When to run the evals» добавлены
  `harness/hooks/`, `harness/bin/`, `harness/lib/`.
