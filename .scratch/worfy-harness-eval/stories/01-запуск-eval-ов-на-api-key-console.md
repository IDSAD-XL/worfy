# Code story — worfy-harness-eval 01: Запуск eval-ов на API key организации Console и проверка расхода одним коротким run-ом

Kind: pr · Epic: worfy-harness-eval · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

Оба платных eval-скрипта запускали `claude` только под входом подписки владельца. Выбора «на кредитах» не было, и
200 USD API-кредитов в месяц сгорали, пока eval-ы тратили лимит подписки.

- Требование: [Что происходит](../issues/01-запуск-eval-ов-на-api-key-console.md#что-происходит)

## 2. Кто платит — явный выбор, ключ только в одной переменной

Code: `scripts/eval-run-env.mjs:129-143` · key lines: 130, 137, 142

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
  return { vars: { ANTHROPIC_API_KEY: key }, line: `billing credits: ANTHROPIC_API_KEY=<hidden> from ${file}` }
}
```

- Что делает: убирает `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` из окружения run-ов; для `credits` читает ключ из
  файла в папке состояния Harness и возвращает его только в `vars`. Строка для вывода называет файл, а не ключ.
- Почему здесь: Ticket называет `scripts/eval-run-env.mjs` местом чтения ключа и окружения запуска на кредитах; этот
  модуль общий для обоих скриптов.
- Без него: ключ, экспортированный в shell, молча делал бы run «на подписке» платным по ключу; без файла run на
  кредитах дошёл бы до модели под подпиской.
- Требование: [Что строить](../issues/01-запуск-eval-ов-на-api-key-console.md#что-строить)
- Риски и пробелы test-ов: judge-вызовы score в `pnpm eval:outcome` этот выбор не получают — они по-прежнему под
  входом подписки. Куда `claude plugin eval` с ключом списывает расход, test-ы не знают: это ручной пункт Console.

## 3. Ключ получает только вызов claude plugin eval

Code: `scripts/eval-harness.mjs:396-399` · key lines: 397, 398

```js
// The key of a credits run goes only into the environment of each claude call, below.
const billing = billingFor(billingName, childEnv, fail)
process.stdout.write(`eval:harness: ${billing.line}\n`)
if (dryRun) {
```

- Что делает: выбор счёта делается до `--dry-run`, так что пробный запуск тоже называет счёт и тоже отказывает без
  файла ключа. В `childEnv` ключ не кладётся: его добавляет только вызов `runClaude` для `plugin eval`
  (`{ ...childEnv, ...billing.vars, ...call.vars }`), а не `claude --version` и не копия git.
- Почему здесь: Ticket требует, чтобы `--dry-run` печатал выбранный счёт, а ключ попадал только в окружение
  дочернего `claude`.
- Без него: `--dry-run` перед платным run-ом не показал бы, на чьи деньги пойдёт run.
- Требование: [Что строить](../issues/01-запуск-eval-ов-на-api-key-console.md#что-строить)
- Риски и пробелы test-ов: вывод самого `claude` идёт напрямую (`stdio: 'inherit'`); если агент в run-е напечатает
  своё окружение, скрипт этого не отфильтрует.

## 4. Как проверено

- `pnpm test test/contract/harness-evals-run.test.ts test/contract/harness-evals-outcome.test.ts -t billing` на коде
  до правки — exit 1, 10 test-ов красные; с правкой оба файла — exit 0.
- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0.
- `pnpm eval:harness -- --case status-block --billing credits --max-cost-usd 2 --dry-run` — exit 0, затем тот же
  run без `--dry-run` — exit 0, `costUsd 0.31`.

## Проверить себя

1. Почему ключ не кладётся в `childEnv`, а добавляется только при вызове `plugin eval`?
   - Ответ: `childEnv` уходит и в git, и в `claude --version`; ключ должен попасть только в окружение вызова, который
     ходит в модель.
   - Строки: `scripts/eval-harness.mjs:396-399`
2. Что изменилось для run-а без `--billing`, если в shell экспортирован `ANTHROPIC_API_KEY`?
   - Ответ: переменная убирается, и run идёт под входом подписки, а не по ключу.
   - Строки: `scripts/eval-run-env.mjs:129-133`
