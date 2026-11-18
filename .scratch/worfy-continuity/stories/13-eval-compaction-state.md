# Code story — worfy-continuity 13: Eval-кейс `compaction-state`: probes о состоянии после compaction, с hook-ом и без

Kind: pr · Epic: worfy-continuity · Ticket: 13 · PR: - · Language: ru

## 1. Что было не так

Что агент помнит после compaction, никто не мерил. Инструкции summary Ticket-а 10 (`compaction.md` через `PreCompact`)
и hook Ticket-а 11 (`after-compact.mjs`) влиты, но не сравнены с тем, что было без них. По решению без владельца 1
половина compaction этого Epic-а считается сделанной, только когда eval записал числа.

- Требование: [Что происходит](../issues/13-eval-compaction-state.md#что-происходит)

## 2. Папка run-а — worktree implementer-а

Code: `harness/evals/compaction-state/scaffold.sh:94-99` · key lines: 95, 96, 98

```bash
# --- the worktree: made in .wt/01, then moved here (git refuses a folder that is not empty) ------
git -C .demo worktree add -q --no-checkout -b demo/01 "$work/.wt/01" origin/main
mv .wt/01/.git .git
rmdir .wt/01 .wt
git -C .demo worktree repair "$work" 2>/dev/null
git reset -q --hard
```

- Что делает: делает папку, в которой стартует run, linked worktree проекта demo на ветке `demo/01`. Main checkout
  лежит в `.demo/` внутри неё. Дальше сценарий кладёт на диск ту картину, на которой обрывается история: Ticket взят,
  `double` закоммичен, точка входа и `package.json` не закоммичены, `node --test` красный.
- Почему здесь: `after-compact.mjs` отдаёт Ticket и `git status --short` только в linked worktree на ветке Ticket-а; в
  main checkout он отдаёт `wave-brief` Orchestrator-а. `claude plugin eval` запускает run в папке сценария, а сценарий
  пишет только в неё и в `$HOME`, поэтому main checkout — внутри.
- Без него: hook видел бы Orchestrator-а, и вариант «с hook-ом» мерил бы не тот контекст.
- Требование: [Что делаем, пункт 1](../issues/13-eval-compaction-state.md#что-делаем)
- Риски и пробелы test-ов: `git worktree add` не пускает в непустую папку, отсюда перенос `.git` и `repair`. Contract
  test строит fixture на Linux, macOS и Windows, но вывод hook-а на нём проверен только руками на Mac и прогоном
  против stub-а.

## 3. Вариант без hook-а и инструкций

Code: `harness/evals/compaction-state/baseline.mjs:36-49` · key lines: 39, 41, 49

```js
const hooksFile = join(copy, 'hooks', 'hooks.json')
const hooks = JSON.parse(readFileSync(hooksFile, 'utf8'))
if (!Array.isArray(hooks.hooks?.PreCompact)) fail(`${relative(copy, hooksFile)} has no PreCompact hook`)
delete hooks.hooks.PreCompact
const starts = hooks.hooks.SessionStart ?? []
const kept = starts.filter((entry) => entry?.matcher !== 'compact')
if (kept.length !== starts.length - 1) fail(`${relative(copy, hooksFile)} has ${starts.length - kept.length} SessionStart hooks with the matcher compact, not one`)
hooks.hooks.SessionStart = kept
writeFileSync(hooksFile, `${JSON.stringify(hooks, null, 2)}\n`)

const commonFile = join(copy, 'hooks', 'rules', 'common.md')
const common = readFileSync(commonFile, 'utf8')
if (!FALLBACK.test(common)) fail(`${relative(copy, commonFile)} has no item "After a compaction"`)
writeFileSync(commonFile, common.replace(FALLBACK, ''))
```

- Что делает: во временной копии `harness/` убирает три части compaction: hook `PreCompact`, hook `SessionStart` с
  matcher-ом `compact` и пункт «After a compaction» в `common.md`. Если какой-то части нет на месте, скрипт выходит с
  кодом 1 и удаляет копию.
- Почему здесь: `--ablation with-without` у `claude plugin eval` убрал бы весь plugin, и при `history_file` он
  запускает только вариант «with». В `scripts/eval-harness.mjs` уже есть `HARNESS_DIR` для другой копии Harness: для
  второго варианта скрипт не правится.
- Без него: второго варианта нет, и сравнивать не с чем.
- Требование: [Что делаем, пункт 2](../issues/13-eval-compaction-state.md#что-делаем)
- Риски и пробелы test-ов: test-а на сам скрипт нет. Проверен руками (`diff -r` копии с `harness/` показывает только
  эти три правки) и прогоном против stub-а: в варианте без hook-а нет ни `compaction.md` в запросе на summary, ни
  контекста `after-compact.mjs` после compaction.

## 4. Grader: compaction была

Code: `harness/evals/compaction-state/graders/compacted.md:1-13` · key lines: 3, 5

```md
---
type: regex
weight: 3
target: trace
pattern: '"subtype"\s*:\s*"compact_boundary"'
---

The session was compacted before the answer: the trace has a compact_boundary. The case compacts only when
the environment of the run has CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000 and CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5 (a
case may set only EVAL_* variables; `pnpm eval:harness -- --case compaction-state` sets them); without them the
agent answers from the whole history, and the other graders measure nothing. Weight 3 against 1 for each of the
other eight graders: a run without a compaction scores at most 8 / 11 = 0.73, below the threshold of 0.8, while
one other grader that fails leaves 10 / 11 = 0.91 and two leave 9 / 11 = 0.82.
```

- Что делает: проваливает run, в trace которого нет границы compaction, и с весом 3 валит этим весь кейс.
- Почему здесь: `claude plugin eval` отказывает кейсу с `env`, кроме `EVAL_*` («only EVAL_* keys can be set from
  case.yaml»), поэтому низкий порог auto-compaction задаёт shell запуска. Если shell его не задал, история в 32 тыс.
  токенов не сжимается, и агент отвечает по полной истории.
- Без него: забытые переменные дали бы высокие оценки, которые ничего не мерят. С весом 1 из 9 run без compaction
  получал 8 / 9 = 0,89 и кейс проходил порог 0,8 (ревью PR #1996). Вес больше 2 даёт 8 / (8 + w) < 0,8; 3 — наименьший
  целый, и он оставляет probes почти прежний вес: при весе 8 кейс прошёл бы и с тремя проваленными probes в run-е.
- Требование: [Что делаем, пункт 3](../issues/13-eval-compaction-state.md#что-делаем)
- Риски и пробелы test-ов: проверен против stub-а с переменными (совпал) и без них (не совпал). Вес проверен только
  арифметикой: «A run's score is the weighted fraction of its graders that passed» (справка `claude plugin eval`);
  платного run-а без переменных не было.

## 5. Переменные compaction — только в вызове этого кейса

Code: `scripts/eval-harness.mjs:333-351` · key lines: 341, 348, 349

```js
// A call of the tag `alone` has its own `env`; the others run with childEnv.
const calls = []
const named = optionValues(passThrough, '--case')
for (const tag of ['main', 'gui', 'alone']) {
  const all = selected(tag, [])
  const filtered = selected(tag, passThrough)
  let cases = chosen ? filtered.filter((name) => chosen.includes(name)) : filtered
  if (tag === 'alone') {
    for (const name of cases.filter((one) => !named.includes(one))) {
      const variables = Object.entries(ALONE[name] ?? {}).map(([key, value]) => `${key}=${value}`).join(' ')
      process.stdout.write(
        `eval:harness: ${name} is skipped: it runs only alone, in a call of its own that sets ${variables || 'its variables'}; ` +
          `run it with pnpm eval:harness -- --case ${name}\n`,
      )
    }
    cases = cases.filter((one) => named.includes(one))
    for (const name of cases) calls.push({ tag, name: `${tag}-${name}`, args: ['--case', name], cases: [name], env: { ...childEnv, ...ALONE[name] } })
    continue
  }
```

- Что делает: кейс с тегом `alone` (у кейса теперь он, а не `main`) идёт только когда `--case` называет его точно, в
  своём вызове, и только этот вызов получает `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` и
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5`. Общий запуск, glob в `--case` и `--changed` его пропускают и печатают строку, как
  его запустить. Из окружения всех остальных вызовов эти переменные убраны, даже если их задал shell.
- Почему здесь: ревью PR #1996: общий `pnpm eval:harness` и `--changed` брали кейс без переменных (compaction нет,
  ≈ 1,4 USD впустую), а с переменными compaction случилась бы в каждом кейсе тега `main`. Из двух вариантов брифа
  выбран пропуск без явного `--case` и переменные в вызове кейса: исключить один кейс из вызова тега нельзя
  (`--case` у `claude plugin eval` — один glob), поэтому без своего тега его не вынуть из вызова `main`.
- Без него: кейс тратит деньги без compaction или ломает остальные кейсы тега.
- Требование: [Что делаем, пункт 3](../issues/13-eval-compaction-state.md#что-делаем)
- Риски и пробелы test-ов: пять test-ов в `test/contract/harness-evals-run.test.ts` (describe «the case of the tag
  alone»), stub записывает обе переменные каждого вызова; три мутанта (не убирать переменные shell-а, не пропускать
  кейс, не передавать `env` вызова) валят 1, 3 и 1 из них. Что настоящий `claude plugin eval` передаёт `env` процессу
  агента, проверено только платным прогоном первого раунда, где переменные задавал shell.

## 6. Ответ по памяти

Code: `harness/evals/compaction-state/graders/from-memory.md:1-10` · key lines: 4, 5, 6

```md
---
type: tool_used
tool: Read
input_match: '01-alpha|conventions|package\.json|src/|test/|\.demo'
min: 0
max: 0
---

The answers come from what the agent knows after the compaction, not from the files: it opened no file of
the work. A run that read the ticket or the code measured the files, not the summary and the hook.
```

- Что делает: проваливает run, в котором агент открыл файл работы, а не только `PROBES.md`.
- Почему здесь: из инструментов кейса оставлен только `Read`, чтобы прочитать вопросы. Пункт `common.md` велит после
  compaction перечитать Ticket, и с ним агент может это сделать. Тогда run мерит файлы, а не summary и hook.
- Без него: такой run засчитывался бы наравне с остальными.
- Требование: [Готово, когда, пункт 3](../issues/13-eval-compaction-state.md#готово-когда)
- Риски и пробелы test-ов: `min: 0` обязателен: без него `claude plugin eval` берёт `min` 1, и grader не проходит
  никогда («expected 1..0»; найдено на stub-е).

## 7. Папка состояния Harness в test-е fixture-а

Code: `test/contract/harness-evals.test.ts:283-285` · key lines: 283, 285

```ts
      const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: work, env: harnessEnv(home), encoding: 'utf8' })
      expect(common.status, common.stderr).toBe(0)
      expect(existsSync(join(common.stdout.trim(), 'worfy-harness', 'gate', 'config.json'))).toBe(true)
```

- Что делает: ищет реестр gate fixture-а в общей папке git (git common directory), как `hooks/eval-env.cjs`. У
  обычного checkout-а это `<fixture>/.git`, как и раньше. У `compaction-state` это `.git` main checkout-а.
- Почему здесь: у linked worktree `.git` — файл, и старый путь `<fixture>/.git/worfy-harness` у него не существует.
  Правка согласована с Orchestrator-ом; то же сделано в test-е «with EVAL_HARNESS_HOME».
- Без него: test красный на новом кейсе, хотя скрипты run-а находят состояние.
- Требование: [Готово, когда, пункт 4](../issues/13-eval-compaction-state.md#готово-когда)
- Риски и пробелы test-ов: мутант (`demo-project.sh` удаляет `gate/config.json` из `.git/worfy-harness`) валит эту
  строку у всех 23 кейсов, то есть для обычного checkout-а проверка осталась прежней.

## 8. Что сознательно не меняли

- Второй вариант идёт через `HARNESS_DIR`: `scripts/eval-harness.mjs` для него не правится.
- `/compact`: у кейса один prompt за run, и после `/compact` вопросов не задать. Compaction — auto, а spike 01 показал,
  что `PreCompact` и `SessionStart` с `source: compact` в обоих случаях одни и те же.
- `coverage.json` связывает кейс с `compaction.md`, `common.md`, `hooks.json` (записи `PreCompact` и `SessionStart`
  `compact`) и `inject-rules.mjs` (его вызывает `PreCompact`). `hooks/after-compact.mjs` в карту не вошёл:
  `scripts/eval-harness-coverage.mjs` не считает его файлом правил и отвергает такую запись.

## 9. Как проверено

- `node scripts/eval-harness.mjs --case compaction-state --dry-run` — exit 0, и с `HARNESS_DIR` копии `baseline.mjs` —
  exit 0.
- `claude plugin eval` и `scripts/eval-harness.mjs` против местного stub-а Messages API, оба варианта, ни одного
  платного вызова. Auto-compaction 32,5 → 9,7 тыс. токенов, вопросы не попали в запрос на summary, hook и инструкции
  есть только в варианте «с hook-ом».
- `harness-evals.test.ts` и `harness-evals-run.test.ts` — exit 0; `pnpm lint && pnpm typecheck && pnpm test` и gate
  fast — коды выхода в отчёте implementer-а.

## Проверить себя

1. Почему папка run-а сделана linked worktree, а не обычным checkout-ом проекта demo?
   - Строки: `harness/evals/compaction-state/scaffold.sh:95-96`
   - Ответ: hook `after-compact.mjs` отдаёт Ticket и `git status` только в linked worktree на ветке Ticket-а; в main
     checkout он отдал бы `wave-brief` Orchestrator-а.
2. Что будет с кейсом, если compaction не случилась, и почему вес grader-а `compacted` — 3, а не 1?
   - Строки: `harness/evals/compaction-state/graders/compacted.md:3-13`
   - Ответ: агент ответит по полной истории, остальные восемь grader-ов могут пройти; с весом 1 run набрал бы 8 / 9 и
     кейс прошёл бы порог 0,8, с весом 3 — не больше 8 / 11, и кейс провален.
3. Почему общий `pnpm eval:harness` не запускает `compaction-state`, а не просто ставит переменные всем вызовам?
   - Строки: `scripts/eval-harness.mjs:340-349`
   - Ответ: с переменными compaction случилась бы в каждом кейсе вызова; поэтому кейс идёт только своим вызовом по
     точному `--case`, и только этот вызов получает переменные.
