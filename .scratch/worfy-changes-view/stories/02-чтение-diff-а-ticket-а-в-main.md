# Code story — worfy-changes-view 02: Чтение diff-а Ticket-а в main: только чтение git, база, scope-ы, каналы `changes.*`, новый ADR

Kind: pr · Epic: worfy-changes-view · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

В main не было ни одного вызова `git diff`: экрану Changes нечего было показать. Читать diff нужно рядом с агентом,
который в ту же секунду делает `git commit` в том же worktree, поэтому чтение не должно писать в `.git` ничего —
ни index, ни ref, ни object, ни lock-файл. `gitRunner` стадий держит timeout 10 s и буфер 8 MB, для целого patch-а
этого мало.

- Требование: [Что происходит](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-происходит)

## 2. Каждый запуск git — без записи

Code: `src/main/changes/git.ts:63-67` · key lines: 64, 67

```ts
/** `-c` settings of every run (see the top of the file). */
export const READ_CONFIG = ['-c', 'core.quotePath=false', '-c', 'diff.autoRefreshIndex=false', '-c', 'core.fsmonitor=false'] as const

/** The environment of every run on top of main's own. */
export const READ_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } as const
```

- Что делает: добавляет к каждому запуску git настройки и окружение, при которых чтение не пишет в репозиторий:
  `diff.autoRefreshIndex=false`, `core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, и
  `core.quotePath=false` для путей не-ASCII.
- Почему здесь: Ticket называет новый файл `src/main/changes/git.ts` — свой запуск git. `diff.autoRefreshIndex=false`
  в Ticket-е нет: опыт на git 2.50 показал, что `GIT_OPTIONAL_LOCKS=0 git diff HEAD` всё равно переписывает
  `.git/index`, когда у файла сменился stat при том же тексте (ADR-0110, пункт 2).
- Без него: без `diff.autoRefreshIndex=false` contract test «wrote nothing into the repository» красный — проверено,
  убрав настройку: index worktree-а меняется после чтения.
- Требование: [Что делаем, п. 1](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: на Windows проверка идёт только в CI (job windows); локально её не запускали.

## 3. Список команд и отказ до запуска

Code: `src/main/changes/git.ts:72-92` · key lines: 74, 78, 81

```ts
/** Why `args` are refused, or null when they only read. Only the part before `--` is options; paths after it are not looked at. */
export function refusal(args: readonly string[]): string | null {
  const [command, ...rest] = args
  if (command === undefined || !(READ_COMMANDS as readonly string[]).includes(command)) return `git ${command ?? ''} is not a reading command of Changes`
  const end = rest.indexOf('--')
  const options = end === -1 ? rest : rest.slice(0, end)
  if (options.some((arg) => arg.startsWith('--output') || arg === '-o')) return `git ${command} with --output writes a file`
  switch (command) {
    case 'hash-object':
      if (options.some((arg) => arg === '-w' || arg === '--write' || /^-[^-]*w/u.test(arg))) return 'git hash-object -w writes an object'
      return null
    case 'cat-file':
      return options[0] === '-e' || options[0] === '-s' ? null : 'git cat-file is run only with -e or -s'
    case 'ls-files':
      return options.includes('--others') && options.includes('--exclude-standard') ? null : 'git ls-files is run only with --others --exclude-standard'
    case 'worktree':
      return options[0] === 'list' ? null : 'git worktree is run only as worktree list'
    default:
      return null
  }
}
```

- Что делает: пропускает только команды из `READ_COMMANDS`; отказывает `--output` у любой команды, `hash-object -w`,
  `cat-file` без `-e`/`-s`, `ls-files` без `--others --exclude-standard`, `worktree` кроме `list`. Пути после `--` не
  разбираются: файл с именем `--output=x` не мешает.
- Почему здесь: список команд — Ticket, «Что делаем», п. 1. Три лишние команды (`check-attr`, `rev-parse`,
  `worktree list`) добавлены implementer-ом: атрибут `linguist-generated` и поиск worktree-а Ticket-а через reader
  workflow без них не прочитать; они только читают (ADR-0110, пункт 1).
- Без него: новая команда, которая пишет, прошла бы без ревью ADR.
- Требование: [Что делаем, п. 1](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: отказ проверен contract test-ом на `add`, `fetch`, `stash`, `update-index`, `hash-object -w`,
  `--output`; другие формы записи у разрешённых команд не перебирались.

## 4. Список файлов — по numstat

Code: `src/shared/changes/parse.ts:212-231` · key lines: 215

```ts
export function parseDiffList(output: string): ListedFile[] {
  const { raw, numstat } = readList(splitZ(output))
  const byPath = new Map(raw.map((entry) => [entry.path, entry]))
  return numstat.map((entry): ListedFile => {
    const facts = byPath.get(entry.path)
    const binary = entry.additions === null && entry.deletions === null
    return {
      path: entry.path,
      oldPath: facts?.oldPath ?? entry.oldPath,
      status: facts?.status ?? (entry.oldPath !== null ? 'R' : 'M'),
      additions: entry.additions,
      deletions: entry.deletions,
      binary,
      oldMode: facts?.oldMode ?? null,
      newMode: facts?.newMode ?? null,
      oldBlob: facts?.oldBlob ?? null,
      newBlob: facts?.newBlob ?? null,
    }
  })
}
```

- Что делает: собирает список файлов из `diff --raw --numstat -z`: numstat задаёт, какие файлы в списке и их `+/−`,
  raw добавляет статус, режимы и blob id сторон.
- Почему здесь: с `diff.autoRefreshIndex=false` raw называет и файлы, у которых сменился только stat; numstat их не
  называет. Модуль разбора — `src/shared/changes/parse.ts` по Ticket-у.
- Без него: файл, который агент только «потрогал», стоял бы в списке как изменённый без строк.
- Требование: [Что делаем, п. 5](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: смена режима без смены текста держится на том, что numstat даёт ей `0 0`; проверено contract
  test-ом на macOS (`run.sh`), на Windows — в CI.

## 5. База в порядке preflight

Code: `src/main/changes/base.ts:55-76` · key lines: 64, 65, 74

```ts
export async function pickBase(facts: BaseFacts, probe: RefProbe): Promise<PickedBase | null> {
  const local = async (): Promise<PickedBase | null> => {
    const names = [blank(facts.mainBranch) ? null : localName(facts.mainBranch), blank(facts.defaultBranch) ? null : localName(facts.defaultBranch), 'main', 'master']
    for (const name of new Set(names)) {
      if (name !== null && name !== '' && (await probe.exists(`refs/heads/${name}`))) return { ref: name, from: 'local' }
    }
    return null
  }
  const origin = await probe.hasOrigin()
  if (!origin && facts.finish === 'local-green') return local()
  if (!blank(facts.mainBranch) && (await probe.exists(facts.mainBranch.trim()))) return { ref: facts.mainBranch.trim(), from: 'worktree.base' }
  if (origin) {
    if (!blank(facts.defaultBranch)) {
      const ref = `origin/${localName(facts.defaultBranch)}`
      if (await probe.exists(ref)) return { ref, from: 'default_branch' }
    }
    const head = await probe.originHead()
    if (head !== null && (await probe.exists(head))) return { ref: head, from: 'origin/HEAD' }
    if (await probe.exists('origin/main')) return { ref: 'origin/main', from: 'origin/main' }
  }
  return local()
}
```

- Что делает: выбирает базу: `worktree.base`, если такая ветка есть; иначе `origin/<default_branch>`, `origin/HEAD`,
  `origin/main`; без `origin` и с `local-green` — локальная ветка. Последний запасной шаг — локальные `main`/`master`
  в любом Project-е.
- Почему здесь: порядок — `harness/profiles/README.md`, строка `worktree.base`, как требует Ticket (п. 3). Последний
  запасной шаг добавлен implementer-ом: репозиторий без `origin` с `pr-green-ci` иначе остался бы без базы.
- Без него: Changes считал бы от другой ветки, чем preflight, и показывал бы чужие commit-ы main.
- Требование: [Что делаем, п. 3](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: `default_branch` репозитория main пока не передаёт — `ResolvedRepo` его не несёт; шаг
  проверен только unit test-ом.

## 6. Проверка, что ничего не записано

Code: `test/contract/changes-read.test.ts:270-285` · key lines: 278, 279, 284

```ts
  it('wrote nothing into the repository: the index, its bytes and mtime, refs, objects and locks are as before', async () => {
    // Every read once more, with Hide whitespace too, then the comparison.
    for (const scope of [{ kind: 'all' }, { kind: 'uncommitted' }, { kind: 'commit', repo: 'repo', sha: firstOnBranch }, { kind: 'compare', repo: 'repo', ref: 'other' }]) {
      await call(changesList, { projectId: 'p', ticket, scope, hideWhitespace: true })
      await call(changesFile, { projectId: 'p', ticket, repo: 'repo', scope, path: 'a.txt', whole: true })
    }
    await call(changesScopes, { projectId: 'p', ticket })
    const after = snapshot(join(repo, '.git'))
    expect(after.indexes).toEqual(before.indexes)
    expect(after.files).toEqual(before.files)
    expect(Object.keys(before.indexes).sort()).toEqual(['index', 'worktrees/02/index'])

    // The check sees a write: a plain git diff in the worktree refreshes the stat data and writes its index.
    execFileSync('git', ['diff'], { cwd: tree, env: { ...process.env, ...NO_GIT_MAINTENANCE, GIT_OPTIONAL_LOCKS: '0', HOME: root, USERPROFILE: root, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'ignore' })
    expect(snapshot(join(repo, '.git')).indexes['worktrees/02/index']).not.toBe(before.indexes['worktrees/02/index'])
  })
```

- Что делает: после всех scope-ов сравнивает каждый файл `.git` (размер, mtime) и байты обоих index с тем, что было до
  чтений; затем запускает простой `git diff` и показывает, что тот index worktree-а переписывает.
- Почему здесь: Ticket, «Готово, когда»: «после всех чтений байты и mtime `.git/index` прежние, новых refs и объектов
  нет». Вторая половина — чтобы проверка не была зелёной оттого, что запись просто не случилась.
- Без него: регресс в настройках запуска прошёл бы незамеченным до первого упавшего commit-а агента.
- Требование: [Готово, когда](../issues/02-чтение-diff-а-ticket-а-в-main.md#готово-когда)
- Риски и пробелы test-ов: проверяется один репозиторий с одним worktree; `git worktree list` и `for-each-ref` в
  репозитории с packed-refs не проверялись отдельно.

## 7. Что сознательно не меняли

Renderer, кнопка Changes и Command palette — Ticket 03. `profile.ts` не трогали: `default_branch` в main не
передаётся, база берёт `origin/HEAD` и `origin/main`. Канал `changes.targets` — Ticket 05. Перевод страницы — Ticket 06.

## 8. Как проверено

Сначала test, потом проверка: `test/unit/changes-parse.test.ts` красный, если убрать разбор CRLF; contract test
«wrote nothing» красный, если убрать `diff.autoRefreshIndex=false`. Затем `pnpm lint`, `pnpm typecheck`, `pnpm test` и
gate fast — с кодом выхода в отчёте implementer-а.

## Проверить себя

1. Почему недостаточно `GIT_OPTIONAL_LOCKS=0`, чтобы чтение не писало index?
   - Ответ: `git diff` против рабочего дерева сам обновляет stat в index (`diff.autoRefreshIndex`), и эта запись не
     «необязательный lock»; её выключает только `diff.autoRefreshIndex=false`.
   - Lines: `src/main/changes/git.ts:64`
2. Почему список файлов строится по numstat, а не по raw?
   - Ответ: с выключенным refresh raw называет и файлы со сменённым stat при том же тексте; numstat их не называет.
   - Lines: `src/shared/changes/parse.ts:215`
3. Как test доказывает, что он вообще увидел бы запись?
   - Ответ: после сравнения он запускает простой `git diff` в том же worktree и ждёт, что index изменится.
   - Lines: `test/contract/changes-read.test.ts:284`
