# Code story — worfy-changes-view 02: Чтение diff-а Ticket-а в main: только чтение git, база, scope-ы, каналы `changes.*`, новый ADR

Kind: pr · Epic: worfy-changes-view · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

В main не было ни одного вызова `git diff`: экрану Changes нечего было показать. Читать diff нужно рядом с агентом,
который в ту же секунду делает `git commit` в том же worktree, поэтому чтение не должно писать в `.git` ничего —
ни index, ни ref, ни object, ни lock-файл. `gitRunner` стадий держит timeout 10 s и буфер 8 MB, для целого patch-а
этого мало.

- Требование: [Что происходит](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-происходит)

## 2. Каждый запуск git — без записи

Code: `src/main/changes/git.ts:73-77` · key lines: 74, 77

```ts
/** `-c` settings of every run (see the top of the file). */
export const READ_CONFIG = ['-c', 'core.quotePath=false', '-c', 'diff.autoRefreshIndex=false', '-c', 'core.fsmonitor=false'] as const

/** The environment of every run on top of main's own. */
export const READ_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' } as const
```

- Что делает: добавляет к каждому запуску git настройки и окружение, при которых чтение не пишет в репозиторий:
  `diff.autoRefreshIndex=false`, `core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`,
  `GIT_LITERAL_PATHSPECS=1` (путь после `--` — путь, не шаблон), и `core.quotePath=false` для путей не-ASCII.
- Почему здесь: Ticket называет новый файл `src/main/changes/git.ts` — свой запуск git. `diff.autoRefreshIndex=false`
  в Ticket-е нет: опыт на git 2.50 показал, что `GIT_OPTIONAL_LOCKS=0 git diff HEAD` всё равно переписывает
  `.git/index`, когда у файла сменился stat при том же тексте (ADR-0110, пункт 2). `GIT_LITERAL_PATHSPECS=1` добавлен
  во втором раунде по замечанию verifier-а.
- Без него: без `diff.autoRefreshIndex=false` contract test «wrote nothing into the repository» красный — проверено,
  убрав настройку: index worktree-а меняется после чтения. Без любой другой настройки или переменной красный unit test
  `test/unit/changes-git.test.ts` (точный список аргументов и окружения), проверено мутантами.
- Требование: [Что делаем, п. 1](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: на Windows проверка идёт только в CI (job windows); локально её не запускали. Clean filter
  из `.gitattributes` у `git diff` против рабочего дерева выключить нечем — это записано в ADR-0110, пункт 2.

## 3. Список команд, одна форма и отказ до запуска процесса

Code: `src/main/changes/git.ts:84-95` · key lines: 86, 90, 91, 92

```ts
/** Why `args` are refused, or null when they only read. Only the part before `--` is options; paths after it are not looked at. */
export function refusal(args: readonly string[]): string | null {
  const [command, ...rest] = args
  if (command === undefined || !(READ_COMMANDS as readonly string[]).includes(command)) return `git ${command ?? ''} is not a reading command of Changes`
  const end = rest.indexOf('--')
  const options = end === -1 ? rest : rest.slice(0, end)
  if (options.some((arg) => arg.startsWith('--output') || arg === '-o')) return `git ${command} with --output writes a file`
  const exact = EXACT_FORMS[command]
  if (exact !== undefined) return sameArgs(rest, exact) ? null : `git ${command} is run only as git ${command} ${exact.join(' ')}${command === 'hash-object' ? ' (never -w)' : ''}`
  if (command === 'cat-file') return rest.length === 2 && (rest[0] === '-e' || rest[0] === '-s') && !rest[1]!.startsWith('-') ? null : 'git cat-file is run only as cat-file -e <object> or cat-file -s <object>'
  return null
}
```

- Что делает: пропускает только команды из `READ_COMMANDS`; отказывает `--output` и `-o` у любой команды;
  `ls-files`, `hash-object` и `worktree` проходят только в одной форме из `EXACT_FORMS` (`worktree list --porcelain`,
  `hash-object --no-filters --stdin-paths`), `cat-file` — только `-e`/`-s` одного объекта. Отказ возвращается до
  запуска процесса: runner выходит сразу после ответа с отказом.
- Почему здесь: список команд — Ticket, «Что делаем», п. 1. Три лишние команды (`check-attr`, `rev-parse`,
  `worktree list`) добавлены implementer-ом: атрибут `linguist-generated` и поиск worktree-а Ticket-а через reader
  workflow без них не прочитать (ADR-0110, пункт 1). Одна форма вместо «любой, кроме пишущих» — замечание ревью второго
  раунда: `worktree add`/`remove`/`prune` проходили.
- Без него: новая форма команды, которая пишет (`worktree prune`, `hash-object -w`), прошла бы без ревью ADR.
- Требование: [Что делаем, п. 1](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: unit test подменяет запуск процесса и считает запуски: отвергнутая команда не запускает
  ни одного. `rev-parse`, `diff`, `log`, `show`, `check-attr` остаются с любыми опциями, кроме `--output`.

## 4. Список файлов — по numstat

Code: `src/shared/changes/parse.ts:229-248` · key lines: 232

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

## 6. Путь — только из репозитория, новый файл — только из списка git

Code: `src/main/changes/scopes.ts:284-296` · key lines: 287, 294

```ts
export async function fileDiff(context: ChangesContext, scope: ChangesScope, target: FileTarget, options: FileOptions = {}): Promise<FileDiff> {
  const { subject, git } = context
  // A path outside the repository is never read, whatever the caller sent (the channel's schema refuses it too).
  for (const path of [target.path, target.oldPath]) if (path !== null && path !== undefined && !isRepoPath(path)) throw new Error(`${path} is not a path inside ${subject.repo}`)
  const range = await rangeOf(context, scope)
  const untracked = target.untracked === true && range.kind === 'diff' && range.untracked
  const paths = target.oldPath && target.oldPath !== target.path ? [target.oldPath, target.path] : [target.path]
  let listed: ListedFile | undefined
  if (untracked) {
    // `diff --no-index` reads any file it is given: only a new file git itself lists is one of this scope.
    if (!(await untrackedPaths(context)).includes(target.path)) throw new Error(`${target.path} is not a new file of ${subject.repo}`)
    const counts = await untrackedCounts(context, target.path, options)
    listed = { path: target.path, oldPath: null, status: 'A', ...counts, binary: counts.additions === null && counts.deletions === null, oldMode: null, newMode: null, oldBlob: null, newBlob: null }
```

- Что делает: отказывает пути, который не может быть путём от верхней папки репозитория (абсолютный, с частью `..`,
  isRepoPath из `src/shared/changes/parse.ts`); новый файл (`untracked: true`) читает через `diff --no-index`, только
  если `ls-files --others --exclude-standard` этого репозитория его называет. Схема канала `changes.file` отвергает
  такие пути ещё до handler-а.
- Почему здесь: `diff --no-index` читает любой файл, который ему дали, а канал — `'project', 'read'`, его зовёт и
  Linked machine с доступом Read only (ADR-0110, пункт 4). Замечание ревью второго раунда: `/etc/hosts` и
  `../../secret.txt` возвращались hunk-ами.
- Без него: contract test «reads a new file only when git lists it as one» красный — игнорируемый `debug.log` и путь
  вне репозитория читаются; проверено мутантами (проверка в reader-е, в схеме для `path` и для `oldPath`).
- Требование: [Что делаем, п. 6](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: между `ls-files` и `diff --no-index` файл может смениться; ссылку `diff --no-index` читает
  как ссылку (её текст), а FIFO на этом месте задержал бы git до timeout 60 s — так может сделать только тот, кто уже
  пишет в worktree. Это не проверено test-ом.

## 7. Смена типа — обе половины

Code: `src/shared/changes/parse.ts:391-406` · key lines: 392, 393, 403

```ts
export function patchOfPath(patches: readonly FilePatch[], path: string): FilePatch | undefined {
  const own = patches.filter((each) => each.newPath === path || (each.newPath === null && each.oldPath === path))
  if (own.length < 2) return own[0]
  const deletion = own.find((each) => each.newPath === null)
  const addition = own.find((each) => each.oldPath === null && each.newPath === path)
  return {
    oldPath: deletion?.oldPath ?? own[0]!.oldPath,
    newPath: path,
    oldMode: deletion?.oldMode ?? own[0]!.oldMode,
    newMode: addition?.newMode ?? own.at(-1)!.newMode,
    renamed: false,
    binary: own.some((each) => each.binary),
    hunks: own.flatMap((each) => each.hunks),
  }
}

```

- Что делает: git печатает смену типа (файл стал ссылкой или обратно, статус T) как два patch-а одного пути —
  удаление и добавление; функция склеивает их в один: строки удаления, затем добавления, старый режим одного и новый
  другого.
- Почему здесь: прежний поиск брал первый patch пути — удаление; список показывал `+1 −2`, экран — только «−»
  (замечание ревью второго раунда). Разбор — в `src/shared/changes/parse.ts` по Ticket-у.
- Без него: unit test-ы смены типа в обе стороны и contract test «a type change shows both halves» красные.
- Требование: [Что делаем, п. 5](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: contract test смены типа на Windows пропущен — ссылку там создать без привилегии нельзя;
  разбор проверяет unit test на всех ОС.

## 8. Проверка, что ничего не записано

Code: `test/contract/changes-read.test.ts:274-289` · key lines: 282, 283, 288

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

## 9. Путь worktree-а — в форме своей ОС

Code: `src/main/changes/subjects.ts:53-55` · key lines: 54

```ts
export function nativePath(path: string, platform: NodeJS.Platform = process.platform): string {
  return (platform === 'win32' ? win32 : posix).normalize(path)
}
```

- Что делает: приводит путь worktree-а из `git worktree list --porcelain` к форме ОС; `cwd` субъекта-worktree-а
  берётся через неё (`src/main/changes/subjects.ts:74`). Git for Windows печатает `worktree D:/a/b`, а checkout в
  Profile-е — `D:\a\b`; после `normalize` у одной папки одно написание, откуда бы путь ни пришёл.
- Почему здесь: Ticket называет `src/main/changes/subjects.ts` среди своих файлов. Повод — красный contract test
  «takes the checkout on the Ticket's branch as its worktree» на Windows runner-е CI: `cwd` пришёл как
  `D:/a/_temp/…/edge`, checkout — `D:\a\_temp\…\edge`. Git принимает оба написания как `cwd`, поэтому чтение работало;
  но `cwd` и `checkout` одного субъекта расходились, и любое сравнение путей строкой (с checkout-ом, с cwd Session)
  ошибалось бы на Windows. Нормализация в коде, а не в test-е, оставляет test строгим.
- Без него: на Windows `cwd` worktree-а — путь со `/`, а `checkout` — с `\`; contract test на Windows runner-е красный,
  и красны test-ы «the path of a worktree as git prints it» на любой ОС (проверено мутантами: `cwd: worktree.path` и
  `nativePath`, возвращающий путь как есть).
- Требование: [Готово, когда](../issues/02-чтение-diff-а-ticket-а-в-main.md#готово-когда)
- Риски и пробелы test-ов: форма Windows проверяется на macOS через `path.win32` и git-stand-in, который печатает
  список worktree-ов; настоящий git for Windows — только в CI (job windows). `normalize` не меняет регистр буквы диска
  и не раскрывает короткие имена 8.3: если git и Profile напишут их по-разному, пути всё равно разойдутся.

## 10. Правила пути Windows — только на Windows

Code: `src/shared/changes/parse.ts:80-85` · key lines: 81, 83, 84

```ts
export function isRepoPath(path: string, platform: string = hostPlatform()): boolean {
  if (path === '' || path.includes('\0') || path.startsWith('/')) return false
  const windows = platform === 'win32'
  if (windows && (path.startsWith('\\') || /^[A-Za-z]:/u.test(path))) return false
  return !path.split(windows ? /[\\/]/u : /\//u).includes('..')
}
```

- Что делает: `/`, NUL и часть `..` отвергаются на любой ОС; буква диска (`C:x`), путь с `\` в начале и `\` как
  разделитель частей — только при `platform === 'win32'`. По умолчанию `platform` — `process.platform` main-а: схема
  канала `changes.file` разбирает ввод в main (`src/main/ipc/index.ts`), а Linked machine передаёт ввод дальше как
  есть, так что путь проверяет main того Machine-а, чей это репозиторий.
- Почему здесь: замечание ревью второго раунда (средней важности): прежнее правило отвергало настоящие файлы
  репозитория на macOS и Linux — `c:notes.md` и `x:new.txt` по букве диска, `back\..\slash.txt` по части `..` между
  `\`. Такой файл не открывался ни как отслеживаемый, ни как новый. Ticket называет `src/shared/changes/parse.ts`
  среди своих файлов.
- Без него: красны contract test «file names that are absolute or split only on Windows, on macOS and Linux» (открыть
  `:lead.txt`, `back\..\slash.txt`, `c:notes.md`, `x:new.txt` через `changes.file`) и unit test-ы правил по платформам
  в `test/unit/changes-parse.test.ts`. Проверено мутантами: правило буквы диска и `\` на всех ОС — exit code 1,
  4 красных test-а; разбиение по `\` на всех ОС — exit code 1, 1 красный; `platform` не учитывается вовсе — exit code 1,
  2 красных.
- Требование: [Что делаем, п. 6](../issues/02-чтение-diff-а-ticket-а-в-main.md#что-делаем)
- Риски и пробелы test-ов: contract test с такими именами пропущен на Windows — там их не создать. В renderer-е нет
  `process`, и там правило было бы POSIX-ным, но renderer эту схему не разбирает: ввод разбирает только main.

## 11. Что сознательно не меняли

Renderer, кнопка Changes и Command palette — Ticket 03. `profile.ts` не трогали: `default_branch` в main не
передаётся, база берёт `origin/HEAD` и `origin/main`. Канал `changes.targets` — Ticket 05. Перевод страницы — Ticket 06.

## 12. Как проверено

Сначала test, потом проверка: `test/unit/changes-parse.test.ts` красный, если убрать разбор CRLF; contract test
«wrote nothing» красный, если убрать `diff.autoRefreshIndex=false`. Затем `pnpm lint`, `pnpm typecheck`, `pnpm test` и
gate fast — с кодом выхода в отчёте implementer-а. Во втором раунде каждое новое поведение проверено мутантом в своём
worktree: 44 мутанта (runner, отказ, окружение, пределы 1 MB и 64 MB, staged-файл, Hide whitespace, merge-commit,
смена типа, пути, `--no-filters`, probe базы, строки `Repo:`, ветка в самом checkout-е, Commit и Compare только своего
репозитория) — все убиты. В третьем раунде (красный CI на Windows) — 2 мутанта `nativePath`, оба убиты. В четвёртом
(правила пути Windows) — 3 мутанта `isRepoPath`, все убиты (exit code 1 у каждого).

## Проверить себя

1. Почему недостаточно `GIT_OPTIONAL_LOCKS=0`, чтобы чтение не писало index?
   - Ответ: `git diff` против рабочего дерева сам обновляет stat в index (`diff.autoRefreshIndex`), и эта запись не
     «необязательный lock»; её выключает только `diff.autoRefreshIndex=false`.
   - Lines: `src/main/changes/git.ts:74`
2. Почему список файлов строится по numstat, а не по raw?
   - Ответ: с выключенным refresh raw называет и файлы со сменённым stat при том же тексте; numstat их не называет.
   - Lines: `src/shared/changes/parse.ts:232`
3. Как test доказывает, что он вообще увидел бы запись?
   - Ответ: после сравнения он запускает простой `git diff` в том же worktree и ждёт, что index изменится.
   - Lines: `test/contract/changes-read.test.ts:288`
4. Почему новый файл сверяется со списком `ls-files`, если путь уже проверен на `..` и абсолютность?
   - Ответ: путь внутри репозитория ещё не значит «новый файл scope-а»: игнорируемый файл (`debug.log`) лежит в
     репозитории, и `diff --no-index` прочёл бы его; только список git говорит, что файл — новый и не игнорируется.
   - Lines: `src/main/changes/scopes.ts:294`

## 13. Что нашёл review и что осталось

> VERIFIED
> Act on: none. Round 3 (narrow, the one med of round 2): src/shared/changes/parse.ts:71-85 — `isRepoPath(path, platform)` refuses a leading `/`, NUL and a `..` part everywhere, and a drive letter, a leading `\` and `\` as a separator only on win32; the `changes.file` schema calls it with main's platform (src/shared/ipc/changes.ts:19), and only main parses that schema. The contract test opens `:lead.txt`, `back\..\slash.txt`, `c:notes.md` and `x:new.txt` on POSIX (test/contract/changes-read.test.ts:578-612); the unit tests refuse `C:x`, `\x`, `a\..\b` with 'win32' (test/unit/changes-parse.test.ts:249-270). Three mutants (Windows rule on every OS, `\` split on every OS, platform ignored) each turn tests red. ci-ok green on 6f45641f0 (run 44562808956), Windows full-suite included.
> Round 1 items: all fixed (round 2 verifier). Round 2 item: fixed.
> Consider: [low] src/main/changes/subjects.ts:62, :66 — `.catch(() => [])` still turns a missing git or a broken .git into `repos: []` without the reason (round 1, not closed); [low] a clean filter still runs on `diff` against the work tree (hash-object got --no-filters); [low] rev-parse, diff, log, show and check-attr have no exact allowed form in git.ts.
> Noted: the contract test of `:`/`\` names is skipped on Windows (such names cannot be created there; the win32 rule is unit-tested); if the renderer ever parses the `changes.file` schema, the rule there is POSIX (no `process`); src/main/workflow/reader.ts:573 gives a worktree path as git prints it (`/` on Windows) to its other readers — not this ticket's files.
> Dismissed: none.
> Review depth: high — the ticket's own depth (spec); round 3 narrow on 624b374c2..6f45641f0, read by the orchestrator
> Review tokens: 601419 + 144387

Code: `src/shared/changes/parse.ts:71-85` · key lines: 71

```ts
const hostPlatform = (): string => (globalThis as { process?: { platform?: string } }).process?.platform ?? ''

/**
 * Whether `path` can be a path from the top folder of a repository on `platform` (a `process.platform`):
 * not empty, no NUL, not absolute, no `..` part. Everywhere `/x` is absolute and `/` separates the parts. Only on
 * Windows `\x` and `C:x` are absolute and `\` separates the parts too: on macOS and Linux `c:notes.md` and
 * `back\..\slash.txt` are file names a repository may hold. A path the screen asks for must be one; git never prints
 * another. The channel's schema checks it in main, on the Machine whose repository it is.
 */
export function isRepoPath(path: string, platform: string = hostPlatform()): boolean {
  if (path === '' || path.includes('\0') || path.startsWith('/')) return false
  const windows = platform === 'win32'
  if (windows && (path.startsWith('\\') || /^[A-Za-z]:/u.test(path))) return false
  return !path.split(windows ? /[\\/]/u : /\//u).includes('..')
}
```

Code: `src/shared/ipc/changes.ts:19-19` · key lines: 19

```ts
const repoPath = z.string().min(1).refine((path) => isRepoPath(path), { message: 'a path inside the repository' })
```

Code: `test/contract/changes-read.test.ts:578-612` · key lines: 578

```ts
  const TRACKED = [':lead.txt', 'back\\..\\slash.txt', 'c:notes.md']

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-changes-names-')))
    ownGitHome()
    names = join(root, 'names')
    mkdirSync(names)
    gitIn(names, 'init', '-q')
    commit(names, 'start', Object.fromEntries(TRACKED.map((path) => [path, 'one\n'])))
    gitIn(names, 'checkout', '-q', '-b', 'ep/06')
    write(names, { ...Object.fromEntries(TRACKED.map((path) => [path, 'one\ntwo\n'])), 'x:new.txt': 'new\n' })
    const layout: ProjectLayout = { ...fullLayout(names), repos: [{ name: 'names', path: names }], finish: 'local-green' }
    call = caller(changesHandlers({ project: async () => ({ root: names, layout }), git }))
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    removeTestTree(root)
  })

  const lines = (diff: { kind: string; hunks?: { lines: { kind: string; text: string }[] }[] }): string[] =>
    (diff.hunks ?? []).flatMap((hunk) => hunk.lines.filter((line) => line.kind !== 'context').map((line) => `${line.kind} ${line.text}`))

  it('lists them and opens each through changes.file: tracked and changed, and a new file', async () => {
    const [changes] = (await call(changesList, { projectId: 'p', ticket: t06, scope: { kind: 'uncommitted' } })).repos
    expect(changes!.error).toBeNull()
    expect(changes!.files.map((each) => each.path)).toEqual([...TRACKED, 'x:new.txt'].sort())
    for (const path of TRACKED) {
      const { file } = await call(changesFile, { projectId: 'p', ticket: t06, repo: 'names', scope: { kind: 'uncommitted' }, path })
      expect(file.kind, path).toBe('hunks')
      expect(lines(file), path).toEqual(['add two'])
    }
    const { file } = await call(changesFile, { projectId: 'p', ticket: t06, repo: 'names', scope: { kind: 'uncommitted' }, path: 'x:new.txt', untracked: true })
    expect(lines(file)).toEqual(['add new'])
  })
```

Code: `test/unit/changes-parse.test.ts:249-270` · key lines: 249

```ts
describe('a path the screen asks for', () => {
  it('is one from the top folder of the repository on every OS: not absolute with /, no .. part, no NUL', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
      for (const path of ['a.txt', 'notes/с пробелом.md', '.scratch/ep/x.md', 'a..b/c', '...']) expect(isRepoPath(path, platform), `${platform} ${path}`).toBe(true)
      for (const path of ['', '/etc/hosts', '..', '../../secret.txt', 'a/../../b', 'a/..', 'a\0b']) expect(isRepoPath(path, platform), `${platform} ${path}`).toBe(false)
    }
  })

  it('on Windows also refuses a drive, a leading \\ and a .. part between backslashes', () => {
    for (const path of ['C:x', 'c:notes.md', 'C:\\Windows\\win.ini', '\\x', '\\\\server\\share', 'a\\..\\b', 'a\\..']) expect(isRepoPath(path, 'win32'), path).toBe(false)
  })

  it('on macOS and Linux takes : and \\ as letters of a file name', () => {
    for (const platform of ['darwin', 'linux']) {
      for (const path of [':lead.txt', 'c:notes.md', 'x:new.txt', 'C:x', 'back\\..\\slash.txt', '\\x', '..\\up']) expect(isRepoPath(path, platform), `${platform} ${path}`).toBe(true)
    }
  })

  it('takes the platform of this process when none is given', () => {
    expect(isRepoPath('c:notes.md')).toBe(process.platform !== 'win32')
  })
})
```

Code: `src/main/changes/subjects.ts:62-62` · key lines: 62

```ts
    throw Object.assign(new Error(`git ${args[0] ?? ''} failed: ${read.stderr.trim() || `exit code ${String(read.code)}`}`), { code: read.code })
```
