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
