# Code story — worfy-polish 168: macOS e2e в три части: часть идёт 35–37 минут при общем лимите 40

Kind: pr · Epic: worfy-polish · Ticket: 168 · PR: #2312 · Language: ru

## 1. Что было не так

Job `macos-e2e` гонял `pnpm test:e2e` в двух частях. На пяти последних зелёных run-ах с полным набором часть 1/2 шла
29–37 минут, часть 2/2 — 20–34 минуты, а общий лимит Playwright `globalTimeout` — 40 минут. На PR #2306 часть 1/2
упёрлась в лимит: 216 test-ов прошли, 56 не запустились (run 45928325369). Лимит поднимать нельзя (правило владельца).
Вторая причина перекоса: таблица `test/e2e/timings.json`, по которой `scripts/e2e-shard.mjs` делит spec-файлы, была
снята 2026-10-29 и знала 112 файлов из 177; остальные 65 считались по медиане, и сумма таблицы была 2430 s, а run-ы
шли около 3500 s.

- Требование: [Что происходит](../issues/168-macos-e2e-в-три-части.md#что-происходит)

## 2. Три части для полного run-а

Code: `scripts/ci-scope.mjs:218-222` · key lines: 222

```js
// Full runs: the shards of the e2e jobs on a push to main and on a pull request that runs every spec
// file. macos-e2e splits by measured time (scripts/e2e-shard.mjs), windows-e2e with Playwright's
// --shard. macos-e2e has 3: in 2, a shard took 35-37 min against the 40 min globalTimeout of
// playwright.config.ts and one ran into it (worfy-polish ticket 168); the limit stays.
export const E2E_SHARDS = { 'macos-e2e': 3, 'windows-e2e': 4 }
```

- Что делает: `ci-scope.mjs` пишет matrix job-а `macos-e2e` (output `macos-e2e-shards`) из этого числа: push в `main`
  и PR со всем набором получают `["1/3","2/3","3/3"]`. Для PR с частью spec-файлов прежняя функция `e2eShards`
  берёт меньше частей, пропорционально их времени, и не больше 3.
- Почему здесь: число частей задаёт только эта константа; `ci.yml` берёт matrix из output-а, а `e2e-shard.mjs`
  делит на столько частей, сколько ему передали в `<i>/<n>`. Ticket говорит «как сейчас решает `e2e-shard.mjs`»; по коду число частей задаёт `ci-scope.mjs`, а `e2e-shard.mjs` только делит файлы.
- Без него: часть 1/2 и дальше идёт до 37 минут при лимите 40 и время от времени упирается в него без упавшего test-а.
- Требование: [Что строить](../issues/168-macos-e2e-в-три-части.md#что-строить)
- Риски и пробелы test-ов: третий macOS runner на PR. Бесплатный план даёт 5 macOS job-ов разом; PR с приложением и
  macOS-путём теперь просит 4 (`macos-tests` и три части), с `macos-package` — 5, и два таких PR одновременно ждут
  очереди дольше, чем с двумя частями. `windows-e2e` не менялся: у него своё число (4). `ci-ok` ждёт job `macos-e2e`
  целиком (`needs: macos-e2e`), поэтому третью часть он видит без правки.

## 3. Таблица времени — по пяти зелёным run-ам 2026-11-27

Code: `test/e2e/timings.json:1-11` · key lines: 3, 4

```json
{
  "about": "Seconds per e2e spec file on the GitHub macOS runner: the median over the runs below of the sum of the durations of its tests, as the list reporter of pnpm test:e2e printed them (one worker, CI set). scripts/e2e-shard.mjs splits the macos-e2e shards by these numbers.",
  "measured": "2026-11-27",
  "runs": [
    45926431660,
    45928325369,
    45931370024,
    45931491002,
    45934380221
  ],
  "seconds": {
```

- Что делает: у каждого из 177 spec-файлов — медиана по пяти run-ам суммы длительностей его test-ов из строк list
  reporter-а в логах обеих частей (`gh run view --job <id> --log`). Способ тот же, что в поле `about`. Новая таблица
  делит полный набор на три части по 1132–1133 s test-ов.
- Почему здесь: Ticket просит обновить таблицу «при необходимости»; 65 файлов без записи и сумма на треть меньше
  настоящей — это и есть необходимость: по старой таблице часть 1/2 в четырёх run-ах из пяти шла на 3–14 минут
  дольше части 2/2.
- Без него: деление по медиане для 65 файлов; самый медленный `pr-inbox.spec.ts` (150 s) в таблице не значился.
- Требование: [Что строить, п. 3](../issues/168-macos-e2e-в-три-части.md#что-строить)
- Риски и пробелы test-ов: runner-ы GitHub разные: сумма по run-ам — от 3011 до 3925 s. На самом медленном run-е часть
  выйдет около 1310 s test-ов плюс около 2 минут сборки и установки — примерно 24 минуты. Скрипта, который снимает
  таблицу, в репозитории нет; разбор логов был одноразовым.

## 4. Test-ы держат число частей и равенство частей

Code: `test/contract/ci-workflow.test.ts:362-369` · key lines: 369

```ts
  it('runs a full macos-e2e in three shards of one Playwright worker each: two workers on the runner were measured flaky', () => {
    // worfy-throughput ticket 59 (2026-10-30): one shard in two workers took 1340 s, over the 20 min
    // allowed one job; two shards in two workers went red once and brought 7 flaky tests in three
    // runs, against none in one worker. playwright.config.ts keeps CI at one worker, and the job
    // passes no --workers of its own (its run lines are pinned above). worfy-polish ticket 168
    // (2026-11-27): two shards took 35-37 min against the 40 min globalTimeout, and one ran into it;
    // three shards of about 19 min of tests each, the limit unchanged.
    expect(E2E_SHARDS['macos-e2e']).toBe(3)
```

- Что делает: вместе с ним push в `main` ждёт `macos-e2e-shards=["1/3","2/3","3/3"]`, полные run-ы
  `test/contract/ci-scope-e2e.test.ts` — три части, а `test/unit/e2e-shard.test.ts` — три части текущей таблицы с
  разницей меньше 10 % одной части. Один worker на runner-е остаётся.
- Почему здесь: правило «сначала красный test»; ожидания с двумя частями лежали в этих файлах (`git diff`).
- Без него: число частей можно вернуть к 2, и ни один test не покраснеет.
- Требование: [Готово, когда, п. 2](../issues/168-macos-e2e-в-три-части.md#готово-когда)
- Риски и пробелы test-ов: test-ы не мерят время части в CI; 25 минут на трёх зелёных run-ах подряд проверяет только
  CI (`gh run view --json jobs`), и на этом PR это один run.

## 5. Что сознательно не меняли

`globalTimeout` в `playwright.config.ts` и `timeout-minutes: 45` job-а — без правки. `windows-e2e` — без правки: он
не читает число частей macOS. `ci-ok` — без правки: matrix-job в `needs` — это все его части. Скрипты orchestrator-а
(`worfy-orch/*.sh`, `scratch/*.cjs`) и `rules.md` имён `macos-e2e (1/2)` / `(2/2)` не содержат.

## 6. Как проверено

`pnpm test test/unit/e2e-shard.test.ts test/contract/ci-scope-e2e.test.ts test/contract/ci-workflow.test.ts` до
правки `E2E_SHARDS` — exit 1 (12 test-ов красные), после — exit 0. `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate
fast — коды выхода в PR. e2e и Electron локально не запускали (правило владельца).

## Проверить себя

1. Почему для третьей части не понадобилось править `ci-ok`?
   - Ответ: число частей приходит в matrix из output-а `ci-scope.mjs`, а `ci-ok` ждёт job `macos-e2e`, то есть все его
     части сразу, каким бы ни было их число.
   - Строки: `scripts/ci-scope.mjs:222`
2. Зачем вместе с числом частей снята новая таблица времени, если `e2e-shard.mjs` и так делит на любое число?
   - Ответ: старая таблица не знала 65 файлов и в сумме была на треть меньше настоящего времени, так что части выходили
     неравными; три части по устаревшим числам оставили бы одну из них заметно длиннее.
   - Строки: `test/e2e/timings.json:3-10`
3. PR трогает только часть spec-файлов. Сколько частей он получит?
   - Ответ: столько, сколько нужно, чтобы каждая была не длиннее части полного run-а, но не больше трёх и не больше
     числа файлов: это решает прежняя `e2eShards`, у которой изменился только предел.
   - Строки: `scripts/ci-scope.mjs:218-222`
