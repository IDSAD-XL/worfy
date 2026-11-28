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

Code: `scripts/eval-harness.mjs:396-399` · key lines: 397, 398

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
   - Строки: `scripts/eval-harness.mjs:396-399`
2. Почему ключ с NUL-байтом отказывается до `spawnSync`, а не ловится после?
   - Ответ: Node цитирует значение окружения в тексте ошибки `spawnSync`; проверка до запуска не даёт ключу попасть в
     текст вообще.
   - Строки: `scripts/eval-run-env.mjs:150-155`
