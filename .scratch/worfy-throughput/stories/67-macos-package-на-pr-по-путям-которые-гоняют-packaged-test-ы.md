# Code story — worfy-throughput 67: `macos-package` на PR по путям, код которых гоняют `@packaged` test-ы

Kind: pr · Epic: worfy-throughput · Ticket: 67 · PR: - · Language: ru

## 1. Что было не так

На PR job `macos-package` (упаковка `.app` и `@packaged` test-ы) шёл только по build input-ам: зависимости, конфиги
сборки, `build/`, сами packaged test-ы. PR #1898 менял `src/main/workflow/` и ни одного build input-а, поэтому шёл без
`macos-package`. После merge `@packaged` test чипа Harness-а («Harness in main is newer than the Stable copy») упал на
push-run-е `main`, и merge-и стояли 70 минут до исправления #1912.

- Требование: [Что происходит](../issues/67-macos-package-на-pr-по-путям-которые-гоняют-packaged-test-ы.md#что-происходит)

## 2. Таблица путей, код которых проверяют только `@packaged` test-ы

Code: `scripts/ci-scope.mjs:118-123` · key lines: 120, 121

```js
export const PACKAGED_PATHS = [
  {
    paths: ['src/main/workflow/**', 'src/main/ipc/workflow.ts'],
    why: "reads the Project's main branch and fetches its origin while a window shows the Project (ADR-0107; ipc/workflow.ts wires that fetch into the hub): the @packaged test of the Harness chip opens two clones of worfy and checks that their refs stay as it set them and nothing is fetched; PR #1898 changed this folder and that test failed on main",
  },
  {
```

- Что делает: открывает таблицу `PACKAGED_PATHS` — строки `{paths, why}` в форме `MACOS_PATHS`; первая строка —
  папка `src/main/workflow/`, которую менял #1898, и `src/main/ipc/workflow.ts`, который подключает её fetch к hub-у.
  Остальные строки: чип Harness-а (`harness-drift.ts`, `ipc/autopilot.ts`, `AutopilotAction.tsx` — положение чипа в
  заголовке проверяет только `@packaged` test), копия Harness-а в `Resources/harness` и предложение Install (`harness/bundled.ts`,
  `harness/install.ts`, `ipc/harness.ts`), папка данных `worfy` (`storage/paths.ts`), загрузка renderer-а из
  `app.asar` (`window.ts`), node-pty и `@xterm/headless` из `app.asar.unpacked` (`terminal/pty.ts`,
  `terminal/cursor-answers.ts`), имена в `harness/.claude-plugin/**`.
- Почему здесь: Ticket предлагает таблицу «по образцу `scripts/e2e-specs.table.json` … или отдельным списком в
  `scripts/ci-scope.mjs`» с `why` у каждой строки; выбран список в том же файле, рядом с build input-ами, которые
  решают ту же job.
- Без него: PR, который меняет ветку кода, которую проходит только упакованная сборка (`app.isPackaged`,
  `process.resourcesPath`), шёл бы без `macos-package`, и ошибку ловил бы только push в `main`.
- Требование: [Что делаем, п. 1](../issues/67-macos-package-на-pr-по-путям-которые-гоняют-packaged-test-ы.md#что-делаем)
- Риски и пробелы test-ов: таблица составлена чтением `test/e2e/packaged.spec.ts` и `terminal.spec.ts`; test не
  проверяет, что новый `@packaged` test или новая ветка `app.isPackaged` попали в таблицу — это остаётся на авторе.

## 3. PR с путём таблицы просит `macos-package`

Code: `scripts/ci-scope.mjs:611-619` · key lines: 612, 613, 617

```js
  if (!code.some(isBuildInput)) {
    const packaged = code.find(isPackagedPath)
    if (packaged === undefined) {
      expect['macos-package'] = false
      notes.push('no build input and no packaged path, so no macos-package')
    } else {
      notes.push(`${packaged} is a packaged path, so macos-package runs`)
    }
  }
```

- Что делает: выключает `macos-package` на PR, только если в diff-е нет ни build input-а, ни пути таблицы; иначе
  оставляет job и пишет в лог job-а `changes`, какой путь её попросил.
- Почему здесь: Ticket называет `pullRequest` (`:558–568`) местом решения; push в `main` и запуск вручную эта ветка
  не трогает.
- Без него: таблица ничего бы не меняла.
- Требование: [Что делаем, п. 2](../issues/67-macos-package-на-pr-по-путям-которые-гоняют-packaged-test-ы.md#что-делаем)
- Риски и пробелы test-ов: `ci.yml` по-прежнему считается build input-ом только через `ciPackaging`; этот PR правит в
  `ci.yml` лишь комментарий, поэтому сам идёт без `macos-package`.

## 4. Test на файлы #1898, красный до правки

Code: `test/contract/ci-workflow.test.ts:1125-1135` · key lines: 1127, 1129, 1133, 1134

```ts
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect?.['macos-package']).toBe(true)
    // The first packaged path of the diff, in git's order: the file that wires the fetch into the hub.
    expect(result.stdout).toContain('src/main/ipc/workflow.ts is a packaged path, so macos-package runs')
    // One file of the table alone is enough.
    commitOnBase(['src/main/workflow/fetch.ts'])
    const fetchOnly = scope({ EVENT: 'pull_request', BASE: base })
    expect(fetchOnly.expect?.['macos-package']).toBe(true)
    expect(fetchOnly.stdout).toContain('src/main/workflow/fetch.ts is a packaged path, so macos-package runs')
  })
```

- Что делает: коммитит в тестовый репозиторий все файлы с кодом из #1898 и проверяет, что `ci-scope.mjs` просит
  `macos-package` (первым в порядке git-а его просит `src/main/ipc/workflow.ts`); затем то же для одного
  `src/main/workflow/fetch.ts`.
- Почему здесь: Ticket требует такой test в `test/contract/ci-workflow.test.ts` и его красный run на старой таблице.
- Без него: таблицу можно было бы сузить так, что #1898 снова прошёл бы без упаковки.
- Требование: [Готово, когда, п. 1](../issues/67-macos-package-на-pr-по-путям-которые-гоняют-packaged-test-ы.md#готово-когда)
- Риски и пробелы test-ов: рядом добавлены test каждой строки таблицы (путь существует, `why` есть, glob находит файл
  репозитория), список путей таблицы, записанный в test-е вручную (удалённая строка или путь краснит test), и случай
  «похожие на пути таблицы, но не они» — без `macos-package`.

## 5. PR без пути таблицы по-прежнему без `macos-package`

Code: `test/contract/ci-workflow.test.ts:1043-1047` · key lines: 1046

```ts
    ['look-alikes of names for macOS', ['src/main/machine.ts', 'src/renderer/macro/a.ts', 'src/main/stomach-darwinia.ts']],
    // Next to the paths of PACKAGED_PATHS, or named like them, but not them: the packaged tests do
    // not run their code where no other job does.
    ['look-alikes of packaged paths', ['src/main/workflows.ts', 'src/renderer/workflow/useWorkflow.ts', 'src/main/ipc/tickets.ts', 'src/renderer/canvas/actions/AutopilotActions.tsx', 'harness/claude-plugin/plugin.json', 'src/main/storage/paths-old.ts']],
  ])('a pull request that changes the app but no build input, no packaged path and no macOS path (%s) runs every job but macos-package and macos-tests', (_name, files) => {
```

- Что делает: случай `src/main/index.ts` + `src/renderer/App.tsx` остаётся без `macos-package`; добавлены соседи путей
  таблицы, которые её не задевают.
- Почему здесь: Ticket требует, чтобы PR без пути таблицы и без build input-а остался без `macos-package`.
- Без него: слишком широкий glob (например, `src/main/**`) прошёл бы незамеченным и гонял бы упаковку на каждом PR.
- Требование: [Готово, когда, п. 3](../issues/67-macos-package-на-pr-по-путям-которые-гоняют-packaged-test-ы.md#готово-когда)
- Риски и пробелы test-ов: не записано

## 6. Что сознательно не меняли

`src/main/index.ts` в таблицу не вошёл: `setBuildKind` в нём только передаёт `app.isPackaged`, а сама папка данных
упакованной сборки считается в `storage/paths.ts`, который в таблице (dev run-ы `macos-e2e` берут значение `'dev'`, не
ветку упакованной сборки); второй запуск поверх той же папки данных проходят и dev run-ы `macos-e2e`.
`src/main/vendors/claude/options.ts`
тоже не вошёл: `@packaged` test бинаря Claude Code строит путь сам и не вызывает `options.ts`. Перенос `@packaged`
test-ов в `macos-e2e` и упаковка на каждом PR — вне скоупа Ticket-а.

## 7. Как проверено

- `pnpm test test/contract/ci-workflow.test.ts -t "PR #1898"` на старом `ci-scope.mjs` — exit 1 (`expected false to
  be true`), после правки — exit 0.
- `pnpm test test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts test/unit/affected-tests.test.ts
  test/contract/auto-approve-shell-sh.test.ts test/contract/cards-watch-edits.test.ts` — exit 0.
- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0, gate fast — exit 0.
- Мутанты в своём worktree (удалить строку `storage/paths.ts`, убрать `ipc/workflow.ts` или `AutopilotAction.tsx`,
  опечатка в `window.ts`) — все краснят test.

## Проверить себя

1. Что в `src/main/workflow/` может сломать `@packaged` test чипа Harness-а, хотя сам чип живёт в другом файле?
   Ответ: Код папки читает main Project-а и делает fetch его origin, пока окно показывает Project; test же проверяет,
   что refs клонов остались такими, как он их поставил, и что fetch не было.
   Lines: `scripts/ci-scope.mjs:118-123`
2. Что решит `ci-scope.mjs` для PR, который меняет `src/main/workflow/reader.ts` и `src/renderer/App.tsx`, и что он
   напишет в лог?
   Ответ: `macos-package` идёт: build input-а нет, но `reader.ts` — путь таблицы; в логе «src/main/workflow/reader.ts
   is a packaged path, so macos-package runs».
   Lines: `scripts/ci-scope.mjs:611-619`

## 8. Что нашёл review и что осталось

> VERIFIED
>
> PR #1938, worfy-throughput 67 (macos-package also runs on a pull request whose diff touches code that only the @packaged tests check), head 8e3222206484aceea26f749ffab0ec60277feb40, rebased on origin/main 70f08556c. Review round 2 of 3. Lens: correctness of the CI job selection, the tests, and the docs.
>
> ## Round-1 items
>
> - [med] ADR-0083 amendment: FIXED. docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md:187-199 adds "Amendment 2026-11-17". It matches the code. On a PR, a path of PACKAGED_PATHS (scripts/ci-scope.mjs:118-150) runs macos-package (scripts/ci-scope.mjs:611-619). Push to main still runs every job. The contract test pins the list of paths, checks that each path exists, and checks the macos-package decision for each path. The cost figures (26 of 167 PRs instead of 11, +15 runs) match the recount in the PR body, which was done with the new rows. The amendment does not conflict with the other 2026-11-17 amendment (:179-186, the quarantine exception to the red-main rule): the topics are separate, and both entries are appended in the same form.
> - [low] src/main/ipc/workflow.ts: FIXED. It is in row 1 (scripts/ci-scope.mjs:120). The look-alike list replaces it with src/main/ipc/tickets.ts (test/contract/ci-workflow.test.ts:1046).
> - [low] AutopilotAction.tsx: FIXED. It is in the chip row (scripts/ci-scope.mjs:124). The reason holds. The chip renders only when harnessBehind is set (src/renderer/canvas/actions/AutopilotAction.tsx:763,840). harnessBehind is set only when harnessDriftWatch runs with packaged true (src/main/autopilot/harness-drift.ts:177; src/main/ipc/autopilot.ts:217). Only test/e2e/packaged.spec.ts:778-840 checks the chip in a running app.
> - [low] Dropping a row passed the suite: FIXED. PACKAGED_EXPECTED (test/contract/ci-workflow.test.ts:1139-1156) is written by hand. Mutants that drop a row or a path now fail the test (see below).
> - [low] setBuildKind in story section 6 and the PR body: FIXED. Both now say that setBuildKind only passes app.isPackaged on, that the data folder is computed in storage/paths.ts, and that dev runs take 'dev' (src/main/index.ts:64).
>
> ## Rebase, glob width
>
> - The range-diff from 70f08556c shows the two round-1 commits unchanged ("="), plus the two rework commits. The rebase caused no regression.
> - No row widens selection to unrelated code. Every row except two names exact files. The two globs are src/main/workflow/** and harness/.claude-plugin/**. The look-alike case (:1046) checks neighbouring files that must not match: src/main/workflows.ts, src/renderer/workflow/, AutopilotActions.tsx, harness/claude-plugin/ and paths-old.ts.
>
> ## New findings
>
> None.
>
> ## Left as is (low)
>
> None.
>
> ## Checks (exit codes)
>
> - In the worktree: `set -o pipefail; pnpm test test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts test/unit/affected-tests.test.ts` exit 0 (413 passed, 3 skipped). `pnpm lint` exit 0. `pnpm typecheck` exit 0.
> - `story-check --repo <worktree> --head 8e3222206 <story 67>` exit 0 (4 fragments ok).
> - `gh pr checks 1938` exit 0. Run 43991815819 is a pull_request run on head 8e3222206 and concluded success; ci-ok passed. macos-package and macos-e2e were skipped, which is correct: the PR changes only a comment in ci.yml.
> - Evidence commit 107e82c81 is an ancestor of the head (exit 0).
>
> ## Mutants
>
> Done in a /tmp clone of the head (/tmp/rev1938r2-*, now removed), running `node scripts/vitest-electron.mjs test/contract/ci-workflow.test.ts`. Baseline exit 0.
>
> - drop the storage/paths.ts row: killed (it survived in round 1)
> - drop the window.ts row: killed
> - drop AutopilotAction.tsx from its row: killed
> - drop src/main/ipc/workflow.ts from its row: killed
> - isPackagedPath always returns false: killed
> - widen src/main/workflow/** to src/main/**: killed (by the look-alike cases)

Code: `docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md:187-199` · key lines: 187

```md
- **Amendment 2026-11-17, `macos-package` на PR — ещё и по путям, код которых гоняют только `@packaged` test-ы**
  (`worfy-throughput` 67, решение владельца 2026-11-17). Amendment 2026-10-28 («macOS job-ы PR — по путям diff»)
  оставлял `macos-package` на PR «как раньше, по входам сборки». Теперь PR просит его и тогда, когда diff трогает путь
  таблицы `PACKAGED_PATHS` в `scripts/ci-scope.mjs`: код приложения, ветку упакованной сборки которого (`app.isPackaged`,
  `process.resourcesPath`, `app.asar.unpacked`) проходят только `@packaged` test-ы, — `src/main/workflow/`, чип
  Harness-а на действии Autopilot, копия Harness-а в `.app`, папка данных, окно, node-pty из `app.asar.unpacked`,
  `harness/.claude-plugin/`. У каждой строки — причина (`why`); contract test в `test/contract/ci-workflow.test.ts`
  держит список путей таблицы, существование каждого пути и решение `macos-package` для каждого. Push в `main` по-прежнему
  гоняет все job-ы. Причина: PR #1898 менял `src/main/workflow/` без входа сборки и шёл без `macos-package`; после merge
  `@packaged` test чипа Harness-а упал на push-run-е `main`, merge-и стояли 70 min до исправления #1912. Цена (окно
  2026-11-09…16, 167 PR с кодом): `macos-package` шёл бы на 26 PR вместо 11 (16 % вместо 7 %), +15 run-ов по ~5 min
  (медиана 22 push-run-ов) — около 75 macOS-минут за 8 дней, ~9 min в день, считая один run на PR. Runner-ы
  бесплатные (репозиторий публичный); цена — место в очереди из 5 одновременных macOS job-ов.
```

Code: `scripts/ci-scope.mjs:118-150` · key lines: 118

```mjs
export const PACKAGED_PATHS = [
  {
    paths: ['src/main/workflow/**', 'src/main/ipc/workflow.ts'],
    why: "reads the Project's main branch and fetches its origin while a window shows the Project (ADR-0107; ipc/workflow.ts wires that fetch into the hub): the @packaged test of the Harness chip opens two clones of worfy and checks that their refs stay as it set them and nothing is fetched; PR #1898 changed this folder and that test failed on main",
  },
  {
    paths: ['src/main/autopilot/harness-drift.ts', 'src/main/ipc/autopilot.ts', 'src/renderer/canvas/actions/AutopilotAction.tsx'],
    why: 'the chip "Harness in main is newer than the Stable copy" on the Autopilot action: only a packaged build compares its Harness with origin/main (harnessDriftWatch with packaged true, wired in ipc/autopilot.ts), so only the @packaged test renders the chip and checks that it stays inside the header and covers none of its buttons',
  },
  {
    paths: ['src/main/harness/bundled.ts', 'src/main/harness/install.ts', 'src/main/ipc/harness.ts'],
    why: 'the Harness copy of a packaged build in Resources/harness, its version, and the Install a packaged build alone offers (installOffered): the @packaged test of the Harness copy reads "Harness not installed" and Install',
  },
  {
    paths: ['src/main/storage/paths.ts'],
    why: 'the data folder of a packaged build, worfy, apart from worfy-dev of a dev run: the @packaged test of the data folder',
  },
  {
    paths: ['src/main/window.ts'],
    why: 'a packaged build loads out/renderer/index.html from app.asar and ignores ELECTRON_RENDERER_URL: the @packaged test of that variable',
  },
  {
    paths: ['src/main/terminal/pty.ts', 'src/main/terminal/cursor-answers.ts'],
    why: 'node-pty and @xterm/headless out of app.asar.unpacked in a packaged build: the @packaged test of the Terminal in terminal.spec.ts',
  },
  {
    paths: ['harness/.claude-plugin/**'],
    why: 'plugin.json named worfy and marketplace.json named worfy-harness, which the @packaged test of the Harness copy reads from the packaged build',
  },
]

/** A path of the app whose code only the @packaged tests run on a pull request (PACKAGED_PATHS). */
export const isPackagedPath = (path) => PACKAGED_PATHS.some((row) => row.paths.some((glob) => globRegExp(glob).test(path)))
```

Code: `scripts/ci-scope.mjs:611-619` · key lines: 611

```mjs
  if (!code.some(isBuildInput)) {
    const packaged = code.find(isPackagedPath)
    if (packaged === undefined) {
      expect['macos-package'] = false
      notes.push('no build input and no packaged path, so no macos-package')
    } else {
      notes.push(`${packaged} is a packaged path, so macos-package runs`)
    }
  }
```

Code: `scripts/ci-scope.mjs:120-120` · key lines: 120

```mjs
    paths: ['src/main/workflow/**', 'src/main/ipc/workflow.ts'],
```

Code: `test/contract/ci-workflow.test.ts:1046-1046` · key lines: 1046

```ts
    ['look-alikes of packaged paths', ['src/main/workflows.ts', 'src/renderer/workflow/useWorkflow.ts', 'src/main/ipc/tickets.ts', 'src/renderer/canvas/actions/AutopilotActions.tsx', 'harness/claude-plugin/plugin.json', 'src/main/storage/paths-old.ts']],
```
