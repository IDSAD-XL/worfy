# Code story — worfy-harness-eval 04: `--changed` видит hook-скрипты, скрипты и библиотеки Harness и fixture-ы

Kind: pr · Epic: worfy-harness-eval · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

`pnpm eval:harness -- --changed <base>` выбирал case-ы только по файлам правил: skill-ам, агентам, `hooks/rules/*.md`,
`hooks/hooks.json` и `hooks/inject-rules.mjs`. Правка `harness/hooks/guard.mjs`, скрипта `harness/bin/*` или
библиотеки `harness/lib/*` не выбирала ни одного case-а. Общие fixture-ы — папки `evals/` без `prompt.md` — тоже
ничего не выбирали. Case `compaction-state` `--changed` пропускал всегда.

- Требование: [Что происходит](../issues/04-changed-видит-hook-и-скрипты-harness-и-fixture-ы.md#что-происходит)

## 2. Записи `scripts` в карте: case-ы, `"*"` или пути карты

Code: `harness/evals/lib/coverage.json:62-62` · key lines: 62

```json
    "hooks/guard.mjs": ["implementer-report", "implementer-story", "pr-fix-checks", "pr-fix-comments", "pr-fix-conflicts", "pr-fix-conflicts-silent", "ship-ticket-local-green", "ship-ticket-pr-green-ci"],
```

- Что делает: hook `guard.mjs` ведёт к восьми case-ам, где агент делает commit, переписывает историю или фильтрует
  вывод проверки. Это правила, которые `guard.mjs` проверяет.
- Почему здесь: Ticket называет `harness/evals/lib/coverage.json` в своём списке файлов. Почему не все 28 case-ов, хотя
  hook идёт в каждой Session: не записано в Ticket-е; так же устроены файлы правил, например `hooks/rules/common.md`
  ведёт только к `compaction-state`.
- Без него: правка guard-а проходила бы PR без единого case-а.
- Требование: [Что строить](../issues/04-changed-видит-hook-и-скрипты-harness-и-fixture-ы.md#что-строить)
- Риски и пробелы test-ов: список case-ов выбран чтением правил guard-а и skill-ов; test проверяет список, но не то,
  что guard действительно влияет на каждый из них.

## 3. Библиотека ведёт к case-ам скриптов, которые её загружают

Code: `scripts/eval-harness-coverage.mjs:193-204` · key lines: 197, 201

```js
function scriptCases(path, scripts, names, byFile, seen = new Set()) {
  if (seen.has(path)) return []
  seen.add(path)
  const cases = []
  for (const lead of scripts[path] ?? []) {
    if (lead === EVERY) cases.push(...names)
    else if (names.includes(lead)) cases.push(lead)
    else if (byFile.has(lead)) cases.push(...byFile.get(lead))
    else if (Object.hasOwn(scripts, lead)) cases.push(...scriptCases(lead, scripts, names, byFile, seen))
  }
  return cases
}
```

- Что делает: запись может назвать другой путь карты; `scriptCases` идёт по таким ссылкам, каждую один раз, и
  собирает их case-ы. Запись `"lib/evidence.cjs": ["bin/evidence-check", "bin/land", "bin/ticket",
  "hooks/after-compact.mjs"]` получает case-ы `bin/ticket`, `bin/evidence-check`, `bin/land` и
  `hooks/after-compact.mjs`.
- Почему здесь: Ticket называет `scripts/eval-harness-coverage.mjs` и `casesFor`. Ссылки вместо готовых списков —
  решение этого PR: новый case скрипта сразу доходит до его библиотек.
- Без него: список библиотеки пришлось бы вести руками и он бы отстал от скриптов.
- Требование: [Что строить](../issues/04-changed-видит-hook-и-скрипты-harness-и-fixture-ы.md#что-строить)
- Риски и пробелы test-ов: ссылка, которая образует круг, не считается ошибкой, её просто проходят один раз.

## 4. Каждый файл — в карте ровно один раз

Code: `scripts/eval-harness-coverage.mjs:170-176` · key lines: 173, 175

```js
  // Exactly once, under `scripts` or in `uncovered`: JSON.parse keeps the last of two equal keys, so
  // the keys are counted in the text of the map.
  for (const path of scripts) {
    const times = text.match(new RegExp(`"${literal(path)}"\\s*:`, 'g'))?.length ?? 0
    if (times === 0) problems.push(`not mapped: ${path}`)
    else if (times > 1) problems.push(`mapped more than once: ${path}`)
  }
```

- Что делает: считает ключ каждого файла `hooks/`, `bin/` и `lib/` в тексте карты: ноль — `not mapped`, больше
  одного — `mapped more than once`. Это и файл в `scripts` и в `uncovered` сразу, и один ключ дважды.
- Почему здесь: Ticket требует, чтобы `coverageProblems` проверял каждый файл ровно один раз. `JSON.parse` второй
  равный ключ молча оставляет, поэтому считать по разобранному объекту нельзя.
- Без него: новый hook-скрипт без записи в карте проходил бы test, и `--changed` молча его не видел бы.
- Требование: [Готово, когда, п. 1](../issues/04-changed-видит-hook-и-скрипты-harness-и-fixture-ы.md#готово-когда)
- Риски и пробелы test-ов: не записано

## 5. Общие fixture-ы — из `scaffold.sh`, не из карты

Code: `scripts/eval-harness-coverage.mjs:88-95` · key lines: 90, 92, 94

```js
    for (const line of readFileSync(scaffold, 'utf8').split('\n')) {
      if (/^\s*#/.test(line)) continue
      for (const [, folder, rest] of line.matchAll(/\.\.\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_./-]+)/g)) {
        // `../src/sum.mjs` of a step inside the demo repository is no folder of evals/.
        if (folder === 'lib' || folder === name || folder.startsWith('.') || !existsSync(join(harnessDir, 'evals', folder))) continue
        const sub = rest.includes('/') ? `${rest.slice(0, rest.lastIndexOf('/'))}/` : ''
        const dir = `evals/${folder}/${sub}`
        users[dir] = [...new Set([...(users[dir] ?? []), name])].sort()
```

- Что делает: строка `scaffold.sh`, которая называет файл в другой папке `evals/`, делает case пользователем папки
  этого файла. Так `evals/pr-fix-checks/fixture/` получает `pr-fix-comments`, `pr-fix-conflicts` и
  `pr-fix-conflicts-silent`, а не только свой case.
- Почему здесь: Ticket оставил выбор «по `scaffold.sh` case-а или по записи карты»; выбран `scaffold.sh`, потому что
  он и есть то, что исполняет fixture, и не может разойтись с картой.
- Без него: правка `pr-reply-fixture/gh.mjs` не выбирала ни одного case-а.
- Требование: [Что строить](../issues/04-changed-видит-hook-и-скрипты-harness-и-fixture-ы.md#что-строить)
- Риски и пробелы test-ов: fixture, который case берёт не из `scaffold.sh`, а из grader-а, сюда не попадёт; сейчас
  таких нет.

## 6. `compaction-state` под `--changed` идёт отдельным вызовом

Code: `scripts/eval-harness.mjs:349-357` · key lines: 349, 357

```js
    const runs = (one) => named.includes(one) || chosen !== null
    for (const name of cases.filter((one) => !runs(one))) {
      const variables = Object.entries(ALONE[name] ?? {}).map(([key, value]) => `${key}=${value}`).join(' ')
      process.stdout.write(
        `eval:harness: ${name} is skipped: it runs only alone, in a call of its own that sets ${variables || 'its variables'}; ` +
          `run it with pnpm eval:harness -- --case ${name}\n`,
      )
    }
    cases = cases.filter(runs)
```

- Что делает: case тега `alone`, который выбрал `--changed`, идёт так же, как с `--case`: свой вызов и две
  переменные сжатия только в нём.
- Почему здесь: Ticket называет `scripts/eval-harness.mjs:309-345` — `--changed` и вызов тега `alone`.
- Без него: правка `hooks/after-compact.mjs` выбирала `compaction-state`, но вызова не было.
- Требование: [Готово, когда, п. 2](../issues/04-changed-видит-hook-и-скрипты-harness-и-fixture-ы.md#готово-когда)
- Риски и пробелы test-ов: не записано

## 7. Что сознательно не меняли

Платного прогона нет: правка `coverage.json` выбирает все case-ы, это полный прогон Ticket-а 05. Файлы правил не
перенесены в `scripts`: `hooks/hooks.json` и `hooks/inject-rules.mjs` остались под case-ами.

## 8. Как проверено

- `node scripts/vitest-electron.mjs run test/contract/harness-evals-run.test.ts` до правки — 19 красных, после — exit 0.
- `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0.
- `pnpm eval:harness -- --changed origin/main --dry-run` — exit 0, вызовы `main`, `gui`, `alone-compaction-state`.
- `pnpm lint` и `pnpm typecheck` — exit 0. Локальный `pnpm test` — exit 1: из 21802 test-ов упал один,
  `bin/tests/land.test.sh` убит по пределу 360 s под нагрузкой машины; этот PR его файлы не меняет, и test не
  перезапускался. Ответ на это — `ci-ok` на head PR.

## Проверить себя

1. Почему повтор ключа в карте ищется по тексту, а не по разобранному объекту?
   Ответ: `JSON.parse` оставляет последний из двух равных ключей, и объект уже не знает о повторе.
   Lines: `scripts/eval-harness-coverage.mjs:170-176`
2. Какие case-ы выберет правка `harness/evals/pr-fix-checks/fixture/pr-fix.cjs` и почему не только `pr-fix-checks`?
   Ответ: ещё `pr-fix-comments`, `pr-fix-conflicts`, `pr-fix-conflicts-silent`: их `scaffold.sh` запускает
   `../pr-fix-checks/fixture/pr-fix.cjs`, и папка `evals/pr-fix-checks/fixture/` становится их общим fixture-ом.
   Lines: `scripts/eval-harness-coverage.mjs:88-95`

## 9. Что нашёл review и что осталось

> VERIFIED
>
> Все пять замечаний первого раунда исправлены:
> - **`harness/evals/lib/coverage.json:59`** — исправлено. В запись `hooks/gate-paths.mjs` добавлен `hooks/gate-resolve.mjs`.
> - **`coverage.json:49`** — исправлено. У `bin/ticket` теперь есть `bin/epic-status`, `bin/evidence-check`, `bin/review-draft-lint` и `bin/silent-check`.
> - **`coverage.json:37`** — исправлено. У `bin/evidence-check` теперь есть `bin/ticket`.
> - **`coverage.json:77`** — исправлено. У `lib/input-words.json` теперь есть `bin/ticket`.
> - **Описание PR #2355** — исправлено. В строке 16 есть предложение о цене будущих платных прогонов: правка `bin/profile` или `hooks/eval-env.cjs` выбирает все 28 case-ов, а `compaction-state` идёт отдельным вызовом в том же бюджете 30 USD.
>
> Пятый пропуск, который нашёл новый test, тоже исправлен (`coverage.json:65`). `hooks/after-compact.mjs:193` запускает `stage-lines.mjs`, и теперь он есть в записи `stage-lines.mjs`.
>
> Rebase-конфликт в `scripts/eval-harness.mjs:84` решён правильно. `REGULAR_MODEL` импортируется и используется в строках 99 и 402. Удалённый `MODEL` нигде не импортируется. Свои `MODEL` есть только у spike-скриптов в `scripts/spikes/`, к `eval-run-env.mjs` они не относятся.
>
> **Новый test** (`test/contract/harness-evals-run.test.ts:825-870`) работает как заявлено:
> - **Карта первого раунда.** На ней test красный, ровно 7 рёбер. Среди них все три пропуска уровня med и `after-compact`, так что утверждение тикета «7 рёбер» подтверждено.
> - **Мутанты.** Я убирал по одному ребру: `gate-resolve`, `bin/ticket` у `evidence-check` и четыре скрипта у `bin/ticket`. Каждый раз exit 1, и test называет точное ребро.
> - **Пропуски, которые test может не видеть.** Я прогнал свой, более широкий поиск: любое упоминание имени файла в строке кода. Пропущенных рёбер он не нашёл. Все его кандидаты оказались строками-литералами, а не загрузкой файла: тексты в `bin/profile:345-348`, таблица timeout-ов в `hooks/hook-stdin.mjs:27-30`, `TICKETS.md`.
> - **Мутант пропуска комментариев.** Я убрал фильтр комментариев, и test остался зелёным (exit 0). Сегодня ни одна строка комментария не даёт лишнего ребра, то есть фильтр пока ничего не меняет. Это не дефект.
>
> Новые замечания:
> - `test/contract/harness-evals-run.test.ts:845` и `harness/README.md`: [low] регулярка не видит загрузку вида `createRequire(import.meta.url)("../lib/x")`. Она используется в `hooks/after-compact.mjs:52`, `hooks/gate.mjs:877`, `hooks/session-start.mjs:186` и `bin/ticket:494`. Комментарий и README говорят только о «пути, собранном иначе», а это явный путь-литерал. Поэтому test не поймал пропуск `input-words.json`. Сегодня все четыре ребра покрыты: вписаны вручную или через другие скрипты. Исправление: добавить `\)\(` в регулярку или назвать этот случай в комментарии.
>
> Что запускал, всё под временным HOME:
> - `pnpm install --frozen-lockfile`: exit 0.
> - `node scripts/vitest-electron.mjs run test/contract/harness-evals-run.test.ts test/contract/harness-evals.test.ts`: exit 0, 809 passed, 8 skipped.
> - `pnpm eval:harness -- --changed origin/main --dry-run`: exit 0, три вызова: main, gui и alone-compaction-state.
> - `story-check --head HEAD` (e7104bc37): exit 0, 5 фрагментов совпали.
> - Коммит d4463a5f2 есть в ветке: `git merge-base --is-ancestor` exit 0.
> - Мутанты M1–M3: exit 1 каждый, M4: exit 0, прогон на старой карте: exit 1. После каждого файлы восстановлены, `cmp` совпал.
> - Worktree удалён, временные файлы тоже, фоновых процессов нет.
>
> Не проверил:
> - CI на e7104bc еще идёт, `ci-ok` я не смотрел.
> - Платный eval и gate не запускал: бриф этого не просил, платные вызовы запрещены.
>
> Больше ничего не найдено.
>
> Review depth: medium — ticket

Code: `harness/evals/lib/coverage.json:59-59` · key lines: 59

```json
    "hooks/gate-paths.mjs": ["hooks/gate-resolve.mjs", "hooks/gate.mjs", "hooks/guard.mjs", "hooks/stop.mjs"],
```

Code: `scripts/eval-harness.mjs:84-84` · key lines: 84

```mjs
import { checkVersion, claudeBinary, cleanEnv, gitFolder, gitForRuns, JUDGE_MODEL, pluginCopy, REGULAR_MODEL, runClaude } from './eval-run-env.mjs'
```

Code: `test/contract/harness-evals-run.test.ts:845-845` · key lines: 845

```ts
      for (const line of code) {
```
