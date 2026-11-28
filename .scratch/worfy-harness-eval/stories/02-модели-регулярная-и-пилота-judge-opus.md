# Code story — worfy-harness-eval 02: Модели: регулярная `claude-sonnet-5-5` и пилота `claude-opus-5-5` вместо одной, judge Opus

Kind: pr · Epic: worfy-harness-eval · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

Все скрипты eval-ов брали одну модель агента `claude-sonnet-5` и judge `claude-haiku-4-5`. На `claude-sonnet-5`
пришлось 0,1 % сообщений владельца за 30 дней, на `claude-opus-5-5` — 85 %; judge на Haiku трижды ошибался так, что
grader переписывали. Пилоту (Ticket 08) нужна своя модель, отдельная от регулярных прогонов.

- Требование: [Что происходит](../issues/02-модели-регулярная-и-пилота-judge-opus.md#что-происходит)

## 2. Три закреплённые модели в одном месте

Code: `scripts/eval-run-env.mjs:36-41` · key lines: 37, 39, 41

```js
/** The agent of the regular runs: `pnpm eval:harness` and `pnpm eval:outcome`. */
export const REGULAR_MODEL = 'claude-sonnet-5-5'
/** The agent of the pilot and of the cost measurement, the model the owner's own work runs on. */
export const PILOT_MODEL = 'claude-opus-5-5'
/** The judge everywhere: `--judge-model` of `claude plugin eval` and the judge of the outcome scorer. */
export const JUDGE_MODEL = 'claude-opus-5-5'
```

- Что делает: заменяет `MODEL` двумя константами модели агента и переводит judge на `claude-opus-5-5`.
  `eval-harness.mjs` и `eval-outcome.mjs` импортируют `REGULAR_MODEL`; judge scorer-а (`judgeCommand` в
  `eval-outcome-lib.mjs`) по-прежнему берёт `JUDGE_MODEL` и получает новое значение без правки.
- Почему здесь: Ticket называет `scripts/eval-run-env.mjs:32-33` местом констант; это общий модуль окружения обоих
  eval-ов.
- Без него: регулярные прогоны мерили бы модель, на которой владелец почти не работает, а runner пилота не имел бы
  своей константы.
- Требование: [Что строить](../issues/02-модели-регулярная-и-пилота-judge-opus.md#что-строить)
- Риски и пробелы test-ов: что `claude plugin eval` и `claude -p` принимают эти имена моделей, проверит только
  платный прогон Ticket-а 05; contract test-ы видят лишь аргументы, переданные stub-у.

## 3. Test фиксирует значения, а не только связь с константой

Code: `test/contract/harness-evals-run.test.ts:126-142` · key lines: 128, 129, 130, 136, 141

```ts
  it('pins the regular, the pilot and the judge model', async () => {
    const { REGULAR_MODEL, PILOT_MODEL, JUDGE_MODEL } = await runEnvModule()
    expect(REGULAR_MODEL).toBe('claude-sonnet-5-5')
    expect(PILOT_MODEL).toBe('claude-opus-5-5')
    expect(JUDGE_MODEL).toBe('claude-opus-5-5')
  })

  it('names the regular model and the judge in its launch line and in every call of a dry run', () => {
    const real = evalHarness('2.1.289', '0,0')
    expect(real.run.status, real.run.stderr).toBe(0)
    expect(lines(real.run.stdout).filter((line) => /^eval:harness: claude 2\.1\.289 \(.+\), model claude-sonnet-5-5, judge claude-opus-5-5$/.test(line))).toHaveLength(1)
    const dry = evalHarness('2.1.289', '0,0', ['--dry-run'])
    expect(dry.run.status, dry.run.stderr).toBe(0)
    const commands = lines(dry.run.stdout).filter((line) => / — .*claude plugin eval /.test(line))
    expect(commands).toHaveLength(2)
    for (const line of commands) expect(line).toMatch(/ --model claude-sonnet-5-5 --judge-model claude-opus-5-5 /)
  })
```

- Что делает: прежние test-ы сравнивали флаги с самой константой и прошли бы при любом её значении; эти два
  сравнивают с литералами и проверяют строку запуска и строки `--dry-run`.
- Почему здесь: Ticket называет этот файл и требует test, который сначала падает на нынешних константах.
- Без него: случайная смена модели не покраснела бы ни одним test-ом, хотя по README она требует полного платного
  прогона.
- Требование: [Test-ы](../issues/02-модели-регулярная-и-пилота-judge-opus.md#test-ы)
- Риски и пробелы test-ов: не записано

## 4. README называет модели и место констант

Code: `harness/README.md:163-168` · key lines: 164, 166

```md
Every run and every `llm` grader is a real model call on your account. The agent runs on
`claude-sonnet-5-5` and the judge on `claude-opus-5-5` (`REGULAR_MODEL` and `JUDGE_MODEL`; `PILOT_MODEL`,
`claude-opus-5-5`, is the agent of the pilot). The full set (ten
cases, 25 runs, then on `claude-sonnet-5` with a `claude-haiku-4-5` judge) cost 15 USD and took an hour on 2026-10-18: an `epic-wave` or `ship-ticket` run costs 0.4–1.9 USD, a
`reviewer` run about 0.25 USD, a `status-block` run about 0.12 USD. The first full run on the
new models is the new baseline; its cost replaces these figures.
```

- Что делает: называет модели агента и judge; цена 15 USD остаётся, но помечена как цена на старых моделях. Правило
  полного прогона ниже называет `REGULAR_MODEL` и `JUDGE_MODEL` в `eval-run-env.mjs` вместо `MODEL` в
  `eval-harness.mjs`.
- Почему здесь: Ticket называет `harness/README.md:163-165` и `:247-250`. Путь `scripts/eval-run-env.mjs` в README не
  написан: `harness/bin/tests/plugin-neutral.test.sh` запрещает новые пути скриптов репозитория worfy в plugin-е
  (ADR-0074), поэтому файл назван по имени рядом с уже разрешённым `scripts/eval-harness.mjs`.
- Без него: README называл бы константу, которой нет, в файле, где её никогда не было.
- Требование: [Что строить](../issues/02-модели-регулярная-и-пилота-judge-opus.md#что-строить)
- Риски и пробелы test-ов: цена на новых моделях неизвестна до Ticket-а 05; test-а на текст README нет.

## 5. Как проверено

- `vitest run` двух contract-файлов на старых константах — 6 красных test-ов; после правки — exit 0.
- `pnpm eval:harness -- --dry-run` со stub-ом `claude` — exit 0, обе строки вызова несут `--model claude-sonnet-5-5
  --judge-model claude-opus-5-5`.
- `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0 (37 passed); с полным путём `scripts/eval-run-env.mjs` в
  README он был красным.
- `pnpm lint && pnpm typecheck && pnpm test` на Mac — lint и typecheck прошли, `pnpm test` дважды exit 1 при load
  average около 83: в каждом прогоне по два других test-а (watcher `docs-watch-root-gone`, `land.test.sh` и
  `sidebar-resize` по timeout), ни один не трогает файлы PR, и каждый прошёл в другом прогоне. Вердикт — `ci-ok`.

## Проверить себя

1. Почему старые test-ы не заметили бы смену модели, а новые заметят?
   Ответ: старые сравнивали флаг `--model` с самой константой (`toEqual([MODEL])`), новые — с литералом
   `claude-sonnet-5-5`.
   Строки: `test/contract/harness-evals-run.test.ts:126-142`
2. Какую модель берёт judge scorer-а после этого PR, хотя `eval-outcome-lib.mjs` не менялся?
   Ответ: `claude-opus-5-5`: он импортирует `JUDGE_MODEL`, а её значение сменилось в `eval-run-env.mjs`.
   Строки: `scripts/eval-run-env.mjs:36-41`
