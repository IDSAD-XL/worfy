# Code story — worfy-harness-eval 01: Запуск eval-ов на API key организации Console и проверка расхода одним коротким run-ом

Kind: pr · Epic: worfy-harness-eval · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

Оба платных eval-скрипта запускали `claude` только под входом подписки владельца. Выбора «на кредитах» не было, и
200 USD API-кредитов в месяц сгорали, пока eval-ы тратили лимит подписки.

- Требование: [Что происходит](../issues/01-запуск-eval-ов-на-api-key-console.md#что-происходит)

## 2. Кто платит — явный выбор, ключ только в одной переменной

Code: `scripts/eval-run-env.mjs:137-157` · key lines: 138, 145, 153, 156

```js
export function billingFor(billing, env, fail) {
  for (const key of KEY_VARIABLES) delete env[key]
  if (billing !== 'credits') {
    return { vars: {}, line: `billing subscription: the runs use the claude sign-in of this machine (${KEY_VARIABLES.join(' and ')} taken out)` }
  }
  const file = apiKeyFile()
  let key
  try {
    key = readFileSync(file, 'utf8').trim()
  } catch (error) {
    return fail(`--billing credits needs the Console API key in ${file}: ${error?.code === 'ENOENT' ? 'no such file' : error instanceof Error ? error.message : String(error)}`)
  }
  if (key === '') return fail(`--billing credits needs the Console API key in ${file}: the file is empty`)
  // Printable ASCII without spaces, as a Console key is. A NUL byte (a UTF-16 file, as Out-File of
  // Windows PowerShell 5.1 writes it) would make spawnSync throw an error whose text holds the key;
  // the message names the file and never a character of the key.
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return fail(`--billing credits: the key in ${file} is not one line of printable ASCII without spaces (a UTF-16 file? save it as plain ASCII)`)
  }
  return { vars: { ANTHROPIC_API_KEY: key }, line: `billing credits: ANTHROPIC_API_KEY=<hidden> from ${file}` }
}
```

- Что делает: убирает `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` из окружения run-ов; для `credits` читает ключ из
  файла в папке состояния Harness, проверяет, что это одна строка печатаемых ASCII, и возвращает его только в `vars`.
  Строка для вывода и сообщения об отказе называют файл, а не ключ.
- Почему здесь: Ticket называет `scripts/eval-run-env.mjs` местом чтения ключа и окружения запуска на кредитах; этот
  модуль общий для обоих скриптов.
- Без него: ключ, экспортированный в shell, молча делал бы run «на подписке» платным по ключу; без файла run на
  кредитах дошёл бы до модели под подпиской; ключ с NUL-байтом (файл в UTF-16) попал бы в stderr через текст ошибки
  `spawnSync` (ревью, раунд 1).
- Требование: [Что строить](../issues/01-запуск-eval-ов-на-api-key-console.md#что-строить)
- Риски и пробелы test-ов: на кредитах ключ видят Bash tool и hooks агента внутри `claude plugin eval`; очистка
  окружения подпроцессов не включена и не проверена без платного run-а.

## 3. Ключ получает только вызов claude plugin eval

Code: `scripts/eval-harness.mjs:401-404` · key lines: 402, 403

```js
// The key of a credits run goes only into the environment of each claude call, below.
const billing = billingFor(billingName, childEnv, fail)
process.stdout.write(`eval:harness: ${billing.line}\n`)
if (dryRun) {
```

- Что делает: выбор счёта делается до `--dry-run`, так что пробный запуск тоже называет счёт и тоже отказывает без
  файла ключа. В `childEnv` ключ не кладётся: его добавляет только вызов `runClaude` для `plugin eval`, а не
  `claude --version` и не копия git.
- Почему здесь: Ticket требует, чтобы `--dry-run` печатал выбранный счёт, а ключ попадал только в окружение
  дочернего `claude`.
- Без него: `--dry-run` перед платным run-ом не показал бы, на чьи деньги пойдёт run.
- Требование: [Что строить](../issues/01-запуск-eval-ов-на-api-key-console.md#что-строить)
- Риски и пробелы test-ов: вывод самого `claude` идёт напрямую (`stdio: 'inherit'`); если агент в run-е напечатает
  своё окружение, скрипт этого не отфильтрует.

## 4. Judge score платит тем же счётом

Code: `scripts/eval-outcome.mjs:314-316` · key lines: 316

```js
// The judge calls of the score bill the same as the plugin eval call; taken before gitForRuns adds
// the copy of git, which the judge does not need and which is gone by the time it runs.
const judgeEnv = { ...childEnv, ...billing.vars }
```

- Что делает: окружение judge-вызовов score — то же, что у вызова `plugin eval`, с ключом на кредитах и без
  переменных ключа shell по умолчанию. `scoreResults` передаёт его до `askJudge`, в `outcome.json` оно не пишется.
- Почему здесь: ревью, раунд 1: judge строил окружение из `process.env` и на кредитах шёл под подпиской.
- Без него: на `subscription` judge платил бы ключом из shell, на `credits` — лимитом подписки.
- Требование: [Что строить](../issues/01-запуск-eval-ов-на-api-key-console.md#что-строить)
- Риски и пробелы test-ов: отдельный `scripts/eval-outcome-score.mjs` опции `--billing` не имеет.

## 5. Как проверено

- `pnpm test test/contract/harness-evals-run.test.ts test/contract/harness-evals-outcome.test.ts` с временным HOME —
  exit 0. На коде до правки новые test-ы раунда 1 красные, exit 1.
- Mutant-ы раунда 2: ключ в общем `childEnv`, без проверки ключа, judge без `judgeEnv` — каждый exit 1.
- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0.
- `pnpm eval:harness -- --case status-block --billing credits --max-cost-usd 2 --dry-run` — exit 0, затем тот же
  run без `--dry-run` — exit 0, `costUsd 0.31`; владелец увидел расход в кредитах Console.

## Проверить себя

1. Почему ключ не кладётся в `childEnv`, а добавляется только при вызове `plugin eval`?
   - Ответ: `childEnv` уходит и в git, и в `claude --version`; ключ должен попасть только в окружение вызова, который
     ходит в модель.
   - Строки: `scripts/eval-harness.mjs:401-404`
2. Почему ключ с NUL-байтом отказывается до `spawnSync`, а не ловится после?
   - Ответ: Node цитирует значение окружения в тексте ошибки `spawnSync`; проверка до запуска не даёт ключу попасть в
     текст вообще.
   - Строки: `scripts/eval-run-env.mjs:150-155`

## 6. Что нашёл review и что осталось

> VERIFIED
>
> Все четыре находки первого раунда (round 1) закрыты. Новых дефектов, которые блокируют merge, нет.
>
> **Находки первого раунда:**
> - **[high] ключ в stderr из-за NUL-байта** (`scripts/eval-run-env.mjs:150-155`) — исправлено. `billingFor` отказывает ключу, если в нём не одна строка печатаемых ASCII без пробелов. Сообщение называет только файл. Файл в UTF-16 с BOM тоже отказывается: `trim()` снимает BOM, NUL-байты остаются, и проверка их ловит. Mutant M3 убрал проверку: test упал, но stderr показал только `cannot start …: spawnSync refused … (ERR_INVALID_ARG_VALUE)`. Значит, catch в `runClaude` (`eval-run-env.mjs:179-189`) сам не даёт ключу попасть в вывод.
> - **[med] judge-вызовы `eval:outcome` строили окружение из `cleanEnv(process.env)`** — исправлено. `judgeEnv` в `scripts/eval-outcome.mjs:316` собирается из `childEnv` после того, как `billingFor` убрал оттуда переменные ключа. Дальше он идёт через `scoreResults`, `scoreRun` и `runChecks` в `askJudge` (`eval-outcome-lib.mjs:727`). В `outcome.json` и в лог попадает только argv judge, окружения там нет. Mutant M2 (judge снова на `cleanEnv()`) убит: 2 failed.
> - **[med] нет test-а, что ключ не уходит в `claude --version` и в git** — исправлено. Новый test `harness-evals-run.test.ts:1445` проверяет это через stub, который логирует `--version`, и через поддельный git на PATH. Mutant M1 (ключ в общем `childEnv`) теперь убит: 1 failed.
> - **[low] ключ видят Bash tool и hooks агента** — остаётся описанным пределом в PR и в «Итоге» ticket-а. Это допустимо.
>
> **Другие пути печати окружения:**
> - Вызов git в `eval-harness.mjs:217` и `checkVersion` получают `childEnv` без ключа.
> - `envPrefix` в выводе и строка dry run печатают только `call.vars`.
> - Ошибка judge печатает код выхода и хвост stderr самого claude.
> - Ошибка чтения файла ключа печатает только путь.
>
> **Новые находки:**
> - **[low]** `scripts/eval-outcome-score.mjs:61,71` и `scripts/eval-outcome-check.mjs:58`. Judge этих двух скриптов по-прежнему запускается на `cleanEnv()`, и `ANTHROPIC_API_KEY` из shell до него доходит. Опции выбора оплаты (`--billing`) у этих скриптов нет совсем, и до этого PR они вели себя так же. «Итог» ticket-а честно оговаривает `eval-outcome-score.mjs`, а `eval-outcome-check.mjs` не упоминает. Фраза PR «no longer reach any run» шире кода. Исправление: сузить фразу в PR до `eval:harness` / `eval:outcome` либо убрать `KEY_VARIABLES` и в этих двух скриптах.
> - **[low]** Evidence-строки (строки доказательства в ticket-е) ссылаются на SHA до rebase, которых в ветке нет: `merge-base --is-ancestor` даёт exit 1. Это gate fast на 75b01732 и 71628f267, платный run на 75b01732 и owner-check на 5bf665f77.
>   - Owner-check на 5bf665f77 допустим. Он фиксирует событие (расход в Console после run-а), а не код. По range-diff 5bf665f77 совпадает по содержимому с a0eefbe44 в ветке. Если строку нужно привязать к коммиту ветки, проще перенести её на a0eefbe44.
>   - Gate fast без SHA в ветке — по сути запись без доказательства для нынешнего head. Перезапуск gate на c6230d30d его закрывает.
>
> **Что запускал:**
> - `pnpm test test/contract/harness-evals-run.test.ts test/contract/harness-evals-outcome.test.ts` с временным HOME, без `HARNESS_HOME`: exit 0, 243 passed, 4 skipped.
> - Mutant-ы M1, M2, M3, каждый с `-t "billing|bills"`: все exit 1. Файлы восстановлены из копии, `cmp` exit 0.
> - `story-check --head c6230d30d`: exit 0, ok.
> - Worktree удалён, фоновых процессов нет.
>
> **Что не проверил:**
> - Настоящий `claude plugin eval` и биллинг: платные вызовы брифом запрещены.
> - `ci-ok` на c6230d30d: на момент проверки `macos-tests` ещё pending.
> - Gate fast сам не запускал: бриф его не просил.
>
> Больше ничего не найдено.
>
> Orchestrator: the PR body claim is narrowed to eval:harness / eval:outcome and names eval-outcome-score.mjs and eval-outcome-check.mjs as not covered.
>
> Review depth: medium — ticket

Code: `scripts/eval-run-env.mjs:150-155` · key lines: 150

```mjs
  // Printable ASCII without spaces, as a Console key is. A NUL byte (a UTF-16 file, as Out-File of
  // Windows PowerShell 5.1 writes it) would make spawnSync throw an error whose text holds the key;
  // the message names the file and never a character of the key.
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return fail(`--billing credits: the key in ${file} is not one line of printable ASCII without spaces (a UTF-16 file? save it as plain ASCII)`)
  }
```

Code: `scripts/eval-outcome.mjs:316-316` · key lines: 316

```mjs
const judgeEnv = { ...childEnv, ...billing.vars }
```

Code: `scripts/eval-outcome-score.mjs:61-61` · key lines: 61

```mjs
  judge = judgeCommand(process.env.EVAL_OUTCOME_JUDGE ? '' : claudeBinary(REPO, (message) => stop(1, message)))
```

Code: `scripts/eval-outcome-check.mjs:58-58` · key lines: 58

```mjs
const judge = useJudge ? judgeCommand(process.env.EVAL_OUTCOME_JUDGE ? '' : claudeBinary(REPO, (message) => stop(2, message))) : null
```
