# 49 — `harness-scripts.test.ts` отдельным job-ом Windows: shard 3/3 перестаёт быть самым долгим

Type: task
Status: claimed 2026-10-29T03:28Z
Branch: worfy-throughput/49
Blocked by: 35
Source: разбор моста 2026-10-29 после #942 (Ticket 47): shard 3/3 Windows шёл 825 s в run-е 40805903962, хотя #942
срезал ожидания в двух его shell test-ах.

## Что происходит

Job `windows / full-suite` (`.github/workflows/windows-tests.yml`) идёт в 3 shard-ах через `pnpm test --shard=<i>/3`.
Это встроенное разбиение vitest — по hash пути файла, не по времени. В shard 3/3 всегда попадает
`test/contract/harness-scripts.test.ts`: он запускает 49–52 shell test-а Harness через Git Bash, по 5 сразу
(`maxConcurrency: 5`, `vitest.config.ts:76`), и в каждом run-е — самый долгий файл: 354 s в быстром run-е
(40788089367), 552–617 s в медленных (40804392460, 40805903962). Рядом с ним в том же shard-е идут ещё два тяжёлых
файла: `harness-evals-outcome` (128–208 s) и `projects-connect` (58–91 s).

С 2026-10-28 у shard-а 3/3 две скорости — 436–528 s и 704–825 s, при том же списке файлов; в медленном run-е каждый
файл идёт в 1,3–2 раза дольше (вероятно, более медленный runner: однопроцессная проверка lockfile перед test-ами —
4,6–5,5 s против 6,3–9,6 s). Shard 3/3 нагружен сильнее других: три worker-а vitest и пять Git Bash сразу на runner-е
с 4 CPU, поэтому медленный runner бьёт по нему больше всего. Shard-ы 1/3 и 2/3 — 216–605 s.

Это самый долгий job у PR без macOS-job-ов (после #927 — PR только с unit-test-ами или Harness).

## Что делаем

1. **Отдельный job** для `test/contract/harness-scripts.test.ts` в `windows-tests.yml`: ещё одна запись matrix (или
   отдельный job) запускает только этот файл; shard-ы `full-suite` его исключают (`--exclude` vitest или список
   файлов). Имя job-а — по образцу существующих, `ci-ok` учитывает его так же, как три shard-а (`needs.windows.result`).
2. **Проверка, что файл не потерян:** contract test (`test/contract/ci-workflow.test.ts`) — каждый файл
   `test/unit` и `test/contract` идёт ровно в одном Windows job-е: в одном из shard-ов или в отдельном.
3. **Замер** в CI run-е PR-а: время каждого Windows job-а; ожидаемо shard 3/3 — около 300 s без этого файла, отдельный
   job — около времени самого файла.

## Готово, когда

- [ ] `harness-scripts.test.ts` идёт в своём Windows job-е, в shard-ах `full-suite` его нет.
- [ ] Contract test ловит файл, который не попал ни в один Windows job, и файл, который попал в два.
- [ ] `pull_request_target` нет, secrets нет, `persist-credentials: false`, сторонние action-ы по sha.
- [ ] Время Windows job-ов CI run-а PR-а — в «Итог», вместе со скоростью runner-а (быстрый или медленный run).

## Где в коде

- `.github/workflows/windows-tests.yml` — job `full-suite`, matrix shard-ов.
- `.github/workflows/ci.yml` — job `windows`, `ci-ok`.
- `test/contract/ci-workflow.test.ts`.
- `vitest.config.ts` — `maxConcurrency` не трогаем.

## Вне скоупа

- Разбиение Windows shard-ов по измеренному времени, как Ticket 48 для macOS e2e: отдельный Ticket, если после этого
  shard-ы разойдутся.
- `harness/bin/tests/land.test.sh` (230–317 s, 26 `sleep`): сократить его ожидания, как #942 для guard-silent —
  следующий шаг после замера этого Ticket-а.
- Linux и macOS: не трогаем.

## Итог

PR #948, head `76b637e1`, CI run 40811277830: `ci-ok` — success.

### Что изменилось

- Job `windows` в `ci.yml` — пять записей matrix вместо трёх: `1/3`, `2/3`, `3/3` (shard-ы vitest всех файлов, кроме
  `harness-scripts.test.ts`) и `harness-scripts 1/2`, `harness-scripts 2/2` (только этот файл, по половине shell
  test-ов Harness в каждом). Имена job-ов: `windows (1/3) / full-suite` … `windows (harness-scripts 2/2) / full-suite`.
  `ci-ok` не менялся: `needs.windows.result` — результат всех пяти, упавший или отменённый job краснит его.
- `windows-tests.yml`, шаг «Run the unit and contract suite, or a part of it» (PowerShell, как был): shard `<i>/<n>`
  ставит `WORFY_TEST_EXCLUDE` = путь файла; shard `harness-scripts <i>/<n>` ставит `HARNESS_SCRIPTS_PART=<i>/<n>` и
  запускает `pnpm test test/contract/harness-scripts.test.ts`. Dispatch без shard-а, как и раньше, гоняет весь набор.
- `vitest.config.ts`: `WORFY_TEST_EXCLUDE` (пути через пробел) добавляется к `exclude`. `--exclude` vitest 5.0.3 до
  project-ов с `extends: true` не доходит: `vitest run --exclude test/contract/harness-scripts.test.ts harness-scripts.test`
  всё равно запустил файл (exit 0, 69 test-ов, 117 s). С переменной `vitest list --filesOnly` — 466 файлов вместо 467.
  `maxConcurrency` не тронут.
- `test/harness-shell-tests.ts` (новый): список shell test-ов и правило разбиения — имена по порядку, k-е имя (с 0) в
  часть `k mod n + 1`. `harness-scripts.test.ts` берёт оттуда список и гоняет только случаи своей части; неверная часть
  (`3/2`) роняет файл: «HARNESS_SCRIPTS_PART must be <index>/<count>…», exit 1. Файл добавлен в
  `tsconfig.test.node.json`.
- `bin/tests/land.test.sh` — первым в `RUN_FIRST`: на Windows это самый долгий shell test (306 s в run-е 40805903962).
  По временам того run-а, по пять сразу: части 340 и 347 s; без переноса land — 340 и 447 s.

N = 2 сразу, а не один job: по тем же временам один job с файлом занял бы 610 s в медленном run-е — столько же, сколько
нынешний самый долгий shard.

### Проверка: красный → зелёный

Новый contract test в `test/contract/ci-workflow.test.ts` («Windows CI: every unit and contract test file, and every
Harness shell test, runs in exactly one job»). Какие файлы попадают в shard, отвечает сам vitest (`BaseSequencer.shard`
из `vitest/node`), не копия его правила. Отдельно проверено, что test ловит файл ни в одном job-е (нет shard-а `2/3`;
нет job-ов `harness-scripts`; нет части `1/2`) и файл в двух (shard `1/3` дважды; shard-ы не исключают файл; часть
`1/2` дважды).

- На workflow-ах `main` (`b52c7493`), с новым test-ом: exit 1, `4 failed | 140 passed`; среди красных —
  `expected [ '3/3' ] to deeply equal [ 'harness-scripts 1/2', 'harness-scripts 2/2' ]`: файл шёл в shard-е 3/3.
- Mutant: из matrix `ci.yml` убрана строка `harness-scripts 2/2` — exit 1, `4 failed`, среди них «in no Windows job:
  expected [ …(26) ] to deeply equal []». Файл восстановлен из копии.
- После правки: `ci-workflow.test.ts`, `windows-tests-workflow.test.ts`, `windows-verdict-scope.test.ts` под временным
  HOME — exit 0, 301 passed; `harness-scripts.test.ts` целиком — exit 0 (69 passed, 1 skipped), с
  `HARNESS_SCRIPTS_PART=1/2` — exit 0 (43 passed), с `2/2` — exit 0 (42 passed); `pnpm lint`, `pnpm typecheck` —
  exit 0; gate fast — exit 0, «[gate] green (fast)».
- Модель test-а совпала с CI: число файлов в shard-ах по `BaseSequencer` — 156/155/155, в run-е PR-а «Test Files» —
  156, 155 (1 skipped) и 155 (3 skipped).

### Время Windows job-ов в CI run-е PR-а

| Job | Job целиком, s | vitest Duration, s | Проверка lockfile, s | Самый долгий файл |
| --- | --- | --- | --- | --- |
| `windows (1/3) / full-suite` | 402 | 334 | 6,2 | `harness-evals` 261 s |
| `windows (2/3) / full-suite` | 315 | 244 | 7,7 | — |
| `windows (3/3) / full-suite` | 336 | 271 | 6,2 | `harness-evals-outcome` 165 s |
| `windows (harness-scripts 1/2) / full-suite` | 356 | 294 | 6,6 | `wave-gate.test.sh` 151 s |
| `windows (harness-scripts 2/2) / full-suite` | 239 | 188 | 5,5 | `land.test.sh` 178 s |

Скорость runner-а по проверке lockfile: четыре job-а из пяти — 6,2–7,7 s, это граница или медленный диапазон
(быстрый 4,6–5,5 s, медленный 6,3–9,6 s); один job — 5,5 s, быстрый. Run смешанный, ни чисто быстрый, ни чисто
медленный; времена shell test-ов ближе к быстрому run-у (land 178 s против 306 s в медленном 40805903962).

Самый долгий Windows job теперь — shard 1/3, 402 s; до этого shard 3/3 — 436–528 s в быстрых run-ах и 704–825 s в
медленных. Shard 3/3 без файла — 336 s (ожидали около 300 s). Части `harness-scripts` разошлись: 294 и 188 s по vitest.
Правило по имени не знает времени, а land.test.sh шёл в части 2 почти весь её срок. Один run — не замер: эффект и
скорость считать по нескольким push-run-ам `main` после merge.
