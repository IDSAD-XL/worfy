# 120 — Разбить harness-scripts-1: критический путь прогона test-ов

Type: task
Status: done 2026-11-16T07:25Z
PR: #1901
Blocked by: none
Source: владелец 2026-11-16, «да на тикеты»: вывод исследования `docs/research/2026-11-16-fake-timers.md` (раздел 2,
«Критический путь», и раздел 5) — самый крупный выигрыш по времени не в timer-ах, а в планировании shell test-ов
Harness-а.

Кто: агент.

## Что происходит

- Shell test-ы Harness-а (`harness/bin/tests/*.test.sh`, 49 файлов, и `harness/hooks/tests/*.test.sh`, 18 файлов, на
  `ea21c0bbb`) идут в `pnpm test` через четыре test-файла-обёртки `test/contract/harness-scripts-1…4.test.ts`. Каждая
  зовёт `harnessScripts(n)` (`test/harness-scripts-suite.ts`), один case на `.test.sh`.
- Замер исследования (Mac владельца, `164474a3f`, полный run с JSON reporter-ом, wall 405 s): обёртки дали 586 / 219 /
  201 / 184 s суммарного времени test-ов — 1188 s из 3268 s. `harness-scripts-1` стартует на 107-й секунде и идёт
  299 s, до конца run-а: это критический путь. Без четырёх обёрток тот же набор идёт 179 s wall.
- Как shell test-ы делятся между обёртками (`test/harness-shell-tests.ts`):
  - **Локальный run и gate** (без `HARNESS_SCRIPTS_PART`): `inFile` раздаёт shell test-ы по измеренным секундам
    `MEASURED_SECONDS.other`, обёртки делят пять одновременных слотов как 2, 1, 1, 1 (`atOnce`,
    `SHELL_TESTS_AT_ONCE = 5`). Снимок `other` снят 2026-10-29 и устарел: 11 из 67 shell test-ов в нём нет (они
    считаются по `UNMEASURED_SECONDS = 20`), остальные с тех пор выросли. По снимку все четыре обёртки кончаются на
    ~215 s; на деле `harness-scripts-1` — 586 s на двух слотах (~293 s), остальные — 184–219 s на одном.
  - Комментарий над `MEASURED_SECONDS` сам называет условие обновления: «redo it when the harness-scripts files of a
    full run end further apart than the longest shell test takes». Оно выполнено.
  - Почему `harness-scripts-1` стартует только на 107-й секунде, исследование не выяснило: порядок файлов задаёт
    vitest (проекты `node`, `contract`, `jsdom` в `vitest.config.ts`, его sequencer и кэш длительностей).
- **CI делит иначе** — по частям `HARNESS_SCRIPTS_PART`, и тогда `harness-scripts-1` один гонит всю часть по пять
  одновременно, остальные три обёртки — ничего (`shareOf`):
  - `linux-tests` (`.github/workflows/ci.yml`): 4 shard-а; после своего shard-а каждый отдельным шагом гонит часть
    `<shard>` из 4 (шаг «Run the Harness shell tests, one part»);
  - `macos-tests`: `HARNESS_SCRIPTS_PART: 1/1` — все 67 в одном файле;
  - Windows (`.github/workflows/windows-tests.yml`): два job-а `harness-scripts 1/2` и `2/2`; запуск вручную без
    shard-а — `1/1`.
  - Части режет `inPart` — по отсортированному имени, каждое k-е имя в часть k mod count + 1, не по секундам.
- Что каждый shell test идёт ровно в одной обёртке и ровно в одном Windows job-е, уже проверяют
  `test/contract/ci-workflow.test.ts:732` (настоящий список на `:745`, для обоих снимков и 1, 2, 4, 5 файлов) и
  `test/contract/ci-workflow.test.ts:552`.

## Что делаем

1. **Замер до.** Полный локальный run с JSON reporter-ом на одной машине
   (`node scripts/vitest-electron.mjs --reporter=json --outputFile.json=<файл>`), два раза: wall time, время каждой
   обёртки, её старт и конец (из `startTime` и `duration` report-а), время каждого `.test.sh`. Время job-ов CI до —
   `gh run view <id> --json jobs` двух push run-ов на main: `linux-tests (1/4)…(4/4)` с длительностью шага shell
   test-ов, `macos-tests`, `windows (harness-scripts 1/2)`, `(2/2)`.
2. **Обновить `MEASURED_SECONDS.other`** из этого report-а: все 67 shell test-ов, без пропусков. Обновить комментарий
   над снимком (дата, машина, как снят). Если `windows` тоже заметно устарел и есть Windows run с временами по
   `.test.sh`, обновить и его; иначе — оставить и сказать об этом в PR.
3. **Найти, почему `harness-scripts-1` стартует поздно**, и сделать так, чтобы четыре обёртки стартовали среди первых
   файлов run-а (например, порядок sequencer-а vitest или настройка проекта `contract`). Если причина вне контроля
   конфигурации — записать её в PR и учесть в разбиении (п. 4).
4. **Перебалансировать по замеру.** Цель: ни одна обёртка не идёт дольше следующей по длительности более чем на
   длительность самого долгого shell test-а, и конец `harness-scripts-1` больше не задаёт конец run-а. Средства — в
   рамках существующей схемы: новый снимок, слоты `atOnce`, при необходимости пятая обёртка
   (`HARNESS_SCRIPTS_FILES`), если замер показывает, что четырёх мало. Общее число одновременных shell test-ов
   (`SHELL_TESTS_AT_ONCE = 5`) не растёт: двадцать сразу уже давали 900 s пределы на Windows PC владельца.
5. **Части CI.** Если по замеру п. 1 шаги shell test-ов четырёх Linux shard-ов или два Windows job-а
   `harness-scripts` расходятся больше, чем на самый долгий shell test, — резать части по секундам тем же способом,
   что `inFile` (снимок `windows` для Windows, `other` для Linux), вместо `inPart` по имени. Иначе части не трогать и
   записать числа в PR.
6. **Каждый shell test — ровно один раз в каждом job-е, где он идёт сейчас.** Linux: в одной из четырёх частей;
   macOS: в части `1/1`; Windows: в одном из двух job-ов `harness-scripts`, и в запуске вручную `1/1`. Ни один
   shell test не выпадает и не идёт дважды.

## Готово, когда

- [ ] Test: каждый `harness/bin/tests/*.test.sh` и `harness/hooks/tests/*.test.sh` — ровно в одной обёртке
      локального run-а (на настоящем списке `shellTests`, для нового снимка). Проверка `ci-workflow.test.ts:732`
      остаётся и покрывает новое разбиение; если меняется число обёрток или способ резать части (п. 4–5) — та же
      проверка «ровно один раз» для частей `1/4…4/4`, `1/2…2/2` и `1/1`.
  - evidence: test-run pass · `HOME=$(mktemp -d) node scripts/vitest-electron.mjs test/contract/ci-workflow.test.ts test/contract/harness-scripts-1.test.ts` exit 0 (runs every real shell test exactly once: files of a local run, parts 1/4…4/4, 1/2…2/2, 1/1) · mac - · 413c30be7
- [ ] Test (`ci-workflow.test.ts:552`): каждый shell test идёт ровно в одном Windows job-е — зелёный.
  - evidence: test-run pass · `HOME=$(mktemp -d) node scripts/vitest-electron.mjs test/contract/ci-workflow.test.ts` exit 0 (runs each test file in exactly one Windows job, and each Harness shell test in exactly one) · mac - · 413c30be7
- [ ] В описании PR: wall time локального полного run-а до и после, время, старт и конец каждой обёртки из JSON
      report-а vitest до и после, одна машина, по два run-а.
  - evidence: test-run pass · PR #1901 body, section Local: wall time 321/316 s before, 227/246 s after, start and end of each wrapper from the vitest JSON report, one machine (3 runs before, 2 after) · mac - · 703a0a1f1
- [ ] В описании PR: время job-ов CI до и после из `gh run view` двух push run-ов на main до и двух после
      (`linux-tests` 1–4 и их шаг shell test-ов, `macos-tests`, `windows (harness-scripts 1/2)`, `(2/2)`).
  - evidence: ci-check pass · before (PR #1901 body, main runs 43782353370, 43781183312): macos-tests 1426/1757 s, windows harness-scripts 1/2 job 320/436 s, 2/2 433/418 s; after (main push runs 43800282492, 43805109006): macos-tests 1714/1565 s, windows harness-scripts 1/2 369/459 s, 2/2 343/350 s, linux-tests shell step 46-115 s: no CI gain, the gain is local · ci ci · 4ceee03a9
- [ ] После: обёртки локального run-а расходятся по концу не больше, чем на самый долгий shell test; или PR называет
      причину, почему это недостижимо, с числами.
  - evidence: test-run pass · `HOME=$(mktemp -d) node scripts/vitest-electron.mjs --reporter=json` exit 0 twice: harness-scripts files end at 207/210/216/226 s and 223/228/233/245 s, spread 19 and 22 s, longest shell test 97 s · mac - · 413c30be7
- [ ] Все unit- и contract-test-ы модуля зелёные: `test/contract/ci-workflow.test.ts`,
      `test/contract/windows-tests-workflow.test.ts`, `test/contract/harness-scripts-1…4.test.ts` (и новая обёртка,
      если есть), `test/unit/affected-tests.test.ts`, `test/contract/first-run-checks.test.ts`,
      `test/unit/first-run-windows.test.ts`, `test/unit/getting-started-progress.test.ts`.
  - evidence: test-run pass · `HOME=$(mktemp -d) node scripts/vitest-electron.mjs <the 10 files of the item> test/unit/dev-bundle-config.test.ts` exit 0 (11 files, 663 passed) · mac - · 413c30be7
  - evidence: gate pass · `gate fast` exit 0 · mac - · 413c30be7
- [ ] Новая обёртка, если появилась, учтена везде, где перечислены четыре: `ci.yml`, `windows-tests.yml`,
      `scripts/windows-test-list.mjs`, `scripts/windows-verdict-scope.mjs`, `scripts/affected-tests.table.json`,
      `vitest.config.ts`, `test/global-setup-git-bash.ts`, `test/e2e/first-run.spec.ts`,
      `test/e2e/first-run-sandbox.ts`, `test/acceptance/e3.spec.ts`.
  - evidence: commit pass · no new wrapper: the four harness-scripts wrappers stay, so no list changes (PR #1901 diff) · - - · 703a0a1f1
- [ ] CI зелёный на всех ОС, Windows job-ы `harness-scripts` включительно.
  - evidence: ci-check pass · PR #1901 run 43793359420 `ci-ok` success: linux 1-4, windows 1-3, harness-scripts 1/2 and 2/2, macos-tests, macos-e2e, windows-e2e · ci ci · 703a0a1f1

## Где в коде

- `test/harness-shell-tests.ts` (`MEASURED_SECONDS`, `inFile`, `inPart`, `atOnce`, `shareOf`, `HARNESS_SCRIPTS_FILES`)
- `test/harness-scripts-suite.ts` (`harnessScripts`, `maxConcurrency` через `vi.setConfig`)
- `test/contract/harness-scripts-1.test.ts` … `harness-scripts-4.test.ts`
- `vitest.config.ts` (проекты, `maxConcurrency: 5` проекта `contract`, `WORFY_TEST_EXCLUDE`)
- `scripts/vitest-electron.mjs` (как запускается `pnpm test`)
- `.github/workflows/ci.yml` (`linux-tests`: шаг «Run the Harness shell tests, one part»; `macos-tests`:
  `HARNESS_SCRIPTS_PART: 1/1`; список Windows shard-ов)
- `.github/workflows/windows-tests.yml` (job-ы `harness-scripts <i>/<n>`)
- `scripts/windows-test-list.mjs`, `scripts/windows-verdict-scope.mjs`, `scripts/affected-tests.table.json`
- `test/contract/ci-workflow.test.ts` (`:552`, `:706`–`:785`), `test/contract/windows-tests-workflow.test.ts`
- `docs/research/2026-11-16-fake-timers.md` (раздел 2, замер)
